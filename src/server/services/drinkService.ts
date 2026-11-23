import { getDb } from '../db/sqlite.ts';
import { getKarachiNow, isValidIsoDate } from '../utils/time.ts';
import { ServiceError } from './bookingService.ts';

export type DrinkCategory = 'cold_drinks' | 'water' | 'hydration_drinks';

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

export function getAllDrinksAdmin(): DrinkRow[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM drinks ORDER BY category ASC, name ASC')
    .all() as unknown as DrinkRow[];
}

export function createDrink(raw: Record<string, unknown>, actorUsername = 'admin'): DrinkRow {
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const category = typeof raw.category === 'string' ? raw.category.trim() : '';
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
  const isAvailable = currentStock > 0 ? 1 : 0;

  if (name.length < 2 || name.length > 80) {
    throw new ServiceError(400, 'Product name must be between 2 and 80 characters.');
  }
  if (!VALID_CATEGORIES.has(category)) {
    throw new ServiceError(
      400,
      'Invalid category. Must be cold_drinks, water, or hydration_drinks.'
    );
  }

  const db = getDb();
  const nowIso = new Date().toISOString();

  let newId = 0;
  db.exec('BEGIN IMMEDIATE;');
  try {
    const info = db
      .prepare(
        `INSERT INTO drinks (
          name, category, brand, bottle_size, purchase_price_pkr, price_pkr,
          opening_stock, current_stock, min_stock_alert, description, image_url,
          is_available, is_active, created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        name,
        category,
        brand,
        bottleSize,
        purchasePricePkr,
        sellingPricePkr,
        openingStock,
        currentStock,
        minStockAlert,
        description,
        imageUrl,
        isAvailable,
        isActive,
        actorUsername,
        actorUsername,
        nowIso,
        nowIso
      );

    newId = Number(info.lastInsertRowid);

    if (currentStock > 0) {
      db.prepare(
        `INSERT INTO drink_stock_adjustments (
          drink_id, adjustment_type, delta_qty, previous_stock, new_stock, reason, created_by, created_at
        ) VALUES (?, 'OPENING', ?, 0, ?, 'Initial product opening stock', ?, ?)`
      ).run(newId, currentStock, currentStock, actorUsername, nowIso);
    }

    db.exec('COMMIT;');
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // Ignore rollback errors
    }
    throw err;
  }

  return db.prepare('SELECT * FROM drinks WHERE id = ?').get(newId) as unknown as DrinkRow;
}

export function updateDrink(
  id: number,
  raw: Record<string, unknown>,
  actorUsername = 'admin'
): DrinkRow {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM drinks WHERE id = ?')
    .get(id) as unknown as DrinkRow | undefined;
  if (!existing) {
    throw new ServiceError(404, 'Product not found.');
  }

  const name = typeof raw.name === 'string' ? raw.name.trim() : existing.name;
  const category = typeof raw.category === 'string' ? raw.category.trim() : existing.category;
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
      : existing.opening_stock;
  const currentStock =
    raw.currentStock !== undefined || raw.current_stock !== undefined
      ? parseNonNegInt(raw.currentStock ?? raw.current_stock, 'Current stock')
      : existing.current_stock;
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
  const isAvailable = currentStock > 0 ? 1 : 0;

  if (name.length < 2 || name.length > 80) {
    throw new ServiceError(400, 'Product name must be between 2 and 80 characters.');
  }
  if (!VALID_CATEGORIES.has(category)) {
    throw new ServiceError(400, 'Invalid category.');
  }

  const nowIso = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare(
      `UPDATE drinks
       SET name = ?, category = ?, brand = ?, bottle_size = ?,
           purchase_price_pkr = ?, price_pkr = ?, opening_stock = ?,
           current_stock = ?, min_stock_alert = ?, description = ?,
           image_url = ?, is_available = ?, is_active = ?,
           updated_by = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      name,
      category,
      brand,
      bottleSize,
      purchasePricePkr,
      sellingPricePkr,
      openingStock,
      currentStock,
      minStockAlert,
      description,
      imageUrl,
      isAvailable,
      isActive,
      actorUsername,
      nowIso,
      id
    );

    if (currentStock !== existing.current_stock) {
      const delta = currentStock - existing.current_stock;
      db.prepare(
        `INSERT INTO drink_stock_adjustments (
          drink_id, adjustment_type, delta_qty, previous_stock, new_stock, reason, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, 'Manual stock edit in product form', ?, ?)`
      ).run(
        id,
        delta >= 0 ? 'RESTOCK' : 'REDUCTION',
        delta,
        existing.current_stock,
        currentStock,
        actorUsername,
        nowIso
      );
    }
    db.exec('COMMIT;');
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // Ignore rollback errors
    }
    throw err;
  }

  return db.prepare('SELECT * FROM drinks WHERE id = ?').get(id) as unknown as DrinkRow;
}

