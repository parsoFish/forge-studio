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
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  analyzeModule,
  applyAllowlist,
  runLint,
  targetModules,
  ALLOWLIST,
  RAW_FS_SINKS,
  SINK_PATH_ARG_INDICES,
  GUARD_PRODUCERS,
  REQUEST_TAINT_BARE,
  DIR_PARAM_NAMES,
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
    assert.match(f.why, /dir-shaped param "sessionDir"/);
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

// ---- Capability 1: URL-derived taint (the phase-log blind spot) ----

test('A10 (RED): a URL-derived id (decodeURIComponent(url.match(re)[1])) reaching a raw readFileSync is a finding', () => {
  // Kills: a taint model that does not treat url/rawUrl as request sources — the
  // exact phase-log escape (runId laundered out of the request URL through
  // match + decodeURIComponent, so no HTTP-member/curated-id token is visible).
  const text = fn(
    'export function handlePhaseLog(rawUrl) {',
    '  const url = pathOnly(rawUrl);',
    '  const m = url.match(ROUTE_RE);',
    '  const runId = decodeURIComponent(m[1]);',
    '  const safeBase = resolve(logsRoot);',
    "  const eventsPath = resolve(safeBase, runId, 'events.jsonl');",
    "  return readFileSync(eventsPath, 'utf8');",
    '}',
  );
  const findings = analyzeModule(text, 'cli/bridge-studio.ts');
  assert.equal(findings.length, 1, 'exactly one finding');
  assert.equal(findings[0].sink, 'readFileSync');
  assert.equal(findings[0].kind, 'tainted');
});

test('A10b (RED): url.split("/") slicing also taints', () => {
  // The second common shape named in the charter (const seg = url.split('/')[k]).
  const text = fn(
    'export function handle(rawUrl, body) {',
    '  const url = pathOnly(rawUrl);',
    '  const seg = url.split(SEP)[3];',
    "  writeFileSync(join(projectsRoot, seg, 'x.json'), String(body));",
    '}',
  );
  const findings = analyzeModule(text, 'cli/ui-bridge.ts');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].sink, 'writeFileSync');
  assert.equal(findings[0].kind, 'tainted');
});

test('A11 (GREEN twin): the SAME URL-derived read routed through guardedFile is NOT a finding', () => {
  // Swap-the-fix proof for A10: identical but for routing the FULL path through
  // the guard, making the readFileSync path guard-terminal.
  const text = fn(
    'export function handlePhaseLog(rawUrl) {',
    '  const url = pathOnly(rawUrl);',
    '  const m = url.match(ROUTE_RE);',
    '  const runId = decodeURIComponent(m[1]);',
    "  const g = guardedFile(logsRoot, [runId, 'events.jsonl'], 'read');",
    '  if (g === null) return null;',
    "  return readFileSync(g, 'utf8');",
    '}',
  );
  assert.deepEqual(analyzeModule(text, 'cli/bridge-studio.ts'), []);
});

test('A11b (GREEN): a `url` bound from a NON-request value stays clean (binding-wins, no over-fire)', () => {
  // Guards against seeding url/rawUrl as always-tainted HEADS: a variable that
  // merely happens to be named `url` but is built from a trusted constant must
  // not fire, or the broadened taint would explode the allowlist.
  const text = fn(
    'export function fetchRemote(repo) {',
    '  const url = repo.configuredMirror;',
    "  return existsSync(join(logsRoot, url, 'cache.json'));",
    '}',
  );
  assert.deepEqual(analyzeModule(text, 'cli/ui-bridge.ts'), []);
});

// ---- Capability 2: broadened dir-param leaf-append (loadProjectConfig shape) ----

test('A12 (RED): a leaf raw-appended onto an unresolved projectRoot param (loadProjectConfig shape) is a finding', () => {
  // Kills: a dir-param rule that only knew "sessionDir" — the exact
  // loadProjectConfig(projectRoot) -> join(projectRoot, ".forge/project.json")
  // leaf-append escape (residual #1).
  const text = fn(
    'export function loadProjectConfig(projectRoot) {',
    "  const p = join(projectRoot, '.forge', 'project.json');",
    '  if (!existsSync(p)) return null;',
    "  return readFileSync(p, 'utf8');",
    '}',
  );
  const findings = analyzeModule(text, 'orchestrator/project-config.ts');
  assert.equal(findings.length, 2, 'both the existsSync probe and the readFileSync leaf-append fire');
  for (const f of findings) {
    assert.equal(f.kind, 'dir-param-leaf-append');
    assert.match(f.why, /dir-shaped param "projectRoot"/);
  }
});

test('A13 (GREEN twin): the SAME projectRoot read routed through guardedReadFile is NOT a finding', () => {
  // Swap-the-fix proof for A12.
  const text = fn(
    'export function loadProjectConfig(projectRoot) {',
    "  const raw = guardedReadFile(projectRoot, ['.forge', 'project.json']);",
    '  if (raw === null) return null;',
    '  return raw;',
    '}',
  );
  assert.deepEqual(analyzeModule(text, 'orchestrator/project-config.ts'), []);
});

