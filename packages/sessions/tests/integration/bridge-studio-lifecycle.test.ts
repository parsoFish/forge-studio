/**
 * W7-A2 — session lifecycle acceptance + unit tests (pinned BEFORE the
 * implementation; RED at branch base).
 *
 * Findings closed here: home-sessions-04/05/08/09/10/11/21/22 (bridge half),
 * sessions-kinds-10/11/15/16/20/24/33, community-02/06/15/20, knowledge-16/
 * 17/18/27, flows-28 (session half).
 *
 * The on-disk shapes are the operator's REAL stuck sessions, copied
 * verbatim (status.json + `_logs/_<kind>-<sid>/stderr.log`):
 *   - kb-cleanup 2026-08-18T12-36-59-1b8305ab (.kb-cycles) — phase
 *     `drafting`, stderr.log = InteractiveRunnerError (writes: [plan] …)
 *   - kb-cleanup 2026-08-14T15-07-02-f357b6df (.kb-cycles) — same shape
 * All three were `needsYou:true` on /sessions with a calm "No operator
 * action available" page and no cancel anywhere. (HISTORY, W8-B5b: the
 * third real incident here was a community-refresh session at
 * 2026-08-18T12-54-32-abdfd26b, phase `gathering`, writes: [staging]
 * produced no files. The community-refresh session kind retired with
 * mechanism A — W8-B5's deterministic `forge community refresh` replaced
 * it. The fixture below is now a SYNTHETIC authoring-kind stand-in
 * preserving the exact same crash-detection coverage shape — a turnSpec
 * kind with a distinct `writes: [staging]` InteractiveRunnerError and no
 * live-KB requirement — not a copy of a real operator session.)
 *
 * Test shape mirrors apps/forge/ui-bridge-sessions-index.test.ts: a real bridge
 * (startBridge) + fetch for the acceptance level, plus direct import of the
 * pure derivation for the unit matrix. The REAL studio/session-kinds.yaml is
 * copied into the fixture root so the real kinds/tables are exercised (the
 * bridge only loads it structurally — no agent-ref resolution at load time).
 *
 * RUN: node --test --experimental-strip-types packages/sessions/bridge-studio-lifecycle.test.ts
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, copyFileSync, utimesSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { startBridge } from '../../../../apps/forge/ui-bridge.ts';
// SessionIndexRow carved with the session index (M4 routes carve) — it is this
// package's own type now, so the test stops reaching into the host for it.
import type { SessionIndexRow } from '../../bridge-studio-session-index.ts';
import {
  deriveSessionLifecycle,
  extractErrorMessage,
  stallCeilingForKind,
  isTurnAlive,
  DEFAULT_STALL_CEILING_MS,
  type SessionLifecycleInputs,
} from '../../bridge-studio-lifecycle.ts';
import { CANCELLED_PHASE } from '../../session-status-io.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

// ---------------------------------------------------------------------------
// The operator's real stderr text (verbatim from _logs/_kb-cleanup-2026-08-18T12-36-59-1b8305ab/stderr.log)
// ---------------------------------------------------------------------------
const KB_CLEANUP_STDERR = [
  'InteractiveRunnerError: runInteractiveTurn: session kind "kb-cleanup" phase "drafting" declares writes: [plan], but the turn produced no files there — refusing to advance the session with an empty package rather than persisting a ghost turn to status.json.',
  '    at runAgentStyleStep (file:///home/parso/forge/packages/sessions/interactive-runner.ts:493:11)',
  '    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)',
  '    at async runInteractiveTurn (file:///home/parso/forge/packages/sessions/interactive-runner.ts:328:16)',
  '    at async runTurnSpecAgent (file:///home/parso/forge/packages/agents/agent-run.ts:571:18)',
  '    at async cmdAgentRun (file:///home/parso/forge/packages/agents/agent-run.ts:601:14)',
  '    at async cmdAgent (file:///home/parso/forge/packages/agents/agent-run.ts:137:29)',
  '    at async file:///home/parso/forge/apps/forge/cli.ts:101:14',
  '',
].join('\n');
// W8-B5b — the community-refresh kind retired; this is a SYNTHETIC
// authoring-kind stderr, preserving the same "turnSpec kind, distinct
// writes: [...]" crash-detection shape the real community-refresh incident
// used to exercise (see this file's header note).
const AUTHORING_AGENT_STDERR = KB_CLEANUP_STDERR.replace('kind "kb-cleanup" phase "drafting" declares writes: [plan]', 'kind "authoring" phase "analyzing" declares writes: [staging]');

// ---------------------------------------------------------------------------
// Unit matrix — deriveSessionLifecycle is pure
// ---------------------------------------------------------------------------

const NOW = Date.parse('2026-08-19T00:00:00.000Z');
const MIN = 60_000;

function inputs(over: Partial<SessionLifecycleInputs> = {}): SessionLifecycleInputs {
  return {
    terminal: false,
    awaits: null,
    working: true,
    statusMtimeMs: NOW - 10 * MIN,
    stderr: null,
    lastActivityMs: NOW - 5_000,
    turnAlive: false,
    hasChannel: true,
    nowMs: NOW,
    stallCeilingMs: DEFAULT_STALL_CEILING_MS,
    ...over,
  };
}

test('lifecycle unit: terminal wins over everything — state terminal, needsYou false, not cancellable, error null (even with a stale stderr present)', () => {
  const l = deriveSessionLifecycle(inputs({ terminal: true, stderr: { text: KB_CLEANUP_STDERR, mtimeMs: NOW }, awaits: 'verdict' }));
  assert.equal(l.state, 'terminal');
  assert.equal(l.needsYou, false);
  assert.equal(l.cancellable, false);
  assert.equal(l.error, null);
});

test('lifecycle unit: the operator\'s crashed kb-cleanup shape — working phase, non-empty stderr NEWER than status.json, no live turn ⇒ crashed + needsYou + the error message (not the stack)', () => {
  const l = deriveSessionLifecycle(inputs({
    statusMtimeMs: NOW - 2 * MIN,
    stderr: { text: KB_CLEANUP_STDERR, mtimeMs: NOW - MIN },
    lastActivityMs: NOW - MIN,
  }));
  assert.equal(l.state, 'crashed');
  assert.equal(l.needsYou, true);
  assert.equal(l.cancellable, true);
  assert.ok(l.error !== null && l.error.startsWith('InteractiveRunnerError: runInteractiveTurn: session kind "kb-cleanup" phase "drafting" declares writes: [plan]'), `error must be the message line, got ${l.error}`);
  assert.ok(!l.error!.includes('    at '), 'stack frames must not leak into the error text');
});

test('lifecycle unit: stderr OLDER than status.json (a prior crash, then a later successful phase write) is NOT a crash — derive from the newest fact, never a stale copy', () => {
  const l = deriveSessionLifecycle(inputs({
    statusMtimeMs: NOW - MIN,
    stderr: { text: KB_CLEANUP_STDERR, mtimeMs: NOW - 5 * MIN },
    lastActivityMs: NOW - 5_000,
  }));
  assert.equal(l.state, 'working');
  assert.equal(l.needsYou, false);
  assert.equal(l.error, null);
});

test('lifecycle unit: a LIVE tracked turn (turnAlive) with old stderr present is working, not crashed — the re-run case', () => {
  const l = deriveSessionLifecycle(inputs({
    statusMtimeMs: NOW - 10 * MIN,
    stderr: { text: KB_CLEANUP_STDERR, mtimeMs: NOW - MIN },
    turnAlive: true,
  }));
  assert.equal(l.state, 'working');
  assert.equal(l.needsYou, false);
});

test('lifecycle unit: an operator gate (awaits questions|verdict) ⇒ awaiting-operator, needsYou true — the architect awaiting-verdict shape that used to read needsYou=false', () => {
  for (const awaits of ['questions', 'verdict'] as const) {
    const l = deriveSessionLifecycle(inputs({ awaits, working: false }));
    assert.equal(l.state, 'awaiting-operator', awaits);
    assert.equal(l.needsYou, true, awaits);
    assert.equal(l.error, null);
    assert.equal(l.cancellable, true);
  }
});

test('lifecycle unit: an operator gate that ALSO has a stale crash log — crash wins (the operator must see the failure, the gate is moot)', () => {
  const l = deriveSessionLifecycle(inputs({ awaits: 'verdict', working: false, statusMtimeMs: NOW - 2 * MIN, stderr: { text: KB_CLEANUP_STDERR, mtimeMs: NOW - MIN } }));
  assert.equal(l.state, 'crashed');
});

test('lifecycle unit: a working phase silent past the stall ceiling ⇒ stalled + needsYou; inside the ceiling ⇒ working, needsYou false', () => {
  const stalled = deriveSessionLifecycle(inputs({ lastActivityMs: NOW - DEFAULT_STALL_CEILING_MS - 1 }));
  assert.equal(stalled.state, 'stalled');
  assert.equal(stalled.needsYou, true);
  assert.equal(stalled.idleMs, DEFAULT_STALL_CEILING_MS + 1);
  const working = deriveSessionLifecycle(inputs({ lastActivityMs: NOW - DEFAULT_STALL_CEILING_MS + 1 }));
  assert.equal(working.state, 'working');
  assert.equal(working.needsYou, false);
});

test('lifecycle unit: NO liveness signal at all (lastActivityMs null — the session has no log dir) is NEVER stalled, however old status.json is — honest "unknown", not a guess', () => {
  const l = deriveSessionLifecycle(inputs({ lastActivityMs: null, statusMtimeMs: NOW - 400 * MIN }));
  assert.equal(l.state, 'working');
  assert.equal(l.needsYou, false);
  assert.equal(l.idleMs, null);
});

test('lifecycle unit: an operator gate is never stalled — waiting on the operator is not the agent being silent', () => {
  const l = deriveSessionLifecycle(inputs({ awaits: 'verdict', working: false, lastActivityMs: NOW - 400 * MIN }));
  assert.equal(l.state, 'awaiting-operator');
});

test('lifecycle unit: extractErrorMessage picks the last non-stack line, trimmed and capped', () => {
  assert.equal(extractErrorMessage('Error: boom\n    at x (y:1:1)\n    at z\n'), 'Error: boom');
  assert.equal(extractErrorMessage('warn line\nError: second\n    at frame\n'), 'Error: second');
  const long = 'E'.repeat(700);
  assert.equal(extractErrorMessage(long).length, 601, 'capped at 600 + ellipsis');
});

test('lifecycle unit: isTurnAlive fails CLOSED — the bridge\'s own pid is never "ours", and a session id that is only a SUBSTRING of an argv element (not a whole element) does not match', async () => {
  // Our own process: alive, but never a turn we may signal, whatever its argv holds.
  const ownArg = process.argv[process.argv.length - 1];
  assert.equal(isTurnAlive(process.pid, ownArg), false);
  // A live child whose argv element is `setTimeout(() => {}, 120000)`: the
  // session id "setTimeout" is a substring of it, not a whole element.
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)', 'whole-element-sid'], { detached: true, stdio: 'ignore' });
  child.unref();
  try {
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(isTurnAlive(child.pid!, 'setTimeout'), false, 'substring of an argv element must not count as ownership');
    assert.equal(isTurnAlive(child.pid!, 'whole-element-sid'), true, 'positive control: the whole-element session id matches');
  } finally {
    try { process.kill(child.pid!, 'SIGKILL'); } catch { /* ignore */ }
  }
});

