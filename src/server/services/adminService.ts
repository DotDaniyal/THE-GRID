import { COURT_NUMBER } from '../config/constants.ts';
import { emitSlotUpdate, type SlotSyncEvent } from '../events/bookingEvents.ts';
import { readCollection, updateCollection } from '../storage/jsonStore.ts';
import type {
  AdminNotificationRecord,
  BookingRecord,
  OperatingHourRecord,
} from '../storage/types.ts';
import {
  applyExpiredPendingBookingsOnDraft,
  releaseExpiredPendingBookings,
  ServiceError,
} from './bookingService.ts';

export type BookingRow = Omit<BookingRecord, 'status_token'>;
export type AdminNotificationRow = AdminNotificationRecord;
export type OperatingHourRow = OperatingHourRecord;

const ALLOWED_BOOKING_STATUSES = new Set([
  'PENDING',
  'CONFIRMED',
  'REJECTED',
  'CANCELLED',
]);

function stripStatusToken(record: BookingRecord): BookingRow {
  const { status_token: _omitted, ...publicAdminView } = record;
  return publicAdminView;
}

export async function getAdminDashboardData(): Promise<{
  bookings: BookingRow[];
  notifications: AdminNotificationRow[];
  unreadCount: number;
}> {
  await releaseExpiredPendingBookings();
  const bookingsCol = await readCollection('bookings');

  const bookings = [...bookingsCol.records]
    .sort((a, b) => {
      if (b.booking_date !== a.booking_date) {
        return b.booking_date.localeCompare(a.booking_date);
      }
      if (a.start_time !== b.start_time) {
        return a.start_time.localeCompare(b.start_time);
      }
      return b.created_at.localeCompare(a.created_at);
    })
    .slice(0, 300)
    .map(stripStatusToken);

  const notifications = [...bookingsCol.notifications]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 50);

  const unreadCount = bookingsCol.notifications.filter((n) => n.is_read === 0).length;

  return {
    bookings,
    notifications,
    unreadCount,
  };
}

export async function updateAdminBookingStatus(
  bookingId: string,
  nextStatus: string,
  adminNotes: string | null,
  actorUsername = 'admin'
): Promise<BookingRow> {
  const trimmedId = bookingId.trim();
  const normalizedStatus = nextStatus.trim();

  if (!trimmedId) {
    throw new ServiceError(400, 'Booking ID is required.');
  }
  if (!ALLOWED_BOOKING_STATUSES.has(normalizedStatus)) {
    throw new ServiceError(400, 'Invalid booking status.');
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const { result } = await updateCollection('bookings', (draft) => {
    const expiredEvents: SlotSyncEvent[] = applyExpiredPendingBookingsOnDraft(draft, nowMs);

    const existing = draft.records.find((b) => b.id === trimmedId);
    if (!existing) {
      throw new ServiceError(404, 'Booking not found.');
    }

    if (normalizedStatus === 'PENDING' || normalizedStatus === 'CONFIRMED') {
      const conflict = draft.records.find(
        (b) =>
          b.court_number === COURT_NUMBER &&
          b.booking_date === existing.booking_date &&
          b.start_time === existing.start_time &&
          (b.status === 'PENDING' || b.status === 'CONFIRMED') &&
          b.id !== trimmedId
      );
      if (conflict) {
        throw new ServiceError(
          409,
          `Slot already occupied by active booking ${conflict.id}.`
        );
      }
    }

    if (normalizedStatus === 'CONFIRMED') {
      existing.status = 'CONFIRMED';
      if (adminNotes !== null) {
        existing.admin_notes = adminNotes;
      }
      existing.hold_expires_at = null;
      existing.confirmed_at = existing.confirmed_at ?? nowIso;
      existing.confirmed_by = actorUsername;
      existing.updated_at = nowIso;
    } else if (normalizedStatus === 'PENDING') {
      existing.status = 'PENDING';
      if (adminNotes !== null) {
        existing.admin_notes = adminNotes;
      }
      existing.updated_at = nowIso;
    } else {
      existing.status = normalizedStatus as BookingRecord['status'];
      if (adminNotes !== null) {
        existing.admin_notes = adminNotes;
      }
      existing.hold_expires_at = null;
      existing.updated_at = nowIso;
    }

    return {
      updated: stripStatusToken(structuredClone(existing)),
      expiredEvents,
    };
  });

  for (const evt of result.expiredEvents) {
    emitSlotUpdate(evt);
  }
  emitSlotUpdate({
    type: 'slot_changed',
    bookingDate: result.updated.booking_date,
    startTime: result.updated.start_time,
    bookingId: result.updated.id,
    bookingStatus: result.updated.status,
    updatedAt: nowIso,
  });

  return result.updated;
}

export async function markAllAdminNotificationsRead(): Promise<void> {
  await updateCollection('bookings', (draft) => {
    for (const n of draft.notifications) {
      if (n.is_read === 0) {
        n.is_read = 1;
      }
    }
  });
}

export async function getAllOperatingHours(): Promise<OperatingHourRow[]> {
  const settings = await readCollection('settings');
  return [...settings.operatingHours].sort((a, b) =>
    a.start_time.localeCompare(b.start_time)
  );
}

export async function updateOperatingHours(
  updates: unknown[]
): Promise<OperatingHourRow[]> {
  const { data } = await updateCollection('settings', (draft) => {
    const byStart = new Map(draft.operatingHours.map((h) => [h.start_time, h]));
    for (const item of updates) {
      const rec = item as Record<string, unknown>;
      const startTime = typeof rec.start_time === 'string' ? rec.start_time : '';
      const pricePkr = Number(rec.price_pkr);
      const isActive = rec.is_active ? 1 : 0;
      if (!/^\d{2}:\d{2}$/.test(startTime) || !Number.isFinite(pricePkr) || pricePkr < 0) {
        continue;
      }
      const existing = byStart.get(startTime);
      if (existing) {
        existing.price_pkr = Math.round(pricePkr);
        existing.is_active = isActive;
      }
    }
  });

  emitSlotUpdate({
    type: 'hours_changed',
    updatedAt: new Date().toISOString(),
  });

  return [...data.operatingHours].sort((a, b) =>
    a.start_time.localeCompare(b.start_time)
  );
}