test('A14 (GREEN): a BARE dir-shaped param probe (existsSync(projectRoot), no leaf) does NOT fire', () => {
  // The charter's explicit false-positive control: broadening to projectRoot/dir/
  // root/base must NOT taint the bare name — only a LEAF-APPEND fires. A bare
  // existence probe on the dir itself is the sibling ratchet's remit.
  const text = fn(
    'export function ensureProject(projectRoot) {',
    '  if (!existsSync(projectRoot)) return false;',
    '  return true;',
    '}',
  );
  assert.deepEqual(analyzeModule(text, 'cli/bridge-studio-writes.ts'), []);
});

test('A15 (GREEN): a leaf-append over a DESTRUCTURED for-of loop var (trusted collection) does NOT fire', () => {
  // Regression lock for the FP the broadened `dir` name surfaced: `dir` from
  // `for (const [dir, status] of stateDirs)` is a SERVER-enumerated loop var, not
  // a caller-supplied param. findBinding must resolve the destructure to its
  // (trusted) collection so the dir-param rule does not cry wolf.
  const text = fn(
    'export function scan(projectId) {',
    '  const stateDirs = [[queuePaths.inFlight, S1], [queuePaths.done, S2]];',
    '  for (const [dir, status] of stateDirs) {',
    '    for (const file of readdirSync(dir)) {',
    "      const raw = readFileSync(join(dir, file), 'utf8');",
    '      handle(raw);',
    '    }',
    '  }',
    '}',
  );
  assert.deepEqual(analyzeModule(text, 'cli/bridge-studio.ts'), []);
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
    'cli/ui-bridge.ts', 'packages/flows/metrics.ts', 'packages/projects/contract-stages.ts', 'packages/agents/agent-run.ts', 'packages/factory/architect-plan.ts',
    'packages/sessions/interactive-session.ts', 'packages/sessions/architect-runner.ts', 'packages/sessions/kinds/instructions.ts',
    'packages/sessions/kinds/project-brain.ts', 'packages/sessions/kinds/demo-builder.ts',
  ]) {
    assert.ok(mods.includes(m), `charter module ${m} must be in scope`);
  }
  assert.ok(mods.some((m) => m.startsWith('cli/bridge-studio')), 'the cli/bridge-studio*.ts glob must be in scope');
  assert.ok(!mods.some((m) => m.endsWith('.test.ts')), 'no *.test.ts in scope');
  // SEC-04 blind-spot #b: the delegated config-loader helper is now in scope so
  // its interprocedural leaf-append (loadProjectConfig -> join(projectRoot,
  // ".forge/project.json")) is visible to the ratchet.
  assert.ok(mods.includes('packages/projects/project-config.ts'), 'the config-loader helper must be in scope');
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

// =============================================================================
// Group E — W7-C3 (forge-i9w): the fd-based sink family. openSync is a PATH
// sink (its first argument is a filesystem path, exactly like readFileSync);
// the fd-consuming half of the family (readSync/writeSync/fstatSync/closeSync)
// takes a file DESCRIPTOR, not a path, so the path dimension is entirely
// carried by the openSync that produced the fd. R4-22's TOCTOU fix moved
// interactive-finalizers onto openSync(O_NOFOLLOW)+readSync/writeSync and the
// lint went structurally blind to that whole module's future openSync paths.
// =============================================================================

test('E1 (RED): a request-derived path reaching a raw openSync is a finding', () => {
  // Kills: a sink list that stops at the six buffer-API names — the exact
  // blindness forge-i9w documents.
  const text = fn(
    'export function handleTail(body) {',
    "  const fd = openSync(join(logsRoot, body.runId, 'stderr.log'), 'a');",
    '  return fd;',
    '}',
  );
  const findings = analyzeModule(text, 'cli/ui-bridge.ts');
  assert.equal(findings.length, 1, 'exactly one finding');
  assert.equal(findings[0].sink, 'openSync');
});

test('E2 (GREEN twin): the SAME open routed through the guard is NOT a finding (O_NOFOLLOW on a guard-produced path is credited, not blanket-flagged)', () => {
  const text = fn(
    'export function handleTail(body) {',
    "  const p = guardedFile(logsRoot, [body.runId, 'stderr.log'], 'write');",
    '  if (p === null) return null;',
    "  const fd = openSync(p, 'a');",
    '  return fd;',
    '}',
  );
  assert.deepEqual(analyzeModule(text, 'cli/ui-bridge.ts'), []);
});

test('E3: openSync is in the sink list; the fd-consuming names are NOT (they take an fd, not a path)', () => {
  assert.ok(RAW_FS_SINKS.includes('openSync'), 'openSync joins the path-sink family');
  for (const notAPathSink of ['readSync', 'writeSync', 'fstatSync', 'closeSync']) {
    assert.ok(!RAW_FS_SINKS.includes(notAPathSink), `${notAPathSink} takes an fd — flagging it would be noise, not coverage`);
  }
});

