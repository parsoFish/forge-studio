/**
 * check-test-discovery — the guard that closes bead forge-8vfn.7.1.
 *
 * THE INCIDENT (M2-A, 2026-08-31, `_1.0/ledger.md` "2026-08-31 M2-A COMPLETE"):
 * the `git mv forge-ui -> apps/studio` mid-state collapsed `test:ui` from 2741
 * to 2403 while several test files silently collected ZERO tests, and the suite
 * still exited `passed`. Only a hand-held total-count comparison caught it.
 *
 * These tests pin the two halves of that fail-open, each measured on this repo
 * at 38d96f3d before the guard was written:
 *   - `node --test --experimental-strip-types <file with no test()>` exits 0
 *     and reports `# pass 1` (the FILE counts as the passing test).
 *   - a `*.test.*` file that no runner glob claims runs NOWHERE and nothing
 *     says so — four such files existed at 38d96f3d.
 * `vitest run` 4.1.8 already reds a COLLECTED zero-test file
 * ("No test suite found in file", exit 1), so the zero-test half of this guard
 * covers the node runner only; the discovery half covers both.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  globToRegExp,
  declaresATest,
  parseNodeGlobs,
  parseVitestIncludes,
  runCheck,
} from './check-test-discovery.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** A repo with one test file per runner, nothing wrong. */
function healthy() {
  return {
    files: ['packages/a/tests/unit/x.test.ts', 'apps/studio/lib/y.test.ts'],
    nodeGlobs: ['packages/*/*/*/*.test.ts'],
    vitestGlobs: ['lib/**/*.test.ts'],
    vitestRoot: 'apps/studio',
    exceptions: [],
    read: () => 'test("t", () => {});',
  };
}

test('globToRegExp: * stops at a path separator, ** crosses it', () => {
  assert.ok(globToRegExp('packages/*/x.test.ts').test('packages/a/x.test.ts'));
  assert.ok(!globToRegExp('packages/*/x.test.ts').test('packages/a/b/x.test.ts'));
  assert.ok(globToRegExp('lib/**/*.test.ts').test('lib/a/b/x.test.ts'));
  assert.ok(globToRegExp('lib/**/*.test.ts').test('lib/x.test.ts'));
});

test('globToRegExp: {a,b} alternates, and a dot is literal', () => {
  const re = globToRegExp('lib/**/*.test.{ts,tsx}');
  assert.ok(re.test('lib/x.test.tsx'));
  assert.ok(re.test('lib/x.test.ts'));
  assert.ok(!re.test('lib/x-test-ts'));
});

test('declaresATest: a file with no test() declares nothing', () => {
  assert.equal(declaresATest('export const nothing = 1;\n'), false);
  assert.equal(declaresATest('test("a", () => {});'), true);
  assert.equal(declaresATest('it("a", () => {});'), true);
  assert.equal(declaresATest('describe("a", () => {});'), true);
  // A mention inside a comment or a string is not a declaration.
  assert.equal(declaresATest('// test("a", () => {}) used to live here\n'), false);
});

test('a healthy tree passes with nothing to report', () => {
  const r = runCheck(healthy());
  assert.deepEqual(r.findings, []);
  assert.equal(r.checked, 2);
});

test('POSITIVE CONTROL — a test file no runner glob claims is named', () => {
  const input = healthy();
  input.files = [...input.files, 'packages/a/tests/unit/deep/moved.test.ts'];
  const r = runCheck(input);
  assert.deepEqual(
    r.findings.map((f) => [f.kind, f.path]),
    [['unclaimed', 'packages/a/tests/unit/deep/moved.test.ts']],
  );
});

test('POSITIVE CONTROL — a planted .test.tsx no glob claims is named (the M2-A shape)', () => {
  const input = healthy();
  input.files = [...input.files, 'apps/studio/lib/planted.test.tsx'];
  const r = runCheck(input);
  assert.deepEqual(
    r.findings.map((f) => [f.kind, f.path]),
    [['unclaimed', 'apps/studio/lib/planted.test.tsx']],
  );
});

