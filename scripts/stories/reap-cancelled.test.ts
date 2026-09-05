/**
 * reap-cancelled.test.ts — a turn this run KILLED reads terminal, not busy.
 *
 * THE DEFECT (bead `forge-8vfn.6.11.12`; found by M5-A reading M5-B's story-run
 * logs, 2026-09-05). `reapAgentRuns` signals every agent a story run dispatched
 * — correctly, and with the provenance ladder `reap.test.ts` covers. But a
 * SIGTERM/SIGKILL cannot run a `finally`, so nothing writes the turn's ending:
 * `runInteractiveTurn`'s closing `end` event never fires and `status.json`
 * keeps the phase the turn was working in. What is left on disk is
 * BYTE-FOR-BYTE what a turn that is still running looks like — COMMON §15.92
 * inside the session log — so a torn-down architect reads `working` (then
 * `stalled` once the ceiling passes) on every Studio surface, forever.
 *
 * THE FIX IS A REUSE, NOT A NEW VOCABULARY (T1 ruling 232). The product
 * already owns exactly one word for this: `CANCELLED_PHASE` — "the ONE
 * universal reserved terminal phase, checked FIRST for every kind" by
 * `isTerminalPhase`, which makes `deriveSessionLifecycle` answer `terminal`.
 * The generic cancel route writes it and calls `killTrackedTurn`; the story
 * reaper killed and wrote nothing. So the reaper now performs the SAME act,
 * with a reason naming what fired.
 *
 * WHY EACH CONTROL EXISTS:
 *
 *  - Only a dir we ACTUALLY reaped is terminated. A skipped pid is one
 *    `decideReap` refused to signal; declaring its turn over would be a claim
 *    about a process still working in somebody else's tree — the S3 incident's
 *    error in a new costume.
 *  - The session is identified from the START EVENT'S OWN metadata, never by
 *    splitting the log dir name. `_${kind}-${sessionId}` is AMBIGUOUS: kinds
 *    contain hyphens (`project-brain`) and so do session ids
 *    (`2026-08-14T15-07-02`), so `_project-brain-2026-08-14T15-07-02` has no
 *    unique parse. The runner already writes `{session_kind, session_id}` into
 *    the start event; read the fact rather than re-deriving it (§15.155's
 *    shape: never parse a value out of a string that also carries free text).
 *  - It refuses, by name, on every branch it cannot honour: no log, no start
 *    event, no such session, an ambiguous project, no status, already
 *    cancelled. "Nothing to terminate" is an outcome, not a failure.
 *  - It never throws. This runs inside the run's `finally` (reap.mjs's stated
 *    invariant); an exception here loses the verdict the run exists to write.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { recordReapedCancellations, reapReasonFor } from './reap-cancel.mjs';
import { describeReap } from './reap.mjs';

type Ground = { root: string; logDir: string; projectsRoot: string; statusPath: string };

/** A run root holding one killed turn: its log dir (start event, no end) and
 *  the session dir the log's own metadata points at. */
