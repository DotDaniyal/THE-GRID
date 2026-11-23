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
    server?.closeAllConnections?.();
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

test('Drinks Inventory, Sales, Expenses & P&L routes are strictly admin-only and never exposed publicly', async () => {
  // Confirm unauthenticated access is strictly blocked across all inventory routes
  assert.equal((await fetch(`${baseUrl}/api/admin/drinks`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/admin/drinks/sales`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/admin/drinks/expenses`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/admin/drinks/reports`)).status, 401);

  // Confirm no public drinks endpoint exists
  assert.equal((await fetch(`${baseUrl}/api/drinks`)).status, 404);

  // Sign in using the account created in the setup test
  const loginRes = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-Forwarded-For': '198.51.100.77',
    },
    body: JSON.stringify({
      username: 'leadadmin@thegrid.pk',
      password: 'RoversGrid2026!Strong',
    }),
  });
  assert.equal(loginRes.status, 200);
  const cookiePair = extractCookiePair(loginRes.headers.get('set-cookie'));

  // Public court booking stays completely separate from drinks
  const bookRes = await fetch(`${baseUrl}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: 'Court Only Player',
      customerEmail: 'court@thegrid.pk',
      countryCode: '+92',
      customerPhone: '03215559999',
      bookingDate: TEST_DATE,
      startTime: '07:00',
      bookingType: 'individual',
      additionalGuestsCount: 0,
      policiesAccepted: true,
    }),
  });
  assert.equal(bookRes.status, 201);
  const bookJson = (await bookRes.json()) as {
    booking: { id: string; totalAmountPkr: number };
  };
  assert.equal(bookJson.booking.totalAmountPkr, 1500);

  // Create inventory product
  const createRes = await fetch(`${baseUrl}/api/admin/drinks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookiePair,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify({
      name: 'Chilled Mineral Water 1.5L',
      category: 'water',
      brand: 'Pure',
      bottleSize: '1.5L',
      purchasePricePkr: 90,
      pricePkr: 150,
      openingStock: 10,
      minStockAlert: 3,
      isActive: true,
    }),
  });
  assert.equal(createRes.status, 201);
  const createdDrink = ((await createRes.json()) as {
    drink: { id: number; current_stock: number };
  }).drink;
  assert.equal(createdDrink.current_stock, 10);

  // Restock +5 units -> 15
  const adjRes = await fetch(`${baseUrl}/api/admin/drinks/${createdDrink.id}/adjust-stock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookiePair,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify({ deltaQty: 5, reason: 'Crate arrival' }),
  });
  assert.equal(adjRes.status, 200);
  const adjBody = (await adjRes.json()) as { drink: { current_stock: number } };
  assert.equal(adjBody.drink.current_stock, 15);

  // Record a manual sale of 4 units (Revenue = 600, COGS = 360, Profit = 240, remaining stock = 11)
  const saleRes = await fetch(`${baseUrl}/api/admin/drinks/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookiePair,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify({
      drinkId: createdDrink.id,
      quantity: 4,
      soldAt: '2027-06-15T20:00',
      notes: 'Counter match sale',
    }),
  });
  assert.equal(saleRes.status, 201);
  const saleBody = (await saleRes.json()) as {
    sale: { id: number; total_sale_pkr: number; profit_pkr: number };
  };
  assert.equal(saleBody.sale.total_sale_pkr, 600);
  assert.equal(saleBody.sale.profit_pkr, 240);

  // Add an expense (PKR 40) -> Net Profit = 240 - 40 = 200
  const expRes = await fetch(`${baseUrl}/api/admin/drinks/expenses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookiePair,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify({
      title: 'Ice bag',
      amountPkr: 40,
      expenseDate: '2027-06-15',
    }),
  });
  assert.equal(expRes.status, 201);

  // Check P&L analytics report
  const repRes = await fetch(`${baseUrl}/api/admin/drinks/reports?from=2027-06-15&to=2027-06-15`, {
    headers: { Cookie: cookiePair },
  });
  assert.equal(repRes.status, 200);
  const repBody = (await repRes.json()) as {
    kpis: {
      totalRevenuePkr: number;
      grossProfitPkr: number;
      netProfitPkr: number;
      totalItemsRemaining: number;
    };
  };
  assert.equal(repBody.kpis.totalRevenuePkr, 600);
  assert.equal(repBody.kpis.grossProfitPkr, 240);
  assert.equal(repBody.kpis.netProfitPkr, 200);
  assert.equal(repBody.kpis.totalItemsRemaining, 11);

  // Cancel sale and confirm stock is restored back to 15
  const cancelRes = await fetch(
    `${baseUrl}/api/admin/drinks/sales/${saleBody.sale.id}/cancel`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookiePair,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ reason: 'Mistyped order' }),
    }
  );
  assert.equal(cancelRes.status, 200);

  const listAfterCancel = await fetch(`${baseUrl}/api/admin/drinks`, {
    headers: { Cookie: cookiePair },
  });
  const listJson = (await listAfterCancel.json()) as {
    drinks: Array<{ id: number; current_stock: number }>;
  };
  assert.equal(
    listJson.drinks.find((d) => d.id === createdDrink.id)?.current_stock,
    15
  );
});

