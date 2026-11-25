import crypto from 'node:crypto';
import argon2 from 'argon2';
import type { NextFunction, Request, Response } from 'express';
import { getStorageStatus, readCollection, updateCollection } from '../storage/jsonStore.ts';
import type {
  AdminAuditAction,
  AdminSettingsCollection,
  AdminUserRecord,
} from '../storage/types.ts';
import { verifyTotpCode } from '../utils/totp.ts';

export const SESSION_COOKIE_NAME = 'thegrid_admin_session';
const DEFAULT_SESSION_TTL_MINUTES = 240; // 4 hours
const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_AUDIT_LOGS = 500;

let cachedFallbackSecret: string | null = null;
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$dummySaltySaltDataHere$dummyHashValueDataHerePlaceholder...';

export type AdminUserRow = AdminUserRecord;

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

export function getSessionTtlMinutes(): number {
  const parsed = Number(process.env.ADMIN_SESSION_TTL_MINUTES);
  if (Number.isFinite(parsed) && parsed >= 5 && parsed <= 1440) {
    return Math.floor(parsed);
  }
  return DEFAULT_SESSION_TTL_MINUTES;
}

function getEnvAdminPasscode(): string {
  return (
    stripSurroundingQuotes(process.env.ADMIN_PASSCODE) ||
    stripSurroundingQuotes(process.env.ADMIN_PASSWORD)
  );
}

function getEnvAdminUsername(): string | null {
  const configured =
    stripSurroundingQuotes(process.env.ADMIN_USERNAME) ||
    stripSurroundingQuotes(process.env.ADMIN_USER);
  return configured ? normalizeAdminUsername(configured) : null;
}

