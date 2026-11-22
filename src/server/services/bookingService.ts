import crypto from 'node:crypto';
import {
  COURT_NUMBER,
  SLOT_DURATION_MINUTES,
  VENUE_NAME,
} from '../config/constants.ts';
import {
  getDb,
  type OperatingHourRow,
} from '../db/sqlite.ts';
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
  createdAt: string;
}

export function generateBookingId(bookingDate: string): string {
  const compactDate = bookingDate.replace(/-/g, '');
  const randomCode = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `GRD-${compactDate}-${randomCode}`;
}

export function getSlotsForDate(requestedDate: string): SlotsResponseData {
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

  const bookingId = generateBookingId(bookingDate);
  const nowIso = new Date().toISOString();

  try {
    db.exec('BEGIN IMMEDIATE;');

    const existing = db
      .prepare(
        "SELECT id FROM bookings WHERE court_number = ? AND booking_date = ? AND start_time = ? AND status IN ('PENDING', 'CONFIRMED')"
      )
      .get(COURT_NUMBER, bookingDate, startTime) as { id: string } | undefined;

    if (existing) {
      db.exec('ROLLBACK;');
      throw new ServiceError(
        409,
        'This time slot was just reserved by another player. Please select a different slot.'
      );
    }

    db.prepare(
      `INSERT INTO bookings (
        id, court_number, venue_name, booking_date, start_time, end_time,
        duration_minutes, booking_type, customer_name, customer_email,
        country_code, customer_phone, participants_json, additional_guests_count,
        total_amount_pkr, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`
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
      slot.price_pkr,
      nowIso,
      nowIso
    );

    db.prepare(
      'INSERT INTO admin_notifications (booking_id, message, is_read, created_at) VALUES (?, ?, 0, ?)'
    ).run(
      bookingId,
      `New ${bookingType} booking request (${bookingId}) from ${customerName} for ${bookingDate} at ${slot.display_name} - PKR ${slot.price_pkr.toLocaleString()}.`,
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
        'This time slot was just reserved by another player. Please select a different slot.'
      );
    }
    console.error('Booking insert error:', err);
    throw new ServiceError(500, 'Unable to save booking request. Please try again.');
  }

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
    totalAmountPkr: slot.price_pkr,
    status: 'PENDING',
    createdAt: nowIso,
  };
}
