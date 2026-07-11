import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { WorkItem } from '../work-item.ts';
import {
  GATE_EXTRACTORS,
  MAX_TEST_FILE_BYTES,
  ralphSpecLintWorkItems,
} from './ralph-spec-lint.ts';

function fixture(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    work_item_id: 'WI-1',
    initiative_id: 'INIT-2026-05-08-demo',
    status: 'pending',
    depends_on: [],
    acceptance_criteria: [{ given: 'a request', when: 'the handler runs', then: 'it returns 200' }],
    files_in_scope: ['src/handler.ts'],
    creates: ['src/handler.ts'],
    estimated_iterations: 2,
    quality_gate_cmd: ['node', '--test', 'tests/handler.test.ts'],
    body: 'Implement the handler.',
    ...overrides,
  };
}

function mkTmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeFile(root: string, relPath: string, content: string): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function cleanResult(r: ReturnType<typeof ralphSpecLintWorkItems>): void {
  // Shared invariant for happy-path assertions.
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.flagged, 0);
  assert.equal(r.warned, 0);
  assert.equal(r.configError, null);
}

// ---------- extractor table: detect + extractSelector per runner ----------

function extractor(name: string) {
  const e = GATE_EXTRACTORS.find((x) => x.name === name);
  assert.ok(e, `no extractor named ${name}`);
  return e!;
}

test('extractor table: go-test detects `go test -run <pattern>` and extracts the pattern', () => {
  const e = extractor('go-test');
  const cmd = ['go', 'test', '-tags', 'all', '-run', 'TestResolveFrameworkAuth', './pkg/'];
  assert.equal(e.detect(cmd), true);
  assert.equal(e.extractSelector(cmd), 'TestResolveFrameworkAuth');
  assert.equal(e.matchKind, 'go-run');
});

test('extractor table: go-test accepts --run and --run= forms', () => {
  const e = extractor('go-test');
  assert.equal(e.extractSelector(['go', 'test', '--run', 'TestFoo', './...']), 'TestFoo');
  assert.equal(e.extractSelector(['go', 'test', '--run=TestFoo', './...']), 'TestFoo');
  assert.equal(e.extractSelector(['go', 'test', '-run=TestFoo', './...']), 'TestFoo');
});

test('extractor table: repeated -run — LAST one wins (Go flag semantics)', () => {
  const e = extractor('go-test');
  assert.equal(
    e.extractSelector(['go', 'test', '-run', 'TestOld', '-run', 'TestNew', './...']),
    'TestNew',
  );
  assert.equal(
    e.extractSelector(['go', 'test', '-run=TestOld', '--run', 'TestNewer', './...']),
    'TestNewer',
  );
});

test('extractor table: go-test detect is false for a non-go command', () => {
  const e = extractor('go-test');
  assert.equal(e.detect(['npm', 'test']), false);
});

test('extractor table: vitest detects `-t <name>` and `--testNamePattern=<name>`', () => {
  const e = extractor('vitest');
  assert.equal(e.detect(['npx', 'vitest', 'run', '-t', 'handles auth']), true);
  assert.equal(e.extractSelector(['npx', 'vitest', 'run', '-t', 'handles auth']), 'handles auth');
  assert.equal(
    e.extractSelector(['vitest', 'run', '--testNamePattern=handles auth']),
    'handles auth',
  );
  assert.equal(e.matchKind, 'regex');
});

test('extractor table: node-test detects `node --test --test-name-pattern=<p>`', () => {
  const e = extractor('node-test');
  const cmd = ['node', '--test', '--test-name-pattern=resolves auth', 'test/handler.test.js'];
  assert.equal(e.detect(cmd), true);
  assert.equal(e.extractSelector(cmd), 'resolves auth');
  assert.equal(e.matchKind, 'regex');
});

test('extractor table: npm-test-dash-t detects `npm test -- -t <name>`', () => {
  const e = extractor('npm-test-dash-t');
  const cmd = ['npm', 'test', '--', '-t', 'handles auth'];
  assert.equal(e.detect(cmd), true);
  assert.equal(e.extractSelector(cmd), 'handles auth');
  assert.equal(e.matchKind, 'regex');
});

test('extractor table: jest detects `-t <name>`', () => {
  const e = extractor('jest');
  const cmd = ['npx', 'jest', '-t', 'handles auth'];
  assert.equal(e.detect(cmd), true);
  assert.equal(e.extractSelector(cmd), 'handles auth');
  assert.equal(e.matchKind, 'regex');
});

