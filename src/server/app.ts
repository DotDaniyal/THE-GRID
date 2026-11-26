import express, { type NextFunction, type Request, type Response } from 'express';
import { securityHeadersMiddleware } from './middleware/securityHeaders.ts';
import { adminRouter } from './routes/adminRoutes.ts';
import { publicBookingRouter } from './routes/publicBookingRoutes.ts';
import { StorageConfigurationError } from './storage/drivers.ts';
import { ensureStoreInitialized } from './storage/jsonStore.ts';

export function createApiApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(securityHeadersMiddleware);
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', async (req, res, next) => {
    if (!req.path.endsWith('/stream')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    if (req.path === '/health' || req.path === '/admin/auth-status') {
      next();
      return;
    }
    try {
      await ensureStoreInitialized();
      next();
    } catch (err) {
      next(err);
    }
  });

  app.use('/api', publicBookingRouter);
  app.use('/api/admin', adminRouter);

  app.use('/api', (req, res) => {
    res.status(404).json({
      error: `API route not found: ${req.method} ${req.originalUrl || req.url}`,
      code: 'API_ROUTE_NOT_FOUND',
    });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled API error:', err);
    if (!res.headersSent) {
      if (err instanceof StorageConfigurationError) {
        res.status(503).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  return app;
}
