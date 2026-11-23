import { COURT_NUMBER } from '../config/constants.ts';
import {
  getDb,
  type AdminNotificationRow,
  type BookingRow,
  type OperatingHourRow,
} from '../db/sqlite.ts';
import { emitSlotUpdate, type SlotSyncEvent } from '../events/bookingEvents.ts';
import {
  collectExpiredPendingBookings,
  releaseExpiredPendingBookings,
  ServiceError,
} from './bookingService.ts';

const ALLOWED_BOOKING_STATUSES = new Set([
  'PENDING',
  'CONFIRMED',
  'REJECTED',
  'CANCELLED',
]);

export function getAdminDashboardData(): {
  bookings: BookingRow[];
  notifications: AdminNotificationRow[];
  unreadCount: number;
} {
  releaseExpiredPendingBookings();
  const db = getDb();

  const bookings = db
    .prepare(
      `SELECT id, court_number, venue_name, booking_date, start_time, end_time,
              duration_minutes, booking_type, customer_name, customer_email,
              country_code, customer_phone, participants_json, additional_guests_count,
              total_amount_pkr, status, admin_notes, hold_expires_at,
              confirmed_at, confirmed_by, created_at, updated_at
       FROM bookings
       ORDER BY booking_date DESC, start_time ASC, created_at DESC
       LIMIT 300`
    )
    .all() as unknown as BookingRow[];

  const notifications = db
    .prepare('SELECT * FROM admin_notifications ORDER BY created_at DESC LIMIT 50')
    .all() as unknown as AdminNotificationRow[];

  const unreadRow = db
    .prepare('SELECT COUNT(*) AS count FROM admin_notifications WHERE is_read = 0')
    .get() as { count: number };

  return {
    bookings,
    notifications,
    unreadCount: unreadRow.count,
  };
}

export function updateAdminBookingStatus(
  bookingId: string,
  nextStatus: string,
  adminNotes: string | null,
  actorUsername = 'admin'
): BookingRow {
  const trimmedId = bookingId.trim();
  const normalizedStatus = nextStatus.trim();

  if (!trimmedId) {
    throw new ServiceError(400, 'Booking ID is required.');
  }
  if (!ALLOWED_BOOKING_STATUSES.has(normalizedStatus)) {
    throw new ServiceError(400, 'Invalid booking status.');
  }

  const db = getDb();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  let expiredEvents: SlotSyncEvent[] = [];

  db.exec('BEGIN IMMEDIATE;');
  try {
    expiredEvents = collectExpiredPendingBookings(db, nowMs);

    const existing = db
      .prepare('SELECT * FROM bookings WHERE id = ?')
      .get(trimmedId) as unknown as BookingRow | undefined;

    if (!existing) {
      db.exec('ROLLBACK;');
      throw new ServiceError(404, 'Booking not found.');
    }

    if (normalizedStatus === 'PENDING' || normalizedStatus === 'CONFIRMED') {
      const conflict = db
        .prepare(
          "SELECT id FROM bookings WHERE court_number = ? AND booking_date = ? AND start_time = ? AND status IN ('PENDING', 'CONFIRMED') AND id != ?"
        )
        .get(COURT_NUMBER, existing.booking_date, existing.start_time, trimmedId) as
        | { id: string }
        | undefined;

      if (conflict) {
        db.exec('ROLLBACK;');
        throw new ServiceError(
          409,
          `Slot already occupied by active booking ${conflict.id}.`
        );
      }
    }

    if (normalizedStatus === 'CONFIRMED') {
      db.prepare(
        `UPDATE bookings
         SET status = 'CONFIRMED',
             admin_notes = COALESCE(?, admin_notes),
             hold_expires_at = NULL,
             confirmed_at = COALESCE(confirmed_at, ?),
             confirmed_by = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(adminNotes, nowIso, actorUsername, nowIso, trimmedId);
    } else if (normalizedStatus === 'PENDING') {
      db.prepare(
        `UPDATE bookings
         SET status = 'PENDING',
             admin_notes = COALESCE(?, admin_notes),
             updated_at = ?
         WHERE id = ?`
      ).run(adminNotes, nowIso, trimmedId);
    } else {
      db.prepare(
        `UPDATE bookings
         SET status = ?,
             admin_notes = COALESCE(?, admin_notes),
             hold_expires_at = NULL,
             updated_at = ?
         WHERE id = ?`
      ).run(normalizedStatus, adminNotes, nowIso, trimmedId);
    }

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
    throw err;
  }

  const updated = db
    .prepare(
      `SELECT id, court_number, venue_name, booking_date, start_time, end_time,
              duration_minutes, booking_type, customer_name, customer_email,
              country_code, customer_phone, participants_json, additional_guests_count,
              total_amount_pkr, status, admin_notes, hold_expires_at,
              confirmed_at, confirmed_by, created_at, updated_at
       FROM bookings WHERE id = ?`
    )
    .get(trimmedId) as unknown as BookingRow;

  for (const evt of expiredEvents) {
    emitSlotUpdate(evt);
  }
  emitSlotUpdate({
    type: 'slot_changed',
    bookingDate: updated.booking_date,
    startTime: updated.start_time,
    bookingId: updated.id,
    bookingStatus: updated.status,
    updatedAt: nowIso,
  });

  return updated;
}

export function markAllAdminNotificationsRead(): void {
  const db = getDb();
  db.prepare('UPDATE admin_notifications SET is_read = 1 WHERE is_read = 0').run();
}

export function getAllOperatingHours(): OperatingHourRow[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM operating_hours ORDER BY start_time ASC')
    .all() as unknown as OperatingHourRow[];
}

export function updateOperatingHours(updates: unknown[]): OperatingHourRow[] {
  const db = getDb();
  const stmt = db.prepare(
    'UPDATE operating_hours SET price_pkr = ?, is_active = ? WHERE start_time = ?'
  );

  db.exec('BEGIN IMMEDIATE;');
  try {
    for (const item of updates) {
      const rec = item as Record<string, unknown>;
      const startTime = typeof rec.start_time === 'string' ? rec.start_time : '';
      const pricePkr = Number(rec.price_pkr);
      const isActive = rec.is_active ? 1 : 0;
      if (!/^\d{2}:\d{2}$/.test(startTime) || !Number.isFinite(pricePkr) || pricePkr < 0) {
        continue;
      }
      stmt.run(Math.round(pricePkr), isActive, startTime);
    }
    db.exec('COMMIT;');
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // Ignore rollback if transaction is already closed
    }
    console.error('Operating hours update error:', err);
    throw new ServiceError(500, 'Failed to update operating hours.');
  }

  emitSlotUpdate({
    type: 'hours_changed',
    updatedAt: new Date().toISOString(),
  });

  return getAllOperatingHours();
}
