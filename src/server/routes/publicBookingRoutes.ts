import { Router } from 'express';
import { COURT_NUMBER, VENUE_NAME } from '../config/constants.ts';
import { bookingRateLimit } from '../middleware/rateLimit.ts';
import {
  createBookingRequest,
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
