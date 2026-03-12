import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import config from './config.js';
import { initDashboardDb } from './services/database.js';
import sitesApi from './api/sites.js';
import passwordsApi from './api/passwords.js';
import authApi from './api/auth.js';
import { clerkAuth } from './middleware/clerkAuth.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, '..', 'dist');

const app = new Hono();

app.use(logger());
app.use('/api/*', cors());

// Health check
app.get('/health', (c) => c.text('ok'));

// Auth info endpoint (no auth required — returns publishable key)
app.route('/api/auth', authApi);

// Protected API routes
app.use('/api/*', clerkAuth);
app.route('/api/sites', sitesApi);
app.route('/api/passwords', passwordsApi);

// Serve static frontend in production
if (existsSync(distPath)) {
  app.use('/*', serveStatic({ root: './dist' }));

  // SPA fallback — serve index.html for all non-API, non-static routes
  app.get('*', (c) => {
    const html = readFileSync(join(distPath, 'index.html'), 'utf-8');
    return c.html(html);
  });
}

// Init DB and start server
await initDashboardDb();
console.log(`Dashboard starting on port ${config.PORT}`);

serve({
  fetch: app.fetch,
  port: Number(config.PORT),
});
