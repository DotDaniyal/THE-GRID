import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
let DatabaseSyncClass: any = null;
try {
  const sqliteMod = await import('node:sqlite');
  DatabaseSyncClass = sqliteMod.DatabaseSync;
} catch {
  DatabaseSyncClass = null;
}
import { LocalJsonFileDriver, resolveLocalDataDir } from '../storage/drivers.ts';
import {
  ALL_COLLECTIONS,
  buildDefaultOperatingHours,
  createDefaultCollection,
  type AdminLoginAttemptRecord,
  type AdminNotificationRecord,
  type AdminSessionRecord,
  type AdminUserRecord,
  type BookingRecord,
  type CollectionMap,
  type CustomerRecord,
  type DrinkCategory,
  type DrinkExpenseRecord,
  type DrinkProductRecord,
  type DrinkSaleAuditLogRecord,
  type DrinkSaleRecord,
  type DrinkStockAdjustmentRecord,
  type DrinkStockLevelRecord,
  type OperatingHourRecord,
} from '../storage/types.ts';

export interface MigrationVerificationSummary {
  migrated: boolean;
  sourceSqlitePath: string | null;
  backupPath: string | null;
  targetDataDir: string;
  counts: {
    bookings: number;
    notifications: number;
    customers: number;
    operatingHours: number;
    products: number;
    stockAdjustments: number;
    sales: number;
    saleAuditLogs: number;
    expenses: number;
    adminUsers: number;
    adminSessions: number;
  };
}

export function findExistingSqliteCandidate(): string | null {
  const candidates: string[] = [];
  if (process.env.SQLITE_DB_PATH?.trim()) {
    candidates.push(path.resolve(process.env.SQLITE_DB_PATH.trim()));
  }
  candidates.push(path.resolve(process.cwd(), 'database.sqlite'));
  candidates.push(path.resolve(process.cwd(), 'data', 'thegrid.db'));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile() && fs.statSync(candidate).size > 0) {
        return candidate;
      }
    } catch {
      // Check next candidate
    }
  }
  return null;
}

function buildCustomersFromBookings(bookings: BookingRecord[]): CustomerRecord[] {
  const byKey = new Map<string, CustomerRecord>();

  for (const b of bookings) {
    const phoneKey = `${b.country_code}|${b.customer_phone}`.toLowerCase();
    const emailKey = b.customer_email.toLowerCase();
    const key = phoneKey || emailKey;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, {
        id: `CUST-${String(byKey.size + 1).padStart(4, '0')}`,
        customer_name: b.customer_name,
        customer_email: b.customer_email,
        country_code: b.country_code,
        customer_phone: b.customer_phone,
        total_bookings: 1,
        booking_ids: [b.id],
        last_booking_date: b.booking_date,
        created_at: b.created_at,
        updated_at: b.updated_at,
      });
    } else {
      existing.total_bookings += 1;
      if (!existing.booking_ids.includes(b.id)) {
        existing.booking_ids.push(b.id);
      }
      if (!existing.last_booking_date || b.booking_date > existing.last_booking_date) {
        existing.last_booking_date = b.booking_date;
        existing.customer_name = b.customer_name;
        existing.customer_email = b.customer_email;
      }
      if (b.updated_at > existing.updated_at) {
        existing.updated_at = b.updated_at;
      }
    }
  }

  return Array.from(byKey.values());
}

