import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createApiApp } from './src/server/app.ts';
import { IS_PRODUCTION, SERVER_PORT } from './src/server/config/constants.ts';
import { releaseExpiredPendingBookings } from './src/server/services/bookingService.ts';
import { ensureStoreInitialized } from './src/server/storage/jsonStore.ts';

async function startServer() {
  const app = createApiApp();

  if (!IS_PRODUCTION) {
    const vitePromise = createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    vitePromise.catch((err) => {
      console.error('Fatal Vite server initialization error:', err);
      process.exit(1);
    });
    app.use((req, res, next) => {
      vitePromise
        .then((vite) => {
          vite.middlewares(req, res, next);
        })
        .catch(next);
    });
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

  const holdSweepTimer = setInterval(() => {
    void releaseExpiredPendingBookings().catch((err) => {
      console.error('Pending hold sweep error:', err);
    });
  }, 30_000);
  holdSweepTimer.unref?.();

  app.listen(SERVER_PORT, '0.0.0.0', () => {
    console.log(`THE GRID server listening on http://0.0.0.0:${SERVER_PORT}`);

    // Warm storage and sweep expired holds in the background so port 3000 binds immediately.
    void ensureStoreInitialized()
      .then(() => releaseExpiredPendingBookings())
      .catch((err) => {
        console.error(
          '[startup] Storage initialization deferred; server running in diagnostic mode:',
          err instanceof Error ? err.message : err
        );
      });
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
