import type { Request, Response } from 'express';
import { createApiApp } from '../src/server/app.ts';

let cachedApp: ReturnType<typeof createApiApp> | null = null;

export function normalizeVercelApiRequestUrl(req: Pick<Request, 'url' | 'headers'>): string {
  const rawUrl = req.url || '/api';
  const parsed = new URL(rawUrl, 'https://vercel.local');
  const rewrittenSubpath = parsed.searchParams.get('__path');

  if (rewrittenSubpath !== null) {
    parsed.searchParams.delete('__path');
    const cleanSubpath = rewrittenSubpath.replace(/^\/+/, '');
    const remainingQs = parsed.searchParams.toString();
    req.url = `/api${cleanSubpath ? `/${cleanSubpath}` : '/'}${remainingQs ? `?${remainingQs}` : ''}`;
    return req.url;
  }

  if (parsed.pathname === '/api/index' || parsed.pathname === '/api/index.ts') {
    const originalHeader =
      (typeof req.headers['x-vercel-original-uri'] === 'string' &&
        req.headers['x-vercel-original-uri']) ||
      (typeof req.headers['x-forwarded-uri'] === 'string' && req.headers['x-forwarded-uri']) ||
      '';
    if (originalHeader && originalHeader.startsWith('/api')) {
      const origParsed = new URL(originalHeader, 'https://vercel.local');
      if (origParsed.pathname !== '/api/index' && origParsed.pathname !== '/api/index.ts') {
        req.url = origParsed.pathname + origParsed.search;
        return req.url;
      }
    }
    const remainingQs = parsed.searchParams.toString();
    req.url = `/api${remainingQs ? `?${remainingQs}` : ''}`;
    return req.url;
  }

  if (!parsed.pathname.startsWith('/api/') && parsed.pathname !== '/api') {
    req.url = '/api' + (rawUrl.startsWith('/') ? rawUrl : '/' + rawUrl);
  }

  return req.url;
}

export default function handler(req: Request, res: Response) {
  if (!cachedApp) {
    cachedApp = createApiApp();
  }
  normalizeVercelApiRequestUrl(req);
  return cachedApp(req, res);
}
