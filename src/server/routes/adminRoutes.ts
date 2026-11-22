import { Router } from 'express';
import { getDb } from '../db/sqlite.ts';
import {
  authenticateAdminCredentials,
  clearAdminSessionCookie,
  createAdminSession,
  getAdminAuthOverview,
  getAdminSessionFromRequest,
  getSessionTtlMinutes,
  hashPassword,
  issueMfaChallengeToken,
  normalizeAdminUsername,
  requireAdminAuth,
  requireSameOriginForCookieMutation,
  revokeAdminSessionFromRequest,
  setAdminSessionCookie,
  validateAdminUsername,
  validateStrongPassword,
  verifyMfaChallengeToken,
  verifyPassword,
  verifyUserMfaCode,
  type AdminUserRow,
} from '../middleware/auth.ts';
import {
  authRateLimit,
  checkAuthLockout,
  clearAuthFailures,
  getRequestClientIp,
  recordAuthFailure,
} from '../middleware/rateLimit.ts';
import {
  getAdminDashboardData,
  getAllOperatingHours,
  markAllAdminNotificationsRead,
  updateAdminBookingStatus,
  updateOperatingHours,
} from '../services/adminService.ts';
import { ServiceError } from '../services/bookingService.ts';
import { buildOtpAuthUri, generateTotpSecret, verifyTotpCode } from '../utils/totp.ts';

export const adminRouter = Router();

const GENERIC_AUTH_ERROR =
  'Invalid credentials. Please verify your sign-in details and try again.';

adminRouter.get('/auth-status', (req, res) => {
  const overview = getAdminAuthOverview();
  const session = getAdminSessionFromRequest(req);

  if (!session) {
    if (req.headers.cookie?.includes('thegrid_admin_session=')) {
      clearAdminSessionCookie(req, res);
    }
    res.json({
      authenticated: false,
      setupRequired: overview.setupRequired,
      authMode: overview.authMode,
      expiresAt: null,
      account: null,
      mfaMigrationRecommended: false,
      sessionTtlMinutes: getSessionTtlMinutes(),
    });
    return;
  }

  res.json({
    authenticated: true,
    setupRequired: false,
    authMode: overview.authMode,
    expiresAt: session.expiresAt,
    account: {
      id: session.adminUserId ?? 0,
      username: session.username,
      displayName: session.displayName,
      role: session.role,
      mfaEnabled: session.mfaEnabled,
    },
    mfaMigrationRecommended: session.role === 'LEGACY_SHARED' || !session.mfaEnabled,
    sessionTtlMinutes: getSessionTtlMinutes(),
  });
});

adminRouter.post('/setup', authRateLimit, requireSameOriginForCookieMutation, (req, res) => {
  const overview = getAdminAuthOverview();
  if (!overview.setupRequired) {
    res.status(403).json({ error: 'Primary administrator account is already configured.' });
    return;
  }

  const rawUsername = typeof req.body?.username === 'string' ? req.body.username : '';
  const displayName =
    typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  const usernameError = validateAdminUsername(rawUsername);
  if (usernameError) {
    res.status(400).json({ error: usernameError });
    return;
  }
  if (displayName.length < 2 || displayName.length > 60) {
    res.status(400).json({ error: 'Display name must be between 2 and 60 characters.' });
    return;
  }
  const passwordError = validateStrongPassword(password);
  if (passwordError) {
    res.status(400).json({ error: passwordError });
    return;
  }

  const username = normalizeAdminUsername(rawUsername);
  const hash = hashPassword(password);
  const nowIso = new Date().toISOString();
  const db = getDb();

  let insertedId = 0;
  try {
    const info = db
      .prepare(
        `INSERT INTO admin_users (username, display_name, role, password_hash, mfa_enabled, mfa_secret, is_active, created_at, last_login_at)
         VALUES (?, ?, 'SUPER_ADMIN', ?, 0, NULL, 1, ?, ?)`
      )
      .run(username, displayName, hash, nowIso, nowIso);
    insertedId = Number(info.lastInsertRowid);
  } catch {
    res.status(409).json({ error: 'Administrator setup has already been completed.' });
    return;
  }

  const session = createAdminSession({
    adminUserId: insertedId,
    username,
    displayName,
    role: 'SUPER_ADMIN',
  });
  setAdminSessionCookie(req, res, session.token, session.expiresAt);

  res.status(201).json({
    authenticated: true,
    expiresAt: session.expiresAt,
    authMode: 'named_accounts',
    account: {
      id: insertedId,
      username,
      displayName,
      role: 'SUPER_ADMIN',
      mfaEnabled: false,
    },
    mfaMigrationRecommended: true,
  });
});

