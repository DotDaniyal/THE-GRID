import {
  COURT_NUMBER,
  PENDING_HOLD_MINUTES,
  SLOT_DURATION_MINUTES,
  VENUE_NAME,
} from '../config/constants.ts';

export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED';
export type DrinkCategory = 'cold_drinks' | 'water' | 'hydration_drinks';

export interface OperatingHourRecord {
  start_time: string;
  end_time: string;
  display_name: string;
  price_pkr: number;
  is_active: number;
}

export interface BookingRecord {
  id: string;
  court_number: number;
  venue_name: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  booking_type: 'individual' | 'shared';
  customer_id?: string;
  customer_name: string;
  customer_email: string;
  country_code: string;
  customer_phone: string;
  customer_notes?: string | null;
  participants_json: string | null;
  additional_guests_count: number;
  total_amount_pkr: number;
  status: BookingStatus;
  admin_notes: string | null;
  hold_expires_at: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  rejected_at?: string | null;
  rejected_by?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  status_token: string | null;
  created_at: string;
  updated_at: string;
}

export type AdminAuditAction =
  | 'ADMIN_SETUP'
  | 'ADMIN_LOGIN_SUCCESS'
  | 'ADMIN_LOGIN_FAILED'
  | 'ADMIN_LOGOUT'
  | 'ADMIN_ACCOUNT_CREATED'
  | 'ADMIN_MFA_ENABLED'
  | 'ADMIN_MFA_DISABLED'
  | 'BOOKING_CREATED'
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_REJECTED'
  | 'BOOKING_CANCELLED'
  | 'BOOKING_PENDING_RESTORED'
  | 'BOOKING_EXPIRED'
  | 'OPERATING_HOURS_UPDATED'
  | 'STORAGE_BACKUP_EXPORTED';

export interface AdminAuditLogRecord {
  id: string;
  action: AdminAuditAction;
  actor: string;
  target_id?: string | null;
  summary: string;
  created_at: string;
}

export interface AdminNotificationRecord {
  id: number;
  booking_id: string;
  message: string;
  is_read: number;
  created_at: string;
}

