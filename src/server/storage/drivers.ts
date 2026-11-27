import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  BlobAccessError,
  BlobClientTokenExpiredError,
  BlobNotFoundError,
  BlobPreconditionFailedError,
  BlobServiceRateLimited,
  BlobStoreNotFoundError,
  BlobStoreSuspendedError,
  del as blobDel,
  get as blobGet,
  head as blobHead,
  list as blobList,
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

export type StorageBackendId =
  | 'local-json'
  | 'vercel-blob-private'
  | 'vercel-blob-public'
  | 'upstash-redis'
  | 'unconfigured-vercel';

export type NormalizedStorageDriverPreference = 'auto' | 'blob' | 'redis';

export class VersionConflictError extends Error {
  constructor(message = 'Concurrent update conflict detected; retry with latest data.') {
    super(message);
    this.name = 'VersionConflictError';
  }
}

export class StorageConfigurationError extends Error {
  statusCode = 503;

  constructor(
    message = 'Persistent external JSON storage is not configured for Vercel production. Connect a Private Vercel Blob Store (BLOB_READ_WRITE_TOKEN) or Upstash Redis (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN, KV_REST_API_URL, or Upstash REDIS_URL) in Vercel Production Environment Variables and redeploy.'
  ) {
    super(message);
    this.name = 'StorageConfigurationError';
  }
}

export interface StorageEnvDetection {
  vercelDetected: boolean;
  configuredDriver: NormalizedStorageDriverPreference;
  blobAccess: 'private' | 'public';
  blobTokenDetected: boolean;
  blobTokenFormatValid: boolean;
  blobApiUrlOverrideSet: boolean;
  upstashRestDetected: boolean;
  upstashUrlDetected: boolean;
  matchedEnvKeys: string[];
}

export interface StorageVerificationResult {
  readable: boolean;
  writable: boolean;
  accessMode: 'local' | 'private' | 'public' | 'redis' | 'unconfigured';
  error: string | null;
}

export interface ReadCollectionResult<K extends CollectionName> {
  data: CollectionMap[K];
  version: string | null;
  exists: boolean;
}

export interface JsonStorageDriver {
  readonly mode: StorageDriverMode;
  readonly backend: StorageBackendId;
  readonly persistent: boolean;
  readCollection<K extends CollectionName>(name: K): Promise<ReadCollectionResult<K>>;
  writeCollection<K extends CollectionName>(
    name: K,
    data: CollectionMap[K],
    expectedVersion: string | null,
    options?: { skipBackup?: boolean }
  ): Promise<{ version: string }>;
  verifyReadWrite(): Promise<StorageVerificationResult>;
  acquireSlotLock?(slotKey: string, ttlMs?: number): Promise<string | null>;
  releaseSlotLock?(slotKey: string, token: string): Promise<void>;
}