test('the export surface is present (registry probes)', () => {
  assert.equal(typeof (lint as Record<string, unknown>).analyzeModule, 'function');
  assert.equal(typeof (lint as Record<string, unknown>).runLint, 'function');
  assert.ok((lint as Record<string, unknown>).ALLOWLIST);
  assert.ok(REQUEST_TAINT_BARE.has('sessionId') && REQUEST_TAINT_BARE.has('slug'));
  // Capability 1: the URL-derived roots are seeded taint sources.
  assert.ok(REQUEST_TAINT_BARE.has('url') && REQUEST_TAINT_BARE.has('rawUrl'), 'url/rawUrl are request-taint roots');
  // Capability 2: the dir-param set is broadened beyond sessionDir.
  for (const n of ['sessionDir', 'projectRoot', 'projectDir', 'dir', 'root', 'base', 'repoPath']) {
    assert.ok(DIR_PARAM_NAMES.has(n), `dir-shaped param "${n}" is recognized`);
  }
});

// =============================================================================
// Group F — W8-C2a (forge-5kh): the PATH-FIRST MUTATING sink families. The
// six buffer-API names plus openSync covered reads, writes and directory
// creation, but the whole DESTRUCTIVE half of node:fs — append, rename, rm,
// unlink, cp/copyFile, symlink, createWriteStream — was structurally invisible.
// forge-5kh proved it by probe: a module containing an unguarded
// `openSync(join(ctx.logsRoot, body.cycleId, 'stderr.log'))` was caught, while
// appendFileSync/copyFileSync/renameSync/rmSync/unlinkSync/symlinkSync/cpSync/
// createWriteStream on the IDENTICAL request-derived path ALL passed silently.
// A ratchet whose whole purpose is "fail when a new unguarded sink appears"
// could not see the families that DELETE and OVERWRITE.
//
// The second half of this group covers the argument-position problem the first
// six sinks never had: renameSync/cpSync/copyFileSync take TWO real paths and
// symlinkSync's path is its SECOND argument (the first is the link target
// string, which this process never opens). A first-argument-only scan of those
// is not partial coverage, it is a wrong answer — see SINK_PATH_ARG_INDICES.
// =============================================================================

test('F1 (RED): every path-first mutating sink on a request-derived path is a finding', () => {
  // Kills: the pre-forge-5kh sink list. Each of these is the SAME tainted path
  // expression that E1 proves is caught for openSync — only the sink differs,
  // so a red here can be caused by nothing but the sink list.
  const cases: Array<[string, string]> = [
    ['appendFileSync', "appendFileSync(join(logsRoot, body.runId, 'x.log'), 'line');"],
    ['rmSync', "rmSync(join(logsRoot, body.runId), { recursive: true });"],
    ['rmdirSync', 'rmdirSync(join(logsRoot, body.runId));'],
    ['unlinkSync', "unlinkSync(join(logsRoot, body.runId, 'x.log'));"],
    ['createWriteStream', "createWriteStream(join(logsRoot, body.runId, 'x.log'));"],
  ];
  for (const [sink, call] of cases) {
    const text = fn('export function handle(body) {', `  ${call}`, '}');
    const findings = analyzeModule(text, 'cli/ui-bridge.ts');
    assert.equal(findings.length, 1, `${sink}: exactly one finding, got ${JSON.stringify(findings)}`);
    assert.equal(findings[0].sink, sink);
    assert.equal(findings[0].kind, 'tainted');
  }
});

test('F2 (GREEN twin): the SAME mutating calls routed through the guard are NOT findings', () => {
  // The swap-the-fix proof for F1: identical bodies, guard added, nothing else.
  const cases = [
    "appendFileSync(p, 'line');",
    'rmSync(p, { recursive: true });',
    'rmdirSync(p);',
    'unlinkSync(p);',
    'createWriteStream(p);',
  ];
  for (const call of cases) {
    const text = fn(
      'export function handle(body) {',
      "  const p = guardedFile(logsRoot, [body.runId, 'x.log'], 'write');",
      '  if (p === null) return;',
      `  ${call}`,
      '}',
    );
    assert.deepEqual(analyzeModule(text, 'cli/ui-bridge.ts'), [], `guarded ${call} must not fire`);
  }
});

