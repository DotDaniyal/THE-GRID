import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

const TEMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'thegrid-int-json-'));
process.env.JSON_DATA_DIR = TEMP_DATA_DIR;
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
    fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
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

test('GET /api/health reports single-court THE GRID configuration and verified local read/write storage', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    ok: boolean;
    courtNumber: number;
    venue: string;
    storage: {
      mode: string;
      persistent: boolean;
      configured: boolean;
      readable: boolean;
      writable: boolean;
      accessible: boolean;
      verified: boolean;
      accessMode: string;
    };
  };
  assert.equal(body.ok, true);
  assert.equal(body.courtNumber, 1);
  assert.equal(body.venue, 'THE GRID - Main Futsal Court');
  assert.equal(body.storage.mode, 'local_json');
  assert.equal(body.storage.configured, true);
  assert.equal(body.storage.readable, true);
  assert.equal(body.storage.writable, true);
  assert.equal(body.storage.accessible, true);
  assert.equal(body.storage.verified, true);
  assert.equal(body.storage.accessMode, 'local');

  const authStatusRes = await fetch(`${baseUrl}/api/admin/auth-status`);
  assert.equal(authStatusRes.status, 200);
  const authStatus = (await authStatusRes.json()) as {
    storageConfigured: boolean;
    storageMessage: string | null;
  };
  assert.equal(authStatus.storageConfigured, true);
  assert.equal(authStatus.storageMessage, null);
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