export function extractCollectionsFromSqlite(sqlitePath: string): CollectionMap {
  if (!DatabaseSyncClass) {
    throw new Error('SQLite operations are not supported on this Node runtime.');
  }
  const db = new DatabaseSyncClass(sqlitePath, { readOnly: true });
  const nowIso = new Date().toISOString();

  const tableExists = (name: string): boolean => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) as { name?: string } | undefined;
    return Boolean(row?.name);
  };

  try {
    const bookingRows = tableExists('bookings')
      ? (db.prepare('SELECT * FROM bookings ORDER BY created_at ASC').all() as unknown as BookingRecord[])
      : [];
    const notificationRows = tableExists('admin_notifications')
      ? (db
          .prepare('SELECT * FROM admin_notifications ORDER BY id ASC')
          .all() as unknown as AdminNotificationRecord[])
      : [];
    const operatingHoursRows = tableExists('operating_hours')
      ? (db
          .prepare('SELECT * FROM operating_hours ORDER BY start_time ASC')
          .all() as unknown as OperatingHourRecord[])
      : [];
    const drinkRows = tableExists('drinks')
      ? (db.prepare('SELECT * FROM drinks ORDER BY id ASC').all() as unknown as Array<
          DrinkProductRecord & {
            opening_stock: number;
            current_stock: number;
            is_available: number;
          }
        >)
      : [];
    const adjustmentRows = tableExists('drink_stock_adjustments')
      ? (db
          .prepare('SELECT * FROM drink_stock_adjustments ORDER BY id ASC')
          .all() as unknown as DrinkStockAdjustmentRecord[])
      : [];
    const saleRows = tableExists('drink_sales')
      ? (db.prepare('SELECT * FROM drink_sales ORDER BY id ASC').all() as unknown as DrinkSaleRecord[])
      : [];
    const saleAuditRows = tableExists('drink_sale_audit_logs')
      ? (db
          .prepare('SELECT * FROM drink_sale_audit_logs ORDER BY id ASC')
          .all() as unknown as DrinkSaleAuditLogRecord[])
      : [];
    const expenseRows = tableExists('drink_expenses')
      ? (db
          .prepare('SELECT * FROM drink_expenses ORDER BY id ASC')
          .all() as unknown as DrinkExpenseRecord[])
      : [];
    const adminUserRows = tableExists('admin_users')
      ? (db
          .prepare('SELECT * FROM admin_users ORDER BY id ASC')
          .all() as unknown as AdminUserRecord[])
      : [];
    const adminSessionRows = tableExists('admin_sessions')
      ? (db
          .prepare('SELECT * FROM admin_sessions ORDER BY created_at ASC')
          .all() as unknown as AdminSessionRecord[])
      : [];
    const loginAttemptRows = tableExists('admin_login_attempts')
      ? (db
          .prepare('SELECT * FROM admin_login_attempts')
          .all() as unknown as AdminLoginAttemptRecord[])
      : [];
    const metaRows = tableExists('app_meta')
      ? (db.prepare('SELECT key, value FROM app_meta').all() as unknown as Array<{
          key: string;
          value: string;
        }>)
      : [];

    const customers = buildCustomersFromBookings(bookingRows);
    const bookingCustomerByPhone = new Map(
      customers.map((c) => [`${c.country_code}|${c.customer_phone}`.toLowerCase(), c.id])
    );

    const bookingsCol = createDefaultCollection('bookings');
    bookingsCol.revision = 1;
    bookingsCol.updatedAt = nowIso;
    bookingsCol.records = bookingRows.map((b) => ({
      ...b,
      customer_id:
        bookingCustomerByPhone.get(`${b.country_code}|${b.customer_phone}`.toLowerCase()) ||
        undefined,
    }));
    bookingsCol.notifications = notificationRows;
    bookingsCol.nextNotificationId =
      notificationRows.reduce((max, n) => Math.max(max, n.id), 0) + 1;

    const customersCol = createDefaultCollection('customers');
    customersCol.revision = 1;
    customersCol.updatedAt = nowIso;
    customersCol.records = customers;

    const productsCol = createDefaultCollection('products');
    productsCol.revision = 1;
    productsCol.updatedAt = nowIso;
    productsCol.records = drinkRows.map((d) => ({
      id: d.id,
      name: d.name,
      category: d.category as DrinkCategory,
      brand: d.brand ?? '',
      bottle_size: d.bottle_size ?? '',
      purchase_price_pkr: d.purchase_price_pkr ?? 0,
      price_pkr: d.price_pkr,
      min_stock_alert: d.min_stock_alert ?? 5,
      description: d.description ?? null,
      image_url: d.image_url ?? null,
      is_active: d.is_active ?? 1,
      created_by: d.created_by ?? null,
      updated_by: d.updated_by ?? null,
      created_at: d.created_at || nowIso,
      updated_at: d.updated_at || nowIso,
    }));
    productsCol.nextId = drinkRows.reduce((max, d) => Math.max(max, d.id), 0) + 1;

    const inventoryCol = createDefaultCollection('inventory');
    inventoryCol.revision = 1;
    inventoryCol.updatedAt = nowIso;
    inventoryCol.stockLevels = drinkRows.map(
      (d): DrinkStockLevelRecord => ({
        drink_id: d.id,
        opening_stock: d.opening_stock ?? 0,
        current_stock: d.current_stock ?? 0,
        min_stock_alert: d.min_stock_alert ?? 5,
        is_available: (d.current_stock ?? 0) > 0 ? 1 : 0,
        updated_by: d.updated_by ?? null,
        updated_at: d.updated_at || nowIso,
      })
    );
    inventoryCol.adjustments = adjustmentRows;
    inventoryCol.nextAdjustmentId =
      adjustmentRows.reduce((max, a) => Math.max(max, a.id), 0) + 1;

    const salesCol = createDefaultCollection('sales');
    salesCol.revision = 1;
    salesCol.updatedAt = nowIso;
    salesCol.records = saleRows;
    salesCol.auditLogs = saleAuditRows;
    salesCol.nextSaleId = saleRows.reduce((max, s) => Math.max(max, s.id), 0) + 1;
    salesCol.nextAuditLogId = saleAuditRows.reduce((max, l) => Math.max(max, l.id), 0) + 1;

    const expensesCol = createDefaultCollection('expenses');
    expensesCol.revision = 1;
    expensesCol.updatedAt = nowIso;
    expensesCol.records = expenseRows;
    expensesCol.nextId = expenseRows.reduce((max, e) => Math.max(max, e.id), 0) + 1;

    const settingsCol = createDefaultCollection('settings');
    settingsCol.revision = 1;
    settingsCol.updatedAt = nowIso;
    settingsCol.operatingHours =
      operatingHoursRows.length > 0 ? operatingHoursRows : buildDefaultOperatingHours();

    const adminSettingsCol = createDefaultCollection('admin-settings');
    adminSettingsCol.revision = 1;
    adminSettingsCol.updatedAt = nowIso;
    adminSettingsCol.users = adminUserRows;
    adminSettingsCol.nextUserId = adminUserRows.reduce((max, u) => Math.max(max, u.id), 0) + 1;
    adminSettingsCol.sessions = adminSessionRows;
    adminSettingsCol.loginAttempts = loginAttemptRows;
    adminSettingsCol.appMeta = Object.fromEntries(metaRows.map((m) => [m.key, m.value]));

    return {
      bookings: bookingsCol,
      customers: customersCol,
      products: productsCol,
      inventory: inventoryCol,
      sales: salesCol,
      expenses: expensesCol,
      settings: settingsCol,
      'admin-settings': adminSettingsCol,
    };
  } finally {
    db.close();
  }
}

