import { isValidIsoDate, getKarachiNow } from '../utils/time.ts';
import { ServiceError } from './bookingService.ts';
import { readCollection, updateCollection, withNamedLock } from '../storage/jsonStore.ts';
import type {
  DrinkCategory,
  DrinkExpenseRecord,
  DrinkProductRecord,
  DrinkSaleAuditLogRecord,
  DrinkSaleRecord,
  DrinkStockAdjustmentRecord,
  DrinkStockLevelRecord,
} from '../storage/types.ts';

export type { DrinkCategory };

export interface DrinkRow {
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

export interface DrinkStockAdjustmentRow {
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

export interface DrinkSaleRow {
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

export interface DrinkSaleAuditLogRow {
  id: number;
  sale_id: number;
  action: 'CREATED' | 'EDITED' | 'CANCELLED';
  summary: string;
  actor_username: string;
  created_at: string;
}

export interface DrinkExpenseRow {
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

export interface ProductAnalyticsRow {
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

export interface CategoryReportRow {
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
  productReport: ProductAnalyticsRow[];
  soldProducts: ProductAnalyticsRow[];
  unsoldProducts: ProductAnalyticsRow[];
  lowStockProducts: ProductAnalyticsRow[];
  outOfStockProducts: ProductAnalyticsRow[];
  categoryReport: CategoryReportRow[];
  recentAdjustments: DrinkStockAdjustmentRow[];
  recentSaleLogs: DrinkSaleAuditLogRow[];
}

const VALID_CATEGORIES = new Set<string>(['cold_drinks', 'water', 'hydration_drinks']);
const CATEGORY_LABELS: Record<DrinkCategory, string> = {
  cold_drinks: 'Cold Drinks',
  water: 'Water',
  hydration_drinks: 'Hydration Drinks',
};
const MAX_IMAGE_DATA_URL_LENGTH = 600_000;

function sanitizeImageUrl(rawValue: unknown): string | null {
  if (typeof rawValue !== 'string') return null;
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('data:')) {
    if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
      throw new ServiceError(400, 'Uploaded image must be a valid PNG, JPG, WebP, or GIF image.');
    }
    if (trimmed.length > MAX_IMAGE_DATA_URL_LENGTH) {
      throw new ServiceError(400, 'Uploaded product image is too large. Please use a smaller image.');
    }
    return trimmed;
  }

  if (trimmed.startsWith('/')) {
    return trimmed.slice(0, 500);
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ServiceError(400, 'Image URL must use http://, https://, or an uploaded image.');
    }
    return parsed.toString().slice(0, 1000);
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    throw new ServiceError(400, 'Please provide a valid image URL or upload an image file.');
  }
}

function parseNonNegInt(value: unknown, label: string): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new ServiceError(400, `${label} must be a non-negative number.`);
  }
  return Math.round(num);
}

function parsePositiveInt(value: unknown, label: string): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    throw new ServiceError(400, `${label} must be greater than zero.`);
  }
  return Math.round(num);
}

function normalizeSoldAt(rawSoldAt: unknown): { soldAt: string; saleDate: string } {
  const karachiNow = getKarachiNow();
  if (typeof rawSoldAt !== 'string' || !rawSoldAt.trim()) {
    const hh = String(karachiNow.hours).padStart(2, '0');
    const mm = String(karachiNow.minutes).padStart(2, '0');
    return {
      soldAt: `${karachiNow.dateStr}T${hh}:${mm}`,
      saleDate: karachiNow.dateStr,
    };
  }
  const trimmed = rawSoldAt.trim();
  const datePart = trimmed.slice(0, 10);
  if (!isValidIsoDate(datePart)) {
    throw new ServiceError(400, 'Invalid sale date/time.');
  }
  return {
    soldAt: trimmed.slice(0, 32),
    saleDate: datePart,
  };
}

function combineProductWithStock(
  product: DrinkProductRecord,
  stockLevel?: DrinkStockLevelRecord
): DrinkRow {
  const currentStock = stockLevel?.current_stock ?? 0;
  const openingStock = stockLevel?.opening_stock ?? 0;
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    brand: product.brand,
    bottle_size: product.bottle_size,
    purchase_price_pkr: product.purchase_price_pkr,
    price_pkr: product.price_pkr,
    opening_stock: openingStock,
    current_stock: currentStock,
    min_stock_alert: product.min_stock_alert,
    description: product.description,
    image_url: product.image_url,
    is_available: currentStock > 0 ? 1 : 0,
    is_active: product.is_active,
    created_by: product.created_by,
    updated_by: product.updated_by,
    created_at: product.created_at,
    updated_at: product.updated_at,
  };
}

export async function getAllDrinksAdmin(): Promise<DrinkRow[]> {
  const [productsDoc, inventoryDoc] = await Promise.all([
    readCollection('products'),
    readCollection('inventory'),
  ]);

  const stockMap = new Map<number, DrinkStockLevelRecord>();
  for (const sl of inventoryDoc.stockLevels) {
    stockMap.set(sl.drink_id, sl);
  }

  const rows = productsDoc.records.map((p) =>
    combineProductWithStock(p, stockMap.get(p.id))
  );

  return rows.sort((a, b) => {
    if (a.category !== b.category) {
      return a.category.localeCompare(b.category);
    }
    return a.name.localeCompare(b.name);
  });
}