function plantKilledTurn(
  opts: { kind?: string; sessionId?: string; project?: string; phase?: string; withStart?: boolean } = {},
): Ground {
  const kind = opts.kind ?? 'architect';
  const sessionId = opts.sessionId ?? '2026-09-05T00-00-00';
  const project = opts.project ?? 'gitweave';
  const phase = opts.phase ?? 'interviewing';
  const root = mkdtempSync(join(tmpdir(), 'reap-cancelled-'));

  const logDir = join(root, '_logs', `_${kind}-${sessionId}`);
  mkdirSync(logDir, { recursive: true });
  const rows: Array<Record<string, unknown>> = [];
  if (opts.withStart !== false) {
    rows.push({
      event_id: 'ev-start-1',
      cycle_id: `_${kind}-${sessionId}`,
      event_type: 'start',
      message: `interactive turn (kind=${kind}, phase=${phase}, step=agent)`,
      metadata: { session_id: sessionId, session_kind: kind, phase },
    });
  }
  rows.push({ event_id: 'ev-tool-1', event_type: 'tool_use', message: 'Read', metadata: {} });
  writeFileSync(join(logDir, 'events.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const projectsRoot = join(root, 'projects');
  const sessionDir = join(projectsRoot, project, `_${kind}`, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const statusPath = join(sessionDir, 'status.json');
  writeFileSync(statusPath, JSON.stringify({ session_id: sessionId, phase, idea: 'weave the org' }, null, 2));

  return { root, logDir, projectsRoot, statusPath };
}

const readStatus = (g: Ground) => JSON.parse(readFileSync(g.statusPath, 'utf8')) as Record<string, unknown>;

test('a REAPED turn is stamped with the reserved terminal phase, naming what fired', (t) => {
  const g = plantKilledTurn();
  t.after(() => rmSync(g.root, { recursive: true, force: true }));

  const outcomes = recordReapedCancellations(
    { reaped: [{ pid: 4242, dir: g.logDir, signal: 'SIGKILL', via: 'record' }], skipped: [] },
    { projectsRoot: g.projectsRoot, reason: 'story runner S1: the run ended at beat 6 while this turn was still working' },
  );

  const status = readStatus(g);
  assert.equal(status.phase, 'cancelled', 'the ONE universal reserved terminal phase');
  assert.equal(status.cancelled_from, 'interviewing', 'the phase it was working in is kept, not overwritten');
  assert.equal(typeof status.cancelled_at, 'string');
  assert.match(String(status.cancelled_reason), /beat 6/, 'the reason names what fired');
  assert.match(String(status.cancelled_reason), /SIGKILL/, 'and the signal that ended it');
  assert.equal(status.idea, 'weave the org', 'every other field is preserved');

  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].written, true);
  assert.equal(outcomes[0].kind, 'architect');
  assert.equal(outcomes[0].project, 'gitweave');
});

test('NEGATIVE CONTROL: a SKIPPED pid’s session is never terminated — we did not kill it', (t) => {
  const g = plantKilledTurn();
  t.after(() => rmSync(g.root, { recursive: true, force: true }));

  const outcomes = recordReapedCancellations(
    { reaped: [], skipped: [{ pid: 4242, dir: g.logDir, reason: 'cwd outside the run worktree' }] },
    { projectsRoot: g.projectsRoot, reason: 'story runner S1: teardown' },
  );

  assert.equal(readStatus(g).phase, 'interviewing', 'the session is byte-untouched');
  assert.deepEqual(outcomes, []);
});

test('the session is read from the START EVENT’s metadata, never parsed out of the dir name', (t) => {
  // `_project-brain-2026-08-14T15-07-02` has no unique split into kind and id.
  const g = plantKilledTurn({ kind: 'project-brain', sessionId: '2026-08-14T15-07-02', phase: 'building' });
  t.after(() => rmSync(g.root, { recursive: true, force: true }));

  const outcomes = recordReapedCancellations(
    { reaped: [{ pid: 7, dir: g.logDir, signal: 'SIGTERM', via: 'record' }], skipped: [] },
    { projectsRoot: g.projectsRoot, reason: 'story runner S3: teardown' },
  );

  assert.equal(outcomes[0].kind, 'project-brain');
  assert.equal(outcomes[0].sessionId, '2026-08-14T15-07-02');
  assert.equal(readStatus(g).phase, 'cancelled');
  assert.equal(readStatus(g).cancelled_from, 'building');
});

test('a log with NO start event is an outcome, not a guess — nothing is written', (t) => {
  const g = plantKilledTurn({ withStart: false });
  t.after(() => rmSync(g.root, { recursive: true, force: true }));

  const outcomes = recordReapedCancellations(
    { reaped: [{ pid: 7, dir: g.logDir, signal: 'SIGKILL', via: 'record' }], skipped: [] },
    { projectsRoot: g.projectsRoot, reason: 'story runner: teardown' },
  );

  assert.equal(readStatus(g).phase, 'interviewing');
  assert.equal(outcomes[0].written, false);
  assert.match(String(outcomes[0].reason), /no start event/i);
});

test('an ALREADY-cancelled session is not re-stamped, and says so', (t) => {
  const g = plantKilledTurn({ phase: 'cancelled' });
  t.after(() => rmSync(g.root, { recursive: true, force: true }));
  const before = readFileSync(g.statusPath, 'utf8');

  const outcomes = recordReapedCancellations(
    { reaped: [{ pid: 7, dir: g.logDir, signal: 'SIGKILL', via: 'record' }], skipped: [] },
    { projectsRoot: g.projectsRoot, reason: 'story runner: teardown' },
  );

  assert.equal(readFileSync(g.statusPath, 'utf8'), before, 'byte-unchanged');
  assert.equal(outcomes[0].written, false);
  assert.match(String(outcomes[0].reason), /already cancelled/i);
});

test('a session the projects root does not hold is refused BY NAME, not silently', (t) => {
  const g = plantKilledTurn();
  t.after(() => rmSync(g.root, { recursive: true, force: true }));
  rmSync(join(g.projectsRoot, 'gitweave'), { recursive: true, force: true });

  const outcomes = recordReapedCancellations(
    { reaped: [{ pid: 7, dir: g.logDir, signal: 'SIGKILL', via: 'record' }], skipped: [] },
    { projectsRoot: g.projectsRoot, reason: 'story runner: teardown' },
  );

  assert.equal(outcomes[0].written, false);
  assert.match(String(outcomes[0].reason), /not-found|no session/i);
});

test('two reaped pids sharing ONE log dir stamp the session exactly once', (t) => {
  const g = plantKilledTurn();
  t.after(() => rmSync(g.root, { recursive: true, force: true }));

  const outcomes = recordReapedCancellations(
    {
      reaped: [
        { pid: 100, dir: g.logDir, signal: 'SIGTERM', via: 'record' },
        { pid: 101, dir: g.logDir, signal: 'SIGKILL', via: 'descendant' },
      ],
      skipped: [],
    },
    { projectsRoot: g.projectsRoot, reason: 'story runner: teardown' },
  );

  assert.equal(outcomes.length, 1, 'one session, one outcome');
  // The ROOT's signal is the recorded one: the turn is what was terminated.
  assert.match(String(readStatus(g).cancelled_reason), /SIGTERM/);
});

test('recordReapedCancellations never throws — it runs inside the run’s finally', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'reap-cancelled-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const outcomes = recordReapedCancellations(
    { reaped: [{ pid: 9, dir: join(root, 'does', 'not', 'exist'), signal: 'SIGKILL', via: 'record' }], skipped: [] },
    { projectsRoot: join(root, 'projects'), reason: 'story runner: teardown' },
  );

  assert.equal(outcomes[0].written, false);
  assert.equal(typeof outcomes[0].reason, 'string');
});

