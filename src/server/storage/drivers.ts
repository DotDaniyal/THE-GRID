import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  BlobAccessError,
  BlobNotFoundError,
  BlobPreconditionFailedError,
  del as blobDel,
  get as blobGet,
  put as blobPut,
} from '@vercel/blob';
import {
  createDefaultCollection,
  validateCollectionDocument,
  type CollectionMap,
  type CollectionName,
} from './types.ts';

export type StorageDriverMode =
  | 'local_json'
  | 'vercel_blob'
  | 'upstash_redis'
  | 'unconfigured_vercel';

export class VersionConflictError extends Error {
  constructor(message = 'Concurrent update conflict detected; retry with latest data.') {
    super(message);
    this.name = 'VersionConflictError';
  }
}

export class StorageConfigurationError extends Error {
  statusCode = 503;

  constructor(
    message = 'Persistent external JSON storage is not configured for Vercel production. Connect Vercel Blob (BLOB_READ_WRITE_TOKEN) or Upstash Redis (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN) in Vercel Environment Variables.'
  ) {
    super(message);
    this.name = 'StorageConfigurationError';
  }
}

export interface ReadCollectionResult<K extends CollectionName> {
  data: CollectionMap[K];
  version: string | null;
  exists: boolean;
}

export interface JsonStorageDriver {
  readonly mode: StorageDriverMode;
  readonly persistent: boolean;
  readCollection<K extends CollectionName>(name: K): Promise<ReadCollectionResult<K>>;
  writeCollection<K extends CollectionName>(
    name: K,
    data: CollectionMap[K],
    expectedVersion: string | null,
    options?: { skipBackup?: boolean }
  ): Promise<{ version: string }>;
  acquireSlotLock?(slotKey: string, ttlMs?: number): Promise<string | null>;
  releaseSlotLock?(slotKey: string, token: string): Promise<void>;
}

export function resolveLocalDataDir(): string {
  const customDir = process.env.JSON_DATA_DIR?.trim();
  if (customDir) {
    return path.resolve(customDir);
  }
  return path.resolve(process.cwd(), 'data');
}

function getUpstashConfig(): { url: string; token: string } | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    process.env.KV_REST_API_URL?.trim() ||
    '';
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
    process.env.KV_REST_API_TOKEN?.trim() ||
    '';
  if (url && token) {
    return { url: url.replace(/\/+$/, ''), token };
  }
  return null;
}