export async function createDrink(
  raw: Record<string, unknown>,
  actorUsername = 'admin'
): Promise<DrinkRow> {
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const category = (typeof raw.category === 'string' ? raw.category.trim() : '') as DrinkCategory;
  const brand = typeof raw.brand === 'string' ? raw.brand.trim().slice(0, 80) : '';
  const bottleSize =
    typeof raw.bottleSize === 'string'
      ? raw.bottleSize.trim().slice(0, 40)
      : typeof raw.bottle_size === 'string'
      ? raw.bottle_size.trim().slice(0, 40)
      : '';
  const purchasePricePkr = parseNonNegInt(
    raw.purchasePricePkr ?? raw.purchase_price_pkr ?? 0,
    'Purchase price'
  );
  const sellingPricePkr = parsePositiveInt(
    raw.sellingPricePkr ?? raw.pricePkr ?? raw.price_pkr,
    'Selling price'
  );
  const openingStock = parseNonNegInt(
    raw.openingStock ?? raw.opening_stock ?? 0,
    'Opening stock'
  );
  const currentStock =
    raw.currentStock !== undefined || raw.current_stock !== undefined
      ? parseNonNegInt(raw.currentStock ?? raw.current_stock, 'Current stock')
      : openingStock;
  const minStockAlert = parseNonNegInt(
    raw.minStockAlert ?? raw.min_stock_alert ?? 5,
    'Minimum stock alert'
  );
  const description = typeof raw.description === 'string' ? raw.description.trim() || null : null;
  const imageUrl = sanitizeImageUrl(raw.imageUrl !== undefined ? raw.imageUrl : raw.image_url);
  const isActive = raw.isActive === false || raw.is_active === 0 ? 0 : 1;

  if (name.length < 2 || name.length > 80) {
    throw new ServiceError(400, 'Product name must be between 2 and 80 characters.');
  }
  if (!VALID_CATEGORIES.has(category)) {
    throw new ServiceError(
      400,
      'Invalid category. Must be cold_drinks, water, or hydration_drinks.'
    );
  }

  return withNamedLock('drinks:tx', async () => {
    const nowIso = new Date().toISOString();

    let createdProduct!: DrinkProductRecord;

    await updateCollection('products', (draft) => {
      const newId = draft.nextId++;
      createdProduct = {
        id: newId,
        name,
        category,
        brand,
        bottle_size: bottleSize,
        purchase_price_pkr: purchasePricePkr,
        price_pkr: sellingPricePkr,
        min_stock_alert: minStockAlert,
        description,
        image_url: imageUrl,
        is_active: isActive,
        created_by: actorUsername,
        updated_by: actorUsername,
        created_at: nowIso,
        updated_at: nowIso,
      };
      draft.records.push(createdProduct);
    });

    let createdStockLevel!: DrinkStockLevelRecord;

    try {
      await updateCollection('inventory', (draft) => {
        createdStockLevel = {
          drink_id: createdProduct.id,
          opening_stock: openingStock,
          current_stock: currentStock,
          min_stock_alert: minStockAlert,
          is_available: currentStock > 0 ? 1 : 0,
          updated_by: actorUsername,
          updated_at: nowIso,
        };
        draft.stockLevels.push(createdStockLevel);

        if (currentStock > 0) {
          draft.adjustments.push({
            id: draft.nextAdjustmentId++,
            drink_id: createdProduct.id,
            adjustment_type: 'OPENING',
            delta_qty: currentStock,
            previous_stock: 0,
            new_stock: currentStock,
            reason: 'Initial product opening stock',
            created_by: actorUsername,
            created_at: nowIso,
          });
        }
      });
    } catch (err) {
      await updateCollection('products', (draft) => {
        const idx = draft.records.findIndex((p) => p.id === createdProduct.id);
        if (idx !== -1) draft.records.splice(idx, 1);
      }).catch(() => undefined);
      throw err;
    }

    return combineProductWithStock(createdProduct, createdStockLevel);
  });
}

