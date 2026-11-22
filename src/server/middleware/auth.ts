import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getDb } from '../db/sqlite.ts';
import { verifyTotpCode } from '../utils/totp.ts';

export const SESSION_COOKIE_NAME = 'thegrid_admin_session';
const DEFAULT_SESSION_TTL_MINUTES = 240; // 4 hours
const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;

let cachedFallbackSecret: string | null = null;
const DUMMY_PASSWORD_HASH = hashPassword('THEGRID-dummy-timing-guard-2026!');

export interface AdminUserRow {
  id: number;
  username: string;
  display_name: string;
  role: 'SUPER_ADMIN' | 'ADMIN';
  password_hash: string;
  mfa_enabled: number;
  mfa_secret: string | null;
  is_active: number;
  created_at: string;
  last_login_at: string | null;
}

export interface AdminSessionContext {
  sessionId: string;
  adminUserId: number | null;
  username: string;
  displayName: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'LEGACY_SHARED';
  mfaEnabled: boolean;
  expiresAt: number;
}

declare global {
  namespace Express {
    interface Request {
      adminSession?: AdminSessionContext;
    }
  }
}

export function getSessionTtlMinutes(): number {
  const parsed = Number(process.env.ADMIN_SESSION_TTL_MINUTES);
  if (Number.isFinite(parsed) && parsed >= 5 && parsed <= 1440) {
    return Math.floor(parsed);
  }
  return DEFAULT_SESSION_TTL_MINUTES;
}

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

export function normalizeAdminUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateAdminUsername(raw: string): string | null {
  const username = normalizeAdminUsername(raw);
  if (username.length < 3 || username.length > 64) {
    return 'Username must be between 3 and 64 characters.';
  }
  if (!/^[a-z0-9][a-z0-9._@-]*$/.test(username)) {
    return 'Username may only use lowercase letters, numbers, dots, underscores, hyphens, or @.';
  }
  return null;
}

export function validateStrongPassword(password: string): string | null {
  if (password.length < 10 || password.length > 128) {
    return 'Password must be between 10 and 128 characters.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter.';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must contain at least one lowercase letter.';
  }
  if (!/\d/.test(password)) {
    return 'Password must contain at least one number.';
  }
  if (!/[^A-Za-z0-9\s]/.test(password)) {
    return 'Password must contain at least one symbol (e.g. !@#$%).';
  }
  return null;
}

export function getAdminAuthOverview(): {
  setupRequired: boolean;
  authMode: 'named_accounts' | 'legacy_passcode_fallback' | 'setup_required';
  hasNamedAccounts: boolean;
  hasLegacyPasscode: boolean;
} {
  const db = getDb();
  const namedCount = db
    .prepare('SELECT COUNT(*) AS count FROM admin_users WHERE is_active = 1')
    .get() as { count: number };
  const hasNamedAccounts = namedCount.count > 0;

  const envPass = process.env.ADMIN_PASSCODE?.trim() ?? '';
  const legacyClaimed = db
    .prepare('SELECT id FROM admin_credentials WHERE id = 1')
    .get() as { id: number } | undefined;
  const hasLegacyPasscode = envPass.length > 0 || Boolean(legacyClaimed);

  if (hasNamedAccounts) {
    return {
      setupRequired: false,
      authMode: 'named_accounts',
      hasNamedAccounts: true,
      hasLegacyPasscode,
    };
  }

  if (hasLegacyPasscode) {
    return {
      setupRequired: false,
      authMode: 'legacy_passcode_fallback',
      hasNamedAccounts: false,
      hasLegacyPasscode: true,
    };
  }

  return {
    setupRequired: true,
    authMode: 'setup_required',
    hasNamedAccounts: false,
    hasLegacyPasscode: false,
  };
}

function constantTimeStringMatch(aStr: string, bStr: string): boolean {
  const aHash = crypto.createHash('sha256').update(aStr).digest();
  const bHash = crypto.createHash('sha256').update(bStr).digest();
  return crypto.timingSafeEqual(aHash, bHash);
}

