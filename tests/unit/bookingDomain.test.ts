import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const TEMP_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'thegrid-unit-'));
process.env.SQLITE_DB_PATH = path.join(TEMP_DB_DIR, 'unit.sqlite');

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

test('strong password, username, session verification, and TOTP MFA round-trip securely', () => {
  assert.equal(validateAdminUsername('admin@thegrid.pk'), null);
  assert.ok(validateAdminUsername('a'));
  assert.equal(validateStrongPassword('RoversGrid2026!'), null);
  assert.ok(validateStrongPassword('weakpass'));

  const hash = hashPassword('RoversGrid2026!');
  assert.equal(verifyPassword('RoversGrid2026!', hash), true);
  assert.equal(verifyPassword('wrong-password', hash), false);

  const session = createAdminSession({
    adminUserId: null,
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

test('date helpers and WhatsApp message formatter build complete booking summary', () => {
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
    totalAmountPkr: 4000,
    status: 'PENDING',
    createdAt: '2026-11-22T12:00:00.000Z',
  });

  assert.match(message, /Booking ID: GRD-20261125-ABCD/);
  assert.match(message, /Booking Type: Shared/);
  assert.match(message, /Total Amount: PKR 4,000/);
  assert.match(message, /Status: Pending Confirmation/);
});