export async function updateDrink(
  id: number,
  raw: Record<string, unknown>,
  actorUsername = 'admin'
): Promise<DrinkRow> {
  return withNamedLock('drinks:tx', async () => {
    const [productsDoc, inventoryDoc] = await Promise.all([
      readCollection('products'),
      readCollection('inventory'),
    ]);

    const existing = productsDoc.records.find((p) => p.id === id);
    if (!existing) {
      throw new ServiceError(404, 'Product not found.');
    }

    const existingStock = inventoryDoc.stockLevels.find((s) => s.drink_id === id);
    const currentStockBefore = existingStock?.current_stock ?? 0;
    const openingStockBefore = existingStock?.opening_stock ?? 0;

    const name = typeof raw.name === 'string' ? raw.name.trim() : existing.name;
    const category = (
      typeof raw.category === 'string' ? raw.category.trim() : existing.category
    ) as DrinkCategory;
    const brand =
      typeof raw.brand === 'string' ? raw.brand.trim().slice(0, 80) : existing.brand;
    const bottleSize =
      typeof raw.bottleSize === 'string'
        ? raw.bottleSize.trim().slice(0, 40)
        : typeof raw.bottle_size === 'string'
        ? raw.bottle_size.trim().slice(0, 40)
        : existing.bottle_size;
    const purchasePricePkr =
      raw.purchasePricePkr !== undefined || raw.purchase_price_pkr !== undefined
        ? parseNonNegInt(raw.purchasePricePkr ?? raw.purchase_price_pkr, 'Purchase price')
        : existing.purchase_price_pkr;
    const sellingPricePkr =
      raw.sellingPricePkr !== undefined || raw.pricePkr !== undefined || raw.price_pkr !== undefined
        ? parsePositiveInt(
            raw.sellingPricePkr ?? raw.pricePkr ?? raw.price_pkr,
            'Selling price'
          )
        : existing.price_pkr;
    const openingStock =
      raw.openingStock !== undefined || raw.opening_stock !== undefined
        ? parseNonNegInt(raw.openingStock ?? raw.opening_stock, 'Opening stock')
        : openingStockBefore;
    const currentStock =
      raw.currentStock !== undefined || raw.current_stock !== undefined
        ? parseNonNegInt(raw.currentStock ?? raw.current_stock, 'Current stock')
        : currentStockBefore;
    const minStockAlert =
      raw.minStockAlert !== undefined || raw.min_stock_alert !== undefined
        ? parseNonNegInt(raw.minStockAlert ?? raw.min_stock_alert, 'Minimum stock alert')
        : existing.min_stock_alert;
    const description =
      raw.description !== undefined
        ? typeof raw.description === 'string'
          ? raw.description.trim() || null
          : null
        : existing.description;
    const imageUrl =
      raw.imageUrl !== undefined
        ? sanitizeImageUrl(raw.imageUrl)
        : raw.image_url !== undefined
        ? sanitizeImageUrl(raw.image_url)
        : existing.image_url;
    const isActive =
      raw.isActive !== undefined
        ? raw.isActive
          ? 1
          : 0
        : raw.is_active !== undefined
        ? raw.is_active
          ? 1
          : 0
        : existing.is_active;

    if (name.length < 2 || name.length > 80) {
      throw new ServiceError(400, 'Product name must be between 2 and 80 characters.');
    }
    if (!VALID_CATEGORIES.has(category)) {
      throw new ServiceError(400, 'Invalid category.');
    }

    const nowIso = new Date().toISOString();

    let updatedProduct!: DrinkProductRecord;
    await updateCollection('products', (draft) => {
      const idx = draft.records.findIndex((p) => p.id === id);
      if (idx === -1) {
        throw new ServiceError(404, 'Product not found.');
      }
      draft.records[idx] = {
        ...draft.records[idx],
        name,
        category,
        brand,
        bottle_size: bottleSize,
        purchase_price_pkr: purchasePricePkr,
        price_pkr: sellingPricePkr,
        min_stock_alert: minStockAlert,
        description,
        image_url: imageUrl,
        is_active: isActive,
        updated_by: actorUsername,
        updated_at: nowIso,
      };
      updatedProduct = draft.records[idx];
    });

    let updatedStock!: DrinkStockLevelRecord;
    await updateCollection('inventory', (draft) => {
      let sl = draft.stockLevels.find((s) => s.drink_id === id);
      const prevStock = sl ? sl.current_stock : 0;
      if (!sl) {
        sl = {
          drink_id: id,
          opening_stock: openingStock,
          current_stock: currentStock,
          min_stock_alert: minStockAlert,
          is_available: currentStock > 0 ? 1 : 0,
          updated_by: actorUsername,
          updated_at: nowIso,
        };
        draft.stockLevels.push(sl);
      } else {
        sl.opening_stock = openingStock;
        sl.current_stock = currentStock;
        sl.min_stock_alert = minStockAlert;
        sl.is_available = currentStock > 0 ? 1 : 0;
        sl.updated_by = actorUsername;
        sl.updated_at = nowIso;
      }
      updatedStock = { ...sl };

      if (currentStock !== prevStock) {
        const delta = currentStock - prevStock;
        draft.adjustments.push({
          id: draft.nextAdjustmentId++,
          drink_id: id,
          adjustment_type: delta >= 0 ? 'RESTOCK' : 'REDUCTION',
          delta_qty: delta,
          previous_stock: prevStock,
          new_stock: currentStock,
          reason: 'Manual stock edit in product form',
          created_by: actorUsername,
          created_at: nowIso,
        });
      }
    });

    return combineProductWithStock(updatedProduct, updatedStock);
  });
}