export async function migrateSqliteFileToLocalJson(options?: {
  sqlitePath?: string;
  targetDataDir?: string;
  force?: boolean;
}): Promise<MigrationVerificationSummary> {
  const targetDataDir = options?.targetDataDir || resolveLocalDataDir();
  const sourceSqlitePath = options?.sqlitePath || findExistingSqliteCandidate();
  const driver = new LocalJsonFileDriver(targetDataDir);

  const markerPath = path.join(targetDataDir, '.migration-meta.json');
  if (!options?.force && fs.existsSync(markerPath) && fs.existsSync(path.join(targetDataDir, 'bookings.json'))) {
    const existingMarker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as MigrationVerificationSummary;
    return { ...existingMarker, migrated: false };
  }

  if (!sourceSqlitePath || !fs.existsSync(sourceSqlitePath)) {
    for (const colName of ALL_COLLECTIONS) {
      const existing = await driver.readCollection(colName);
      if (!existing.exists) {
        const def = createDefaultCollection(colName);
        def.revision = 1;
        await driver.writeCollection(colName, def, null, { skipBackup: true });
      }
    }
    return {
      migrated: false,
      sourceSqlitePath: null,
      backupPath: null,
      targetDataDir,
      counts: {
        bookings: 0,
        notifications: 0,
        customers: 0,
        operatingHours: 24,
        products: 0,
        stockAdjustments: 0,
        sales: 0,
        saleAuditLogs: 0,
        expenses: 0,
        adminUsers: 0,
        adminSessions: 0,
      },
    };
  }

  // 1. Back up existing SQLite database + WAL/SHM before migrating
  const backupsDir = path.join(targetDataDir, '.backups');
  await fsp.mkdir(backupsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupsDir, `sqlite-backup-${ts}.sqlite`);
  await fsp.copyFile(sourceSqlitePath, backupPath);
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(`${sourceSqlitePath}${suffix}`)) {
      await fsp.copyFile(`${sourceSqlitePath}${suffix}`, `${backupPath}${suffix}`).catch(() => undefined);
    }
  }

  // 2. Extract and write all 8 JSON collections (only initializing collections that don't exist yet unless force=true)
  const extracted = extractCollectionsFromSqlite(sourceSqlitePath);
  for (const colName of ALL_COLLECTIONS) {
    const current = await driver.readCollection(colName);
    if (!current.exists || options?.force) {
      await driver.writeCollection(colName, extracted[colName], current.version, {
        skipBackup: !current.exists,
      });
    }
  }

  // 3. Re-read & verify record counts on disk
  const verifiedBookings = (await driver.readCollection('bookings')).data;
  const verifiedCustomers = (await driver.readCollection('customers')).data;
  const verifiedProducts = (await driver.readCollection('products')).data;
  const verifiedInventory = (await driver.readCollection('inventory')).data;
  const verifiedSales = (await driver.readCollection('sales')).data;
  const verifiedExpenses = (await driver.readCollection('expenses')).data;
  const verifiedSettings = (await driver.readCollection('settings')).data;
  const verifiedAdmin = (await driver.readCollection('admin-settings')).data;

  const summary: MigrationVerificationSummary = {
    migrated: true,
    sourceSqlitePath,
    backupPath,
    targetDataDir,
    counts: {
      bookings: verifiedBookings.records.length,
      notifications: verifiedBookings.notifications.length,
      customers: verifiedCustomers.records.length,
      operatingHours: verifiedSettings.operatingHours.length,
      products: verifiedProducts.records.length,
      stockAdjustments: verifiedInventory.adjustments.length,
      sales: verifiedSales.records.length,
      saleAuditLogs: verifiedSales.auditLogs.length,
      expenses: verifiedExpenses.records.length,
      adminUsers: verifiedAdmin.users.length,
      adminSessions: verifiedAdmin.sessions.length,
    },
  };

  await fsp.writeFile(
    markerPath,
    JSON.stringify({ ...summary, migratedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );

  return summary;
}

const isCliRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1]?.endsWith('migrateSqliteToJson.ts');

if (isCliRun) {
  const force = process.argv.includes('--force');
  migrateSqliteFileToLocalJson({ force })
    .then((summary) => {
      console.log('THE GRID SQLite -> JSON Migration Summary:');
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