// ---------- existing-test pass ----------

test('go -run selector matching an EXISTING plain test function passes', () => {
  const root = mkTmp('forge-spec-lint-');
  try {
    writeFile(
      root,
      'pkg/handler_test.go',
      'package pkg\n\nfunc TestResolveFrameworkAuth(t *testing.T) {\n}\n',
    );
    const items = [
      fixture({
        quality_gate_cmd: ['go', 'test', '-run', 'TestResolveFrameworkAuth', './pkg/'],
        creates: ['pkg/handler.go'],
        files_in_scope: ['pkg/handler.go'],
      }),
    ];
    const result = ralphSpecLintWorkItems(items, { projectRoot: root });
    assert.equal(result.checked, 1);
    cleanResult(result);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('go -run selector matching a RECEIVER-METHOD test (testify suite) passes', () => {
  const root = mkTmp('forge-spec-lint-');
  try {
    writeFile(
      root,
      'pkg/suite_test.go',
      'package pkg\n\nfunc (s *AuthSuite) TestResolveFrameworkAuth() {\n}\n',
    );
    const items = [
      fixture({
        quality_gate_cmd: ['go', 'test', '-run', 'TestResolveFrameworkAuth', './pkg/'],
        creates: ['pkg/handler.go'],
        files_in_scope: ['pkg/handler.go'],
      }),
    ];
    cleanResult(ralphSpecLintWorkItems(items, { projectRoot: root }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('go -run subtest path `TestOuter/sub_case` passes when the OUTER test exists', () => {
  const root = mkTmp('forge-spec-lint-');
  try {
    writeFile(
      root,
      'pkg/handler_test.go',
      'package pkg\n\nfunc TestParseScopes(t *testing.T) {\n  t.Run("sub case", func(t *testing.T) {})\n}\n',
    );
    const items = [
      fixture({
        quality_gate_cmd: ['go', 'test', '-run', 'TestParseScopes/sub_case', './pkg/'],
        creates: ['pkg/handler.go'],
        files_in_scope: ['pkg/handler.go'],
      }),
    ];
    cleanResult(ralphSpecLintWorkItems(items, { projectRoot: root }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('go -run subtest path hard-fails when the OUTER test does not exist (and no write-first)', () => {
  const root = mkTmp('forge-spec-lint-');
  try {
    writeFile(root, 'pkg/other_test.go', 'package pkg\n\nfunc TestSomethingElse(t *testing.T) {}\n');
    const items = [
      fixture({
        work_item_id: 'WI-9',
        quality_gate_cmd: ['go', 'test', '-run', 'TestNope/sub_case', './pkg/'],
        creates: ['pkg/handler.go'],
        files_in_scope: ['pkg/handler.go'],
      }),
    ];
    const result = ralphSpecLintWorkItems(items, { projectRoot: root });
    assert.equal(result.flagged, 1);
    assert.equal(result.warned, 0);
    assert.match(result.errors[0]!, /WI-9/);
    assert.match(result.errors[0]!, /TestNope\/sub_case/);
    assert.match(result.errors[0]!, /vacuous pass risk/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('vitest -t regex ALTERNATION matching an existing it() name passes (regex, not substring)', () => {
  const root = mkTmp('forge-spec-lint-');
  try {
    writeFile(root, 'src/handler.test.ts', "it('handles auth requests', () => { expect(1).toBe(1); });\n");
    const items = [
      fixture({
        quality_gate_cmd: ['npx', 'vitest', 'run', '-t', '(handles auth|handles login)'],
        creates: ['src/handler.ts'],
        files_in_scope: ['src/handler.ts'],
      }),
    ];
    cleanResult(ralphSpecLintWorkItems(items, { projectRoot: root }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('jest -t selector matching a describe() title passes (runners match the composed full name)', () => {
  const root = mkTmp('forge-spec-lint-');
  try {
    writeFile(
      root,
      'src/auth.test.ts',
      "describe('framework auth', () => { it('resolves', () => {}); });\n",
    );
    const items = [
      fixture({
        quality_gate_cmd: ['npx', 'jest', '-t', 'framework auth'],
        creates: ['src/auth.ts'],
        files_in_scope: ['src/auth.ts'],
      }),
    ];
    cleanResult(ralphSpecLintWorkItems(items, { projectRoot: root }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- write-first pass (gateRequiredPaths priority chain) ----------

test('selector matches nothing YET, but creates: declares the matching test file — passes (write-first)', () => {
  const root = mkTmp('forge-spec-lint-'); // empty tree — nothing exists yet
  try {
    const items = [
      fixture({
        work_item_id: 'WI-2',
        quality_gate_cmd: ['go', 'test', '-run', 'TestResolveFrameworkAuth', './pkg/'],
        creates: ['pkg/handler.go', 'pkg/handler_test.go'],
        files_in_scope: ['pkg/handler.go', 'pkg/handler_test.go'],
      }),
    ];
    cleanResult(ralphSpecLintWorkItems(items, { projectRoot: root }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('write-first honored via verification_artifact when creates is absent (chain step 2)', () => {
  const root = mkTmp('forge-spec-lint-');
  try {
    const items = [
      fixture({
        work_item_id: 'WI-2',
        quality_gate_cmd: ['npx', 'jest', '-t', 'handles auth'],
        creates: undefined,
        verification_artifact: 'src/handler.test.ts',
        files_in_scope: ['src/handler.test.ts'],
      }),
    ];
    cleanResult(ralphSpecLintWorkItems(items, { projectRoot: root }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('write-first honored via files_in_scope when creates AND verification_artifact are absent (chain step 3)', () => {
  const root = mkTmp('forge-spec-lint-');
  try {
    const items = [
      fixture({
        work_item_id: 'WI-2',
        quality_gate_cmd: ['npx', 'jest', '-t', 'handles auth'],
        creates: undefined,
        verification_artifact: undefined,
        files_in_scope: ['src/handler.test.ts'],
      }),
    ];
    cleanResult(ralphSpecLintWorkItems(items, { projectRoot: root }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('PRIORITY-CHAIN GAP: creates non-empty WITHOUT a test file — a test file merely in files_in_scope does NOT escape (hard fail)', () => {
  // Mirrors gateRequiredPaths exactly: when creates is non-empty, ONLY creates
  // is enforced in the branch diff — a test file listed only in files_in_scope
  // is unenforced, so the gate can still pass vacuously with zero delivery.
  const root = mkTmp('forge-spec-lint-');
  try {
    const items = [
      fixture({
        work_item_id: 'WI-8',
        quality_gate_cmd: ['go', 'test', '-run', 'TestResolveFrameworkAuth', './pkg/'],
        creates: ['pkg/handler.go'], // enforced set — no test file
        files_in_scope: ['pkg/handler.go', 'pkg/handler_test.go'], // test file NOT enforced
      }),
    ];
    const result = ralphSpecLintWorkItems(items, { projectRoot: root });
    assert.equal(result.flagged, 1);
    assert.equal(result.warned, 0);
    assert.match(result.errors[0]!, /WI-8/);
    assert.match(result.errors[0]!, /vacuous pass risk/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- vacuous fail ----------

test('selector matches nothing, no test file in the enforced write set — VACUOUS FAIL naming WI, gate, selector, and fix', () => {
  const root = mkTmp('forge-spec-lint-'); // empty tree
  try {
    const items = [
      fixture({
        work_item_id: 'WI-9',
        quality_gate_cmd: ['go', 'test', '-run', 'TestResolveFrameworkAuth', './pkg/'],
        creates: ['pkg/handler.go'], // NOT a test file
        files_in_scope: ['pkg/handler.go'],
      }),
    ];
    const result = ralphSpecLintWorkItems(items, { projectRoot: root });
    assert.equal(result.checked, 1);
    assert.equal(result.flagged, 1);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0]!, /WI-9/);
    assert.match(result.errors[0]!, /go test -run TestResolveFrameworkAuth/);
    assert.match(result.errors[0]!, /TestResolveFrameworkAuth/);
    assert.match(result.errors[0]!, /vacuous pass risk/);
    assert.match(result.errors[0]!, /ADR 037/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('vitest -t selector with no matching name, no sentinels, no created test file — vacuous fail', () => {
  const root = mkTmp('forge-spec-lint-');
  try {
    writeFile(root, 'src/handler.test.ts', "it('handles something else entirely', () => {});\n");
    const items = [
      fixture({
        work_item_id: 'WI-9',
        quality_gate_cmd: ['npx', 'vitest', 'run', '-t', 'handles auth'],
        creates: ['src/handler.ts'],
        files_in_scope: ['src/handler.ts'],
      }),
    ];
    const result = ralphSpecLintWorkItems(items, { projectRoot: root });
    assert.equal(result.flagged, 1);
    assert.equal(result.warned, 0);
    assert.match(result.errors[0]!, /WI-9/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- dynamic-name sentinels (.each) → warning, not failure ----------

test('test.each TEMPLATE form in the corpus downgrades a non-matching selector to a WARNING', () => {
  const root = mkTmp('forge-spec-lint-');
  try {
    writeFile(
      root,
      'src/math.test.ts',
      'test.each`\n  a | b | expected\n  ${1} | ${1} | ${2}\n`(\'returns $expected for $a + $b\', () => {});\n',
    );
    const items = [
      fixture({
        work_item_id: 'WI-9',
        quality_gate_cmd: ['npx', 'vitest', 'run', '-t', 'returns 4 for 2 \\+ 2'],
        creates: ['src/math.ts'],
        files_in_scope: ['src/math.ts'],
      }),
    ];
    const result = ralphSpecLintWorkItems(items, { projectRoot: root });
    assert.equal(result.flagged, 0);
    assert.equal(result.warned, 1);
    assert.deepEqual(result.errors, []);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0]!, /WI-9/);
    assert.match(result.warnings[0]!, /dynamically-generated names/);
    assert.match(result.warnings[0]!, /\.each/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('it.each ARRAY form also counts as a sentinel (warning, not failure)', () => {
  const root = mkTmp('forge-spec-lint-');
  try {
    writeFile(
      root,
      'src/math.test.ts',
      "it.each([[1, 1, 2], [2, 2, 4]])('adds %i + %i to equal %i', () => {});\n",
    );
    const items = [
      fixture({
        work_item_id: 'WI-9',
        quality_gate_cmd: ['npx', 'jest', '-t', 'adds 2 \\+ 2 to equal 4'],
        creates: ['src/math.ts'],
        files_in_scope: ['src/math.ts'],
      }),
    ];
    const result = ralphSpecLintWorkItems(items, { projectRoot: root });
    assert.equal(result.flagged, 0);
    assert.equal(result.warned, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sentinels do NOT downgrade a selector that DOES match a literal name (still a clean pass)', () => {
  const root = mkTmp('forge-spec-lint-');
  try {
    writeFile(
      root,
      'src/mixed.test.ts',
      "test.each([[1]])('generated %i', () => {});\nit('handles auth requests', () => {});\n",
    );
    const items = [
      fixture({
        quality_gate_cmd: ['npx', 'vitest', 'run', '-t', 'handles auth'],
        creates: ['src/handler.ts'],
        files_in_scope: ['src/handler.ts'],
      }),
    ];
    cleanResult(ralphSpecLintWorkItems(items, { projectRoot: root }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- invalid regex fail ----------

test('go test -run with a syntactically invalid regex is flagged (hard fail)', () => {
  const root = mkTmp('forge-spec-lint-');
  try {
    const items = [
      fixture({
        work_item_id: 'WI-7',
        quality_gate_cmd: ['go', 'test', '-run', 'Test(Foo', './pkg/'],
        creates: ['pkg/handler.go'],
        files_in_scope: ['pkg/handler.go'],
      }),
    ];
    const result = ralphSpecLintWorkItems(items, { projectRoot: root });
    assert.equal(result.flagged, 1);
    assert.match(result.errors[0]!, /WI-7/);
    assert.match(result.errors[0]!, /not a valid regular expression/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('go test -run with an invalid LATER slash-segment is flagged (go compiles every segment)', () => {
  const root = mkTmp('forge-spec-lint-');
  try {
    writeFile(root, 'pkg/handler_test.go', 'package pkg\n\nfunc TestFoo(t *testing.T) {}\n');
    const items = [
      fixture({
        work_item_id: 'WI-7',
        quality_gate_cmd: ['go', 'test', '-run', 'TestFoo/(bad', './pkg/'],
        creates: ['pkg/handler.go'],
        files_in_scope: ['pkg/handler.go'],
      }),
    ];
    const result = ralphSpecLintWorkItems(items, { projectRoot: root });
    assert.equal(result.flagged, 1);
    assert.match(result.errors[0]!, /WI-7/);
    assert.match(result.errors[0]!, /segment "\(bad"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('vitest -t with a syntactically invalid regex is flagged (runners treat -t as a regex; runtime error)', () => {
  const root = mkTmp('forge-spec-lint-');
  try {
    const items = [
      fixture({
        work_item_id: 'WI-7',
        quality_gate_cmd: ['npx', 'vitest', 'run', '-t', 'handles (auth'],
        creates: ['src/handler.ts'],
        files_in_scope: ['src/handler.ts'],
      }),
    ];
    const result = ralphSpecLintWorkItems(items, { projectRoot: root });
    assert.equal(result.flagged, 1);
    assert.match(result.errors[0]!, /WI-7/);
    assert.match(result.errors[0]!, /not a valid regular expression/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- empty gate fail ----------

test('undefined quality_gate_cmd is flagged as empty/whitespace', () => {
  const root = mkTmp('forge-spec-lint-');
  try {
    const items = [fixture({ work_item_id: 'WI-3', quality_gate_cmd: undefined })];
    const result = ralphSpecLintWorkItems(items, { projectRoot: root });
    assert.equal(result.flagged, 1);
    assert.match(result.errors[0]!, /WI-3/);
    assert.match(result.errors[0]!, /empty\/whitespace/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('whitespace-only quality_gate_cmd entries are flagged', () => {
  const root = mkTmp('forge-spec-lint-');
  try {
    const items = [fixture({ work_item_id: 'WI-4', quality_gate_cmd: ['   ', ''] })];
    const result = ralphSpecLintWorkItems(items, { projectRoot: root });
    assert.equal(result.flagged, 1);
    assert.match(result.errors[0]!, /WI-4/);
    assert.match(result.errors[0]!, /empty\/whitespace/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- unknown-runner passthrough ----------

test('an unrecognised runner command passes through silently', () => {
  const root = mkTmp('forge-spec-lint-');
  try {
    const items = [
      fixture({
        work_item_id: 'WI-5',
        quality_gate_cmd: ['pytest', 'test_handler.py::test_resolve_auth'],
        creates: ['handler.py'],
        files_in_scope: ['handler.py'],
      }),
    ];
    const result = ralphSpecLintWorkItems(items, { projectRoot: root });
    assert.equal(result.checked, 1);
    cleanResult(result);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a recognised runner with no selector flag passes through (nothing to prove)', () => {
  const root = mkTmp('forge-spec-lint-');
  try {
    const items = [
      fixture({
        work_item_id: 'WI-6',
        quality_gate_cmd: ['go', 'test', './pkg/...'],
        creates: ['pkg/handler.go'],
        files_in_scope: ['pkg/handler.go'],
      }),
    ];
    cleanResult(ralphSpecLintWorkItems(items, { projectRoot: root }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- walk cap: truncation downgrades to warning ----------

test('walk cap hit: would-be vacuous fail downgrades to WARNING and truncated=true (incomplete search proves nothing)', () => {
  const root = mkTmp('forge-spec-lint-');
  try {
    // Three test files; cap of 1 guarantees the walk stops early.
    writeFile(root, 'a_test.go', 'package p\n\nfunc TestAlpha(t *testing.T) {}\n');
    writeFile(root, 'b_test.go', 'package p\n\nfunc TestBeta(t *testing.T) {}\n');
    writeFile(root, 'c_test.go', 'package p\n\nfunc TestGamma(t *testing.T) {}\n');
    const items = [
      fixture({
        work_item_id: 'WI-9',
        quality_gate_cmd: ['go', 'test', '-run', 'TestNoSuch', './...'],
        creates: ['pkg/handler.go'],
        files_in_scope: ['pkg/handler.go'],
      }),
    ];
    const result = ralphSpecLintWorkItems(items, { projectRoot: root, maxFilesWalked: 1 });
    assert.equal(result.flagged, 0);
    assert.deepEqual(result.errors, []);
    assert.equal(result.warned, 1);
    assert.equal(result.truncated, true);
    assert.match(result.warnings[0]!, /WI-9/);
    assert.match(result.warnings[0]!, /truncated/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('walk cap NOT hit on a complete search: truncated=false and a vacuous selector still hard-fails', () => {
  const root = mkTmp('forge-spec-lint-');
  try {
    writeFile(root, 'a_test.go', 'package p\n\nfunc TestAlpha(t *testing.T) {}\n');
    const items = [
      fixture({
        work_item_id: 'WI-9',
        quality_gate_cmd: ['go', 'test', '-run', 'TestNoSuch', './...'],
        creates: ['pkg/handler.go'],
        files_in_scope: ['pkg/handler.go'],
      }),
    ];
    const result = ralphSpecLintWorkItems(items, { projectRoot: root });
    assert.equal(result.truncated, false);
    assert.equal(result.flagged, 1);
    assert.equal(result.warned, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('truncation does NOT downgrade provable-without-search failures (empty gate, invalid regex)', () => {
  const root = mkTmp('forge-spec-lint-');
  try {
    writeFile(root, 'a_test.go', 'package p\n\nfunc TestAlpha(t *testing.T) {}\n');
    writeFile(root, 'b_test.go', 'package p\n\nfunc TestBeta(t *testing.T) {}\n');
    const items = [
      fixture({ work_item_id: 'WI-3', quality_gate_cmd: undefined }),
      fixture({
        work_item_id: 'WI-7',
        quality_gate_cmd: ['go', 'test', '-run', 'Test(Bad', './...'],
        creates: ['pkg/handler.go'],
        files_in_scope: ['pkg/handler.go'],
      }),
    ];
    const result = ralphSpecLintWorkItems(items, { projectRoot: root, maxFilesWalked: 1 });
    assert.equal(result.flagged, 2);
    assert.equal(result.errors.length, 2);
    assert.match(result.errors[0]!, /WI-3.*empty\/whitespace/);
    assert.match(result.errors[1]!, /WI-7.*not a valid regular expression/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- per-file read cap ----------

test('a test file larger than MAX_TEST_FILE_BYTES is skipped and counted in skippedFiles', () => {
  const root = mkTmp('forge-spec-lint-');
  try {
    // Oversized file contains the only match; it is skipped (counted), so the
    // selector reads vacuous — documents the counted-not-downgraded behavior.
    writeFile(
      root,
      'pkg/huge_test.go',
      `package pkg\n\nfunc TestResolveFrameworkAuth(t *testing.T) {}\n// ${'x'.repeat(MAX_TEST_FILE_BYTES)}\n`,
    );
    const items = [
      fixture({
        work_item_id: 'WI-9',
        quality_gate_cmd: ['go', 'test', '-run', 'TestResolveFrameworkAuth', './pkg/'],
        creates: ['pkg/handler.go'],
        files_in_scope: ['pkg/handler.go'],
      }),
    ];
    const result = ralphSpecLintWorkItems(items, { projectRoot: root });
    assert.equal(result.skippedFiles, 1);
    assert.equal(result.flagged, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- config error: bad projectRoot ----------

test('nonexistent projectRoot → configError set, NO WI verdicts produced', () => {
  const items = [
    fixture({
      work_item_id: 'WI-9',
      quality_gate_cmd: ['go', 'test', '-run', 'TestNoSuch', './...'],
    }),
  ];
  const result = ralphSpecLintWorkItems(items, { projectRoot: '/no/such/dir/anywhere-forge-lint' });
  assert.ok(result.configError);
  assert.match(result.configError!, /does not exist or is not a directory/);
  assert.match(result.configError!, /no\/such\/dir/);
  assert.equal(result.checked, 0);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('projectRoot pointing at a FILE (not a directory) → configError', () => {
  const parent = mkTmp('forge-spec-lint-');
  try {
    const filePath = join(parent, 'a-file');
    writeFileSync(filePath, 'not a dir');
    const result = ralphSpecLintWorkItems([fixture()], { projectRoot: filePath });
    assert.ok(result.configError);
    assert.equal(result.checked, 0);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

// ---------- batch behavior ----------

test('checked counts every WI regardless of verdict; flagged/warned count independently', () => {
  const root = mkTmp('forge-spec-lint-');
  try {
    writeFile(root, 'pkg/ok_test.go', 'package pkg\n\nfunc TestOk(t *testing.T) {}\n');
    writeFile(root, 'src/dyn.test.ts', "test.each([[1]])('gen %i', () => {});\n");
    const items = [
      fixture({ work_item_id: 'WI-A', quality_gate_cmd: ['go', 'test', '-run', 'TestOk', './pkg/'] }),
      fixture({
        work_item_id: 'WI-B',
        quality_gate_cmd: ['go', 'test', '-run', 'TestNoWhereToBeFound', './pkg/'],
        creates: ['pkg/other.go'],
        files_in_scope: ['pkg/other.go'],
      }),
      fixture({ work_item_id: 'WI-C', quality_gate_cmd: ['pytest', 'x'] }),
      fixture({
        work_item_id: 'WI-D',
        quality_gate_cmd: ['npx', 'vitest', 'run', '-t', 'gen 7'],
        creates: ['src/dyn.ts'],
        files_in_scope: ['src/dyn.ts'],
      }),
    ];
    const result = ralphSpecLintWorkItems(items, { projectRoot: root });
    assert.equal(result.checked, 4);
    assert.equal(result.flagged, 1);
    assert.equal(result.warned, 1);
    assert.match(result.errors[0]!, /WI-B/);
    assert.match(result.warnings[0]!, /WI-D/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