async function acquireUpstashSlotLock(
  config: { url: string; token: string },
  slotKey: string,
  ttlMs = 8000
): Promise<string | null> {
  const lockToken = crypto.randomBytes(12).toString('hex');
  const res = await fetch(`${config.url}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(['SET', `thegrid:lock:${slotKey}`, lockToken, 'NX', 'PX', String(ttlMs)]),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { result?: string | null };
  return json.result === 'OK' ? lockToken : null;
}

async function releaseUpstashSlotLock(
  config: { url: string; token: string },
  slotKey: string,
  lockToken: string
): Promise<void> {
  const lua = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end`;
  await fetch(`${config.url}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(['EVAL', lua, 1, `thegrid:lock:${slotKey}`, lockToken]),
  }).catch(() => undefined);
}

/**
 * Local JSON file driver:
 * Stores structured JSON files inside ./data/<collection>.json with atomic temp+rename writes,
 * rolling backups in ./data/.backups/, and automatic corrupt-file quarantine/recovery.
 */
export class LocalJsonFileDriver implements JsonStorageDriver {
  readonly mode = 'local_json' as const;
  readonly persistent = true;
  private readonly dataDir: string;
  private readonly backupsDir: string;
  private readonly corruptedDir: string;

  constructor(dataDir = resolveLocalDataDir()) {
    this.dataDir = dataDir;
    this.backupsDir = path.join(dataDir, '.backups');
    this.corruptedDir = path.join(dataDir, '.corrupted');
  }

  private filePath(name: CollectionName): string {
    return path.join(this.dataDir, `${name}.json`);
  }

  private async ensureDirs(): Promise<void> {
    await fsp.mkdir(this.dataDir, { recursive: true });
    await fsp.mkdir(this.backupsDir, { recursive: true });
  }

  private parseAndValidate<K extends CollectionName>(
    name: K,
    raw: string
  ): CollectionMap[K] | null {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (validateCollectionDocument(name, parsed)) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async restoreFromBackup<K extends CollectionName>(
    name: K
  ): Promise<CollectionMap[K] | null> {
    try {
      if (!fs.existsSync(this.backupsDir)) return null;
      const prefix = `${name}-`;
      const files = (await fsp.readdir(this.backupsDir))
        .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
        .sort()
        .reverse();

      for (const file of files) {
        const raw = await fsp.readFile(path.join(this.backupsDir, file), 'utf8');
        const valid = this.parseAndValidate(name, raw);
        if (valid) {
          return valid;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private async quarantineCorruptFile(name: CollectionName, raw: string): Promise<void> {
    try {
      await fsp.mkdir(this.corruptedDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      await fsp.writeFile(
        path.join(this.corruptedDir, `${name}-corrupt-${ts}.json`),
        raw,
        'utf8'
      );
    } catch {
      // Best-effort quarantine
    }
  }

  private async saveBackupSnapshot(name: CollectionName, serialized: string): Promise<void> {
    try {
      await fsp.mkdir(this.backupsDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const snapName = `${name}-${ts}-${crypto.randomBytes(2).toString('hex')}.json`;
      const snapTmp = path.join(this.backupsDir, `.${snapName}.tmp`);
      const snapPath = path.join(this.backupsDir, snapName);
      await fsp.writeFile(snapTmp, serialized, 'utf8');
      await fsp.rename(snapTmp, snapPath);

      const prefix = `${name}-`;
      const all = (await fsp.readdir(this.backupsDir))
        .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
        .sort();
      const excess = all.length - 12;
      if (excess > 0) {
        for (const oldFile of all.slice(0, excess)) {
          await fsp.unlink(path.join(this.backupsDir, oldFile)).catch(() => undefined);
        }
      }
    } catch {
      // Do not fail primary write if snapshot rotation fails
    }
  }

  async readCollection<K extends CollectionName>(
    name: K
  ): Promise<ReadCollectionResult<K>> {
    await this.ensureDirs();
    const target = this.filePath(name);

    if (!fs.existsSync(target)) {
      const recovered = await this.restoreFromBackup(name);
      if (recovered) {
        const serialized = JSON.stringify(recovered, null, 2);
        const tmp = path.join(this.dataDir, `.${name}.restore-${process.pid}.tmp`);
        await fsp.writeFile(tmp, serialized, 'utf8');
        await fsp.rename(tmp, target);
        return {
          data: recovered,
          version: String(recovered.revision),
          exists: true,
        };
      }
      return {
        data: createDefaultCollection(name),
        version: null,
        exists: false,
      };
    }

    const raw = await fsp.readFile(target, 'utf8');
    const parsed = this.parseAndValidate(name, raw);
    if (parsed) {
      return {
        data: parsed,
        version: String(parsed.revision),
        exists: true,
      };
    }

    // Corrupted JSON file detected: quarantine & attempt automatic backup recovery
    await this.quarantineCorruptFile(name, raw);
    const recovered = await this.restoreFromBackup(name);
    if (recovered) {
      const serialized = JSON.stringify(recovered, null, 2);
      const tmp = path.join(this.dataDir, `.${name}.recover-${process.pid}.tmp`);
      await fsp.writeFile(tmp, serialized, 'utf8');
      await fsp.rename(tmp, target);
      return {
        data: recovered,
        version: String(recovered.revision),
        exists: true,
      };
    }

    const fallback = createDefaultCollection(name);
    return {
      data: fallback,
      version: null,
      exists: false,
    };
  }

  async writeCollection<K extends CollectionName>(
    name: K,
    data: CollectionMap[K],
    expectedVersion: string | null,
    options?: { skipBackup?: boolean }
  ): Promise<{ version: string }> {
    await this.ensureDirs();
    const target = this.filePath(name);

    if (!validateCollectionDocument(name, data)) {
      throw new Error(`Invalid schema for JSON collection "${name}".`);
    }

    if (fs.existsSync(target)) {
      const currentRaw = await fsp.readFile(target, 'utf8');
      const currentDoc = this.parseAndValidate(name, currentRaw);
      const currentVersion = currentDoc ? String(currentDoc.revision) : null;
      if (expectedVersion !== currentVersion) {
        throw new VersionConflictError(
          `Revision mismatch on ${name}.json (expected ${expectedVersion}, actual ${currentVersion}).`
        );
      }
      if (!options?.skipBackup && currentDoc) {
        await this.saveBackupSnapshot(name, currentRaw);
      }
    } else if (expectedVersion !== null) {
      throw new VersionConflictError(
        `Missing expected file ${name}.json for revision ${expectedVersion}.`
      );
    }

    const serialized = JSON.stringify(data, null, 2);
    // Double-check round-trip parseability before touching target file
    JSON.parse(serialized);

    const tmpFile = path.join(
      this.dataDir,
      `.${name}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
    );
    await fsp.writeFile(tmpFile, serialized, 'utf8');
    await fsp.rename(tmpFile, target);

    return { version: String(data.revision) };
  }
}

