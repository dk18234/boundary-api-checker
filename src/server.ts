import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { InputError, type Report } from './core/types.js';

export function startServer(options: {
  token: string;
  port?: number;
  host?: string;
  staticDir?: string;
}) {
  if (options.token.length < 24) throw new InputError('ADMIN_TOKEN must be at least 24 characters');
  const root = resolve(options.staticDir ?? 'docs');
  let active = 0;
  const json = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(value));
  };
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; worker-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (path === '/health') {
        json(res, 200, { status: 'UP' });
        return;
      }
      if (path.startsWith('/api/')) {
        const supplied = Buffer.from(String(req.headers['x-admin-token'] ?? '')),
          expected = Buffer.from(options.token);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
          json(res, 401, { code: 'UNAUTHORIZED', message: 'A valid operator token is required' });
          return;
        }
        if (path !== '/api/compare' || req.method !== 'POST') {
          json(res, 404, { code: 'NOT_FOUND', message: 'Only POST /api/compare is available' });
          return;
        }
        if (active >= 2) {
          res.setHeader('Retry-After', '1');
          json(res, 429, { code: 'BUSY', message: 'Comparison slots are busy' });
          return;
        }
        active++;
        try {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += b.length;
            if (size > 1200000) {
              json(res, 413, {
                code: 'INPUT_LIMIT',
                message: 'Comparison envelope exceeds 1.2 MB',
              });
              return;
            }
            chunks.push(b);
          }
          let input: unknown;
          try {
            input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            json(res, 400, {
              code: 'INVALID_INPUT',
              message: 'Expected a JSON comparison envelope',
            });
            return;
          }
          const envelope = input as Record<string, unknown>;
          if (
            !envelope ||
            typeof envelope.baseline !== 'string' ||
            typeof envelope.candidate !== 'string'
          ) {
            json(res, 400, {
              code: 'INVALID_INPUT',
              message: 'Provide baseline and candidate specification text',
            });
            return;
          }
          const report = await new Promise<Report>((done, fail) => {
            const worker = new Worker(new URL('./server-worker.js', import.meta.url), {
              workerData: envelope,
              resourceLimits: { maxOldGenerationSizeMb: 96 },
            });
            const timer = setTimeout(() => {
              void worker.terminate();
              fail(new InputError('Comparison exceeded the 8-second worker limit'));
            }, 8000);
            worker.once('message', (result: { report?: Report; error?: string }) => {
              clearTimeout(timer);
              void worker.terminate();
              result.error ? fail(new InputError(result.error)) : done(result.report!);
            });
            worker.once('error', (e) => {
              clearTimeout(timer);
              fail(e);
            });
            worker.once('exit', (code) => {
              if (code !== 0) {
                clearTimeout(timer);
                fail(new InputError('Comparison worker stopped before completion'));
              }
            });
          });
          json(res, 200, report);
        } finally {
          active--;
        }
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        json(res, 405, { code: 'METHOD_NOT_ALLOWED', message: 'Static assets support GET/HEAD' });
        return;
      }
      let decoded: string;
      try {
        decoded = decodeURIComponent(path);
      } catch {
        json(res, 400, { message: 'Invalid URL' });
        return;
      }
      const file = resolve(root, '.' + (decoded === '/' ? '/index.html' : decoded));
      if (file !== root && !file.startsWith(root + '/')) {
        json(res, 404, { message: 'Asset not found' });
        return;
      }
      const bytes = await readFile(file).catch(() => undefined);
      if (!bytes) {
        json(res, 404, { message: 'Asset not found' });
        return;
      }
      const mime: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.json': 'application/json; charset=utf-8',
        '.md': 'text/plain; charset=utf-8',
        '.jpg': 'image/jpeg',
        '.png': 'image/png',
      };
      res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (e) {
      json(res, e instanceof InputError ? 400 : 500, {
        code: e instanceof InputError ? 'INVALID_INPUT' : 'SERVICE_ERROR',
        message: e instanceof InputError ? e.message : 'Comparison could not be completed',
      });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.listen(options.port ?? 8084, options.host ?? '127.0.0.1');
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = startServer({
    token: process.env.ADMIN_TOKEN ?? '',
    port: Number(process.env.PORT ?? 8084),
    host: process.env.HOST ?? '127.0.0.1',
  });
  server.on('listening', () => console.log('Boundary local workbench ready'));
}
