import { useEffect, useState, useCallback } from 'react';
import { Bell, LogOut, RefreshCw, Shield } from 'lucide-react';
import { AdminBookingsList } from '@/src/features/admin/AdminBookingsList';
import { AdminLoginCard } from '@/src/features/admin/AdminLoginCard';
import { AdminSecurityPanel } from '@/src/features/admin/AdminSecurityPanel';
import { OperatingHoursEditor } from '@/src/features/admin/OperatingHoursEditor';
import {
  fetchAdminDashboard,
  getAdminAuthStatus,
  logoutAdmin,
  markNotificationsRead,
  saveOperatingHours,
  updateBookingStatus,
} from '@/src/services/api/adminApi';
import { ApiRequestError } from '@/src/services/api/client';
import type {
  AdminAccountSummary,
  AdminBookingRow,
  AdminNotification,
  BookingStatus,
  OperatingHourConfig,
} from '@/src/types/booking';

export function AdminPage() {
  const [authStatusLoading, setAuthStatusLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [authMode, setAuthMode] = useState<
    'named_accounts' | 'legacy_passcode_fallback' | 'setup_required'
  >('named_accounts');
  const [authenticated, setAuthenticated] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [currentAccount, setCurrentAccount] = useState<AdminAccountSummary | null>(null);

  const [authError, setAuthError] = useState<string | null>(null);
  const [authStatusMessage, setAuthStatusMessage] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'bookings' | 'hours' | 'security'>('bookings');
  const [bookings, setBookings] = useState<AdminBookingRow[]>([]);
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hours, setHours] = useState<OperatingHourConfig[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [savingHours, setSavingHours] = useState(false);
  const [hoursMessage, setHoursMessage] = useState<string | null>(null);

  const clearClientSession = useCallback((message?: string, isError = false) => {
    setAuthenticated(false);
    setExpiresAt(null);
    setCurrentAccount(null);
    setBookings([]);
    setNotifications([]);
    setUnreadCount(0);
    setHours([]);
    if (message) {
      if (isError) {
        setAuthError(message);
        setAuthStatusMessage(null);
      } else {
        setAuthStatusMessage(message);
        setAuthError(null);
      }
    }
  }, []);

  const refreshAuthStatus = useCallback(async () => {
    try {
      const status = await getAdminAuthStatus();
      setSetupRequired(Boolean(status.setupRequired));
      setAuthMode(status.authMode);
      setAuthenticated(Boolean(status.authenticated));
      setExpiresAt(status.expiresAt);
      setCurrentAccount(status.account);
    } catch {
      setAuthError('Unable to check admin authentication status.');
    } finally {
      setAuthStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAuthStatus();
  }, [refreshAuthStatus]);

  // Enforce automatic re-authentication immediately when session expires
  useEffect(() => {
    if (!authenticated || !expiresAt) return;
    const msRemaining = expiresAt - Date.now();
    if (msRemaining <= 0) {
      clearClientSession('Your admin session has expired. Please sign in again.', true);
      return;
    }

    const timer = window.setTimeout(() => {
      void logoutAdmin().catch(() => undefined);
      clearClientSession('Your admin session has expired. Please sign in again.', true);
    }, msRemaining);

    return () => window.clearTimeout(timer);
  }, [authenticated, expiresAt, clearClientSession]);

  const loadAdminData = useCallback(async () => {
    setLoadingData(true);
    setDataError(null);
    try {
      const dashboard = await fetchAdminDashboard();
      setBookings(dashboard.bookings);
      setNotifications(dashboard.notifications);
      setUnreadCount(dashboard.unreadCount);
      setHours(dashboard.hours);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        clearClientSession('Admin session expired. Please sign in again.', true);
        return;
      }
      setDataError(err instanceof Error ? err.message : 'Unable to fetch admin data.');
    } finally {
      setLoadingData(false);
    }
  }, [clearClientSession]);

  useEffect(() => {
    if (authenticated) {
      void loadAdminData();
    }
  }, [authenticated, loadAdminData]);

  const handleSignOut = async () => {
    try {
      await logoutAdmin();
    } catch {
      // Clear local session state even if network call fails
    }
    clearClientSession('You have signed out cleanly. Your session has been terminated.', false);
    await refreshAuthStatus();
  };

  const handleUpdateBookingStatus = async (bookingId: string, status: BookingStatus) => {
    if (!authenticated) return;
    setUpdatingId(bookingId);
    setDataError(null);
    try {
      const updated = await updateBookingStatus(bookingId, status);
      setBookings((prev) =>
        prev.map((b) => (b.id === bookingId ? updated : b))
      );
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        clearClientSession('Admin session expired. Please sign in again.', true);
        return;
      }
      setDataError(err instanceof Error ? err.message : 'Status update failed.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleMarkNotificationsRead = async () => {
    if (!authenticated) return;
    try {
      await markNotificationsRead();
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        clearClientSession('Admin session expired. Please sign in again.', true);
      }
    }
  };

  const handleSaveOperatingHours = async () => {
    if (!authenticated) return;
    setSavingHours(true);
    setHoursMessage(null);
    try {
      const updated = await saveOperatingHours(hours);
      setHours(updated);
      setHoursMessage('Operating hours and PKR rates saved.');
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        clearClientSession('Admin session expired. Please sign in again.', true);
        return;
      }
      setHoursMessage(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSavingHours(false);
    }
  };

  if (authStatusLoading) {
    return (
      <div className="min-h-screen pt-28 bg-[#0C153B] flex items-center justify-center text-sm text-slate-300">
        Verifying admin session...
      </div>
    );
  }

  if (!authenticated || !currentAccount) {
    return (
      <AdminLoginCard
        setupRequired={setupRequired}
        authMode={authMode}
        externalError={authError}
        statusMessage={authStatusMessage}
        onAuthenticated={(session) => {
          setAuthError(null);
          setAuthStatusMessage(null);
          setSetupRequired(false);
          setAuthMode(session.authMode);
          setExpiresAt(session.expiresAt);
          setCurrentAccount(session.account);
          setAuthenticated(true);
        }}
      />
    );
  }

  const pendingCount = bookings.filter((b) => b.status === 'PENDING').length;
  const confirmedCount = bookings.filter((b) => b.status === 'CONFIRMED').length;
  const expiryLabel = expiresAt
    ? new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="min-h-screen pt-24 pb-20 bg-[#0C153B] text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="pb-6 border-b border-[#c4d835]/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#c4d835]">
              Single-Court Operations
            </p>
            <h1 className="mt-1 font-display text-3xl sm:text-4xl font-extrabold uppercase text-white">
              Booking Request Desk
            </h1>
            <p className="mt-1 text-xs text-slate-300">
              Signed in as <strong className="text-white">{currentAccount.displayName}</strong>{' '}
              ({currentAccount.username})
              {expiryLabel && (
                <>
                  {' '}
                  · Session expires at{' '}
                  <span className="font-mono-tabular text-white">{expiryLabel}</span>
                </>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => void loadAdminData()}
              disabled={loadingData}
              className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] text-xs font-semibold text-white bg-[#16235C] hover:border-[#c4d835] border border-white/15 rounded-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835]"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingData ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] text-xs font-semibold text-slate-200 hover:text-white bg-white/5 hover:bg-white/10 border border-white/15 rounded-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835]"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>

        {unreadCount > 0 && (
          <div className="rounded-xl border border-[#c4d835]/45 bg-[#192869] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <Bell className="w-5 h-5 text-[#c4d835] shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold text-white">
                  {unreadCount} unread booking {unreadCount === 1 ? 'request' : 'requests'}
                </div>
                {notifications[0] && (
                  <p className="text-xs text-slate-300 mt-0.5">{notifications[0].message}</p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleMarkNotificationsRead()}
              className="px-4 py-2 min-h-[38px] text-xs font-bold text-[#0E1845] bg-[#c4d835] hover:bg-[#d4e157] rounded-md cursor-pointer self-start sm:self-auto"
            >
              Mark All Read
            </button>
          </div>
        )}

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-6 text-sm">
            <div>
              <span className="text-slate-400">Pending: </span>
              <span className="font-mono-tabular font-bold text-amber-300">{pendingCount}</span>
            </div>
            <div>
              <span className="text-slate-400">Confirmed: </span>
              <span className="font-mono-tabular font-bold text-[#c4d835]">{confirmedCount}</span>
            </div>
            <div>
              <span className="text-slate-400">Total Records: </span>
              <span className="font-mono-tabular font-bold text-white">{bookings.length}</span>
            </div>
          </div>

          <div className="inline-flex flex-wrap p-1 rounded-lg bg-[#121D52] border border-white/15 self-start">
            <button
              type="button"
              onClick={() => setActiveTab('bookings')}
              className={`px-4 py-2 min-h-[38px] text-xs font-semibold rounded-md cursor-pointer ${
                activeTab === 'bookings'
                  ? 'bg-[#c4d835] text-[#0E1845]'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Booking Requests
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('hours')}
              className={`px-4 py-2 min-h-[38px] text-xs font-semibold rounded-md cursor-pointer ${
                activeTab === 'hours'
                  ? 'bg-[#c4d835] text-[#0E1845]'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Operating Hours &amp; Pricing
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('security')}
              className={`inline-flex items-center gap-1.5 px-4 py-2 min-h-[38px] text-xs font-semibold rounded-md cursor-pointer ${
                activeTab === 'security'
                  ? 'bg-[#c4d835] text-[#0E1845]'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Shield className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Accounts &amp; MFA</span>
            </button>
          </div>
        </div>

        {dataError && (
          <div role="alert" className="p-4 rounded-lg border border-rose-400/40 bg-rose-950/40 text-sm text-rose-200">
            {dataError}
          </div>
        )}

        {activeTab === 'bookings' && (
          <AdminBookingsList
            bookings={bookings}
            updatingId={updatingId}
            onUpdateStatus={handleUpdateBookingStatus}
          />
        )}

        {activeTab === 'hours' && (
          <OperatingHoursEditor
            hours={hours}
            saving={savingHours}
            message={hoursMessage}
            onChangeHours={setHours}
            onSave={handleSaveOperatingHours}
          />
        )}

        {activeTab === 'security' && (
          <AdminSecurityPanel
            currentAccount={currentAccount}
            authMode={authMode}
            onAccountUpdated={refreshAuthStatus}
          />
        )}
      </div>
    </div>
  );
}