test('POSITIVE CONTROL — a node-claimed file that declares no test is named', () => {
  const input = healthy();
  input.read = (p) => (p.endsWith('x.test.ts') ? 'export const nothing = 1;\n' : 'test("t", () => {});');
  const r = runCheck(input);
  assert.deepEqual(
    r.findings.map((f) => [f.kind, f.path]),
    [['zero-tests', 'packages/a/tests/unit/x.test.ts']],
  );
});

test('a vitest-claimed zero-test file is NOT reported — vitest reds it itself', () => {
  const input = healthy();
  input.read = (p) => (p.endsWith('y.test.ts') ? 'export const nothing = 1;\n' : 'test("t", () => {});');
  assert.deepEqual(runCheck(input).findings, []);
});

test('POSITIVE CONTROL — a discovery glob that matches nothing is named', () => {
  const input = healthy();
  input.nodeGlobs = [...input.nodeGlobs, 'cli/*.test.ts'];
  const r = runCheck(input);
  assert.deepEqual(
    r.findings.map((f) => [f.kind, f.glob]),
    [['dead-glob', 'cli/*.test.ts']],
  );
});

test('POSITIVE CONTROL — a file claimed by BOTH runners is named (it would run twice)', () => {
  const input = healthy();
  input.nodeGlobs = [...input.nodeGlobs, 'apps/*/*/*.test.ts'];
  const r = runCheck(input);
  assert.deepEqual(
    r.findings.map((f) => [f.kind, f.path]),
    [['double-claimed', 'apps/studio/lib/y.test.ts']],
  );
});

test('an exception silences an unclaimed file only with a reason, and only for its own paths', () => {
  const input = healthy();
  input.files = [...input.files, 'projects/mdtoc/test/unit.test.ts'];
  input.exceptions = [{ glob: 'projects/*/**', reason: 'a managed project ground' }];
  assert.deepEqual(runCheck(input).findings, []);
  input.exceptions = [{ glob: 'studio/starters/**', reason: 'starter template content' }];
  assert.equal(runCheck(input).findings[0].kind, 'unclaimed');
});

test('an exception glob that matches no file is itself a dead glob', () => {
  const input = healthy();
  input.exceptions = [{ glob: 'gone/**', reason: 'retired' }];
  const r = runCheck(input);
  assert.deepEqual(r.findings.map((f) => [f.kind, f.glob]), [['dead-glob', 'gone/**']]);
});

test('parseNodeGlobs takes the paths out of the npm test script, dropping the flags', () => {
  assert.deepEqual(
    parseNodeGlobs('node --test --experimental-strip-types a/*.test.ts b/*/*.test.ts'),
    ['a/*.test.ts', 'b/*/*.test.ts'],
  );
});

test('parseVitestIncludes reads the include array out of the vitest config', () => {
  assert.deepEqual(
    parseVitestIncludes("export default defineConfig({\n test: {\n  environment: 'node',\n  include: ['lib/**/*.test.ts', 'components/**/*.test.ts'],\n },\n});"),
    ['lib/**/*.test.ts', 'components/**/*.test.ts'],
  );
});

test('parseVitestIncludes refuses a config with no include rather than reporting zero', () => {
  assert.throws(() => parseVitestIncludes('export default defineConfig({ test: {} });'), /include/);
});

test('THE REPO ITSELF passes the guard', () => {
  const out = execFileSync('node', [resolve(ROOT, 'scripts/check-test-discovery.mjs'), '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const r = JSON.parse(out);
  assert.deepEqual(r.findings, [], `findings: ${JSON.stringify(r.findings, null, 2)}`);
  assert.ok(r.checked > 700, `only ${r.checked} test files checked — the census collapsed`);
});
