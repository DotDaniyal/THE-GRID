import type { Request, Response } from 'express';
import { createApiApp } from '../src/server/app.ts';

let cachedApp: ReturnType<typeof createApiApp> | null = null;

export default function handler(req: Request, res: Response) {
  if (!cachedApp) {
    cachedApp = createApiApp();
  }
  return cachedApp(req, res);
}