test('F3 (RED): a TWO-PATH sink is scanned on BOTH ends — a tainted DESTINATION is caught even when the source is trusted', () => {
  // Kills: adding rename/cp to the sink list but leaving the scan first-argument
  // only. The destination of a rename/copy is where bytes LAND; a first-arg-only
  // scan reports clean on the more dangerous half.
  for (const sink of ['renameSync', 'cpSync', 'copyFileSync']) {
    const text = fn(
      'export function handle(body) {',
      "  const src = join(logsRoot, 'template.json');",
      `  ${sink}(src, join(projectsRoot, body.project, 'out.json'));`,
      '}',
    );
    const findings = analyzeModule(text, 'cli/ui-bridge.ts');
    assert.equal(findings.length, 1, `${sink} destination: exactly one finding, got ${JSON.stringify(findings)}`);
    assert.equal(findings[0].sink, sink);
    assert.match(findings[0].why, /body\.project/);
  }
});

test('F4 (RED): a TWO-PATH sink is caught on its SOURCE end too, and both ends tainted yields two findings', () => {
  const src = fn(
    'export function handle(body) {',
    `  renameSync(join(logsRoot, body.runId, 'a'), join(logsRoot, 'archive', 'a'));`,
    '}',
  );
  const one = analyzeModule(src, 'cli/ui-bridge.ts');
  assert.equal(one.length, 1, `tainted source: one finding, got ${JSON.stringify(one)}`);

  const both = fn(
    'export function handle(body) {',
    `  renameSync(join(logsRoot, body.runId, 'a'), join(projectsRoot, body.project, 'a'));`,
    '}',
  );
  const two = analyzeModule(both, 'cli/ui-bridge.ts');
  assert.equal(two.length, 2, `both ends tainted: two findings, got ${JSON.stringify(two)}`);
});

test('F5 (RED): symlinkSync is scanned on its SECOND argument — the path CREATED, not the link target string', () => {
  // Kills: a naive first-arg scan of symlinkSync. Argument 0 is the target the
  // link will POINT AT (a string this process never opens); argument 1 is the
  // path actually created on disk. Scanning arg 0 would flag the wrong value and
  // miss the real one — a wrong answer dressed as coverage.
  const tainted = fn(
    'export function handle(body) {',
    "  symlinkSync('/etc/passwd', join(projectsRoot, body.project, 'link'));",
    '}',
  );
  const findings = analyzeModule(tainted, 'cli/ui-bridge.ts');
  assert.equal(findings.length, 1, `one finding, got ${JSON.stringify(findings)}`);
  assert.equal(findings[0].sink, 'symlinkSync');
  assert.match(findings[0].why, /body\.project/);

  // The mirror: a tainted arg-0 (the link TARGET) with a trusted created path is
  // NOT a containment finding for this lint — nothing is opened through it here.
  const targetOnly = fn(
    'export function handle(body) {',
    "  symlinkSync(join(projectsRoot, body.project), join(logsRoot, 'fixed-link'));",
    '}',
  );
  assert.deepEqual(analyzeModule(targetOnly, 'cli/ui-bridge.ts'), [], 'arg-0 link target is not the path sink');
});

test('F6 (GREEN twin): guarded two-path calls do NOT fire on either end', () => {
  const text = fn(
    'export function handle(body) {',
    "  const s = guardedFile(logsRoot, [body.runId, 'a'], 'read');",
    "  const d = guardedFile(projectsRoot, [body.project, 'a'], 'write');",
    '  if (s === null || d === null) return;',
    '  renameSync(s, d);',
    '  copyFileSync(s, d);',
    '  cpSync(s, d);',
    "  symlinkSync('/tmp/whatever', d);",
    '}',
  );
  assert.deepEqual(analyzeModule(text, 'cli/ui-bridge.ts'), []);
});

test('F7: the sink list names the mutating families, records each one\'s PATH ARGUMENT POSITIONS, and states what it deliberately excludes', () => {
  for (const s of [
    'appendFileSync', 'renameSync', 'rmSync', 'rmdirSync', 'unlinkSync',
    'cpSync', 'copyFileSync', 'symlinkSync', 'createWriteStream',
  ]) {
    assert.ok(RAW_FS_SINKS.includes(s), `${s} is a path sink and must be scanned (forge-5kh)`);
  }
  // Argument positions are DATA, not an assumption baked into the scanner.
  assert.deepEqual(SINK_PATH_ARG_INDICES.renameSync, [0, 1]);
  assert.deepEqual(SINK_PATH_ARG_INDICES.cpSync, [0, 1]);
  assert.deepEqual(SINK_PATH_ARG_INDICES.copyFileSync, [0, 1]);
  assert.deepEqual(SINK_PATH_ARG_INDICES.symlinkSync, [1]);
  // Sinks absent from the map are first-argument sinks; that default must hold.
  assert.equal(SINK_PATH_ARG_INDICES.readFileSync, undefined);
  // DELIBERATE EXCLUSION, pinned so a future widener has to argue with a test:
  // realpathSync IS the containment primitive these modules call to CONTAIN a
  // path. Flagging it fires on every manual-containment site — i.e. on the code
  // doing the right thing — which is the prove-trusted polarity this lint's own
  // header rejects because it trains blind allowlist regeneration.
  assert.ok(!RAW_FS_SINKS.includes('realpathSync'), 'realpathSync is the containment primitive, not a sink to flag');
});

