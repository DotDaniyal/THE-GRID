export class ApiRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

export async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
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
    throw new ApiRequestError(msg, res.status);
  }

  return data as T;
}
