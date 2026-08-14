import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ports = JSON.parse(readFileSync(path.join(rootDir, 'ports.json'), 'utf8')) as {
  web: { frontend: number; backend: number };
  desktop: { frontendDev: number; backend: number };
};

const vitePort = Number(process.env.CHATPLUS_VITE_PORT ?? ports.web.frontend);
const apiOrigin =
  process.env.CHATPLUS_API_ORIGIN ?? `http://127.0.0.1:${ports.web.backend}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: vitePort,
    strictPort: true,
    proxy: {
      '/api': {
        target: apiOrigin,
        changeOrigin: true,
        // Keep long-lived SSE chat streams open through the Vite proxy.
        timeout: 0,
      },
    },
  },
});
