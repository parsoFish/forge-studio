/**
 * check-raw-fs-guarded.test.ts — TDD contract for the SEC-04 def-use lint
 * (scripts/check-raw-fs-guarded.mjs).
 *
 * Discipline (immutable-gates): every green here names the WRONG implementation
 * it kills; the request-derived RED case and its guarded GREEN twin ARE the
 * swap-the-fix proof (A1 red, A2 green — identical but for the guard); and the
 * real-repo gate asserts it is clean FOR THE RIGHT REASON (findings exist and
 * are suppressed by reasoned allowlist rows), never because the scanner is dead.
 *
 * Group A — the def-use mechanism, unit-tested on synthetic module TEXT so it is
 * independent of what forge's own code currently looks like.
 * Group B — runLint + the allowlist contract (suppress / reason-required /
 * mistargeted / stale).
 * Group D — a synthetic NEW unguarded request sink in a REAL handling module
 * name TRIPS the lint through the real pipeline (charter's deliberate RED).
 * Group C — the CI-enforced gate: the REAL repo passes clean, proven live.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeModule,
  applyAllowlist,
  runLint,
  targetModules,
  ALLOWLIST,
  RAW_FS_SINKS,
  REQUEST_TAINT_BARE,
} from './check-raw-fs-guarded.mjs';
// Namespace import so probing a not-yet-built export yields `undefined` rather
// than an ESM link-time crash that takes the whole file down.
import * as lint from './check-raw-fs-guarded.mjs';

const fn = (...lines: string[]) => lines.join('\n');

// =============================================================================
// Group A — the def-use mechanism (analyzeModule on synthetic text)
// =============================================================================

test('A1 (RED): a request-derived path (body.project) reaching a raw writeFileSync is a finding', () => {
  // Kills: a lint that ignores request taint / only ratchets call counts.
  const text = fn(
    'export function handleSave(body) {',
    '  const data = String(body.contents);',
    "  writeFileSync(join(projectsRoot, body.project, 'x.json'), data);",
    '}',
  );
  const findings = analyzeModule(text, 'cli/ui-bridge.ts');
  assert.equal(findings.length, 1, 'exactly one finding');
  assert.equal(findings[0].sink, 'writeFileSync');
  assert.equal(findings[0].kind, 'tainted');
  assert.match(findings[0].why, /body\.project/);
});

test('A2 (GREEN twin): the SAME write routed through guardedFile is NOT a finding', () => {
  // This is the swap-the-fix proof: A1 and A2 differ ONLY by the guard, so A1's
  // red is caused by the missing guard and nothing else.
  const text = fn(
    'export function handleSave(body) {',
    '  const data = String(body.contents);',
    "  const p = guardedFile(projectsRoot, [body.project, 'x.json'], 'write');",
    '  if (p === null) return;',
    '  writeFileSync(p, data);',
    '}',
  );
  assert.deepEqual(analyzeModule(text, 'cli/ui-bridge.ts'), []);
});

test('A3 (RED): a literal leaf raw-appended below a guarded dir is a finding (the SEC-04 defect), even with no taint token', () => {
  // Kills: a lint that treats join(guardedDir, 'status.json') as safe because
  // the dir was guarded — the exact leaf-append escape the primitive closes.
  const text = fn(
    'export function readStatus(root, slug) {',
    '  const d = resolveGuardedPath(root, [slug]).realPath;',
    "  return readFileSync(join(d, 'status.json'), 'utf8');",
    '}',
  );
  const findings = analyzeModule(text, 'orchestrator/interactive-session.ts');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'leaf-append');
  assert.match(findings[0].why, /leaf-append/);
});

test('A4 (GREEN): the guard output itself (<g>.realPath) reaching the sink passes', () => {
  const text = fn(
    'export function readIt(guarded) {',
    "  return readFileSync(guarded.realPath, 'utf8');",
    '}',
  );
  assert.deepEqual(analyzeModule(text, 'cli/ui-bridge.ts'), []);
});

test('A4b (GREEN): a const bound from guardedFile, used bare, passes; dirname(<g>) also passes', () => {
  const text = fn(
    'export function writeIt(projectsRoot, segs, data) {',
    "  const p = guardedFile(projectsRoot, [...segs, 'questions.json'], 'write');",
    '  if (p === null) return null;',
    '  mkdirSync(dirname(p), { recursive: true });',
    '  writeFileSync(p, data);',
    '  return p;',
    '}',
  );
  assert.deepEqual(analyzeModule(text, 'orchestrator/interactive-session.ts'), []);
});

test('A5 (GREEN): a path built purely from a trusted root does NOT fire (no allowlist explosion)', () => {
  const text = fn(
    'export function scan() {',
    "  if (existsSync(join(logsRoot, 'sub'))) return true;",
    '  return false;',
    '}',
  );
  assert.deepEqual(analyzeModule(text, 'cli/ui-bridge.ts'), []);
});

test('A6 (GREEN): binding-wins — a SERVER-generated id (newArchitectSessionId) is not tainted despite the request-id name', () => {
  // Kills: a name-only taint that fires on every variable literally named
  // `sessionId`, which would flag server-generated ids and force false allowlists.
  const text = fn(
    'export function spawn(forgeRoot) {',
    '  const sessionId = newArchitectSessionId();',
    "  mkdirSync(join(forgeRoot, '_logs', sessionId), { recursive: true });",
    '}',
  );
  assert.deepEqual(analyzeModule(text, 'cli/ui-bridge.ts'), []);
});

test('A6b (RED): an UNRESOLVED request-id param (sessionId) reaching a raw sink IS tainted', () => {
  // The fallback that catches a request id arriving from the caller/route.
  const text = fn(
    'export function spawn(forgeRoot, sessionId) {',
    "  mkdirSync(join(forgeRoot, '_logs', sessionId), { recursive: true });",
    '}',
  );
  const findings = analyzeModule(text, 'cli/ui-bridge.ts');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'tainted');
  assert.match(findings[0].why, /sessionId/);
});

test('A7 (GREEN): a name enumerated from readdirSync(<trusted>) is server-sourced, not tainted', () => {
  // Kills: a prove-trusted polarity that fires on every enumeration loop.
  const text = fn(
    'export function loop() {',
    '  for (const name of readdirSync(projectsRoot)) {',
    '    if (existsSync(join(projectsRoot, name))) continue;',
    '  }',
    '}',
  );
  assert.deepEqual(analyzeModule(text, 'cli/metrics.ts'), []);
});

test('A9 (RED): a NEW raw leaf-append onto a bare session-dir PARAM trips the interprocedural rule', () => {
  // The exact architect-runner shape that shipped: a helper takes a pre-joined
  // `sessionDir` (the caller laundered a request id into it) and raw-appends a
  // leaf. The request-taint scan cannot see it (sessionDir is not a taint token),
  // so WITHOUT the dir-param rule this is a false negative — the SEC-04 hole.
  const text = fn(
    'export function readFoo(sessionDir) {',
    "  const p = join(sessionDir, 'foo.json');",
    '  if (!existsSync(p)) return null;',
    "  return readFileSync(p, 'utf8');",
    '}',
  );
  const findings = analyzeModule(text, 'orchestrator/architect-runner.ts');
  assert.equal(findings.length, 2, 'both the existsSync probe and the readFileSync leaf-append fire');
  for (const f of findings) {
    assert.equal(f.kind, 'dir-param-leaf-append');
    assert.match(f.why, /session-dir param "sessionDir"/);
  }
});

test('A9b (GREEN twin): the SAME read routed through the guarded sibling is NOT a finding', () => {
  // Swap-the-fix proof for A9: identical but for routing the leaf through the
  // guard — the RED is caused by the raw leaf-append and nothing else.
  const text = fn(
    'export function readFoo(projectsRoot, sessionId) {',
    "  const raw = guardedReadFile(projectsRoot, ['_architect', sessionId, 'foo.json']);",
    '  if (raw === null) return null;',
    '  return raw;',
    '}',
  );
  assert.deepEqual(analyzeModule(text, 'orchestrator/architect-runner.ts'), []);
});

test('A9c (GREEN): a BARE session-dir param with no leaf appended does NOT fire (the dir is the sibling ratchet\'s remit, only the leaf is this rule\'s)', () => {
  // Kills a dir-param rule implemented as taint on the bare name, which would
  // mis-fire on every `existsSync(sessionDir)`/`mkdirSync(sessionDir)` probe.
  const text = fn(
    'export function ensure(sessionDir) {',
    '  if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });',
    '}',
  );
  assert.deepEqual(analyzeModule(text, 'orchestrator/interactive-session.ts'), []);
});

test('A8: a sink-shaped call on a comment line is not counted', () => {
  const text = fn(
    'export function handle(body) {',
    "  // writeFileSync(join(root, body.project), data)  <- prose, not code",
    "  return existsSync(join(logsRoot, 'x'));",
    '}',
  );
  assert.deepEqual(analyzeModule(text, 'cli/ui-bridge.ts'), []);
});

// =============================================================================
// Group B — runLint + the allowlist contract
// =============================================================================

/** A synthetic tainted finding, as analyzeModule would emit it. */
const taintedFinding = (file = 'cli/ui-bridge.ts', line = 42, sink = 'writeFileSync') => ({
  file, line, sink, path: `join(projectsRoot, body.project, 'x.json')`, kind: 'tainted',
  why: 'request/project-derived path via "body.project" reaches raw writeFileSync unguarded',
});