/**
 * Vercel Blob JSON Driver:
 * Stores private JSON documents in Vercel Blob Storage (`thegrid/data/<collection>.json`)
 * with origin reads (`useCache: false`) and ETag optimistic concurrency (`ifMatch`).
 */
export class VercelBlobJsonDriver implements JsonStorageDriver {
  readonly mode = 'vercel_blob' as const;
  readonly persistent = true;
  private readonly token: string;
  private access: 'private' | 'public';
  private readonly upstash: { url: string; token: string } | null;

  constructor(token: string) {
    this.token = token;
    this.access = process.env.VERCEL_BLOB_ACCESS === 'public' ? 'public' : 'private';
    this.upstash = getUpstashConfig();
  }

  private pathname(name: CollectionName): string {
    return `thegrid/data/${name}.json`;
  }

  private backupPathname(name: CollectionName): string {
    return `thegrid/backups/${name}-latest.json`;
  }

  private lockPathname(slotKey: string): string {
    const safeKey = slotKey.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `thegrid/locks/${safeKey}.json`;
  }

  private getTarget(pathname: string): string {
    const override = process.env.VERCEL_BLOB_API_URL?.trim();
    if (override) {
      return `${override.replace(/\/+$/, '')}/${pathname}`;
    }
    return pathname;
  }

  private isAccessMismatchError(err: unknown): boolean {
    if (err instanceof BlobAccessError) return true;
    const msg = err instanceof Error ? err.message.toLowerCase() : '';
    return (
      msg.includes('public access') ||
      msg.includes('private access') ||
      msg.includes('public store') ||
      msg.includes('private store')
    );
  }

  private async withAccessFallback<T>(
    operation: (access: 'private' | 'public') => Promise<T>
  ): Promise<T> {
    try {
      return await operation(this.access);
    } catch (err) {
      if (this.isAccessMismatchError(err)) {
        const alternate = this.access === 'private' ? 'public' : 'private';
        const result = await operation(alternate);
        this.access = alternate;
        if (alternate === 'public') {
          console.warn(
            'Vercel Blob store is configured as public; using public store mode automatically. A private Vercel Blob store is recommended for production.'
          );
        }
        return result;
      }
      throw err;
    }
  }

