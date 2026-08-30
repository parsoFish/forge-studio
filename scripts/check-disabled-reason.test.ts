/**
 * W7-C3 review (A-M12) — proof the disabled-reason ratchet BITES.
 *
 * A gate that only ever runs on a clean tree proves nothing (this whole
 * review round exists because assertions were added to harnesses nothing
 * runs). These tests run the real checker against the real tree, then
 * against a tree with a fabricated offender, and assert it flips.
 *
 * RUN: node --test --experimental-strip-types scripts/check-disabled-reason.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const victim = join(ROOT, 'apps/studio/components/__ratchet_probe__.tsx');
  writeFileSync(victim, [
    "'use client';",
    'export function Probe({ busy }: { busy: boolean }) {',
    '  return (',
    '    <button className="btn btn-primary" data-action="probe-cta" disabled={busy}>Go</button>',
    '  );',
    '}',
    '',
  ].join('\n'));
  try {
    const { code, out } = run();
    assert.equal(code, 1, `the ratchet must fail on an unreasoned disabled primary CTA — got exit 0:\n${out}`);
    assert.match(out, /__ratchet_probe__\.tsx/);
    assert.match(out, /probe-cta/);
  } finally {
    rmSync(victim, { force: true });
  }
  assert.equal(run().code, 0, 'the tree must be clean again once the probe is removed');
});

test('it PASSES the same CTA once the reason is spread from the ONE derivation', () => {
  const victim = join(ROOT, 'apps/studio/components/__ratchet_probe__.tsx');
  writeFileSync(victim, [
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
    assert.equal(run().code, 0, 'a CTA whose reason comes from disabledAttrs must satisfy the ratchet');
  } finally {
    rmSync(victim, { force: true });
  }
});

test('the CI workflow runs it — a gate not wired into CI is decoration', () => {
  const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  assert.match(ci, /check-disabled-reason\.mjs/, 'add a CI step running scripts/check-disabled-reason.mjs');
});
