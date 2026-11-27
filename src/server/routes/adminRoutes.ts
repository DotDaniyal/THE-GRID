import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  appendAuditLogOnDraft,
  authenticateAdminCredentials,
  clearAdminSessionCookie,
  createAdminSession,
  getAdminAuthOverview,
  getAdminSessionFromRequest,
  getSessionTtlMinutes,
  hashPassword,
  issueMfaChallengeToken,
  normalizeAdminUsername,
  recordAdminSecurityAudit,
  requireAdminAuth,
  requireSameOriginForCookieMutation,
  revokeAdminSessionFromRequest,
  setAdminSessionCookie,
  validateAdminUsername,
  validateStrongPassword,
  verifyMfaChallengeToken,
  verifyPassword,
  verifyUserMfaCode,
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
import { StorageConfigurationError } from '../storage/drivers.ts';
import {
  buildSanitizedCentralBackupSnapshot,
  getStorageOverviewStats,
  readCollection,
  updateCollection,
} from '../storage/jsonStore.ts';
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

adminRouter.get('/auth-status', async (req, res) => {
  try {
    const overview = await getAdminAuthOverview();
    const session = await getAdminSessionFromRequest(req);

    if (!session) {
      if (req.headers.cookie?.includes('thegrid_admin_session=')) {
        clearAdminSessionCookie(req, res);
      }
      res.json({
        authenticated: false,
        setupRequired: overview.setupRequired,
        authMode: overview.authMode,
        storageConfigured: overview.storageConfigured,
        storageMessage: overview.storageMessage,
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
      storageConfigured: overview.storageConfigured,
      storageMessage: overview.storageMessage,
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
  } catch (err) {
    console.error('Admin auth-status error:', err);
    res.status(500).json({ error: 'Unable to check admin authentication status.' });
  }
});

adminRouter.post('/setup', authRateLimit, requireSameOriginForCookieMutation, async (req, res) => {
  try {
    const overview = await getAdminAuthOverview();
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

    const { result: insertedId } = await updateCollection('admin-settings', (draft) => {
      if (draft.users.some((u) => u.is_active === 1 || u.username === username)) {
        throw new ServiceError(409, 'Administrator setup has already been completed.');
      }
      const id = draft.nextUserId;
      draft.nextUserId += 1;
      draft.users.push({
        id,
        username,
        display_name: displayName,
        role: 'SUPER_ADMIN',
        password_hash: hash,
        mfa_enabled: 0,
        mfa_secret: null,
        is_active: 1,
        created_at: nowIso,
        last_login_at: nowIso,
      });
      appendAuditLogOnDraft(draft, {
        action: 'ADMIN_SETUP',
        actor: username,
        summary: `Primary administrator account "${username}" configured.`,
        createdAt: nowIso,
      });
      return id;
    });

    const session = await createAdminSession({
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
  } catch (err: unknown) {
    if (err instanceof ServiceError || err instanceof StorageConfigurationError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('Admin setup error:', err);
    res.status(500).json({ error: 'Unable to complete administrator setup.' });
  }
});

adminRouter.post('/login', adminLoginLimiter, authRateLimit, requireSameOriginForCookieMutation, async (req, res) => {
  try {
    const ip = getRequestClientIp(req);
    const lockout = await checkAuthLockout(ip);
    if (lockout.locked) {
      res.setHeader('Retry-After', String(lockout.retryAfterSeconds));
      res.status(429).json({
        error: `Too many unsuccessful sign-in attempts. Please wait ${lockout.retryAfterSeconds} seconds before trying again.`,
        retryAfterSeconds: lockout.retryAfterSeconds,
      });
      return;
    }

    const overview = await getAdminAuthOverview();
    if (overview.setupRequired) {
      res.status(400).json({ error: 'Administrator setup is required before signing in.' });
      return;
    }

    const challengeToken =
      typeof req.body?.challengeToken === 'string' ? req.body.challengeToken.trim() : '';
    const mfaCode = typeof req.body?.mfaCode === 'string' ? req.body.mfaCode.trim() : '';

    if (challengeToken) {
      const userId = await verifyMfaChallengeToken(challengeToken);
      if (!userId) {
        const failure = await recordAuthFailure(ip);
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

      const verifiedUser = await verifyUserMfaCode(userId, mfaCode);
      if (!verifiedUser) {
        const failure = await recordAuthFailure(ip);
        await recordAdminSecurityAudit({
          action: 'ADMIN_LOGIN_FAILED',
          actor: `uid:${userId}`,
          summary: `Failed MFA verification attempt from ${ip}.`,
        });
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

      await clearAuthFailures(ip);
      await updateCollection(
        'admin-settings',
        (draft) => {
          const u = draft.users.find((x) => x.id === verifiedUser.id);
          if (u) u.last_login_at = new Date().toISOString();
          appendAuditLogOnDraft(draft, {
            action: 'ADMIN_LOGIN_SUCCESS',
            actor: verifiedUser.username,
            summary: `Admin "${verifiedUser.username}" signed in with MFA.`,
          });
        },
        { skipBackup: true }
      );

      const session = await createAdminSession({
        adminUserId: verifiedUser.id,
        username: verifiedUser.username,
        displayName: verifiedUser.display_name,
        role: verifiedUser.role,
        mfaEnabled: true,
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
      const failure = await recordAuthFailure(ip);
      await recordAdminSecurityAudit({
        action: 'ADMIN_LOGIN_FAILED',
        actor: normalizeAdminUsername(username) || 'unknown',
        summary: `Failed login attempt for "${normalizeAdminUsername(username) || 'unknown'}" from ${ip}.`,
      });
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
      const nextChallenge = await issueMfaChallengeToken(user.id);
      res.json({
        authenticated: false,
        mfaRequired: true,
        challengeToken: nextChallenge,
      });
      return;
    }

    await clearAuthFailures(ip);
    await updateCollection(
      'admin-settings',
      (draft) => {
        if (user.id > 0) {
          const u = draft.users.find((x) => x.id === user.id);
          if (u) u.last_login_at = new Date().toISOString();
        }
        appendAuditLogOnDraft(draft, {
          action: 'ADMIN_LOGIN_SUCCESS',
          actor: user.username,
          summary: `Admin "${user.username}" signed in.`,
        });
      },
      { skipBackup: true }
    );

    const session = await createAdminSession({
      adminUserId: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      mfaEnabled: false,
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
  } catch (err: unknown) {
    if (err instanceof StorageConfigurationError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Unable to sign in.' });
  }
});

adminRouter.post('/logout', requireSameOriginForCookieMutation, async (req, res) => {
  try {
    const existingSession = await getAdminSessionFromRequest(req);
    await revokeAdminSessionFromRequest(req);
    if (existingSession) {
      await recordAdminSecurityAudit({
        action: 'ADMIN_LOGOUT',
        actor: existingSession.username,
        summary: `Admin "${existingSession.username}" signed out.`,
      });
    }
  } catch (err) {
    console.error('Admin logout revocation error:', err);
  }
  clearAdminSessionCookie(req, res);
  res.json({ ok: true });
});

adminRouter.get('/bookings', requireAdminAuth, async (_req, res) => {
  try {
    res.json(await getAdminDashboardData());
  } catch (err: unknown) {
    if (err instanceof StorageConfigurationError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('Admin bookings fetch error:', err);
    res.status(500).json({ error: 'Failed to load bookings dashboard.' });
  }
});

adminRouter.patch(
  '/bookings/:id/status',
  requireSameOriginForCookieMutation,
  requireAdminAuth,
  async (req, res) => {
    const bookingId = req.params.id?.trim() ?? '';
    const nextStatus = typeof req.body?.status === 'string' ? req.body.status.trim() : '';
    const adminNotes =
      typeof req.body?.adminNotes === 'string'
        ? req.body.adminNotes.trim().slice(0, 300)
        : null;

    try {
      const actor = req.adminSession?.username ?? 'admin';
      const booking = await updateAdminBookingStatus(bookingId, nextStatus, adminNotes, actor);
      res.json({ booking });
    } catch (err: unknown) {
      if (err instanceof ServiceError || err instanceof StorageConfigurationError) {
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
  async (_req, res) => {
    try {
      await markAllAdminNotificationsRead();
      res.json({ ok: true });
    } catch (err: unknown) {
      if (err instanceof StorageConfigurationError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Mark notifications error:', err);
      res.status(500).json({ error: 'Failed to mark notifications read.' });
    }
  }
);

adminRouter.get('/operating-hours', requireAdminAuth, async (_req, res) => {
  try {
    res.json({ hours: await getAllOperatingHours() });
  } catch (err) {
    console.error('Operating hours fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch operating hours.' });
  }
});

adminRouter.put(
  '/operating-hours',
  requireSameOriginForCookieMutation,
  requireAdminAuth,
  async (req, res) => {
    const updates = Array.isArray(req.body?.hours) ? req.body.hours : null;
    if (!updates) {
      res.status(400).json({ error: 'Invalid operating hours payload.' });
      return;
    }

    try {
      const actor = req.adminSession?.username ?? 'admin';
      const hours = await updateOperatingHours(updates, actor);
      res.json({ hours });
    } catch (err: unknown) {
      if (err instanceof ServiceError || err instanceof StorageConfigurationError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Operating hours update error:', err);
      res.status(500).json({ error: 'Failed to update operating hours.' });
    }
  }
);

adminRouter.get('/accounts', requireAdminAuth, async (_req, res) => {
  try {
    const adminSettings = await readCollection('admin-settings');
    const rows = [...adminSettings.users].sort((a, b) => a.id - b.id);

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
  } catch (err) {
    console.error('Admin accounts fetch error:', err);
    res.status(500).json({ error: 'Failed to load admin accounts.' });
  }
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

    const hash = await hashPassword(password);
    const nowIso = new Date().toISOString();

    try {
      const { result: createdAccount } = await updateCollection('admin-settings', (draft) => {
        if (draft.users.some((u) => u.username === username)) {
          throw new ServiceError(409, 'That administrator username already exists.');
        }
        const id = draft.nextUserId;
        draft.nextUserId += 1;
        draft.users.push({
          id,
          username,
          display_name: displayName,
          role,
          password_hash: hash,
          mfa_enabled: 0,
          mfa_secret: null,
          is_active: 1,
          created_at: nowIso,
          last_login_at: null,
        });
        appendAuditLogOnDraft(draft, {
          action: 'ADMIN_ACCOUNT_CREATED',
          actor: req.adminSession?.username ?? 'admin',
          targetId: username,
          summary: `Created named admin "${username}" (${role}).`,
          createdAt: nowIso,
        });
        return {
          id,
          username,
          displayName,
          role,
          mfaEnabled: false,
          isActive: true,
          createdAt: nowIso,
          lastLoginAt: null,
        };
      });

      res.status(201).json({ account: createdAccount });
    } catch (err: unknown) {
      if (err instanceof ServiceError || err instanceof StorageConfigurationError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Create admin account error:', err);
      res.status(500).json({ error: 'Failed to create administrator account.' });
    }
  }
);

adminRouter.post(
  '/mfa/enroll',
  requireSameOriginForCookieMutation,
  requireAdminAuth,
  async (req, res) => {
    const session = req.adminSession!;
    if (session.adminUserId === null || session.adminUserId <= 0) {
      res.status(400).json({
        error: 'Create and sign in with a named administrator account first before enabling MFA.',
      });
      return;
    }

    try {
      const secret = generateTotpSecret();
      await updateCollection('admin-settings', (draft) => {
        const user = draft.users.find((u) => u.id === session.adminUserId);
        if (!user) throw new ServiceError(404, 'Administrator account not found.');
        user.mfa_secret = secret;
        user.mfa_enabled = 0;
      });

      res.json({
        secret,
        otpAuthUri: buildOtpAuthUri(session.username, secret),
      });
    } catch (err: unknown) {
      if (err instanceof ServiceError || err instanceof StorageConfigurationError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('MFA enroll error:', err);
      res.status(500).json({ error: 'Failed to enroll MFA.' });
    }
  }
);

adminRouter.post(
  '/mfa/verify',
  requireSameOriginForCookieMutation,
  requireAdminAuth,
  async (req, res) => {
    const session = req.adminSession!;
    if (session.adminUserId === null || session.adminUserId <= 0) {
      res.status(400).json({ error: 'MFA requires a named administrator account.' });
      return;
    }

    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';

    try {
      await updateCollection('admin-settings', (draft) => {
        const user = draft.users.find((u) => u.id === session.adminUserId);
        if (!user?.mfa_secret || !verifyTotpCode(user.mfa_secret, code)) {
          throw new ServiceError(400, 'Invalid 6-digit authenticator code. Please try again.');
        }
        user.mfa_enabled = 1;
        appendAuditLogOnDraft(draft, {
          action: 'ADMIN_MFA_ENABLED',
          actor: session.username,
          summary: `Enabled 2FA MFA for "${session.username}".`,
        });
      });

      res.json({ mfaEnabled: true });
    } catch (err: unknown) {
      if (err instanceof ServiceError || err instanceof StorageConfigurationError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('MFA verify error:', err);
      res.status(500).json({ error: 'Failed to verify MFA.' });
    }
  }
);

adminRouter.post(
  '/mfa/disable',
  requireSameOriginForCookieMutation,
  requireAdminAuth,
  async (req, res) => {
    const session = req.adminSession!;
    if (session.adminUserId === null || session.adminUserId <= 0) {
      res.status(400).json({ error: 'MFA requires a named administrator account.' });
      return;
    }

    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    try {
      const adminSettings = await readCollection('admin-settings');
      const user = adminSettings.users.find((u) => u.id === session.adminUserId);
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        res.status(401).json({ error: 'Current password verification failed.' });
        return;
      }

      await updateCollection('admin-settings', (draft) => {
        const target = draft.users.find((u) => u.id === session.adminUserId);
        if (target) {
          target.mfa_enabled = 0;
          target.mfa_secret = null;
          appendAuditLogOnDraft(draft, {
            action: 'ADMIN_MFA_DISABLED',
            actor: session.username,
            summary: `Disabled 2FA MFA for "${session.username}".`,
          });
        }
      });

      res.json({ mfaEnabled: false });
    } catch (err: unknown) {
      if (err instanceof StorageConfigurationError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('MFA disable error:', err);
      res.status(500).json({ error: 'Failed to disable MFA.' });
    }
  }
);

adminRouter.get('/drinks/reports', requireAdminAuth, async (req, res) => {
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

    const report = await getDrinksAnalyticsAndReports({ from, to, category, drinkId });
    res.json(report);
  } catch (err: unknown) {
    if (err instanceof ServiceError || err instanceof StorageConfigurationError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('Admin drinks report error:', err);
    res.status(500).json({ error: 'Failed to generate drinks analytics report.' });
  }
});

adminRouter.get('/drinks/sales', requireAdminAuth, async (req, res) => {
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

    const sales = await getDrinkSales({ from, to, category, drinkId, includeCancelled });
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
  async (req, res) => {
    try {
      const actor = req.adminSession?.username ?? 'admin';
      const sale = await createDrinkSale(req.body ?? {}, actor);
      res.status(201).json({ sale });
    } catch (err: unknown) {
      if (err instanceof ServiceError || err instanceof StorageConfigurationError) {
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
  async (req, res) => {
    const saleId = Number(req.params.saleId);
    if (!Number.isInteger(saleId) || saleId <= 0) {
      res.status(400).json({ error: 'Invalid sale ID.' });
      return;
    }
    try {
      const actor = req.adminSession?.username ?? 'admin';
      const sale = await updateDrinkSale(saleId, req.body ?? {}, actor);
      res.json({ sale });
    } catch (err: unknown) {
      if (err instanceof ServiceError || err instanceof StorageConfigurationError) {
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
  async (req, res) => {
    const saleId = Number(req.params.saleId);
    if (!Number.isInteger(saleId) || saleId <= 0) {
      res.status(400).json({ error: 'Invalid sale ID.' });
      return;
    }
    try {
      const actor = req.adminSession?.username ?? 'admin';
      const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;
      const sale = await cancelDrinkSale(saleId, reason, actor);
      res.json({ sale });
    } catch (err: unknown) {
      if (err instanceof ServiceError || err instanceof StorageConfigurationError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Admin drink sale cancel error:', err);
      res.status(500).json({ error: 'Failed to cancel sale record.' });
    }
  }
);

adminRouter.get('/drinks/expenses', requireAdminAuth, async (req, res) => {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from.trim() : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to.trim() : undefined;
    const expenses = await getDrinkExpenses({ from, to });
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
  async (req, res) => {
    try {
      const actor = req.adminSession?.username ?? 'admin';
      const expense = await createDrinkExpense(req.body ?? {}, actor);
      res.status(201).json({ expense });
    } catch (err: unknown) {
      if (err instanceof ServiceError || err instanceof StorageConfigurationError) {
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
  async (req, res) => {
    const expenseId = Number(req.params.expenseId);
    if (!Number.isInteger(expenseId) || expenseId <= 0) {
      res.status(400).json({ error: 'Invalid expense ID.' });
      return;
    }
    try {
      await deleteDrinkExpense(expenseId);
      res.json({ ok: true });
    } catch (err: unknown) {
      if (err instanceof ServiceError || err instanceof StorageConfigurationError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Admin drink expense delete error:', err);
      res.status(500).json({ error: 'Failed to delete expense.' });
    }
  }
);

adminRouter.get('/drinks', requireAdminAuth, async (_req, res) => {
  try {
    const drinks = await getAllDrinksAdmin();
    res.json({ drinks });
  } catch (err: unknown) {
    console.error('Admin drinks fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch drinks inventory.' });
  }
});

adminRouter.post(
  '/drinks',
  requireSameOriginForCookieMutation,
  requireAdminAuth,
  async (req, res) => {
    try {
      const actor = req.adminSession?.username ?? 'admin';
      const drink = await createDrink(req.body ?? {}, actor);
      res.status(201).json({ drink });
    } catch (err: unknown) {
      if (err instanceof ServiceError || err instanceof StorageConfigurationError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Admin drink create error:', err);
      res.status(500).json({ error: 'Failed to create drink product.' });
    }
  }
);

adminRouter.post(
  '/drinks/:id/adjust-stock',
  requireSameOriginForCookieMutation,
  requireAdminAuth,
  async (req, res) => {
    const drinkId = Number(req.params.id);
    if (!Number.isInteger(drinkId) || drinkId <= 0) {
      res.status(400).json({ error: 'Invalid product ID.' });
      return;
    }
    try {
      const actor = req.adminSession?.username ?? 'admin';
      const result = await adjustDrinkStock(drinkId, req.body ?? {}, actor);
      res.json(result);
    } catch (err: unknown) {
      if (err instanceof ServiceError || err instanceof StorageConfigurationError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Admin drink stock adjustment error:', err);
      res.status(500).json({ error: 'Failed to adjust product stock.' });
    }
  }
);

adminRouter.put(
  '/drinks/:id',
  requireSameOriginForCookieMutation,
  requireAdminAuth,
  async (req, res) => {
    const drinkId = Number(req.params.id);
    if (!Number.isInteger(drinkId) || drinkId <= 0) {
      res.status(400).json({ error: 'Invalid product ID.' });
      return;
    }
    try {
      const actor = req.adminSession?.username ?? 'admin';
      const drink = await updateDrink(drinkId, req.body ?? {}, actor);
      res.json({ drink });
    } catch (err: unknown) {
      if (err instanceof ServiceError || err instanceof StorageConfigurationError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Admin drink update error:', err);
      res.status(500).json({ error: 'Failed to update product.' });
    }
  }
);

adminRouter.delete(
  '/drinks/:id',
  requireSameOriginForCookieMutation,
  requireAdminAuth,
  async (req, res) => {
    const drinkId = Number(req.params.id);
    if (!Number.isInteger(drinkId) || drinkId <= 0) {
      res.status(400).json({ error: 'Invalid product ID.' });
      return;
    }
    try {
      await deleteDrink(drinkId);
      res.json({ ok: true });
    } catch (err: unknown) {
      if (err instanceof ServiceError || err instanceof StorageConfigurationError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Admin drink delete error:', err);
      res.status(500).json({ error: 'Failed to delete product.' });
    }
  }
);

adminRouter.get('/storage/status', requireAdminAuth, async (_req, res) => {
  try {
    const overview = await getStorageOverviewStats();
    res.json(overview);
  } catch (err: unknown) {
    if (err instanceof StorageConfigurationError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('Admin storage status error:', err);
    res.status(500).json({ error: 'Failed to verify storage status.' });
  }
});

adminRouter.get('/storage/backup', requireAdminAuth, async (req, res) => {
  try {
    const snapshot = await buildSanitizedCentralBackupSnapshot();
    const actor = req.adminSession?.username ?? 'admin';
    await recordAdminSecurityAudit({
      action: 'STORAGE_BACKUP_EXPORTED',
      actor,
      summary: `Exported sanitized central JSON backup (${snapshot.storageMode}).`,
    });
    const dateStamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="thegrid-backup-${dateStamp}.json"`
    );
    res.json(snapshot);
  } catch (err: unknown) {
    if (err instanceof StorageConfigurationError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('Admin storage backup export error:', err);
    res.status(500).json({ error: 'Failed to export JSON backup.' });
  }
});
