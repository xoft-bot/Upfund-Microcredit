import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

export function registerStaticAssets(app: FastifyInstance): void {
  const root = resolve(process.cwd(), 'client', 'dist');
  app.get('/*', async (request, reply) => {
    const requested = decodeURIComponent(request.url.split('?')[0] ?? '/');
    const relative = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, '').replace(/^[/\\]+/, '');
    const candidate = join(root, relative || 'index.html');
    let filePath = candidate;
    try {
      if (!(await stat(candidate)).isFile()) throw new Error('NOT_FILE');
    } catch {
      filePath = join(root, 'index.html');
    }
    try {
      const body = await readFile(filePath);
      return reply.type(contentTypes[extname(filePath)] ?? 'application/octet-stream').send(body);
    } catch {
      return reply.code(404).send({ ok: false, error: { code: 'ASSET_NOT_FOUND', message: 'Asset not found' } });
    }
  });
}