export function adjustDrinkStock(
  id: number,
  raw: Record<string, unknown>,
  actorUsername = 'admin'
): { drink: DrinkRow; adjustment: DrinkStockAdjustmentRow } {
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

  const db = getDb();
  const nowIso = new Date().toISOString();
  let adjId = 0;

  db.exec('BEGIN IMMEDIATE;');
  try {
    const existing = db
      .prepare('SELECT * FROM drinks WHERE id = ?')
      .get(id) as unknown as DrinkRow | undefined;
    if (!existing) {
      db.exec('ROLLBACK;');
      throw new ServiceError(404, 'Product not found.');
    }

    const nextStock = existing.current_stock + deltaQty;
    if (nextStock < 0) {
      db.exec('ROLLBACK;');
      throw new ServiceError(
        400,
        `Cannot reduce stock below 0 (current stock is ${existing.current_stock}).`
      );
    }

    db.prepare(
      `UPDATE drinks SET current_stock = ?, is_available = ?, updated_by = ?, updated_at = ? WHERE id = ?`
    ).run(nextStock, nextStock > 0 ? 1 : 0, actorUsername, nowIso, id);

    const adjInfo = db
      .prepare(
        `INSERT INTO drink_stock_adjustments (
          drink_id, adjustment_type, delta_qty, previous_stock, new_stock, reason, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        deltaQty > 0 ? 'RESTOCK' : 'REDUCTION',
        deltaQty,
        existing.current_stock,
        nextStock,
        reason,
        actorUsername,
        nowIso
      );
    adjId = Number(adjInfo.lastInsertRowid);
    db.exec('COMMIT;');
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    try {
      db.exec('ROLLBACK;');
    } catch {
      // Ignore rollback errors
    }
    throw err;
  }

  const drink = db.prepare('SELECT * FROM drinks WHERE id = ?').get(id) as unknown as DrinkRow;
  const adjustment = db
    .prepare('SELECT * FROM drink_stock_adjustments WHERE id = ?')
    .get(adjId) as unknown as DrinkStockAdjustmentRow;

  return { drink, adjustment };
}

export function deleteDrink(id: number): void {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM drinks WHERE id = ?').get(id);
  if (!existing) {
    throw new ServiceError(404, 'Product not found.');
  }
  const salesCount = db
    .prepare('SELECT COUNT(*) AS count FROM drink_sales WHERE drink_id = ?')
    .get(id) as { count: number };
  if (salesCount.count > 0) {
    throw new ServiceError(
      409,
      'Cannot delete a product that has recorded sales history. Mark it Inactive instead to preserve accounting records.'
    );
  }
  db.prepare('DELETE FROM drinks WHERE id = ?').run(id);
}

export function getDrinkSales(filters?: {
  from?: string;
  to?: string;
  category?: string;
  drinkId?: number;
  includeCancelled?: boolean;
}): DrinkSaleRow[] {
  const db = getDb();
  const where: string[] = [];
  const params: Array<string | number> = [];

  if (filters?.from && isValidIsoDate(filters.from)) {
    where.push('sale_date >= ?');
    params.push(filters.from);
  }
  if (filters?.to && isValidIsoDate(filters.to)) {
    where.push('sale_date <= ?');
    params.push(filters.to);
  }
  if (filters?.category && VALID_CATEGORIES.has(filters.category)) {
    where.push('category = ?');
    params.push(filters.category);
  }
  if (filters?.drinkId && Number.isFinite(filters.drinkId)) {
    where.push('drink_id = ?');
    params.push(filters.drinkId);
  }
  if (filters?.includeCancelled === false) {
    where.push("status = 'COMPLETED'");
  }

  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  return db
    .prepare(`SELECT * FROM drink_sales ${clause} ORDER BY sale_date DESC, id DESC LIMIT 500`)
    .all(...params) as unknown as DrinkSaleRow[];
}

export function createDrinkSale(
  raw: Record<string, unknown>,
  actorUsername = 'admin'
): DrinkSaleRow {
  const drinkId = Number(raw.drinkId ?? raw.drink_id);
  const quantity = parsePositiveInt(raw.quantity, 'Quantity sold');
  const { soldAt, saleDate } = normalizeSoldAt(raw.soldAt ?? raw.sold_at);
  const notes = typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes.trim().slice(0, 250) : null;

  if (!Number.isFinite(drinkId) || drinkId <= 0) {
    throw new ServiceError(400, 'Please select a valid product.');
  }

  const db = getDb();
  const nowIso = new Date().toISOString();
  let newSaleId = 0;

  db.exec('BEGIN IMMEDIATE;');
  try {
    const product = db
      .prepare('SELECT * FROM drinks WHERE id = ?')
      .get(drinkId) as unknown as DrinkRow | undefined;

    if (!product) {
      db.exec('ROLLBACK;');
      throw new ServiceError(404, 'Selected product not found.');
    }
    if (product.is_active !== 1) {
      db.exec('ROLLBACK;');
      throw new ServiceError(400, `"${product.name}" is inactive. Activate it before recording a sale.`);
    }
    if (quantity > product.current_stock) {
      db.exec('ROLLBACK;');
      throw new ServiceError(
        400,
        `Insufficient stock for "${product.name}". Available: ${product.current_stock}, Requested: ${quantity}.`
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
    const nextStock = product.current_stock - quantity;

    const saleInfo = db
      .prepare(
        `INSERT INTO drink_sales (
          drink_id, product_name, category, quantity,
          unit_selling_price_pkr, total_sale_pkr, unit_purchase_price_pkr, total_cost_pkr, profit_pkr,
          sold_at, sale_date, notes, status, created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?)`
      )
      .run(
        product.id,
        product.name,
        product.category,
        quantity,
        unitSellingPricePkr,
        totalSalePkr,
        unitPurchasePricePkr,
        totalCostPkr,
        profitPkr,
        soldAt,
        saleDate,
        notes,
        actorUsername,
        actorUsername,
        nowIso,
        nowIso
      );
    newSaleId = Number(saleInfo.lastInsertRowid);

    db.prepare(
      `UPDATE drinks SET current_stock = ?, is_available = ?, updated_by = ?, updated_at = ? WHERE id = ?`
    ).run(nextStock, nextStock > 0 ? 1 : 0, actorUsername, nowIso, product.id);

    db.prepare(
      `INSERT INTO drink_stock_adjustments (
        drink_id, adjustment_type, delta_qty, previous_stock, new_stock, reason, created_by, created_at
      ) VALUES (?, 'SALE', ?, ?, ?, ?, ?, ?)`
    ).run(
      product.id,
      -quantity,
      product.current_stock,
      nextStock,
      `Sale #${newSaleId} (${quantity} unit${quantity === 1 ? '' : 's'})`,
      actorUsername,
      nowIso
    );

    db.prepare(
      `INSERT INTO drink_sale_audit_logs (sale_id, action, summary, actor_username, created_at)
       VALUES (?, 'CREATED', ?, ?, ?)`
    ).run(
      newSaleId,
      `Recorded sale of ${quantity} x ${product.name} @ PKR ${unitSellingPricePkr} (Total PKR ${totalSalePkr}, Profit PKR ${profitPkr}).`,
      actorUsername,
      nowIso
    );

    db.exec('COMMIT;');
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    try {
      db.exec('ROLLBACK;');
    } catch {
      // Ignore rollback errors
    }
    throw err;
  }

  return db.prepare('SELECT * FROM drink_sales WHERE id = ?').get(newSaleId) as unknown as DrinkSaleRow;
}