export async function adjustDrinkStock(
  id: number,
  raw: Record<string, unknown>,
  actorUsername = 'admin'
): Promise<{ drink: DrinkRow; adjustment: DrinkStockAdjustmentRow }> {
  const deltaQty = Math.trunc(Number(raw.deltaQty ?? raw.delta_qty));
  const reason =
    typeof raw.reason === 'string' && raw.reason.trim()
      ? raw.reason.trim().slice(0, 200)
      : deltaQty >= 0
      ? 'Stock restocked'
      : 'Manual stock reduction';

  if (!Number.isFinite(deltaQty) || deltaQty === 0) {
    throw new ServiceError(400, 'Stock adjustment quantity must be a non-zero integer.');
  }

  return withNamedLock('drinks:tx', async () => {
    const productsDoc = await readCollection('products');
    const product = productsDoc.records.find((p) => p.id === id);
    if (!product) {
      throw new ServiceError(404, 'Product not found.');
    }

    const nowIso = new Date().toISOString();
    let createdAdjustment!: DrinkStockAdjustmentRecord;
    let updatedStockLevel!: DrinkStockLevelRecord;

    await updateCollection('inventory', (draft) => {
      let sl = draft.stockLevels.find((s) => s.drink_id === id);
      if (!sl) {
        sl = {
          drink_id: id,
          opening_stock: 0,
          current_stock: 0,
          min_stock_alert: product.min_stock_alert,
          is_available: 0,
          updated_by: actorUsername,
          updated_at: nowIso,
        };
        draft.stockLevels.push(sl);
      }

      const nextStock = sl.current_stock + deltaQty;
      if (nextStock < 0) {
        throw new ServiceError(
          400,
          `Cannot reduce stock below 0 (current stock is ${sl.current_stock}).`
        );
      }

      const prevStock = sl.current_stock;
      sl.current_stock = nextStock;
      sl.is_available = nextStock > 0 ? 1 : 0;
      sl.updated_by = actorUsername;
      sl.updated_at = nowIso;
      updatedStockLevel = { ...sl };

      createdAdjustment = {
        id: draft.nextAdjustmentId++,
        drink_id: id,
        adjustment_type: deltaQty > 0 ? 'RESTOCK' : 'REDUCTION',
        delta_qty: deltaQty,
        previous_stock: prevStock,
        new_stock: nextStock,
        reason,
        created_by: actorUsername,
        created_at: nowIso,
      };
      draft.adjustments.push(createdAdjustment);
    });

    const drink = combineProductWithStock(product, updatedStockLevel);
    const adjustment: DrinkStockAdjustmentRow = {
      ...createdAdjustment,
      drink_name: product.name,
    };

    return { drink, adjustment };
  });
}

export async function deleteDrink(id: number): Promise<void> {
  return withNamedLock('drinks:tx', async () => {
    const [productsDoc, salesDoc] = await Promise.all([
      readCollection('products'),
      readCollection('sales'),
    ]);

    const product = productsDoc.records.find((p) => p.id === id);
    if (!product) {
      throw new ServiceError(404, 'Product not found.');
    }

    const hasSalesHistory = salesDoc.records.some((s) => s.drink_id === id);
    if (hasSalesHistory) {
      throw new ServiceError(
        409,
        'Cannot delete a product that has recorded sales history. Mark it Inactive instead to preserve accounting records.'
      );
    }

    await updateCollection('products', (draft) => {
      const idx = draft.records.findIndex((p) => p.id === id);
      if (idx !== -1) {
        draft.records.splice(idx, 1);
      }
    });

    await updateCollection('inventory', (draft) => {
      const idx = draft.stockLevels.findIndex((s) => s.drink_id === id);
      if (idx !== -1) {
        draft.stockLevels.splice(idx, 1);
      }
    });
  });
}

export async function getDrinkSales(filters?: {
  from?: string;
  to?: string;
  category?: string;
  drinkId?: number;
  includeCancelled?: boolean;
}): Promise<DrinkSaleRow[]> {
  const salesDoc = await readCollection('sales');
  let filtered = salesDoc.records;

  if (filters?.from && isValidIsoDate(filters.from)) {
    filtered = filtered.filter((s) => s.sale_date >= filters.from!);
  }
  if (filters?.to && isValidIsoDate(filters.to)) {
    filtered = filtered.filter((s) => s.sale_date <= filters.to!);
  }
  if (filters?.category && VALID_CATEGORIES.has(filters.category)) {
    filtered = filtered.filter((s) => s.category === filters.category);
  }
  if (filters?.drinkId && Number.isFinite(filters.drinkId)) {
    filtered = filtered.filter((s) => s.drink_id === filters.drinkId);
  }
  if (filters?.includeCancelled === false) {
    filtered = filtered.filter((s) => s.status === 'COMPLETED');
  }

  filtered.sort((a, b) => {
    if (a.sale_date !== b.sale_date) {
      return b.sale_date.localeCompare(a.sale_date);
    }
    return b.id - a.id;
  });

  return filtered.slice(0, 500);
}

