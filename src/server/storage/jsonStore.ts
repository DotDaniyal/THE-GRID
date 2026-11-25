import fs from 'node:fs';
import path from 'node:path';
import {
  extractCollectionsFromSqlite,
  findExistingSqliteCandidate,
  migrateSqliteFileToLocalJson,
} from '../db/migrateSqliteToJson.ts';
import {
  createConfiguredStorageDriver,
  resolveLocalDataDir,
  VersionConflictError,
  type JsonStorageDriver,
  type StorageDriverMode,
} from './drivers.ts';
import {
  ALL_COLLECTIONS,
  createDefaultCollection,
  type CollectionMap,
  type CollectionName,
} from './types.ts';

const MAX_CAS_ATTEMPTS = 8;

let activeDriver: JsonStorageDriver | null = null;
let initPromise: Promise<void> | null = null;
const collectionQueues = new Map<string, Promise<unknown>>();

function getDriver(): JsonStorageDriver {
  if (!activeDriver) {
    activeDriver = createConfiguredStorageDriver();
  }
  return activeDriver;
}

export function resetJsonStoreForTests(): void {
  activeDriver = null;
  initPromise = null;
  collectionQueues.clear();
}

export function getStorageStatus(): {
  mode: StorageDriverMode;
  persistent: boolean;
  localDataDir: string | null;
} {
  const driver = getDriver();
  return {
    mode: driver.mode,
    persistent: driver.persistent,
    localDataDir: driver.mode === 'local_json' ? resolveLocalDataDir() : null,
  };
}

function runSerialized<T>(queueKey: string, task: () => Promise<T>): Promise<T> {
  const prev = collectionQueues.get(queueKey) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  const tail = next.then(
    () => undefined,
    () => undefined
  );
  collectionQueues.set(queueKey, tail);
  return next;
}

function seedFromBundledLocalJsonOrSqlite(): CollectionMap | null {
  const sqliteCandidate = findExistingSqliteCandidate();
  if (sqliteCandidate) {
    try {
      return extractCollectionsFromSqlite(sqliteCandidate);
    } catch {
      // Fall through to bundled JSON seed or defaults
    }
  }

  const localDataDir = path.resolve(process.cwd(), 'data');
  if (fs.existsSync(path.join(localDataDir, 'settings.json'))) {
    try {
      const seed = {} as CollectionMap;
      for (const name of ALL_COLLECTIONS) {
        const filePath = path.join(localDataDir, `${name}.json`);
        if (fs.existsSync(filePath)) {
          seed[name] = JSON.parse(fs.readFileSync(filePath, 'utf8')) as never;
        } else {
          const def = createDefaultCollection(name);
          def.revision = 1;
          seed[name] = def as never;
        }
      }
      return seed;
    } catch {
      return null;
    }
  }

  return null;
}

export async function ensureStoreInitialized(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const driver = getDriver();

    if (driver.mode === 'unconfigured_vercel') {
      return;
    }

    if (driver.mode === 'local_json') {
      const dataDir = resolveLocalDataDir();
      const usingCustomTestDir = Boolean(process.env.JSON_DATA_DIR?.trim());
      if (!usingCustomTestDir || process.env.AUTO_MIGRATE_SQLITE === 'true') {
        await migrateSqliteFileToLocalJson({ targetDataDir: dataDir });
      } else {
        for (const colName of ALL_COLLECTIONS) {
          const existing = await driver.readCollection(colName);
          if (!existing.exists) {
            const def = createDefaultCollection(colName);
            def.revision = 1;
            try {
              await driver.writeCollection(colName, def, null, { skipBackup: true });
            } catch (err) {
              if (!(err instanceof VersionConflictError)) throw err;
            }
          }
        }
      }
      return;
    }

    // External Vercel production store (Vercel Blob or Upstash Redis)
    // Only seed missing collections on first boot; never overwrite existing production records.
    const [settingsRead, adminRead] = await Promise.all([
      driver.readCollection('settings'),
      driver.readCollection('admin-settings'),
    ]);
    if (!settingsRead.exists || !adminRead.exists) {
      const seed = seedFromBundledLocalJsonOrSqlite();
      for (const colName of ALL_COLLECTIONS) {
        const current = await driver.readCollection(colName);
        if (!current.exists) {
          const initial = seed ? seed[colName] : createDefaultCollection(colName);
          if (initial.revision < 1) {
            initial.revision = 1;
          }
          try {
            await driver.writeCollection(colName, initial, null, { skipBackup: true });
          } catch (err) {
            if (!(err instanceof VersionConflictError)) throw err;
          }
        }
      }
    }
  })().catch((err) => {
    initPromise = null;
    throw err;
  });

  return initPromise;
}

export async function readCollection<K extends CollectionName>(
  name: K
): Promise<CollectionMap[K]> {
  await ensureStoreInitialized();
  const driver = getDriver();
  const { data } = await driver.readCollection(name);
  return data;
}

export interface UpdateMutationOptions {
  skipBackup?: boolean;
}

export async function updateCollection<K extends CollectionName, R = void>(
  name: K,
  mutator: (draft: CollectionMap[K]) => R | Promise<R>,
  options?: UpdateMutationOptions
): Promise<{ data: CollectionMap[K]; result: R }> {
  await ensureStoreInitialized();
  const driver = getDriver();

  return runSerialized(`col:${name}`, async () => {
    let lastConflict: unknown = null;

    for (let attempt = 1; attempt <= MAX_CAS_ATTEMPTS; attempt++) {
      const { data: currentData, version } = await driver.readCollection(name);
      const draft = structuredClone(currentData);

      const result = await mutator(draft);
      draft.revision = (currentData.revision || 0) + 1;
      draft.updatedAt = new Date().toISOString();

      try {
        await driver.writeCollection(name, draft, version, options);
        return { data: draft, result };
      } catch (err: unknown) {
        if (err instanceof VersionConflictError) {
          lastConflict = err;
          const jitterMs = 15 + Math.floor(Math.random() * 35) * attempt;
          await new Promise((resolve) => setTimeout(resolve, jitterMs));
          continue;
        }
        throw err;
      }
    }

    throw lastConflict instanceof Error
      ? lastConflict
      : new Error(`Failed to save "${name}" after ${MAX_CAS_ATTEMPTS} concurrent retries.`);
  });
}

export async function withSlotLock<T>(
  bookingDate: string,
  startTime: string,
  fn: () => Promise<T>
): Promise<T> {
  const slotKey = `slot:${bookingDate}:${startTime}`;
  return runSerialized(slotKey, async () => {
    const driver = getDriver();
    if (!driver.acquireSlotLock || !driver.releaseSlotLock) {
      return fn();
    }

    let lockToken: string | null = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      lockToken = await driver.acquireSlotLock(slotKey, 8000);
      if (lockToken) break;
      await new Promise((resolve) => setTimeout(resolve, 40 + attempt * 20));
    }

    if (!lockToken) {
      throw new VersionConflictError('High concurrency on this slot. Please try again.');
    }

    try {
      return await fn();
    } finally {
      await driver.releaseSlotLock(slotKey, lockToken).catch(() => undefined);
    }
  });
}
