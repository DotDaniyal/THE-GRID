import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

const TEMP_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'thegrid-int-'));
process.env.SQLITE_DB_PATH = path.join(TEMP_DB_DIR, 'integration.sqlite');
delete process.env.ADMIN_PASSCODE;

const { createApiApp } = await import('../../src/server/app.ts');

let server: http.Server;
let baseUrl = '';

const TEST_DATE = '2027-06-15';
const TEST_START_TIME = '06:00';

before(async () => {
  const app = createApiApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve) => {
    server?.close(() => resolve());
  });
  try {
    fs.rmSync(TEMP_DB_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors on exit
  }
});

function extractCookiePair(setCookieHeader: string | null): string {
  assert.ok(setCookieHeader, 'Expected Set-Cookie header');
  const firstSegment = setCookieHeader.split(';')[0];
  assert.ok(firstSegment.startsWith('thegrid_admin_session='));
  return firstSegment;
}

test('GET /api/health reports single-court THE GRID configuration', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
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

test('GET /api/slots validates dates and returns configured active single-court slots', async () => {
  const badRes = await fetch(`${baseUrl}/api/slots?date=invalid-date`);
  assert.equal(badRes.status, 400);

  const okRes = await fetch(`${baseUrl}/api/slots?date=${TEST_DATE}`);
  assert.equal(okRes.status, 200);
  const data = (await okRes.json()) as {
    courtNumber: number;
    slots: Array<{ startTime: string; courtNumber: number; status: string }>;
  };
  assert.equal(data.courtNumber, 1);
  assert.ok(data.slots.length > 0 && data.slots.length <= 24);
  assert.ok(data.slots.every((slot) => slot.courtNumber === 1));
});

test('POST /api/bookings enforces policy & field validation, creates pending booking, and blocks duplicate slot', async () => {
  const rejectedPolicyRes = await fetch(`${baseUrl}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: 'Test Player',
      customerEmail: 'test@example.com',
      countryCode: '+92',
      customerPhone: '03211234567',
      bookingDate: TEST_DATE,
      startTime: TEST_START_TIME,
      bookingType: 'individual',
      additionalGuestsCount: 0,
      policiesAccepted: false,
    }),
  });
  assert.equal(rejectedPolicyRes.status, 400);

  const createRes = await fetch(`${baseUrl}/api/bookings`, {
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
      policiesAccepted: true,
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
  assert.equal(created.booking.courtNumber, 1);
  assert.equal(created.booking.status, 'PENDING');
  assert.equal(created.booking.customerPhone, '+92 321 1234567');
  assert.equal(created.booking.totalAmountPkr, 1500);

  const dupRes = await fetch(`${baseUrl}/api/bookings`, {
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
      policiesAccepted: true,
    }),
  });
  assert.equal(dupRes.status, 409);
});

test('Admin cookie auth, CSRF origin check, session revocation on logout, and failed-login lockout work cleanly', async () => {
  const unauthRes = await fetch(`${baseUrl}/api/admin/bookings`);
  assert.equal(unauthRes.status, 401);

  const csrfRejected = await fetch(`${baseUrl}/api/admin/setup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://malicious.example',
    },
    body: JSON.stringify({
      username: 'leadadmin@thegrid.pk',
      displayName: 'Lead Admin',
      password: 'RoversGrid2026!Strong',
    }),
  });
  assert.equal(csrfRejected.status, 403);

  // First-run named admin setup issues HttpOnly, SameSite=Lax cookie
  const setupRes = await fetch(`${baseUrl}/api/admin/setup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify({
      username: 'leadadmin@thegrid.pk',
      displayName: 'Lead Admin',
      password: 'RoversGrid2026!Strong',
    }),
  });
  assert.equal(setupRes.status, 201);
  const setCookie = setupRes.headers.get('set-cookie');
  assert.ok(setCookie && setCookie.includes('HttpOnly') && setCookie.includes('SameSite=Lax'));
  const cookiePair = extractCookiePair(setCookie);

  // Authenticated request works with HTTP-only cookie
  const authedRes = await fetch(`${baseUrl}/api/admin/bookings`, {
    headers: { Cookie: cookiePair },
  });
  assert.equal(authedRes.status, 200);

  // Sign out revokes server session immediately
  const logoutRes = await fetch(`${baseUrl}/api/admin/logout`, {
    method: 'POST',
    headers: {
      Cookie: cookiePair,
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  assert.equal(logoutRes.status, 200);
  const clearedCookieHeader = logoutRes.headers.get('set-cookie');
  assert.ok(clearedCookieHeader && clearedCookieHeader.includes('Max-Age=0'));

  // Old session cookie must now be rejected (server-side revocation check)
  const afterLogoutRes = await fetch(`${baseUrl}/api/admin/bookings`, {
    headers: { Cookie: cookiePair },
  });
  assert.equal(afterLogoutRes.status, 401);

  // Repeated failed login attempts return uniform error and lock out on 5th failure
  const unknownFail = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify({ username: 'nonexistent@thegrid.pk', password: 'wrong-password' }),
  });
  assert.equal(unknownFail.status, 401);
  const unknownErr = (await unknownFail.json()) as { error: string };

  const knownFail = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify({ username: 'leadadmin@thegrid.pk', password: 'wrong-password' }),
  });
  assert.equal(knownFail.status, 401);
  const knownErr = (await knownFail.json()) as { error: string };
  assert.equal(unknownErr.error, knownErr.error);

  // 3rd and 4th failures
  for (let i = 0; i < 2; i++) {
    const res = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ username: 'leadadmin@thegrid.pk', password: 'wrong-password' }),
    });
    assert.equal(res.status, 401);
  }

  // 5th failure triggers lockout (429 + Retry-After)
  const lockoutRes = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify({ username: 'leadadmin@thegrid.pk', password: 'wrong-password' }),
  });
  assert.equal(lockoutRes.status, 429);
  assert.ok(lockoutRes.headers.get('retry-after'));
});