adminRouter.post('/login', authRateLimit, requireSameOriginForCookieMutation, (req, res) => {
  const ip = getRequestClientIp(req);
  const lockout = checkAuthLockout(ip);
  if (lockout.locked) {
    res.setHeader('Retry-After', String(lockout.retryAfterSeconds));
    res.status(429).json({
      error: `Too many unsuccessful sign-in attempts. Please wait ${lockout.retryAfterSeconds} seconds before trying again.`,
      retryAfterSeconds: lockout.retryAfterSeconds,
    });
    return;
  }

  const overview = getAdminAuthOverview();
  if (overview.setupRequired) {
    res.status(400).json({ error: 'Administrator setup is required before signing in.' });
    return;
  }

  const challengeToken =
    typeof req.body?.challengeToken === 'string' ? req.body.challengeToken.trim() : '';
  const mfaCode = typeof req.body?.mfaCode === 'string' ? req.body.mfaCode.trim() : '';

  if (challengeToken) {
    const userId = verifyMfaChallengeToken(challengeToken);
    if (!userId) {
      const failure = recordAuthFailure(ip);
      if (failure.locked) {
        res.setHeader('Retry-After', String(failure.retryAfterSeconds));
        res.status(429).json({
          error: `Too many unsuccessful sign-in attempts. Please wait ${failure.retryAfterSeconds} seconds before trying again.`,
          retryAfterSeconds: failure.retryAfterSeconds,
        });
        return;
      }
      res.status(401).json({ error: GENERIC_AUTH_ERROR });
      return;
    }

    const verifiedUser = verifyUserMfaCode(userId, mfaCode);
    if (!verifiedUser) {
      const failure = recordAuthFailure(ip);
      if (failure.locked) {
        res.setHeader('Retry-After', String(failure.retryAfterSeconds));
        res.status(429).json({
          error: `Too many unsuccessful sign-in attempts. Please wait ${failure.retryAfterSeconds} seconds before trying again.`,
          retryAfterSeconds: failure.retryAfterSeconds,
        });
        return;
      }
      res.status(401).json({ error: GENERIC_AUTH_ERROR });
      return;
    }

    clearAuthFailures(ip);
    const db = getDb();
    db.prepare('UPDATE admin_users SET last_login_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      verifiedUser.id
    );

    const session = createAdminSession({
      adminUserId: verifiedUser.id,
      username: verifiedUser.username,
      displayName: verifiedUser.display_name,
      role: verifiedUser.role,
    });
    setAdminSessionCookie(req, res, session.token, session.expiresAt);

    res.json({
      authenticated: true,
      mfaRequired: false,
      expiresAt: session.expiresAt,
      authMode: overview.authMode,
      account: {
        id: verifiedUser.id,
        username: verifiedUser.username,
        displayName: verifiedUser.display_name,
        role: verifiedUser.role,
        mfaEnabled: true,
      },
      mfaMigrationRecommended: false,
    });
    return;
  }

  const username = typeof req.body?.username === 'string' ? req.body.username : '';
  const password =
    typeof req.body?.password === 'string'
      ? req.body.password
      : typeof req.body?.passcode === 'string'
      ? req.body.passcode
      : '';

  const authResult = authenticateAdminCredentials(username, password);
  if (!authResult.ok) {
    const failure = recordAuthFailure(ip);
    if (failure.locked) {
      res.setHeader('Retry-After', String(failure.retryAfterSeconds));
      res.status(429).json({
        error: `Too many unsuccessful sign-in attempts. Please wait ${failure.retryAfterSeconds} seconds before trying again.`,
        retryAfterSeconds: failure.retryAfterSeconds,
      });
      return;
    }
    res.status(401).json({ error: GENERIC_AUTH_ERROR });
    return;
  }

  if (authResult.user.kind === 'named' && authResult.user.row.mfa_enabled === 1) {
    const nextChallenge = issueMfaChallengeToken(authResult.user.row.id);
    res.json({
      authenticated: false,
      mfaRequired: true,
      challengeToken: nextChallenge,
    });
    return;
  }

  clearAuthFailures(ip);

  if (authResult.user.kind === 'named') {
    const row = authResult.user.row;
    const db = getDb();
    db.prepare('UPDATE admin_users SET last_login_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      row.id
    );

    const session = createAdminSession({
      adminUserId: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
    });
    setAdminSessionCookie(req, res, session.token, session.expiresAt);

    res.json({
      authenticated: true,
      mfaRequired: false,
      expiresAt: session.expiresAt,
      authMode: overview.authMode,
      account: {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        role: row.role,
        mfaEnabled: false,
      },
      mfaMigrationRecommended: true,
    });
    return;
  }

  // Legacy shared passcode fallback session (prior to migrating to named admin accounts)
  const session = createAdminSession({
    adminUserId: null,
    username: 'shared-passcode-admin',
    displayName: 'Venue Administrator (Shared Passcode)',
    role: 'LEGACY_SHARED',
  });
  setAdminSessionCookie(req, res, session.token, session.expiresAt);

  res.json({
    authenticated: true,
    mfaRequired: false,
    expiresAt: session.expiresAt,
    authMode: overview.authMode,
    account: {
      id: 0,
      username: 'shared-passcode-admin',
      displayName: 'Venue Administrator (Shared Passcode)',
      role: 'LEGACY_SHARED',
      mfaEnabled: false,
    },
    mfaMigrationRecommended: true,
  });
});

