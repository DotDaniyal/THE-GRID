import type { Request, Response } from 'express';
import { createApiApp } from '../src/server/app.ts';

let cachedApp: ReturnType<typeof createApiApp> | null = null;

export default function handler(req: Request, res: Response) {
  if (!cachedApp) {
    cachedApp = createApiApp();
  }
  if (req.url && !req.url.startsWith('/api/') && req.url !== '/api') {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  return cachedApp(req, res);
}