test('F8: resolveKbBrainDir is a guard producer — a value bound from it is guard-terminal', () => {
  // Kills: the three hand-written allowlist rows that each asserted, in prose,
  // "dir = resolveKbBrainDir(...) runs the per-segment realpath identity walk".
  // A reason repeated in three places is a stale copy waiting to happen; the
  // scanner now knows the fact instead of three comments claiming it.
  assert.ok(GUARD_PRODUCERS.includes('resolveKbBrainDir'));
  const text = fn(
    'export function handleDelete(url) {',
    '  const id = decodeURIComponent(url.split("/")[4]);',
    '  const dir = resolveKbBrainDir(forgeRoot, id);',
    '  if (!dir) return;',
    '  rmSync(dir, { recursive: true, force: true });',
    '}',
  );
  assert.deepEqual(analyzeModule(text, 'cli/bridge-studio-kbs.ts'), []);
});

test('F9: the new producer is NOT a blanket hole — an inline leaf appended below it still fires', () => {
  // The attack-the-fix test. Granting resolveKbBrainDir guard status must give
  // it EXACTLY the semantics the other five producers have, not an exemption:
  // the leaf below a guarded dir is still unguarded and must still be caught.
  const text = fn(
    'export function handleList(url) {',
    '  const id = decodeURIComponent(url.split("/")[4]);',
    '  const dir = resolveKbBrainDir(forgeRoot, id);',
    '  readdirSync(join(dir, "_guidance"));',
    '}',
  );
  const findings = analyzeModule(text, 'cli/bridge-studio-kbs.ts');
  assert.equal(findings.length, 1, `leaf-append below the new producer must fire, got ${JSON.stringify(findings)}`);
  assert.equal(findings[0].kind, 'leaf-append');

  // Parity control: the SAME shape below an ESTABLISHED producer fires
  // identically. If this ever diverges, the new producer was given special
  // treatment and this test is the thing that says so.
  const twin = fn(
    'export function handleList(url) {',
    '  const id = decodeURIComponent(url.split("/")[4]);',
    '  const dir = guardedFile(brainRoot, [id], "read");',
    '  readdirSync(join(dir, "_guidance"));',
    '}',
  );
  const twinFindings = analyzeModule(twin, 'cli/bridge-studio-kbs.ts');
  assert.equal(twinFindings.length, 1);
  assert.equal(twinFindings[0].kind, findings[0].kind, 'new producer must behave exactly like an established one');
});

test('F10: argAt returns absent (not a bogus expression) when a call has fewer arguments than the sink\'s path positions', () => {
  // Kills: an off-by-one that made `rmSync(p)` (one argument) report a phantom
  // second path, or that made a two-path sink silently scan argument 0 twice.
  const oneArg = fn(
    'export function handle(body) {',
    "  renameSync(join(logsRoot, body.runId, 'a'));",
    '}',
  );
  const findings = analyzeModule(oneArg, 'cli/ui-bridge.ts');
  assert.equal(findings.length, 1, `a 1-arg renameSync yields exactly one finding, got ${JSON.stringify(findings)}`);
});

test('F11: argAt survives the shapes real code actually uses — multi-line calls, trailing commas, nested call arguments', () => {
  // Kills: an argAt that splits on commas naively. Real bridge code writes
  // two-path calls across several lines and nests join()/resolve() inside the
  // argument, both of which contain commas at a deeper paren depth. A scanner
  // that mis-parses these reports a wrong path expression and silently
  // mis-classifies, which is worse than not scanning the sink at all.
  const multiLine = fn(
    'export function handle(body) {',
    '  renameSync(',
    '    join(logsRoot, "template.json"),',
    '    join(projectsRoot, body.project, "out.json"),',
    '  );',
    '}',
  );
  const ml = analyzeModule(multiLine, 'cli/ui-bridge.ts');
  assert.equal(ml.length, 1, `multi-line two-path: the tainted DESTINATION only, got ${JSON.stringify(ml)}`);
  assert.equal(ml[0].sink, 'renameSync');
  assert.match(ml[0].why, /body\.project/);

  const trailingComma = fn(
    'export function handle(body) {',
    '  rmSync(join(logsRoot, body.runId), { recursive: true, force: true },);',
    '}',
  );
  assert.equal(analyzeModule(trailingComma, 'cli/ui-bridge.ts').length, 1, 'a trailing comma does not invent an extra path argument');

  const nestedArgs = fn(
    'export function handle(body) {',
    '  cpSync(resolve(a, join(b, "x")), join(projectsRoot, body.project));',
    '}',
  );
  const na = analyzeModule(nestedArgs, 'cli/ui-bridge.ts');
  assert.equal(na.length, 1, `commas nested inside a call argument do not shift the split, got ${JSON.stringify(na)}`);
  assert.equal(na[0].sink, 'cpSync');
});

