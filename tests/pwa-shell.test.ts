import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = readFileSync(new URL('../client/public/manifest.webmanifest', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../client/public/sw.js', import.meta.url), 'utf8');

describe('PWA pilot shell', () => {
  it('declares an installable standalone app with an icon', () => {
    const parsed = JSON.parse(manifest) as { display: string; start_url: string; icons: Array<{ src: string; purpose: string }> };
    expect(parsed.display).toBe('standalone');
    expect(parsed.start_url).toBe('/');
    expect(parsed.icons).toEqual(expect.arrayContaining([expect.objectContaining({ src: '/icon.svg', purpose: 'any maskable' })]));
  });

  it('caches only the static shell and falls back to the app shell offline', () => {
    expect(serviceWorker).toContain("const SHELL_CACHE = 'letsgrow-shell-v2'");
    expect(serviceWorker).toContain("const API_PATHS = ['/api/', '/health']");
    expect(serviceWorker).toContain("caches.match('/index.html')");
    expect(serviceWorker).toContain('self.clients.claim()');
  });
});