test('lifecycle unit: stallCeilingForKind — architect matches the UI\'s 120s STALE_THRESHOLD_MS, unknown kinds get the default', () => {
  assert.equal(stallCeilingForKind('architect'), 120_000);
  assert.equal(stallCeilingForKind('kb-cleanup'), DEFAULT_STALL_CEILING_MS);
  assert.equal(stallCeilingForKind('never-heard-of-it'), DEFAULT_STALL_CEILING_MS);
});

// ---- W7-FIX-A2 (W7A2-01): pid tracking for the dispatch-spawned kinds ------
// Onboarding's turn is spawned by `spawnAgentDispatch` (not `spawnAgentTurn`)
// and used to leave NO turn.pid, so `killTrackedTurn` returned false
// unconditionally and cancel never killed anything. The fix records the pid
// under the SAME `_logs/_<kind>-<sid>/turn.pid` the lifecycle reads, and
// `isTurnAlive` recognises the dispatch's own ownership mark — its
// `--session-dir <…/_<kind>/<sid>>` argv element (basename === sid) — with
// the same whole-element, fail-closed posture. A tracked-but-channel-less
// live turn (turn.pid only, no heartbeat/events file — the dispatch writes
// its events under `_logs/<runId>/`) is `working`, never `stalled`: there
// is no liveness channel to be silent on. A DEAD pid silent past the
// ceiling still reads stalled (unchanged).

