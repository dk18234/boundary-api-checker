import type { Report, Json } from './types.js';
export const exitCode = (report: Report): number =>
  report.verdict === 'BLOCK' ? 1 : report.verdict === 'REVIEW' ? 2 : 0;
const cell = (v: string): string => v.replaceAll('|', '\\|').replaceAll('\n', ' ');
export function markdown(report: Report): string {
  const lines = [
    '# Boundary compatibility report',
    '',
    `**${report.verdict}** · ${report.counts.breaking} breaking · ${report.counts.review} review · ${report.counts.safe} compatible changes`,
    '',
    `${report.baseline.title} ${report.baseline.version} → ${report.candidate.version}`,
    '',
    '| ID | Severity | Direction | Operation | Finding |',
    '|---|---|---|---|---|',
    ...report.findings.map(
      (f) =>
        `| ${f.id} | ${f.severity} | ${f.direction} | ${cell(f.operation)} | ${cell(f.title)} |`,
    ),
  ];
  for (const f of report.findings) {
    lines.push(
      '',
      `## ${f.id}: ${f.title}`,
      '',
      f.detail,
      '',
      `Rule: ${f.rule}. Pointer: ${f.after.pointer || '/'}.`,
      '',
      f.recommendation,
    );
    if (f.witness)
      lines.push(
        '',
        f.witness.explanation,
        '',
        '```json',
        JSON.stringify(f.witness.value, null, 2),
        '```',
      );
  }
  if (report.fixtures.length)
    lines.push(
      '',
      '## Consumer fixtures',
      '',
      '| Fixture | Direction | Before | After | Outcome |',
      '|---|---|---|---|---|',
      ...report.fixtures.map(
        (f) =>
          `| ${cell(f.name)} | ${f.direction} | ${f.before.verdict} | ${f.after.verdict} | ${f.outcome} |`,
      ),
    );
  lines.push('', '## Scope', '', ...report.scope.map((s) => '- ' + s), '');
  return lines.join('\n');
}
export function summary(report: Report): string {
  return (
    `${report.verdict}: ${report.counts.breaking} breaking, ${report.counts.review} review, ${report.counts.safe} safe\n` +
    report.findings
      .filter((f) => f.severity !== 'safe')
      .map((f) => `${f.id} ${f.operation}: ${f.title}\n  ${f.after.pointer}`)
      .join('\n')
  );
}