export async function createDrinkSale(
  raw: Record<string, unknown>,
  actorUsername = 'admin'
): Promise<DrinkSaleRow> {
  const drinkId = Number(raw.drinkId ?? raw.drink_id);
  const quantity = parsePositiveInt(raw.quantity, 'Quantity sold');
  const { soldAt, saleDate } = normalizeSoldAt(raw.soldAt ?? raw.sold_at);
  const notes =
    typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes.trim().slice(0, 250) : null;

  if (!Number.isFinite(drinkId) || drinkId <= 0) {
    throw new ServiceError(400, 'Please select a valid product.');
  }

  return withNamedLock('drinks:tx', async () => {
    const productsDoc = await readCollection('products');
    const product = productsDoc.records.find((p) => p.id === drinkId);
    if (!product) {
      throw new ServiceError(404, 'Selected product not found.');
    }
    if (product.is_active !== 1) {
      throw new ServiceError(
        400,
        `"${product.name}" is inactive. Activate it before recording a sale.`
      );
    }

    const unitSellingPricePkr =
      raw.unitSellingPricePkr !== undefined || raw.unit_selling_price_pkr !== undefined
        ? parseNonNegInt(
            raw.unitSellingPricePkr ?? raw.unit_selling_price_pkr,
            'Selling price per unit'
          )
        : product.price_pkr;
    const unitPurchasePricePkr =
      raw.unitPurchasePricePkr !== undefined || raw.unit_purchase_price_pkr !== undefined
        ? parseNonNegInt(
            raw.unitPurchasePricePkr ?? raw.unit_purchase_price_pkr,
            'Purchase cost per unit'
          )
        : product.purchase_price_pkr;

    const totalSalePkr = unitSellingPricePkr * quantity;
    const totalCostPkr = unitPurchasePricePkr * quantity;
    const profitPkr = totalSalePkr - totalCostPkr;
    const nowIso = new Date().toISOString();

    let deductionAdjustmentId = 0;

    // Atomically validate and deduct stock inside inventory CAS updater first
    await updateCollection('inventory', (draft) => {
      let sl = draft.stockLevels.find((s) => s.drink_id === product.id);
      const currentStock = sl?.current_stock ?? 0;
      if (quantity > currentStock) {
        throw new ServiceError(
          400,
          `Insufficient stock for "${product.name}". Available: ${currentStock}, Requested: ${quantity}.`
        );
      }

      const nextStock = currentStock - quantity;
      if (!sl) {
        sl = {
          drink_id: product.id,
          opening_stock: 0,
          current_stock: nextStock,
          min_stock_alert: product.min_stock_alert,
          is_available: nextStock > 0 ? 1 : 0,
          updated_by: actorUsername,
          updated_at: nowIso,
        };
        draft.stockLevels.push(sl);
      } else {
        sl.current_stock = nextStock;
        sl.is_available = nextStock > 0 ? 1 : 0;
        sl.updated_by = actorUsername;
        sl.updated_at = nowIso;
      }

      deductionAdjustmentId = draft.nextAdjustmentId++;
      draft.adjustments.push({
        id: deductionAdjustmentId,
        drink_id: product.id,
        adjustment_type: 'SALE',
        delta_qty: -quantity,
        previous_stock: currentStock,
        new_stock: nextStock,
        reason: `Sale recorded (${quantity} unit${quantity === 1 ? '' : 's'})`,
        created_by: actorUsername,
        created_at: nowIso,
      });
    });

    let createdSale!: DrinkSaleRecord;
    try {
      await updateCollection('sales', (draft) => {
        const saleId = draft.nextSaleId++;
        createdSale = {
          id: saleId,
          drink_id: product.id,
          product_name: product.name,
          category: product.category,
          quantity,
          unit_selling_price_pkr: unitSellingPricePkr,
          total_sale_pkr: totalSalePkr,
          unit_purchase_price_pkr: unitPurchasePricePkr,
          total_cost_pkr: totalCostPkr,
          profit_pkr: profitPkr,
          sold_at: soldAt,
          sale_date: saleDate,
          notes,
          status: 'COMPLETED',
          created_by: actorUsername,
          updated_by: actorUsername,
          cancelled_by: null,
          cancel_reason: null,
          created_at: nowIso,
          updated_at: nowIso,
          cancelled_at: null,
        };
        draft.records.push(createdSale);

        draft.auditLogs.push({
          id: draft.nextAuditLogId++,
          sale_id: saleId,
          action: 'CREATED',
          summary: `Recorded sale of ${quantity} x ${product.name} @ PKR ${unitSellingPricePkr} (Total PKR ${totalSalePkr}, Profit PKR ${profitPkr}).`,
          actor_username: actorUsername,
          created_at: nowIso,
        });
      });
    } catch (err) {
      // Compensate inventory deduction if saving sales.json failed
      await updateCollection(
        'inventory',
        (draft) => {
          const sl = draft.stockLevels.find((s) => s.drink_id === product.id);
          if (sl) {
            sl.current_stock += quantity;
            sl.is_available = sl.current_stock > 0 ? 1 : 0;
            sl.updated_at = new Date().toISOString();
          }
          const adjIdx = draft.adjustments.findIndex((a) => a.id === deductionAdjustmentId);
          if (adjIdx !== -1) {
            draft.adjustments.splice(adjIdx, 1);
          }
        },
        { skipBackup: true }
      ).catch(() => undefined);
      throw err;
    }

    return createdSale;
  });
}

