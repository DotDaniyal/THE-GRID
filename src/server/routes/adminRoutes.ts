import { Router } from 'express';
import rateLimit from 'express-rate-limit';
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
import {
  adjustDrinkStock,
  cancelDrinkSale,
  createDrink,
  createDrinkExpense,
  createDrinkSale,
  deleteDrink,
  deleteDrinkExpense,
  getAllDrinksAdmin,
  getDrinkExpenses,
  getDrinkSales,
  getDrinksAnalyticsAndReports,
  updateDrink,
  updateDrinkSale,
} from '../services/drinkService.ts';
import { buildOtpAuthUri, generateTotpSecret, verifyTotpCode } from '../utils/totp.ts';

export const adminRouter = Router();

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts from this IP. Please try again after 15 minutes.' },
});

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
    mfaMigrationRecommended: !session.mfaEnabled,
    sessionTtlMinutes: getSessionTtlMinutes(),
  });
});

adminRouter.post('/setup', authRateLimit, requireSameOriginForCookieMutation, async (req, res) => {
  const overview = getAdminAuthOverview();
  if (!overview.setupRequired) {
    res.status(403).json({ error: 'Primary administrator account is already configured.' });
    return;
  }

  const rawUsername = typeof req.body?.username === 'string' ? req.body.username : '';
  const username = normalizeAdminUsername(rawUsername);
  const displayName =
    typeof req.body?.displayName === 'string' && req.body.displayName.trim()
      ? req.body.displayName.trim()
      : username || 'Administrator';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  const usernameError = validateAdminUsername(rawUsername);
  if (usernameError) {
    res.status(400).json({ error: usernameError });
    return;
  }
  const passwordError = validateStrongPassword(password);
  if (passwordError) {
    res.status(400).json({ error: passwordError });
    return;
  }

  const hash = await hashPassword(password);
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
    sessionToken: session.token,
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

adminRouter.post('/login', adminLoginLimiter, authRateLimit, requireSameOriginForCookieMutation, async (req, res) => {
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
      sessionToken: session.token,
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
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  const authResult = await authenticateAdminCredentials(username, password);
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

  const user = authResult.user;
  if (user.mfa_enabled === 1) {
    const nextChallenge = issueMfaChallengeToken(user.id);
    res.json({
      authenticated: false,
      mfaRequired: true,
      challengeToken: nextChallenge,
    });
    return;
  }

  clearAuthFailures(ip);
  const db = getDb();
  db.prepare('UPDATE admin_users SET last_login_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    user.id
  );

  const session = createAdminSession({
    adminUserId: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
  });
  setAdminSessionCookie(req, res, session.token, session.expiresAt);

  res.json({
    authenticated: true,
    mfaRequired: false,
    expiresAt: session.expiresAt,
    sessionToken: session.token,
    authMode: overview.authMode,
    account: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      mfaEnabled: false,
    },
    mfaMigrationRecommended: false,
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
  async (req, res) => {
    const rawUsername = typeof req.body?.username === 'string' ? req.body.username : '';
    const username = normalizeAdminUsername(rawUsername);
    const displayName =
      typeof req.body?.displayName === 'string' && req.body.displayName.trim()
        ? req.body.displayName.trim()
        : username || 'Administrator';
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
    const hash = await hashPassword(password);
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
  async (req, res) => {
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

    if (!row || !(await verifyPassword(password, row.password_hash))) {
      res.status(401).json({ error: 'Current password verification failed.' });
      return;
    }

    db.prepare('UPDATE admin_users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?').run(
      session.adminUserId
    );
    res.json({ mfaEnabled: false });
  }
);

adminRouter.get('/drinks/reports', requireAdminAuth, (req, res) => {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from.trim() : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to.trim() : undefined;
    const category =
      typeof req.query.category === 'string' ? req.query.category.trim() : undefined;
    const rawDrinkId =
      typeof req.query.drinkId === 'string' && req.query.drinkId.trim()
        ? Number(req.query.drinkId)
        : undefined;
    const drinkId =
      rawDrinkId !== undefined && Number.isInteger(rawDrinkId) && rawDrinkId > 0
        ? rawDrinkId
        : undefined;

    const report = getDrinksAnalyticsAndReports({ from, to, category, drinkId });
    res.json(report);
  } catch (err: unknown) {
    if (err instanceof ServiceError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('Admin drinks report error:', err);
    res.status(500).json({ error: 'Failed to generate drinks analytics report.' });
  }
});

adminRouter.get('/drinks/sales', requireAdminAuth, (req, res) => {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from.trim() : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to.trim() : undefined;
    const category =
      typeof req.query.category === 'string' ? req.query.category.trim() : undefined;
    const rawDrinkId =
      typeof req.query.drinkId === 'string' && req.query.drinkId.trim()
        ? Number(req.query.drinkId)
        : undefined;
    const drinkId =
      rawDrinkId !== undefined && Number.isInteger(rawDrinkId) && rawDrinkId > 0
        ? rawDrinkId
        : undefined;
    const includeCancelled = req.query.includeCancelled !== 'false';

    const sales = getDrinkSales({ from, to, category, drinkId, includeCancelled });
    res.json({ sales });
  } catch (err: unknown) {
    console.error('Admin drink sales fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch drink sales.' });
  }
});

adminRouter.post(
  '/drinks/sales',
  requireSameOriginForCookieMutation,
  requireAdminAuth,
  (req, res) => {
    try {
      const actor = req.adminSession?.username ?? 'admin';
      const sale = createDrinkSale(req.body ?? {}, actor);
      res.status(201).json({ sale });
    } catch (err: unknown) {
      if (err instanceof ServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Admin drink sale create error:', err);
      res.status(500).json({ error: 'Failed to record sale.' });
    }
  }
);

adminRouter.put(
  '/drinks/sales/:saleId',
  requireSameOriginForCookieMutation,
  requireAdminAuth,
  (req, res) => {
    const saleId = Number(req.params.saleId);
    if (!Number.isInteger(saleId) || saleId <= 0) {
      res.status(400).json({ error: 'Invalid sale ID.' });
      return;
    }
    try {
      const actor = req.adminSession?.username ?? 'admin';
      const sale = updateDrinkSale(saleId, req.body ?? {}, actor);
      res.json({ sale });
    } catch (err: unknown) {
      if (err instanceof ServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Admin drink sale update error:', err);
      res.status(500).json({ error: 'Failed to update sale record.' });
    }
  }
);

adminRouter.post(
  '/drinks/sales/:saleId/cancel',
  requireSameOriginForCookieMutation,
  requireAdminAuth,
  (req, res) => {
    const saleId = Number(req.params.saleId);
    if (!Number.isInteger(saleId) || saleId <= 0) {
      res.status(400).json({ error: 'Invalid sale ID.' });
      return;
    }
    try {
      const actor = req.adminSession?.username ?? 'admin';
      const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;
      const sale = cancelDrinkSale(saleId, reason, actor);
      res.json({ sale });
    } catch (err: unknown) {
      if (err instanceof ServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Admin drink sale cancel error:', err);
      res.status(500).json({ error: 'Failed to cancel sale record.' });
    }
  }
);

adminRouter.get('/drinks/expenses', requireAdminAuth, (req, res) => {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from.trim() : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to.trim() : undefined;
    const expenses = getDrinkExpenses({ from, to });
    res.json({ expenses });
  } catch (err: unknown) {
    console.error('Admin drink expenses fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch expenses.' });
  }
});

adminRouter.post(
  '/drinks/expenses',
  requireSameOriginForCookieMutation,
  requireAdminAuth,
  (req, res) => {
    try {
      const actor = req.adminSession?.username ?? 'admin';
      const expense = createDrinkExpense(req.body ?? {}, actor);
      res.status(201).json({ expense });
    } catch (err: unknown) {
      if (err instanceof ServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Admin drink expense create error:', err);
      res.status(500).json({ error: 'Failed to record expense.' });
    }
  }
);

adminRouter.delete(
  '/drinks/expenses/:expenseId',
  requireSameOriginForCookieMutation,
  requireAdminAuth,
  (req, res) => {
    const expenseId = Number(req.params.expenseId);
    if (!Number.isInteger(expenseId) || expenseId <= 0) {
      res.status(400).json({ error: 'Invalid expense ID.' });
      return;
    }
    try {
      deleteDrinkExpense(expenseId);
      res.json({ ok: true });
    } catch (err: unknown) {
      if (err instanceof ServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Admin drink expense delete error:', err);
      res.status(500).json({ error: 'Failed to delete expense.' });
    }
  }
);

adminRouter.get('/drinks', requireAdminAuth, (_req, res) => {
  try {
    const drinks = getAllDrinksAdmin();
    res.json({ drinks });
  } catch (err: unknown) {
    console.error('Admin drinks fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch drinks inventory.' });
  }
});

adminRouter.post('/drinks', requireSameOriginForCookieMutation, requireAdminAuth, (req, res) => {
  try {
    const actor = req.adminSession?.username ?? 'admin';
    const drink = createDrink(req.body ?? {}, actor);
    res.status(201).json({ drink });
  } catch (err: unknown) {
    if (err instanceof ServiceError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('Admin drink create error:', err);
    res.status(500).json({ error: 'Failed to create drink product.' });
  }
});

adminRouter.post(
  '/drinks/:id/adjust-stock',
  requireSameOriginForCookieMutation,
  requireAdminAuth,
  (req, res) => {
    const drinkId = Number(req.params.id);
    if (!Number.isInteger(drinkId) || drinkId <= 0) {
      res.status(400).json({ error: 'Invalid product ID.' });
      return;
    }
    try {
      const actor = req.adminSession?.username ?? 'admin';
      const result = adjustDrinkStock(drinkId, req.body ?? {}, actor);
      res.json(result);
    } catch (err: unknown) {
      if (err instanceof ServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Admin drink stock adjustment error:', err);
      res.status(500).json({ error: 'Failed to adjust product stock.' });
    }
  }
);

adminRouter.put('/drinks/:id', requireSameOriginForCookieMutation, requireAdminAuth, (req, res) => {
  const drinkId = Number(req.params.id);
  if (!Number.isInteger(drinkId) || drinkId <= 0) {
    res.status(400).json({ error: 'Invalid product ID.' });
    return;
  }
  try {
    const actor = req.adminSession?.username ?? 'admin';
    const drink = updateDrink(drinkId, req.body ?? {}, actor);
    res.json({ drink });
  } catch (err: unknown) {
    if (err instanceof ServiceError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('Admin drink update error:', err);
    res.status(500).json({ error: 'Failed to update product.' });
  }
});

adminRouter.delete('/drinks/:id', requireSameOriginForCookieMutation, requireAdminAuth, (req, res) => {
  const drinkId = Number(req.params.id);
  if (!Number.isInteger(drinkId) || drinkId <= 0) {
    res.status(400).json({ error: 'Invalid product ID.' });
    return;
  }
  try {
    deleteDrink(drinkId);
    res.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof ServiceError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('Admin drink delete error:', err);
    res.status(500).json({ error: 'Failed to delete product.' });
  }
});
