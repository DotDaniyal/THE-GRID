import type { AdminTab } from '@/src/app/routes';
import type { BookingSelection, BookingStatus } from '@/src/types/booking';

export type DrinksSubTabPreference = 'dashboard' | 'products' | 'sales' | 'expenses' | 'reports';

const STORAGE_KEYS = {
  bookingSelection: 'thegrid:ui:booking_selection:v1',
  adminActiveTab: 'thegrid:ui:admin_active_tab:v1',
  adminBookingFilter: 'thegrid:ui:admin_bookings_filter:v1',
  adminDrinksSubTab: 'thegrid:ui:admin_drinks_subtab:v1',
} as const;

const LEGACY_SESSION_SELECTION_KEY = 'thegrid_booking_selection_v1';

const VALID_ADMIN_TABS = new Set<AdminTab>(['bookings', 'hours', 'drinks', 'security']);
const VALID_BOOKING_FILTERS = new Set<'ALL' | BookingStatus>([
  'ALL',
  'PENDING',
  'CONFIRMED',
  'REJECTED',
  'CANCELLED',
]);
const VALID_DRINKS_TABS = new Set<DrinksSubTabPreference>([
  'dashboard',
  'products',
  'sales',
  'expenses',
  'reports',
]);

function safeGetLocalItem(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSetLocalItem(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(key, value);
  } catch {
    // Ignore storage quota or private browsing errors
  }
}

function safeRemoveLocalItem(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.removeItem(key);
  } catch {
    // Ignore private browsing restrictions
  }
}

function isValidBookingSelection(value: unknown): value is BookingSelection {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.bookingDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(obj.bookingDate)) {
    return false;
  }
  const slot = obj.slot as Record<string, unknown> | undefined;
  return Boolean(
    slot &&
      typeof slot === 'object' &&
      typeof slot.startTime === 'string' &&
      typeof slot.endTime === 'string' &&
      typeof slot.pricePkr === 'number'
  );
}

export function readStoredBookingSelection(): BookingSelection | null {
  const raw = safeGetLocalItem(STORAGE_KEYS.bookingSelection);
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isValidBookingSelection(parsed)) {
        return parsed;
      }
      safeRemoveLocalItem(STORAGE_KEYS.bookingSelection);
    } catch {
      safeRemoveLocalItem(STORAGE_KEYS.bookingSelection);
    }
  }

  // One-time seamless migration from legacy sessionStorage key if present
  if (typeof window !== 'undefined') {
    try {
      const legacyRaw = window.sessionStorage?.getItem(LEGACY_SESSION_SELECTION_KEY);
      if (legacyRaw) {
        const parsed: unknown = JSON.parse(legacyRaw);
        if (isValidBookingSelection(parsed)) {
          safeSetLocalItem(STORAGE_KEYS.bookingSelection, JSON.stringify(parsed));
          return parsed;
        }
      }
    } catch {
      // Ignore malformed legacy storage
    }
  }

  return null;
}

export function writeStoredBookingSelection(next: BookingSelection | null): void {
  if (next) {
    const serialized = JSON.stringify(next);
    safeSetLocalItem(STORAGE_KEYS.bookingSelection, serialized);
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage?.setItem(LEGACY_SESSION_SELECTION_KEY, serialized);
      } catch {
        // Ignore sessionStorage restrictions
      }
    }
    return;
  }

  safeRemoveLocalItem(STORAGE_KEYS.bookingSelection);
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage?.removeItem(LEGACY_SESSION_SELECTION_KEY);
    } catch {
      // Ignore sessionStorage restrictions
    }
  }
}

export function readStoredAdminTab(): AdminTab | null {
  const raw = safeGetLocalItem(STORAGE_KEYS.adminActiveTab);
  if (raw && VALID_ADMIN_TABS.has(raw as AdminTab)) {
    return raw as AdminTab;
  }
  return null;
}

export function writeStoredAdminTab(tab: AdminTab): void {
  if (VALID_ADMIN_TABS.has(tab)) {
    safeSetLocalItem(STORAGE_KEYS.adminActiveTab, tab);
  }
}

export function readStoredAdminBookingFilter(): 'ALL' | BookingStatus {
  const raw = safeGetLocalItem(STORAGE_KEYS.adminBookingFilter);
  if (raw && VALID_BOOKING_FILTERS.has(raw as 'ALL' | BookingStatus)) {
    return raw as 'ALL' | BookingStatus;
  }
  return 'ALL';
}

export function writeStoredAdminBookingFilter(filter: 'ALL' | BookingStatus): void {
  if (VALID_BOOKING_FILTERS.has(filter)) {
    safeSetLocalItem(STORAGE_KEYS.adminBookingFilter, filter);
  }
}

export function readStoredAdminDrinksSubTab(): DrinksSubTabPreference {
  const raw = safeGetLocalItem(STORAGE_KEYS.adminDrinksSubTab);
  if (raw && VALID_DRINKS_TABS.has(raw as DrinksSubTabPreference)) {
    return raw as DrinksSubTabPreference;
  }
  return 'dashboard';
}

export function writeStoredAdminDrinksSubTab(tab: DrinksSubTabPreference): void {
  if (VALID_DRINKS_TABS.has(tab)) {
    safeSetLocalItem(STORAGE_KEYS.adminDrinksSubTab, tab);
  }
}