export async function updateDrinkSale(
  saleId: number,
  raw: Record<string, unknown>,
  actorUsername = 'admin'
): Promise<DrinkSaleRow> {
  return withNamedLock('drinks:tx', async () => {
    const [salesDoc, productsDoc] = await Promise.all([
      readCollection('sales'),
      readCollection('products'),
    ]);

    const existingSale = salesDoc.records.find((s) => s.id === saleId);
    if (!existingSale) {
      throw new ServiceError(404, 'Sale record not found.');
    }
    if (existingSale.status === 'CANCELLED') {
      throw new ServiceError(400, 'Cancelled sales cannot be edited.');
    }

    const product = productsDoc.records.find((p) => p.id === existingSale.drink_id);
    if (!product) {
      throw new ServiceError(404, 'Associated product not found.');
    }

    const newQuantity =
      raw.quantity !== undefined
        ? parsePositiveInt(raw.quantity, 'Quantity sold')
        : existingSale.quantity;
    const unitSellingPricePkr =
      raw.unitSellingPricePkr !== undefined || raw.unit_selling_price_pkr !== undefined
        ? parseNonNegInt(
            raw.unitSellingPricePkr ?? raw.unit_selling_price_pkr,
            'Selling price per unit'
          )
        : existingSale.unit_selling_price_pkr;
    const unitPurchasePricePkr =
      raw.unitPurchasePricePkr !== undefined || raw.unit_purchase_price_pkr !== undefined
        ? parseNonNegInt(
            raw.unitPurchasePricePkr ?? raw.unit_purchase_price_pkr,
            'Purchase cost per unit'
          )
        : existingSale.unit_purchase_price_pkr;

    const { soldAt, saleDate } =
      raw.soldAt !== undefined || raw.sold_at !== undefined
        ? normalizeSoldAt(raw.soldAt ?? raw.sold_at)
        : { soldAt: existingSale.sold_at, saleDate: existingSale.sale_date };
    const notes =
      raw.notes !== undefined
        ? typeof raw.notes === 'string' && raw.notes.trim()
          ? raw.notes.trim().slice(0, 250)
          : null
        : existingSale.notes;

    const stockDelta = existingSale.quantity - newQuantity;
    const totalSalePkr = unitSellingPricePkr * newQuantity;
    const totalCostPkr = unitPurchasePricePkr * newQuantity;
    const profitPkr = totalSalePkr - totalCostPkr;
    const nowIso = new Date().toISOString();

    if (stockDelta !== 0) {
      await updateCollection('inventory', (draft) => {
        const sl = draft.stockLevels.find((s) => s.drink_id === product.id);
        const currentStock = sl?.current_stock ?? 0;
        const nextStock = currentStock + stockDelta;
        if (nextStock < 0) {
          throw new ServiceError(
            400,
            `Insufficient remaining stock to increase quantity to ${newQuantity}. Max possible: ${
              currentStock + existingSale.quantity
            }.`
          );
        }
        if (sl) {
          sl.current_stock = nextStock;
          sl.is_available = nextStock > 0 ? 1 : 0;
          sl.updated_by = actorUsername;
          sl.updated_at = nowIso;
        }
        draft.adjustments.push({
          id: draft.nextAdjustmentId++,
          drink_id: product.id,
          adjustment_type: 'SALE_EDIT',
          delta_qty: stockDelta,
          previous_stock: currentStock,
          new_stock: nextStock,
          reason: `Edited Sale #${saleId}: qty ${existingSale.quantity} -> ${newQuantity}`,
          created_by: actorUsername,
          created_at: nowIso,
        });
      });
    }

    let updatedSale!: DrinkSaleRecord;

    await updateCollection('sales', (draft) => {
      const s = draft.records.find((rec) => rec.id === saleId);
      if (!s) {
        throw new ServiceError(404, 'Sale record not found.');
      }
      s.quantity = newQuantity;
      s.unit_selling_price_pkr = unitSellingPricePkr;
      s.total_sale_pkr = totalSalePkr;
      s.unit_purchase_price_pkr = unitPurchasePricePkr;
      s.total_cost_pkr = totalCostPkr;
      s.profit_pkr = profitPkr;
      s.sold_at = soldAt;
      s.sale_date = saleDate;
      s.notes = notes;
      s.updated_by = actorUsername;
      s.updated_at = nowIso;
      updatedSale = { ...s };

      draft.auditLogs.push({
        id: draft.nextAuditLogId++,
        sale_id: saleId,
        action: 'EDITED',
        summary: `Edited sale #${saleId}: qty ${existingSale.quantity}->${newQuantity}, total PKR ${existingSale.total_sale_pkr}->PKR ${totalSalePkr}.`,
        actor_username: actorUsername,
        created_at: nowIso,
      });
    });

    return updatedSale;
  });
}

export async function cancelDrinkSale(
  saleId: number,
  reason: string | null,
  actorUsername = 'admin'
): Promise<DrinkSaleRow> {
  return withNamedLock('drinks:tx', async () => {
    const cleanReason =
      typeof reason === 'string' && reason.trim()
        ? reason.trim().slice(0, 200)
        : 'Sale cancelled by admin';

    const nowIso = new Date().toISOString();
    let cancelledSale!: DrinkSaleRecord;

    await updateCollection('sales', (draft) => {
      const s = draft.records.find((rec) => rec.id === saleId);
      if (!s) {
        throw new ServiceError(404, 'Sale record not found.');
      }
      if (s.status === 'CANCELLED') {
        throw new ServiceError(400, 'This sale has already been cancelled.');
      }
      s.status = 'CANCELLED';
      s.cancelled_by = actorUsername;
      s.cancel_reason = cleanReason;
      s.cancelled_at = nowIso;
      s.updated_by = actorUsername;
      s.updated_at = nowIso;
      cancelledSale = { ...s };

      draft.auditLogs.push({
        id: draft.nextAuditLogId++,
        sale_id: saleId,
        action: 'CANCELLED',
        summary: `Cancelled sale #${saleId} (${s.quantity} x ${s.product_name}) and restored stock. Reason: ${cleanReason}`,
        actor_username: actorUsername,
        created_at: nowIso,
      });
    });

    await updateCollection('inventory', (draft) => {
      const sl = draft.stockLevels.find((s) => s.drink_id === cancelledSale.drink_id);
      if (sl) {
        const restoredStock = sl.current_stock + cancelledSale.quantity;
        const prevStock = sl.current_stock;
        sl.current_stock = restoredStock;
        sl.is_available = restoredStock > 0 ? 1 : 0;
        sl.updated_by = actorUsername;
        sl.updated_at = nowIso;

        draft.adjustments.push({
          id: draft.nextAdjustmentId++,
          drink_id: cancelledSale.drink_id,
          adjustment_type: 'SALE_CANCEL',
          delta_qty: cancelledSale.quantity,
          previous_stock: prevStock,
          new_stock: restoredStock,
          reason: `Cancelled Sale #${saleId}: ${cleanReason}`,
          created_by: actorUsername,
          created_at: nowIso,
        });
      }
    });

    return cancelledSale;
  });
}