test('lifecycle unit (W7-FIX-A2): a LIVE tracked turn with NO liveness channel (turn.pid only) is working even past the ceiling; the same silence with a channel present IS stalled; a dead pid silent past the ceiling is stalled', () => {
  const silent = NOW - DEFAULT_STALL_CEILING_MS - 60_000;
  const livePidNoChannel = deriveSessionLifecycle(inputs({ lastActivityMs: silent, turnAlive: true, hasChannel: false }));
  assert.equal(livePidNoChannel.state, 'working', 'a live pid with nothing to be silent on is not stalled');
  assert.equal(livePidNoChannel.needsYou, false);
  const livePidWithChannel = deriveSessionLifecycle(inputs({ lastActivityMs: silent, turnAlive: true, hasChannel: true }));
  assert.equal(livePidWithChannel.state, 'stalled', 'a live turn whose heartbeat/events channel went silent past the ceiling IS stalled (the hung-SDK shape)');
  const deadPid = deriveSessionLifecycle(inputs({ lastActivityMs: silent, turnAlive: false, hasChannel: false }));
  assert.equal(deadPid.state, 'stalled', 'a dead/absent pid silent past the ceiling is stalled — unchanged');
});

test('lifecycle unit (W7-FIX-A2): isTurnAlive recognises the dispatch runner\'s `--session-dir <…/_<kind>/<sid>>` argv element (basename === sid) — and STILL fails closed on a substring-only or wrong-basename path', async () => {
  const sid = '2026-08-19T09-00-00';
  const child = spawn(
    process.execPath,
    ['-e', 'setTimeout(() => {}, 120000)', '--', '--session-dir', `/tmp/whatever/projects/p/_onboarding/${sid}`],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
  try {
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(isTurnAlive(child.pid!, sid), true, 'the --session-dir basename IS this session\'s ownership mark');
    assert.equal(isTurnAlive(child.pid!, '2026-08-19T09-00'), false, 'a prefix of the basename must not match');
    assert.equal(isTurnAlive(child.pid!, '_onboarding'), false, 'an intermediate path segment is not the session id');
    assert.equal(isTurnAlive(child.pid!, 'p'), false, 'nor is the project segment');
  } finally {
    try { process.kill(child.pid!, 'SIGKILL'); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// Acceptance — real bridge + fetch over the operator's on-disk shapes
// ---------------------------------------------------------------------------

let forgeRoot: string;
let projectsRoot: string;
let logsRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

const CRASHED_KB_SID = '2026-08-18T12-36-59-1b8305ab';
const CRASHED_KB_SID_2 = '2026-08-14T15-07-02-f357b6df';
// W8-B5b — synthetic (see this file's header note); the real community-refresh
// incident this session id used to name is gone with the retired kind.
const CRASHED_AUTHORING_SID = '2026-08-18T12-54-32-synthetic1';
const ARCHITECT_VERDICT_SID = '2026-08-01T10-00-00';
const STALLED_KB_SID = '2026-08-05T14-00-00';
const DEMO_WORKING_SID = '2026-08-03T12-00-00';
const INSTR_VERDICT_SID = '2026-08-02T11-00-00';
const INSTR_TERMINAL_SID = '2026-08-02T11-05-00';
const INSTR_CRASHED_SID = '2026-08-02T11-20-00';
const RERUN_KB_SID = '2026-08-05T14-30-00';
const AMBIGUOUS_SID = '2026-08-09T09-00-00';
const KILL_SID = '2026-08-10T10-00-00';
const CANCEL_TERMINAL_SID = '2026-08-11T11-00-00';
const ONBOARDING_KILL_SID = '2026-08-12T08-00-00';

function writeStatus(dir: string, status: Record<string, unknown>, mtimeMs?: number): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify(status, null, 2), 'utf8');
  if (mtimeMs !== undefined) utimesSync(join(dir, 'status.json'), mtimeMs / 1000, mtimeMs / 1000);
}

function writeLog(kind: string, sid: string, files: Record<string, string>, mtimeMs?: number): string {
  const dir = join(logsRoot, `_${kind}-${sid}`);
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), body, 'utf8');
    if (mtimeMs !== undefined) utimesSync(join(dir, name), mtimeMs / 1000, mtimeMs / 1000);
  }
  return dir;
}

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

/** Read the body ONCE: assert the status (with the body text as the failure
 *  message) and return the parsed JSON. */
async function expectJson<T>(res: Response, status: number): Promise<T> {
  const text = await res.text();
  assert.equal(res.status, status, `expected HTTP ${status}, got ${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function indexRows(activeOnly = false): Promise<SessionIndexRow[]> {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions${activeOnly ? '?active=1' : ''}`);
  assert.equal(res.status, 200);
  return ((await res.json()) as { sessions: SessionIndexRow[] }).sessions;
}

function row(rows: SessionIndexRow[], kind: string, sid: string): SessionIndexRow {
  const r = rows.find((x) => x.kind === kind && x.sessionId === sid);
  assert.ok(r, `expected an index row for ${kind}/${sid}; got ${rows.map((x) => `${x.kind}/${x.sessionId}`).join(', ')}`);
  return r!;
}