test('Vercel Blob multi-container JSON persistence, ETag concurrency protection, and ADMIN_PASSCODE auth work across separate Lambda instances', async () => {
  const { spawn } = await import('node:child_process');

  const runScriptAsync = (script: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '-e', script],
        { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] }
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('close', (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`Child process failed (code ${code}):\n${stderr}\n${stdout}`));
      });
    });
  };

  // Spin up an in-memory HTTP emulator implementing Private Vercel Blob REST GET/PUT + x-if-match ETag CAS
  const blobs = new Map<string, { body: string; etag: string; contentType: string; access: string }>();
  const putAccessHeaders: string[] = [];
  let etagSeq = 1;

  const blobServer = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');

    if (req.method === 'PUT') {
      const accessHeader = String(req.headers['x-vercel-blob-access'] || '');
      putAccessHeaders.push(accessHeader);
      if (accessHeader !== 'private') {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            error: {
              code: 'forbidden',
              message: 'Cannot use public access on a private store.',
            },
          })
        );
        return;
      }

      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(Buffer.from(c)));
      req.on('end', () => {
        const pathname = reqUrl.searchParams.get('pathname') || reqUrl.pathname.replace(/^\/+/, '');
        const allowOverwrite = req.headers['x-allow-overwrite'] === '1';
        const ifMatch = typeof req.headers['x-if-match'] === 'string' ? req.headers['x-if-match'] : '';
        const existing = blobs.get(pathname);

        if (existing && !allowOverwrite) {
          res.statusCode = 409;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: { code: 'precondition_failed', message: 'Blob already exists' } }));
          return;
        }
        if (ifMatch && (!existing || existing.etag !== ifMatch)) {
          res.statusCode = 412;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: { code: 'precondition_failed', message: 'ETag mismatch' } }));
          return;
        }

        const bodyStr = Buffer.concat(chunks).toString('utf8');
        const nextEtag = `"etag-${etagSeq++}"`;
        const contentType = String(req.headers['content-type'] || 'application/json');
        blobs.set(pathname, { body: bodyStr, etag: nextEtag, contentType, access: accessHeader });

        const origin = `http://${req.headers.host}`;
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            url: `${origin}/${pathname}`,
            downloadUrl: `${origin}/${pathname}?download=1`,
            pathname,
            contentType,
            contentDisposition: 'inline',
            etag: nextEtag,
          })
        );
      });
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      const pathname = reqUrl.pathname.replace(/^\/+/, '');
      const entry = blobs.get(pathname);
      if (!entry) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: { code: 'not_found', message: 'Not found' } }));
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', entry.contentType);
      res.setHeader('ETag', entry.etag);
      res.setHeader('Content-Length', String(Buffer.byteLength(entry.body)));
      if (req.method === 'HEAD') {
        res.end();
      } else {
        res.end(entry.body);
      }
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname.endsWith('/delete')) {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(Buffer.from(c)));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            urls?: string[];
          };
          for (const u of parsed.urls ?? []) {
            const p = new URL(u, 'http://127.0.0.1').pathname.replace(/^\/+/, '');
            blobs.delete(p);
          }
        } catch {
          // Ignore malformed delete payload
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end('{}');
      });
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) => blobServer.listen(0, '127.0.0.1', resolve));
  const blobPort = (blobServer.address() as { port: number }).port;
  const blobApiUrl = `http://127.0.0.1:${blobPort}`;
  const blobToken = 'vercel_blob_rw_teststore12345_secret';

  try {
    // Boot Container A & Container B as two separate Node processes sharing ONLY the external Blob store
    const spawnContainerScript = `
      import assert from 'node:assert/strict';
      process.env.VERCEL = '1';
      process.env.BLOB_READ_WRITE_TOKEN = ${JSON.stringify(blobToken)};
      process.env.VERCEL_BLOB_API_URL = ${JSON.stringify(blobApiUrl)};
      process.env.ADMIN_PASSCODE = 'VercelGridSecret2026!';
      delete process.env.SESSION_SECRET;
      delete process.env.JSON_DATA_DIR;

      const { createApiApp } = await import('./src/server/app.ts');
      const app = createApiApp();
      const srv = app.listen(0, '127.0.0.1');
      await new Promise((r) => srv.once('listening', r));
      const url = 'http://127.0.0.1:' + srv.address().port;

      // Health confirms Private Vercel Blob driver passes real read/write verification
      const healthRes = await fetch(url + '/api/health');
      const health = await healthRes.json();
      assert.equal(health.storage.mode, 'vercel_blob');
      assert.equal(health.storage.persistent, true);
      assert.equal(health.storage.configured, true);
      assert.equal(health.storage.readable, true);
      assert.equal(health.storage.writable, true);
      assert.equal(health.storage.accessible, true);
      assert.equal(health.storage.verified, true);
      assert.equal(health.storage.accessMode, 'private');

      // Admin auth-status warning clears only after verified read/write check
      const authStatus = await (await fetch(url + '/api/admin/auth-status')).json();
      assert.equal(authStatus.storageConfigured, true);
      assert.equal(authStatus.storageMessage, null);

      // Login on Container A
      const loginRes = await fetch(url + '/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ username: 'admin', password: 'VercelGridSecret2026!' }),
      });
      assert.equal(loginRes.status, 200);
      const cookie = loginRes.headers.get('set-cookie').split(';')[0];

      // Add a drink on Container A
      const drinkRes = await fetch(url + '/api/admin/drinks', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({
          name: 'Blob Mineral Water',
          category: 'water',
          pricePkr: 120,
          openingStock: 10,
        }),
      });
      assert.equal(drinkRes.status, 201);

      // Fire 2 simultaneous bookings on Container A for the SAME slot -> exactly 1 succeeds (201), 1 fails (409)
      const [b1, b2] = await Promise.all([
        fetch(url + '/api/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerName: 'Blob Race 1',
            customerEmail: 'race1@thegrid.pk',
            countryCode: '+92',
            customerPhone: '03211111111',
            bookingDate: '2027-07-20',
            startTime: '20:00',
            bookingType: 'individual',
            additionalGuestsCount: 0,
            policiesAccepted: true,
          }),
        }),
        fetch(url + '/api/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerName: 'Blob Race 2',
            customerEmail: 'race2@thegrid.pk',
            countryCode: '+92',
            customerPhone: '03212222222',
            bookingDate: '2027-07-20',
            startTime: '20:00',
            bookingType: 'individual',
            additionalGuestsCount: 0,
            policiesAccepted: true,
          }),
        }),
      ]);
      const statuses = [b1.status, b2.status].sort();
      assert.deepEqual(statuses, [201, 409]);

      // Print cookie so Container B (separate process) reads the exact Blob-persisted data
      console.log('COOKIE:' + cookie);
      srv.close();
    `;

    const outA = await runScriptAsync(spawnContainerScript);
    const cookieLine = outA.split(/\r?\n/).find((l) => l.startsWith('COOKIE:'));
    assert.ok(cookieLine, 'Expected cookie output from Container A');
    const cookie = cookieLine.slice('COOKIE:'.length).trim();

    const containerBScript = `
      import assert from 'node:assert/strict';
      process.env.VERCEL = '1';
      process.env.BLOB_READ_WRITE_TOKEN = ${JSON.stringify(blobToken)};
      process.env.VERCEL_BLOB_API_URL = ${JSON.stringify(blobApiUrl)};
      process.env.ADMIN_PASSCODE = 'VercelGridSecret2026!';
      delete process.env.SESSION_SECRET;
      delete process.env.JSON_DATA_DIR;

      const { createApiApp } = await import('./src/server/app.ts');
      const app = createApiApp();
      const srv = app.listen(0, '127.0.0.1');
      await new Promise((r) => srv.once('listening', r));
      const url = 'http://127.0.0.1:' + srv.address().port;
      const cookie = ${JSON.stringify(cookie)};

      // Container B sees the booking + drink created on Container A via Vercel Blob JSON!
      const dashRes = await fetch(url + '/api/admin/bookings', { headers: { Cookie: cookie } });
      assert.equal(dashRes.status, 200);
      const dash = await dashRes.json();
      assert.equal(dash.bookings.filter((b) => b.booking_date === '2027-07-20').length, 1);

      const drinksRes = await fetch(url + '/api/admin/drinks', { headers: { Cookie: cookie } });
      assert.equal(drinksRes.status, 200);
      const drinks = await drinksRes.json();
      assert.ok(drinks.drinks.some((d) => d.name === 'Blob Mineral Water'));

      // Logout on Container B revokes session in external Blob JSON!
      const logoutRes = await fetch(url + '/api/admin/logout', {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Requested-With': 'XMLHttpRequest' },
      });
      assert.equal(logoutRes.status, 200);

      const afterLogout = await fetch(url + '/api/admin/bookings', { headers: { Cookie: cookie } });
      assert.equal(afterLogout.status, 401);
      srv.close();
    `;

    await runScriptAsync(containerBScript);

    // Verify every PUT used private access and all private JSON files exist in Blob storage
    assert.ok(putAccessHeaders.length > 0);
    assert.ok(putAccessHeaders.every((hdr) => hdr === 'private'));
    assert.ok(blobs.has('thegrid/system/health-probe.json'));
    assert.ok(blobs.has('thegrid/data/bookings.json'));
    assert.ok(blobs.has('thegrid/data/customers.json'));
    assert.ok(blobs.has('thegrid/data/products.json'));
    assert.ok(blobs.has('thegrid/data/inventory.json'));
    assert.ok(blobs.has('thegrid/data/settings.json'));
    assert.ok(blobs.has('thegrid/data/admin-settings.json'));
  } finally {
    await new Promise<void>((resolve) => {
      blobServer.closeAllConnections?.();
      blobServer.close(() => resolve());
    });
  }
});

