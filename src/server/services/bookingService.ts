import crypto from 'node:crypto';
import {
  COURT_NUMBER,
  PENDING_HOLD_MINUTES,
  SLOT_DURATION_MINUTES,
  VENUE_NAME,
} from '../config/constants.ts';
import { emitSlotUpdate, type SlotSyncEvent } from '../events/bookingEvents.ts';
import { readCollection, updateCollection, withSlotLock } from '../storage/jsonStore.ts';
import type {
  BookingRecord,
  BookingsCollection,
  OperatingHourRecord,
} from '../storage/types.ts';
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

function isBookingHoldExpired(record: BookingRecord, nowIso: string, legacyCutoffIso: string): boolean {
  if (record.status !== 'PENDING') return false;
  if (record.hold_expires_at !== null) {
    return record.hold_expires_at <= nowIso;
  }
  return record.created_at <= legacyCutoffIso;
}

/**
 * Releases expired PENDING holds inside a BookingsCollection draft so unconfirmed
 * reservations do not block slots indefinitely. Returns events to emit after commit.
 */
export function applyExpiredPendingBookingsOnDraft(
  bookingsCol: BookingsCollection,
  nowMs: number = Date.now()
): SlotSyncEvent[] {
  const nowIso = new Date(nowMs).toISOString();
  const legacyCutoffIso = new Date(nowMs - PENDING_HOLD_MINUTES * 60_000).toISOString();
  const events: SlotSyncEvent[] = [];

  for (const record of bookingsCol.records) {
    if (isBookingHoldExpired(record, nowIso, legacyCutoffIso)) {
      record.status = 'CANCELLED';
      record.hold_expires_at = null;
      record.admin_notes =
        record.admin_notes ?? 'Auto-released after 30-minute hold expiry';
      record.updated_at = nowIso;

      events.push({
        type: 'slot_changed',
        bookingDate: record.booking_date,
        startTime: record.start_time,
        bookingId: record.id,
        bookingStatus: 'EXPIRED',
        updatedAt: nowIso,
      });
    }
  }

  return events;
}

export async function releaseExpiredPendingBookings(
  nowMs: number = Date.now()
): Promise<number> {
  const nowIso = new Date(nowMs).toISOString();
  const legacyCutoffIso = new Date(nowMs - PENDING_HOLD_MINUTES * 60_000).toISOString();

  const snapshot = await readCollection('bookings');
  const hasExpired = snapshot.records.some((r) =>
    isBookingHoldExpired(r, nowIso, legacyCutoffIso)
  );
  if (!hasExpired) {
    return 0;
  }

  const { result: events } = await updateCollection('bookings', (draft) =>
    applyExpiredPendingBookingsOnDraft(draft, nowMs)
  );

  for (const evt of events) {
    emitSlotUpdate(evt);
  }
  return events.length;
}

