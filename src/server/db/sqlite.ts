import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function ensureWritableDbPath(targetFile: string): string | null {
  try {
    const resolved = path.resolve(targetFile);
    const dir = path.dirname(resolved);
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    if (fs.existsSync(resolved)) {
      fs.accessSync(resolved, fs.constants.W_OK);
    }
    return resolved;
  } catch {
    return null;
  }
}

function resolveDbPath(): string {
  const customPath = process.env.SQLITE_DB_PATH?.trim();
  const vercelTmpDir = path.join(os.tmpdir(), 'thegrid-data');

  if (customPath) {
    const resolved = path.resolve(customPath);
    const pointsIntoReadOnlyVercelRoot =
      process.env.VERCEL === '1' && resolved.startsWith(process.cwd());
    if (!pointsIntoReadOnlyVercelRoot) {
      const writableCustom = ensureWritableDbPath(customPath);
      if (writableCustom) {
        return writableCustom;
      }
    }
    // If SQLITE_DB_PATH points to a read-only mount (e.g. ./database.sqlite on Vercel),
    // safely fall back to writable /tmp while preserving the configured filename.
    const tmpFallback = ensureWritableDbPath(
      path.join(vercelTmpDir, path.basename(customPath) || 'database.sqlite')
    );
    if (tmpFallback) return tmpFallback;
  }

  // On Vercel serverless runtimes, process.cwd() (/var/task) is read-only.
  if (process.env.VERCEL !== '1') {
    const writableLocal = ensureWritableDbPath(
      path.join(process.cwd(), 'data', 'thegrid.db')
    );
    if (writableLocal) {
      return writableLocal;
    }
  }

  fs.mkdirSync(vercelTmpDir, { recursive: true });
  return path.join(vercelTmpDir, 'thegrid.db');
}

export interface OperatingHourRow {
  start_time: string;
  end_time: string;
  display_name: string;
  price_pkr: number;
  is_active: number;
}

export interface BookingRow {
  id: string;
  court_number: number;
  venue_name: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  booking_type: 'individual' | 'shared';
  customer_name: string;
  customer_email: string;
  country_code: string;
  customer_phone: string;
  participants_json: string | null;
  additional_guests_count: number;
  total_amount_pkr: number;
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED';
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminNotificationRow {
  id: number;
  booking_id: string;
  message: string;
  is_read: number;
  created_at: string;
}

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

let dbInstance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;

