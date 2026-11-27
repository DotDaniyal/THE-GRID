import fs from 'node:fs';
import path from 'node:path';
import {
  extractCollectionsFromSqlite,
  findExistingSqliteCandidate,
  migrateSqliteFileToLocalJson,
} from '../db/migrateSqliteToJson.ts';
import {
  createConfiguredStorageDriver,
  createFallbackUpstashDriverIfConfigured,
  inspectStorageEnvDetection,
  resolveLocalDataDir,
  sanitizeStorageError,
  StorageConfigurationError,
  UnconfiguredVercelDriver,
  VersionConflictError,
  type JsonStorageDriver,
  type StorageBackendId,
  type StorageDriverMode,
  type StorageEnvDetection,
} from './drivers.ts';
import {
  ALL_COLLECTIONS,
  createDefaultCollection,
  type CollectionMap,
  type CollectionName,
} from './types.ts';

const MAX_CAS_ATTEMPTS = 8;

const HEALTH_CACHE_TTL_MS = 30_000;

export interface StorageHealthReport {
  mode: StorageDriverMode;
  backend: StorageBackendId;
  persistent: boolean;
  configured: boolean;
  readable: boolean;
  writable: boolean;
  accessible: boolean;
  verified: boolean;
  accessMode: 'local' | 'private' | 'public' | 'redis' | 'unconfigured';
  checkedAt: string;
  envDetection: StorageEnvDetection;
  error: string | null;
}

let activeDriver: JsonStorageDriver | null = null;
let initPromise: Promise<void> | null = null;
let lastVerifiedHealth: { report: StorageHealthReport; expiresAt: number } | null = null;
const collectionQueues = new Map<string, Promise<unknown>>();

function getDriver(): JsonStorageDriver {
  if (!activeDriver) {
    activeDriver = createConfiguredStorageDriver();
    console.info(`[storage] Initialized storage backend: ${activeDriver.backend}`, {
      backend: activeDriver.backend,
      mode: activeDriver.mode,
      persistent: activeDriver.persistent,
    });
  }
  return activeDriver;
}

export function resetJsonStoreForTests(): void {
  activeDriver = null;
  initPromise = null;
  lastVerifiedHealth = null;
  collectionQueues.clear();
}

export function getStorageStatus(): {
  mode: StorageDriverMode;
  backend: StorageBackendId;
  persistent: boolean;
  localDataDir: string | null;
} {
  const driver = getDriver();
  return {
    mode: driver.mode,
    backend: driver.backend,
    persistent: driver.persistent,
    localDataDir: driver.mode === 'local_json' ? resolveLocalDataDir() : null,
  };
}

export async function verifyStorageHealth(options?: {
  force?: boolean;
}): Promise<StorageHealthReport> {
  if (!options?.force && lastVerifiedHealth && Date.now() < lastVerifiedHealth.expiresAt) {
    return lastVerifiedHealth.report;
  }

  let driver = getDriver();
  const checkedAt = new Date().toISOString();
  const configured = driver.persistent || driver.mode === 'local_json';
  const envDetection = inspectStorageEnvDetection();

  if (driver.mode === 'unconfigured_vercel' || !configured) {
    lastVerifiedHealth = null;
    const errorMsg =
      driver instanceof UnconfiguredVercelDriver
        ? driver.reason
        : new StorageConfigurationError().message;
    console.error('[storage] Vercel deployment missing persistent external storage credentials.', {
      mode: driver.mode,
      envDetection,
    });
    return {
      mode: driver.mode,
      backend: driver.backend,
      persistent: false,
      configured: false,
      readable: false,
      writable: false,
      accessible: false,
      verified: false,
      accessMode: 'unconfigured',
      checkedAt,
      envDetection,
      error: errorMsg,
    };
  }

  try {
    await ensureStoreInitialized();
    driver = getDriver();
    let verification = await driver.verifyReadWrite();

    if ((!verification.readable || !verification.writable) && driver.mode === 'vercel_blob') {
      const fallbackUpstash = createFallbackUpstashDriverIfConfigured();
      if (fallbackUpstash) {
        const fallbackVerify = await fallbackUpstash.verifyReadWrite().catch(() => null);
        if (fallbackVerify?.readable && fallbackVerify?.writable) {
          console.warn(
            '[storage] Vercel Blob health probe failed; switching active persistent backend to upstash-redis.',
            { reason: verification.error }
          );
          activeDriver = fallbackUpstash;
          initPromise = null;
          await ensureStoreInitialized();
          driver = getDriver();
          verification = await driver.verifyReadWrite();
        }
      }
    }

    const verified = verification.readable && verification.writable;
    const report: StorageHealthReport = {
      mode: driver.mode,
      backend: driver.backend,
      persistent: driver.persistent,
      configured: true,
      readable: verification.readable,
      writable: verification.writable,
      accessible: verified,
      verified,
      accessMode: verification.accessMode,
      checkedAt,
      envDetection,
      error: verification.error,
    };

    if (verified) {
      lastVerifiedHealth = {
        report,
        expiresAt: Date.now() + HEALTH_CACHE_TTL_MS,
      };
    } else {
      lastVerifiedHealth = null;
      console.error('[storage] Storage verification probe failed:', {
        backend: driver.backend,
        mode: driver.mode,
        readable: verification.readable,
        writable: verification.writable,
        error: verification.error,
      });
    }

    return report;
  } catch (err) {
    lastVerifiedHealth = null;
    const safeError = sanitizeStorageError(err);
    console.error('[storage] Storage verification threw exception:', {
      backend: driver.backend,
      mode: driver.mode,
      error: safeError,
    });
    return {
      mode: driver.mode,
      backend: driver.backend,
      persistent: driver.persistent,
      configured: false,
      readable: false,
      writable: false,
      accessible: false,
      verified: false,
      accessMode:
        driver.mode === 'vercel_blob'
          ? driver.backend === 'vercel-blob-public'
            ? 'public'
            : 'private'
          : driver.mode === 'upstash_redis'
            ? 'redis'
            : 'local',
      checkedAt,
      envDetection,
      error: safeError,
    };
  }
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
    let driver = getDriver();

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
    const initializeExternalStore = async (targetDriver: JsonStorageDriver): Promise<void> => {
      const [settingsRead, adminRead] = await Promise.all([
        targetDriver.readCollection('settings'),
        targetDriver.readCollection('admin-settings'),
      ]);

      if (!settingsRead.exists || !adminRead.exists) {
        const seed = seedFromBundledLocalJsonOrSqlite();
        for (const colName of ALL_COLLECTIONS) {
          const current = await targetDriver.readCollection(colName);
          if (!current.exists) {
            const initial = seed ? seed[colName] : createDefaultCollection(colName);
            if (initial.revision < 1) {
              initial.revision = 1;
            }
            try {
              await targetDriver.writeCollection(colName, initial, null, { skipBackup: true });
            } catch (err) {
              if (!(err instanceof VersionConflictError)) throw err;
            }
          }
        }
      }
    };

    try {
      await initializeExternalStore(driver);
    } catch (err) {
      if (driver.mode === 'vercel_blob' && err instanceof StorageConfigurationError) {
        const fallbackUpstash = createFallbackUpstashDriverIfConfigured();
        if (fallbackUpstash) {
          const fallbackVerify = await fallbackUpstash.verifyReadWrite().catch(() => null);
          if (fallbackVerify?.readable && fallbackVerify?.writable) {
            console.warn(
              '[storage] Vercel Blob verification failed; switching active persistent backend to upstash-redis.',
              { reason: sanitizeStorageError(err) }
            );
            activeDriver = fallbackUpstash;
            driver = fallbackUpstash;
            await initializeExternalStore(fallbackUpstash);
            return;
          }
        }
      }
      throw err;
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
        lastVerifiedHealth = null;
        throw err;
      }
    }

    throw lastConflict instanceof Error
      ? lastConflict
      : new Error(`Failed to save "${name}" after ${MAX_CAS_ATTEMPTS} concurrent retries.`);
  });
}