export function updateDrinkSale(
  saleId: number,
  raw: Record<string, unknown>,
  actorUsername = 'admin'
): DrinkSaleRow {
  const db = getDb();
  const nowIso = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE;');
  try {
    const existingSale = db
      .prepare('SELECT * FROM drink_sales WHERE id = ?')
      .get(saleId) as unknown as DrinkSaleRow | undefined;

    if (!existingSale) {
      db.exec('ROLLBACK;');
      throw new ServiceError(404, 'Sale record not found.');
    }
    if (existingSale.status === 'CANCELLED') {
      db.exec('ROLLBACK;');
      throw new ServiceError(400, 'Cancelled sales cannot be edited.');
    }

    const product = db
      .prepare('SELECT * FROM drinks WHERE id = ?')
      .get(existingSale.drink_id) as unknown as DrinkRow | undefined;
    if (!product) {
      db.exec('ROLLBACK;');
      throw new ServiceError(404, 'Associated product not found.');
    }

    const newQuantity =
      raw.quantity !== undefined ? parsePositiveInt(raw.quantity, 'Quantity sold') : existingSale.quantity;
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

    // If newQuantity > oldQuantity, we need more stock; if less, stock returns
    const stockDelta = existingSale.quantity - newQuantity;
    const nextStock = product.current_stock + stockDelta;
    if (nextStock < 0) {
      db.exec('ROLLBACK;');
      throw new ServiceError(
        400,
        `Insufficient remaining stock to increase quantity to ${newQuantity}. Max possible: ${product.current_stock + existingSale.quantity}.`
      );
    }

    const totalSalePkr = unitSellingPricePkr * newQuantity;
    const totalCostPkr = unitPurchasePricePkr * newQuantity;
    const profitPkr = totalSalePkr - totalCostPkr;

    db.prepare(
      `UPDATE drink_sales
       SET quantity = ?, unit_selling_price_pkr = ?, total_sale_pkr = ?,
           unit_purchase_price_pkr = ?, total_cost_pkr = ?, profit_pkr = ?,
           sold_at = ?, sale_date = ?, notes = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      newQuantity,
      unitSellingPricePkr,
      totalSalePkr,
      unitPurchasePricePkr,
      totalCostPkr,
      profitPkr,
      soldAt,
      saleDate,
      notes,
      actorUsername,
      nowIso,
      saleId
    );

    if (stockDelta !== 0) {
      db.prepare(
        `UPDATE drinks SET current_stock = ?, is_available = ?, updated_by = ?, updated_at = ? WHERE id = ?`
      ).run(nextStock, nextStock > 0 ? 1 : 0, actorUsername, nowIso, product.id);

      db.prepare(
        `INSERT INTO drink_stock_adjustments (
          drink_id, adjustment_type, delta_qty, previous_stock, new_stock, reason, created_by, created_at
        ) VALUES (?, 'SALE_EDIT', ?, ?, ?, ?, ?, ?)`
      ).run(
        product.id,
        stockDelta,
        product.current_stock,
        nextStock,
        `Edited Sale #${saleId}: qty ${existingSale.quantity} -> ${newQuantity}`,
        actorUsername,
        nowIso
      );
    }

    db.prepare(
      `INSERT INTO drink_sale_audit_logs (sale_id, action, summary, actor_username, created_at)
       VALUES (?, 'EDITED', ?, ?, ?)`
    ).run(
      saleId,
      `Edited sale #${saleId}: qty ${existingSale.quantity}->${newQuantity}, total PKR ${existingSale.total_sale_pkr}->PKR ${totalSalePkr}.`,
      actorUsername,
      nowIso
    );

    db.exec('COMMIT;');
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    try {
      db.exec('ROLLBACK;');
    } catch {
      // Ignore rollback errors
    }
    throw err;
  }

  return db.prepare('SELECT * FROM drink_sales WHERE id = ?').get(saleId) as unknown as DrinkSaleRow;
}