test('B1: a finding with no allowlist entry is KEPT (fails the build)', () => {
  const { kept, suppressed } = applyAllowlist([taintedFinding()], []);
  assert.equal(kept.length, 1);
  assert.equal(suppressed.length, 0);
});

test('B2: a finding with a valid, reasoned allowlist entry (file+line+sink) is suppressed', () => {
  const f = taintedFinding();
  const { kept, suppressed } = applyAllowlist([f], [
    { file: f.file, line: f.line, sink: f.sink, reason: 'AUDITED: trusted-constant residual, boolean probe' },
  ]);
  assert.equal(kept.length, 0);
  assert.equal(suppressed.length, 1);
  assert.match(suppressed[0].reason, /AUDITED/);
});

test('B3: an allowlist entry with an empty reason does NOT suppress (never a silent skip)', () => {
  const f = taintedFinding();
  const { kept, suppressed } = applyAllowlist([f], [{ file: f.file, line: f.line, sink: f.sink, reason: '   ' }]);
  assert.equal(suppressed.length, 0);
  assert.equal(kept.length, 1);
  assert.match(kept[0].why, /NO REASON/);
});

test('B4: a MISTARGETED entry (line drifted onto a different sink) does NOT suppress', () => {
  // Kills: a file+line-only match that would silently bless whatever sink now
  // sits on the audited line after an unrelated edit shifted the code.
  const f = taintedFinding('cli/ui-bridge.ts', 42, 'writeFileSync');
  const { kept, suppressed, mistargeted } = applyAllowlist([f], [
    { file: f.file, line: f.line, sink: 'existsSync', reason: 'AUDITED: was a boolean probe here' },
  ]);
  assert.equal(suppressed.length, 0);
  assert.equal(kept.length, 1);
  assert.equal(mistargeted.length, 1);
});