// =============================================================================
// Group G — W8-F5: SCOPE. "A gate that cannot see a new module is decoration."
//
// The C4 hostile re-verification refuted this lint's coverage claim with a
// runnable counter-repro: `targetModules()` scoped the scan by FILENAME (a
// hand-maintained list plus a `cli/bridge-studio*.ts` glob), so TWO
// BYTE-IDENTICAL tainted files differed only in basename and only the
// `bridge-studio` one was a finding — while the invisible one was proven
// genuinely reachable from a bridge route by a 184-module reachability walk.
// The same pass filed the verifier's own repro (a new `cli/studio-costs-routes.ts`
// with two blatant unguarded request-derived sinks → 0 findings, gate PASS).
//
// These pins are the contract for the cure: scope is DERIVED (bridge entries +
// reachability + the HTTP-plumbing signal for the full model; an unambiguous
// HTTP-member sweep over cli/** + orchestrator/** for everything else), never
// keyed on what a file is called.
// =============================================================================

const scratchRoots: string[] = [];
after(() => {
  for (const dir of scratchRoots) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway repo-shaped root holding exactly the given repo-relative files.
 *  Fixtures never touch the real tree (the C4 refuter's discipline). */
function scratchRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'rawfs-scope-'));
  scratchRoots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return root;
}

/** The C4 refuter's taint shape, verbatim: a request member (`body.runId`)
 *  bound to a local and raw-joined into a readFileSync. */
const TAINTED_MODULE = [
  'import { readFileSync } from "node:fs";',
  'import { join } from "node:path";',
  'const LOGS_ROOT = "/x";',
  'export function handleGet(body: any) { const runId = body.runId; return readFileSync(join(LOGS_ROOT, runId, "e.jsonl"), "utf8"); }',
  '',
].join('\n');

test('G1 (RED — the C4 counter-repro): two BYTE-IDENTICAL tainted modules are both scanned; the basename decides nothing', () => {
  // Kills: `targetModules()` scoped by a `cli/bridge-studio*.ts` glob — the
  // refuted implementation, where `cmp` says the files are identical and only
  // one of them is a finding.
  const root = scratchRoot({
    'cli/bridge-runs-v2.ts': TAINTED_MODULE,
    'cli/bridge-studio-zz.ts': TAINTED_MODULE,
  });
  const r = runLint({ root, allowlist: [] });
  const files = r.findings.map((f) => f.file).sort();
  assert.deepEqual(
    [...new Set(files)],
    ['cli/bridge-runs-v2.ts', 'cli/bridge-studio-zz.ts'],
    `both byte-identical modules must be findings; got ${JSON.stringify(r.findings)}`,
  );
});

