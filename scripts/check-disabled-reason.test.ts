/**
 * W7-C3 review (A-M12) — proof the disabled-reason ratchet BITES.
 *
 * A gate that only ever runs on a clean tree proves nothing (this whole
 * review round exists because assertions were added to harnesses nothing
 * runs). These tests run the real checker against the real tree, then
 * against a tree with a fabricated offender, and assert it flips.
 *
 * THE FABRICATED OFFENDER IS PLANTED IN A `mkdtempSync` FIXTURE, NOT THE LIVE
 * TREE — bead forge-8vfn.5.64. It used to `writeFileSync(join(ROOT, …))` a
 * real `apps/studio/components/__ratchet_probe__.tsx` and `rmSync` it again
 * in a `finally`; `node --test` runs `scripts/*.test.ts` files concurrently,
 * so a probe planted and removed there raced every other scanner reading the
 * tree at the same moment — named as the trigger in `check-file-size.mjs`'s
 * own `lineCount` doc, and `font-selfhost.test.ts` did the same thing a third
 * time (`_1.0/known-flakes.md` #6). `check-disabled-reason.mjs` now exports
 * `audit(root)`, so the two probe tests below call it directly instead of
 * going through the CLI's `run()`, which the other (read-only, live-tree)
 * tests in this file keep using unchanged.
 *
 * RUN: node --test --experimental-strip-types scripts/check-disabled-reason.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { audit } from './check-disabled-reason.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = join(ROOT, 'scripts/check-disabled-reason.mjs');

function run(): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync('node', [CHECKER], { cwd: ROOT, encoding: 'utf8' }) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** A `mkdtempSync` root with just enough of `apps/studio` for `audit()` to
 *  scan, plus the one probe `.tsx` file. */
function disabledReasonFixture(tsx: string): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'disabled-reason-'));
  mkdirSync(join(root, 'apps/studio/app'), { recursive: true });
  const componentsDir = join(root, 'apps/studio/components');
  mkdirSync(componentsDir, { recursive: true });
  writeFileSync(join(componentsDir, '__ratchet_probe__.tsx'), tsx);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('the tree is clean — every disabled primary CTA carries its reason', () => {
  const { code, out } = run();
  assert.equal(code, 0, out);
  assert.match(out, /check-disabled-reason: PASS/);
});

test('the checker actually inspects a real population, not an empty set', () => {
  const json = JSON.parse(execFileSync('node', [CHECKER, '--json'], { cwd: ROOT, encoding: 'utf8' }));
  assert.ok(json.checked >= 20, `expected the real primary-CTA population, got ${json.checked}`);
  assert.deepEqual(json.offenders, []);
});

test('it FAILS on a disabled primary CTA with no reason (the defect it exists for)', () => {
  const { root, cleanup } = disabledReasonFixture([
    "'use client';",
    'export function Probe({ busy }: { busy: boolean }) {',
    '  return (',
    '    <button className="btn btn-primary" data-action="probe-cta" disabled={busy}>Go</button>',
    '  );',
    '}',
    '',
  ].join('\n'));
  try {
    const result = audit(root);
    assert.equal(result.offenders.length, 1, `the ratchet must fail on an unreasoned disabled primary CTA — got: ${JSON.stringify(result)}`);
    assert.match(result.offenders[0]!.file, /__ratchet_probe__\.tsx/);
    assert.equal(result.offenders[0]!.action, 'probe-cta');
  } finally {
    cleanup();
  }
});

test('it PASSES the same CTA once the reason is spread from the ONE derivation', () => {
  const { root, cleanup } = disabledReasonFixture([
    "'use client';",
    "import { disabledAttrs } from '@/lib/disabled-reason';",
    'export function Probe({ busy }: { busy: boolean }) {',
    '  return (',
    '    <button className="btn btn-primary" data-action="probe-cta" {...disabledAttrs(busy ? \'Working…\' : null)}>Go</button>',
    '  );',
    '}',
    '',
  ].join('\n'));
  try {
    const result = audit(root);
    assert.deepEqual(result.offenders, [], 'a CTA whose reason comes from disabledAttrs must satisfy the ratchet');
  } finally {
    cleanup();
  }
});

test('the CI workflow runs it — a gate not wired into CI is decoration', () => {
  const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  assert.match(ci, /check-disabled-reason\.mjs/, 'add a CI step running scripts/check-disabled-reason.mjs');
});
