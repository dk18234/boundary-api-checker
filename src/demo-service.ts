import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { exampleDocuments } from './examples.js';
import { parseSpec } from './core/parse.js';
import { operations, validateRequest } from './core/operations.js';
import type { Fixture, Json } from './core/types.js';
export function demoService(version: 'baseline' | 'safe' | 'breaking' = 'safe', port = 0) {
  const doc = parseSpec(JSON.stringify(exampleDocuments()[version])),
    ops = operations(doc);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const template = url.pathname.startsWith('/jobs/') ? '/jobs/{jobId}' : url.pathname,
        key = req.method + ' ' + template,
        op = ops.get(key);
      const respond = (status: number, value?: unknown) => {
        res.writeHead(status, value === undefined ? {} : { 'Content-Type': 'application/json' });
        res.end(value === undefined ? undefined : JSON.stringify(value));
      };
      if (!op) {
        respond(404, { error: 'Route removed or absent' });
        return;
      }
      let size = 0,
        text = '';
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 65536) {
          respond(413);
          return;
        }
        text += chunk.toString();
      }
      const parameters: Record<string, Json> = {};
      if (template.includes('{jobId}'))
        parameters['path:jobId'] = decodeURIComponent(url.pathname.slice(6));
      if (url.searchParams.has('limit'))
        parameters['query:limit'] = Number(url.searchParams.get('limit'));
      const fixture: Fixture = {
        name: 'HTTP request',
        method: req.method ?? 'GET',
        path: template,
        request: { parameters, ...(text ? { body: JSON.parse(text) as Json } : {}) },
      };
      const validated = validateRequest(doc, op, fixture);
      if (validated.verdict !== 'valid') {
        respond(422, { error: 'Request rejected by this version', details: validated.errors });
        return;
      }
      const job = {
        id: version === 'breaking' ? 17 : 'job_001',
        state: version === 'breaking' ? 'cancelled' : 'queued',
      };
      if (req.method === 'DELETE') {
        respond(204);
        return;
      }
      respond(
        req.method === 'POST' ? 202 : 200,
        url.pathname === '/health'
          ? { status: 'ok' }
          : template === '/jobs' && req.method === 'GET'
            ? [job]
            : job,
      );
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end('{"error":"Invalid synthetic request"}');
    }
  });
  server.listen(port, '127.0.0.1');
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = process.env.DEMO_VERSION ?? 'safe';
  if (!['baseline', 'safe', 'breaking'].includes(version))
    throw new Error('DEMO_VERSION must be baseline, safe, or breaking');
  const server = demoService(version as 'safe', Number(process.env.DEMO_PORT ?? 8085));
  server.on('listening', () => console.log('Synthetic Research Jobs API ready'));
}
