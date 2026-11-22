import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashPassword,
  issueAdminToken,
  verifyAdminToken,
  verifyPassword,
} from '../../src/server/middleware/auth.ts';
import { normalizePhone } from '../../src/server/utils/phone.ts';
import {
  isSlotPassedInKarachi,
  isValidIsoDate,
  type KarachiNow,
} from '../../src/server/utils/time.ts';
import { buildWhatsAppBookingMessage } from '../../src/services/integrations/whatsapp';
import { addDaysToIsoDate, formatReadableDate } from '../../src/utils/date';
import { validateCustomerDetails } from '../../src/utils/validation';

test('isValidIsoDate validates real calendar dates and rejects malformed or impossible dates', () => {
  assert.equal(isValidIsoDate('2026-11-22'), true);
  assert.equal(isValidIsoDate('2028-02-29'), true);
  assert.equal(isValidIsoDate('2026-02-30'), false);
  assert.equal(isValidIsoDate('22-11-2026'), false);
  assert.equal(isValidIsoDate('invalid'), false);
});

test('isSlotPassedInKarachi accurately evaluates past, current-day, overnight, and future slots', () => {
  const fixedNow: KarachiNow = {
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

test('password hashing and admin HMAC bearer tokens round-trip securely', () => {
  const hash = hashPassword('RoversGrid2026!');
  assert.equal(verifyPassword('RoversGrid2026!', hash), true);
  assert.equal(verifyPassword('wrong-password', hash), false);

  const session = issueAdminToken();
  assert.equal(verifyAdminToken(session.token), true);
  assert.equal(verifyAdminToken(`${session.token}tampered`), false);
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
