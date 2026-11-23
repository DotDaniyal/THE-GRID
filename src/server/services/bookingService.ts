import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  COURT_NUMBER,
  PENDING_HOLD_MINUTES,
  SLOT_DURATION_MINUTES,
  VENUE_NAME,
} from '../config/constants.ts';
import {
  getDb,
  type BookingRow,
  type OperatingHourRow,
} from '../db/sqlite.ts';
import { emitSlotUpdate, type SlotSyncEvent } from '../events/bookingEvents.ts';
import { normalizePhone } from '../utils/phone.ts';
import {
  getKarachiNow,
  isSlotPassedInKarachi,
  isValidIsoDate,
  type KarachiNow,
} from '../utils/time.ts';

export class ServiceError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export interface SlotAvailabilityItem {
  slotId: string;
  courtNumber: 1;
  venueName: string;
  startTime: string;
  endTime: string;
  displayName: string;
  durationMinutes: number;
  pricePkr: number;
  status: 'AVAILABLE' | 'BOOKED' | 'PAST';
  bookingStatus: 'PENDING' | 'CONFIRMED' | null;
  isAvailable: boolean;
}

export interface SlotsResponseData {
  date: string;
  karachiNow: KarachiNow;
  courtNumber: 1;
  venueName: string;
  slots: SlotAvailabilityItem[];
}

export interface CreatedBookingRecord {
  id: string;
  courtNumber: 1;
  venueName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  displayName: string;
  durationMinutes: number;
  bookingType: 'individual' | 'shared';
  customerName: string;
  customerEmail: string;
  countryCode: string;
  customerPhone: string;
  additionalGuestsCount: number;
  totalAmountPkr: number;
  status: 'PENDING';
  holdExpiresAt: string;
  statusToken: string;
  createdAt: string;
}

export interface BookingLiveStatus {
  id: string;
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED';
  bookingDate: string;
  startTime: string;
  holdExpiresAt: string | null;
  confirmedAt: string | null;
  updatedAt: string;
}

export function generateBookingId(bookingDate: string): string {
  const compactDate = bookingDate.replace(/-/g, '');
  const randomCode = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `GRD-${compactDate}-${randomCode}`;
}

/**
 * Releases expired PENDING holds so unconfirmed reservations do not block slots indefinitely.
 * Returns pending events to broadcast after transaction commit.
 */
export function collectExpiredPendingBookings(
  db: DatabaseSync,
  nowMs: number = Date.now()
): SlotSyncEvent[] {
  const nowIso = new Date(nowMs).toISOString();
  const legacyCutoffIso = new Date(nowMs - PENDING_HOLD_MINUTES * 60_000).toISOString();

  const expiredRows = db
    .prepare(
      `SELECT id, booking_date, start_time
       FROM bookings
       WHERE status = 'PENDING'
         AND (
           (hold_expires_at IS NOT NULL AND hold_expires_at <= ?)
           OR (hold_expires_at IS NULL AND created_at <= ?)
         )`
    )
    .all(nowIso, legacyCutoffIso) as unknown as Array<{
    id: string;
    booking_date: string;
    start_time: string;
  }>;

  if (expiredRows.length === 0) {
    return [];
  }

  db.prepare(
    `UPDATE bookings
     SET status = 'CANCELLED',
         hold_expires_at = NULL,
         admin_notes = COALESCE(admin_notes, 'Auto-released after 30-minute hold expiry'),
         updated_at = ?
     WHERE status = 'PENDING'
       AND (
         (hold_expires_at IS NOT NULL AND hold_expires_at <= ?)
         OR (hold_expires_at IS NULL AND created_at <= ?)
       )`
  ).run(nowIso, nowIso, legacyCutoffIso);

  return expiredRows.map((row) => ({
    type: 'slot_changed',
    bookingDate: row.booking_date,
    startTime: row.start_time,
    bookingId: row.id,
    bookingStatus: 'EXPIRED',
    updatedAt: nowIso,
  }));
}