function stripSurroundingQuotes(raw: string | undefined): string {
  const trimmed = (raw || '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizeSecretEnvValue(raw: string | undefined, expectedKey?: string): string {
  let val = stripSurroundingQuotes(raw);
  if (!val) return '';

  // Handle accidental copy-paste of `KEY=value` or `Bearer value`
  const keyMatch = val.match(/^([A-Z0-9_]+)\s*=\s*(.+)$/);
  if (keyMatch && (!expectedKey || keyMatch[1] === expectedKey || keyMatch[1].endsWith('TOKEN') || keyMatch[1].endsWith('URL'))) {
    val = stripSurroundingQuotes(keyMatch[2]);
  }
  if (/^Bearer\s+/i.test(val)) {
    val = stripSurroundingQuotes(val.replace(/^Bearer\s+/i, ''));
  }
  return val.trim();
}

export function isValidVercelBlobToken(token: string): boolean {
  return /^vercel_blob_rw_[a-zA-Z0-9]+_[a-zA-Z0-9._-]+$/.test(token);
}

export function isVercelRuntime(): boolean {
  return (
    stripSurroundingQuotes(process.env.VERCEL) === '1' ||
    Boolean(stripSurroundingQuotes(process.env.VERCEL_ENV))
  );
}

function resolveBlobTokenMatch(): { token: string; key: string | null; valid: boolean } {
  const directKeys = ['BLOB_READ_WRITE_TOKEN', 'VERCEL_BLOB_READ_WRITE_TOKEN'];
  let firstInvalidMatch: { token: string; key: string } | null = null;

  for (const key of directKeys) {
    const candidate = normalizeSecretEnvValue(process.env[key], key);
    if (!candidate) continue;
    if (isValidVercelBlobToken(candidate)) {
      return { token: candidate, key, valid: true };
    }
    if (!firstInvalidMatch) {
      firstInvalidMatch = { token: candidate, key };
    }
  }

  // Vercel Storage allows custom env prefixes (e.g., MYSTORE_READ_WRITE_TOKEN or THEGRID_BLOB_READ_WRITE_TOKEN)
  for (const [envKey, envVal] of Object.entries(process.env)) {
    const candidate = normalizeSecretEnvValue(envVal, envKey);
    if (!candidate) continue;
    if (isValidVercelBlobToken(candidate)) {
      return { token: candidate, key: envKey, valid: true };
    }
    if (
      !firstInvalidMatch &&
      (envKey.endsWith('_READ_WRITE_TOKEN') || envKey.endsWith('_BLOB_TOKEN'))
    ) {
      firstInvalidMatch = { token: candidate, key: envKey };
    }
  }

  if (firstInvalidMatch) {
    return { token: firstInvalidMatch.token, key: firstInvalidMatch.key, valid: false };
  }

  return { token: '', key: null, valid: false };
}

export function resolveVercelBlobToken(): string {
  const match = resolveBlobTokenMatch();
  return match.valid ? match.token : '';
}

export function resolveVercelBlobAccess(): 'private' | 'public' {
  const configured = stripSurroundingQuotes(process.env.VERCEL_BLOB_ACCESS).toLowerCase();
  if (configured === 'public') {
    return 'public';
  }
  return 'private';
}

export function resolveConfiguredStorageDriverPreference(): NormalizedStorageDriverPreference {
  const raw = stripSurroundingQuotes(process.env.STORAGE_DRIVER).toLowerCase();
  if (raw === 'redis' || raw === 'upstash_redis') {
    return 'redis';
  }
  if (raw === 'blob' || raw === 'vercel_blob') {
    return 'blob';
  }
  return 'auto';
}

export function sanitizeStorageError(err: unknown): string {
  if (err instanceof StorageConfigurationError) {
    return err.message;
  }

  if (err instanceof BlobAccessError) {
    return 'Vercel Blob private access failed. Verify that BLOB_READ_WRITE_TOKEN belongs to a Private Vercel Blob Store in this project and redeploy.';
  }
  if (err instanceof BlobStoreNotFoundError) {
    return 'Connected Vercel Blob Store was not found. Connect a Private Vercel Blob Store in Vercel Storage and redeploy.';
  }
  if (err instanceof BlobStoreSuspendedError) {
    return 'Connected Vercel Blob Store is suspended. Check your Vercel Storage billing/status and redeploy.';
  }
  if (err instanceof BlobClientTokenExpiredError) {
    return 'Vercel Blob token expired. Update BLOB_READ_WRITE_TOKEN in Vercel Environment Variables and redeploy.';
  }
  if (err instanceof BlobServiceRateLimited) {
    return 'Vercel Blob storage is temporarily rate-limited. Please retry in a few seconds.';
  }

  const rawMsg = err instanceof Error ? err.message : String(err || 'Unknown storage error');
  const lower = rawMsg.toLowerCase();

  if (
    lower.includes('public access') ||
    lower.includes('private access') ||
    lower.includes('public store') ||
    lower.includes('private store')
  ) {
    return 'Vercel Blob Store access mismatch: sensitive JSON records require a Private Vercel Blob Store (access: "private"). Connect a Private Blob Store and update BLOB_READ_WRITE_TOKEN.';
  }
  if (lower.includes('unable to extract store id') || lower.includes('invalid token')) {
    return 'BLOB_READ_WRITE_TOKEN format is invalid. Copy the token from your Private Vercel Blob Store in Vercel and redeploy.';
  }

  // Redact any accidental credential/token/URL material before returning to callers
  const scrubbed = rawMsg
    .replace(/vercel_blob_rw_[^\s"'`]+/gi, '[REDACTED_BLOB_TOKEN]')
    .replace(/rediss?:\/\/[^\s"'`]+/gi, '[REDACTED_REDIS_URL]')
    .replace(/Bearer\s+[^\s"'`]+/gi, 'Bearer [REDACTED]')
    .replace(/https?:\/\/[^\s"'`]+/gi, (matched) => {
      try {
        const u = new URL(matched);
        return `${u.protocol}//${u.host}`;
      } catch {
        return '[REDACTED_URL]';
      }
    });

  return scrubbed.slice(0, 240) || 'Persistent storage verification failed.';
}

export function resolveLocalDataDir(): string {
  const customDir = process.env.JSON_DATA_DIR?.trim();
  if (customDir) {
    return path.resolve(customDir);
  }
  return path.resolve(process.cwd(), 'data');
}

function isValidHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function parseUpstashRedisConnectionUrl(
  rawUrl: string
): { url: string; token: string } | null {
  const cleaned = stripSurroundingQuotes(rawUrl);
  if (!cleaned) return null;
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== 'rediss:' && parsed.protocol !== 'redis:') {
      return null;
    }
    const hostname = parsed.hostname.trim().toLowerCase();
    const token = decodeURIComponent(parsed.password || '').trim();
    if (!hostname.endsWith('.upstash.io') || !token) {
      return null;
    }
    return {
      url: `https://${hostname}`,
      token,
    };
  } catch {
    return null;
  }
}

function resolveUpstashMatch(): {
  config: { url: string; token: string } | null;
  source: 'rest' | 'redis_url' | null;
  matchedKeys: string[];
} {
  // 1. Standard Upstash / Vercel KV REST pairs
  const directPairs: Array<[string, string]> = [
    ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
    ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
  ];
  for (const [urlKey, tokenKey] of directPairs) {
    const url = normalizeSecretEnvValue(process.env[urlKey], urlKey);
    const token = normalizeSecretEnvValue(process.env[tokenKey], tokenKey);
    if (url && token && isValidHttpUrl(url)) {
      return {
        config: { url: url.replace(/\/+$/, ''), token },
        source: 'rest',
        matchedKeys: [urlKey, tokenKey],
      };
    }
  }

  // 2. Custom-prefixed Vercel Storage / Upstash REST pairs (e.g., THE_GRID_KV_REST_API_URL)
  const suffixPairs: Array<[string, string]> = [
    ['_UPSTASH_REDIS_REST_URL', '_UPSTASH_REDIS_REST_TOKEN'],
    ['_KV_REST_API_URL', '_KV_REST_API_TOKEN'],
    ['_REST_API_URL', '_REST_API_TOKEN'],
    ['_REST_URL', '_REST_TOKEN'],
  ];
  for (const [urlSuffix, tokenSuffix] of suffixPairs) {
    for (const [envKey, envVal] of Object.entries(process.env)) {
      if (!envKey.endsWith(urlSuffix)) continue;
      const prefix = envKey.slice(0, -urlSuffix.length);
      if (!prefix) continue;
      const tokenKey = `${prefix}${tokenSuffix}`;
      const url = normalizeSecretEnvValue(envVal, envKey);
      const token = normalizeSecretEnvValue(process.env[tokenKey], tokenKey);
      if (url && token && isValidHttpUrl(url)) {
        return {
          config: { url: url.replace(/\/+$/, ''), token },
          source: 'rest',
          matchedKeys: [envKey, tokenKey],
        };
      }
    }
  }

  // 3. Upstash Redis TLS/TCP URL (REDIS_URL, KV_URL, UPSTASH_REDIS_URL, <PREFIX>_REDIS_URL, <PREFIX>_KV_URL)
  const redisUrlCandidates: string[] = ['UPSTASH_REDIS_URL', 'REDIS_URL', 'KV_URL'];
  for (const envKey of Object.keys(process.env)) {
    if (
      !redisUrlCandidates.includes(envKey) &&
      (envKey.endsWith('_REDIS_URL') || envKey.endsWith('_KV_URL'))
    ) {
      redisUrlCandidates.push(envKey);
    }
  }

  for (const key of redisUrlCandidates) {
    const raw = process.env[key];
    if (!raw) continue;
    const derived = parseUpstashRedisConnectionUrl(raw);
    if (derived) {
      return {
        config: derived,
        source: 'redis_url',
        matchedKeys: [key],
      };
    }
  }

  return { config: null, source: null, matchedKeys: [] };
}

function getUpstashConfig(): { url: string; token: string } | null {
  return resolveUpstashMatch().config;
}

export function inspectStorageEnvDetection(): StorageEnvDetection {
  const blobMatch = resolveBlobTokenMatch();
  const upstashMatch = resolveUpstashMatch();
  const matchedEnvKeys: string[] = [];
  if (blobMatch.key) matchedEnvKeys.push(blobMatch.key);
  matchedEnvKeys.push(...upstashMatch.matchedKeys);

  return {
    vercelDetected: isVercelRuntime(),
    configuredDriver: resolveConfiguredStorageDriverPreference(),
    blobAccess: resolveVercelBlobAccess(),
    blobTokenDetected: Boolean(blobMatch.token),
    blobTokenFormatValid: blobMatch.valid,
    blobApiUrlOverrideSet: Boolean(stripSurroundingQuotes(process.env.VERCEL_BLOB_API_URL)),
    upstashRestDetected: upstashMatch.source === 'rest',
    upstashUrlDetected: upstashMatch.source === 'redis_url',
    matchedEnvKeys,
  };
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
  readonly backend = 'local-json' as const;
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

  async verifyReadWrite(): Promise<StorageVerificationResult> {
    let readable = false;
    let writable = false;
    try {
      await this.ensureDirs();
      await this.readCollection('settings');
      readable = true;

      const probePath = path.join(this.dataDir, '.storage-health-probe.json');
      const tmpProbe = path.join(
        this.dataDir,
        `.storage-health-probe.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
      );
      const nonce = crypto.randomBytes(8).toString('hex');
      const payload = JSON.stringify(
        {
          service: 'thegrid',
          mode: 'local_json',
          nonce,
          checkedAt: new Date().toISOString(),
        },
        null,
        2
      );
      await fsp.writeFile(tmpProbe, payload, 'utf8');
      await fsp.rename(tmpProbe, probePath);

      const roundTripRaw = await fsp.readFile(probePath, 'utf8');
      const roundTrip = JSON.parse(roundTripRaw) as { nonce?: string };
      if (roundTrip.nonce !== nonce) {
        return {
          readable,
          writable: false,
          accessMode: 'local',
          error: 'Local JSON probe read-back mismatch.',
        };
      }
      writable = true;
      return {
        readable,
        writable,
        accessMode: 'local',
        error: null,
      };
    } catch (err) {
      return {
        readable,
        writable,
        accessMode: 'local',
        error: sanitizeStorageError(err),
      };
    }
  }
}

/**
 * Vercel Blob JSON Driver:
 * Stores PRIVATE JSON documents in Vercel Blob Storage (`thegrid/data/<collection>.json`)
 * with `access: 'private'`, origin reads (`useCache: false`), and ETag optimistic concurrency (`ifMatch`).
 * Never exposes private booking, customer, admin, or inventory data via public Blob URLs.
 */
export class VercelBlobJsonDriver implements JsonStorageDriver {
  readonly mode = 'vercel_blob' as const;
  readonly backend: 'vercel-blob-private' | 'vercel-blob-public';
  readonly persistent = true;
  private readonly token: string;
  private readonly access: 'private' | 'public';
  private readonly upstash: { url: string; token: string } | null;

  constructor(token: string, access: 'private' | 'public' = resolveVercelBlobAccess()) {
    this.token = token;
    this.access = access;
    this.backend = access === 'private' ? 'vercel-blob-private' : 'vercel-blob-public';
    this.upstash = getUpstashConfig();
  }

  private pathname(name: CollectionName): string {
    return `thegrid/data/${name}.json`;
  }

  private backupPathname(name: CollectionName): string {
    return `thegrid/backups/${name}-latest.json`;
  }

  private healthProbePathname(): string {
    return 'thegrid/system/health-probe.json';
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

  private isConfigurationFailure(err: unknown): boolean {
    if (
      err instanceof BlobAccessError ||
      err instanceof BlobStoreNotFoundError ||
      err instanceof BlobStoreSuspendedError ||
      err instanceof BlobClientTokenExpiredError
    ) {
      return true;
    }
    const msg = err instanceof Error ? err.message.toLowerCase() : '';
    return (
      msg.includes('public access') ||
      msg.includes('private access') ||
      msg.includes('public store') ||
      msg.includes('private store') ||
      msg.includes('unable to extract store id') ||
      msg.includes('invalid token')
    );
  }

  private wrapStorageFailure(err: unknown): never {
    if (this.isConfigurationFailure(err)) {
      throw new StorageConfigurationError(sanitizeStorageError(err));
    }
    throw err;
  }

  /**
   * Reads a JSON blob using `@vercel/blob` `get` with explicit `access` + Bearer auth header,
   * and falls back to `head`/`list` + authenticated `fetch` if needed so private blobs
   * never fail due to unauthenticated CDN URL assumptions.
   */
  private async readJsonBlob(
    pathname: string
  ): Promise<{ raw: string; etag: string | null; url: string } | null> {
    const target = this.getTarget(pathname);
    const authHeaders = {
      Authorization: `Bearer ${this.token}`,
    };

    try {
      const result = await blobGet(target, {
        access: this.access,
        useCache: false,
        token: this.token,
      });
      if (!result || result.statusCode !== 200 || !result.stream) {
        return null;
      }
      const raw = await new Response(result.stream).text();
      return {
        raw,
        etag: result.blob.etag || null,
        url: result.blob.url || target,
      };
    } catch (err: unknown) {
      if (err instanceof BlobNotFoundError) {
        return null;
      }
      if (this.isConfigurationFailure(err)) {
        this.wrapStorageFailure(err);
      }

      // Secondary private read via `list` / `head` + direct Bearer fetch
      try {
        let blobUrl: string | null = null;
        let blobEtag: string | null = null;
        let lookupErr: unknown = null;

        if (!process.env.VERCEL_BLOB_API_URL?.trim()) {
          try {
            const listed = await blobList({ prefix: pathname, limit: 10, token: this.token });
            const matched = listed.blobs.find((b) => b.pathname === pathname);
            if (!matched) {
              return null;
            }
            blobUrl = matched.downloadUrl || matched.url;
            blobEtag = matched.etag || null;
          } catch (listErr) {
            lookupErr = listErr;
          }
        }

        if (!blobUrl) {
          try {
            const meta = await blobHead(target, { token: this.token });
            blobUrl = meta.downloadUrl || meta.url;
            blobEtag = meta.etag || null;
          } catch (headErr) {
            if (headErr instanceof BlobNotFoundError) {
              return null;
            }
            lookupErr = lookupErr ?? headErr;
          }
        }

        if (!blobUrl) {
          const getMsg = sanitizeStorageError(err);
          const lookupMsg = lookupErr ? sanitizeStorageError(lookupErr) : 'none';
          const detail = new Error(
            `Vercel Blob read failed (get: ${getMsg}; lookup: ${lookupMsg})`
          );
          if (this.isConfigurationFailure(lookupErr) || this.isConfigurationFailure(err)) {
            throw new StorageConfigurationError(detail.message);
          }
          throw detail;
        }

        const res = await fetch(blobUrl, {
          cache: 'no-store',
          headers: authHeaders,
        });
        if (res.status === 404) {
          return null;
        }
        if (!res.ok) {
          throw new Error(`Private Vercel Blob fetch failed (${res.status}).`);
        }
        const raw = await res.text();
        return {
          raw,
          etag: res.headers.get('etag') || blobEtag,
          url: blobUrl,
        };
      } catch (fallbackErr) {
        if (fallbackErr instanceof BlobNotFoundError) {
          return null;
        }
        this.wrapStorageFailure(fallbackErr);
      }
    }
  }

  private async writeJsonBlob(
    pathname: string,
    serialized: string,
    options?: { allowOverwrite?: boolean; ifMatch?: string }
  ) {
    return blobPut(pathname, serialized, {
      access: this.access,
      addRandomSuffix: false,
      allowOverwrite: options?.allowOverwrite ?? true,
      contentType: 'application/json',
      token: this.token,
      ...(options?.ifMatch ? { ifMatch: options.ifMatch } : {}),
    });
  }

  async readCollection<K extends CollectionName>(
    name: K
  ): Promise<ReadCollectionResult<K>> {
    const primary = await this.readJsonBlob(this.pathname(name));
    if (!primary) {
      return {
        data: createDefaultCollection(name),
        version: null,
        exists: false,
      };
    }

    const primaryEtag = primary.etag;
    try {
      const parsed = JSON.parse(primary.raw) as unknown;
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
      const backup = await this.readJsonBlob(this.backupPathname(name));
      if (backup) {
        const backupParsed = JSON.parse(backup.raw) as unknown;
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

    throw new Error(`Invalid JSON schema in private Vercel Blob for "${name}".`);
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
      const putResult = await this.writeJsonBlob(
        this.pathname(name),
        serialized,
        expectedVersion
          ? { allowOverwrite: true, ifMatch: expectedVersion }
          : { allowOverwrite: false }
      );

      if (!options?.skipBackup && data.revision > 0) {
        await this.writeJsonBlob(this.backupPathname(name), serialized, {
          allowOverwrite: true,
        }).catch(() => undefined);
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
      this.wrapStorageFailure(err);
    }
  }

  async verifyReadWrite(): Promise<StorageVerificationResult> {
    let readable = false;
    let writable = false;
    try {
      await this.readCollection('settings');
      readable = true;

      const probePath = this.healthProbePathname();
      let currentEtag: string | null = null;
      let previousCheckedAt: string | null = null;

      const existing = await this.readJsonBlob(probePath);
      if (existing) {
        currentEtag = existing.etag;
        if (existing.raw) {
          const parsedPrev = JSON.parse(existing.raw) as { checkedAt?: string };
          previousCheckedAt = typeof parsedPrev.checkedAt === 'string' ? parsedPrev.checkedAt : null;
        }
      }

      const nonce = crypto.randomBytes(8).toString('hex');
      const checkedAt = new Date().toISOString();
      const probePayload = JSON.stringify(
        {
          service: 'thegrid',
          mode: 'vercel_blob',
          access: this.access,
          nonce,
          checkedAt,
          previousCheckedAt,
        },
        null,
        2
      );

      try {
        await this.writeJsonBlob(
          probePath,
          probePayload,
          currentEtag
            ? { allowOverwrite: true, ifMatch: currentEtag }
            : { allowOverwrite: false }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message.toLowerCase() : '';
        const isRace =
          err instanceof BlobPreconditionFailedError ||
          msg.includes('already exists') ||
          msg.includes('overwrite') ||
          msg.includes('412') ||
          msg.includes('409');
        if (!isRace) throw err;

        // Retry overwrite on concurrent health check without polluting domain ETag integrity
        await this.writeJsonBlob(probePath, probePayload, { allowOverwrite: true });
      }

      const verifyReadBack = await this.readJsonBlob(probePath);
      if (!verifyReadBack) {
        return {
          readable,
          writable: false,
          accessMode: this.access,
          error: 'Private Vercel Blob probe write could not be read back.',
        };
      }
      const roundTrip = JSON.parse(verifyReadBack.raw) as { nonce?: string; access?: string };
      if (roundTrip.nonce !== nonce || roundTrip.access !== this.access) {
        return {
          readable,
          writable: false,
          accessMode: this.access,
          error: 'Private Vercel Blob probe verification payload mismatch.',
        };
      }

      writable = true;
      return {
        readable,
        writable,
        accessMode: this.access,
        error: null,
      };
    } catch (err) {
      return {
        readable,
        writable,
        accessMode: this.access,
        error: sanitizeStorageError(err),
      };
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
      await this.writeJsonBlob(lockPath, payload, { allowOverwrite: false });
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
        this.wrapStorageFailure(err);
      }

      // Check if an existing lock has expired (e.g. crashed Lambda container)
      try {
        const existing = await this.readJsonBlob(lockPath);
        if (!existing) {
          return null;
        }
        const existingBody = JSON.parse(existing.raw) as {
          expiresAt?: number;
        };
        if (typeof existingBody.expiresAt === 'number' && Date.now() > existingBody.expiresAt) {
          await this.writeJsonBlob(lockPath, payload, {
            allowOverwrite: true,
            ...(existing.etag ? { ifMatch: existing.etag } : {}),
          });
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
      const existing = await this.readJsonBlob(lockPath);
      if (!existing) {
        return;
      }
      const existingBody = JSON.parse(existing.raw) as {
        token?: string;
      };
      if (existingBody.token === lockToken) {
        const deleteTarget =
          process.env.VERCEL_BLOB_API_URL?.trim()
            ? existing.url || this.getTarget(lockPath)
            : lockPath;
        await blobDel(deleteTarget, { token: this.token }).catch(() => undefined);
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
  readonly backend = 'upstash-redis' as const;
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

  async verifyReadWrite(): Promise<StorageVerificationResult> {
    let readable = false;
    let writable = false;
    try {
      await this.readCollection('settings');
      readable = true;

      const probeKey = 'thegrid:system:health-probe.json';
      const nonce = crypto.randomBytes(8).toString('hex');
      const payload = JSON.stringify({
        service: 'thegrid',
        mode: 'upstash_redis',
        nonce,
        checkedAt: new Date().toISOString(),
      });
      await this.command(['SET', probeKey, payload]);
      const readBack = await this.command<string | null>(['GET', probeKey]);
      const parsed = readBack ? (JSON.parse(readBack) as { nonce?: string }) : null;
      if (!parsed || parsed.nonce !== nonce) {
        return {
          readable,
          writable: false,
          accessMode: 'redis',
          error: 'Upstash Redis probe read-back verification failed.',
        };
      }
      writable = true;
      return { readable, writable, accessMode: 'redis', error: null };
    } catch (err) {
      return {
        readable,
        writable,
        accessMode: 'redis',
        error: sanitizeStorageError(err),
      };
    }
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
  readonly backend = 'unconfigured-vercel' as const;
  readonly persistent = false;
  readonly reason: string;

  constructor(reason = new StorageConfigurationError().message) {
    this.reason = reason;
  }

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
    throw new StorageConfigurationError(this.reason);
  }

  async verifyReadWrite(): Promise<StorageVerificationResult> {
    return {
      readable: false,
      writable: false,
      accessMode: 'unconfigured',
      error: this.reason,
    };
  }
}

export function createFallbackUpstashDriverIfConfigured(): UpstashRedisJsonDriver | null {
  const upstash = getUpstashConfig();
  return upstash ? new UpstashRedisJsonDriver(upstash) : null;
}

export function createConfiguredStorageDriver(): JsonStorageDriver {
  const blobMatch = resolveBlobTokenMatch();
  const validBlobToken = blobMatch.valid ? blobMatch.token : '';
  const blobAccess = resolveVercelBlobAccess();
  const upstash = getUpstashConfig();
  const preferredDriver = resolveConfiguredStorageDriverPreference();
  const onVercel = isVercelRuntime();
  const invalidBlobReason =
    blobMatch.token && !blobMatch.valid
      ? 'BLOB_READ_WRITE_TOKEN format is invalid. Copy the full vercel_blob_rw_... token from your Private Vercel Blob Store in Vercel and redeploy.'
      : undefined;

  if (preferredDriver === 'redis') {
    if (upstash) {
      return new UpstashRedisJsonDriver(upstash);
    }
    if (validBlobToken) {
      return new VercelBlobJsonDriver(validBlobToken, blobAccess);
    }
    if (onVercel) {
      return new UnconfiguredVercelDriver(invalidBlobReason);
    }
  }

  if (preferredDriver === 'blob') {
    if (validBlobToken) {
      return new VercelBlobJsonDriver(validBlobToken, blobAccess);
    }
    if (upstash) {
      console.warn(
        '[storage] BLOB_READ_WRITE_TOKEN is missing or invalid; routing persistent storage to Upstash Redis.'
      );
      return new UpstashRedisJsonDriver(upstash);
    }
    if (onVercel) {
      return new UnconfiguredVercelDriver(invalidBlobReason);
    }
    console.warn(
      '[storage] BLOB_READ_WRITE_TOKEN is missing or invalid outside Vercel; falling back to local JSON storage.'
    );
    return new LocalJsonFileDriver(resolveLocalDataDir());
  }

  if (onVercel) {
    if (validBlobToken) {
      return new VercelBlobJsonDriver(validBlobToken, blobAccess);
    }
    if (upstash) {
      return new UpstashRedisJsonDriver(upstash);
    }
    return new UnconfiguredVercelDriver(invalidBlobReason);
  }

  return new LocalJsonFileDriver(resolveLocalDataDir());
}