let killChildPid: number | null = null;
let onboardingChildPid: number | null = null;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-lifecycle-'));
  projectsRoot = join(forgeRoot, 'projects');
  logsRoot = join(forgeRoot, '_logs');
  for (const state of ['in-flight', 'done', 'failed', 'pending']) mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  mkdirSync(logsRoot, { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'flows'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'catalog.yaml'), ['sdks: []', 'models: []', 'tools: []', 'mcps: []', 'guards: []', 'community-skills: []', ''].join('\n'));
  // The REAL registry — real kinds, real phase tables.
  copyFileSync(join(REPO_ROOT, 'studio', 'session-kinds.yaml'), join(forgeRoot, 'studio', 'session-kinds.yaml'));

  // W8-B5b — the `cycles` KB descriptor the kb-cleanup fixture below needs.
  // The kb-cleanup session-DETAIL route computes real cleanup findings, and
  // `computeAgentCleanupFindings` THROWS by design ("fail loud, never a silent
  // empty findings array for an unresolvable KB") when the kb id resolves to no
  // brain directory. Before this, the fixture seeded a session whose `kb_id`
  // pointed at nothing, so the detail GET answered 409 — which never showed up
  // while the dot-anchor assertion ran against community-refresh's own anchor
  // (a kind whose detail route computes nothing). Seeding the real descriptor
  // shape is the honest fix: the fixture now describes a KB that exists.
  mkdirSync(join(forgeRoot, 'brain', 'cycles', 'themes'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'brain', 'cycles', 'kb.yaml'),
    ['id: cycles', 'name: Cycle Patterns', 'desc: Fixture KB for the lifecycle suite.', 'backend: filesystem', 'origin: seed', ''].join('\n'),
  );

  const now = Date.now();
  const T = { statusOld: now - 10 * MIN, crash: now - 8 * MIN, recent: now - 5_000, stale: now - 30 * MIN };

  // --- the operator's three crashed sessions (dot-anchor projects) --------
  writeStatus(join(projectsRoot, '.kb-cycles', '_kb-cleanup', CRASHED_KB_SID), {
    session_id: CRASHED_KB_SID, project: '.kb-cycles', phase: 'drafting', kb_id: 'cycles', findings: [], modelTier: 'sonnet',
  }, T.statusOld);
  writeLog('kb-cleanup', CRASHED_KB_SID, { 'events.jsonl': '{"event_type":"start"}\n', '.heartbeat': new Date(T.crash).toISOString(), 'stderr.log': KB_CLEANUP_STDERR }, T.crash);
  writeStatus(join(projectsRoot, '.kb-cycles', '_kb-cleanup', CRASHED_KB_SID_2), {
    session_id: CRASHED_KB_SID_2, project: '.kb-cycles', phase: 'drafting', kb_id: 'cycles', findings: [],
  }, T.statusOld);
  writeLog('kb-cleanup', CRASHED_KB_SID_2, { 'events.jsonl': '{"event_type":"start"}\n', 'stderr.log': KB_CLEANUP_STDERR }, T.crash);
  // W8-B5b — synthetic authoring stand-in for the retired community-refresh
  // fixture (see this file's header note): a real project (authoring has no
  // dot-anchor/pseudo-project shape), analyzing phase, writes: [staging] —
  // same crash-detection coverage shape as the incident it replaces.
  writeStatus(join(projectsRoot, 'proja', '_authoring', CRASHED_AUTHORING_SID), {
    session_id: CRASHED_AUTHORING_SID, project: 'proja', phase: 'analyzing', modelTier: 'opus', updated_at: '2026-08-18T12:54:32.132Z',
  }, T.statusOld);
  writeLog('authoring', CRASHED_AUTHORING_SID, { 'events.jsonl': '{"event_type":"start"}\n', '.heartbeat': 'x', 'stderr.log': AUTHORING_AGENT_STDERR }, T.crash);

  // --- architect at awaiting-verdict: an operator gate the OLD needsYou never flagged
  writeStatus(join(projectsRoot, 'proja', '_architect', ARCHITECT_VERDICT_SID), {
    session_id: ARCHITECT_VERDICT_SID, project: 'proja', phase: 'awaiting-verdict', updated_at: '2026-08-01T10:00:00.000Z',
  });
  writeFileSync(join(projectsRoot, 'proja', '_architect', ARCHITECT_VERDICT_SID, 'idea.md'), 'An idea.\n');

  // --- kb-cleanup drafting, live log dir, EMPTY stderr, silent 30 min ⇒ stalled
  writeStatus(join(projectsRoot, 'projc', '_kb-cleanup', STALLED_KB_SID), {
    session_id: STALLED_KB_SID, project: 'projc', phase: 'drafting', kb_id: 'k', findings: [],
  }, T.stale);
  writeLog('kb-cleanup', STALLED_KB_SID, { 'events.jsonl': '{"event_type":"start"}\n', '.heartbeat': 'x', 'stderr.log': '' }, T.stale);

  // --- kb-cleanup drafting, OLD stderr, then a fresh heartbeat/status (re-run) ⇒ working
  writeStatus(join(projectsRoot, 'projc', '_kb-cleanup', RERUN_KB_SID), {
    session_id: RERUN_KB_SID, project: 'projc', phase: 'drafting', kb_id: 'k', findings: [],
  }, T.recent);
  const rerunDir = writeLog('kb-cleanup', RERUN_KB_SID, { 'stderr.log': KB_CLEANUP_STDERR }, T.crash);
  writeFileSync(join(rerunDir, '.heartbeat'), 'x');

  // --- demo generating with NO log dir: the OLD needsYou said true (staged-review/next-turn), truth is working/false
  writeStatus(join(projectsRoot, 'projb', '_demo', DEMO_WORKING_SID), {
    session_id: DEMO_WORKING_SID, project: 'projb', phase: 'generating', updated_at: '2026-08-03T12:00:00.000Z', iteration: 0,
  });

  // --- instructions: verdict gate (positive control), terminal, crashed-at-drafting
  const instr = (sid: string, phase: string, extra: Record<string, unknown> = {}) => {
    const dir = join(projectsRoot, 'proja', '_instructions', sid);
    writeStatus(dir, { session_id: sid, project: 'proja', phase, updated_at: '2026-08-02T11:00:00.000Z', ...extra }, T.statusOld);
    writeFileSync(join(dir, 'prompt.md'), 'Author AGENTS.md.\n');
  };
  instr(INSTR_VERDICT_SID, 'awaiting-verdict');
  instr(INSTR_TERMINAL_SID, 'committed');
  instr(INSTR_CRASHED_SID, 'drafting');
  writeLog('instructions', INSTR_CRASHED_SID, { 'events.jsonl': '{"event_type":"start"}\n', 'stderr.log': 'TypeError: Cannot read properties of undefined (reading "toFixed")\n    at runDraftStep (file:///x/instructions-runner.ts:400:1)\n' }, T.crash);
  instr(CANCEL_TERMINAL_SID, 'rejected');

  // --- the SAME session id under two projects (deep-link ambiguity probe)
  writeStatus(join(projectsRoot, 'proja', '_demo', AMBIGUOUS_SID), { session_id: AMBIGUOUS_SID, project: 'proja', phase: 'briefing', updated_at: 'x' });
  writeStatus(join(projectsRoot, 'projb', '_demo', AMBIGUOUS_SID), { session_id: AMBIGUOUS_SID, project: 'projb', phase: 'briefing', updated_at: 'x' });

  // --- a session with a LIVE tracked turn process (kill test): a real
  // detached child whose argv carries the session id (what isTurnAlive's
  // ownership check reads from /proc/<pid>/cmdline).
  writeStatus(join(projectsRoot, 'projb', '_demo', KILL_SID), { session_id: KILL_SID, project: 'projb', phase: 'generating', updated_at: 'x' });
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)', KILL_SID], { detached: true, stdio: 'ignore' });
  child.unref();
  killChildPid = child.pid ?? null;
  writeLog('demo', KILL_SID, { 'events.jsonl': '{"event_type":"start"}\n', '.heartbeat': 'x', 'stderr.log': '', 'turn.pid': `${killChildPid}\n` });

  // --- W7-FIX-A2: an ONBOARDING session at `running` (step: agent) with a
  // live DISPATCH-shaped child (argv carries `--session-dir <…/_onboarding/
  // <sid>>`, exactly what spawnAgentDispatch passes), tracked ONLY by
  // turn.pid (the dispatch's events/stderr live under `_logs/<runId>/`, so
  // this session log dir has no heartbeat/events channel), status.json OLD
  // (30 min > the 180 s ceiling): must read working, not stalled — and cancel
  // must kill it.
  const onbSessionDir = join(projectsRoot, 'projb', '_onboarding', ONBOARDING_KILL_SID);
  writeStatus(onbSessionDir, { phase: 'running', project: 'projb', runId: '_agent-onboarding-agent-2026-08-12T08-00-00-000', startedAt: '2026-08-12T08:00:00.000Z' }, T.stale);
  const onbChild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)', '--', '--session-dir', onbSessionDir], { detached: true, stdio: 'ignore' });
  onbChild.unref();
  onboardingChildPid = onbChild.pid ?? null;
  writeLog('onboarding', ONBOARDING_KILL_SID, { 'turn.pid': `${onboardingChildPid}\n` }, T.stale);

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  await closeBridge();
  if (killChildPid !== null) { try { process.kill(killChildPid, 'SIGKILL'); } catch { /* already dead */ } }
  if (onboardingChildPid !== null) { try { process.kill(onboardingChildPid, 'SIGKILL'); } catch { /* already dead */ } }
  rmSync(forgeRoot, { recursive: true, force: true });
});