test('SQLite to Local JSON migration backs up existing DB, converts all records without loss, and derives customers.json', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { migrateSqliteFileToLocalJson } = await import(
    '../../src/server/db/migrateSqliteToJson.ts'
  );

  const migDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thegrid-mig-'));
  const sqliteFile = path.join(migDir, 'legacy.sqlite');
  const jsonDir = path.join(migDir, 'json-out');

  try {
    const db = new DatabaseSync(sqliteFile);
    db.exec(`
      CREATE TABLE operating_hours (start_time TEXT PRIMARY KEY, end_time TEXT, display_name TEXT, price_pkr INTEGER, is_active INTEGER);
      CREATE TABLE bookings (id TEXT PRIMARY KEY, court_number INTEGER, venue_name TEXT, booking_date TEXT, start_time TEXT, end_time TEXT, duration_minutes INTEGER, booking_type TEXT, customer_name TEXT, customer_email TEXT, country_code TEXT, customer_phone TEXT, participants_json TEXT, additional_guests_count INTEGER, total_amount_pkr INTEGER, status TEXT, admin_notes TEXT, hold_expires_at TEXT, confirmed_at TEXT, confirmed_by TEXT, status_token TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE admin_notifications (id INTEGER PRIMARY KEY, booking_id TEXT, message TEXT, is_read INTEGER, created_at TEXT);
      CREATE TABLE drinks (id INTEGER PRIMARY KEY, name TEXT, category TEXT, brand TEXT, bottle_size TEXT, purchase_price_pkr INTEGER, price_pkr INTEGER, opening_stock INTEGER, current_stock INTEGER, min_stock_alert INTEGER, description TEXT, image_url TEXT, is_available INTEGER, is_active INTEGER, created_by TEXT, updated_by TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE drink_stock_adjustments (id INTEGER PRIMARY KEY, drink_id INTEGER, adjustment_type TEXT, delta_qty INTEGER, previous_stock INTEGER, new_stock INTEGER, reason TEXT, created_by TEXT, created_at TEXT);
      CREATE TABLE drink_sales (id INTEGER PRIMARY KEY, drink_id INTEGER, product_name TEXT, category TEXT, quantity INTEGER, unit_selling_price_pkr INTEGER, total_sale_pkr INTEGER, unit_purchase_price_pkr INTEGER, total_cost_pkr INTEGER, profit_pkr INTEGER, sold_at TEXT, sale_date TEXT, notes TEXT, status TEXT, created_by TEXT, updated_by TEXT, cancelled_by TEXT, cancel_reason TEXT, created_at TEXT, updated_at TEXT, cancelled_at TEXT);
      CREATE TABLE drink_sale_audit_logs (id INTEGER PRIMARY KEY, sale_id INTEGER, action TEXT, summary TEXT, actor_username TEXT, created_at TEXT);
      CREATE TABLE drink_expenses (id INTEGER PRIMARY KEY, title TEXT, amount_pkr INTEGER, expense_date TEXT, description TEXT, created_by TEXT, updated_by TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE admin_users (id INTEGER PRIMARY KEY, username TEXT, display_name TEXT, role TEXT, password_hash TEXT, mfa_enabled INTEGER, mfa_secret TEXT, is_active INTEGER, created_at TEXT, last_login_at TEXT);
      CREATE TABLE admin_sessions (id TEXT PRIMARY KEY, admin_user_id INTEGER, username TEXT, display_name TEXT, role TEXT, expires_at INTEGER, created_at TEXT, revoked_at TEXT);
      CREATE TABLE admin_login_attempts (attempt_key TEXT PRIMARY KEY, failed_count INTEGER, first_failed_at INTEGER, locked_until INTEGER, updated_at INTEGER);
      CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT);
    `);
    db.prepare(
      `INSERT INTO bookings VALUES ('GRD-MIG-1', 1, 'THE GRID - Main Futsal Court', '2026-12-01', '20:00', '21:00', 60, 'individual', 'Tariq Mahmood', 'tariq@example.com', '+92', '+92 300 5556677', NULL, 0, 4000, 'CONFIRMED', NULL, NULL, '2026-11-24T00:00:00.000Z', 'admin', 'tok', '2026-11-24T00:00:00.000Z', '2026-11-24T00:00:00.000Z')`
    ).run();
    db.prepare(
      `INSERT INTO drinks VALUES (1, 'Aquafina 500ml', 'water', 'PepsiCo', '500ml', 40, 80, 24, 20, 5, NULL, NULL, 1, 1, 'admin', 'admin', '2026-11-24T00:00:00.000Z', '2026-11-24T00:00:00.000Z')`
    ).run();
    db.prepare(
      `INSERT INTO drink_sales VALUES (1, 1, 'Aquafina 500ml', 'water', 4, 80, 320, 40, 160, 160, '2026-11-24T19:00', '2026-11-24', NULL, 'COMPLETED', 'admin', 'admin', NULL, NULL, '2026-11-24T19:00:00.000Z', '2026-11-24T19:00:00.000Z', NULL)`
    ).run();
    db.prepare(
      `INSERT INTO drink_expenses VALUES (1, 'Chiller Ice', 500, '2026-11-24', NULL, 'admin', 'admin', '2026-11-24T12:00:00.000Z', '2026-11-24T12:00:00.000Z')`
    ).run();
    db.prepare(
      `INSERT INTO admin_users VALUES (1, 'owner', 'Owner', 'SUPER_ADMIN', 'hash', 0, NULL, 1, '2026-11-24T00:00:00.000Z', NULL)`
    ).run();
    db.close();

    const summary = await migrateSqliteFileToLocalJson({
      sqlitePath: sqliteFile,
      targetDataDir: jsonDir,
    });

    assert.equal(summary.migrated, true);
    assert.ok(summary.backupPath && fs.existsSync(summary.backupPath));
    assert.ok(fs.existsSync(sqliteFile), 'Original SQLite DB must not be deleted');
    assert.equal(summary.counts.bookings, 1);
    assert.equal(summary.counts.customers, 1);
    assert.equal(summary.counts.products, 1);
    assert.equal(summary.counts.sales, 1);
    assert.equal(summary.counts.expenses, 1);
    assert.equal(summary.counts.adminUsers, 1);

    const migratedBookings = JSON.parse(
      fs.readFileSync(path.join(jsonDir, 'bookings.json'), 'utf8')
    );
    assert.equal(migratedBookings.records[0].id, 'GRD-MIG-1');
  } finally {
    fs.rmSync(migDir, { recursive: true, force: true });
  }
});