export async function getDrinkExpenses(filters?: {
  from?: string;
  to?: string;
}): Promise<DrinkExpenseRow[]> {
  const expensesDoc = await readCollection('expenses');
  let records = expensesDoc.records;

  if (filters?.from && isValidIsoDate(filters.from)) {
    records = records.filter((e) => e.expense_date >= filters.from!);
  }
  if (filters?.to && isValidIsoDate(filters.to)) {
    records = records.filter((e) => e.expense_date <= filters.to!);
  }

  records.sort((a, b) => {
    if (a.expense_date !== b.expense_date) {
      return b.expense_date.localeCompare(a.expense_date);
    }
    return b.id - a.id;
  });

  return records.slice(0, 300);
}

export async function createDrinkExpense(
  raw: Record<string, unknown>,
  actorUsername = 'admin'
): Promise<DrinkExpenseRow> {
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const amountPkr = parsePositiveInt(raw.amountPkr ?? raw.amount_pkr, 'Expense amount');
  const rawDate =
    typeof (raw.expenseDate ?? raw.expense_date) === 'string'
      ? String(raw.expenseDate ?? raw.expense_date).trim()
      : getKarachiNow().dateStr;
  const description =
    typeof raw.description === 'string' && raw.description.trim()
      ? raw.description.trim().slice(0, 250)
      : null;

  if (title.length < 2 || title.length > 100) {
    throw new ServiceError(400, 'Expense name must be between 2 and 100 characters.');
  }
  if (!isValidIsoDate(rawDate)) {
    throw new ServiceError(400, 'Invalid expense date.');
  }

  const nowIso = new Date().toISOString();
  let createdExpense!: DrinkExpenseRecord;

  await updateCollection('expenses', (draft) => {
    const id = draft.nextId++;
    createdExpense = {
      id,
      title,
      amount_pkr: amountPkr,
      expense_date: rawDate,
      description,
      created_by: actorUsername,
      updated_by: actorUsername,
      created_at: nowIso,
      updated_at: nowIso,
    };
    draft.records.push(createdExpense);
  });

  return createdExpense;
}

export async function deleteDrinkExpense(id: number): Promise<void> {
  await updateCollection('expenses', (draft) => {
    const idx = draft.records.findIndex((e) => e.id === id);
    if (idx === -1) {
      throw new ServiceError(404, 'Expense record not found.');
    }
    draft.records.splice(idx, 1);
  });
}