export function authenticateAdminCredentials(
  rawUsername: string,
  secretInput: string
):
  | {
      ok: true;
      user:
        | {
            kind: 'named';
            row: AdminUserRow;
          }
        | {
            kind: 'legacy_shared';
          };
    }
  | { ok: false } {
  const db = getDb();
  const username = normalizeAdminUsername(rawUsername);

  if (!secretInput) {
    verifyPassword('invalid-probe', DUMMY_PASSWORD_HASH);
    return { ok: false };
  }

  if (username.length > 0) {
    const userRow = db
      .prepare('SELECT * FROM admin_users WHERE username = ? AND is_active = 1')
      .get(username) as unknown as AdminUserRow | undefined;

    if (userRow) {
      if (verifyPassword(secretInput, userRow.password_hash)) {
        return { ok: true, user: { kind: 'named', row: userRow } };
      }
      return { ok: false };
    }
  }

  // Constant-time dummy work so unknown usernames have identical response timing
  verifyPassword(secretInput, DUMMY_PASSWORD_HASH);

  // Only allow legacy shared passcode fallback when no named accounts exist yet,
  // or when env ADMIN_PASSCODE is explicitly configured and username is empty/admin.
  const overview = getAdminAuthOverview();
  if (!overview.hasNamedAccounts) {
    const envPass = process.env.ADMIN_PASSCODE?.trim() ?? '';
    if (envPass.length > 0 && constantTimeStringMatch(secretInput, envPass)) {
      return { ok: true, user: { kind: 'legacy_shared' } };
    }

    const legacyRow = db
      .prepare('SELECT password_hash FROM admin_credentials WHERE id = 1')
      .get() as { password_hash: string } | undefined;
    if (legacyRow && verifyPassword(secretInput, legacyRow.password_hash)) {
      return { ok: true, user: { kind: 'legacy_shared' } };
    }
  }

  return { ok: false };
}

function signPayload(payloadObject: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(payloadObject), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function verifySignedPayload<T>(token: string): T | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;

  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

export function issueMfaChallengeToken(userId: number): string {
  return signPayload({
    typ: 'mfa_challenge',
    uid: userId,
    exp: Date.now() + MFA_CHALLENGE_TTL_MS,
    nonce: crypto.randomBytes(8).toString('hex'),
  });
}

export function verifyMfaChallengeToken(token: string): number | null {
  const parsed = verifySignedPayload<{ typ?: string; uid?: number; exp?: number }>(token);
  if (!parsed || parsed.typ !== 'mfa_challenge') return null;
  if (typeof parsed.uid !== 'number' || typeof parsed.exp !== 'number') return null;
  if (Date.now() > parsed.exp) return null;
  return parsed.uid;
}

export function verifyUserMfaCode(userId: number, code: string): AdminUserRow | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM admin_users WHERE id = ? AND is_active = 1 AND mfa_enabled = 1')
    .get(userId) as unknown as AdminUserRow | undefined;
  if (!row || !row.mfa_secret) return null;
  if (!verifyTotpCode(row.mfa_secret, code)) return null;
  return row;
}

export function createAdminSession(input: {
  adminUserId: number | null;
  username: string;
  displayName: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'LEGACY_SHARED';
}): { token: string; sessionId: string; expiresAt: number } {
  const db = getDb();
  const ttlMs = getSessionTtlMinutes() * 60 * 1000;
  const expiresAt = Date.now() + ttlMs;
  const sessionId = crypto.randomBytes(16).toString('hex');
  const nowIso = new Date().toISOString();

  // Prune old expired sessions quietly
  db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(Date.now() - 86_400_000);

  db.prepare(
    `INSERT INTO admin_sessions (id, admin_user_id, username, display_name, role, expires_at, created_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
  ).run(
    sessionId,
    input.adminUserId,
    input.username,
    input.displayName,
    input.role,
    expiresAt,
    nowIso
  );

  const token = signPayload({
    typ: 'admin_session',
    sid: sessionId,
    exp: expiresAt,
    role: input.role,
  });

  return { token, sessionId, expiresAt };
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) continue;
    const name = part.slice(0, eqIndex).trim();
    const rawVal = part.slice(eqIndex + 1).trim();
    if (!name) continue;
    try {
      result[name] = decodeURIComponent(rawVal);
    } catch {
      result[name] = rawVal;
    }
  }
  return result;
}

function getCookieSecurityFlags(req: Request): string {
  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  const isHttps = req.secure || forwardedProto === 'https';
  const host = (req.get('x-forwarded-host') || req.get('host') || '').toLowerCase();
  const isEmbeddedIframe =
    isHttps && (host.includes('.run.app') || req.get('sec-fetch-dest') === 'iframe');

  if (isEmbeddedIframe) {
    return 'HttpOnly; Path=/; Secure; SameSite=None; Partitioned';
  }
  if (isHttps) {
    return 'HttpOnly; Path=/; Secure; SameSite=Lax';
  }
  return 'HttpOnly; Path=/; SameSite=Lax';
}

export function setAdminSessionCookie(
  req: Request,
  res: Response,
  token: string,
  expiresAt: number
): void {
  const maxAgeSeconds = Math.max(1, Math.floor((expiresAt - Date.now()) / 1000));
  const flags = getCookieSecurityFlags(req);
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; ${flags}`
  );
}