export function cancelDrinkSale(
  saleId: number,
  reason: string | null,
  actorUsername = 'admin'
): DrinkSaleRow {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const cleanReason =
    typeof reason === 'string' && reason.trim()
      ? reason.trim().slice(0, 200)
      : 'Sale cancelled by admin';

  db.exec('BEGIN IMMEDIATE;');
  try {
    const existingSale = db
      .prepare('SELECT * FROM drink_sales WHERE id = ?')
      .get(saleId) as unknown as DrinkSaleRow | undefined;

    if (!existingSale) {
      db.exec('ROLLBACK;');
      throw new ServiceError(404, 'Sale record not found.');
    }
    if (existingSale.status === 'CANCELLED') {
      db.exec('ROLLBACK;');
      throw new ServiceError(400, 'This sale has already been cancelled.');
    }

    const product = db
      .prepare('SELECT * FROM drinks WHERE id = ?')
      .get(existingSale.drink_id) as unknown as DrinkRow | undefined;

    db.prepare(
      `UPDATE drink_sales
       SET status = 'CANCELLED', cancelled_by = ?, cancel_reason = ?, cancelled_at = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`
    ).run(actorUsername, cleanReason, nowIso, actorUsername, nowIso, saleId);

    if (product) {
      const restoredStock = product.current_stock + existingSale.quantity;
      db.prepare(
        `UPDATE drinks SET current_stock = ?, is_available = ?, updated_by = ?, updated_at = ? WHERE id = ?`
      ).run(restoredStock, restoredStock > 0 ? 1 : 0, actorUsername, nowIso, product.id);

      db.prepare(
        `INSERT INTO drink_stock_adjustments (
          drink_id, adjustment_type, delta_qty, previous_stock, new_stock, reason, created_by, created_at
        ) VALUES (?, 'SALE_CANCEL', ?, ?, ?, ?, ?, ?)`
      ).run(
        product.id,
        existingSale.quantity,
        product.current_stock,
        restoredStock,
        `Cancelled Sale #${saleId}: ${cleanReason}`,
        actorUsername,
        nowIso
      );
    }

    db.prepare(
      `INSERT INTO drink_sale_audit_logs (sale_id, action, summary, actor_username, created_at)
       VALUES (?, 'CANCELLED', ?, ?, ?)`
    ).run(
      saleId,
      `Cancelled sale #${saleId} (${existingSale.quantity} x ${existingSale.product_name}) and restored stock. Reason: ${cleanReason}`,
      actorUsername,
      nowIso
    );

    db.exec('COMMIT;');
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    try {
      db.exec('ROLLBACK;');
    } catch {
      // Ignore rollback errors
    }
    throw err;
  }

  return db.prepare('SELECT * FROM drink_sales WHERE id = ?').get(saleId) as unknown as DrinkSaleRow;
}

