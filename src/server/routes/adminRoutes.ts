import { Router } from 'express';
import { getDb } from '../db/sqlite.ts';
import {
  getAdminAuthMode,
  hashPassword,
  issueAdminToken,
  requireAdminAuth,
  verifyAdminPasscode,
} from '../middleware/auth.ts';
import { authRateLimit } from '../middleware/rateLimit.ts';
import {
  getAdminDashboardData,
  getAllOperatingHours,
  markAllAdminNotificationsRead,
  updateAdminBookingStatus,
  updateOperatingHours,
} from '../services/adminService.ts';
import { ServiceError } from '../services/bookingService.ts';

export const adminRouter = Router();

adminRouter.get('/auth-status', (_req, res) => {
  res.json(getAdminAuthMode());
});

adminRouter.post('/setup', authRateLimit, (req, res) => {
  const mode = getAdminAuthMode();
  if (!mode.setupRequired) {
    res.status(403).json({ error: 'Admin passcode is already configured.' });
    return;
  }

  const passcode =
    typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';
  if (passcode.length < 8 || passcode.length > 128) {
    res.status(400).json({ error: 'Passcode must be between 8 and 128 characters.' });
    return;
  }

  const db = getDb();
  const hash = hashPassword(passcode);
  const nowIso = new Date().toISOString();

  try {
    db.prepare(
      'INSERT INTO admin_credentials (id, password_hash, created_at) VALUES (1, ?, ?)'
    ).run(hash, nowIso);
  } catch {
    res.status(409).json({ error: 'Admin passcode has already been claimed.' });
    return;
  }

  res.status(201).json(issueAdminToken());
});

adminRouter.post('/login', authRateLimit, (req, res) => {
  const mode = getAdminAuthMode();
  if (mode.setupRequired) {
    res.status(400).json({ error: 'Admin setup is required before logging in.' });
    return;
  }

  const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode : '';
  if (!passcode || !verifyAdminPasscode(passcode)) {
    res.status(401).json({ error: 'Invalid admin passcode.' });
    return;
  }

  res.json(issueAdminToken());
});

adminRouter.get('/bookings', requireAdminAuth, (_req, res) => {
  res.json(getAdminDashboardData());
});

adminRouter.patch('/bookings/:id/status', requireAdminAuth, (req, res) => {
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
});

adminRouter.post('/notifications/mark-read', requireAdminAuth, (_req, res) => {
  markAllAdminNotificationsRead();
  res.json({ ok: true });
});

adminRouter.get('/operating-hours', requireAdminAuth, (_req, res) => {
  res.json({ hours: getAllOperatingHours() });
});

adminRouter.put('/operating-hours', requireAdminAuth, (req, res) => {
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
});
