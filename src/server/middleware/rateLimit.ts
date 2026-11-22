import type { NextFunction, Request, Response } from 'express';

export function createRateLimiter(windowMs: number, maxRequests: number, errorMessage: string) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
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
      res.status(429).json({ error: errorMessage });
      return;
    }

    record.count += 1;
    next();
  };
}

export const bookingRateLimit = createRateLimiter(
  10 * 60 * 1000,
  15,
  'Too many booking requests from this network. Please wait a few minutes and try again.'
);

export const authRateLimit = createRateLimiter(
  15 * 60 * 1000,
  10,
  'Too many authentication attempts. Please wait 15 minutes before retrying.'
);