// ---- index: state + needsYou truthful in both directions -------------------

test('index: three crashed sessions (two real operator incidents, one synthetic — see header note) read state=crashed, needsYou=true, error = the InteractiveRunnerError message — the crash is no longer invisible', async () => {
  const rows = await indexRows();
  for (const [kind, sid, needle] of [
    ['kb-cleanup', CRASHED_KB_SID, 'declares writes: [plan]'],
    ['kb-cleanup', CRASHED_KB_SID_2, 'declares writes: [plan]'],
    ['authoring', CRASHED_AUTHORING_SID, 'declares writes: [staging]'],
  ] as const) {
    const r = row(rows, kind, sid);
    assert.equal(r.state, 'crashed', `${kind}/${sid}`);
    assert.equal(r.needsYou, true, `${kind}/${sid}`);
    assert.equal(r.terminal, false);
    assert.ok(typeof r.error === 'string' && r.error.includes(needle), `${kind}/${sid} error must carry the runner's own message, got ${r.error}`);
    assert.ok(!r.error!.includes('    at '), 'no stack frames on the wire');
  }
});

test('index: architect awaiting-verdict is awaiting-operator with needsYou=true (was ALWAYS false — no panel table), and instructions awaiting-verdict stays true', async () => {
  const rows = await indexRows();
  const a = row(rows, 'architect', ARCHITECT_VERDICT_SID);
  assert.equal(a.state, 'awaiting-operator');
  assert.equal(a.needsYou, true);
  assert.equal(a.error, null);
  const i = row(rows, 'instructions', INSTR_VERDICT_SID);
  assert.equal(i.state, 'awaiting-operator');
  assert.equal(i.needsYou, true);
});

test('index: demo generating (agent working, no liveness signal) is working with needsYou=FALSE — staged-review/next-turn no longer count as "needs you"', async () => {
  const r = row(await indexRows(), 'demo', DEMO_WORKING_SID);
  assert.equal(r.state, 'working');
  assert.equal(r.needsYou, false);
  assert.equal(r.idleMs, null, 'no log dir ⇒ no liveness signal ⇒ idleMs null');
});