export async function withNamedLock<T>(
  lockKey: string,
  fn: () => Promise<T>
): Promise<T> {
  return runSerialized(lockKey, async () => {
    const driver = getDriver();
    if (!driver.acquireSlotLock || !driver.releaseSlotLock) {
      return fn();
    }

    let lockToken: string | null = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      lockToken = await driver.acquireSlotLock(lockKey, 8000);
      if (lockToken) break;
      await new Promise((resolve) => setTimeout(resolve, 40 + attempt * 20));
    }

    if (!lockToken) {
      throw new VersionConflictError('High concurrency on this operation. Please try again.');
    }

    try {
      return await fn();
    } finally {
      await driver.releaseSlotLock(lockKey, lockToken).catch(() => undefined);
    }
  });
}

export async function withSlotLock<T>(
  bookingDate: string,
  startTime: string,
  fn: () => Promise<T>
): Promise<T> {
  return withNamedLock(`slot:${bookingDate}:${startTime}`, fn);
}

export async function getStorageOverviewStats(): Promise<{
  health: StorageHealthReport;
  counts: {
    bookings: number;
    customers: number;
    products: number;
    sales: number;
    expenses: number;
    adminUsers: number;
  };
}> {
  const health = await verifyStorageHealth({ force: true });
  const [bookings, customers, products, sales, expenses, adminSettings] = await Promise.all([
    readCollection('bookings'),
    readCollection('customers'),
    readCollection('products'),
    readCollection('sales'),
    readCollection('expenses'),
    readCollection('admin-settings'),
  ]);

  return {
    health,
    counts: {
      bookings: bookings.records.length,
      customers: customers.records.length,
      products: products.records.length,
      sales: sales.records.length,
      expenses: expenses.records.length,
      adminUsers: adminSettings.users.length,
    },
  };
}

export async function buildSanitizedCentralBackupSnapshot() {
  await ensureStoreInitialized();
  const driver = getDriver();
  const [settings, bookings, customers, products, inventory, sales, expenses, adminSettings] =
    await Promise.all([
      readCollection('settings'),
      readCollection('bookings'),
      readCollection('customers'),
      readCollection('products'),
      readCollection('inventory'),
      readCollection('sales'),
      readCollection('expenses'),
      readCollection('admin-settings'),
    ]);

  const { session_secret: _omittedSecret, ...safeAppMeta } = adminSettings.appMeta ?? {};

  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    storageMode: driver.mode,
    collections: {
      settings,
      bookings: {
        ...bookings,
        records: bookings.records.map(({ status_token: _omitToken, ...safeRecord }) => safeRecord),
      },
      customers,
      products,
      inventory,
      sales,
      expenses,
      adminSettings: {
        schemaVersion: adminSettings.schemaVersion,
        updatedAt: adminSettings.updatedAt,
        revision: adminSettings.revision,
        nextUserId: adminSettings.nextUserId,
        appMeta: safeAppMeta,
        users: adminSettings.users.map(
          ({ password_hash: _omitHash, mfa_secret: _omitMfa, ...safeUser }) => safeUser
        ),
        auditLogs: adminSettings.auditLogs ?? [],
      },
    },
  };
}