adminRouter.post('/logout', requireSameOriginForCookieMutation, (req, res) => {
  revokeAdminSessionFromRequest(req);
  clearAdminSessionCookie(req, res);
  res.json({ ok: true });
});

adminRouter.get('/bookings', requireAdminAuth, (_req, res) => {
  res.json(getAdminDashboardData());
});

adminRouter.patch(
  '/bookings/:id/status',
  requireSameOriginForCookieMutation,
  requireAdminAuth,
  (req, res) => {
    const bookingId = req.params.id?.trim() ?? '';
    const nextStatus = typeof req.body?.status === 'string' ? req.body.status.trim() : '';
    const adminNotes =
      typeof req.body?.adminNotes === 'string'
        ? req.body.adminNotes.trim().slice(0, 300)
        : null;

    try {
      const booking = updateAdminBookingStatus(bookingId, nextStatus, adminNotes);
      res.json({ booking });
    } catch (err: unknown) {
      if (err instanceof ServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Admin booking update error:', err);
      res.status(500).json({ error: 'Failed to update booking status.' });
    }
  }
);

adminRouter.post(
  '/notifications/mark-read',
  requireSameOriginForCookieMutation,
  requireAdminAuth,
  (_req, res) => {
    markAllAdminNotificationsRead();
    res.json({ ok: true });
  }
);

adminRouter.get('/operating-hours', requireAdminAuth, (_req, res) => {
  res.json({ hours: getAllOperatingHours() });
});

adminRouter.put(
  '/operating-hours',
  requireSameOriginForCookieMutation,
  requireAdminAuth,
  (req, res) => {
    const updates = Array.isArray(req.body?.hours) ? req.body.hours : null;
    if (!updates) {
      res.status(400).json({ error: 'Invalid operating hours payload.' });
      return;
    }

    try {
      const hours = updateOperatingHours(updates);
      res.json({ hours });
    } catch (err: unknown) {
      if (err instanceof ServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Operating hours update error:', err);
      res.status(500).json({ error: 'Failed to update operating hours.' });
    }
  }
);

adminRouter.get('/accounts', requireAdminAuth, (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, username, display_name, role, mfa_enabled, is_active, created_at, last_login_at
       FROM admin_users ORDER BY id ASC`
    )
    .all() as unknown as Array<Omit<AdminUserRow, 'password_hash' | 'mfa_secret'>>;

  res.json({
    accounts: rows.map((r) => ({
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      role: r.role,
      mfaEnabled: r.mfa_enabled === 1,
      isActive: r.is_active === 1,
      createdAt: r.created_at,
      lastLoginAt: r.last_login_at,
    })),
  });
});

adminRouter.post(
  '/accounts',
  requireSameOriginForCookieMutation,
  requireAdminAuth,
  (req, res) => {
    const rawUsername = typeof req.body?.username === 'string' ? req.body.username : '';
    const displayName =
      typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const role: 'SUPER_ADMIN' | 'ADMIN' =
      req.body?.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN';

    const usernameError = validateAdminUsername(rawUsername);
    if (usernameError) {
      res.status(400).json({ error: usernameError });
      return;
    }
    if (displayName.length < 2 || displayName.length > 60) {
      res.status(400).json({ error: 'Display name must be between 2 and 60 characters.' });
      return;
    }
    const passwordError = validateStrongPassword(password);
    if (passwordError) {
      res.status(400).json({ error: passwordError });
      return;
    }

    const db = getDb();
    const username = normalizeAdminUsername(rawUsername);
    const hash = hashPassword(password);
    const nowIso = new Date().toISOString();

    try {
      const info = db
        .prepare(
          `INSERT INTO admin_users (username, display_name, role, password_hash, mfa_enabled, mfa_secret, is_active, created_at)
           VALUES (?, ?, ?, ?, 0, NULL, 1, ?)`
        )
        .run(username, displayName, role, hash, nowIso);

      res.status(201).json({
        account: {
          id: Number(info.lastInsertRowid),
          username,
          displayName,
          role,
          mfaEnabled: false,
          isActive: true,
          createdAt: nowIso,
          lastLoginAt: null,
        },
      });
    } catch {
      res.status(409).json({ error: 'That administrator username already exists.' });
    }
  }
);

adminRouter.post(
  '/mfa/enroll',
  requireSameOriginForCookieMutation,
  requireAdminAuth,
  (req, res) => {
    const session = req.adminSession!;
    if (session.adminUserId === null) {
      res.status(400).json({
        error: 'Create and sign in with a named administrator account first before enabling MFA.',
      });
      return;
    }

    const secret = generateTotpSecret();
    const db = getDb();
    db.prepare('UPDATE admin_users SET mfa_secret = ?, mfa_enabled = 0 WHERE id = ?').run(
      secret,
      session.adminUserId
    );

    res.json({
      secret,
      otpAuthUri: buildOtpAuthUri(session.username, secret),
    });
  }
);

adminRouter.post(
  '/mfa/verify',
  requireSameOriginForCookieMutation,
  requireAdminAuth,
  (req, res) => {
    const session = req.adminSession!;
    if (session.adminUserId === null) {
      res.status(400).json({ error: 'MFA requires a named administrator account.' });
      return;
    }

    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const db = getDb();
    const row = db
      .prepare('SELECT mfa_secret FROM admin_users WHERE id = ?')
      .get(session.adminUserId) as { mfa_secret: string | null } | undefined;

    if (!row?.mfa_secret || !verifyTotpCode(row.mfa_secret, code)) {
      res.status(400).json({ error: 'Invalid 6-digit authenticator code. Please try again.' });
      return;
    }

    db.prepare('UPDATE admin_users SET mfa_enabled = 1 WHERE id = ?').run(session.adminUserId);
    res.json({ mfaEnabled: true });
  }
);

adminRouter.post(
  '/mfa/disable',
  requireSameOriginForCookieMutation,
  requireAdminAuth,
  (req, res) => {
    const session = req.adminSession!;
    if (session.adminUserId === null) {
      res.status(400).json({ error: 'MFA requires a named administrator account.' });
      return;
    }

    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const db = getDb();
    const row = db
      .prepare('SELECT password_hash FROM admin_users WHERE id = ?')
      .get(session.adminUserId) as { password_hash: string } | undefined;

    if (!row || !verifyPassword(password, row.password_hash)) {
      res.status(401).json({ error: 'Current password verification failed.' });
      return;
    }

    db.prepare('UPDATE admin_users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?').run(
      session.adminUserId
    );
    res.json({ mfaEnabled: false });
  }
);
