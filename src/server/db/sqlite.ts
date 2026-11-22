import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'thegrid.db');

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

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
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
  `);

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
