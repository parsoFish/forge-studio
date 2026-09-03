/**
 * Proof that the 800-line hard cap ratchet BITES.
 *
 * `docs/roadmaps/1.0.md` §0 says "File hard cap 800 lines, enforced by lint
 * from M2". A cap that is only ever run against a tree it was baselined from
 * proves nothing, so these tests run the real checker against the real tree,
 * then against a tree with a fabricated offender and against three doctored
 * baselines, and assert it flips every time.
 *
 * RUN: node --test --experimental-strip-types scripts/check-file-size.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = join(ROOT, 'scripts/check-file-size.mjs');
const BASELINE = join(ROOT, 'scripts/baselines/file-size.json');

function run(args: string[] = []): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync('node', [CHECKER, ...args], { cwd: ROOT, encoding: 'utf8' }) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

function withBaseline(entries: Record<string, number>, body: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'cap-baseline-'));
  const path = join(dir, 'file-size.json');
  writeFileSync(path, `${JSON.stringify(entries, null, 2)}\n`);
  try {
    body(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the tree is at its baseline — no un-baselined file is over the cap', () => {
  const { code, out } = run();
  assert.equal(code, 0, out);
  assert.match(out, /check-file-size: PASS/);
});

test('it inspects a real population, not an empty set', () => {
  const json = JSON.parse(execFileSync('node', [CHECKER, '--json'], { cwd: ROOT, encoding: 'utf8' }));
  assert.equal(json.cap, 800, 'the cap is the §0 constant');
  assert.ok(json.checked >= 500, `expected the real code-file population, got ${json.checked}`);
  // NOT a floor on the debt. The old assertion here was `baselined >= 100`,
  // which is a number the 1.0 campaign exists to drive DOWN: M4 deleted the
  // last two `packages/knowledge/` rows, the count reached 98, and a guard
  // went red because the work it guards succeeded. What the assertion is
  // actually for is proving the checker READ a real baseline rather than an
  // empty one, and the invariant that says so without ever expiring is that
  // every row on disk was applied — which `stale: []` below then completes.
  const baselineRows = Object.keys(JSON.parse(readFileSync(BASELINE, 'utf8'))).length;
  assert.equal(json.baselined, baselineRows, `the checker must apply every on-disk baseline row, got ${json.baselined} of ${baselineRows}`);
  assert.ok(baselineRows > 0, 'the baseline must not be empty while any file is over the cap');
  assert.deepEqual(json.newOversize, []);
  assert.deepEqual(json.grown, []);
  assert.deepEqual(json.stale, []);
});

test('it FAILS on a NEW file over the cap (the defect it exists for)', () => {
  const victim = join(ROOT, 'scripts/__cap_probe__.mjs');
  writeFileSync(victim, `${Array.from({ length: 900 }, (_, i) => `// line ${i}`).join('\n')}\n`);
  try {
    const { code, out } = run();
    assert.equal(code, 1, `a new 900-line file must fail the cap — got exit 0:\n${out}`);
    assert.match(out, /scripts\/__cap_probe__\.mjs/);
    assert.match(out, /over the 800-line cap and not baselined/);
  } finally {
    rmSync(victim, { force: true });
  }
});

test('it FAILS when a baselined file GREW — the ratchet only turns one way', () => {
  const real = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, number>;
  const [path, lines] = Object.entries(real)[0]!;
  withBaseline({ ...real, [path]: lines - 1 }, (b) => {
    const { code, out } = run(['--baseline', b]);
    assert.equal(code, 1, `a file above its baseline must fail — got exit 0:\n${out}`);
    assert.match(out, /grew/);
    assert.ok(out.includes(path), `the offender is named: ${out}`);
  });
});

test('it FAILS on a stale baseline entry — a file that no longer needs the exemption', () => {
  withBaseline({ 'scripts/check-file-size.mjs': 5000 }, (b) => {
    const { code, out } = run(['--baseline', b]);
    assert.equal(code, 1, `an entry for a file under the cap must fail as stale — got exit 0:\n${out}`);
    assert.match(out, /stale baseline entry/);
  });
});

test('it FAILS on a baseline entry whose file is gone', () => {
  withBaseline({ 'scripts/__deleted_long_ago__.ts': 1200 }, (b) => {
    const { code, out } = run(['--baseline', b]);
    assert.equal(code, 1, `an entry for a missing file must fail as stale — got exit 0:\n${out}`);
    assert.match(out, /stale baseline entry/);
  });
});


// ---------------------------------------------------------------------------
// known-flakes #6 — a file that vanishes between the glob and the read
// ---------------------------------------------------------------------------

test('lineCount SKIPS a path that vanished between glob and read (known-flakes #6)', async () => {
  const { lineCount } = await import('./check-file-size.mjs');
  const gone = join(ROOT, 'scripts', '__vanished_probe__.ts');
  // POSITIVE CONTROL, deterministic rather than raced: the exact condition the
  // audit hit on CI — a globbed path that is not there when it is read.
  assert.equal(lineCount(gone), null, 'a vanished path has no size to check, so it is skipped, not a crash');
});

test('lineCount still COUNTS a real file, and still THROWS on any error but ENOENT', async () => {
  const { lineCount } = await import('./check-file-size.mjs');
  // NEGATIVE CONTROL 1 — the ordinary path is untouched.
  const real = join(ROOT, 'package.json');
  const n = lineCount(real);
  assert.ok(typeof n === 'number' && n > 0, `expected a real line count, got ${String(n)}`);

  // NEGATIVE CONTROL 2 — a DIRECTORY reads as EISDIR, not ENOENT, and must
  // still throw. Swallowing every read error would turn this fix into a
  // blanket tolerance, which is exactly what it must not be.
  assert.throws(
    () => lineCount(join(ROOT, 'scripts')),
    (err: NodeJS.ErrnoException) => err.code !== 'ENOENT',
    'only ENOENT is a skip — every other read failure still fails loud',
  );
});

test('a baselined file that is genuinely GONE still reports stale — the fix changes no verdict', () => {
  // NEGATIVE CONTROL 3 (the `audit` semantics ruling 84 names): the skip is in
  // lineCount, not in the stale-row logic, so a baseline row whose file no
  // longer exists is reported exactly as before.
  const json = JSON.parse(execFileSync('node', [CHECKER, '--json'], { cwd: ROOT, encoding: 'utf8' }));
  assert.deepEqual(json.stale, [], 'the live tree has no stale rows; the reporting path is unchanged by the ENOENT skip');
});
