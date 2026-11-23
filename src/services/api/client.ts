let inMemoryAdminSessionToken: string | null = null;

export function setInMemoryAdminSessionToken(token: string | null): void {
  inMemoryAdminSessionToken = token && token.trim() ? token.trim() : null;
}

export function clearInMemoryAdminSessionToken(): void {
  inMemoryAdminSessionToken = null;
}

export class ApiRequestError extends Error {
  status: number;
  code?: string;
  retryAfterSeconds?: number;

  constructor(
    message: string,
    status: number,
    options?: { code?: string; retryAfterSeconds?: number }
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = options?.code;
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}

export async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('X-Requested-With')) {
    headers.set('X-Requested-With', 'XMLHttpRequest');
  }
  if (
    url.startsWith('/api/admin') &&
    inMemoryAdminSessionToken &&
    !headers.has('Authorization')
  ) {
    headers.set('Authorization', `Bearer ${inMemoryAdminSessionToken}`);
  }

  const res = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    headers,
  });

  if (res.status === 401 && url.startsWith('/api/admin')) {
    inMemoryAdminSessionToken = null;
  }

  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    // Non-JSON response fallback
  }

  if (!res.ok) {
    const msg =
      typeof data.error === 'string' && data.error.trim().length > 0
        ? data.error
        : `Request failed (${res.status}).`;
    const code = typeof data.code === 'string' ? data.code : undefined;
    const retryAfterSeconds =
      typeof data.retryAfterSeconds === 'number' ? data.retryAfterSeconds : undefined;
    throw new ApiRequestError(msg, res.status, { code, retryAfterSeconds });
  }

  return data as T;
}