export async function getSlotsForDate(
  requestedDate: string
): Promise<SlotsResponseData> {
  await releaseExpiredPendingBookings();

  const karachiNow = getKarachiNow();
  const targetDate = requestedDate.trim() || karachiNow.dateStr;

  if (!isValidIsoDate(targetDate)) {
    throw new ServiceError(400, 'Invalid date format. Expected YYYY-MM-DD.');
  }

  const [settings, bookingsCol] = await Promise.all([
    readCollection('settings'),
    readCollection('bookings'),
  ]);

  const hours: OperatingHourRecord[] = settings.operatingHours
    .filter((h) => h.is_active === 1)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  const bookedMap = new Map<string, 'PENDING' | 'CONFIRMED'>();
  for (const booking of bookingsCol.records) {
    if (
      booking.court_number === COURT_NUMBER &&
      booking.booking_date === targetDate &&
      (booking.status === 'PENDING' || booking.status === 'CONFIRMED')
    ) {
      bookedMap.set(booking.start_time, booking.status);
    }
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

async function upsertCustomerForBooking(input: {
  bookingId: string;
  bookingDate: string;
  customerName: string;
  customerEmail: string;
  countryCode: string;
  customerPhone: string;
  nowIso: string;
}): Promise<string> {
  const { result: customerId } = await updateCollection('customers', (draft) => {
    const targetPhoneKey = `${input.countryCode}|${input.customerPhone}`.toLowerCase();
    const existing = draft.records.find(
      (c) => `${c.country_code}|${c.customer_phone}`.toLowerCase() === targetPhoneKey
    );
    if (existing) {
      existing.customer_name = input.customerName;
      existing.customer_email = input.customerEmail;
      if (!existing.booking_ids.includes(input.bookingId)) {
        existing.booking_ids.push(input.bookingId);
        existing.total_bookings = existing.booking_ids.length;
      }
      if (!existing.last_booking_date || input.bookingDate > existing.last_booking_date) {
        existing.last_booking_date = input.bookingDate;
      }
      existing.updated_at = input.nowIso;
      return existing.id;
    }

    const id = `CUST-${String(draft.records.length + 1).padStart(4, '0')}`;
    draft.records.push({
      id,
      customer_name: input.customerName,
      customer_email: input.customerEmail,
      country_code: input.countryCode,
      customer_phone: input.customerPhone,
      total_bookings: 1,
      booking_ids: [input.bookingId],
      last_booking_date: input.bookingDate,
      created_at: input.nowIso,
      updated_at: input.nowIso,
    });
    return id;
  });

  return customerId;
}

export async function createBookingRequest(
  rawBody: Record<string, unknown>
): Promise<CreatedBookingRecord> {
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

  const settings = await readCollection('settings');
  const slot = settings.operatingHours.find(
    (h) => h.start_time === startTime && h.is_active === 1
  );

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

  const { result: expiredEvents } = await withSlotLock(
    bookingDate,
    slot.start_time,
    () =>
      updateCollection('bookings', (draft) => {
        const released = applyExpiredPendingBookingsOnDraft(draft, nowMs);

        const existing = draft.records.find(
          (b) =>
            b.court_number === COURT_NUMBER &&
            b.booking_date === bookingDate &&
            b.start_time === slot.start_time &&
            (b.status === 'PENDING' || b.status === 'CONFIRMED')
        );

        if (existing) {
          throw new ServiceError(
            409,
            'Sorry, this slot has just been booked. Please select another available time.'
          );
        }

        draft.records.push({
          id: bookingId,
          court_number: COURT_NUMBER,
          venue_name: VENUE_NAME,
          booking_date: bookingDate,
          start_time: slot.start_time,
          end_time: slot.end_time,
          duration_minutes: SLOT_DURATION_MINUTES,
          booking_type: bookingType,
          customer_name: customerName,
          customer_email: customerEmail,
          country_code: countryCode,
          customer_phone: phoneResult.formatted,
          participants_json: participantsJson,
          additional_guests_count: additionalGuestsCount,
          total_amount_pkr: totalAmountPkr,
          status: 'PENDING',
          admin_notes: null,
          hold_expires_at: holdExpiresAt,
          confirmed_at: null,
          confirmed_by: null,
          status_token: statusToken,
          created_at: nowIso,
          updated_at: nowIso,
        });

        const notifId = draft.nextNotificationId;
        draft.nextNotificationId += 1;
        draft.notifications.push({
          id: notifId,
          booking_id: bookingId,
          message: `New ${bookingType} booking request (${bookingId}) from ${customerName} for ${bookingDate} at ${slot.display_name} (PKR ${totalAmountPkr.toLocaleString()}).`,
          is_read: 0,
          created_at: nowIso,
        });

        return released;
      })
  );

  // Sync customer directory in customers.json without blocking booking creation
  await upsertCustomerForBooking({
    bookingId,
    bookingDate,
    customerName,
    customerEmail,
    countryCode,
    customerPhone: phoneResult.formatted,
    nowIso,
  }).catch((err) => {
    console.error('Customer JSON sync warning:', err);
  });

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

export async function getBookingLiveStatus(
  bookingId: string,
  statusToken: string
): Promise<BookingLiveStatus> {
  const trimmedId = bookingId.trim();
  const trimmedToken = statusToken.trim();
  if (!trimmedId || !trimmedToken) {
    throw new ServiceError(400, 'Booking ID and verification token are required.');
  }

  await releaseExpiredPendingBookings();

  const bookingsCol = await readCollection('bookings');
  const row = bookingsCol.records.find((b) => b.id === trimmedId);

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