test('index: a working kb-cleanup silent 30 minutes with an EMPTY stderr is stalled (needsYou true, error null); the re-run shape (old stderr, fresh heartbeat) is working', async () => {
  const rows = await indexRows();
  const s = row(rows, 'kb-cleanup', STALLED_KB_SID);
  assert.equal(s.state, 'stalled');
  assert.equal(s.needsYou, true);
  assert.equal(s.error, null);
  assert.ok(typeof s.idleMs === 'number' && s.idleMs > 20 * MIN, `idleMs must reflect the 30-minute silence, got ${s.idleMs}`);
  const w = row(rows, 'kb-cleanup', RERUN_KB_SID);
  assert.equal(w.state, 'working');
  assert.equal(w.needsYou, false);
});

test('index: a terminal session reads state=terminal, needsYou=false', async () => {
  const r = row(await indexRows(), 'instructions', INSTR_TERMINAL_SID);
  assert.equal(r.state, 'terminal');
  assert.equal(r.terminal, true);
  assert.equal(r.needsYou, false);
});

test('index: every row carries the three new fields (state/error/idleMs) — no row omits them', async () => {
  for (const r of await indexRows()) {
    assert.ok(['working', 'awaiting-operator', 'crashed', 'stalled', 'terminal'].includes(r.state), `${r.kind}/${r.sessionId} state=${r.state}`);
    assert.ok('error' in r && 'idleMs' in r, `${r.kind}/${r.sessionId} must carry error + idleMs keys`);
  }
});

// ---- shell payload: lifecycle + deep links without ?project= ---------------

test('W8-B3 shell (ON-5): the payload carries `transcriptSources` — the candidate sources that ACTUALLY EXIST in each session dir, derived by the same reads that built `turns`, never a per-kind boolean proxy', async () => {
  // SUPERSEDES W7A2-04's `transcript: descriptor.turnSpec === undefined`
  // assertion. That proxy was a stored per-kind guess, and it was WRONG for
  // `authoring`: authoring declares a turnSpec, yet its start route
  // (`writeAuthoringSession`, apps/forge/ui-bridge.ts) writes prompt.md before the
  // generic spine ever runs — so the wire claimed "records no turns" for a
  // kind that has one from second zero. What ships is the derived fact.
  //
  // The CRASHED_AUTHORING_SID fixture (synthetic — see header note) is a
  // turnSpec kind whose shell resolves without a live KB (kb-cleanup's shell
  // 409s on an unresolvable kb_id by design — R4-19-F2), and its session dir
  // was seeded with only status.json (no prompt.md), so nothing was found.
  const cr = await expectJson<{ transcriptSources: unknown }>(await fetch(`${bridgeUrl}/api/studio/sessions/authoring/${CRASHED_AUTHORING_SID}?project=proja`), 200);
  assert.deepEqual(cr.transcriptSources, [], 'no candidate source is on disk for this session — the honest empty list');
  // The instructions fixture writes a real prompt.md; the architect fixture a
  // real idea.md. Both are asserted by NAME, so a change that started
  // reporting the whole scanned list (or a hardcoded per-kind answer) fails.
  const instr = await expectJson<{ transcriptSources: unknown }>(await fetch(`${bridgeUrl}/api/studio/sessions/instructions/${INSTR_VERDICT_SID}?project=proja`), 200);
  assert.deepEqual(instr.transcriptSources, ['prompt.md']);
  const arch = await expectJson<{ transcriptSources: unknown }>(await fetch(`${bridgeUrl}/api/studio/sessions/architect/${ARCHITECT_VERDICT_SID}?project=proja`), 200);
  assert.deepEqual(arch.transcriptSources, ['idea.md']);
});

test('shell: GET /api/studio/sessions/:kind/:sid WITHOUT ?project= resolves the anchor project (a dot-anchor too) and carries lifecycle', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/instructions/${INSTR_CRASHED_SID}`);
  const body = await expectJson<{ project: string; lifecycle: { state: string; needsYou: boolean; error: string | null; cancellable: boolean } }>(res, 200);
  assert.equal(body.project, 'proja');
  assert.equal(body.lifecycle.state, 'crashed');
  assert.equal(body.lifecycle.needsYou, true);
  assert.equal(body.lifecycle.cancellable, true);
  assert.ok(body.lifecycle.error?.startsWith('TypeError: Cannot read properties of undefined'), body.lifecycle.error ?? 'null');

  // W8-B5b — the dot-anchor half of this assertion used to run against the
  // community-refresh fixture's own `.community-registry` anchor; that kind
  // retired with mechanism A (see header note). kb-cleanup's own
  // `.kb-cycles` anchor (CRASHED_KB_SID, seeded above) proves the SAME
  // dot-anchor resolution path.
  const kb = await fetch(`${bridgeUrl}/api/studio/sessions/kb-cleanup/${CRASHED_KB_SID}`);
  const kbBody = await expectJson<{ project: string; lifecycle: { state: string } }>(kb, 200);
  assert.equal(kbBody.project, '.kb-cycles');
  assert.equal(kbBody.lifecycle.state, 'crashed');
});

test('shell: an explicit ?project= still works and agrees with the resolved one; a terminal session\'s lifecycle is terminal/not cancellable', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/instructions/${INSTR_TERMINAL_SID}?project=proja`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { lifecycle: { state: string; cancellable: boolean; needsYou: boolean } };
  assert.equal(body.lifecycle.state, 'terminal');
  assert.equal(body.lifecycle.cancellable, false);
  assert.equal(body.lifecycle.needsYou, false);
});

test('shell: an unknown session id without ?project= is 404 (never a 400 "project required"); the SAME id under two projects is 409 asking for ?project=, and resolves with it', async () => {
  const missing = await fetch(`${bridgeUrl}/api/studio/sessions/demo/2099-01-01T00-00-00`);
  assert.equal(missing.status, 404);
  const ambiguous = await fetch(`${bridgeUrl}/api/studio/sessions/demo/${AMBIGUOUS_SID}`);
  assert.equal(ambiguous.status, 409);
  const ambBody = (await ambiguous.json()) as { error: string };
  assert.ok(/project/.test(ambBody.error), ambBody.error);
  const explicit = await fetch(`${bridgeUrl}/api/studio/sessions/demo/${AMBIGUOUS_SID}?project=projb`);
  assert.equal(explicit.status, 200);
});

