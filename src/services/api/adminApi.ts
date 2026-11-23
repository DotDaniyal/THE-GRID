import {
  apiRequest,
  clearInMemoryAdminSessionToken,
  setInMemoryAdminSessionToken,
} from '@/src/services/api/client';
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
      sessionToken?: string;
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
  displayName?: string;
  password: string;
}): Promise<{
  authenticated: true;
  expiresAt: number;
  sessionToken?: string;
  authMode: 'named_accounts';
  account: AdminAccountSummary;
  mfaMigrationRecommended: boolean;
}> {
  const res = await apiRequest<{
    authenticated: true;
    expiresAt: number;
    sessionToken?: string;
    authMode: 'named_accounts';
    account: AdminAccountSummary;
    mfaMigrationRecommended: boolean;
  }>('/api/admin/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.sessionToken) {
    setInMemoryAdminSessionToken(res.sessionToken);
  }
  return res;
}

export async function loginAdmin(payload: {
  username?: string;
  password?: string;
  mfaCode?: string;
  challengeToken?: string;
}): Promise<AdminLoginResponse> {
  const res = await apiRequest<AdminLoginResponse>('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.authenticated && res.sessionToken) {
    setInMemoryAdminSessionToken(res.sessionToken);
  }
  return res;
}

export async function logoutAdmin(): Promise<void> {
  try {
    await apiRequest<{ ok: boolean }>('/api/admin/logout', {
      method: 'POST',
    });
  } finally {
    clearInMemoryAdminSessionToken();
  }
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

export type DrinkCategory = 'cold_drinks' | 'water' | 'hydration_drinks';

export interface DrinkItem {
  id: number;
  name: string;
  category: DrinkCategory;
  brand: string;
  bottle_size: string;
  purchase_price_pkr: number;
  price_pkr: number;
  opening_stock: number;
  current_stock: number;
  min_stock_alert: number;
  description: string | null;
  image_url: string | null;
  is_available: number;
  is_active: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DrinkStockAdjustment {
  id: number;
  drink_id: number;
  drink_name?: string;
  adjustment_type: 'OPENING' | 'RESTOCK' | 'REDUCTION' | 'SALE' | 'SALE_EDIT' | 'SALE_CANCEL';
  delta_qty: number;
  previous_stock: number;
  new_stock: number;
  reason: string | null;
  created_by: string;
  created_at: string;
}

export interface DrinkSaleItem {
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

export interface DrinkSaleAuditLog {
  id: number;
  sale_id: number;
  action: 'CREATED' | 'EDITED' | 'CANCELLED';
  summary: string;
  actor_username: string;
  created_at: string;
}

export interface DrinkExpenseItem {
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

export interface ProductAnalyticsItem {
  id: number;
  name: string;
  category: DrinkCategory;
  brand: string;
  bottle_size: string;
  purchase_price_pkr: number;
  selling_price_pkr: number;
  opening_stock: number;
  current_stock: number;
  min_stock_alert: number;
  is_active: number;
  qty_sold: number;
  revenue_pkr: number;
  cogs_pkr: number;
  profit_pkr: number;
  remaining_cost_value_pkr: number;
  remaining_retail_value_pkr: number;
  stock_status: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'IN_STOCK';
}

export interface CategoryReportItem {
  category: DrinkCategory;
  label: string;
  product_count: number;
  items_sold: number;
  items_remaining: number;
  revenue_pkr: number;
  cogs_pkr: number;
  gross_profit_pkr: number;
  inventory_cost_value_pkr: number;
}

export interface DrinksAnalyticsReport {
  filters: {
    from: string | null;
    to: string | null;
    category: string | null;
    drinkId: number | null;
  };
  kpis: {
    totalSalesCount: number;
    totalProducts: number;
    activeProducts: number;
    totalItemsSold: number;
    totalItemsRemaining: number;
    totalRevenuePkr: number;
    totalPurchaseCostPkr: number;
    grossProfitPkr: number;
    totalExpensesPkr: number;
    netProfitPkr: number;
    totalProfitPkr: number;
    totalLossPkr: number;
    remainingInventoryCostValuePkr: number;
    remainingInventoryRetailValuePkr: number;
    outOfStockCount: number;
    lowStockCount: number;
    zeroSalesProductsCount: number;
  };
  productReport: ProductAnalyticsItem[];
  soldProducts: ProductAnalyticsItem[];
  unsoldProducts: ProductAnalyticsItem[];
  lowStockProducts: ProductAnalyticsItem[];
  outOfStockProducts: ProductAnalyticsItem[];
  categoryReport: CategoryReportItem[];
  recentAdjustments: DrinkStockAdjustment[];
  recentSaleLogs: DrinkSaleAuditLog[];
}

export interface DrinkReportFilterParams {
  from?: string;
  to?: string;
  category?: string;
  drinkId?: number;
}

function buildQueryString(params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== '' && val !== null) {
      search.set(key, String(val));
    }
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}

export async function fetchAdminDrinks(): Promise<DrinkItem[]> {
  const data = await apiRequest<{ drinks?: DrinkItem[] }>('/api/admin/drinks');
  return data.drinks ?? [];
}

export async function createAdminDrink(payload: {
  name: string;
  category: DrinkCategory;
  brand?: string;
  bottleSize?: string;
  purchasePricePkr: number;
  pricePkr: number;
  openingStock: number;
  currentStock?: number;
  minStockAlert?: number;
  description?: string;
  imageUrl?: string;
  isActive?: boolean;
}): Promise<DrinkItem> {
  const data = await apiRequest<{ drink: DrinkItem }>('/api/admin/drinks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return data.drink;
}

export async function updateAdminDrink(
  id: number,
  payload: {
    name?: string;
    category?: DrinkCategory;
    brand?: string;
    bottleSize?: string;
    purchasePricePkr?: number;
    pricePkr?: number;
    openingStock?: number;
    currentStock?: number;
    minStockAlert?: number;
    description?: string | null;
    imageUrl?: string | null;
    isActive?: boolean;
  }
): Promise<DrinkItem> {
  const data = await apiRequest<{ drink: DrinkItem }>(`/api/admin/drinks/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return data.drink;
}

export async function adjustAdminDrinkStock(
  id: number,
  payload: { deltaQty: number; reason?: string }
): Promise<{ drink: DrinkItem; adjustment: DrinkStockAdjustment }> {
  return apiRequest<{ drink: DrinkItem; adjustment: DrinkStockAdjustment }>(
    `/api/admin/drinks/${id}/adjust-stock`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
}

export async function deleteAdminDrink(id: number): Promise<void> {
  await apiRequest<{ ok: boolean }>(`/api/admin/drinks/${id}`, {
    method: 'DELETE',
  });
}

export async function fetchAdminDrinkSales(
  filters?: DrinkReportFilterParams & { includeCancelled?: boolean }
): Promise<DrinkSaleItem[]> {
  const qs = buildQueryString(filters as Record<string, string | number | boolean | undefined>);
  const data = await apiRequest<{ sales?: DrinkSaleItem[] }>(`/api/admin/drinks/sales${qs}`);
  return data.sales ?? [];
}

export async function createAdminDrinkSale(payload: {
  drinkId: number;
  quantity: number;
  unitSellingPricePkr?: number;
  unitPurchasePricePkr?: number;
  soldAt?: string;
  notes?: string;
}): Promise<DrinkSaleItem> {
  const data = await apiRequest<{ sale: DrinkSaleItem }>('/api/admin/drinks/sales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return data.sale;
}

export async function updateAdminDrinkSale(
  saleId: number,
  payload: {
    quantity?: number;
    unitSellingPricePkr?: number;
    unitPurchasePricePkr?: number;
    soldAt?: string;
    notes?: string | null;
  }
): Promise<DrinkSaleItem> {
  const data = await apiRequest<{ sale: DrinkSaleItem }>(`/api/admin/drinks/sales/${saleId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return data.sale;
}

export async function cancelAdminDrinkSale(
  saleId: number,
  reason?: string
): Promise<DrinkSaleItem> {
  const data = await apiRequest<{ sale: DrinkSaleItem }>(
    `/api/admin/drinks/sales/${saleId}/cancel`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    }
  );
  return data.sale;
}

export async function fetchAdminDrinkExpenses(
  filters?: Pick<DrinkReportFilterParams, 'from' | 'to'>
): Promise<DrinkExpenseItem[]> {
  const qs = buildQueryString(filters);
  const data = await apiRequest<{ expenses?: DrinkExpenseItem[] }>(
    `/api/admin/drinks/expenses${qs}`
  );
  return data.expenses ?? [];
}

export async function createAdminDrinkExpense(payload: {
  title: string;
  amountPkr: number;
  expenseDate: string;
  description?: string;
}): Promise<DrinkExpenseItem> {
  const data = await apiRequest<{ expense: DrinkExpenseItem }>('/api/admin/drinks/expenses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return data.expense;
}

export async function deleteAdminDrinkExpense(expenseId: number): Promise<void> {
  await apiRequest<{ ok: boolean }>(`/api/admin/drinks/expenses/${expenseId}`, {
    method: 'DELETE',
  });
}

export async function fetchAdminDrinksReports(
  filters?: DrinkReportFilterParams
): Promise<DrinksAnalyticsReport> {
  const qs = buildQueryString(filters as Record<string, string | number | boolean | undefined>);
  return apiRequest<DrinksAnalyticsReport>(`/api/admin/drinks/reports${qs}`);
}