export function releaseExpiredPendingBookings(nowMs: number = Date.now()): number {
  const db = getDb();
  let events: SlotSyncEvent[] = [];

  db.exec('BEGIN IMMEDIATE;');
  try {
    events = collectExpiredPendingBookings(db, nowMs);
    db.exec('COMMIT;');
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // Ignore rollback if transaction is already closed
    }
    throw err;
  }

  for (const evt of events) {
    emitSlotUpdate(evt);
  }
  return events.length;
}

export function getSlotsForDate(requestedDate: string): SlotsResponseData {
  releaseExpiredPendingBookings();

  const karachiNow = getKarachiNow();
  const targetDate = requestedDate.trim() || karachiNow.dateStr;

  if (!isValidIsoDate(targetDate)) {
    throw new ServiceError(400, 'Invalid date format. Expected YYYY-MM-DD.');
  }

  const db = getDb();
  const hours = db
    .prepare(
      'SELECT start_time, end_time, display_name, price_pkr, is_active FROM operating_hours WHERE is_active = 1 ORDER BY start_time ASC'
    )
    .all() as unknown as OperatingHourRow[];

  const activeBookings = db
    .prepare(
      "SELECT start_time, status FROM bookings WHERE court_number = ? AND booking_date = ? AND status IN ('PENDING', 'CONFIRMED')"
    )
    .all(COURT_NUMBER, targetDate) as unknown as Array<{
    start_time: string;
    status: 'PENDING' | 'CONFIRMED';
  }>;

  const bookedMap = new Map<string, 'PENDING' | 'CONFIRMED'>();
  for (const booking of activeBookings) {
    bookedMap.set(booking.start_time, booking.status);
  }

  const slots: SlotAvailabilityItem[] = hours.map((slot) => {
    const bookingStatus = bookedMap.get(slot.start_time) ?? null;
    const isPast = isSlotPassedInKarachi(
      targetDate,
      slot.start_time,
      slot.end_time,
      karachiNow
    );
    const status: 'AVAILABLE' | 'BOOKED' | 'PAST' = bookingStatus
      ? 'BOOKED'
      : isPast
      ? 'PAST'
      : 'AVAILABLE';

    return {
      slotId: `${targetDate}_${slot.start_time}`,
      courtNumber: COURT_NUMBER,
      venueName: VENUE_NAME,
      startTime: slot.start_time,
      endTime: slot.end_time,
      displayName: slot.display_name,
      durationMinutes: SLOT_DURATION_MINUTES,
      pricePkr: slot.price_pkr,
      status,
      bookingStatus,
      isAvailable: status === 'AVAILABLE',
    };
  });

  return {
    date: targetDate,
    karachiNow,
    courtNumber: COURT_NUMBER,
    venueName: VENUE_NAME,
    slots,
  };
}

