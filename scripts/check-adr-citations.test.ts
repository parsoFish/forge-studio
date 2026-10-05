import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
// @ts-ignore -- .mjs has no types
import { CITATION_RE, EXCLUDED } from './check-adr-citations.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-adr-citations.mjs');
const BASELINE = 'scripts/check-adr-citations.baseline.json';

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'adr-cit-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  put(dir, files);
  return dir;
}
function put(dir: string, files: Record<string, string>, add = true): void {
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  if (add) execFileSync('git', ['add', '--', ...Object.keys(files)], { cwd: dir });
}
function run(dir: string, ...args: string[]) {
  const r = spawnSync('node', ['--experimental-strip-types', SCRIPT, '--root', dir, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
function baseline(dir: string, files: Record<string, number>): void {
  const total = Object.values(files).reduce((a, b) => a + b, 0);
  put(dir, { [BASELINE]: `${JSON.stringify({ files, total }, null, 2)}\n` }, false);
}
const cleanup = (d: string) => rmSync(d, { recursive: true, force: true });
const matches = (s: string) => new RegExp(CITATION_RE.source, 'g').test(s);

test('pattern matches the five forms', () => {
  for (const s of ['ADR 028', 'ADR-046', 'ADRs 011–013', 'ADR 028 §3', 'see docs/decisions/028-x.md']) {
    assert.ok(matches(s), s);
  }
});

test('pattern is case-sensitive and word-bounded', () => {
  for (const s of ['loadReader', 'ADRIFT', 'ADR', 'adr 028', 'ADR 1234']) {
    assert.ok(!matches(s), s);
  }
});

test('excluded paths are ignored; live brain themes are not', () => {
  const d = repo({
    'tests/stories/a.md': 'ADR 001',
    'demos/x.md': 'ADR 001',
    'brain/forge-dev/t.md': 'ADR 001',
    'brain/cycles/_raw/t.md': 'ADR 001',
    'brain/_raw/t.md': 'ADR 001',
    'brain/packs/t.md': 'ADR 001',
    'src/ok.ts': 'nothing',
  });
  baseline(d, {});
  assert.equal(run(d).code, 0);
  put(d, { 'brain/cycles/themes/t.md': 'ADR 001' });
  const r = run(d);
  assert.equal(r.code, 1);
  assert.match(r.out, /NEW — brain\/cycles\/themes\/t\.md cites a decision record \(1\)/);
  cleanup(d);
});

test('every exclusion names a path, an owner and a reason', () => {
  for (const e of EXCLUDED) assert.ok(e.path && e.owner && e.reason, JSON.stringify(e));
});

test('CHANGELOG counts only the 1.0.0 Unreleased section', () => {
  const cl = '# Changelog\n\nADR 001 preamble\n## [1.0.0] - Unreleased\n- a (ADR 002)\n- b ADR 003\n## [0.9.0] - 2026-08-28\n- ADR 004\n- ADR 005\n';
  const d = repo({ 'CHANGELOG.md': cl });
  // Kills: counting the whole file (would be 5) or excluding CHANGELOG wholesale (0).
  const r = run(d);
  assert.equal(r.code, 1);
  assert.match(r.out, /NEW — CHANGELOG\.md cites a decision record \(2\)/);
  cleanup(d);
});

test('new citing file -> NEW, exit 1', () => {
  // Kills: an implementation that ignores files absent from the baseline.
  const d = repo({ 'a.md': 'clean' });
  baseline(d, {});
  put(d, { 'b.md': 'ADR 002' });
  const r = run(d);
  assert.equal(r.code, 1);
  assert.match(r.out, /NEW — b\.md/);
  cleanup(d);
});

test('grown file -> GREW, exit 1', () => {
  // Kills: an implementation that allows any baselined file regardless of count.
  const d = repo({ 'a.md': 'ADR 001 ADR 002' });
  baseline(d, { 'a.md': 1 });
  const r = run(d);
  assert.equal(r.code, 1);
  assert.match(r.out, /GREW — a\.md 1 → 2/);
  cleanup(d);
});

test('shrunk file -> STALE, exit 1 (mirrors check-stale-path-citations: an unrecorded shrink fails)', () => {
  // Kills: an implementation that passes a shrink, letting the ratchet climb back later.
  const d = repo({ 'a.md': 'ADR 001' });
  baseline(d, { 'a.md': 3 });
  const r = run(d);
  assert.equal(r.code, 1);
  assert.match(r.out, /STALE — run node scripts\/check-adr-citations\.mjs --write \(baseline 3 → 1\)/);
  cleanup(d);
});

test('--write on shrink rewrites the baseline', () => {
  const d = repo({ 'a.md': 'ADR 001', 'b.md': 'x' });
  baseline(d, { 'a.md': 3, 'b.md': 1 });
  assert.equal(run(d, '--write').code, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(d, BASELINE), 'utf8')), { files: { 'a.md': 1 }, total: 1 });
  assert.equal(run(d).code, 0);
  cleanup(d);
});

test('--write refuses growth and leaves the baseline byte-identical', () => {
  // Kills: a --write that snapshots current counts (laundering new debt into the baseline).
  const d = repo({ 'a.md': 'ADR 001 ADR 002', 'n.md': 'ADR 003' });
  baseline(d, { 'a.md': 1 });
  const before = readFileSync(join(d, BASELINE), 'utf8');
  const r = run(d, '--write');
  assert.equal(r.code, 1);
  assert.equal(readFileSync(join(d, BASELINE), 'utf8'), before);
  cleanup(d);
});

test('--write with no baseline creates it (first write only)', () => {
  const d = repo({ 'a.md': 'ADR 001' });
  assert.equal(run(d, '--write').code, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(d, BASELINE), 'utf8')), { files: { 'a.md': 1 }, total: 1 });
  cleanup(d);
});

test('untracked files are ignored', () => {
  // Kills: a filesystem walk instead of git ls-files.
  const d = repo({ 'a.md': 'clean' });
  baseline(d, {});
  put(d, { 'u.md': 'ADR 001' }, false);
  assert.equal(run(d).code, 0);
  cleanup(d);
});

test('binary files are skipped', () => {
  const d = repo({ 'a.md': 'clean' });
  baseline(d, {});
  put(d, { 'b.bin': 'ADR 001\0binary' });
  assert.equal(run(d).code, 0);
  cleanup(d);
});

test('zero state prints the zero PASS line', () => {
  const d = repo({ 'a.md': 'clean' });
  baseline(d, {});
  const r = run(d);
  assert.equal(r.code, 0);
  assert.match(r.out, /check-adr-citations: PASS — 0 citations/);
  cleanup(d);
});

test('usage error exits 2; --list-exclusions prints paths', () => {
  const d = repo({ 'a.md': 'clean' });
  assert.equal(run(d, '--bogus').code, 2);
  const r = run(d, '--list-exclusions');
  assert.equal(r.code, 0);
  assert.match(r.out, /tests\/stories\//);
  cleanup(d);
});