test('B4b: a `sinks` array entry suppresses ANY listed sink on that line', () => {
  const a = taintedFinding('cli/bridge-studio-writes.ts', 919, 'existsSync');
  const b = { ...taintedFinding('cli/bridge-studio-writes.ts', 919, 'mkdirSync'), kind: 'tainted' };
  const { kept, suppressed } = applyAllowlist([a, b], [
    { file: 'cli/bridge-studio-writes.ts', line: 919, sinks: ['existsSync', 'mkdirSync'], reason: 'AUDITED: both ride the same containment proof' },
  ]);
  assert.equal(kept.length, 0);
  assert.equal(suppressed.length, 2);
});

test('B5: an allowlist entry matching NO finding is STALE (reported, never fails)', () => {
  const { kept, stale } = applyAllowlist([], [
    { file: 'cli/ui-bridge.ts', line: 99999, sink: 'existsSync', reason: 'AUDITED: a residual that has since been fixed/moved' },
  ]);
  assert.equal(kept.length, 0, 'a stale entry cannot create a failure');
  assert.equal(stale.length, 1);
});

// =============================================================================
// Group D — a synthetic NEW unguarded request sink in a REAL handling module
// TRIPS the lint through the real pipeline + real allowlist (charter RED)
// =============================================================================

test('D1: a NEW unguarded request-derived sink added to a real handling module fails against the REAL allowlist', () => {
  // The line (7) is not in the real allowlist, so it is not suppressed → the
  // gate would fail. This is the durable ratchet: a future author who adds a raw
  // request-derived sink to ui-bridge cannot land it silently.
  const text = fn(
    'export function handleNewRoute(req, body) {',
    '  // ... 5 lines of preamble to push the sink to a fresh line ...',
    '  const origin = req.headers.origin;',
    '  const project = body.project;',
    '  const sessionId = body.sessionId;',
    '  const dir = join(projectsRoot, project, sessionId);',
    "  writeFileSync(join(dir, 'poisoned.json'), JSON.stringify(body));",
    '}',
  );
  const findings = analyzeModule(text, 'cli/ui-bridge.ts');
  assert.ok(findings.length >= 1, 'the new tainted sink is detected');
  const { kept } = applyAllowlist(findings, ALLOWLIST);
  assert.ok(kept.length >= 1, 'and it is NOT pre-suppressed by the real allowlist → the gate fails');
  assert.ok(kept.some((f) => f.sink === 'writeFileSync'), 'the writeFileSync sink is among the failures');
});

