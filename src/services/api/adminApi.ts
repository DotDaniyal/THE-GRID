import { apiRequest } from '@/src/services/api/client';
import type {
  AdminAccountSummary,
  AdminAuthStatus,
  AdminBookingRow,
  AdminNotification,
  BookingStatus,
  OperatingHourConfig,
} from '@/src/types/booking';

export type AdminLoginResponse =
  | {
      authenticated: true;
      mfaRequired: false;
      expiresAt: number;
      authMode: 'named_accounts' | 'legacy_passcode_fallback' | 'setup_required';
      account: AdminAccountSummary;
      mfaMigrationRecommended: boolean;
    }
  | {
      authenticated: false;
      mfaRequired: true;
      challengeToken: string;
    };

export async function getAdminAuthStatus(): Promise<AdminAuthStatus> {
  return apiRequest<AdminAuthStatus>('/api/admin/auth-status');
}

export async function setupPrimaryAdmin(payload: {
  username: string;
  displayName: string;
  password: string;
}): Promise<{
  authenticated: true;
  expiresAt: number;
  authMode: 'named_accounts';
  account: AdminAccountSummary;
  mfaMigrationRecommended: boolean;
}> {
  return apiRequest('/api/admin/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function loginAdmin(payload: {
  username?: string;
  password?: string;
  mfaCode?: string;
  challengeToken?: string;
}): Promise<AdminLoginResponse> {
  return apiRequest<AdminLoginResponse>('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function logoutAdmin(): Promise<void> {
  await apiRequest<{ ok: boolean }>('/api/admin/logout', {
    method: 'POST',
  });
}

export async function fetchAdminDashboard(): Promise<{
  bookings: AdminBookingRow[];
  notifications: AdminNotification[];
  unreadCount: number;
  hours: OperatingHourConfig[];
}> {
  const [bookingsRes, hoursRes] = await Promise.all([
    apiRequest<{
      bookings?: AdminBookingRow[];
      notifications?: AdminNotification[];
      unreadCount?: number;
    }>('/api/admin/bookings'),
    apiRequest<{ hours?: OperatingHourConfig[] }>('/api/admin/operating-hours'),
  ]);

  return {
    bookings: bookingsRes.bookings ?? [],
    notifications: bookingsRes.notifications ?? [],
    unreadCount: bookingsRes.unreadCount ?? 0,
    hours: hoursRes.hours ?? [],
  };
}

export async function updateBookingStatus(
  bookingId: string,
  status: BookingStatus
): Promise<AdminBookingRow> {
  const data = await apiRequest<{ booking?: AdminBookingRow }>(
    `/api/admin/bookings/${encodeURIComponent(bookingId)}/status`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }
  );
  if (!data.booking) {
    throw new Error('Failed to update status.');
  }
  return data.booking;
}

export async function markNotificationsRead(): Promise<void> {
  await apiRequest<{ ok: boolean }>('/api/admin/notifications/mark-read', {
    method: 'POST',
  });
}

export async function saveOperatingHours(
  hours: OperatingHourConfig[]
): Promise<OperatingHourConfig[]> {
  const data = await apiRequest<{ hours?: OperatingHourConfig[] }>(
    '/api/admin/operating-hours',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hours }),
    }
  );
  return data.hours ?? hours;
}

export async function fetchAdminAccounts(): Promise<AdminAccountSummary[]> {
  const data = await apiRequest<{ accounts?: AdminAccountSummary[] }>('/api/admin/accounts');
  return data.accounts ?? [];
}

export async function createAdminAccount(payload: {
  username: string;
  displayName: string;
  password: string;
  role: 'SUPER_ADMIN' | 'ADMIN';
}): Promise<AdminAccountSummary> {
  const data = await apiRequest<{ account: AdminAccountSummary }>('/api/admin/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return data.account;
}

export async function enrollAdminMfa(): Promise<{ secret: string; otpAuthUri: string }> {
  return apiRequest<{ secret: string; otpAuthUri: string }>('/api/admin/mfa/enroll', {
    method: 'POST',
  });
}

export async function verifyAdminMfa(code: string): Promise<{ mfaEnabled: boolean }> {
  return apiRequest<{ mfaEnabled: boolean }>('/api/admin/mfa/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}

export async function disableAdminMfa(password: string): Promise<{ mfaEnabled: boolean }> {
  return apiRequest<{ mfaEnabled: boolean }>('/api/admin/mfa/disable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}