test('Vercel without persistent storage credentials rejects writes with 503 instead of losing data to /tmp', async () => {
  const { execFileSync } = await import('node:child_process');
  const script = `
    import assert from 'node:assert/strict';
    process.env.VERCEL = '1';
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.JSON_DATA_DIR;

    const { createApiApp } = await import('./src/server/app.ts');
    const app = createApiApp();
    const srv = app.listen(0, '127.0.0.1');
    await new Promise((r) => srv.once('listening', r));
    const url = 'http://127.0.0.1:' + srv.address().port;

    const health = await (await fetch(url + '/api/health')).json();
    assert.equal(health.storage.mode, 'unconfigured_vercel');
    assert.equal(health.storage.persistent, false);

    const writeRes = await fetch(url + '/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Test Player',
        customerEmail: 'test@thegrid.pk',
        countryCode: '+92',
        customerPhone: '03211234567',
        bookingDate: '2027-09-01',
        startTime: '20:00',
        bookingType: 'individual',
        additionalGuestsCount: 0,
        policiesAccepted: true,
      }),
    });
    assert.equal(writeRes.status, 503);
    const errBody = await writeRes.json();
    assert.match(errBody.error, /Persistent external JSON storage is not configured/i);

    const authStatus = await (await fetch(url + '/api/admin/auth-status')).json();
    assert.equal(authStatus.storageConfigured, false);
    assert.match(authStatus.storageMessage, /Persistent external JSON storage is not configured/i);
    srv.close();
  `;

  execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: process.cwd(),
    stdio: 'pipe',
  });
});

