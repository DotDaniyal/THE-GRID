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
