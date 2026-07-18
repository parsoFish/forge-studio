/**
 * Tests for the work-item module — parse, validate, serialise, write,
 * cycle/coupling detection. Mirrors the manifest.test.ts shape.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseWorkItem,
  serializeWorkItem,
  validateWorkItem,
  validateWorkItemSet,
  writeWorkItem,
  readWorkItemsFromDir,
  detectHiddenCoupling,
  gateRequiredPaths,
  type WorkItem,
} from './work-item.ts';

function fixture(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    work_item_id: 'WI-1',
    initiative_id: 'INIT-2026-05-08-demo',
    status: 'pending',
    depends_on: [],
    acceptance_criteria: [
      { given: 'a request', when: 'the handler runs', then: 'it returns 200' },
    ],
    files_in_scope: ['src/handler.ts'],
    creates: ['src/handler.ts'],
    estimated_iterations: 2,
    // 2026-05-24 (claude-harness audit): quality_gate_cmd is REQUIRED on
    // every WI. Fixture sets a plausible per-WI gate so existing tests
    // continue to validate the surrounding logic; tests that care about
    // the required-ness override this to undefined.
    quality_gate_cmd: ['node', '--test', 'tests/handler.test.ts'],
    body: 'Implement the handler.',
    ...overrides,
  };
}

test('serializeWorkItem → parseWorkItem round-trips frontmatter and body', () => {
  const w = fixture();
  const md = serializeWorkItem(w);
  assert.match(md, /^---\n/);
  assert.match(md, /work_item_id: WI-1/);
  assert.ok(!/feature_id:/.test(md), 'feature_id must not appear in serialized output');
  assert.match(md, /Implement the handler/);

  const parsed = parseWorkItem(md);
  assert.equal(parsed.work_item_id, 'WI-1');
  assert.equal(parsed.initiative_id, 'INIT-2026-05-08-demo');
  assert.equal(parsed.status, 'pending');
  assert.equal(parsed.acceptance_criteria.length, 1);
  assert.equal(parsed.acceptance_criteria[0]!.given, 'a request');
  assert.deepEqual(parsed.files_in_scope, ['src/handler.ts']);
  assert.equal(parsed.estimated_iterations, 2);
});

test('validateWorkItem: passes a clean work item', () => {
  assert.deepEqual(validateWorkItem(fixture()), []);
});

test('validateWorkItem: rejects malformed work_item_id', () => {
  const errors = validateWorkItem(fixture({ work_item_id: 'WIE-1' }));
  assert.ok(errors.some((e) => e.includes('work_item_id') && e.includes('WI-')), `got ${JSON.stringify(errors)}`);
});

test('validateWorkItem: rejects malformed initiative_id', () => {
  const errors = validateWorkItem(fixture({ initiative_id: 'INIT-x' }));
  assert.ok(errors.some((e) => e.includes('initiative_id')));
});

test('validateWorkItem: rejects empty acceptance_criteria', () => {
  const errors = validateWorkItem(fixture({ acceptance_criteria: [] }));
  assert.ok(errors.some((e) => e.includes('acceptance_criteria')));
});

test('validateWorkItem: rejects empty given/when/then in acceptance_criteria', () => {
  const errors = validateWorkItem(fixture({
    acceptance_criteria: [{ given: 'x', when: '', then: 'y' }],
  }));
  assert.ok(errors.some((e) => e.includes('when')));
});

test('validateWorkItem: rejects empty files_in_scope', () => {
  const errors = validateWorkItem(fixture({ files_in_scope: [] }));
  assert.ok(errors.some((e) => e.includes('files_in_scope')));
});

test('validateWorkItem: rejects absolute path in files_in_scope', () => {
  const errors = validateWorkItem(fixture({ files_in_scope: ['/etc/passwd'] }));
  assert.ok(errors.some((e) => e.includes('worktree-relative')));
});

test('validateWorkItem: rejects parent-traversal in files_in_scope', () => {
  const errors = validateWorkItem(fixture({ files_in_scope: ['../escape.ts'] }));
  assert.ok(errors.some((e) => e.includes("'..'")));
});

test('validateWorkItem: rejects estimated_iterations <= 0', () => {
  assert.ok(validateWorkItem(fixture({ estimated_iterations: 0 })).some((e) => e.includes('estimated_iterations')));
  assert.ok(validateWorkItem(fixture({ estimated_iterations: -1 })).some((e) => e.includes('estimated_iterations')));
});

test('validateWorkItem: rejects self-dependency', () => {
  const errors = validateWorkItem(fixture({ depends_on: ['WI-1'] }));
  assert.ok(errors.some((e) => e.includes('self')));
});

test('validateWorkItem: rejects depends_on referring to unknown WI when set provided', () => {
  const errors = validateWorkItem(fixture({ depends_on: ['WI-99'] }), {
    knownWorkItemIds: new Set(['WI-1', 'WI-2']),
  });
  assert.ok(errors.some((e) => e.includes('WI-99')));
});

test('validateWorkItemSet: rejects duplicate work_item_ids', () => {
  const a = fixture({ work_item_id: 'WI-1' });
  const b = fixture({ work_item_id: 'WI-1', files_in_scope: ['src/other.ts'] });
  const { setErrors } = validateWorkItemSet([a, b]);
  assert.ok(setErrors.some((e) => e.includes('duplicate')));
});

test('validateWorkItemSet: rejects dependency cycles', () => {
  const a = fixture({ work_item_id: 'WI-1', depends_on: ['WI-2'], files_in_scope: ['a.ts'] });
  const b = fixture({ work_item_id: 'WI-2', depends_on: ['WI-1'], files_in_scope: ['b.ts'] });
  const { setErrors } = validateWorkItemSet([a, b]);
  assert.ok(setErrors.some((e) => e.toLowerCase().includes('cycle')));
});

test('detectHiddenCoupling: flags pairs touching a shared file with no edge', () => {
  const a = fixture({ work_item_id: 'WI-1', files_in_scope: ['src/shared.ts'] });
  const b = fixture({ work_item_id: 'WI-2', files_in_scope: ['src/shared.ts'], depends_on: [] });
  const pairs = detectHiddenCoupling([a, b]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0]!.a, 'WI-1');
  assert.equal(pairs[0]!.b, 'WI-2');
  assert.deepEqual(pairs[0]!.sharedFiles, ['src/shared.ts']);
});

test('detectHiddenCoupling: does not flag pairs already linked transitively', () => {
  const a = fixture({ work_item_id: 'WI-1', files_in_scope: ['src/shared.ts'] });
  const b = fixture({ work_item_id: 'WI-2', files_in_scope: ['src/other.ts'], depends_on: ['WI-1'] });
  const c = fixture({ work_item_id: 'WI-3', files_in_scope: ['src/shared.ts'], depends_on: ['WI-2'] });
  const pairs = detectHiddenCoupling([a, b, c]);
  assert.equal(pairs.length, 0, `unexpected pairs: ${JSON.stringify(pairs)}`);
});

test('detectHiddenCoupling: does not flag direct dependency edge', () => {
  const a = fixture({ work_item_id: 'WI-1', files_in_scope: ['src/shared.ts'] });
  const b = fixture({ work_item_id: 'WI-2', files_in_scope: ['src/shared.ts'], depends_on: ['WI-1'] });
  assert.deepEqual(detectHiddenCoupling([a, b]), []);
});

test('detectHiddenCoupling: collapses multiple shared files into one pair', () => {
  const a = fixture({ work_item_id: 'WI-1', files_in_scope: ['src/a.ts', 'src/b.ts'] });
  const b = fixture({ work_item_id: 'WI-2', files_in_scope: ['src/a.ts', 'src/b.ts'] });
  const pairs = detectHiddenCoupling([a, b]);
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0]!.sharedFiles.sort(), ['src/a.ts', 'src/b.ts']);
});

test('writeWorkItem: writes a parseable file under .forge/work-items/', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-wi-'));
  try {
    const out = writeWorkItem(fixture(), dir);
    assert.ok(existsSync(out), `expected file at ${out}`);
    assert.ok(out.includes(join('.forge', 'work-items', 'WI-1.md')), `got ${out}`);
    const parsed = parseWorkItem(readFileSync(out, 'utf8'));
    assert.equal(parsed.work_item_id, 'WI-1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeWorkItem: refuses to write an invalid work item', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-wi-'));
  try {
    const bad = fixture({ work_item_id: 'not-an-id' });
    assert.throws(() => writeWorkItem(bad, dir), /work_item_id/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readWorkItemsFromDir: returns empty when dir missing', () => {
  const result = readWorkItemsFromDir('/nonexistent/path/should/not/exist');
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.parseErrors, {});
});

test('readWorkItemsFromDir: parses all .md files except _graph.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-wi-'));
  try {
    writeWorkItem(fixture({ work_item_id: 'WI-1' }), dir);
    writeWorkItem(fixture({ work_item_id: 'WI-2', files_in_scope: ['src/other.ts'], creates: ['src/other.ts'] }), dir);
    writeFileSync(join(dir, '.forge', 'work-items', '_graph.md'), '# graph');

    const { items, parseErrors } = readWorkItemsFromDir(join(dir, '.forge', 'work-items'));
    assert.equal(items.length, 2);
    assert.deepEqual(parseErrors, {});
    assert.deepEqual(items.map((i) => i.work_item_id).sort(), ['WI-1', 'WI-2']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseWorkItem: throws on missing required field', () => {
  const md = `---\ninitiative_id: INIT-2026-05-08-demo\n---\n\nbody`;
  assert.throws(() => parseWorkItem(md), /work_item_id/);
});

// ----- S3 refinement (2026-05-20): new optional WI fields per C5 -----
// quality_gate_cmd, non_goals, verification_artifact, creates.
// All omit-on-undefined; round-trip preservation is load-bearing.

test('round-trip: a minimal WI (only required fields) serialises byte-identically', () => {
  // Minimal-required shape — docs-only files_in_scope + an explicit
  // quality_gate_cmd (which is now mandatory). This keeps the test's
  // original intent: round-tripping is byte-stable for the smallest
  // legal WI; the OPTIONAL fields (non_goals, verification_artifact,
  // creates) don't leak when unset.
  const w = fixture({
    files_in_scope: ['README.md'],
    creates: undefined,
    quality_gate_cmd: ['node', '--test', 'tests/x.test.ts'],
  });
  const md1 = serializeWorkItem(w);
  const reparsed = parseWorkItem(md1);
  const md2 = serializeWorkItem(reparsed);
  assert.equal(md1, md2, 'round-trip must be byte-identical');
  // The removed feature layer must not appear in serialized output.
  assert.ok(!md1.includes('feature_id:'), 'feature_id must not appear (feature layer removed)');
  // The optional fields that remain unset must not leak into the frontmatter.
  assert.ok(!md1.includes('non_goals'), 'non_goals must not appear when undefined');
  assert.ok(!md1.includes('verification_artifact'), 'verification_artifact must not appear when undefined');
  assert.ok(!md1.includes('\ncreates:'), 'creates must not appear when undefined');
});

test('behavior_preserving: round-trips when true, omitted when unset', () => {
  // Unset → must not leak into frontmatter (byte-stability for the common case).
  const plain = serializeWorkItem(fixture());
  assert.ok(!plain.includes('behavior_preserving'), 'behavior_preserving must not appear when unset');
  // true → round-trips.
  const w = fixture({ behavior_preserving: true });
  const md = serializeWorkItem(w);
  assert.match(md, /behavior_preserving: true/);
  assert.equal(parseWorkItem(md).behavior_preserving, true);
  // A non-true value (false/absent) parses to undefined (omit-on-default).
  assert.equal(parseWorkItem(serializeWorkItem(fixture())).behavior_preserving, undefined);
});

test('quality_gate_cmd: round-trips a valid non-empty array', () => {
  const w = fixture({ quality_gate_cmd: ['npm', 'test', '--', 'tests/x.test.ts'] });
  const md = serializeWorkItem(w);
  assert.match(md, /quality_gate_cmd:/);
  const parsed = parseWorkItem(md);
  assert.deepEqual(parsed.quality_gate_cmd, ['npm', 'test', '--', 'tests/x.test.ts']);
  assert.deepEqual(validateWorkItem(parsed), []);
});

test('quality_gate_cmd: empty array is rejected by validateWorkItem', () => {
  const errors = validateWorkItem(fixture({ quality_gate_cmd: [] }));
  assert.ok(errors.some((e) => e.includes('quality_gate_cmd')), `got ${JSON.stringify(errors)}`);
});

// 2026-06-04 (release_folder re-run): the gate must be the test runner's own
// exit code, never a `| grep`/`awk`/`sed` pipeline that re-derives pass/fail
// from stdout — the pipe masks the exit code and a `grep '--- PASS'` pattern
// starts with `-` so it errors regardless of the tests. Fail-fast at PM.
test('quality_gate_cmd: a `bash -c "… | grep" pipeline gate is rejected', () => {
  const errors = validateWorkItem(fixture({
    quality_gate_cmd: ['bash', '-c', "go test -tags all -run TestReleaseFolder ./pkg/ 2>&1 | grep -q '--- PASS:.*TestReleaseFolder'"],
  }));
  assert.ok(
    errors.some((e) => e.includes('ONE runnable command')),
    `expected a pipeline-gate rejection, got ${JSON.stringify(errors)}`,
  );
});

// re-review #4: structural, not a 5-tool denylist — pipes to rg/jq/etc and
// command chains (&& / ;) all mask the runner's exit code and must be rejected.
test('quality_gate_cmd: shell pipes to non-denylist tools (jq/rg) are still rejected', () => {
  for (const script of [
    'go test ./pkg/ | jq .',
    'pytest -q | rg PASSED',
    'go test ./pkg/ | wc -l',
  ]) {
    const errors = validateWorkItem(fixture({ quality_gate_cmd: ['bash', '-c', script] }));
    assert.ok(errors.some((e) => e.includes('ONE runnable command')), `expected rejection for: ${script} — got ${JSON.stringify(errors)}`);
  }
});

test('quality_gate_cmd: shell command chains (&& / ;) are rejected', () => {
  for (const script of ['go vet ./... && go test ./pkg/', 'cd pkg ; go test']) {
    const errors = validateWorkItem(fixture({ quality_gate_cmd: ['bash', '-c', script] }));
    assert.ok(errors.some((e) => e.includes('ONE runnable command')), `expected rejection for: ${script} — got ${JSON.stringify(errors)}`);
  }
});

test('quality_gate_cmd: a direct `go test -run` gate (the recipe) passes', () => {
  const errors = validateWorkItem(fixture({
    quality_gate_cmd: ['go', 'test', '-tags', 'all', '-count=1', '-run', 'TestReleaseFolder', './azuredevops/internal/service/release/'],
  }));
  assert.deepEqual(errors, [], `the canonical recipe gate must validate cleanly, got ${JSON.stringify(errors)}`);
});

test('quality_gate_cmd: a plain argv with a `-run A|B` regex (no shell) is NOT a pipeline', () => {
  // The `|` is a -run regex alternation in a literal argv — not a shell pipe.
  const errors = validateWorkItem(fixture({
    quality_gate_cmd: ['go', 'test', '-run', 'TestFoo|TestBar', './pkg/'],
  }));
  assert.deepEqual(errors, [], `a -run regex argv must validate cleanly, got ${JSON.stringify(errors)}`);
});

test('non_goals: round-trips an array of strings', () => {
  const w = fixture({ non_goals: ['docs', 'the bar component'] });
  const md = serializeWorkItem(w);
  assert.match(md, /non_goals:/);
  const parsed = parseWorkItem(md);
  assert.deepEqual(parsed.non_goals, ['docs', 'the bar component']);
  assert.deepEqual(validateWorkItem(parsed), []);
});

test('non_goals: empty-string entries are rejected', () => {
  const errors = validateWorkItem(fixture({ non_goals: ['real', ''] }));
  assert.ok(errors.some((e) => e.toLowerCase().includes('non_goals')), `got ${JSON.stringify(errors)}`);
});

test('verification_artifact: path inside files_in_scope round-trips', () => {
  const w = fixture({
    files_in_scope: ['src/handler.ts', 'tests/x.test.ts'],
    verification_artifact: 'tests/x.test.ts',
  });
  const md = serializeWorkItem(w);
  assert.match(md, /verification_artifact:/);
  const parsed = parseWorkItem(md);
  assert.equal(parsed.verification_artifact, 'tests/x.test.ts');
  assert.deepEqual(validateWorkItem(parsed), []);
});

test('verification_artifact: path not in files_in_scope is rejected', () => {
  const errors = validateWorkItem(fixture({
    files_in_scope: ['src/handler.ts'],
    verification_artifact: 'tests/x.test.ts',
  }));
  assert.ok(errors.some((e) => e.includes('verification_artifact')), `got ${JSON.stringify(errors)}`);
});

test('domain (R4-05-F7): round-trips when set, omitted when unset', () => {
  const w = fixture({ domain: 'auth' });
  const md = serializeWorkItem(w);
  assert.match(md, /domain:/);
  const parsed = parseWorkItem(md);
  assert.equal(parsed.domain, 'auth');
  assert.deepEqual(validateWorkItem(parsed), []);

  const plain = serializeWorkItem(fixture({ domain: undefined }));
  assert.ok(!plain.includes('domain:'), 'domain must not appear when undefined');
  assert.equal(parseWorkItem(plain).domain, undefined);
});

test('domain: empty string is rejected by validateWorkItem', () => {
  const errors = validateWorkItem(fixture({ domain: '' }));
  assert.ok(errors.some((e) => e.includes('domain')), `got ${JSON.stringify(errors)}`);
});

test('creates: subset of files_in_scope round-trips', () => {
  const w = fixture({
    files_in_scope: ['src/handler.ts', 'tests/x.test.ts'],
    creates: ['tests/x.test.ts'],
  });
  const md = serializeWorkItem(w);
  assert.match(md, /creates:/);
  const parsed = parseWorkItem(md);
  assert.deepEqual(parsed.creates, ['tests/x.test.ts']);
  assert.deepEqual(validateWorkItem(parsed), []);
});

test('creates: entry not in files_in_scope is rejected', () => {
  const errors = validateWorkItem(fixture({
    files_in_scope: ['src/handler.ts'],
    creates: ['tests/x.test.ts'],
  }));
  assert.ok(errors.some((e) => e.includes('creates')), `got ${JSON.stringify(errors)}`);
});

test('kind (ADR 026): packaging | code-fix round-trips; absent stays omitted', () => {
  // Absent → not serialised (dev WIs stay byte-identical).
  const plain = serializeWorkItem(fixture());
  assert.doesNotMatch(plain, /^kind:/m);
  assert.equal(parseWorkItem(plain).kind, undefined);

  for (const k of ['packaging', 'code-fix'] as const) {
    const md = serializeWorkItem(fixture({ kind: k }));
    assert.match(md, new RegExp(`kind: ${k}`));
    const parsed = parseWorkItem(md);
    assert.equal(parsed.kind, k);
    assert.deepEqual(validateWorkItem(parsed), []);
  }
});

test('kind (ADR 026): an unknown kind is rejected by validateWorkItem', () => {
  const errors = validateWorkItem(fixture({ kind: 'whatever' as unknown as 'packaging' }));
  assert.ok(errors.some((e) => e.includes('kind')), `got ${JSON.stringify(errors)}`);
});

// F1.I5 removed — modify-only WIs are legitimate (e.g. WI-6 extending
// src/trail.ts created by WI-2). The validator no longer second-guesses
// the PM's grammar.
test('validateWorkItem: accepts modify-only code-file WI (no creates required)', () => {
  const errors = validateWorkItem(fixture({
    files_in_scope: ['src/handler.ts'],
    creates: undefined,
    verification_artifact: undefined,
  }));
  assert.deepEqual(errors, []);
});

test('validateWorkItem: accepts pure-docs WI', () => {
  const errors = validateWorkItem(fixture({
    files_in_scope: ['docs/foo.md', 'README.md'],
    creates: undefined,
    verification_artifact: undefined,
  }));
  assert.deepEqual(errors, []);
});


// ----- 2026-07-11: gateRequiredPaths — the gate-tightening path source -----
// Surfaced by INIT-2026-07-10-framework-auth-parity WI-1: the PM omitted
// `creates`, so the gate tightening got `requiredPaths: []` and a vacuous
// `go test -run <NoMatch>` (exit 0, "[no tests to run]") passed at iter-0 →
// gate-too-loose killed the WI. The gate's diff-touch requirement must fall
// back to what the WI DOES declare: creates → verification_artifact →
// files_in_scope.

test('gateRequiredPaths: prefers creates when non-empty', () => {
  const w = fixture({ creates: ['src/a.ts', 'src/a.test.ts'], verification_artifact: 'src/v.ts' });
  assert.deepEqual([...gateRequiredPaths(w)], ['src/a.ts', 'src/a.test.ts']);
});

test('gateRequiredPaths: falls back to verification_artifact when creates absent', () => {
  const w = fixture({ creates: undefined, verification_artifact: 'src/v.ts' });
  assert.deepEqual([...gateRequiredPaths(w)], ['src/v.ts']);
});

test('gateRequiredPaths: falls back to files_in_scope when neither declared', () => {
  const w = fixture({ creates: undefined, verification_artifact: undefined, files_in_scope: ['pkg/auth.go', 'pkg/auth_test.go'] });
  assert.deepEqual([...gateRequiredPaths(w)], ['pkg/auth.go', 'pkg/auth_test.go']);
});