export function getDrinkExpenses(filters?: { from?: string; to?: string }): DrinkExpenseRow[] {
  const db = getDb();
  const where: string[] = [];
  const params: string[] = [];
  if (filters?.from && isValidIsoDate(filters.from)) {
    where.push('expense_date >= ?');
    params.push(filters.from);
  }
  if (filters?.to && isValidIsoDate(filters.to)) {
    where.push('expense_date <= ?');
    params.push(filters.to);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  return db
    .prepare(`SELECT * FROM drink_expenses ${clause} ORDER BY expense_date DESC, id DESC LIMIT 300`)
    .all(...params) as unknown as DrinkExpenseRow[];
}

export function createDrinkExpense(
  raw: Record<string, unknown>,
  actorUsername = 'admin'
): DrinkExpenseRow {
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const amountPkr = parsePositiveInt(raw.amountPkr ?? raw.amount_pkr, 'Expense amount');
  const rawDate = typeof (raw.expenseDate ?? raw.expense_date) === 'string'
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

  const db = getDb();
  const nowIso = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO drink_expenses (title, amount_pkr, expense_date, description, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(title, amountPkr, rawDate, description, actorUsername, actorUsername, nowIso, nowIso);

  const id = Number(info.lastInsertRowid);
  return db.prepare('SELECT * FROM drink_expenses WHERE id = ?').get(id) as unknown as DrinkExpenseRow;
}

export function deleteDrinkExpense(id: number): void {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM drink_expenses WHERE id = ?').get(id);
  if (!existing) {
    throw new ServiceError(404, 'Expense record not found.');
  }
  db.prepare('DELETE FROM drink_expenses WHERE id = ?').run(id);
}

export function getDrinksAnalyticsAndReports(filters?: {
  from?: string;
  to?: string;
  category?: string;
  drinkId?: number;
}): DrinksAnalyticsReport {
  const db = getDb();
  const from = filters?.from && isValidIsoDate(filters.from) ? filters.from : null;
  const to = filters?.to && isValidIsoDate(filters.to) ? filters.to : null;
  const category = filters?.category && VALID_CATEGORIES.has(filters.category) ? filters.category : null;
  const drinkId = filters?.drinkId && Number.isFinite(filters.drinkId) ? Number(filters.drinkId) : null;

  const prodWhere: string[] = [];
  const prodParams: Array<string | number> = [];
  if (category) {
    prodWhere.push('category = ?');
    prodParams.push(category);
  }
  if (drinkId) {
    prodWhere.push('id = ?');
    prodParams.push(drinkId);
  }
  const prodClause = prodWhere.length > 0 ? `WHERE ${prodWhere.join(' AND ')}` : '';
  const products = db
    .prepare(`SELECT * FROM drinks ${prodClause} ORDER BY category ASC, name ASC`)
    .all(...prodParams) as unknown as DrinkRow[];

  const saleWhere: string[] = ["status = 'COMPLETED'"];
  const saleParams: Array<string | number> = [];
  if (from) {
    saleWhere.push('sale_date >= ?');
    saleParams.push(from);
  }
  if (to) {
    saleWhere.push('sale_date <= ?');
    saleParams.push(to);
  }
  if (category) {
    saleWhere.push('category = ?');
    saleParams.push(category);
  }
  if (drinkId) {
    saleWhere.push('drink_id = ?');
    saleParams.push(drinkId);
  }
  const saleClause = `WHERE ${saleWhere.join(' AND ')}`;
  const sales = db
    .prepare(`SELECT * FROM drink_sales ${saleClause}`)
    .all(...saleParams) as unknown as DrinkSaleRow[];

  const expWhere: string[] = [];
  const expParams: string[] = [];
  if (from) {
    expWhere.push('expense_date >= ?');
    expParams.push(from);
  }
  if (to) {
    expWhere.push('expense_date <= ?');
    expParams.push(to);
  }
  const expClause = expWhere.length > 0 ? `WHERE ${expWhere.join(' AND ')}` : '';
  const expenses = db
    .prepare(`SELECT * FROM drink_expenses ${expClause}`)
    .all(...expParams) as unknown as DrinkExpenseRow[];

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

  const recentAdjustments = db
    .prepare(
      `SELECT a.*, d.name AS drink_name
       FROM drink_stock_adjustments a
       LEFT JOIN drinks d ON a.drink_id = d.id
       ORDER BY a.id DESC LIMIT 50`
    )
    .all() as unknown as DrinkStockAdjustmentRow[];

  const recentSaleLogs = db
    .prepare('SELECT * FROM drink_sale_audit_logs ORDER BY id DESC LIMIT 50')
    .all() as unknown as DrinkSaleAuditLogRow[];

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
