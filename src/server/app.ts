import express, { type NextFunction, type Request, type Response } from 'express';
import { getDb } from './db/sqlite.ts';
import { securityHeadersMiddleware } from './middleware/securityHeaders.ts';
import { adminRouter } from './routes/adminRoutes.ts';
import { publicBookingRouter } from './routes/publicBookingRoutes.ts';

export function createApiApp(): express.Express {
  getDb();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(securityHeadersMiddleware);
  app.use(express.json({ limit: '100kb' }));

  app.use('/api', publicBookingRouter);
  app.use('/api/admin', adminRouter);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled API error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  return app;
}