  const dbPath = resolveDbPath();
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA journal_mode = WAL;');
  } catch {
    db.exec('PRAGMA journal_mode = DELETE;');
  }
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS operating_hours (
      start_time TEXT PRIMARY KEY,
      end_time TEXT NOT NULL,
      display_name TEXT NOT NULL,
      price_pkr INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      court_number INTEGER NOT NULL DEFAULT 1 CHECK (court_number = 1),
      venue_name TEXT NOT NULL DEFAULT 'THE GRID - Main Futsal Court',
      booking_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 60,
      booking_type TEXT NOT NULL CHECK (booking_type IN ('individual', 'shared')),
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      country_code TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      participants_json TEXT,
      additional_guests_count INTEGER NOT NULL DEFAULT 0,
      total_amount_pkr INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED')),
      admin_notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_active_court_slot
      ON bookings (court_number, booking_date, start_time)
      WHERE status IN ('PENDING', 'CONFIRMED');

    CREATE TABLE IF NOT EXISTS admin_credentials (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'ADMIN' CHECK (role IN ('SUPER_ADMIN', 'ADMIN')),
      password_hash TEXT NOT NULL,
      mfa_enabled INTEGER NOT NULL DEFAULT 0,
      mfa_secret TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      id TEXT PRIMARY KEY,
      admin_user_id INTEGER,
      username TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS admin_login_attempts (
      attempt_key TEXT PRIMARY KEY,
      failed_count INTEGER NOT NULL DEFAULT 0,
      first_failed_at INTEGER NOT NULL,
      locked_until INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS drinks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('cold_drinks', 'water', 'hydration_drinks')),
      brand TEXT NOT NULL DEFAULT '',
      bottle_size TEXT NOT NULL DEFAULT '',
      purchase_price_pkr INTEGER NOT NULL DEFAULT 0,
      price_pkr INTEGER NOT NULL,
      opening_stock INTEGER NOT NULL DEFAULT 0,
      current_stock INTEGER NOT NULL DEFAULT 0,
      min_stock_alert INTEGER NOT NULL DEFAULT 5,
      description TEXT,
      image_url TEXT,
      is_available INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS drink_stock_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drink_id INTEGER NOT NULL REFERENCES drinks(id) ON DELETE CASCADE,
      adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('OPENING', 'RESTOCK', 'REDUCTION', 'SALE', 'SALE_EDIT', 'SALE_CANCEL')),
      delta_qty INTEGER NOT NULL,
      previous_stock INTEGER NOT NULL,
      new_stock INTEGER NOT NULL,
      reason TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS drink_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drink_id INTEGER NOT NULL REFERENCES drinks(id),
      product_name TEXT NOT NULL,
      category TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_selling_price_pkr INTEGER NOT NULL,
      total_sale_pkr INTEGER NOT NULL,
      unit_purchase_price_pkr INTEGER NOT NULL,
      total_cost_pkr INTEGER NOT NULL,
      profit_pkr INTEGER NOT NULL,
      sold_at TEXT NOT NULL,
      sale_date TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'CANCELLED')),
      created_by TEXT NOT NULL,
      updated_by TEXT,
      cancelled_by TEXT,
      cancel_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      cancelled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS drink_sale_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES drink_sales(id) ON DELETE CASCADE,
      action TEXT NOT NULL CHECK (action IN ('CREATED', 'EDITED', 'CANCELLED')),
      summary TEXT NOT NULL,
      actor_username TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS drink_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      amount_pkr INTEGER NOT NULL,
      expense_date TEXT NOT NULL,
      description TEXT,
      created_by TEXT NOT NULL,
      updated_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Safe schema upgrade for existing databases created before full inventory columns existed
  const existingCols = new Set(
    (
      db.prepare('PRAGMA table_info(drinks)').all() as unknown as Array<{ name: string }>
    ).map((col) => col.name)
  );
  const drinkMigrations: Array<[string, string]> = [
    ['brand', "TEXT NOT NULL DEFAULT ''"],
    ['bottle_size', "TEXT NOT NULL DEFAULT ''"],
    ['purchase_price_pkr', 'INTEGER NOT NULL DEFAULT 0'],
    ['opening_stock', 'INTEGER NOT NULL DEFAULT 0'],
    ['current_stock', 'INTEGER NOT NULL DEFAULT 0'],
    ['min_stock_alert', 'INTEGER NOT NULL DEFAULT 5'],
    ['created_by', 'TEXT'],
    ['updated_by', 'TEXT'],
  ];
  for (const [colName, colDef] of drinkMigrations) {
    if (!existingCols.has(colName)) {
      db.exec(`ALTER TABLE drinks ADD COLUMN ${colName} ${colDef};`);
    }
  }

  const countRow = db
    .prepare('SELECT COUNT(*) AS count FROM operating_hours')
    .get() as { count: number };

  if (countRow.count === 0) {
    const insert = db.prepare(
      'INSERT INTO operating_hours (start_time, end_time, display_name, price_pkr, is_active) VALUES (?, ?, ?, ?, ?)'
    );
    for (let h = 0; h < 24; h++) {
      const start = `${String(h).padStart(2, '0')}:00`;
      const end = `${String((h + 1) % 24).padStart(2, '0')}:00`;
      const display = `${format12Hour(h)} - ${format12Hour(h + 1)}`;
      insert.run(start, end, display, getDefaultPriceForHour(h), 1);
    }
  }

  dbInstance = db;
  return db;
}