test('Vercel api/index handler restores rewritten __path URLs without 404 for slots, health, and admin login', async () => {
  const { default: vercelHandler, normalizeVercelApiRequestUrl } = await import(
    '../../api/index.ts'
  );

  assert.equal(
    normalizeVercelApiRequestUrl({
      url: '/api/index?__path=slots&date=2026-11-26',
      headers: {},
    }),
    '/api/slots?date=2026-11-26'
  );
  assert.equal(
    normalizeVercelApiRequestUrl({
      url: '/api/index?__path=admin/login',
      headers: {},
    }),
    '/api/admin/login'
  );
  assert.equal(
    normalizeVercelApiRequestUrl({
      url: '/api/index.ts',
      headers: { 'x-vercel-original-uri': '/api/slots?date=2026-11-26' },
    }),
    '/api/slots?date=2026-11-26'
  );

  const rewriteProxyServer = http.createServer((req, res) => {
    // Simulate Vercel's vercel.json rewrite: /api/(.*) -> /api/index?__path=$1
    if (req.url && req.url.startsWith('/api')) {
      const parsed = new URL(req.url, 'http://127.0.0.1');
      if (parsed.pathname === '/api') {
        req.url = `/api/index${parsed.search}`;
      } else if (parsed.pathname.startsWith('/api/')) {
        const sub = parsed.pathname.slice('/api/'.length);
        parsed.searchParams.set('__path', sub);
        req.url = `/api/index?${parsed.searchParams.toString()}`;
      }
    }
    return vercelHandler(req as never, res as never);
  });

  await new Promise<void>((resolve) => rewriteProxyServer.listen(0, '127.0.0.1', resolve));
  const proxyPort = (rewriteProxyServer.address() as { port: number }).port;
  const proxyUrl = `http://127.0.0.1:${proxyPort}`;

  try {
    const healthRes = await fetch(`${proxyUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as {
      ok: boolean;
      storage: { configured: boolean; accessible: boolean };
    };
    assert.equal(healthJson.ok, true);
    assert.equal(healthJson.storage.configured, true);
    assert.equal(healthJson.storage.accessible, true);

    const slotsRes = await fetch(`${proxyUrl}/api/slots?date=2026-11-26`);
    assert.equal(slotsRes.status, 200);
    const slotsJson = (await slotsRes.json()) as { slots: unknown[] };
    assert.ok(slotsJson.slots.length > 0);

    const badLoginRes = await fetch(`${proxyUrl}/api/admin/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Forwarded-For': '203.0.113.55',
      },
      body: JSON.stringify({ username: 'leadadmin@thegrid.pk', password: 'wrong-password' }),
    });
    assert.equal(badLoginRes.status, 401);

    const goodLoginRes = await fetch(`${proxyUrl}/api/admin/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Forwarded-For': '203.0.113.55',
      },
      body: JSON.stringify({
        username: 'leadadmin@thegrid.pk',
        password: 'RoversGrid2026!Strong',
      }),
    });
    assert.equal(goodLoginRes.status, 200);

    const unknownApiRes = await fetch(`${proxyUrl}/api/does-not-exist`);
    assert.equal(unknownApiRes.status, 404);
    const unknownApiJson = (await unknownApiRes.json()) as { code: string };
    assert.equal(unknownApiJson.code, 'API_ROUTE_NOT_FOUND');
  } finally {
    rewriteProxyServer.closeAllConnections?.();
    await new Promise<void>((resolve) => rewriteProxyServer.close(() => resolve()));
  }
});

test('Booking customerNotes, REJECTED release + history preservation, and admin dashboard stats & audit log work cleanly', async () => {
  const NOTES_DATE = '2027-10-12';
  const createRes = await fetch(`${baseUrl}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: 'Notes Player',
      customerEmail: 'notes@thegrid.pk',
      countryCode: '+92',
      customerPhone: '03217778899',
      customerNotes: 'Need bibs and extra match ball please',
      bookingDate: NOTES_DATE,
      startTime: '21:00',
      bookingType: 'individual',
      additionalGuestsCount: 0,
      policiesAccepted: true,
    }),
  });
  assert.equal(createRes.status, 201);
  const created = (await createRes.json()) as {
    booking: { id: string; customerNotes: string | null };
  };
  assert.equal(created.booking.customerNotes, 'Need bibs and extra match ball please');

  const loginRes = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-Forwarded-For': '203.0.113.77',
    },
    body: JSON.stringify({
      username: 'leadadmin@thegrid.pk',
      password: 'RoversGrid2026!Strong',
    }),
  });
  assert.equal(loginRes.status, 200);
  const cookiePair = extractCookiePair(loginRes.headers.get('set-cookie'));

  // Reject the booking -> releases the slot and records rejected_at/rejected_by + stats + audit log
  const rejectRes = await fetch(`${baseUrl}/api/admin/bookings/${created.booking.id}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookiePair,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify({ status: 'REJECTED', adminNotes: 'Advance screenshot unreadable' }),
  });
  assert.equal(rejectRes.status, 200);
  const rejected = (await rejectRes.json()) as {
    booking: {
      status: string;
      customer_notes: string | null;
      admin_notes: string | null;
      rejected_at: string | null;
      rejected_by: string | null;
    };
  };
  assert.equal(rejected.booking.status, 'REJECTED');
  assert.equal(rejected.booking.customer_notes, 'Need bibs and extra match ball please');
  assert.equal(rejected.booking.admin_notes, 'Advance screenshot unreadable');
  assert.ok(rejected.booking.rejected_at);
  assert.equal(rejected.booking.rejected_by, 'leadadmin@thegrid.pk');

  // Slot returns to AVAILABLE immediately after REJECTED
  const slotsAfterReject = (await (await fetch(`${baseUrl}/api/slots?date=${NOTES_DATE}`)).json()) as {
    slots: Array<{ startTime: string; isAvailable: boolean; status: string }>;
  };
  const slot21 = slotsAfterReject.slots.find((s) => s.startTime === '21:00');
  assert.equal(slot21?.status, 'AVAILABLE');
  assert.equal(slot21?.isAvailable, true);

  // Dashboard returns 8 summary stats & recentActivity including BOOKING_REJECTED
  const dashRes = await fetch(`${baseUrl}/api/admin/bookings`, {
    headers: { Cookie: cookiePair },
  });
  assert.equal(dashRes.status, 200);
  const dash = (await dashRes.json()) as {
    stats: {
      totalBookings: number;
      rejectedBookings: number;
    };
    recentActivity: Array<{ action: string; target_id?: string | null }>;
  };
  assert.ok(dash.stats.totalBookings >= 1);
  assert.ok(dash.stats.rejectedBookings >= 1);
  assert.ok(
    dash.recentActivity.some(
      (a) => a.action === 'BOOKING_REJECTED' && a.target_id === created.booking.id
    )
  );
});

test('Vercel Blob rejects public-store mismatch without downgrading access, never leaks tokens, and resolves custom-prefixed tokens', async () => {
  const { spawn } = await import('node:child_process');

  const runScriptAsync = (script: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '-e', script],
        { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] }
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('close', (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`Child process failed (code ${code}):\n${stderr}\n${stdout}`));
      });
    });
  };

  // Emulator rejecting private access as a public store would
  let mode: 'public_store_error' | 'private_ok' = 'public_store_error';
  const blobs = new Map<string, { body: string; etag: string }>();
  let seq = 1;

  const blobServer = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(Buffer.from(c)));
      req.on('end', () => {
        if (mode === 'public_store_error') {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: {
                code: 'bad_request',
                message: 'Vercel Blob: Cannot use private access on a public store.',
              },
            })
          );
          return;
        }
        if (req.headers['x-vercel-blob-access'] !== 'private') {
          res.statusCode = 403;
          res.end('private required');
          return;
        }
        const pathname = reqUrl.searchParams.get('pathname') || reqUrl.pathname.replace(/^\/+/, '');
        const etag = `"e-${seq++}"`;
        blobs.set(pathname, { body: Buffer.concat(chunks).toString('utf8'), etag });
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            url: `http://${req.headers.host}/${pathname}`,
            downloadUrl: `http://${req.headers.host}/${pathname}?download=1`,
            pathname,
            contentType: 'application/json',
            contentDisposition: 'inline',
            etag,
          })
        );
      });
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const pathname = reqUrl.pathname.replace(/^\/+/, '');
      const item = blobs.get(pathname);
      if (!item) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: { code: 'not_found', message: 'Not found' } }));
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('ETag', item.etag);
      res.end(req.method === 'HEAD' ? undefined : item.body);
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) => blobServer.listen(0, '127.0.0.1', resolve));
  const blobApiUrl = `http://127.0.0.1:${(blobServer.address() as { port: number }).port}`;
  const secretToken = 'vercel_blob_rw_privstore9999_supersecretvalue';

  try {
    // 1. Public store rejecting private access must keep warning visible and never leak token
    const errScript = `
      import assert from 'node:assert/strict';
      process.env.VERCEL = '1';
      delete process.env.BLOB_READ_WRITE_TOKEN;
      process.env.THEGRID_READ_WRITE_TOKEN = ${JSON.stringify(`"${secretToken}"`)};
      process.env.VERCEL_BLOB_API_URL = ${JSON.stringify(blobApiUrl)};
      delete process.env.JSON_DATA_DIR;

      const { createApiApp } = await import('./src/server/app.ts');
      const app = createApiApp();
      const srv = app.listen(0, '127.0.0.1');
      await new Promise((r) => srv.once('listening', r));
      const url = 'http://127.0.0.1:' + srv.address().port;

      const healthRes = await fetch(url + '/api/health');
      assert.equal(healthRes.status, 503);
      const health = await healthRes.json();
      assert.equal(health.storage.mode, 'vercel_blob');
      assert.equal(health.storage.writable, false);
      assert.equal(health.storage.verified, false);
      assert.equal(health.storage.accessMode, 'private');
      assert.ok(health.storage.error);
      assert.equal(JSON.stringify(health).includes('supersecretvalue'), false);
      assert.equal(JSON.stringify(health).includes('vercel_blob_rw_'), false);

      const authStatus = await (await fetch(url + '/api/admin/auth-status')).json();
      assert.equal(authStatus.storageConfigured, false);
      assert.ok(authStatus.storageMessage);
      assert.equal(authStatus.storageMessage.includes('supersecretvalue'), false);
      srv.closeAllConnections?.();
      srv.close();
    `;
    await runScriptAsync(errScript);

    // 2. Switching to valid Private store with custom-prefixed quoted token verifies read/write
    mode = 'private_ok';
    const okScript = `
      import assert from 'node:assert/strict';
      process.env.VERCEL = '1';
      delete process.env.BLOB_READ_WRITE_TOKEN;
      process.env.THEGRID_READ_WRITE_TOKEN = ${JSON.stringify(`"${secretToken}"`)};
      process.env.VERCEL_BLOB_API_URL = ${JSON.stringify(blobApiUrl)};
      delete process.env.JSON_DATA_DIR;

      const { createApiApp } = await import('./src/server/app.ts');
      const app = createApiApp();
      const srv = app.listen(0, '127.0.0.1');
      await new Promise((r) => srv.once('listening', r));
      const url = 'http://127.0.0.1:' + srv.address().port;

      const healthRes = await fetch(url + '/api/health');
      assert.equal(healthRes.status, 200);
      const health = await healthRes.json();
      assert.equal(health.storage.verified, true);
      assert.equal(health.storage.readable, true);
      assert.equal(health.storage.writable, true);
      assert.equal(health.storage.accessMode, 'private');

      const authStatus = await (await fetch(url + '/api/admin/auth-status')).json();
      assert.equal(authStatus.storageConfigured, true);
      assert.equal(authStatus.storageMessage, null);
      srv.closeAllConnections?.();
      srv.close();
    `;
    await runScriptAsync(okScript);
  } finally {
    await new Promise<void>((resolve) => {
      blobServer.closeAllConnections?.();
      blobServer.close(() => resolve());
    });
  }
});