export async function getDrinksAnalyticsAndReports(filters?: {
  from?: string;
  to?: string;
  category?: string;
  drinkId?: number;
}): Promise<DrinksAnalyticsReport> {
  const [productsDoc, inventoryDoc, salesDoc, expensesDoc] = await Promise.all([
    readCollection('products'),
    readCollection('inventory'),
    readCollection('sales'),
    readCollection('expenses'),
  ]);

  const from = filters?.from && isValidIsoDate(filters.from) ? filters.from : null;
  const to = filters?.to && isValidIsoDate(filters.to) ? filters.to : null;
  const category =
    filters?.category && VALID_CATEGORIES.has(filters.category) ? filters.category : null;
  const drinkId =
    filters?.drinkId && Number.isFinite(filters.drinkId) ? Number(filters.drinkId) : null;

  const stockMap = new Map<number, DrinkStockLevelRecord>();
  for (const sl of inventoryDoc.stockLevels) {
    stockMap.set(sl.drink_id, sl);
  }

  let products = productsDoc.records.map((p) =>
    combineProductWithStock(p, stockMap.get(p.id))
  );

  if (category) {
    products = products.filter((p) => p.category === category);
  }
  if (drinkId) {
    products = products.filter((p) => p.id === drinkId);
  }

  products.sort((a, b) => {
    if (a.category !== b.category) {
      return a.category.localeCompare(b.category);
    }
    return a.name.localeCompare(b.name);
  });

  let sales = salesDoc.records.filter((s) => s.status === 'COMPLETED');
  if (from) {
    sales = sales.filter((s) => s.sale_date >= from);
  }
  if (to) {
    sales = sales.filter((s) => s.sale_date <= to);
  }
  if (category) {
    sales = sales.filter((s) => s.category === category);
  }
  if (drinkId) {
    sales = sales.filter((s) => s.drink_id === drinkId);
  }

  let expenses = expensesDoc.records;
  if (from) {
    expenses = expenses.filter((e) => e.expense_date >= from);
  }
  if (to) {
    expenses = expenses.filter((e) => e.expense_date <= to);
  }

  const salesByProduct = new Map<
    number,
    { qtySold: number; revenuePkr: number; cogsPkr: number; profitPkr: number }
  >();
  let totalItemsSold = 0;
  let totalRevenuePkr = 0;
  let totalPurchaseCostPkr = 0;
  let negativeItemSalesLossPkr = 0;

  for (const s of sales) {
    totalItemsSold += s.quantity;
    totalRevenuePkr += s.total_sale_pkr;
    totalPurchaseCostPkr += s.total_cost_pkr;
    if (s.profit_pkr < 0) {
      negativeItemSalesLossPkr += Math.abs(s.profit_pkr);
    }
    const prev = salesByProduct.get(s.drink_id) || {
      qtySold: 0,
      revenuePkr: 0,
      cogsPkr: 0,
      profitPkr: 0,
    };
    prev.qtySold += s.quantity;
    prev.revenuePkr += s.total_sale_pkr;
    prev.cogsPkr += s.total_cost_pkr;
    prev.profitPkr += s.profit_pkr;
    salesByProduct.set(s.drink_id, prev);
  }

  let totalExpensesPkr = 0;
  for (const e of expenses) {
    totalExpensesPkr += e.amount_pkr;
  }

  const grossProfitPkr = totalRevenuePkr - totalPurchaseCostPkr;
  const netProfitPkr = grossProfitPkr - totalExpensesPkr;
  const totalProfitPkr = netProfitPkr > 0 ? netProfitPkr : 0;
  const totalLossPkr =
    netProfitPkr < 0 ? Math.abs(netProfitPkr) : negativeItemSalesLossPkr;

  let totalItemsRemaining = 0;
  let remainingInventoryCostValuePkr = 0;
  let remainingInventoryRetailValuePkr = 0;
  let activeProducts = 0;
  let outOfStockCount = 0;
  let lowStockCount = 0;

  const productReport: ProductAnalyticsRow[] = products.map((p) => {
    const agg = salesByProduct.get(p.id) || {
      qtySold: 0,
      revenuePkr: 0,
      cogsPkr: 0,
      profitPkr: 0,
    };
    const remCostVal = p.current_stock * p.purchase_price_pkr;
    const remRetailVal = p.current_stock * p.price_pkr;
    totalItemsRemaining += p.current_stock;
    remainingInventoryCostValuePkr += remCostVal;
    remainingInventoryRetailValuePkr += remRetailVal;
    if (p.is_active === 1) activeProducts += 1;

    let stockStatus: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'IN_STOCK' = 'IN_STOCK';
    if (p.current_stock <= 0) {
      stockStatus = 'OUT_OF_STOCK';
      outOfStockCount += 1;
    } else if (p.current_stock <= p.min_stock_alert) {
      stockStatus = 'LOW_STOCK';
      lowStockCount += 1;
    }

    return {
      id: p.id,
      name: p.name,
      category: p.category,
      brand: p.brand,
      bottle_size: p.bottle_size,
      purchase_price_pkr: p.purchase_price_pkr,
      selling_price_pkr: p.price_pkr,
      opening_stock: p.opening_stock,
      current_stock: p.current_stock,
      min_stock_alert: p.min_stock_alert,
      is_active: p.is_active,
      qty_sold: agg.qtySold,
      revenue_pkr: agg.revenuePkr,
      cogs_pkr: agg.cogsPkr,
      profit_pkr: agg.profitPkr,
      remaining_cost_value_pkr: remCostVal,
      remaining_retail_value_pkr: remRetailVal,
      stock_status: stockStatus,
    };
  });

  const soldProducts = productReport.filter((p) => p.qty_sold > 0);
  const unsoldProducts = productReport.filter((p) => p.qty_sold === 0);
  const lowStockProducts = productReport.filter((p) => p.stock_status === 'LOW_STOCK');
  const outOfStockProducts = productReport.filter((p) => p.stock_status === 'OUT_OF_STOCK');

  const categoryReport: CategoryReportRow[] = (
    ['cold_drinks', 'water', 'hydration_drinks'] as DrinkCategory[]
  ).map((cat) => {
    const catProds = productReport.filter((p) => p.category === cat);
    return {
      category: cat,
      label: CATEGORY_LABELS[cat],
      product_count: catProds.length,
      items_sold: catProds.reduce((sum, p) => sum + p.qty_sold, 0),
      items_remaining: catProds.reduce((sum, p) => sum + p.current_stock, 0),
      revenue_pkr: catProds.reduce((sum, p) => sum + p.revenue_pkr, 0),
      cogs_pkr: catProds.reduce((sum, p) => sum + p.cogs_pkr, 0),
      gross_profit_pkr: catProds.reduce((sum, p) => sum + p.profit_pkr, 0),
      inventory_cost_value_pkr: catProds.reduce((sum, p) => sum + p.remaining_cost_value_pkr, 0),
    };
  });

  const productNameMap = new Map<number, string>();
  for (const p of productsDoc.records) {
    productNameMap.set(p.id, p.name);
  }

  const recentAdjustments: DrinkStockAdjustmentRow[] = inventoryDoc.adjustments
    .slice(-50)
    .reverse()
    .map((a) => ({
      ...a,
      drink_name: productNameMap.get(a.drink_id) || 'Unknown Drink',
    }));

  const recentSaleLogs: DrinkSaleAuditLogRow[] = salesDoc.auditLogs
    .slice(-50)
    .reverse();

  return {
    filters: { from, to, category, drinkId },
    kpis: {
      totalSalesCount: sales.length,
      totalProducts: products.length,
      activeProducts,
      totalItemsSold,
      totalItemsRemaining,
      totalRevenuePkr,
      totalPurchaseCostPkr,
      grossProfitPkr,
      totalExpensesPkr,
      netProfitPkr,
      totalProfitPkr,
      totalLossPkr,
      remainingInventoryCostValuePkr,
      remainingInventoryRetailValuePkr,
      outOfStockCount,
      lowStockCount,
      zeroSalesProductsCount: unsoldProducts.length,
    },
    productReport,
    soldProducts,
    unsoldProducts,
    lowStockProducts,
    outOfStockProducts,
    categoryReport,
    recentAdjustments,
    recentSaleLogs,
  };
}