// ---- events: an absent log dir is 200-empty, never a console 404 ------------

test('events: GET /api/events/_demo-<sid> for a session that never ran a turn is 200 {events: []} — not a 404 on the operator\'s first screen', async () => {
  const res = await fetch(`${bridgeUrl}/api/events/_demo-${DEMO_WORKING_SID}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { cycleId: string; events: unknown[] };
  assert.equal(body.cycleId, `_demo-${DEMO_WORKING_SID}`);
  assert.deepEqual(body.events, []);
});

test('events: a traversal cycleId is STILL rejected 4xx (the sec04 pin) — 200-empty is only for a guard-clean absent path', async () => {
  const res = await fetch(`${bridgeUrl}/api/events/..%2F..%2Fetc`);
  assert.ok(res.status >= 400 && res.status < 500, `got ${res.status}`);
});

// ---- cancel ----------------------------------------------------------------

test('cancel: POST without the CSRF header is 403 (the global guard covers the new write route)', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/demo/${DEMO_WORKING_SID}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
});

test('cancel: unknown kind is 404 naming the registry; unknown session is 404; a malformed sid is 400', async () => {
  const kind = await fetch(`${bridgeUrl}/api/studio/sessions/nope/${DEMO_WORKING_SID}/cancel`, { method: 'POST', headers: CSRF, body: '{}' });
  assert.equal(kind.status, 404);
  const sid = await fetch(`${bridgeUrl}/api/studio/sessions/demo/2099-01-01T00-00-00/cancel`, { method: 'POST', headers: CSRF, body: '{}' });
  assert.equal(sid.status, 404);
  const bad = await fetch(`${bridgeUrl}/api/studio/sessions/demo/${encodeURIComponent('../../etc')}/cancel`, { method: 'POST', headers: CSRF, body: '{}' });
  assert.ok(bad.status === 400 || bad.status === 404, `got ${bad.status}`);
});

test('cancel: a terminal session is 409 — never re-terminalised', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/instructions/${CANCEL_TERMINAL_SID}/cancel`, { method: 'POST', headers: CSRF, body: JSON.stringify({ project: 'proja' }) });
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error: string; phase: string };
  assert.equal(body.phase, 'rejected');
  const status = JSON.parse(readFileSync(join(projectsRoot, 'proja', '_instructions', CANCEL_TERMINAL_SID, 'status.json'), 'utf8')) as { phase: string };
  assert.equal(status.phase, 'rejected', 'status.json must be byte-unchanged on a refused cancel');
});

test('cancel: a working demo session (no live turn) → 200 phase=cancelled, previousPhase kept, killed=false; status.json rewritten; index reads terminal; ?active=1 drops it; a second cancel is 409', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/demo/${DEMO_WORKING_SID}/cancel`, { method: 'POST', headers: CSRF, body: JSON.stringify({ project: 'projb' }) });
  const body = await expectJson<{ ok: boolean; phase: string; previousPhase: string; killed: boolean; project: string }>(res, 200);
  assert.equal(body.ok, true);
  assert.equal(body.phase, CANCELLED_PHASE);
  assert.equal(body.previousPhase, 'generating');
  assert.equal(body.killed, false);
  assert.equal(body.project, 'projb');

  const status = JSON.parse(readFileSync(join(projectsRoot, 'projb', '_demo', DEMO_WORKING_SID, 'status.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(status.phase, CANCELLED_PHASE);
  assert.equal(status.cancelled_from, 'generating');
  assert.equal(typeof status.cancelled_at, 'string');
  assert.equal(status.session_id, DEMO_WORKING_SID, 'the rest of status.json is preserved');

  const all = row(await indexRows(), 'demo', DEMO_WORKING_SID);
  assert.equal(all.terminal, true);
  assert.equal(all.state, 'terminal');
  assert.equal(all.needsYou, false);
  assert.equal(all.phase, CANCELLED_PHASE);
  const active = await indexRows(true);
  assert.equal(active.find((r) => r.kind === 'demo' && r.sessionId === DEMO_WORKING_SID), undefined, '?active=1 must exclude a cancelled session');

  const again = await fetch(`${bridgeUrl}/api/studio/sessions/demo/${DEMO_WORKING_SID}/cancel`, { method: 'POST', headers: CSRF, body: JSON.stringify({ project: 'projb' }) });
  assert.equal(again.status, 409);

  // The generic affordance route must NOT have swallowed `cancel` as an
  // affordance id (it would 409 "not available … currently available: …").
  const shell = await fetch(`${bridgeUrl}/api/studio/sessions/demo/${DEMO_WORKING_SID}?project=projb`);
  assert.equal(shell.status, 200);
  const shellBody = (await shell.json()) as { phase: string; terminal: boolean; affordances: unknown[]; lifecycle: { state: string; cancellable: boolean } };
  assert.equal(shellBody.phase, CANCELLED_PHASE);
  assert.equal(shellBody.terminal, true, 'isTerminalPhase must treat the universal cancelled phase as terminal for EVERY kind');
  assert.deepEqual(shellBody.affordances, []);
  assert.equal(shellBody.lifecycle.cancellable, false);
});

test('cancel: body.project omitted → the anchor project is resolved server-side (the operator\'s .kb-cycles crash) → 200; the row is gone from ?active=1', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/kb-cleanup/${CRASHED_KB_SID}/cancel`, { method: 'POST', headers: CSRF, body: '{}' });
  const body = await expectJson<{ project: string; previousPhase: string }>(res, 200);
  assert.equal(body.project, '.kb-cycles');
  assert.equal(body.previousPhase, 'drafting');
  const active = await indexRows(true);
  assert.equal(active.find((r) => r.kind === 'kb-cleanup' && r.sessionId === CRASHED_KB_SID), undefined);
});

