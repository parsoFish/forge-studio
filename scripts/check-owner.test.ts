/**
 * Proof that the one-owner-per-file gate BITES.
 *
 * The spec §8 makes "one session = one package" enforceable only if every
 * production file has an owner. These tests run the real checker against the
 * real `QUARRY.md`, then against six doctored quarries, and assert it flips
 * every time — a checker that always exits 0 cannot pass them.
 *
 * RUN: node --test --experimental-strip-types scripts/check-owner.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = join(ROOT, 'scripts/check-owner.mjs');
const QUARRY = join(ROOT, 'QUARRY.md');

function run(args: string[] = []): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync('node', [CHECKER, ...args], { cwd: ROOT, encoding: 'utf8' }) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** Runs the checker against the real quarry plus one extra or altered row. */
function withQuarry(mutate: (rows: string[]) => string[], body: (quarryPath: string, baselinePath: string) => void): void {
  const rows = readFileSync(QUARRY, 'utf8').split('\n');
  const dir = mkdtempSync(join(tmpdir(), 'quarry-'));
  const quarryPath = join(dir, 'QUARRY.md');
  const baselinePath = join(dir, 'owner.json');
  writeFileSync(quarryPath, `${mutate(rows).join('\n')}\n`);
  writeFileSync(baselinePath, `${JSON.stringify({ unowned: 0 })}\n`);
  try {
    body(quarryPath, baselinePath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the real quarry owns every production file', () => {
  const { code, out } = run();
  assert.equal(code, 0, out);
  assert.match(out, /check-owner: PASS/);
  assert.match(out, /unowned: 0/);
});

test('it accounts for a real population, not an empty set', () => {
  const json = JSON.parse(execFileSync('node', [CHECKER, '--json'], { cwd: ROOT, encoding: 'utf8' }));
  assert.ok(json.files >= 200, `expected the real production population, got ${json.files}`);
  assert.equal(json.rows, json.files, 'exactly one row per production file');
  assert.deepEqual(json.unowned, []);
  assert.deepEqual(json.orphans, []);
  assert.deepEqual(json.duplicates, []);
});

/**
 * The subject these four fixtures manipulate, DERIVED rather than named.
 *
 * §15.93: a guard self-test that hardcodes a real repo path is coupled to every
 * carve — this file named `orchestrator/flow-runner.ts` and went red the moment
 * that file moved into its package. Failing loudly was the good outcome; the
 * bad one is a fixture that keeps passing while pointing at nothing. Taking the
 * first `packages/` row out of the live QUARRY table means the next move cannot
 * strand it, and the assertion below still names whatever it picked.
 */
function aQuarriedProductionFile(): string {
  const row = readFileSync(QUARRY, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^\| packages\/[^|]+\.ts \|/.test(l));
  assert.ok(row, 'QUARRY.md must carry at least one packages/ production row');
  return row!.split('|')[1].trim();
}

test('it FAILS on an unowned file — a row removed (the defect it exists for)', () => {
  const subject = aQuarriedProductionFile();
  withQuarry((rows) => rows.filter((l) => !l.includes(`| ${subject} |`)), (q, b) => {
    const { code, out } = run(['--quarry', q, '--baseline', b]);
    assert.equal(code, 1, `a file with no row must fail — got exit 0:\n${out}`);
    assert.ok(out.includes(`unowned: ${subject}`), `the offending file must be named — got:\n${out}`);
  });
});

test('it FAILS on an orphan row — the quarry describing a file that is not there', () => {
  withQuarry((rows) => [...rows, '| orchestrator/__never_existed__.ts | kernel | verbatim | 12 |'], (q, b) => {
    const { code, out } = run(['--quarry', q, '--baseline', b]);
    assert.equal(code, 1, `a row for a missing file must fail — got exit 0:\n${out}`);
    assert.match(out, /orphan row: orchestrator\/__never_existed__\.ts/);
  });
});

test('it FAILS on a duplicate row — a file has exactly one owner', () => {
  const subj = aQuarriedProductionFile();
  withQuarry((rows) => [...rows, `| ${subj} | flows | verbatim | 1 |`], (q, b) => {
    const { code, out } = run(['--quarry', q, '--baseline', b]);
    assert.equal(code, 1, `two rows for one file must fail — got exit 0:\n${out}`);
    assert.ok(out.includes(`duplicate row: ${subj}`), `the duplicate must be named — got:\n${out}`);
  });
});

test('it FAILS on an owner outside the eleven-package vocabulary', () => {
  const subj = aQuarriedProductionFile();
  withQuarry((rows) => rows.map((l) => (l.includes(`| ${subj} |`) ? `| ${subj} | kernal | verbatim | 1 |` : l)), (q, b) => {
    const { code, out } = run(['--quarry', q, '--baseline', b]);
    assert.equal(code, 1, `a typo'd owner must fail — got exit 0:\n${out}`);
    assert.ok(out.includes(`unknown owner: ${subj} (owner "kernal")`), `the offending owner must be named — got:\n${out}`);
  });
});

test('it FAILS on a disposition outside verbatim|pruned|rewritten|deleted', () => {
  const subj = aQuarriedProductionFile();
  withQuarry((rows) => rows.map((l) => (l.includes(`| ${subj} |`) ? `| ${subj} | kernel | moved | 1 |` : l)), (q, b) => {
    const { code, out } = run(['--quarry', q, '--baseline', b]);
    assert.equal(code, 1, `an invented disposition must fail — got exit 0:\n${out}`);
    assert.ok(out.includes(`unknown disposition: ${subj} (disposition "moved")`), `the offending disposition must be named — got:\n${out}`);
  });
});

test('it FAILS when unowned drops BELOW the baseline — the ratchet must be tightened', () => {
  const dir = mkdtempSync(join(tmpdir(), 'quarry-baseline-'));
  const baselinePath = join(dir, 'owner.json');
  writeFileSync(baselinePath, `${JSON.stringify({ unowned: 5 })}\n`);
  try {
    const { code, out } = run(['--baseline', baselinePath]);
    assert.equal(code, 1, `a slack baseline must fail — got exit 0:\n${out}`);
    assert.match(out, /below the baseline of 5/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('it FAILS when QUARRY.md is absent — ownership has no other source', () => {
  const { code, out } = run(['--quarry', join(ROOT, 'NO_SUCH_QUARRY.md')]);
  assert.equal(code, 1, out);
  assert.match(out, /does not exist/);
});

test('an UNTRACKED production file is still unowned — a file cannot dodge the gate by not being committed', () => {
  const victim = join(ROOT, 'orchestrator/__untracked_owner_probe__.ts');
  writeFileSync(victim, 'export const probe = 1;\n');
  try {
    const { code, out } = run();
    assert.equal(code, 1, `an untracked production file must be counted unowned — got exit 0:\n${out}`);
    assert.match(out, /unowned: orchestrator\/__untracked_owner_probe__\.ts/);
  } finally {
    rmSync(victim, { force: true });
  }
});