test('Embedded iframe login emits SameSite=None Partitioned cookies and supports Bearer fallback with logout revocation', async () => {
  const loginRes = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-Forwarded-Proto': 'https',
      'X-Forwarded-Host': 'preview.asia-east1.run.app',
      'X-Forwarded-For': '198.51.100.88',
      Origin: 'https://preview.asia-east1.run.app',
    },
    body: JSON.stringify({
      username: 'leadadmin@thegrid.pk',
      password: 'RoversGrid2026!Strong',
    }),
  });
  assert.equal(loginRes.status, 200);

  const setCookie = loginRes.headers.get('set-cookie') || '';
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=None/);
  assert.match(setCookie, /Partitioned/);

  const body = (await loginRes.json()) as { authenticated: boolean; sessionToken?: string };
  assert.equal(body.authenticated, true);
  assert.ok(body.sessionToken);

  // Access admin endpoint WITHOUT cookie header using Bearer fallback
  const dashRes = await fetch(`${baseUrl}/api/admin/bookings`, {
    headers: {
      Authorization: `Bearer ${body.sessionToken}`,
    },
  });
  assert.equal(dashRes.status, 200);

  // Logout revokes the Bearer-presented session immediately
  const logoutRes = await fetch(`${baseUrl}/api/admin/logout`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${body.sessionToken}`,
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  assert.equal(logoutRes.status, 200);

  const afterLogoutRes = await fetch(`${baseUrl}/api/admin/bookings`, {
    headers: {
      Authorization: `Bearer ${body.sessionToken}`,
    },
  });
  assert.equal(afterLogoutRes.status, 401);
});

test('Centralized real-time sync, concurrent double-booking protection, admin confirmation audit, cancellation release, and DB persistence work across devices', async () => {
  const SYNC_DATE = '2027-09-25';
  const SYNC_TIME = '19:00';

  // Open an SSE stream simulating another connected device (Device C / Admin Desk)
  const sseAbort = new AbortController();
  const sseRes = await fetch(`${baseUrl}/api/slots/stream`, {
    signal: sseAbort.signal,
  });
  assert.equal(sseRes.status, 200);
  assert.match(sseRes.headers.get('content-type') || '', /text\/event-stream/);
  assert.ok(sseRes.body);

  const reader = sseRes.body.getReader();
  try {
    const decoder = new TextDecoder();
    let sseBuffer = '';

    const readSseUntil = async (predicate: (text: string) => boolean, timeoutMs = 4000) => {
      const deadline = Date.now() + timeoutMs;
      while (!predicate(sseBuffer)) {
        if (Date.now() > deadline) {
          throw new Error(`Timed out waiting for SSE event. Buffer:\n${sseBuffer}`);
        }
        const chunk = await Promise.race([
          reader.read(),
          new Promise<{ done: true; value: undefined }>((_, reject) =>
            setTimeout(() => reject(new Error('SSE read timeout')), deadline - Date.now())
          ),
        ]);
        if (chunk.done) break;
        if (chunk.value) {
          sseBuffer += decoder.decode(chunk.value, { stream: true });
        }
      }
      return sseBuffer;
    };

    await readSseUntil((buf) => buf.includes('event: connected'));

    // Simulate Device A and Device B clicking Submit at the exact same millisecond for 2027-09-25 19:00
    const [race1, race2] = await Promise.all([
      fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Device A Captain',
          customerEmail: 'devicea@thegrid.pk',
          countryCode: '+92',
          customerPhone: '03211112222',
          bookingDate: SYNC_DATE,
          startTime: SYNC_TIME,
          bookingType: 'individual',
          additionalGuestsCount: 0,
          policiesAccepted: true,
        }),
      }),
      fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Device B Captain',
          customerEmail: 'deviceb@thegrid.pk',
          countryCode: '+92',
          customerPhone: '03213334444',
          bookingDate: SYNC_DATE,
          startTime: SYNC_TIME,
          bookingType: 'individual',
          additionalGuestsCount: 0,
          policiesAccepted: true,
        }),
      }),
    ]);

    const statuses = [race1.status, race2.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [201, 409]);

    const winnerRes = race1.status === 201 ? race1 : race2;
    const loserRes = race1.status === 409 ? race1 : race2;

    const loserBody = (await loserRes.json()) as { error: string };
    assert.equal(
      loserBody.error,
      'Sorry, this slot has just been booked. Please select another available time.'
    );

    const winnerBody = (await winnerRes.json()) as {
      booking: {
        id: string;
        status: string;
        statusToken: string;
        holdExpiresAt: string;
      };
    };
    assert.equal(winnerBody.booking.status, 'PENDING');
    assert.ok(winnerBody.booking.statusToken);
    assert.ok(winnerBody.booking.holdExpiresAt);

    // Confirm SSE pushed the slot_changed event without leaking any customer PII
    await readSseUntil(
      (buf) => buf.includes('event: slot_changed') && buf.includes(winnerBody.booking.id)
    );
    assert.equal(sseBuffer.includes('Device A Captain'), false);
    assert.equal(sseBuffer.includes('03211112222'), false);

    // Device C loads slots and sees 19:00 is BOOKED (with zero PII) and cache-control: no-store
    const deviceCSlotsRes = await fetch(`${baseUrl}/api/slots?date=${SYNC_DATE}`);
    assert.equal(deviceCSlotsRes.status, 200);
    assert.match(deviceCSlotsRes.headers.get('cache-control') || '', /no-store/);
    const deviceCSlots = (await deviceCSlotsRes.json()) as {
      slots: Array<{ startTime: string; status: string; isAvailable: boolean; bookingStatus: string | null }>;
    };
    const slot19 = deviceCSlots.slots.find((s) => s.startTime === SYNC_TIME);
    assert.ok(slot19);
    assert.equal(slot19?.status, 'BOOKED');
    assert.equal(slot19?.isAvailable, false);
    assert.equal(slot19?.bookingStatus, 'PENDING');

    // Device A status endpoint requires matching statusToken (403 on wrong token)
    const badTokenRes = await fetch(
      `${baseUrl}/api/bookings/${winnerBody.booking.id}/status?token=wrongtoken`
    );
    assert.equal(badTokenRes.status, 403);

    // Admin Device B signs in and confirms the booking
    const adminLogin = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Forwarded-For': '198.51.100.99',
      },
      body: JSON.stringify({
        username: 'leadadmin@thegrid.pk',
        password: 'RoversGrid2026!Strong',
      }),
    });
    assert.equal(adminLogin.status, 200);
    const adminCookie = extractCookiePair(adminLogin.headers.get('set-cookie'));

    const confirmRes = await fetch(
      `${baseUrl}/api/admin/bookings/${winnerBody.booking.id}/status`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ status: 'CONFIRMED' }),
      }
    );
    assert.equal(confirmRes.status, 200);
    const confirmedRow = ((await confirmRes.json()) as {
      booking: {
        id: string;
        status: string;
        confirmed_at: string | null;
        confirmed_by: string | null;
        hold_expires_at: string | null;
      };
    }).booking;
    assert.equal(confirmedRow.status, 'CONFIRMED');
    assert.ok(confirmedRow.confirmed_at);
    assert.equal(confirmedRow.confirmed_by, 'leadadmin@thegrid.pk');
    assert.equal(confirmedRow.hold_expires_at, null);

    // Device A status check immediately sees CONFIRMED + confirmedAt
    const liveStatusRes = await fetch(
      `${baseUrl}/api/bookings/${winnerBody.booking.id}/status?token=${winnerBody.booking.statusToken}`
    );
    assert.equal(liveStatusRes.status, 200);
    const liveStatus = (await liveStatusRes.json()) as {
      bookingStatus: {
        status: string;
        confirmedAt: string | null;
      };
    };
    assert.equal(liveStatus.bookingStatus.status, 'CONFIRMED');
    assert.ok(liveStatus.bookingStatus.confirmedAt);

    // Verify persistence across a fresh Express server instance against the same central SQLite DB
    const freshApp = createApiApp();
    let freshServer!: http.Server;
    let freshUrl = '';
    await new Promise<void>((resolve) => {
      freshServer = freshApp.listen(0, '127.0.0.1', () => {
        const addr = freshServer.address();
        if (addr && typeof addr === 'object') {
          freshUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });

    try {
      const freshSlotsRes = await fetch(`${freshUrl}/api/slots?date=${SYNC_DATE}`);
      const freshSlots = (await freshSlotsRes.json()) as {
        slots: Array<{ startTime: string; status: string; isAvailable: boolean; bookingStatus: string | null }>;
      };
      const persistedSlot = freshSlots.slots.find((s) => s.startTime === SYNC_TIME);
      assert.equal(persistedSlot?.status, 'BOOKED');
      assert.equal(persistedSlot?.bookingStatus, 'CONFIRMED');
      assert.equal(persistedSlot?.isAvailable, false);
    } finally {
      freshServer.closeAllConnections?.();
      await new Promise<void>((resolve) => freshServer.close(() => resolve()));
    }

    // Admin cancels booking -> slot returns immediately to AVAILABLE across every device
    const cancelRes = await fetch(
      `${baseUrl}/api/admin/bookings/${winnerBody.booking.id}/status`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ status: 'CANCELLED' }),
      }
    );
    assert.equal(cancelRes.status, 200);

    const afterCancelSlotsRes = await fetch(`${baseUrl}/api/slots?date=${SYNC_DATE}`);
    const afterCancelSlots = (await afterCancelSlotsRes.json()) as {
      slots: Array<{ startTime: string; status: string; isAvailable: boolean }>;
    };
    const releasedSlot = afterCancelSlots.slots.find((s) => s.startTime === SYNC_TIME);
    assert.equal(releasedSlot?.status, 'AVAILABLE');
    assert.equal(releasedSlot?.isAvailable, true);
  } finally {
    await reader.cancel().catch(() => undefined);
    sseAbort.abort();
  }
});