export function createBookingRequest(rawBody: Record<string, unknown>): CreatedBookingRecord {
  const customerName =
    typeof rawBody.customerName === 'string' ? rawBody.customerName.trim() : '';
  const customerEmail =
    typeof rawBody.customerEmail === 'string' ? rawBody.customerEmail.trim() : '';
  const countryCode =
    typeof rawBody.countryCode === 'string' ? rawBody.countryCode.trim() : '+92';
  const rawPhone =
    typeof rawBody.customerPhone === 'string' ? rawBody.customerPhone.trim() : '';
  const bookingDate =
    typeof rawBody.bookingDate === 'string' ? rawBody.bookingDate.trim() : '';
  const startTime =
    typeof rawBody.startTime === 'string' ? rawBody.startTime.trim() : '';
  const bookingType: 'individual' | 'shared' =
    rawBody.bookingType === 'shared' ? 'shared' : 'individual';
  const additionalGuestsCount =
    typeof rawBody.additionalGuestsCount === 'number' &&
    Number.isFinite(rawBody.additionalGuestsCount)
      ? Math.max(0, Math.min(20, Math.floor(rawBody.additionalGuestsCount)))
      : 0;

  if (rawBody.policiesAccepted === false) {
    throw new ServiceError(
      400,
      'You must agree to the Terms & Conditions, Privacy Policy, and cancellation/refund policy.'
    );
  }
  if (customerName.length < 2 || customerName.length > 80) {
    throw new ServiceError(400, 'Full name must be between 2 and 80 characters.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail) || customerEmail.length > 120) {
    throw new ServiceError(400, 'Please enter a valid email address.');
  }
  if (!/^\+\d{1,4}$/.test(countryCode)) {
    throw new ServiceError(400, 'Invalid country code selected.');
  }

  const phoneResult = normalizePhone(countryCode, rawPhone);
  if (!phoneResult.valid) {
    throw new ServiceError(400, phoneResult.error || 'Invalid mobile number.');
  }

  if (!isValidIsoDate(bookingDate)) {
    throw new ServiceError(400, 'Invalid booking date.');
  }
  if (!/^\d{2}:\d{2}$/.test(startTime)) {
    throw new ServiceError(400, 'Invalid time slot selected.');
  }

  const karachiNow = getKarachiNow();
  if (bookingDate < karachiNow.dateStr) {
    throw new ServiceError(400, 'Past dates cannot be booked.');
  }

  const db = getDb();
  const slot = db
    .prepare(
      'SELECT start_time, end_time, display_name, price_pkr, is_active FROM operating_hours WHERE start_time = ? AND is_active = 1'
    )
    .get(startTime) as unknown as OperatingHourRow | undefined;

  if (!slot) {
    throw new ServiceError(
      400,
      'Selected time slot is outside configured operating hours.'
    );
  }

  if (isSlotPassedInKarachi(bookingDate, slot.start_time, slot.end_time, karachiNow)) {
    throw new ServiceError(
      400,
      'Selected time slot has already passed in Pakistan Standard Time.'
    );
  }

  let participantsJson: string | null = null;
  if (bookingType === 'shared' && Array.isArray(rawBody.participants)) {
    const sanitizedParticipants = rawBody.participants
      .slice(0, 12)
      .map((participant) => {
        const item = participant as Record<string, unknown>;
        return {
          name: typeof item?.name === 'string' ? item.name.trim().slice(0, 60) : '',
          phone: typeof item?.phone === 'string' ? item.phone.trim().slice(0, 30) : '',
        };
      })
      .filter((participant) => participant.name.length > 0 || participant.phone.length > 0);
    if (sanitizedParticipants.length > 0) {
      participantsJson = JSON.stringify(sanitizedParticipants);
    }
  }

  const totalAmountPkr = slot.price_pkr;
  const bookingId = generateBookingId(bookingDate);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const holdExpiresAt = new Date(nowMs + PENDING_HOLD_MINUTES * 60_000).toISOString();
  const statusToken = crypto.randomBytes(16).toString('hex');

  let expiredEvents: SlotSyncEvent[] = [];

  try {
    db.exec('BEGIN IMMEDIATE;');

    expiredEvents = collectExpiredPendingBookings(db, nowMs);

    const existing = db
      .prepare(
        "SELECT id FROM bookings WHERE court_number = ? AND booking_date = ? AND start_time = ? AND status IN ('PENDING', 'CONFIRMED')"
      )
      .get(COURT_NUMBER, bookingDate, startTime) as { id: string } | undefined;

    if (existing) {
      db.exec('ROLLBACK;');
      throw new ServiceError(
        409,
        'Sorry, this slot has just been booked. Please select another available time.'
      );
    }

    db.prepare(
      `INSERT INTO bookings (
        id, court_number, venue_name, booking_date, start_time, end_time,
        duration_minutes, booking_type, customer_name, customer_email,
        country_code, customer_phone, participants_json, additional_guests_count,
        total_amount_pkr, status, hold_expires_at, status_token, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)`
    ).run(
      bookingId,
      COURT_NUMBER,
      VENUE_NAME,
      bookingDate,
      slot.start_time,
      slot.end_time,
      SLOT_DURATION_MINUTES,
      bookingType,
      customerName,
      customerEmail,
      countryCode,
      phoneResult.formatted,
      participantsJson,
      additionalGuestsCount,
      totalAmountPkr,
      holdExpiresAt,
      statusToken,
      nowIso,
      nowIso
    );

    db.prepare(
      'INSERT INTO admin_notifications (booking_id, message, is_read, created_at) VALUES (?, ?, 0, ?)'
    ).run(
      bookingId,
      `New ${bookingType} booking request (${bookingId}) from ${customerName} for ${bookingDate} at ${slot.display_name} (PKR ${totalAmountPkr.toLocaleString()}).`,
      nowIso
    );

    db.exec('COMMIT;');
  } catch (err: unknown) {
    if (err instanceof ServiceError) {
      throw err;
    }
    try {
      db.exec('ROLLBACK;');
    } catch {
      // Ignore rollback if transaction is already closed
    }
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('UNIQUE constraint failed')) {
      throw new ServiceError(
        409,
        'Sorry, this slot has just been booked. Please select another available time.'
      );
    }
    console.error('Booking insert error:', err);
    throw new ServiceError(500, 'Unable to save booking request. Please try again.');
  }

  for (const evt of expiredEvents) {
    emitSlotUpdate(evt);
  }
  emitSlotUpdate({
    type: 'slot_changed',
    bookingDate,
    startTime: slot.start_time,
    bookingId,
    bookingStatus: 'PENDING',
    updatedAt: nowIso,
  });

  return {
    id: bookingId,
    courtNumber: COURT_NUMBER,
    venueName: VENUE_NAME,
    bookingDate,
    startTime: slot.start_time,
    endTime: slot.end_time,
    displayName: slot.display_name,
    durationMinutes: SLOT_DURATION_MINUTES,
    bookingType,
    customerName,
    customerEmail,
    countryCode,
    customerPhone: phoneResult.formatted,
    additionalGuestsCount,
    totalAmountPkr,
    status: 'PENDING',
    holdExpiresAt,
    statusToken,
    createdAt: nowIso,
  };
}