test('describeReap names every cancellation outcome, written or refused', (t) => {
  const g = plantKilledTurn();
  t.after(() => rmSync(g.root, { recursive: true, force: true }));

  const report: Record<string, unknown> = {
    reaped: [{ pid: 4242, dir: g.logDir, signal: 'SIGKILL', via: 'record' }],
    skipped: [],
  };
  report.cancelled = recordReapedCancellations(report as never, {
    projectsRoot: g.projectsRoot,
    reason: 'story runner S1: teardown',
  });

  const lines = describeReap(report as never);
  assert.ok(
    lines.some((l: string) => l.includes('cancelled') && l.includes('architect')),
    `describeReap must name the session it terminated; got:\n${lines.join('\n')}`,
  );
});

test('reapReasonFor names the FIRST RED beat and quotes the bound that fired', () => {
  const story = { id: 'S4', beats: new Array(12).fill({}) };
  const beats = [
    { status: 'green', failures: [] },
    { status: 'red', failures: ['data-session-phase: expected "awaiting-verdict", got "interviewing" — agent wait (declared 600000 ms) gave up'] },
    { status: 'red', failures: ['cascade'] },
  ];
  const reason = reapReasonFor(story, beats);
  assert.match(reason, /^story runner S4:/);
  assert.match(reason, /first red at beat 2 of 12/, 'the FIRST red, not the last');
  assert.match(reason, /agent wait \(declared 600000 ms\)/, 'the bound that fired travels with the reason');
});

test('reapReasonFor still explains an ALL-GREEN run — the turn outlived the run that dispatched it', () => {
  const story = { id: 'S2', beats: new Array(13).fill({}) };
  const beats = new Array(13).fill({ status: 'green', failures: [] });
  const reason = reapReasonFor(story, beats);
  assert.match(reason, /all 13 beats green/);
  assert.match(reason, /still working/);
});

test('reapReasonFor is CAPPED — a failure dump does not become a session field', () => {
  const story = { id: 'S1', beats: new Array(11).fill({}) };
  const beats = [{ status: 'red', failures: ['x'.repeat(4000)] }];
  const reason = reapReasonFor(story, beats);
  assert.ok(reason.length <= 301, `expected a capped reason, got ${reason.length} chars`);
  assert.ok(reason.endsWith('…'), 'a truncated reason says it was truncated');
});