test('Concurrent drink sales cannot oversell remaining stock', async () => {
  const loginRes = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-Forwarded-For': '203.0.113.88',
    },
    body: JSON.stringify({
      username: 'leadadmin@thegrid.pk',
      password: 'RoversGrid2026!Strong',
    }),
  });
  assert.equal(loginRes.status, 200);
  const cookie = extractCookiePair(loginRes.headers.get('set-cookie'));

  const createDrinkRes = await fetch(`${baseUrl}/api/admin/drinks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify({
      name: 'Electrolyte Race Drink',
      category: 'hydration_drinks',
      pricePkr: 250,
      purchasePricePkr: 150,
      openingStock: 1,
    }),
  });
  assert.equal(createDrinkRes.status, 201);
  const created = (await createDrinkRes.json()) as { drink: { id: number } };

  const [saleA, saleB] = await Promise.all([
    fetch(`${baseUrl}/api/admin/drinks/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ drinkId: created.drink.id, quantity: 1 }),
    }),
    fetch(`${baseUrl}/api/admin/drinks/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ drinkId: created.drink.id, quantity: 1 }),
    }),
  ]);

  const statuses = [saleA.status, saleB.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [201, 400]);

  const drinksRes = await fetch(`${baseUrl}/api/admin/drinks`, {
    headers: { Cookie: cookie },
  });
  const drinksJson = (await drinksRes.json()) as {
    drinks: Array<{ id: number; current_stock: number }>;
  };
  assert.equal(
    drinksJson.drinks.find((d) => d.id === created.drink.id)?.current_stock,
    0
  );
});

