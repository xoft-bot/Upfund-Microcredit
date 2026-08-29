import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { version: string };

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5000, proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true }, '/health': { target: 'http://localhost:3000', changeOrigin: true } } },
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(packageJson.version), 'import.meta.env.VITE_GIT_SHA': JSON.stringify(process.env.GIT_SHA ?? process.env.VITE_GIT_SHA ?? 'dev') },
  build: { outDir: 'dist', emptyOutDir: true },
});