  async readCollection<K extends CollectionName>(
    name: K
  ): Promise<ReadCollectionResult<K>> {
    let primaryResult: Awaited<ReturnType<typeof blobGet>> = null;
    try {
      primaryResult = await this.withAccessFallback((access) =>
        blobGet(this.getTarget(this.pathname(name)), {
          access,
          useCache: false,
          token: this.token,
        })
      );
    } catch (err: unknown) {
      if (err instanceof BlobNotFoundError) {
        return {
          data: createDefaultCollection(name),
          version: null,
          exists: false,
        };
      }
      throw err;
    }

    if (!primaryResult || primaryResult.statusCode !== 200 || !primaryResult.stream) {
      return {
        data: createDefaultCollection(name),
        version: null,
        exists: false,
      };
    }

    const primaryEtag = primaryResult.blob.etag || null;
    const raw = await new Response(primaryResult.stream).text();
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (validateCollectionDocument(name, parsed)) {
        return {
          data: parsed,
          version: primaryEtag,
          exists: true,
        };
      }
    } catch {
      // Primary blob JSON is corrupted; fall through to backup recovery
    }

    // Only attempt backup recovery when primary blob contents failed validation/parsing
    try {
      const backup = await this.withAccessFallback((access) =>
        blobGet(this.getTarget(this.backupPathname(name)), {
          access,
          useCache: false,
          token: this.token,
        })
      );
      if (backup && backup.statusCode === 200 && backup.stream) {
        const backupRaw = await new Response(backup.stream).text();
        const backupParsed = JSON.parse(backupRaw) as unknown;
        if (validateCollectionDocument(name, backupParsed)) {
          return {
            data: backupParsed,
            version: primaryEtag,
            exists: Boolean(primaryEtag),
          };
        }
      }
    } catch {
      // Ignore backup lookup failure if backup doesn't exist
    }

    throw new Error(`Invalid JSON schema in Vercel Blob for "${name}".`);
  }

  async writeCollection<K extends CollectionName>(
    name: K,
    data: CollectionMap[K],
    expectedVersion: string | null,
    options?: { skipBackup?: boolean }
  ): Promise<{ version: string }> {
    if (!validateCollectionDocument(name, data)) {
      throw new Error(`Invalid schema for JSON collection "${name}".`);
    }

    const serialized = JSON.stringify(data, null, 2);
    JSON.parse(serialized);

    try {
      const putResult = await this.withAccessFallback((access) =>
        blobPut(this.pathname(name), serialized, {
          access,
          addRandomSuffix: false,
          contentType: 'application/json',
          cacheControlMaxAge: 0,
          token: this.token,
          ...(expectedVersion
            ? { allowOverwrite: true, ifMatch: expectedVersion }
            : { allowOverwrite: false }),
        })
      );

      if (!options?.skipBackup && data.revision > 0) {
        await this.withAccessFallback((access) =>
          blobPut(this.backupPathname(name), serialized, {
            access,
            addRandomSuffix: false,
            allowOverwrite: true,
            contentType: 'application/json',
            cacheControlMaxAge: 0,
            token: this.token,
          })
        ).catch(() => undefined);
      }

      return { version: putResult.etag || String(data.revision) };
    } catch (err: unknown) {
      if (err instanceof BlobPreconditionFailedError) {
        throw new VersionConflictError('Vercel Blob ETag mismatch; retrying with latest JSON.');
      }
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      if (
        !expectedVersion &&
        (msg.includes('already exists') || msg.includes('overwrite') || msg.includes('412'))
      ) {
        throw new VersionConflictError('Vercel Blob already exists; retrying with latest ETag.');
      }
      throw err;
    }
  }

  async acquireSlotLock(slotKey: string, ttlMs = 8000): Promise<string | null> {
    if (this.upstash) {
      return acquireUpstashSlotLock(this.upstash, slotKey, ttlMs);
    }

    const lockPath = this.lockPathname(slotKey);
    const lockToken = crypto.randomBytes(12).toString('hex');
    const now = Date.now();
    const payload = JSON.stringify({
      token: lockToken,
      expiresAt: now + ttlMs,
    });

    try {
      await this.withAccessFallback((access) =>
        blobPut(lockPath, payload, {
          access,
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: 'application/json',
          cacheControlMaxAge: 0,
          token: this.token,
        })
      );
      return lockToken;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      const isConflict =
        err instanceof BlobPreconditionFailedError ||
        msg.includes('already exists') ||
        msg.includes('overwrite') ||
        msg.includes('412') ||
        msg.includes('409');
      if (!isConflict) {
        throw err;
      }

      // Check if an existing lock has expired (e.g. crashed Lambda container)
      try {
        const existing = await this.withAccessFallback((access) =>
          blobGet(this.getTarget(lockPath), {
            access,
            useCache: false,
            token: this.token,
          })
        );
        if (!existing || existing.statusCode !== 200 || !existing.stream) {
          return null;
        }
        const existingBody = JSON.parse(await new Response(existing.stream).text()) as {
          expiresAt?: number;
        };
        if (typeof existingBody.expiresAt === 'number' && Date.now() > existingBody.expiresAt) {
          await this.withAccessFallback((access) =>
            blobPut(lockPath, payload, {
              access,
              addRandomSuffix: false,
              allowOverwrite: true,
              ifMatch: existing.blob.etag,
              contentType: 'application/json',
              cacheControlMaxAge: 0,
              token: this.token,
            })
          );
          return lockToken;
        }
      } catch {
        // Active lock held or raced by another container
      }
      return null;
    }
  }

  async releaseSlotLock(slotKey: string, lockToken: string): Promise<void> {
    if (this.upstash) {
      await releaseUpstashSlotLock(this.upstash, slotKey, lockToken);
      return;
    }

    const lockPath = this.lockPathname(slotKey);
    try {
      const existing = await this.withAccessFallback((access) =>
        blobGet(this.getTarget(lockPath), {
          access,
          useCache: false,
          token: this.token,
        })
      );
      if (!existing || existing.statusCode !== 200 || !existing.stream) {
        return;
      }
      const existingBody = JSON.parse(await new Response(existing.stream).text()) as {
        token?: string;
      };
      if (existingBody.token === lockToken) {
        await blobDel(this.getTarget(lockPath), { token: this.token }).catch(() => undefined);
      }
    } catch {
      // Lock already expired or released
    }
  }
}