export function getBookingLiveStatus(
  bookingId: string,
  statusToken: string
): BookingLiveStatus {
  const trimmedId = bookingId.trim();
  const trimmedToken = statusToken.trim();
  if (!trimmedId || !trimmedToken) {
    throw new ServiceError(400, 'Booking ID and verification token are required.');
  }

  releaseExpiredPendingBookings();

  const db = getDb();
  const row = db
    .prepare(
      'SELECT id, status, booking_date, start_time, hold_expires_at, confirmed_at, updated_at, status_token FROM bookings WHERE id = ?'
    )
    .get(trimmedId) as unknown as Pick<
    BookingRow,
    | 'id'
    | 'status'
    | 'booking_date'
    | 'start_time'
    | 'hold_expires_at'
    | 'confirmed_at'
    | 'updated_at'
    | 'status_token'
  > | undefined;

  if (!row || !row.status_token) {
    throw new ServiceError(404, 'Booking status record not found.');
  }

  const providedBuf = Buffer.from(trimmedToken);
  const storedBuf = Buffer.from(row.status_token);
  if (
    providedBuf.length !== storedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, storedBuf)
  ) {
    throw new ServiceError(403, 'Invalid booking status token.');
  }

  return {
    id: row.id,
    status: row.status,
    bookingDate: row.booking_date,
    startTime: row.start_time,
    holdExpiresAt: row.hold_expires_at,
    confirmedAt: row.confirmed_at,
    updatedAt: row.updated_at,
  };
}
