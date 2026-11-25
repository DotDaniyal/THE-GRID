import { COURT_NUMBER, PENDING_HOLD_MINUTES } from '../config/constants.ts';
import { emitSlotUpdate, type SlotSyncEvent } from '../events/bookingEvents.ts';
import { appendAuditLogOnDraft } from '../middleware/auth.ts';
import { readCollection, updateCollection, withSlotLock } from '../storage/jsonStore.ts';
import type {
  AdminAuditLogRecord,
  AdminNotificationRecord,
  BookingRecord,
  OperatingHourRecord,
} from '../storage/types.ts';
import { getKarachiNow } from '../utils/time.ts';
import {
  applyExpiredPendingBookingsOnDraft,
  releaseExpiredPendingBookings,
  ServiceError,
} from './bookingService.ts';

export type BookingRow = Omit<BookingRecord, 'status_token'>;
export type AdminNotificationRow = AdminNotificationRecord;
export type OperatingHourRow = OperatingHourRecord;
export type AdminActivityItem = AdminAuditLogRecord;

export interface AdminDashboardStats {
  totalBookings: number;
  pendingBookings: number;
  confirmedBookings: number;
  rejectedBookings: number;
  cancelledBookings: number;
  upcomingBookings: number;
  todaysBookings: number;
  confirmedRevenuePkr: number;
}

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
  stats: AdminDashboardStats;
  notifications: AdminNotificationRow[];
  unreadCount: number;
  recentActivity: AdminActivityItem[];
}> {
  await releaseExpiredPendingBookings();
  const [bookingsCol, adminSettingsCol] = await Promise.all([
    readCollection('bookings'),
    readCollection('admin-settings'),
  ]);

  const todayStr = getKarachiNow().dateStr;
  let pendingBookings = 0;
  let confirmedBookings = 0;
  let rejectedBookings = 0;
  let cancelledBookings = 0;
  let upcomingBookings = 0;
  let todaysBookings = 0;
  let confirmedRevenuePkr = 0;

  for (const record of bookingsCol.records) {
    if (record.status === 'PENDING') pendingBookings += 1;
    else if (record.status === 'CONFIRMED') {
      confirmedBookings += 1;
      confirmedRevenuePkr += Number(record.total_amount_pkr) || 0;
    } else if (record.status === 'REJECTED') rejectedBookings += 1;
    else if (record.status === 'CANCELLED') cancelledBookings += 1;

    if (record.booking_date === todayStr) {
      todaysBookings += 1;
    }
    if (
      record.booking_date >= todayStr &&
      (record.status === 'PENDING' || record.status === 'CONFIRMED')
    ) {
      upcomingBookings += 1;
    }
  }

  const bookings = [...bookingsCol.records]
    .sort((a, b) => {
      if (b.created_at !== a.created_at) {
        return b.created_at.localeCompare(a.created_at);
      }
      if (b.booking_date !== a.booking_date) {
        return b.booking_date.localeCompare(a.booking_date);
      }
      return a.start_time.localeCompare(b.start_time);
    })
    .slice(0, 300)
    .map(stripStatusToken);

  const notifications = [...bookingsCol.notifications]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 50);

  const unreadCount = bookingsCol.notifications.filter((n) => n.is_read === 0).length;

  const recentActivity = [
    ...(bookingsCol.auditLogs ?? []),
    ...(adminSettingsCol.auditLogs ?? []),
  ]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 40);

  return {
    bookings,
    stats: {
      totalBookings: bookingsCol.records.length,
      pendingBookings,
      confirmedBookings,
      rejectedBookings,
      cancelledBookings,
      upcomingBookings,
      todaysBookings,
      confirmedRevenuePkr,
    },
    notifications,
    unreadCount,
    recentActivity,
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

  const snapshot = await readCollection('bookings');
  const targetMeta = snapshot.records.find((b) => b.id === trimmedId);
  if (!targetMeta) {
    throw new ServiceError(404, 'Booking not found.');
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const { result } = await withSlotLock(
    targetMeta.booking_date,
    targetMeta.start_time,
    () =>
      updateCollection('bookings', (draft) => {
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
          existing.rejected_at = null;
          existing.rejected_by = null;
          existing.cancelled_at = null;
          existing.cancelled_by = null;
          existing.updated_at = nowIso;

          appendAuditLogOnDraft(draft, {
            action: 'BOOKING_CONFIRMED',
            actor: actorUsername,
            targetId: existing.id,
            summary: `Confirmed ${existing.id} (${existing.booking_date} ${existing.start_time}) for ${existing.customer_name}.`,
            createdAt: nowIso,
          });
        } else if (normalizedStatus === 'PENDING') {
          existing.status = 'PENDING';
          if (adminNotes !== null) {
            existing.admin_notes = adminNotes;
          }
          existing.hold_expires_at =
            existing.hold_expires_at ?? new Date(nowMs + PENDING_HOLD_MINUTES * 60_000).toISOString();
          existing.confirmed_at = null;
          existing.confirmed_by = null;
          existing.rejected_at = null;
          existing.rejected_by = null;
          existing.cancelled_at = null;
          existing.cancelled_by = null;
          existing.updated_at = nowIso;

          appendAuditLogOnDraft(draft, {
            action: 'BOOKING_PENDING_RESTORED',
            actor: actorUsername,
            targetId: existing.id,
            summary: `Returned ${existing.id} (${existing.booking_date} ${existing.start_time}) to PENDING.`,
            createdAt: nowIso,
          });
        } else if (normalizedStatus === 'REJECTED') {
          existing.status = 'REJECTED';
          if (adminNotes !== null) {
            existing.admin_notes = adminNotes;
          }
          existing.hold_expires_at = null;
          existing.rejected_at = nowIso;
          existing.rejected_by = actorUsername;
          existing.updated_at = nowIso;

          appendAuditLogOnDraft(draft, {
            action: 'BOOKING_REJECTED',
            actor: actorUsername,
            targetId: existing.id,
            summary: `Rejected ${existing.id} and released slot ${existing.booking_date} ${existing.start_time}.`,
            createdAt: nowIso,
          });
        } else {
          existing.status = 'CANCELLED';
          if (adminNotes !== null) {
            existing.admin_notes = adminNotes;
          }
          existing.hold_expires_at = null;
          existing.cancelled_at = nowIso;
          existing.cancelled_by = actorUsername;
          existing.updated_at = nowIso;

          appendAuditLogOnDraft(draft, {
            action: 'BOOKING_CANCELLED',
            actor: actorUsername,
            targetId: existing.id,
            summary: `Cancelled ${existing.id} and released slot ${existing.booking_date} ${existing.start_time}.`,
            createdAt: nowIso,
          });
        }

        // Resolve unread notifications tied to this booking
        for (const notif of draft.notifications) {
          if (notif.booking_id === trimmedId && notif.is_read === 0) {
            notif.is_read = 1;
          }
        }

        return {
          updated: stripStatusToken(structuredClone(existing)),
          expiredEvents,
        };
      })
  );

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
  updates: unknown[],
  actorUsername = 'admin'
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

  await updateCollection(
    'admin-settings',
    (draft) => {
      appendAuditLogOnDraft(draft, {
        action: 'OPERATING_HOURS_UPDATED',
        actor: actorUsername,
        summary: 'Updated operating hours and PKR tariff pricing.',
      });
    },
    { skipBackup: true }
  ).catch(() => undefined);

  emitSlotUpdate({
    type: 'hours_changed',
    updatedAt: new Date().toISOString(),
  });

  return [...data.operatingHours].sort((a, b) =>
    a.start_time.localeCompare(b.start_time)
  );
}