/**
 * Upstash Redis / Vercel KV REST JSON Driver:
 * Stores JSON documents at keys `thegrid:data:<collection>.json` and performs atomic
 * compare-and-set revision checks inside a server-side Lua script.
 */
export class UpstashRedisJsonDriver implements JsonStorageDriver {
  readonly mode = 'upstash_redis' as const;
  readonly persistent = true;
  private readonly config: { url: string; token: string };

  constructor(config: { url: string; token: string }) {
    this.config = config;
  }

  private key(name: CollectionName): string {
    return `thegrid:data:${name}.json`;
  }

  private backupKey(name: CollectionName): string {
    return `thegrid:backups:${name}-latest.json`;
  }

  private async command<T = unknown>(args: Array<string | number>): Promise<T> {
    const res = await fetch(this.config.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Upstash Redis REST error (${res.status}): ${text.slice(0, 200)}`);
    }
    const body = (await res.json()) as { result: T; error?: string };
    if (body.error) {
      throw new Error(`Upstash Redis command error: ${body.error}`);
    }
    return body.result;
  }

  async readCollection<K extends CollectionName>(
    name: K
  ): Promise<ReadCollectionResult<K>> {
    const raw = await this.command<string | null>(['GET', this.key(name)]);
    if (!raw) {
      return {
        data: createDefaultCollection(name),
        version: null,
        exists: false,
      };
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (validateCollectionDocument(name, parsed)) {
        return {
          data: parsed,
          version: String(parsed.revision),
          exists: true,
        };
      }
    } catch {
      // Fallback to backup key below
    }

    const backupRaw = await this.command<string | null>(['GET', this.backupKey(name)]);
    if (backupRaw) {
      try {
        const parsedBackup = JSON.parse(backupRaw) as unknown;
        if (validateCollectionDocument(name, parsedBackup)) {
          return {
            data: parsedBackup,
            version: null,
            exists: false,
          };
        }
      } catch {
        // Ignore corrupt backup
      }
    }

    throw new Error(`Corrupted JSON payload stored in Upstash Redis for "${name}".`);
  }

  async writeCollection<K extends CollectionName>(
    name: K,
    data: CollectionMap[K],
    expectedVersion: string | null,
    options?: { skipBackup?: boolean }
  ): Promise<{ version: string }> {
    if (!validateCollectionDocument(name, data)) {
      throw new Error(`Invalid schema for JSON collection "${name}".`);
    }

    const serialized = JSON.stringify(data, null, 2);
    JSON.parse(serialized);

    const lua = `
      local cur = redis.call("GET", KEYS[1])
      local exp = ARGV[1]
      if not cur then
        if exp ~= "__NULL__" then return "CONFLICT" end
      else
        local ok, decoded = pcall(cjson.decode, cur)
        local curRev = (ok and decoded and decoded.revision ~= nil) and tostring(decoded.revision) or "__INVALID__"
        if curRev ~= exp then return "CONFLICT" end
        if ARGV[3] == "1" then
          redis.call("SET", KEYS[2], cur)
        end
      end
      redis.call("SET", KEYS[1], ARGV[2])
      return "OK"
    `;

    const result = await this.command<string>([
      'EVAL',
      lua,
      2,
      this.key(name),
      this.backupKey(name),
      expectedVersion ?? '__NULL__',
      serialized,
      options?.skipBackup ? '0' : '1',
    ]);

    if (result === 'CONFLICT') {
      throw new VersionConflictError(
        `Concurrent update conflict on Upstash Redis key "${name}".`
      );
    }

    return { version: String(data.revision) };
  }

  async acquireSlotLock(slotKey: string, ttlMs = 8000): Promise<string | null> {
    return acquireUpstashSlotLock(this.config, slotKey, ttlMs);
  }

  async releaseSlotLock(slotKey: string, token: string): Promise<void> {
    await releaseUpstashSlotLock(this.config, slotKey, token);
  }
}

/**
 * Safeguard driver when running on Vercel without persistent external storage credentials.
 * Never writes silently to ephemeral /tmp; returns read-only defaults for safe read endpoints
 * and fails writes explicitly with 503 StorageConfigurationError.
 */
export class UnconfiguredVercelDriver implements JsonStorageDriver {
  readonly mode = 'unconfigured_vercel' as const;
  readonly persistent = false;

  async readCollection<K extends CollectionName>(
    name: K
  ): Promise<ReadCollectionResult<K>> {
    return {
      data: createDefaultCollection(name),
      version: null,
      exists: false,
    };
  }

  async writeCollection(): Promise<{ version: string }> {
    throw new StorageConfigurationError();
  }
}

export function createConfiguredStorageDriver(): JsonStorageDriver {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim() || '';
  const upstash = getUpstashConfig();
  const preferredDriver = process.env.STORAGE_DRIVER?.trim().toLowerCase();

  if (preferredDriver === 'upstash_redis' && upstash) {
    return new UpstashRedisJsonDriver(upstash);
  }
  if (preferredDriver === 'vercel_blob' && blobToken) {
    return new VercelBlobJsonDriver(blobToken);
  }

  if (process.env.VERCEL === '1') {
    if (blobToken) {
      return new VercelBlobJsonDriver(blobToken);
    }
    if (upstash) {
      return new UpstashRedisJsonDriver(upstash);
    }
    return new UnconfiguredVercelDriver();
  }

  // Local development (or explicit JSON_DATA_DIR tests): persistent local JSON files under ./data/
  if (blobToken && preferredDriver === 'vercel_blob') {
    return new VercelBlobJsonDriver(blobToken);
  }
  if (upstash && preferredDriver === 'upstash_redis') {
    return new UpstashRedisJsonDriver(upstash);
  }

  return new LocalJsonFileDriver(resolveLocalDataDir());
}
