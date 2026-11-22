import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { after } from 'node:test';

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const TEST_DATE = '2027-06-15';
const TEST_START_TIME = '06:00';
const createdBookingIds: string[] = [];

after(() => {
  if (createdBookingIds.length === 0) return;
  const dbPath = path.resolve(process.cwd(), 'data', 'thegrid.db');
  const db = new DatabaseSync(dbPath);
  for (const bookingId of createdBookingIds) {
    db.prepare('DELETE FROM admin_notifications WHERE booking_id = ?').run(bookingId);
    db.prepare('DELETE FROM bookings WHERE id = ?').run(bookingId);
  }
  db.close();
});

test('GET /api/health reports single-court THE GRID configuration', async () => {
  const res = await fetch(`${BASE_URL}/api/health`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    ok: boolean;
    courtNumber: number;
    venue: string;
  };
  assert.equal(body.ok, true);
  assert.equal(body.courtNumber, 1);
  assert.equal(body.venue, 'THE GRID - Main Futsal Court');
});

test('GET /api/slots validates dates and returns 24 single-court slots', async () => {
  const badRes = await fetch(`${BASE_URL}/api/slots?date=invalid-date`);
  assert.equal(badRes.status, 400);

  const okRes = await fetch(`${BASE_URL}/api/slots?date=${TEST_DATE}`);
  assert.equal(okRes.status, 200);
  const data = (await okRes.json()) as {
    courtNumber: number;
    slots: Array<{ startTime: string; courtNumber: number; status: string }>;
  };
  assert.equal(data.courtNumber, 1);
  assert.equal(data.slots.length, 24);
  assert.ok(data.slots.every((slot) => slot.courtNumber === 1));
});

test('POST /api/bookings enforces validation, creates pending booking, and blocks duplicate slot', async () => {
  const badPhoneRes = await fetch(`${BASE_URL}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: 'Test Player',
      customerEmail: 'test@example.com',
      countryCode: '+92',
      customerPhone: '1234',
      bookingDate: TEST_DATE,
      startTime: TEST_START_TIME,
      bookingType: 'individual',
      additionalGuestsCount: 0,
    }),
  });
  assert.equal(badPhoneRes.status, 400);

  const createRes = await fetch(`${BASE_URL}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: 'Automated QA Player',
      customerEmail: 'qa@thegrid.pk',
      countryCode: '+92',
      customerPhone: '03211234567',
      bookingDate: TEST_DATE,
      startTime: TEST_START_TIME,
      bookingType: 'shared',
      additionalGuestsCount: 4,
    }),
  });
  assert.equal(createRes.status, 201);
  const created = (await createRes.json()) as {
    booking: {
      id: string;
      courtNumber: number;
      status: string;
      customerPhone: string;
      totalAmountPkr: number;
    };
  };
  createdBookingIds.push(created.booking.id);
  assert.equal(created.booking.courtNumber, 1);
  assert.equal(created.booking.status, 'PENDING');
  assert.equal(created.booking.customerPhone, '+92 321 1234567');
  assert.equal(created.booking.totalAmountPkr, 1500);

  const dupRes = await fetch(`${BASE_URL}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: 'Duplicate Player',
      customerEmail: 'dup@thegrid.pk',
      countryCode: '+92',
      customerPhone: '03001234567',
      bookingDate: TEST_DATE,
      startTime: TEST_START_TIME,
      bookingType: 'individual',
      additionalGuestsCount: 0,
    }),
  });
  assert.equal(dupRes.status, 409);
});

test('GET /api/admin/bookings rejects unauthenticated requests', async () => {
  const res = await fetch(`${BASE_URL}/api/admin/bookings`);
  assert.equal(res.status, 401);
});