// =============================================================================
// Group C — the CI-enforced gate: the REAL repository passes clean, for the
// right reason (proven live via the exported runLint(), no subprocess)
// =============================================================================

test('C1: the real repository passes the raw-fs-guarded lint clean', () => {
  const r = runLint({});
  assert.equal(r.findings.length, 0, `expected 0 unguarded request-derived raw fs sinks, got ${r.findings.length}`);
});

test('C2: clean FOR THE RIGHT REASON — the scanner is live and residuals are actually suppressed', () => {
  // False-negative discipline: if the scanner were gutted (total → 0) or the
  // allowlist stopped matching (suppressed → 0), this fails even though C1's
  // "findings === 0" would still trivially hold.
  const r = runLint({});
  assert.ok(r.total > 0, 'the scan must inspect >0 raw-fs sink candidates (not a dead lint)');
  assert.ok(r.suppressed.length > 0, 'residuals must exist and be cleared by reasoned allowlist rows (not "found nothing")');
  assert.equal(r.stale.length, 0, `no stale allowlist rows (a rotted row means the audited sink moved): ${r.stale.map((s) => `${s.file}:${s.line}`).join(', ')}`);
  assert.equal(r.mistargeted.length, 0, 'no mistargeted allowlist rows');
});

test('C3: the real handling-module set is present and includes the charter modules + the bridge-studio glob', () => {
  const mods = targetModules();
  for (const m of [
    'cli/ui-bridge.ts', 'cli/metrics.ts', 'cli/contract-stages.ts', 'cli/agent-run.ts', 'cli/architect-plan.ts',
    'orchestrator/interactive-session.ts', 'orchestrator/architect-runner.ts', 'orchestrator/instructions-runner.ts',
    'orchestrator/project-brain-builder-runner.ts', 'orchestrator/demo-builder-runner.ts',
  ]) {
    assert.ok(mods.includes(m), `charter module ${m} must be in scope`);
  }
  assert.ok(mods.some((m) => m.startsWith('cli/bridge-studio')), 'the cli/bridge-studio*.ts glob must be in scope');
  assert.ok(!mods.some((m) => m.endsWith('.test.ts')), 'no *.test.ts in scope');
});

test('C4: every real allowlist row is well-formed (file, line, a reason, and an audited sink)', () => {
  // A structural integrity gate on the allowlist itself — a row with no reason
  // or no sink identity is not an audited residual, it is a silent skip.
  assert.ok(Array.isArray(ALLOWLIST) && ALLOWLIST.length > 0);
  for (const a of ALLOWLIST) {
    assert.equal(typeof a.file, 'string');
    assert.equal(typeof a.line, 'number');
    assert.ok(a.reason && a.reason.trim().length > 20, `row ${a.file}:${a.line} needs a substantive reason`);
    const sinks = a.sinks ?? (a.sink ? [a.sink] : []);
    assert.ok(sinks.length > 0, `row ${a.file}:${a.line} must name the audited sink(s)`);
    for (const s of sinks) assert.ok(RAW_FS_SINKS.includes(s), `row ${a.file}:${a.line} names non-sink "${s}"`);
  }
});

test('the export surface is present (registry probes)', () => {
  assert.equal(typeof (lint as Record<string, unknown>).analyzeModule, 'function');
  assert.equal(typeof (lint as Record<string, unknown>).runLint, 'function');
  assert.ok((lint as Record<string, unknown>).ALLOWLIST);
  assert.ok(REQUEST_TAINT_BARE.has('sessionId') && REQUEST_TAINT_BARE.has('slug'));
});
