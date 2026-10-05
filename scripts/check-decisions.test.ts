/**
 * check-decisions.test.ts — tests for scripts/check-decisions.mjs.
 * Run: node --test --experimental-strip-types scripts/check-decisions.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore -- plain .mjs, no types
import { parseDecisions, checkDecisions } from './check-decisions.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-decisions.mjs');

const REAL = new Set(['apps/forge/cli.ts', 'packages/x/a.test.ts', 'scripts/check-foo.mjs']);
const exists = (p: string) => REAL.has(p);

function ledger(decisionRows: string[], rejectedRows: string[] = ['| R-1 | Job queue | Battle-tested tools exist |'], extra = ''): string {
  return [
    '# Decisions', '',
    '## Decisions', '',
    '| ID | Decision | Why | Enforced by |',
    '|----|----------|-----|-------------|',
    ...decisionRows, '',
    '## Rejected — don\'t re-propose', '',
    '| ID | Rejected | Why |',
    '|----|----------|-----|',
    ...rejectedRows, '', extra,
  ].join('\n');
}
const row = (id: string, enforced: string) => `| ${id} | Do a thing | Because | ${enforced} |`;
const run = (rows: string[], rej?: string[], extra?: string) =>
  checkDecisions({ markdown: ledger(rows, rej, extra), exists });

test('valid ledger has no violations', () => {
  assert.deepEqual(run([row('D-01', '`scripts/check-foo.mjs`'), row('D-2', 'review')]), []);
});

test('parseDecisions returns rows with ids and line numbers', () => {
  const p = parseDecisions(ledger([row('D-01', 'review')]));
  assert.equal(p.decisions.length, 1);
  assert.equal(p.decisions[0].id, 'D-01');
  assert.equal(p.decisions[0].enforcedBy, 'review');
  assert.equal(p.rejected[0].id, 'R-1');
  assert.deepEqual(p.errors, []);
});

// Kills: an impl that only checks the Decisions heading.
test('missing Rejected heading is a violation naming it', () => {
  const md = ledger([row('D-1', 'review')]).split('## Rejected')[0];
  const v = checkDecisions({ markdown: md, exists });
  assert.ok(v.some((x: string) => x.includes('Rejected') && x.includes('missing')), v.join('\n'));
});

// Kills: an impl comparing ids as raw strings.
test('D-1 and D-01 are duplicates', () => {
  const v = run([row('D-1', 'review'), row('D-01', 'review')]);
  assert.ok(v.some((x: string) => x.includes('duplicate') && x.includes('D-01')), v.join('\n'));
});

// Kills: an impl that skips empty-cell validation.
test('empty cell is a violation', () => {
  const v = run(['| D-1 | Do a thing |  | review |']);
  assert.ok(v.some((x: string) => x.includes('D-1') && x.includes('empty')), v.join('\n'));
});

// Kills: an impl that does not call exists().
test('nonexistent path is a violation with the exact message', () => {
  const v = run([row('D-1', 'scripts/nope.mjs')]);
  assert.deepEqual(v, ['D-1: "Enforced by" part "scripts/nope.mjs" is neither `review` nor an existing path']);
});

test('review is accepted', () => {
  assert.deepEqual(run([row('D-1', 'review')]), []);
});

// Kills: a case-insensitive review comparison.
test('Review (wrong case) is rejected', () => {
  const v = run([row('D-1', 'Review')]);
  assert.equal(v.length, 1);
  assert.ok(v[0].includes('"Review"'));
});

// Kills: an impl that checks the path with its note attached.
test('parenthetical note is stripped before the existence check', () => {
  assert.deepEqual(run([row('D-1', '`packages/x/a.test.ts` (missing-worktree half: review)')]), []);
  assert.deepEqual(run([row('D-1', 'packages/x/a.test.ts (missing-worktree half: review); review')]), []);
});

// Kills: an impl that treats commands as prose.
test('node command resolves its first path token', () => {
  assert.deepEqual(run([row('D-1', '`node apps/forge/cli.ts studio lint`')]), []);
  assert.deepEqual(run([row('D-1', 'node --experimental-strip-types apps/forge/cli.ts studio lint')]), []);
});

// Kills: an impl that accepts any string starting with node.
test('node command with no path token is a violation', () => {
  const v = run([row('D-1', 'node --version')]);
  assert.equal(v.length, 1);
  assert.ok(v[0].includes('neither `review` nor an existing path'));
});

// Kills: an impl that accepts the first path-looking token even if missing.
test('command whose path does not exist is a violation', () => {
  assert.equal(run([row('D-1', 'npm run scripts/missing.mjs')]).length, 1);
});

// Kills: an impl that expands globs.
test('glob is rejected', () => {
  assert.equal(run([row('D-1', 'scripts/*.test.ts')]).length, 1);
});

// Kills: an impl that does not reject traversal even if exists() says yes.
test('.. path is rejected', () => {
  const v = checkDecisions({ markdown: ledger([row('D-1', '../x')]), exists: () => true });
  assert.equal(v.length, 1);
});

// Kills: an impl that accepts absolute paths that exist.
test('absolute path is rejected', () => {
  const v = checkDecisions({ markdown: ledger([row('D-1', '/etc/passwd')]), exists: () => true });
  assert.equal(v.length, 1);
});

// Kills: an impl that lets prose through.
test('prose is rejected', () => {
  assert.equal(run([row('D-1', 'the CI job')]).length, 1);
});

// Kills: an impl that passes an empty ledger.
test('empty ledger is a violation', () => {
  const v = run([]);
  assert.ok(v.some((x: string) => x.includes('no decision rows')), v.join('\n'));
});

// Kills: an impl that does not scan the whole file, or omits line numbers.
test('"aim for" is flagged with its line number', () => {
  const md = ledger([row('D-1', 'review')], undefined, 'We aim for 25 pages.');
  const lineNo = md.split('\n').findIndex((l) => l.includes('aim for')) + 1;
  const v = checkDecisions({ markdown: md, exists });
  assert.ok(v.some((x: string) => x.includes(`line ${lineNo}`) && x.includes('aim for')), v.join('\n'));
});

test('"Up To" and "use the budget" are flagged case-insensitively', () => {
  assert.equal(run([row('D-1', 'review')], undefined, 'Up To 5\nUSE THE BUDGET').length, 2);
});

// Kills: an impl that accepts bad ids.
test('bad id pattern is a violation', () => {
  const v = run([row('X-1', 'review')]);
  assert.ok(v.some((x: string) => x.includes('X-1')), v.join('\n'));
});

// Kills: an impl that checks only the heading, not the table header.
test('wrong table header is a violation', () => {
  const md = ledger([row('D-1', 'review')]).replace('| ID | Decision | Why | Enforced by |', '| ID | Decision | Why | Owner |');
  assert.ok(checkDecisions({ markdown: md, exists }).length >= 1);
});

function tmpRoot(md?: string): string {
  const d = mkdtempSync(join(tmpdir(), 'check-decisions-'));
  mkdirSync(join(d, 'scripts'), { recursive: true });
  writeFileSync(join(d, 'scripts/check-foo.mjs'), '');
  if (md !== undefined) writeFileSync(join(d, 'DECISIONS.md'), md);
  return d;
}
const cli = (root: string) => spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' });

test('CLI pass: exit 0 and PASS line with counts', () => {
  const d = tmpRoot(ledger([row('D-1', 'scripts/check-foo.mjs'), row('D-2', 'review')]));
  try {
    const r = cli(d);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.stdout.trim(), 'check-decisions: PASS — 2 decisions, 1 rejected, 1 check-enforced, 1 review-only');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('CLI fail: exit 1 with FAIL line', () => {
  const d = tmpRoot(ledger([row('D-1', 'scripts/nope.mjs')]));
  try {
    const r = cli(d);
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /D-1: "Enforced by" part "scripts\/nope\.mjs"/);
    assert.match(r.stdout + r.stderr, /check-decisions: FAIL — 1 violation\(s\)/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// Kills: an impl where a missing file is a vacuous pass.
test('CLI missing DECISIONS.md: exit 1', () => {
  const d = tmpRoot();
  try {
    const r = cli(d);
    assert.equal(r.status, 1);
    assert.ok((r.stdout + r.stderr).includes(`DECISIONS.md not found at ${d}`));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('CLI usage error: exit 2 on extra args', () => {
  const r = spawnSync(process.execPath, [SCRIPT, 'a', 'b'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
});
