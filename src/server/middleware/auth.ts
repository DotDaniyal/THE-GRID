import crypto from 'node:crypto';
import argon2 from 'argon2';
import type { NextFunction, Request, Response } from 'express';
import { getDb } from '../db/sqlite.ts';
import { verifyTotpCode } from '../utils/totp.ts';

export const SESSION_COOKIE_NAME = 'thegrid_admin_session';
const DEFAULT_SESSION_TTL_MINUTES = 240; // 4 hours
const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;

let cachedFallbackSecret: string | null = null;
const DUMMY_PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$dummySaltySaltDataHere$dummyHashValueDataHerePlaceholder...';

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
  adminUserId: number;
  username: string;
  displayName: string;
  role: 'SUPER_ADMIN' | 'ADMIN';
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

export async function hashPassword(password: string): Promise<string> {
  return await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash) return false;
  try {
    return await argon2.verify(storedHash, password);
  } catch {
    return false;
  }
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
  if (password.length < 6 || password.length > 128) {
    return 'Password must be at least 6 characters.';
  }
  return null;
}

export function getAdminAuthOverview(): {
  setupRequired: boolean;
  authMode: 'named_accounts' | 'setup_required';
  hasNamedAccounts: boolean;
} {
  const db = getDb();
  const namedCount = db
    .prepare('SELECT COUNT(*) AS count FROM admin_users WHERE is_active = 1')
    .get() as { count: number };
  const hasNamedAccounts = namedCount.count > 0;

  if (hasNamedAccounts) {
    return {
      setupRequired: false,
      authMode: 'named_accounts',
      hasNamedAccounts: true,
    };
  }

  return {
    setupRequired: true,
    authMode: 'setup_required',
    hasNamedAccounts: false,
  };
}

export async function authenticateAdminCredentials(
  rawUsername: string,
  secretInput: string
): Promise<{ ok: true; user: AdminUserRow } | { ok: false }> {
  const db = getDb();
  const username = normalizeAdminUsername(rawUsername);

  if (!username || !secretInput) {
    await verifyPassword('invalid-probe', DUMMY_PASSWORD_HASH).catch(() => false);
    return { ok: false };
  }

  const userRow = db
    .prepare('SELECT * FROM admin_users WHERE username = ? AND is_active = 1')
    .get(username) as unknown as AdminUserRow | undefined;

  if (userRow) {
    const isValid = await verifyPassword(secretInput, userRow.password_hash);
    if (isValid) {
      return { ok: true, user: userRow };
    }
    return { ok: false };
  }

  // Constant-time dummy work so unknown usernames have identical response timing
  await verifyPassword(secretInput, DUMMY_PASSWORD_HASH).catch(() => false);
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
  adminUserId: number;
  username: string;
  displayName: string;
  role: 'SUPER_ADMIN' | 'ADMIN';
}): { token: string; sessionId: string; expiresAt: number } {
  const db = getDb();
  const ttlMs = getSessionTtlMinutes() * 60 * 1000;
  const expiresAt = Date.now() + ttlMs;
  const sessionId = crypto.randomBytes(16).toString('hex');
  const nowIso = new Date().toISOString();

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
  const origin = (req.get('origin') || '').toLowerCase();
  const referer = (req.get('referer') || '').toLowerCase();
  const isHttps =
    req.secure ||
    forwardedProto === 'https' ||
    origin.startsWith('https://') ||
    referer.startsWith('https://');

  const host = (req.get('x-forwarded-host') || req.get('host') || '').toLowerCase();
  const appUrl = (process.env.APP_URL || '').toLowerCase();
  const secFetchSite = (req.get('sec-fetch-site') || '').toLowerCase();
  const isEmbeddedIframe =
    isHttps &&
    (host.includes('.run.app') ||
      origin.includes('.run.app') ||
      appUrl.includes('.run.app') ||
      req.get('sec-fetch-dest') === 'iframe' ||
      secFetchSite === 'cross-site');

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
        role: 'SUPER_ADMIN' | 'ADMIN';
        expires_at: number;
        revoked_at: string | null;
      }
    | undefined;

  if (!sessionRow || sessionRow.revoked_at || Date.now() > sessionRow.expires_at || sessionRow.admin_user_id === null) {
    return null;
  }

  const userRow = db
    .prepare('SELECT mfa_enabled, is_active FROM admin_users WHERE id = ?')
    .get(sessionRow.admin_user_id) as { mfa_enabled: number; is_active: number } | undefined;
  if (!userRow || userRow.is_active !== 1) {
    return null;
  }

  return {
    sessionId: sessionRow.id,
    adminUserId: sessionRow.admin_user_id,
    username: sessionRow.username,
    displayName: sessionRow.display_name,
    role: sessionRow.role,
    mfaEnabled: userRow.mfa_enabled === 1,
    expiresAt: sessionRow.expires_at,
  };
}

export function getAdminSessionFromRequest(req: Request): AdminSessionContext | null {
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  if (cookieToken) {
    const cookieSession = verifyAdminSessionToken(cookieToken);
    if (cookieSession) return cookieSession;
  }

  const authHeader = req.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const bearerToken = authHeader.slice(7).trim();
    if (bearerToken) {
      return verifyAdminSessionToken(bearerToken);
    }
  }

  return null;
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
  let appUrlHost = '';
  if (process.env.APP_URL) {
    try {
      appUrlHost = new URL(process.env.APP_URL).host.toLowerCase();
    } catch {
      appUrlHost = '';
    }
  }
  const isAllowedHost = (candidateHost: string): boolean => {
    if (!host && !appUrlHost) return true;
    return candidateHost === host || (Boolean(appUrlHost) && candidateHost === appUrlHost);
  };

  const origin = req.get('origin');
  const referer = req.get('referer');

  if (origin) {
    try {
      const originHost = new URL(origin).host.toLowerCase();
      if (!isAllowedHost(originHost)) {
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
      if (!isAllowedHost(refHost)) {
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
