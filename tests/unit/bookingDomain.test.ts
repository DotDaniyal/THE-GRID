import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const TEMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'thegrid-unit-json-'));
process.env.JSON_DATA_DIR = TEMP_DATA_DIR;

const { ensureStoreInitialized, readCollection, updateCollection } = await import(
  '../../src/server/storage/jsonStore.ts'
);
await ensureStoreInitialized();

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
const { applyExpiredPendingBookingsOnDraft } = await import(
  '../../src/server/services/bookingService.ts'
);
const { addDaysToIsoDate, formatReadableDate } = await import('../../src/utils/date');
const { validateCustomerDetails } = await import('../../src/utils/validation');

after(() => {
  try {
    fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
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

  await updateCollection('admin-settings', (draft) => {
    draft.users.push({
      id: 1,
      username: 'qa-admin@thegrid.pk',
      display_name: 'QA Admin',
      role: 'ADMIN',
      password_hash: hash,
      mfa_enabled: 0,
      mfa_secret: null,
      is_active: 1,
      created_at: new Date().toISOString(),
      last_login_at: null,
    });
    draft.nextUserId = 2;
  });

  const session = await createAdminSession({
    adminUserId: 1,
    username: 'qa-admin@thegrid.pk',
    displayName: 'QA Admin',
    role: 'ADMIN',
  });
  const verified = await verifyAdminSessionToken(session.token);
  assert.ok(verified);
  assert.equal(verified?.username, 'qa-admin@thegrid.pk');
  assert.equal(await verifyAdminSessionToken(`${session.token}tampered`), null);

  const challenge = await issueMfaChallengeToken(42);
  assert.equal(await verifyMfaChallengeToken(challenge), 42);
  assert.equal(await verifyMfaChallengeToken(`${challenge}x`), null);

  const secret = generateTotpSecret();
  const code = generateTotpCode(secret);
  assert.equal(verifyTotpCode(secret, code), true);
  assert.equal(verifyTotpCode(secret, '000000') && code !== '000000', false);
});

test('progressive auth lockout activates after repeated failures and clears cleanly', async () => {
  const ip = '198.51.100.44';
  await clearAuthFailures(ip);
  const now = 1_700_000_000_000;

  for (let i = 1; i <= 4; i++) {
    const res = await recordAuthFailure(ip, now + i * 1000);
    assert.equal(res.locked, false);
  }
  const fifth = await recordAuthFailure(ip, now + 5000);
  assert.equal(fifth.locked, true);
  assert.equal(fifth.retryAfterSeconds, 60);

  const status = await checkAuthLockout(ip, now + 10_000);
  assert.equal(status.locked, true);
  assert.ok(status.retryAfterSeconds > 50);

  await clearAuthFailures(ip);
  assert.equal((await checkAuthLockout(ip, now + 10_000)).locked, false);
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

test('private drinkService handles inventory, sales, edit/cancel stock restoration, expenses, and P&L without fake seeded items', async () => {
  assert.equal((await getAllDrinksAdmin()).length, 0);

  const productA = await createDrink(
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
  const productB = await createDrink(
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
  const adj = await adjustDrinkStock(
    productA.id,
    { deltaQty: 5, reason: 'Crate arrival' },
    'qa-admin'
  );
  assert.equal(adj.drink.current_stock, 25);

  // Record sale of 5 units of productA @ 250 sell / 150 cost
  const sale = await createDrinkSale(
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
    (await getAllDrinksAdmin()).find((d) => d.id === productA.id)?.current_stock,
    20
  );

  // Edit sale from 5 -> 3 units (restores 2 units -> stock becomes 22)
  const editedSale = await updateDrinkSale(sale.id, { quantity: 3 }, 'qa-admin');
  assert.equal(editedSale.total_sale_pkr, 750);
  assert.equal(editedSale.total_cost_pkr, 450);
  assert.equal(editedSale.profit_pkr, 300);
  assert.equal(
    (await getAllDrinksAdmin()).find((d) => d.id === productA.id)?.current_stock,
    22
  );

  // Record expense (PKR 100 transport) -> Net Profit = 300 - 100 = 200
  await createDrinkExpense(
    {
      title: 'Ice & Delivery',
      amountPkr: 100,
      expenseDate: '2026-11-23',
    },
    'qa-admin'
  );

  const reportBeforeCancel = await getDrinksAnalyticsAndReports({
    from: '2026-11-23',
    to: '2026-11-23',
  });
  assert.equal(reportBeforeCancel.kpis.totalRevenuePkr, 750);
  assert.equal(reportBeforeCancel.kpis.totalPurchaseCostPkr, 450);
  assert.equal(reportBeforeCancel.kpis.grossProfitPkr, 300);
  assert.equal(reportBeforeCancel.kpis.totalExpensesPkr, 100);
  assert.equal(reportBeforeCancel.kpis.netProfitPkr, 200);
  assert.equal(reportBeforeCancel.kpis.totalLossPkr, 0);
  assert.equal(reportBeforeCancel.kpis.remainingInventoryCostValuePkr, 4100);
  assert.equal(reportBeforeCancel.soldProducts.length, 1);
  assert.equal(reportBeforeCancel.unsoldProducts.length, 1);
  assert.equal(reportBeforeCancel.unsoldProducts[0].id, productB.id);

  // Cancel sale -> restores all 3 units back to 25; net profit drops to -100
  const cancelled = await cancelDrinkSale(sale.id, 'Entered wrong day', 'qa-admin');
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(
    (await getAllDrinksAdmin()).find((d) => d.id === productA.id)?.current_stock,
    25
  );

  const reportAfterCancel = await getDrinksAnalyticsAndReports({
    from: '2026-11-23',
    to: '2026-11-23',
  });
  assert.equal(reportAfterCancel.kpis.totalRevenuePkr, 0);
  assert.equal(reportAfterCancel.kpis.netProfitPkr, -100);
  assert.equal(reportAfterCancel.kpis.totalLossPkr, 100);

  // Products with sales history cannot be hard-deleted
  await assert.rejects(() => deleteDrink(productA.id), /recorded sales history/i);
  const updatedA = await updateDrink(productA.id, { isActive: false }, 'qa-admin');
  assert.equal(updatedA.is_active, 0);
  await deleteDrink(productB.id);
});

test('applyExpiredPendingBookingsOnDraft cancels expired 30-min holds while preserving fresh PENDING and CONFIRMED bookings', async () => {
  const baseMs = 1_800_000_000_000;
  const expiredHoldIso = new Date(baseMs - 60_000).toISOString();
  const activeHoldIso = new Date(baseMs + 20 * 60_000).toISOString();
  const createdOldIso = new Date(baseMs - 40 * 60_000).toISOString();

  await updateCollection('bookings', (draft) => {
    draft.records.push(
      {
        id: 'GRD-EXP-001',
        court_number: 1,
        venue_name: 'THE GRID - Main Futsal Court',
        booking_date: '2027-08-10',
        start_time: '18:00',
        end_time: '19:00',
        duration_minutes: 60,
        booking_type: 'individual',
        customer_name: 'Expired Hold',
        customer_email: 'exp@thegrid.pk',
        country_code: '+92',
        customer_phone: '+92 321 0000001',
        participants_json: null,
        additional_guests_count: 0,
        total_amount_pkr: 3600,
        status: 'PENDING',
        admin_notes: null,
        hold_expires_at: expiredHoldIso,
        confirmed_at: null,
        confirmed_by: null,
        status_token: 't1',
        created_at: createdOldIso,
        updated_at: createdOldIso,
      },
      {
        id: 'GRD-ACT-002',
        court_number: 1,
        venue_name: 'THE GRID - Main Futsal Court',
        booking_date: '2027-08-10',
        start_time: '19:00',
        end_time: '20:00',
        duration_minutes: 60,
        booking_type: 'individual',
        customer_name: 'Active Hold',
        customer_email: 'act@thegrid.pk',
        country_code: '+92',
        customer_phone: '+92 321 0000002',
        participants_json: null,
        additional_guests_count: 0,
        total_amount_pkr: 3600,
        status: 'PENDING',
        admin_notes: null,
        hold_expires_at: activeHoldIso,
        confirmed_at: null,
        confirmed_by: null,
        status_token: 't2',
        created_at: createdOldIso,
        updated_at: createdOldIso,
      },
      {
        id: 'GRD-CNF-003',
        court_number: 1,
        venue_name: 'THE GRID - Main Futsal Court',
        booking_date: '2027-08-10',
        start_time: '20:00',
        end_time: '21:00',
        duration_minutes: 60,
        booking_type: 'individual',
        customer_name: 'Confirmed Match',
        customer_email: 'cnf@thegrid.pk',
        country_code: '+92',
        customer_phone: '+92 321 0000003',
        participants_json: null,
        additional_guests_count: 0,
        total_amount_pkr: 3600,
        status: 'CONFIRMED',
        admin_notes: null,
        hold_expires_at: expiredHoldIso,
        confirmed_at: createdOldIso,
        confirmed_by: 'admin',
        status_token: 't3',
        created_at: createdOldIso,
        updated_at: createdOldIso,
      }
    );
  });

  const { result: releasedEvents } = await updateCollection('bookings', (draft) =>
    applyExpiredPendingBookingsOnDraft(draft, baseMs)
  );
  assert.equal(releasedEvents.length, 1);
  assert.equal(releasedEvents[0].bookingId, 'GRD-EXP-001');
  assert.equal(releasedEvents[0].bookingStatus, 'EXPIRED');

  const after = await readCollection('bookings');
  const statusMap = new Map(after.records.map((r) => [r.id, r.status]));
  assert.equal(statusMap.get('GRD-ACT-002'), 'PENDING');
  assert.equal(statusMap.get('GRD-CNF-003'), 'CONFIRMED');
  assert.equal(statusMap.get('GRD-EXP-001'), 'CANCELLED');
});

test('LocalJsonFileDriver automatically quarantines corrupted JSON and recovers from rolling backup', async () => {
  const bookingsFile = path.join(TEMP_DATA_DIR, 'bookings.json');
  assert.ok(fs.existsSync(bookingsFile));
  const before = await readCollection('bookings');
  assert.ok(before.records.length >= 3);

  // Corrupt primary bookings.json on disk
  fs.writeFileSync(bookingsFile, '{corrupt json truncated!!!', 'utf8');

  // Next read recovers cleanly from .backups/ without crashing or losing records
  const recovered = await readCollection('bookings');
  assert.ok(recovered.records.length >= 2);
  assert.ok(fs.existsSync(path.join(TEMP_DATA_DIR, '.corrupted')));
});
