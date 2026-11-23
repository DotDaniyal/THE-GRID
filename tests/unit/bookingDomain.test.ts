import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const TEMP_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'thegrid-unit-'));
process.env.SQLITE_DB_PATH = path.join(TEMP_DB_DIR, 'unit.sqlite');

const { getDb } = await import('../../src/server/db/sqlite.ts');
const {
  createAdminSession,
  hashPassword,
  issueMfaChallengeToken,
  validateAdminUsername,
  validateStrongPassword,
  verifyAdminSessionToken,
  verifyMfaChallengeToken,
  verifyPassword,
} = await import('../../src/server/middleware/auth.ts');
const {
  checkAuthLockout,
  clearAuthFailures,
  recordAuthFailure,
} = await import('../../src/server/middleware/rateLimit.ts');
const { normalizePhone } = await import('../../src/server/utils/phone.ts');
const {
  isSlotPassedInKarachi,
  isValidIsoDate,
} = await import('../../src/server/utils/time.ts');
const { generateTotpCode, generateTotpSecret, verifyTotpCode } = await import(
  '../../src/server/utils/totp.ts'
);
const { buildWhatsAppBookingMessage } = await import('../../src/services/integrations/whatsapp');
const {
  adjustDrinkStock,
  cancelDrinkSale,
  createDrink,
  createDrinkExpense,
  createDrinkSale,
  deleteDrink,
  getAllDrinksAdmin,
  getDrinksAnalyticsAndReports,
  updateDrink,
  updateDrinkSale,
} = await import('../../src/server/services/drinkService.ts');
const { addDaysToIsoDate, formatReadableDate } = await import('../../src/utils/date');
const { validateCustomerDetails } = await import('../../src/utils/validation');