function constantTimeStringEqual(a: string, b: string): boolean {
  const digestA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const digestB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

export function appendAuditLogOnDraft(
  draft: { auditLogs?: AdminSettingsCollection['auditLogs'] },
  entry: {
    action: AdminAuditAction;
    actor: string;
    targetId?: string | null;
    summary: string;
    createdAt?: string;
  }
): void {
  if (!Array.isArray(draft.auditLogs)) {
    draft.auditLogs = [];
  }
  draft.auditLogs.push({
    id: `AUD-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    action: entry.action,
    actor: entry.actor,
    target_id: entry.targetId ?? null,
    summary: entry.summary,
    created_at: entry.createdAt ?? new Date().toISOString(),
  });
  if (draft.auditLogs.length > MAX_AUDIT_LOGS) {
    draft.auditLogs = draft.auditLogs.slice(-MAX_AUDIT_LOGS);
  }
}

export async function recordAdminSecurityAudit(entry: {
  action: AdminAuditAction;
  actor: string;
  targetId?: string | null;
  summary: string;
}): Promise<void> {
  try {
    await updateCollection(
      'admin-settings',
      (draft) => {
        appendAuditLogOnDraft(draft, entry);
      },
      { skipBackup: true }
    );
  } catch {
    // Do not break primary auth flow if non-persistent or secondary audit fails
  }
}

async function getSessionSecret(): Promise<string> {
  const envSecret = stripSurroundingQuotes(process.env.SESSION_SECRET);
  if (envSecret.length >= 16) {
    return envSecret;
  }
  if (envSecret.length >= 8) {
    return crypto
      .createHmac('sha256', 'thegrid-admin-session-secret-v1')
      .update(envSecret)
      .digest('hex');
  }

  // Deterministic cross-container key when running on Vercel with ADMIN_PASSCODE
  const envPasscode = getEnvAdminPasscode();
  if (envPasscode) {
    return crypto
      .createHmac('sha256', 'thegrid-admin-session-secret-v1')
      .update(envPasscode)
      .digest('hex');
  }

  if (cachedFallbackSecret) {
    return cachedFallbackSecret;
  }

  const adminSettings = await readCollection('admin-settings');
  if (adminSettings.appMeta?.session_secret) {
    cachedFallbackSecret = adminSettings.appMeta.session_secret;
    return cachedFallbackSecret;
  }

  const generated = crypto.randomBytes(32).toString('hex');
  try {
    const { result: storedSecret } = await updateCollection('admin-settings', (draft) => {
      if (!draft.appMeta.session_secret) {
        draft.appMeta.session_secret = generated;
      }
      return draft.appMeta.session_secret;
    });
    if (storedSecret) {
      cachedFallbackSecret = storedSecret;
      return cachedFallbackSecret;
    }
  } catch {
    // Only return ephemeral secret for this call without permanently poisoning cache
  }
  return generated;
}

export async function hashPassword(password: string): Promise<string> {
  try {
    return await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
  } catch {
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = crypto.scryptSync(password, salt, 64).toString('hex');
    return `$scrypt2$${salt}$${derived}`;
  }
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash) return false;

  if (storedHash.startsWith('$scrypt2$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 4 || !parts[2] || !parts[3]) return false;
    try {
      const derived = crypto.scryptSync(password, parts[2], 64);
      const expected = Buffer.from(parts[3], 'hex');
      return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }

  if (/^[0-9a-f]{32}:[0-9a-f]{128}$/i.test(storedHash)) {
    const [salt, hashHex] = storedHash.split(':');
    try {
      const derived = crypto.scryptSync(password, salt, 64);
      const expected = Buffer.from(hashHex, 'hex');
      return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }

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

export async function getAdminAuthOverview(): Promise<{
  setupRequired: boolean;
  authMode: 'named_accounts' | 'legacy_passcode_fallback' | 'setup_required';
  hasNamedAccounts: boolean;
  storageConfigured: boolean;
  storageMessage: string | null;
}> {
  const storage = getStorageStatus();
  if (!storage.persistent) {
    return {
      setupRequired: false,
      authMode: getEnvAdminPasscode() ? 'legacy_passcode_fallback' : 'setup_required',
      hasNamedAccounts: false,
      storageConfigured: false,
      storageMessage:
        'Persistent external JSON storage is not configured for Vercel production. Connect Vercel Blob (BLOB_READ_WRITE_TOKEN) or Upstash Redis in Vercel Environment Variables.',
    };
  }

  let hasNamedAccounts = false;
  let storageMessage: string | null = null;
  try {
    const adminSettings = await readCollection('admin-settings');
    hasNamedAccounts = adminSettings.users.some((u) => u.is_active === 1);
  } catch (err) {
    storageMessage =
      err instanceof Error ? err.message : 'Unable to read administrator store.';
  }

  const hasEnvPasscode = Boolean(getEnvAdminPasscode());

  if (hasNamedAccounts) {
    return {
      setupRequired: false,
      authMode: 'named_accounts',
      hasNamedAccounts: true,
      storageConfigured: true,
      storageMessage,
    };
  }

  if (hasEnvPasscode) {
    return {
      setupRequired: false,
      authMode: 'legacy_passcode_fallback',
      hasNamedAccounts: false,
      storageConfigured: true,
      storageMessage,
    };
  }

  return {
    setupRequired: true,
    authMode: 'setup_required',
    hasNamedAccounts: false,
    storageConfigured: true,
    storageMessage,
  };
}

export async function authenticateAdminCredentials(
  rawUsername: string,
  secretInput: string
): Promise<{ ok: true; user: AdminUserRow } | { ok: false }> {
  const username = normalizeAdminUsername(rawUsername);

  if (!username || !secretInput) {
    await verifyPassword('invalid-probe', DUMMY_PASSWORD_HASH).catch(() => false);
    return { ok: false };
  }

  const adminSettings = await readCollection('admin-settings');
  const userRow = adminSettings.users.find(
    (u) => u.username === username && u.is_active === 1
  );

  if (userRow) {
    const isValid = await verifyPassword(secretInput, userRow.password_hash);
    if (isValid) {
      return { ok: true, user: userRow };
    }
  }

  const envPasscode = getEnvAdminPasscode();
  if (envPasscode) {
    const configuredUsername = getEnvAdminUsername();
    const allowedUsernames = configuredUsername
      ? [configuredUsername]
      : ['admin', 'admin@thegrid.pk'];

    if (allowedUsernames.includes(username) && constantTimeStringEqual(secretInput, envPasscode)) {
      return {
        ok: true,
        user: {
          id: 0,
          username,
          display_name: 'THE GRID Admin',
          role: 'SUPER_ADMIN',
          password_hash: '',
          mfa_enabled: 0,
          mfa_secret: null,
          is_active: 1,
          created_at: new Date().toISOString(),
          last_login_at: null,
        },
      };
    }
  }

  await verifyPassword(secretInput, DUMMY_PASSWORD_HASH).catch(() => false);
  return { ok: false };
}

async function signPayload(payloadObject: Record<string, unknown>): Promise<string> {
  const secret = await getSessionSecret();
  const payload = Buffer.from(JSON.stringify(payloadObject), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

async function verifySignedPayload<T>(token: string): Promise<T | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;

  const secret = await getSessionSecret();
  const expectedSig = crypto
    .createHmac('sha256', secret)
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

export async function issueMfaChallengeToken(userId: number): Promise<string> {
  return signPayload({
    typ: 'mfa_challenge',
    uid: userId,
    exp: Date.now() + MFA_CHALLENGE_TTL_MS,
    nonce: crypto.randomBytes(8).toString('hex'),
  });
}

export async function verifyMfaChallengeToken(token: string): Promise<number | null> {
  const parsed = await verifySignedPayload<{ typ?: string; uid?: number; exp?: number }>(token);
  if (!parsed || parsed.typ !== 'mfa_challenge') return null;
  if (typeof parsed.uid !== 'number' || typeof parsed.exp !== 'number') return null;
  if (Date.now() > parsed.exp) return null;
  return parsed.uid;
}

export async function verifyUserMfaCode(
  userId: number,
  code: string
): Promise<AdminUserRow | null> {
  const adminSettings = await readCollection('admin-settings');
  const row = adminSettings.users.find(
    (u) => u.id === userId && u.is_active === 1 && u.mfa_enabled === 1
  );
  if (!row || !row.mfa_secret) return null;
  if (!verifyTotpCode(row.mfa_secret, code)) return null;
  return row;
}

export async function createAdminSession(input: {
  adminUserId: number;
  username: string;
  displayName: string;
  role: 'SUPER_ADMIN' | 'ADMIN';
  mfaEnabled?: boolean;
}): Promise<{ token: string; sessionId: string; expiresAt: number }> {
  const ttlMs = getSessionTtlMinutes() * 60 * 1000;
  const expiresAt = Date.now() + ttlMs;
  const sessionId = crypto.randomBytes(16).toString('hex');
  const nowIso = new Date().toISOString();
  const pruneCutoff = Date.now() - 86_400_000;

  await updateCollection(
    'admin-settings',
    (draft) => {
      draft.sessions = draft.sessions.filter((s) => s.expires_at >= pruneCutoff);
      draft.sessions.push({
        id: sessionId,
        admin_user_id: input.adminUserId,
        username: input.username,
        display_name: input.displayName,
        role: input.role,
        expires_at: expiresAt,
        created_at: nowIso,
        revoked_at: null,
      });
    },
    { skipBackup: true }
  );

  const token = await signPayload({
    typ: 'admin_session',
    sid: sessionId,
    uid: input.adminUserId,
    usr: input.username,
    dsp: input.displayName,
    rol: input.role,
    mfa: Boolean(input.mfaEnabled),
    exp: expiresAt,
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

function getNormalizedFirstHeader(req: Request, headerName: string): string {
  const value = req.get(headerName);
  if (!value) return '';
  return value.split(',')[0]?.trim().toLowerCase() || '';
}

function getCookieSecurityFlags(req: Request): string {
  const forwardedProto = getNormalizedFirstHeader(req, 'x-forwarded-proto');
  const origin = (req.get('origin') || '').toLowerCase();
  const referer = (req.get('referer') || '').toLowerCase();
  const isHttps =
    req.secure ||
    forwardedProto === 'https' ||
    origin.startsWith('https://') ||
    referer.startsWith('https://');

  const host =
    getNormalizedFirstHeader(req, 'x-forwarded-host') || (req.get('host') || '').toLowerCase();
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

export async function verifyAdminSessionToken(
  token: string
): Promise<AdminSessionContext | null> {
  const parsed = await verifySignedPayload<{
    typ?: string;
    sid?: string;
    uid?: number;
    usr?: string;
    dsp?: string;
    rol?: 'SUPER_ADMIN' | 'ADMIN';
    mfa?: boolean;
    exp?: number;
  }>(token);
  if (!parsed || parsed.typ !== 'admin_session' || !parsed.sid || typeof parsed.exp !== 'number') {
    return null;
  }
  if (Date.now() > parsed.exp) {
    return null;
  }

  const adminSettings = await readCollection('admin-settings');
  const sessionRow = adminSettings.sessions.find((s) => s.id === parsed.sid);

  if (sessionRow) {
    if (
      sessionRow.revoked_at ||
      Date.now() > sessionRow.expires_at ||
      sessionRow.admin_user_id === null
    ) {
      return null;
    }

    if (sessionRow.admin_user_id > 0) {
      const userRow = adminSettings.users.find((u) => u.id === sessionRow.admin_user_id);
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

    return {
      sessionId: sessionRow.id,
      adminUserId: 0,
      username: sessionRow.username,
      displayName: sessionRow.display_name,
      role: sessionRow.role,
      mfaEnabled: false,
      expiresAt: sessionRow.expires_at,
    };
  }

  // Fallback for multi-container serverless setups if storage is not yet populated or partitioned
  if (
    process.env.VERCEL === '1' &&
    typeof parsed.uid === 'number' &&
    typeof parsed.usr === 'string' &&
    typeof parsed.dsp === 'string' &&
    (parsed.rol === 'SUPER_ADMIN' || parsed.rol === 'ADMIN')
  ) {
    if (parsed.uid > 0) {
      const localUser = adminSettings.users.find(
        (u) => u.id === parsed.uid && u.username === parsed.usr
      );
      if (localUser && localUser.is_active !== 1) {
        return null;
      }
      return {
        sessionId: parsed.sid,
        adminUserId: parsed.uid,
        username: parsed.usr,
        displayName: parsed.dsp,
        role: parsed.rol,
        mfaEnabled: localUser ? localUser.mfa_enabled === 1 : Boolean(parsed.mfa),
        expiresAt: parsed.exp,
      };
    }

    return {
      sessionId: parsed.sid,
      adminUserId: 0,
      username: parsed.usr,
      displayName: parsed.dsp,
      role: parsed.rol,
      mfaEnabled: false,
      expiresAt: parsed.exp,
    };
  }

  return null;
}

export async function getAdminSessionFromRequest(
  req: Request
): Promise<AdminSessionContext | null> {
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  if (cookieToken) {
    const cookieSession = await verifyAdminSessionToken(cookieToken);
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

export async function revokeAdminSessionFromRequest(req: Request): Promise<void> {
  const session = await getAdminSessionFromRequest(req);
  if (!session) return;

  const nowIso = new Date().toISOString();
  await updateCollection(
    'admin-settings',
    (draft) => {
      const existing = draft.sessions.find((s) => s.id === session.sessionId);
      if (existing) {
        existing.revoked_at = nowIso;
      } else {
        draft.sessions.push({
          id: session.sessionId,
          admin_user_id: session.adminUserId,
          username: session.username,
          display_name: session.displayName,
          role: session.role,
          expires_at: session.expiresAt,
          created_at: nowIso,
          revoked_at: nowIso,
        });
      }
    },
    { skipBackup: true }
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

  const forwardedHost = getNormalizedFirstHeader(req, 'x-forwarded-host');
  const directHost = (req.get('host') || '').trim().toLowerCase();
  let appUrlHost = '';
  if (process.env.APP_URL) {
    try {
      appUrlHost = new URL(process.env.APP_URL).host.toLowerCase();
    } catch {
      appUrlHost = '';
    }
  }
  const isAllowedHost = (candidateHost: string): boolean => {
    if (!forwardedHost && !directHost && !appUrlHost) return true;
    return (
      (Boolean(forwardedHost) && candidateHost === forwardedHost) ||
      (Boolean(directHost) && candidateHost === directHost) ||
      (Boolean(appUrlHost) && candidateHost === appUrlHost)
    );
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

export async function requireAdminAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const session = await getAdminSessionFromRequest(req);
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
  } catch (err) {
    next(err);
  }
}