test('cancel: an ARCHITECT session (no panel/turnSpec — the "permanently bespoke" kind) cancels through the SAME generic route', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${ARCHITECT_VERDICT_SID}/cancel`, { method: 'POST', headers: CSRF, body: JSON.stringify({ project: 'proja' }) });
  await expectJson<unknown>(res, 200);
  const status = JSON.parse(readFileSync(join(projectsRoot, 'proja', '_architect', ARCHITECT_VERDICT_SID, 'status.json'), 'utf8')) as { phase: string };
  assert.equal(status.phase, CANCELLED_PHASE);
  const r = row(await indexRows(), 'architect', ARCHITECT_VERDICT_SID);
  assert.equal(r.terminal, true, 'LEGACY terminal derivation must also honour the universal cancelled phase');
});

test('cancel: a session with a LIVE tracked turn (turn.pid alive, argv carries the sid) → killed=true and the process is gone; before the cancel the row read working (turnAlive), not crashed', async () => {
  assert.ok(killChildPid !== null, 'precondition: a child was spawned');
  const before = row(await indexRows(), 'demo', KILL_SID);
  assert.equal(before.state, 'working', 'a live tracked turn is working');
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/demo/${KILL_SID}/cancel`, { method: 'POST', headers: CSRF, body: JSON.stringify({ project: 'projb' }) });
  const body = await expectJson<{ killed: boolean }>(res, 200);
  assert.equal(body.killed, true, 'the tracked turn pid must be signalled');
  // The child must actually die (SIGTERM on a plain node -e loop is fatal).
  const deadline = Date.now() + 5_000;
  let alive = true;
  while (Date.now() < deadline) {
    try { process.kill(killChildPid!, 0); } catch { alive = false; break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(alive, false, 'the tracked turn process must be dead after cancel');
});

test('W7-FIX-A2 index: an ONBOARDING session tracked only by turn.pid (live dispatch child, no heartbeat/events channel, status.json 30 min old) reads working — never stalled on a silence it has no channel for', async () => {
  assert.ok(onboardingChildPid !== null, 'precondition: the onboarding child was spawned');
  const r = row(await indexRows(), 'onboarding', ONBOARDING_KILL_SID);
  assert.equal(r.state, 'working', `a live tracked turn with no liveness channel is working; got ${r.state} (idleMs=${r.idleMs})`);
  assert.equal(r.needsYou, false);
});

test('W7-FIX-A2 cancel: an ONBOARDING session (spawnAgentDispatch child, `--session-dir` ownership mark) → killed=true and the dispatch child is dead — cancel is no longer a no-op for onboarding', async () => {
  assert.ok(onboardingChildPid !== null, 'precondition: the onboarding child was spawned');
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/onboarding/${ONBOARDING_KILL_SID}/cancel`, { method: 'POST', headers: CSRF, body: JSON.stringify({ project: 'projb' }) });
  const body = await expectJson<{ killed: boolean; phase: string; previousPhase: string }>(res, 200);
  assert.equal(body.killed, true, 'the onboarding dispatch child must be signalled (was: killTrackedTurn found no turn.pid, unconditionally false)');
  assert.equal(body.previousPhase, 'running');
  const deadline = Date.now() + 5_000;
  let alive = true;
  while (Date.now() < deadline) {
    try { process.kill(onboardingChildPid!, 0); } catch { alive = false; break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(alive, false, 'the onboarding dispatch child must be dead after cancel');
  const status = JSON.parse(readFileSync(join(projectsRoot, 'projb', '_onboarding', ONBOARDING_KILL_SID, 'status.json'), 'utf8')) as { phase: string };
  assert.equal(status.phase, CANCELLED_PHASE);
});

test('cancel: turn.pid pointing at a pid whose argv does NOT carry the session id is never signalled (ownership check fails closed) — killed=false', async () => {
  // A live, unrelated child (argv carries a DIFFERENT sid).
  const stranger = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)', 'not-this-session'], { detached: true, stdio: 'ignore' });
  stranger.unref();
  const sid = '2026-08-12T12-00-00';
  writeStatus(join(projectsRoot, 'projb', '_demo', sid), { session_id: sid, project: 'projb', phase: 'generating', updated_at: 'x' });
  writeLog('demo', sid, { 'events.jsonl': '', '.heartbeat': 'x', 'stderr.log': '', 'turn.pid': `${stranger.pid}\n` });
  try {
    const res = await fetch(`${bridgeUrl}/api/studio/sessions/demo/${sid}/cancel`, { method: 'POST', headers: CSRF, body: JSON.stringify({ project: 'projb' }) });
    const body = await expectJson<{ killed: boolean }>(res, 200);
    assert.equal(body.killed, false);
    let stillAlive = true;
    try { process.kill(stranger.pid!, 0); } catch { stillAlive = false; }
    assert.equal(stillAlive, true, 'an unowned process must never be signalled');
  } finally {
    try { process.kill(stranger.pid!, 'SIGKILL'); } catch { /* ignore */ }
  }
});

test('cancel: a symlinked session dir (the AT-47 escape shape) is 404 and the victim status.json is byte-unchanged', async () => {
  const victimDir = join(projectsRoot, 'victimproj', '_demo', '2026-08-13T13-00-00');
  writeStatus(victimDir, { session_id: 'v', project: 'victimproj', phase: 'generating' });
  const beforeBytes = readFileSync(join(victimDir, 'status.json'));
  const attackerKindDir = join(projectsRoot, 'attackerproj', '_demo');
  mkdirSync(attackerKindDir, { recursive: true });
  const { symlinkSync } = await import('node:fs');
  symlinkSync(victimDir, join(attackerKindDir, 'evil-session'));
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/demo/evil-session/cancel`, { method: 'POST', headers: CSRF, body: JSON.stringify({ project: 'attackerproj' }) });
  assert.equal(res.status, 404);
  assert.deepEqual(readFileSync(join(victimDir, 'status.json')), beforeBytes, 'victim status.json must be untouched');
  assert.equal(existsSync(join(victimDir, 'status.json')), true);
});