export function clearAdminSessionCookie(req: Request, res: Response): void {
  const flags = getCookieSecurityFlags(req);
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; ${flags}`
  );
}

export function verifyAdminSessionToken(token: string): AdminSessionContext | null {
  const parsed = verifySignedPayload<{
    typ?: string;
    sid?: string;
    exp?: number;
  }>(token);
  if (!parsed || parsed.typ !== 'admin_session' || !parsed.sid || typeof parsed.exp !== 'number') {
    return null;
  }
  if (Date.now() > parsed.exp) {
    return null;
  }

  const db = getDb();
  const sessionRow = db
    .prepare(
      `SELECT id, admin_user_id, username, display_name, role, expires_at, revoked_at
       FROM admin_sessions WHERE id = ?`
    )
    .get(parsed.sid) as
    | {
        id: string;
        admin_user_id: number | null;
        username: string;
        display_name: string;
        role: 'SUPER_ADMIN' | 'ADMIN' | 'LEGACY_SHARED';
        expires_at: number;
        revoked_at: string | null;
      }
    | undefined;

  if (!sessionRow || sessionRow.revoked_at || Date.now() > sessionRow.expires_at) {
    return null;
  }

  let mfaEnabled = false;
  if (sessionRow.admin_user_id !== null) {
    const userRow = db
      .prepare('SELECT mfa_enabled, is_active FROM admin_users WHERE id = ?')
      .get(sessionRow.admin_user_id) as { mfa_enabled: number; is_active: number } | undefined;
    if (!userRow || userRow.is_active !== 1) {
      return null;
    }
    mfaEnabled = userRow.mfa_enabled === 1;
  }

  return {
    sessionId: sessionRow.id,
    adminUserId: sessionRow.admin_user_id,
    username: sessionRow.username,
    displayName: sessionRow.display_name,
    role: sessionRow.role,
    mfaEnabled,
    expiresAt: sessionRow.expires_at,
  };
}

export function getAdminSessionFromRequest(req: Request): AdminSessionContext | null {
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  if (!cookieToken) return null;
  return verifyAdminSessionToken(cookieToken);
}

export function revokeAdminSessionFromRequest(req: Request): void {
  const session = getAdminSessionFromRequest(req);
  if (!session) return;
  const db = getDb();
  db.prepare('UPDATE admin_sessions SET revoked_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    session.sessionId
  );
}

export function requireSameOriginForCookieMutation(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    next();
    return;
  }

  const host = (req.get('x-forwarded-host') || req.get('host') || '').toLowerCase();
  const origin = req.get('origin');
  const referer = req.get('referer');

  if (origin) {
    try {
      const originHost = new URL(origin).host.toLowerCase();
      if (host && originHost !== host) {
        res.status(403).json({ error: 'Forbidden: Cross-origin request rejected.' });
        return;
      }
    } catch {
      res.status(403).json({ error: 'Forbidden: Invalid request origin.' });
      return;
    }
    next();
    return;
  }

  if (referer) {
    try {
      const refHost = new URL(referer).host.toLowerCase();
      if (host && refHost !== host) {
        res.status(403).json({ error: 'Forbidden: Cross-origin referer rejected.' });
        return;
      }
      next();
      return;
    } catch {
      res.status(403).json({ error: 'Forbidden: Invalid referer header.' });
      return;
    }
  }

  if (req.get('x-requested-with') === 'XMLHttpRequest') {
    next();
    return;
  }

  res.status(403).json({ error: 'Forbidden: Missing same-origin verification header.' });
}

export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const session = getAdminSessionFromRequest(req);
  if (!session) {
    clearAdminSessionCookie(req, res);
    res.status(401).json({
      error: 'Admin session expired or invalid. Please sign in again.',
      code: 'SESSION_EXPIRED',
    });
    return;
  }
  req.adminSession = session;
  next();
}