after(() => {
  try {
    fs.rmSync(TEMP_DB_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors on exit
  }
});

test('isValidIsoDate validates real calendar dates and rejects malformed or impossible dates', () => {
  assert.equal(isValidIsoDate('2026-11-22'), true);
  assert.equal(isValidIsoDate('2028-02-29'), true);
  assert.equal(isValidIsoDate('2026-02-30'), false);
  assert.equal(isValidIsoDate('22-11-2026'), false);
  assert.equal(isValidIsoDate('invalid'), false);
});

test('isSlotPassedInKarachi accurately evaluates past, current-day, overnight, and future slots', () => {
  const fixedNow = {
    dateStr: '2026-11-22',
    hours: 18,
    minutes: 30,
    minutesFromMidnight: 18 * 60 + 30,
  };

  assert.equal(isSlotPassedInKarachi('2026-11-21', '22:00', '23:00', fixedNow), true);
  assert.equal(isSlotPassedInKarachi('2026-11-22', '17:00', '18:00', fixedNow), true);
  assert.equal(isSlotPassedInKarachi('2026-11-22', '18:00', '19:00', fixedNow), false);
  assert.equal(isSlotPassedInKarachi('2026-11-22', '23:00', '00:00', fixedNow), false);
  assert.equal(isSlotPassedInKarachi('2026-11-23', '04:00', '05:00', fixedNow), false);
});

test('normalizePhone standardizes Pakistani +92 formats and rejects invalid numbers', () => {
  assert.deepEqual(normalizePhone('+92', '0321 1234567'), {
    valid: true,
    formatted: '+92 321 1234567',
  });
  assert.deepEqual(normalizePhone('+92', '923001234567'), {
    valid: true,
    formatted: '+92 300 1234567',
  });
  assert.equal(normalizePhone('+92', '12345').valid, false);
  assert.deepEqual(normalizePhone('+971', '50-123-4567'), {
    valid: true,
    formatted: '+971 501234567',
  });
});

test('strong password, username, session verification, and TOTP MFA round-trip securely', async () => {
  assert.equal(validateAdminUsername('admin@thegrid.pk'), null);
  assert.ok(validateAdminUsername('a'));
  assert.equal(validateStrongPassword('RoversGrid2026!'), null);
  assert.equal(validateStrongPassword('simple'), null);
  assert.ok(validateStrongPassword('12345'));

  const hash = await hashPassword('RoversGrid2026!');
  assert.equal(await verifyPassword('RoversGrid2026!', hash), true);
  assert.equal(await verifyPassword('wrong-password', hash), false);

  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO admin_users (id, username, display_name, role, password_hash, mfa_enabled, is_active, created_at)
     VALUES (1, 'qa-admin@thegrid.pk', 'QA Admin', 'ADMIN', ?, 0, 1, ?)`
  ).run(hash, new Date().toISOString());

  const session = createAdminSession({
    adminUserId: 1,
    username: 'qa-admin@thegrid.pk',
    displayName: 'QA Admin',
    role: 'ADMIN',
  });
  const verified = verifyAdminSessionToken(session.token);
  assert.ok(verified);
  assert.equal(verified?.username, 'qa-admin@thegrid.pk');
  assert.equal(verifyAdminSessionToken(`${session.token}tampered`), null);

  const challenge = issueMfaChallengeToken(42);
  assert.equal(verifyMfaChallengeToken(challenge), 42);
  assert.equal(verifyMfaChallengeToken(`${challenge}x`), null);

  const secret = generateTotpSecret();
  const code = generateTotpCode(secret);
  assert.equal(verifyTotpCode(secret, code), true);
  assert.equal(verifyTotpCode(secret, '000000') && code !== '000000', false);
});

test('progressive auth lockout activates after repeated failures and clears cleanly', () => {
  const ip = '198.51.100.44';
  clearAuthFailures(ip);
  const now = 1_700_000_000_000;

  for (let i = 1; i <= 4; i++) {
    const res = recordAuthFailure(ip, now + i * 1000);
    assert.equal(res.locked, false);
  }
  const fifth = recordAuthFailure(ip, now + 5000);
  assert.equal(fifth.locked, true);
  assert.equal(fifth.retryAfterSeconds, 60);

  const status = checkAuthLockout(ip, now + 10_000);
  assert.equal(status.locked, true);
  assert.ok(status.retryAfterSeconds > 50);

  clearAuthFailures(ip);
  assert.equal(checkAuthLockout(ip, now + 10_000).locked, false);
});

test('validateCustomerDetails checks required name, email, and Pakistani mobile rules', () => {
  const validErrors = validateCustomerDetails({
    customerName: 'Ahsan Ali',
    customerEmail: 'ahsan@example.com',
    countryCode: '+92',
    customerPhone: '0321 5551234',
  });
  assert.deepEqual(validErrors, {});

  const invalidErrors = validateCustomerDetails({
    customerName: 'A',
    customerEmail: 'bad-email',
    countryCode: '+92',
    customerPhone: '123',
  });
  assert.ok(invalidErrors.customerName);
  assert.ok(invalidErrors.customerEmail);
  assert.ok(invalidErrors.customerPhone);
});

test('date helpers and WhatsApp message formatter build court-only booking summary without drinks', () => {
  assert.equal(addDaysToIsoDate('2026-11-30', 1), '2026-12-01');
  assert.match(formatReadableDate('2026-11-22'), /22 Nov 2026/);

  const message = buildWhatsAppBookingMessage({
    id: 'GRD-20261125-ABCD',
    courtNumber: 1,
    venueName: 'THE GRID - Main Futsal Court',
    bookingDate: '2026-11-25',
    startTime: '20:00',
    endTime: '21:00',
    displayName: '08:00 PM - 09:00 PM',
    durationMinutes: 60,
    bookingType: 'shared',
    customerName: 'Bilal Tariq',
    customerEmail: 'bilal@example.com',
    countryCode: '+92',
    customerPhone: '+92 321 9876543',
    additionalGuestsCount: 4,
    totalAmountPkr: 3600,
    status: 'PENDING',
    createdAt: '2026-11-22T12:00:00.000Z',
  });

  assert.match(message, /Booking ID: GRD-20261125-ABCD/);
  assert.match(message, /Booking Type: Shared/);
  assert.match(message, /Total Amount: PKR 3,600/);
  assert.match(message, /Status: Pending Confirmation/);
});

test('private drinkService handles inventory, sales, edit/cancel stock restoration, expenses, and P&L without fake seeded items', () => {
  assert.equal(getAllDrinksAdmin().length, 0);

  const productA = createDrink(
    {
      name: 'Electrolyte Hydration 500ml',
      category: 'hydration_drinks',
      brand: 'SportFuel',
      bottleSize: '500ml',
      purchasePricePkr: 150,
      pricePkr: 250,
      openingStock: 20,
      minStockAlert: 5,
      isActive: true,
    },
    'qa-admin'
  );
  const productB = createDrink(
    {
      name: 'Still Water 1.5L',
      category: 'water',
      brand: 'PureLife',
      bottleSize: '1.5L',
      purchasePricePkr: 80,
      pricePkr: 140,
      openingStock: 10,
      minStockAlert: 4,
      isActive: true,
    },
    'qa-admin'
  );

  // Restock productA (+5 -> 25)
  const adj = adjustDrinkStock(productA.id, { deltaQty: 5, reason: 'Crate arrival' }, 'qa-admin');
  assert.equal(adj.drink.current_stock, 25);

  // Record sale of 5 units of productA @ 250 sell / 150 cost
  const sale = createDrinkSale(
    {
      drinkId: productA.id,
      quantity: 5,
      soldAt: '2026-11-23T19:00',
      notes: 'Match 1',
    },
    'qa-admin'
  );
  assert.equal(sale.total_sale_pkr, 1250);
  assert.equal(sale.total_cost_pkr, 750);
  assert.equal(sale.profit_pkr, 500);
  assert.equal(
    getAllDrinksAdmin().find((d) => d.id === productA.id)?.current_stock,
    20
  );

  // Edit sale from 5 -> 3 units (restores 2 units -> stock becomes 22)
  const editedSale = updateDrinkSale(sale.id, { quantity: 3 }, 'qa-admin');
  assert.equal(editedSale.total_sale_pkr, 750);
  assert.equal(editedSale.total_cost_pkr, 450);
  assert.equal(editedSale.profit_pkr, 300);
  assert.equal(
    getAllDrinksAdmin().find((d) => d.id === productA.id)?.current_stock,
    22
  );

  // Record expense (PKR 100 transport) -> Net Profit = 300 - 100 = 200
  createDrinkExpense(
    {
      title: 'Ice & Delivery',
      amountPkr: 100,
      expenseDate: '2026-11-23',
    },
    'qa-admin'
  );

  const reportBeforeCancel = getDrinksAnalyticsAndReports({
    from: '2026-11-23',
    to: '2026-11-23',
  });
  assert.equal(reportBeforeCancel.kpis.totalRevenuePkr, 750);
  assert.equal(reportBeforeCancel.kpis.totalPurchaseCostPkr, 450);
  assert.equal(reportBeforeCancel.kpis.grossProfitPkr, 300);
  assert.equal(reportBeforeCancel.kpis.totalExpensesPkr, 100);
  assert.equal(reportBeforeCancel.kpis.netProfitPkr, 200);
  assert.equal(reportBeforeCancel.kpis.totalLossPkr, 0);
  // Remaining inventory cost value is tracked separately: 22*150 (3300) + 10*80 (800) = 4100
  assert.equal(reportBeforeCancel.kpis.remainingInventoryCostValuePkr, 4100);
  assert.equal(reportBeforeCancel.soldProducts.length, 1);
  assert.equal(reportBeforeCancel.unsoldProducts.length, 1);
  assert.equal(reportBeforeCancel.unsoldProducts[0].id, productB.id);

  // Cancel sale -> restores all 3 units back to 25; net profit drops to -100 (loss = 100 from expense)
  const cancelled = cancelDrinkSale(sale.id, 'Entered wrong day', 'qa-admin');
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(
    getAllDrinksAdmin().find((d) => d.id === productA.id)?.current_stock,
    25
  );

  const reportAfterCancel = getDrinksAnalyticsAndReports({
    from: '2026-11-23',
    to: '2026-11-23',
  });
  assert.equal(reportAfterCancel.kpis.totalRevenuePkr, 0);
  assert.equal(reportAfterCancel.kpis.netProfitPkr, -100);
  assert.equal(reportAfterCancel.kpis.totalLossPkr, 100);

  // Products with sales history cannot be hard-deleted (preserves audit trail); unused product can be deleted
  assert.throws(() => deleteDrink(productA.id), /recorded sales history/i);
  const updatedA = updateDrink(productA.id, { isActive: false }, 'qa-admin');
  assert.equal(updatedA.is_active, 0);
  deleteDrink(productB.id);
});

test('releaseExpiredPendingBookings cancels expired 30-min pending holds while preserving fresh PENDING and CONFIRMED bookings', async () => {
  const { collectExpiredPendingBookings } = await import(
    '../../src/server/services/bookingService.ts'
  );
  const db = getDb();
  const baseMs = 1_800_000_000_000;
  const expiredHoldIso = new Date(baseMs - 60_000).toISOString();
  const activeHoldIso = new Date(baseMs + 20 * 60_000).toISOString();
  const createdOldIso = new Date(baseMs - 40 * 60_000).toISOString();

  db.prepare(
    `INSERT INTO bookings (
      id, court_number, venue_name, booking_date, start_time, end_time,
      duration_minutes, booking_type, customer_name, customer_email,
      country_code, customer_phone, additional_guests_count,
      total_amount_pkr, status, hold_expires_at, created_at, updated_at
    ) VALUES
      ('GRD-EXP-001', 1, 'THE GRID - Main Futsal Court', '2027-08-10', '18:00', '19:00', 60, 'individual', 'Expired Hold', 'exp@thegrid.pk', '+92', '+92 321 0000001', 0, 3600, 'PENDING', ?, ?, ?),
      ('GRD-ACT-002', 1, 'THE GRID - Main Futsal Court', '2027-08-10', '19:00', '20:00', 60, 'individual', 'Active Hold', 'act@thegrid.pk', '+92', '+92 321 0000002', 0, 3600, 'PENDING', ?, ?, ?),
      ('GRD-CNF-003', 1, 'THE GRID - Main Futsal Court', '2027-08-10', '20:00', '21:00', 60, 'individual', 'Confirmed Match', 'cnf@thegrid.pk', '+92', '+92 321 0000003', 0, 3600, 'CONFIRMED', ?, ?, ?)`
  ).run(
    expiredHoldIso,
    createdOldIso,
    createdOldIso,
    activeHoldIso,
    createdOldIso,
    createdOldIso,
    expiredHoldIso,
    createdOldIso,
    createdOldIso
  );

  const releasedEvents = collectExpiredPendingBookings(db, baseMs);
  assert.equal(releasedEvents.length, 1);
  assert.equal(releasedEvents[0].bookingId, 'GRD-EXP-001');
  assert.equal(releasedEvents[0].bookingStatus, 'EXPIRED');

  const rows = db
    .prepare(
      `SELECT id, status FROM bookings WHERE id IN ('GRD-EXP-001', 'GRD-ACT-002', 'GRD-CNF-003') ORDER BY id ASC`
    )
    .all() as Array<{ id: string; status: string }>;

  assert.deepEqual(
    rows.map((r) => ({ id: r.id, status: r.status })),
    [
      { id: 'GRD-ACT-002', status: 'PENDING' },
      { id: 'GRD-CNF-003', status: 'CONFIRMED' },
      { id: 'GRD-EXP-001', status: 'CANCELLED' },
    ]
  );
});

