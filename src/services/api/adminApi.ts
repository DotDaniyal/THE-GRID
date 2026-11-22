import { apiRequest } from '@/src/services/api/client';
import type {
  AdminAuthStatus,
  AdminBookingRow,
  AdminNotification,
  BookingStatus,
  OperatingHourConfig,
} from '@/src/types/booking';

export async function getAdminAuthStatus(): Promise<AdminAuthStatus> {
  return apiRequest<AdminAuthStatus>('/api/admin/auth-status');
}

export async function authenticateAdmin(
  mode: 'setup' | 'login',
  passcode: string
): Promise<{ token: string; expiresAt: number }> {
  const endpoint = mode === 'setup' ? '/api/admin/setup' : '/api/admin/login';
  const data = await apiRequest<{ token?: string; expiresAt?: number }>(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode }),
  });

  if (!data.token) {
    throw new Error('Authentication failed.');
  }
  return { token: data.token, expiresAt: data.expiresAt ?? 0 };
}

export async function fetchAdminDashboard(authToken: string): Promise<{
  bookings: AdminBookingRow[];
  notifications: AdminNotification[];
  unreadCount: number;
  hours: OperatingHourConfig[];
}> {
  const headers = { Authorization: `Bearer ${authToken}` };
  const [bookingsRes, hoursRes] = await Promise.all([
    apiRequest<{
      bookings?: AdminBookingRow[];
      notifications?: AdminNotification[];
      unreadCount?: number;
    }>('/api/admin/bookings', { headers }),
    apiRequest<{ hours?: OperatingHourConfig[] }>('/api/admin/operating-hours', { headers }),
  ]);

  return {
    bookings: bookingsRes.bookings ?? [],
    notifications: bookingsRes.notifications ?? [],
    unreadCount: bookingsRes.unreadCount ?? 0,
    hours: hoursRes.hours ?? [],
  };
}

export async function updateBookingStatus(
  authToken: string,
  bookingId: string,
  status: BookingStatus
): Promise<AdminBookingRow> {
  const data = await apiRequest<{ booking?: AdminBookingRow }>(
    `/api/admin/bookings/${encodeURIComponent(bookingId)}/status`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ status }),
    }
  );
  if (!data.booking) {
    throw new Error('Failed to update status.');
  }
  return data.booking;
}

export async function markNotificationsRead(authToken: string): Promise<void> {
  await apiRequest<{ ok: boolean }>('/api/admin/notifications/mark-read', {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
  });
}

export async function saveOperatingHours(
  authToken: string,
  hours: OperatingHourConfig[]
): Promise<OperatingHourConfig[]> {
  const data = await apiRequest<{ hours?: OperatingHourConfig[] }>(
    '/api/admin/operating-hours',
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ hours }),
    }
  );
  return data.hours ?? hours;
}
