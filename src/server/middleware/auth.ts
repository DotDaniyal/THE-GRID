import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/sqlite.ts';

const TOKEN_TTL_MS = 1000 * 60 * 60 * 12;
let cachedFallbackSecret: string | null = null;

function getSessionSecret(): string {
  const envSecret = process.env.SESSION_SECRET?.trim();
  if (envSecret && envSecret.length >= 16) {
    return envSecret;
  }

  const envPass = process.env.ADMIN_PASSCODE?.trim();
  if (envPass && envPass.length > 0) {
    return crypto
      .createHmac('sha256', 'thegrid-admin-session-key-v1')
      .update(envPass)
      .digest('hex');
  }

  if (cachedFallbackSecret) {
    return cachedFallbackSecret;
  }

  try {
    const db = getDb();
    const row = db
      .prepare("SELECT value FROM app_meta WHERE key = 'session_secret'")
      .get() as { value: string } | undefined;
    if (row?.value) {
      cachedFallbackSecret = row.value;
      return row.value;
    }

    const generated = crypto.randomBytes(32).toString('hex');
    db.prepare(
      "INSERT OR IGNORE INTO app_meta (key, value) VALUES ('session_secret', ?)"
    ).run(generated);
    const stored = db
      .prepare("SELECT value FROM app_meta WHERE key = 'session_secret'")
      .get() as { value: string } | undefined;
    cachedFallbackSecret = stored?.value || generated;
    return cachedFallbackSecret;
  } catch {
    cachedFallbackSecret = crypto.randomBytes(32).toString('hex');
    return cachedFallbackSecret;
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, hexHash] = parts;
  if (!salt || !hexHash) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(hexHash, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

export function getAdminAuthMode(): {
  hasEnvPasscode: boolean;
  hasClaimedPasscode: boolean;
  setupRequired: boolean;
} {
  const envPass = process.env.ADMIN_PASSCODE?.trim() ?? '';
  if (envPass.length > 0) {
    return {
      hasEnvPasscode: true,
      hasClaimedPasscode: false,
      setupRequired: false,
    };
  }
  const db = getDb();
  const row = db
    .prepare('SELECT id FROM admin_credentials WHERE id = 1')
    .get() as { id: number } | undefined;
  return {
    hasEnvPasscode: false,
    hasClaimedPasscode: Boolean(row),
    setupRequired: !row,
  };
}

export function verifyAdminPasscode(candidate: string): boolean {
  const envPass = process.env.ADMIN_PASSCODE?.trim() ?? '';
  if (envPass.length > 0) {
    const a = Buffer.from(candidate);
    const b = Buffer.from(envPass);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
  const db = getDb();
  const row = db
    .prepare('SELECT password_hash FROM admin_credentials WHERE id = 1')
    .get() as { password_hash: string } | undefined;
  if (!row) return false;
  return verifyPassword(candidate, row.password_hash);
}

export function issueAdminToken(): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const nonce = crypto.randomBytes(12).toString('hex');
  const payload = Buffer.from(
    JSON.stringify({ role: 'admin', exp: expiresAt, nonce }),
    'utf8'
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest('base64url');
  return { token: `${payload}.${sig}`, expiresAt };
}

export function verifyAdminToken(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  if (!payload || !sig) return false;

  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      role?: string;
      exp?: number;
    };
    if (parsed.role !== 'admin') return false;
    if (typeof parsed.exp !== 'number' || Date.now() > parsed.exp) return false;
    return true;
  } catch {
    return false;
  }
}

export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: Admin Bearer token required.' });
    return;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!verifyAdminToken(token)) {
    res.status(401).json({ error: 'Unauthorized: Invalid or expired admin session.' });
    return;
  }
  next();
}
