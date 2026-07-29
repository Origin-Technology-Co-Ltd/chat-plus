import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { initDb } from './db/init.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerSettingsRoutes } from './routes/settings.js';

type PortsFile = {
  web: { frontend: number; backend: number };
  desktop: { frontendDev: number; backend: number };
};

/** Fallback when `ports.json` is absent (packaged sidecar). Keep in sync with repo-root ports.json. */
const FALLBACK_PORTS: PortsFile = {
  web: { frontend: 18770, backend: 18771 },
  desktop: { frontendDev: 18772, backend: 18773 },
};

function loadPorts(): PortsFile {
  try {
    const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    return JSON.parse(readFileSync(path.join(rootDir, 'ports.json'), 'utf8')) as PortsFile;
  } catch {
    return FALLBACK_PORTS;
  }
}

const ports = loadPorts();

/** Browser `pnpm dev` default. Desktop sidecar overrides via `PORT` (desktop.backend). */
const DEFAULT_PORT = ports.web.backend;
const PORT = Number(process.env.PORT ?? DEFAULT_PORT);
const HOST = '127.0.0.1';
const ALLOWED_ORIGINS = new Set([
  `http://127.0.0.1:${ports.web.frontend}`,
  `http://localhost:${ports.web.frontend}`,
  `http://127.0.0.1:${ports.desktop.frontendDev}`,
  `http://localhost:${ports.desktop.frontendDev}`,
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
]);

async function main(): Promise<void> {
  initDb();

  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || ALLOWED_ORIGINS.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin not allowed: ${origin}`), false);
    },
  });

  await registerSettingsRoutes(app);
  await registerSessionRoutes(app);

  app.get('/api/health', async () => ({ ok: true }));

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`ChatPlus backend listening on http://${HOST}:${PORT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
