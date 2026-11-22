import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await mkdir('reports', { recursive: true });
for (const [file, verdict, code] of [
  ['safe', 'PASS', 0],
  ['breaking', 'BLOCK', 1],
  ['review', 'REVIEW', 2],
]) {
  const child = spawnSync(
    process.execPath,
    [
      'bin/boundary.mjs',
      'compare',
      'examples/v1.json',
      `examples/${file}.json`,
      '--fixtures',
      'examples/fixtures.json',
      '--json',
      `reports/${file}.json`,
      '--markdown',
      `reports/${file}.md`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(child.status, code, child.stderr || child.stdout);
  const report = JSON.parse(await readFile(`reports/${file}.json`, 'utf8'));
  assert.equal(report.verdict, verdict);
  console.log(`${file}: ${verdict}, exit ${code}, ${report.findings.length} findings`);
}