test('G2 (RED — the C4 verifier repro): a NEW request-handling module whose name matches no glob is scanned', () => {
  // Kills: any scope rule that still keys on the filename. `studio-costs-routes.ts`
  // is in no list, matches no glob, and is imported by nothing in this fixture.
  const root = scratchRoot({
    'cli/studio-costs-routes.ts': [
      'import { readFileSync, writeFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'export function handleCostsRead(body: { runId: string }, logsRoot: string) {',
      '  const runId = body.runId;',
      '  return readFileSync(join(logsRoot, runId, "costs.json"), "utf8");',
      '}',
      'export function handleCostsWrite(params: { sessionId: string }, root: string, payload: string) {',
      '  const sessionId = params.sessionId;',
      '  writeFileSync(join(root, sessionId, "costs.json"), payload);',
      '}',
      '',
    ].join('\n'),
  });
  const r = runLint({ root, allowlist: [] });
  const sinks = r.findings.filter((f) => f.file === 'cli/studio-costs-routes.ts').map((f) => f.sink).sort();
  assert.deepEqual(sinks, ['readFileSync', 'writeFileSync'], `both unguarded sinks must fire; got ${JSON.stringify(r.findings)}`);
});

test('G3 (RED): a new route helper under orchestrator/studio/ is scanned too (the third escape the refuter named)', () => {
  const root = scratchRoot({ 'orchestrator/studio/costs-routes.ts': TAINTED_MODULE });
  const r = runLint({ root, allowlist: [] });
  assert.equal(r.findings.length, 1, `the orchestrator/studio route helper must be scanned; got ${JSON.stringify(r.findings)}`);
  assert.equal(r.findings[0].file, 'orchestrator/studio/costs-routes.ts');
});

test('G4 (CALIBRATION): outside the declared request-handling surface only the UNAMBIGUOUS HTTP-member shape fires — the curated bare-name and dir-param rules stay off', () => {
  // Kills: "widen the scope to every reachable module with the full taint
  // model" — measured at c0093918 that is 108 findings in engine modules where
  // `runId`/`repoPath`/`dir` are SERVER-built, i.e. ~108 allowlist rows added
  // to get green, which is the anti-pattern this lint's own header names.
  // A bare curated id + a dir-param leaf-append in a deep engine module is NOT
  // a finding; the same file gets the full model the moment it handles requests.
  const engine = [
    'import { writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    'export function persist(runId: string, dir: string, payload: string) {',
    '  writeFileSync(join(dir, runId + ".json"), payload);',
    '}',
    '',
  ].join('\n');
  const engineRoot = scratchRoot({ 'orchestrator/run-state.ts': engine });
  const quiet = runLint({ root: engineRoot, allowlist: [] });
  assert.deepEqual(quiet.findings, [], 'a server-built id in an engine module does not fire');
  // …and it is quiet because the sweep is CALIBRATED, not because the sweep
  // skipped the file: the module must actually be in the swept set.
  const swept = (lint as { sweepModules?: (root?: string) => string[] }).sweepModules?.(engineRoot) ?? [];
  assert.ok(swept.includes('orchestrator/run-state.ts'), `the engine module must be swept (and silent), got ${JSON.stringify(swept)}`);

  // The SAME bytes in a module that speaks HTTP (an IncomingMessage handler)
  // are inside the declared surface, where the full model applies.
  const handler = engine.replace(
    'export function persist',
    'import type { IncomingMessage, ServerResponse } from "node:http";\nexport function route(req: IncomingMessage, res: ServerResponse) { return [req, res]; }\nexport function persist',
  );
  const loud = runLint({ root: scratchRoot({ 'cli/ui-bridge.ts': handler }), allowlist: [] });
  assert.equal(loud.findings.length, 1, `the declared surface keeps the full model; got ${JSON.stringify(loud.findings)}`);
  assert.equal(loud.findings[0].kind, 'tainted', 'inside the declared surface the curated bare-id rule still fires');
});

test('G5: the derived scope is a SUPERSET of the charter list and of every cli/bridge-studio*.ts (a derivation must never silently drop coverage)', () => {
  // Kills: replacing the hand list with a walk that happens to miss a module —
  // coverage loss reads as "no findings", the same green a clean tree gives.
  const mods = targetModules();
  for (const m of [
    'cli/ui-bridge.ts', 'packages/flows/metrics.ts', 'packages/projects/contract-stages.ts', 'packages/agents/agent-run.ts', 'packages/factory/architect-plan.ts',
    'packages/sessions/interactive-session.ts', 'packages/sessions/interactive-finalizers.ts', 'packages/sessions/interactive-runner.ts',
    'packages/sessions/architect-runner.ts', 'packages/sessions/kinds/instructions.ts',
    'packages/sessions/kinds/project-brain.ts', 'packages/sessions/kinds/demo-builder.ts',
    'packages/projects/project-config.ts', 'packages/library/studio/skill-install.ts', 'packages/library/studio/skill-package.ts', 'packages/library/studio/skill-trust.ts', 'packages/library/bridge-studio-authoring-hook.ts', 'packages/library/bridge-studio-authoring-template.ts',
    'packages/library/studio/community-install.ts', 'packages/library/studio/community-index.ts',
  ]) {
    assert.ok(mods.includes(m), `pre-W8-F5 scope module ${m} must still be in scope`);
  }
  assert.ok(mods.filter((m) => m.split('/').pop().startsWith('bridge-studio')).length >= 14, 'every bridge-studio route module stays in scope');
  assert.ok(!mods.some((m) => m.endsWith('.test.ts')), 'no *.test.ts in scope');
});

test('G6 (RED): cli/bridge-recovery.ts — a REAL bridge route module with renameSync/rmSync on :id-derived paths — is in scope', () => {
  // The lint shipped for two waves with an entire live bridge route file
  // outside it, because its basename is `bridge-recovery`, not `bridge-studio`.
  const mods = targetModules();
  assert.ok(mods.includes('packages/flows/bridge-recovery.ts'), 'the recovery routes must be dataflow-linted');
  assert.ok(mods.includes('packages/flows/bridge-hooks.ts'), 'the hooks routes must be dataflow-linted');
});

test('G7: the sweep is LIVE and disjoint from the declared surface (false-negative discipline, C2 for the second tier)', () => {
  // Kills: a sweep that silently degenerates to an empty module list — which
  // would leave G1/G2 green only because the declared surface caught them.
  const declared = targetModules();
  const swept = (lint as { sweepModules?: (root?: string) => string[] }).sweepModules?.() ?? [];
  assert.ok(swept.length > 100, `the sweep must cover the cli/ + orchestrator/ tree, got ${swept.length}`);
  assert.equal(swept.filter((m) => declared.includes(m)).length, 0, 'the sweep never re-scans a declared-surface module (no double reporting)');
  assert.ok(!swept.some((m) => m.endsWith('.test.ts')), 'no *.test.ts in the sweep');
  const r = runLint({});
  assert.ok((r as { swept?: number }).swept! > 100, 'runLint reports what the sweep actually covered');
});

test('G8 (RED at the W8-F5 cure, found by hostile self-review): a DESTRUCTURED request member is resolved — in the sweep tier too', () => {
  // Kills: a sweep tier that only sees `body.runId` written out longhand. The
  // idiomatic `const { runId } = body` bound NOTHING before this (findBinding
  // knew `const x =` and destructured for-of, not destructured declarations),
  // so the name read as an unresolved caller param and fell through to the
  // curated bare list — which the sweep model deliberately empties. Result: the
  // most common JS idiom walked straight past the tier that exists to make the
  // gate name-blind. Nested and array patterns had the same hole, and nested
  // evaded BOTH tiers.
  const shapes = {
    'plain destructure': 'export function h(body) {\n  const { runId } = body;\n  return readFileSync(join(LOGS, runId, "e.jsonl"), "utf8");\n}',
    'nested destructure': 'export function h(body) {\n  const { target: { ref } } = body;\n  return readFileSync(join(LOGS, ref, "e.jsonl"), "utf8");\n}',
    'array destructure': 'export function h(req) {\n  const [, id] = req.url.split(SEP);\n  return readFileSync(join(LOGS, id), "utf8");\n}',
  };
  // The PRODUCTION model object, not a copy — a pin that rebuilds the thing it
  // tests cannot see that thing change.
  const sweepModel = (lint as { SWEEP_MODEL?: unknown }).SWEEP_MODEL;
  assert.ok(sweepModel, 'the sweep model must be exported so this pin drives the real one');
  for (const [name, text] of Object.entries(shapes)) {
    assert.equal(analyzeModule(text, 'cli/ui-bridge.ts').length, 1, `${name}: the declared surface must fire`);
    assert.equal(analyzeModule(text, 'orchestrator/x.ts', sweepModel).length, 1, `${name}: the SWEEP must fire (member taint, no bare-id fallback)`);
  }
  // No over-fire: a destructure off a TRUSTED root stays clean in both models
  // (binding-wins classifies by the RHS, it does not taint every destructure).
  const trusted = 'export function h() {\n  const { logsRoot } = ctx;\n  return readFileSync(join(logsRoot, "x"), "utf8");\n}';
  assert.deepEqual(analyzeModule(trusted, 'cli/ui-bridge.ts'), []);
  assert.deepEqual(analyzeModule(trusted, 'orchestrator/x.ts', sweepModel), []);
});

test('G9 (RED at the first W8-F5 cure, found by adversarial review): a reachable DELEGATE HELPER that takes a request id by plain parameter is scanned', () => {
  // Kills: a sweep tier restricted to HTTP MEMBERS only. A route that extracts
  // `sessionId` itself and hands it to a helper by parameter reproduces the C4
  // defect one abstraction level down — the helper's own file text contains no
  // `body.`/`params.` member at all, so a member-only sweep sees nothing while
  // the sink reads `join(LOGS_ROOT, sessionId, 'e.jsonl')` unguarded.
  const root = scratchRoot({
    'cli/ui-bridge.ts': [
      "import { handleSessionRead } from './session-file-routes.ts';",
      'export function router() { return handleSessionRead; }',
      '',
    ].join('\n'),
    'cli/session-file-routes.ts': [
      'import { readFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'const LOGS_ROOT = "/x";',
      'export function handleSessionRead(sessionId: string) {',
      '  return readFileSync(join(LOGS_ROOT, sessionId, "e.jsonl"), "utf8");',
      '}',
      '',
    ].join('\n'),
  });
  const r = runLint({ root, allowlist: [] });
  assert.deepEqual(
    r.findings.map((f) => `${f.file}:${f.sink}`),
    ['cli/session-file-routes.ts:readFileSync'],
    `the delegate helper's unguarded sink must fire; got ${JSON.stringify(r.findings)}`,
  );
});

test('G10 (CALIBRATION): the sweep\'s bare-id list is the measured six — the four expensive names stay tier-1-only and are named in the header', () => {
  // Kills: a future widening that quietly turns the sweep into the full model
  // (measured: +24 cycleId, +17 initiativeId, +4 repoPath, +3 runId findings,
  // all server-built ids in engine modules) or that quietly narrows it back to
  // members-only (which is what G9 caught).
  const model = (lint as { SWEEP_MODEL?: { bareTaint: Set<string> } }).SWEEP_MODEL;
  assert.ok(model, 'SWEEP_MODEL must be exported');
  assert.deepEqual(
    [...model.bareTaint].sort(),
    ['projectId', 'project_repo_path', 'rawUrl', 'sessionId', 'slug', 'url'],
    'the sweep bare-id set is a measured calibration, not an accident — change it only with fresh numbers in the header',
  );
  for (const excluded of ['cycleId', 'initiativeId', 'repoPath', 'runId']) {
    assert.ok(REQUEST_TAINT_BARE.has(excluded), `${excluded} must still be a tier-1 taint source`);
    assert.ok(!model.bareTaint.has(excluded), `${excluded} is deliberately tier-1-only (see the header's disclosed limits)`);
  }
});
