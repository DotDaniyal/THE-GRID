import { Router } from 'express';
import { COURT_NUMBER, VENUE_NAME } from '../config/constants.ts';
import { subscribeSlotUpdates } from '../events/bookingEvents.ts';
import { bookingRateLimit } from '../middleware/rateLimit.ts';
import {
  createBookingRequest,
  getBookingLiveStatus,
  getSlotsForDate,
  ServiceError,
} from '../services/bookingService.ts';
import { StorageConfigurationError } from '../storage/drivers.ts';
import { verifyStorageHealth } from '../storage/jsonStore.ts';
import { getKarachiNow } from '../utils/time.ts';

export const publicBookingRouter = Router();

publicBookingRouter.get('/', (_req, res) => {
  res.json({
    name: 'THE GRID API',
    status: 'online',
    venue: VENUE_NAME,
    courtNumber: COURT_NUMBER,
    health: '/api/health',
    slots: '/api/slots',
  });
});

publicBookingRouter.get('/health', async (_req, res) => {
  const storageHealth = await verifyStorageHealth({ force: true });

  res.status(storageHealth.verified ? 200 : 503).json({
    ok: storageHealth.verified,
    karachiNow: getKarachiNow(),
    courtNumber: COURT_NUMBER,
    venue: VENUE_NAME,
    storage: {
      mode: storageHealth.mode,
      persistent: storageHealth.persistent,
      configured: storageHealth.configured,
      readable: storageHealth.readable,
      writable: storageHealth.writable,
      accessible: storageHealth.accessible,
      verified: storageHealth.verified,
      accessMode: storageHealth.accessMode,
      checkedAt: storageHealth.checkedAt,
      ...(storageHealth.error ? { error: storageHealth.error } : {}),
    },
  });
});

publicBookingRouter.get('/slots', async (req, res) => {
  try {
    const requestedDate =
      typeof req.query.date === 'string' ? req.query.date.trim() : '';
    const data = await getSlotsForDate(requestedDate);
    res.json(data);
  } catch (err: unknown) {
    if (err instanceof ServiceError || err instanceof StorageConfigurationError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('Slot query error:', err);
    res.status(500).json({ error: 'Unable to load available slots.' });
  }
});

publicBookingRouter.get('/slots/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  if (process.env.VERCEL === '1') {
    res.write('retry: 15000\n');
  }

  const sendEvent = (eventName: string, payload: unknown) => {
    if (res.writableEnded) return;
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  sendEvent('connected', { updatedAt: new Date().toISOString() });

  const unsubscribe = subscribeSlotUpdates((evt) => {
    sendEvent(evt.type, evt);
  });

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      res.write(': heartbeat\n\n');
    }
  }, 25_000);
  heartbeat.unref?.();

  let vercelCloseTimer: ReturnType<typeof setTimeout> | null = null;
  if (process.env.VERCEL === '1') {
    vercelCloseTimer = setTimeout(() => {
      clearInterval(heartbeat);
      unsubscribe();
      if (!res.writableEnded) {
        res.end();
      }
    }, 7_500);
    vercelCloseTimer.unref?.();
  }

  req.on('close', () => {
    clearInterval(heartbeat);
    if (vercelCloseTimer) clearTimeout(vercelCloseTimer);
    unsubscribe();
    if (!res.writableEnded) {
      res.end();
    }
  });
});

publicBookingRouter.get('/bookings/:id/status', async (req, res) => {
  const bookingId = req.params.id?.trim() ?? '';
  const statusToken =
    typeof req.query.token === 'string' ? req.query.token.trim() : '';

  try {
    const statusRecord = await getBookingLiveStatus(bookingId, statusToken);
    res.json({ bookingStatus: statusRecord });
  } catch (err: unknown) {
    if (err instanceof ServiceError || err instanceof StorageConfigurationError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('Booking status check error:', err);
    res.status(500).json({ error: 'Unable to verify booking status.' });
  }
});

publicBookingRouter.post('/bookings', bookingRateLimit, async (req, res) => {
  const body = req.body as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Invalid request body.' });
    return;
  }

  try {
    const booking = await createBookingRequest(body);
    res.status(201).json({ booking });
  } catch (err: unknown) {
    if (err instanceof ServiceError || err instanceof StorageConfigurationError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('Booking submission error:', err);
    res.status(500).json({ error: 'Unable to save booking request. Please try again.' });
  }
});