export interface CustomerRecord {
  id: string;
  customer_name: string;
  customer_email: string;
  country_code: string;
  customer_phone: string;
  total_bookings: number;
  booking_ids: string[];
  last_booking_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface DrinkProductRecord {
  id: number;
  name: string;
  category: DrinkCategory;
  brand: string;
  bottle_size: string;
  purchase_price_pkr: number;
  price_pkr: number;
  min_stock_alert: number;
  description: string | null;
  image_url: string | null;
  is_active: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DrinkStockLevelRecord {
  drink_id: number;
  opening_stock: number;
  current_stock: number;
  min_stock_alert: number;
  is_available: number;
  updated_by: string | null;
  updated_at: string;
}

export interface DrinkStockAdjustmentRecord {
  id: number;
  drink_id: number;
  adjustment_type: 'OPENING' | 'RESTOCK' | 'REDUCTION' | 'SALE' | 'SALE_EDIT' | 'SALE_CANCEL';
  delta_qty: number;
  previous_stock: number;
  new_stock: number;
  reason: string | null;
  created_by: string;
  created_at: string;
}

export interface DrinkSaleRecord {
  id: number;
  drink_id: number;
  product_name: string;
  category: DrinkCategory;
  quantity: number;
  unit_selling_price_pkr: number;
  total_sale_pkr: number;
  unit_purchase_price_pkr: number;
  total_cost_pkr: number;
  profit_pkr: number;
  sold_at: string;
  sale_date: string;
  notes: string | null;
  status: 'COMPLETED' | 'CANCELLED';
  created_by: string;
  updated_by: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
}

export interface DrinkSaleAuditLogRecord {
  id: number;
  sale_id: number;
  action: 'CREATED' | 'EDITED' | 'CANCELLED';
  summary: string;
  actor_username: string;
  created_at: string;
}

export interface DrinkExpenseRecord {
  id: number;
  title: string;
  amount_pkr: number;
  expense_date: string;
  description: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminUserRecord {
  id: number;
  username: string;
  display_name: string;
  role: 'SUPER_ADMIN' | 'ADMIN';
  password_hash: string;
  mfa_enabled: number;
  mfa_secret: string | null;
  is_active: number;
  created_at: string;
  last_login_at: string | null;
}

export interface AdminSessionRecord {
  id: string;
  admin_user_id: number | null;
  username: string;
  display_name: string;
  role: 'SUPER_ADMIN' | 'ADMIN';
  expires_at: number;
  created_at: string;
  revoked_at: string | null;
}

export interface AdminLoginAttemptRecord {
  attempt_key: string;
  failed_count: number;
  first_failed_at: number;
  locked_until: number;
  updated_at: number;
}

export interface BaseCollectionMeta {
  schemaVersion: number;
  updatedAt: string;
  revision: number;
}

export interface BookingsCollection extends BaseCollectionMeta {
  nextNotificationId: number;
  records: BookingRecord[];
  notifications: AdminNotificationRecord[];
  auditLogs?: AdminAuditLogRecord[];
}

export interface CustomersCollection extends BaseCollectionMeta {
  records: CustomerRecord[];
}

export interface ProductsCollection extends BaseCollectionMeta {
  nextId: number;
  records: DrinkProductRecord[];
}

export interface InventoryCollection extends BaseCollectionMeta {
  nextAdjustmentId: number;
  stockLevels: DrinkStockLevelRecord[];
  adjustments: DrinkStockAdjustmentRecord[];
}

export interface SalesCollection extends BaseCollectionMeta {
  nextSaleId: number;
  nextAuditLogId: number;
  records: DrinkSaleRecord[];
  auditLogs: DrinkSaleAuditLogRecord[];
}

export interface ExpensesCollection extends BaseCollectionMeta {
  nextId: number;
  records: DrinkExpenseRecord[];
}

export interface SettingsCollection extends BaseCollectionMeta {
  venueName: string;
  courtNumber: number;
  slotDurationMinutes: number;
  pendingHoldMinutes: number;
  operatingHours: OperatingHourRecord[];
}

export interface AdminSettingsCollection extends BaseCollectionMeta {
  nextUserId: number;
  appMeta: Record<string, string>;
  users: AdminUserRecord[];
  sessions: AdminSessionRecord[];
  loginAttempts: AdminLoginAttemptRecord[];
  auditLogs?: AdminAuditLogRecord[];
}

export interface CollectionMap {
  bookings: BookingsCollection;
  customers: CustomersCollection;
  products: ProductsCollection;
  inventory: InventoryCollection;
  sales: SalesCollection;
  expenses: ExpensesCollection;
  settings: SettingsCollection;
  'admin-settings': AdminSettingsCollection;
}

export type CollectionName = keyof CollectionMap;

export const ALL_COLLECTIONS: readonly CollectionName[] = [
  'bookings',
  'customers',
  'products',
  'inventory',
  'sales',
  'expenses',
  'settings',
  'admin-settings',
] as const;

function format12Hour(hour24: number): string {
  const normalized = hour24 % 24;
  const period = normalized >= 12 ? 'PM' : 'AM';
  const hour12 = normalized % 12 === 0 ? 12 : normalized % 12;
  return `${String(hour12).padStart(2, '0')}:00 ${period}`;
}

function getDefaultPriceForHour(hour: number): number {
  if (hour >= 0 && hour < 2) return 4000;
  if (hour >= 2 && hour < 4) return 2000;
  if (hour >= 4 && hour < 17) return 1500;
  if (hour >= 17 && hour < 19) return 2500;
  return 4000;
}

export function buildDefaultOperatingHours(): OperatingHourRecord[] {
  const hours: OperatingHourRecord[] = [];
  for (let h = 0; h < 24; h++) {
    const start = `${String(h).padStart(2, '0')}:00`;
    const end = `${String((h + 1) % 24).padStart(2, '0')}:00`;
    const display = `${format12Hour(h)} - ${format12Hour(h + 1)}`;
    hours.push({
      start_time: start,
      end_time: end,
      display_name: display,
      price_pkr: getDefaultPriceForHour(h),
      is_active: 1,
    });
  }
  return hours;
}

export function createDefaultCollection<K extends CollectionName>(name: K): CollectionMap[K] {
  const nowIso = new Date().toISOString();
  switch (name) {
    case 'bookings':
      return {
        schemaVersion: 1,
        updatedAt: nowIso,
        revision: 0,
        nextNotificationId: 1,
        records: [],
        notifications: [],
      } as unknown as CollectionMap[K];
    case 'customers':
      return {
        schemaVersion: 1,
        updatedAt: nowIso,
        revision: 0,
        records: [],
      } as unknown as CollectionMap[K];
    case 'products':
      return {
        schemaVersion: 1,
        updatedAt: nowIso,
        revision: 0,
        nextId: 1,
        records: [],
      } as unknown as CollectionMap[K];
    case 'inventory':
      return {
        schemaVersion: 1,
        updatedAt: nowIso,
        revision: 0,
        nextAdjustmentId: 1,
        stockLevels: [],
        adjustments: [],
      } as unknown as CollectionMap[K];
    case 'sales':
      return {
        schemaVersion: 1,
        updatedAt: nowIso,
        revision: 0,
        nextSaleId: 1,
        nextAuditLogId: 1,
        records: [],
        auditLogs: [],
      } as unknown as CollectionMap[K];
    case 'expenses':
      return {
        schemaVersion: 1,
        updatedAt: nowIso,
        revision: 0,
        nextId: 1,
        records: [],
      } as unknown as CollectionMap[K];
    case 'settings':
      return {
        schemaVersion: 1,
        updatedAt: nowIso,
        revision: 0,
        venueName: VENUE_NAME,
        courtNumber: COURT_NUMBER,
        slotDurationMinutes: SLOT_DURATION_MINUTES,
        pendingHoldMinutes: PENDING_HOLD_MINUTES,
        operatingHours: buildDefaultOperatingHours(),
      } as unknown as CollectionMap[K];
    case 'admin-settings':
      return {
        schemaVersion: 1,
        updatedAt: nowIso,
        revision: 0,
        nextUserId: 1,
        appMeta: {},
        users: [],
        sessions: [],
        loginAttempts: [],
      } as unknown as CollectionMap[K];
  }
}

export function validateCollectionDocument<K extends CollectionName>(
  name: K,
  doc: unknown
): doc is CollectionMap[K] {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return false;
  const obj = doc as Record<string, unknown>;
  if (typeof obj.schemaVersion !== 'number' || typeof obj.revision !== 'number') {
    return false;
  }

  switch (name) {
    case 'bookings':
      return (
        Array.isArray(obj.records) &&
        Array.isArray(obj.notifications) &&
        typeof obj.nextNotificationId === 'number'
      );
    case 'customers':
      return Array.isArray(obj.records);
    case 'products':
      return Array.isArray(obj.records) && typeof obj.nextId === 'number';
    case 'inventory':
      return (
        Array.isArray(obj.stockLevels) &&
        Array.isArray(obj.adjustments) &&
        typeof obj.nextAdjustmentId === 'number'
      );
    case 'sales':
      return (
        Array.isArray(obj.records) &&
        Array.isArray(obj.auditLogs) &&
        typeof obj.nextSaleId === 'number' &&
        typeof obj.nextAuditLogId === 'number'
      );
    case 'expenses':
      return Array.isArray(obj.records) && typeof obj.nextId === 'number';
    case 'settings':
      return Array.isArray(obj.operatingHours) && obj.operatingHours.length > 0;
    case 'admin-settings':
      return (
        typeof obj.appMeta === 'object' &&
        obj.appMeta !== null &&
        Array.isArray(obj.users) &&
        Array.isArray(obj.sessions) &&
        Array.isArray(obj.loginAttempts) &&
        typeof obj.nextUserId === 'number'
      );
  }
}
