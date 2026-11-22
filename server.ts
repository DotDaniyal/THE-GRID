import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { IS_PRODUCTION, SERVER_PORT } from './src/server/config/constants.ts';
import { getDb } from './src/server/db/sqlite.ts';
import { securityHeadersMiddleware } from './src/server/middleware/securityHeaders.ts';
import { adminRouter } from './src/server/routes/adminRoutes.ts';
import { publicBookingRouter } from './src/server/routes/publicBookingRoutes.ts';

async function startServer() {
  getDb();

  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeadersMiddleware);
  app.use(express.json({ limit: '100kb' }));

  app.use('/api', publicBookingRouter);
  app.use('/api/admin', adminRouter);

  if (!IS_PRODUCTION) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(SERVER_PORT, '0.0.0.0', () => {
    console.log(`THE GRID server listening on http://0.0.0.0:${SERVER_PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
