import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { run } from '../build/cli.js';
import { startServer } from '../build/server.js';
import { demoService } from '../build/demo-service.js';
import { replay, loopbackBase } from '../build/replay.js';
import { examples, requestFixtures } from '../build/examples.js';
const quiet = { out: () => {}, error: () => {} };
const ready = async (server) => {
  if (!server.listening) await once(server, 'listening');
  return 'http://127.0.0.1:' + server.address().port;
};
const close = (server) =>
  new Promise((r) => {
    server.closeAllConnections();
    server.close(r);
  });
test('CLI passes, blocks, reviews, exports, and rejects invalid input', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'boundary-'));
  try {
    assert.equal(
      await run(
        [
          'compare',
          'examples/v1.json',
          'examples/safe.json',
          '--json',
          join(dir, 'report.json'),
          '--markdown',
          join(dir, 'report.md'),
        ],
        quiet,
      ),
      0,
    );
    assert.equal(JSON.parse(await readFile(join(dir, 'report.json'), 'utf8')).verdict, 'PASS');
    assert.match(await readFile(join(dir, 'report.md'), 'utf8'), /Boundary compatibility report/);
    assert.equal(await run(['compare', 'examples/v1.json', 'examples/breaking.json'], quiet), 1);
    assert.equal(await run(['compare', 'examples/v1.json', 'examples/review.json'], quiet), 2);
    assert.equal(await run(['compare', 'missing', 'missing'], quiet), 3);
    assert.equal(await run(['compare', 'a', 'b', '--unknown', 'x'], quiet), 3);
    assert.equal(await run(['--help'], quiet), 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
for (const url of [
  'https://127.0.0.1',
  'http://localhost',
  'http://example.com',
  'http://169.254.169.254',
  'http://user:pass@127.0.0.1',
  'http://127.0.0.1/?x=1',
  'http://127.0.0.1/#fragment',
])
  test('replay rejects ' + url, () => assert.throws(() => loopbackBase(url)));
test('replay makes actual HTTP calls: compatible service passes and breaking service blocks', async () => {
  const c = examples()[0],
    a = demoService('safe'),
    b = demoService('breaking');
  try {
    const good = await replay(
      c.baseline,
      examples()[1].candidate,
      requestFixtures(),
      await ready(a),
    );
    assert.equal(good.length, 4);
    assert.ok(good.every((x) => x.verdict === 'PASS'));
    assert.ok(good.every((x) => x.status === 200 || x.status === 202));
    const bad = await replay(c.baseline, c.candidate, requestFixtures(), await ready(b));
    assert.ok(bad.some((x) => x.verdict === 'BLOCK'));
    assert.ok(bad.some((x) => x.status === 422));
  } finally {
    await close(a);
    await close(b);
  }
});
test('replay refuses redirects, auth headers, and oversized responses', async () => {
  let calls = 0;
  const c = examples()[0],
    s = createServer((req, res) => {
      calls++;
      if (req.url.includes('large')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ x: 'x'.repeat(70000) }));
      } else {
        res.writeHead(302, { Location: 'http://example.com/' });
        res.end();
      }
    });
  s.listen(0, '127.0.0.1');
  try {
    const base = await ready(s),
      fixtures = requestFixtures().slice(0, 1);
    assert.equal((await replay(c.baseline, c.candidate, fixtures, base))[0].verdict, 'REVIEW');
    assert.equal(calls, 1);
    fixtures[0].request.parameters = { 'header:authorization': 'secret' };
    assert.equal((await replay(c.baseline, c.candidate, fixtures, base))[0].verdict, 'REVIEW');
    assert.equal(calls, 1);
    const d = JSON.parse(c.baseline);
    d.paths['/large'] = d.paths['/jobs'];
    const r = await replay(
      JSON.stringify(d),
      JSON.stringify(d),
      [{ name: 'large', method: 'GET', path: '/large', request: {} }],
      base,
    );
    assert.match(r[0].detail, /64 KiB/);
  } finally {
    await close(s);
  }
});
test('local API isolates real comparisons, requires token, bounds inputs, and serves workbench', async () => {
  assert.throws(() => startServer({ token: 'short' }), /24/);
  const token = 'unit-test-only-token-32-characters',
    s = startServer({ token, port: 0 });
  try {
    const base = await ready(s),
      c = examples()[0];
    assert.equal((await fetch(base + '/health')).status, 200);
    assert.equal((await fetch(base + '/api/compare', { method: 'POST' })).status, 401);
    const r = await fetch(base + '/api/compare', {
      method: 'POST',
      headers: { 'X-Admin-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(c),
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).verdict, 'BLOCK');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('content-security-policy'), /worker-src 'self'/);
    const invalid = await fetch(base + '/api/compare', {
      method: 'POST',
      headers: { 'X-Admin-Token': token },
      body: JSON.stringify({ baseline: 'bad', candidate: 'bad' }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(
      (await fetch(base + '/api/replay', { method: 'POST', headers: { 'X-Admin-Token': token } }))
        .status,
      404,
    );
    const huge = await fetch(base + '/api/compare', {
      method: 'POST',
      headers: { 'X-Admin-Token': token },
      body: ' '.repeat(1200001),
    });
    assert.equal(huge.status, 413);
    const html = await fetch(base + '/');
    assert.equal(html.status, 200);
    assert.match(await html.text(), /Change the API/);
    assert.equal((await fetch(base + '/%2e%2e%2fpackage.json')).status, 404);
  } finally {
    await close(s);
  }
});
