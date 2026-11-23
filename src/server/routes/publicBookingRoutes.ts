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
import { getKarachiNow } from '../utils/time.ts';

export const publicBookingRouter = Router();

publicBookingRouter.get('/health', (_req, res) => {
  res.json({
    ok: true,
    karachiNow: getKarachiNow(),
    courtNumber: COURT_NUMBER,
    venue: VENUE_NAME,
  });
});

publicBookingRouter.get('/slots', (req, res) => {
  try {
    const requestedDate =
      typeof req.query.date === 'string' ? req.query.date.trim() : '';
    const data = getSlotsForDate(requestedDate);
    res.json(data);
  } catch (err: unknown) {
    if (err instanceof ServiceError) {
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

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    if (!res.writableEnded) {
      res.end();
    }
  });
});

publicBookingRouter.get('/bookings/:id/status', (req, res) => {
  const bookingId = req.params.id?.trim() ?? '';
  const statusToken =
    typeof req.query.token === 'string' ? req.query.token.trim() : '';

  try {
    const statusRecord = getBookingLiveStatus(bookingId, statusToken);
    res.json({ bookingStatus: statusRecord });
  } catch (err: unknown) {
    if (err instanceof ServiceError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('Booking status check error:', err);
    res.status(500).json({ error: 'Unable to verify booking status.' });
  }
});

publicBookingRouter.post('/bookings', bookingRateLimit, (req, res) => {
  const body = req.body as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Invalid request body.' });
    return;
  }

  try {
    const booking = createBookingRequest(body);
    res.status(201).json({ booking });
  } catch (err: unknown) {
    if (err instanceof ServiceError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('Booking submission error:', err);
    res.status(500).json({ error: 'Unable to save booking request. Please try again.' });
  }
});
