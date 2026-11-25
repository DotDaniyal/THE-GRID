import type { NextFunction, Request, Response } from 'express';
import { readCollection, updateCollection } from '../storage/jsonStore.ts';

const LOCKOUT_TRACK_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_THRESHOLD = 5;

export function getRequestClientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function createRateLimiter(windowMs: number, maxRequests: number, errorMessage: string) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = getRequestClientIp(req);
    const now = Date.now();
    const record = hits.get(ip);

    if (!record || now > record.resetAt) {
      hits.set(ip, { count: 1, resetAt: now + windowMs });
      if (hits.size > 1000) {
        for (const [key, val] of hits.entries()) {
          if (now > val.resetAt) hits.delete(key);
        }
      }
      next();
      return;
    }

    if (record.count >= maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({ error: errorMessage, retryAfterSeconds });
      return;
    }

    record.count += 1;
    next();
  };
}

export function getLockoutDurationSeconds(failedCount: number): number {
  if (failedCount < LOCKOUT_THRESHOLD) return 0;
  if (failedCount === 5) return 60;
  if (failedCount === 6) return 120;
  if (failedCount === 7) return 300;
  return 900;
}

export async function checkAuthLockout(
  ip: string,
  now = Date.now()
): Promise<{ locked: boolean; retryAfterSeconds: number; failedCount: number }> {
  const adminSettings = await readCollection('admin-settings');
  const attemptKey = `ip:${ip}`;
  const row = adminSettings.loginAttempts.find((a) => a.attempt_key === attemptKey);

  if (!row) {
    return { locked: false, retryAfterSeconds: 0, failedCount: 0 };
  }

  if (row.locked_until > now) {
    return {
      locked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((row.locked_until - now) / 1000)),
      failedCount: row.failed_count,
    };
  }

  if (now - row.first_failed_at > LOCKOUT_TRACK_WINDOW_MS) {
    await updateCollection(
      'admin-settings',
      (draft) => {
        draft.loginAttempts = draft.loginAttempts.filter((a) => a.attempt_key !== attemptKey);
      },
      { skipBackup: true }
    );
    return { locked: false, retryAfterSeconds: 0, failedCount: 0 };
  }

  return { locked: false, retryAfterSeconds: 0, failedCount: row.failed_count };
}

export async function recordAuthFailure(
  ip: string,
  now = Date.now()
): Promise<{ locked: boolean; retryAfterSeconds: number; failedCount: number }> {
  const attemptKey = `ip:${ip}`;

  const { result } = await updateCollection(
    'admin-settings',
    (draft) => {
      const existing = draft.loginAttempts.find((a) => a.attempt_key === attemptKey);
      let nextCount = 1;
      let firstFailedAt = now;

      if (existing && now - existing.first_failed_at <= LOCKOUT_TRACK_WINDOW_MS) {
        nextCount = existing.failed_count + 1;
        firstFailedAt = existing.first_failed_at;
      }

      const lockoutSeconds = getLockoutDurationSeconds(nextCount);
      const lockedUntil = lockoutSeconds > 0 ? now + lockoutSeconds * 1000 : 0;

      if (existing) {
        existing.failed_count = nextCount;
        existing.first_failed_at = firstFailedAt;
        existing.locked_until = lockedUntil;
        existing.updated_at = now;
      } else {
        draft.loginAttempts.push({
          attempt_key: attemptKey,
          failed_count: nextCount,
          first_failed_at: firstFailedAt,
          locked_until: lockedUntil,
          updated_at: now,
        });
      }

      return {
        locked: lockoutSeconds > 0,
        retryAfterSeconds: lockoutSeconds,
        failedCount: nextCount,
      };
    },
    { skipBackup: true }
  );

  return result;
}

export async function clearAuthFailures(ip: string): Promise<void> {
  const attemptKey = `ip:${ip}`;
  const adminSettings = await readCollection('admin-settings');
  if (!adminSettings.loginAttempts.some((a) => a.attempt_key === attemptKey)) {
    return;
  }
  await updateCollection(
    'admin-settings',
    (draft) => {
      draft.loginAttempts = draft.loginAttempts.filter((a) => a.attempt_key !== attemptKey);
    },
    { skipBackup: true }
  );
}

export const bookingRateLimit = createRateLimiter(
  10 * 60 * 1000,
  15,
  'Too many booking requests from this network. Please wait a few minutes and try again.'
);

export const authRateLimit = createRateLimiter(
  15 * 60 * 1000,
  25,
  'Too many authentication requests from this network. Please wait before retrying.'
);
