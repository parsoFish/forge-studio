/**
 * reap-kind.test.ts — the architect's own start event, and the subtraction
 * that reads a kind out of a log dir name without guessing.
 *
 * MEASURED, NOT IMAGINED (S4 run 2, 2026-09-05; the row below is copied from
 * `_1.0/evidence/m5-b-s6-S4-run2/architect-log.tgz`, this run's real
 * `_logs/_architect-<id>/events.jsonl`). `6.11.12`'s reaper half went in, the
 * run killed a real architect, and the reaper refused BY NAME:
 *
 *     [stories] session NOT cancelled: unknown/unknown
 *               — no start event names the session — nothing to terminate
 *
 * The cause is a product asymmetry (bead `forge-8vfn.6.11.14`):
 *
 *   generic `interactive-runner.ts:207`  metadata { session_id, session_kind, phase, step }
 *   legacy bespoke architect runner      metadata { session_id, phase, round }   ← no kind
 *
 * So the fix was right about the class and short by one field, and it was short
 * for the ONE kind every costed story in this milestone depends on. The refusal
 * was honest — it did nothing and said why — but a torn-down architect still
 * reads `interviewing` forever, which is the whole point of the bead.
 *
 * WHY THE DIR NAME IS NOW SAFE TO READ, having been refused before. `6.11.12`
 * declined to parse `_${kind}-${sessionId}` because it has NO unique split:
 * kinds contain hyphens (`project-brain`) and so do session ids
 * (`2026-09-05T07-58-40-acb79ba9`). That is true of the name ALONE. It stops
 * being true the moment one half is known: with `session_id` read from the
 * event, the kind is the name minus a leading `_` minus a trailing
 * `-<sessionId>` — subtraction, not a guess, and it FAILS CLOSED when the name
 * does not have that exact shape.
 *
 * The product asymmetry stays filed separately: a harness that only works for
 * runners which happen to emit a field is the same fragility one layer along.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { recordReapedCancellations } from './reap-cancel.mjs';

const ARCHITECT_SESSION_ID = '2026-09-05T07-58-40-acb79ba9';

/** S4 run 2's REAL start row, trimmed to the fields under test. Note the
 *  metadata: `session_id`, `phase`, `round` — and no `session_kind`. */
const REAL_ARCHITECT_START = {
  event_id: 'EV_mto3cs4n_ecms3hq5',
  cycle_id: `_architect-${ARCHITECT_SESSION_ID}`,
  started_at: '2026-09-05T07:58:41.255Z',
  initiative_id: `architect-session-${ARCHITECT_SESSION_ID}`,
  phase: 'architect',
  skill: 'architect-runner',
  event_type: 'start',
  message: 'architect turn (phase=interviewing)',
  metadata: { session_id: ARCHITECT_SESSION_ID, phase: 'interviewing', round: 1 },
};

type Ground = { root: string; logDir: string; projectsRoot: string; statusPath: string };

function plantArchitectTurn(opts: { dirName?: string; sessionId?: string } = {}): Ground {
  const sessionId = opts.sessionId ?? ARCHITECT_SESSION_ID;
  const dirName = opts.dirName ?? `_architect-${sessionId}`;
  const root = mkdtempSync(join(tmpdir(), 'reap-kind-'));

  const logDir = join(root, '_logs', dirName);
  mkdirSync(logDir, { recursive: true });
  writeFileSync(
    join(logDir, 'events.jsonl'),
    [
      JSON.stringify({ ...REAL_ARCHITECT_START, event_type: 'brain-query', event_id: 'EV_bq' }),
      JSON.stringify({ ...REAL_ARCHITECT_START, metadata: { ...REAL_ARCHITECT_START.metadata, session_id: sessionId } }),
      JSON.stringify({ event_id: 'EV_tool', event_type: 'tool_use', message: 'Read', metadata: {} }),
    ].join('\n') + '\n',
  );

  const projectsRoot = join(root, 'projects');
  const sessionDir = join(projectsRoot, 'gitpulse', '_architect', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const statusPath = join(sessionDir, 'status.json');
  writeFileSync(
    statusPath,
    JSON.stringify({ session_id: sessionId, project: 'gitpulse', phase: 'interviewing', round: 1 }, null, 2),
  );
  return { root, logDir, projectsRoot, statusPath };
}

const readStatus = (g: Ground) => JSON.parse(readFileSync(g.statusPath, 'utf8')) as Record<string, unknown>;

test('[6.11.14] a REAPED architect is terminated even though its start event omits session_kind', (t) => {
  const g = plantArchitectTurn();
  t.after(() => rmSync(g.root, { recursive: true, force: true }));

  const outcomes = recordReapedCancellations(
    { reaped: [{ pid: 3364642, dir: g.logDir, signal: 'SIGTERM', via: 'cwd' }], skipped: [] },
    { projectsRoot: g.projectsRoot, reason: 'story runner S4: first red at beat 11 of 12: gave up at the agent wait' },
  );

  assert.equal(outcomes[0].written, true, `expected the session to be terminated — got ${outcomes[0].reason}`);
  assert.equal(outcomes[0].kind, 'architect', 'the kind comes out of the dir name by subtraction');
  assert.equal(outcomes[0].sessionId, ARCHITECT_SESSION_ID);
  const status = readStatus(g);
  assert.equal(status.phase, 'cancelled');
  assert.equal(status.cancelled_from, 'interviewing');
  assert.match(String(status.cancelled_reason), /beat 11/);
});

test('[6.11.14] a HYPHENATED kind and a HYPHENATED session id resolve together — the split the name alone cannot make', (t) => {
  // `_project-brain-2026-08-14T15-07-02` has no unique parse. It has exactly
  // one once `session_id` is known, which is the whole argument for reading the
  // event first and the name second.
  const sessionId = '2026-08-14T15-07-02';
  const g = plantArchitectTurn({ sessionId, dirName: `_project-brain-${sessionId}` });
  t.after(() => rmSync(g.root, { recursive: true, force: true }));
  // The session lives under the kind's own dir.
  mkdirSync(join(g.projectsRoot, 'gitpulse', '_project-brain', sessionId), { recursive: true });
  writeFileSync(
    join(g.projectsRoot, 'gitpulse', '_project-brain', sessionId, 'status.json'),
    JSON.stringify({ session_id: sessionId, phase: 'building' }, null, 2),
  );

  const outcomes = recordReapedCancellations(
    { reaped: [{ pid: 7, dir: g.logDir, signal: 'SIGKILL', via: 'record' }], skipped: [] },
    { projectsRoot: g.projectsRoot, reason: 'story runner: teardown' },
  );

  assert.equal(outcomes[0].kind, 'project-brain');
  assert.equal(outcomes[0].sessionId, sessionId);
  const status = JSON.parse(
    readFileSync(join(g.projectsRoot, 'gitpulse', '_project-brain', sessionId, 'status.json'), 'utf8'),
  );
  assert.equal(status.phase, 'cancelled');
  assert.equal(status.cancelled_from, 'building');
});

test('[6.11.14] NEGATIVE CONTROL: a dir name that does not END with the session id is refused, never guessed', (t) => {
  // Fail closed. If the two facts disagree, the honest answer is "I cannot name
  // this session", not a kind assembled from whatever is left over.
  const g = plantArchitectTurn({ dirName: '_architect-some-other-session' });
  t.after(() => rmSync(g.root, { recursive: true, force: true }));

  const outcomes = recordReapedCancellations(
    { reaped: [{ pid: 7, dir: g.logDir, signal: 'SIGKILL', via: 'record' }], skipped: [] },
    { projectsRoot: g.projectsRoot, reason: 'story runner: teardown' },
  );

  assert.equal(outcomes[0].written, false);
  assert.match(String(outcomes[0].reason), /does not name/i);
  assert.equal(readStatus(g).phase, 'interviewing', 'the session is byte-untouched');
});

test('[6.11.14] NEGATIVE CONTROL: a start event with NO session_id at all is still refused', (t) => {
  const g = plantArchitectTurn();
  t.after(() => rmSync(g.root, { recursive: true, force: true }));
  writeFileSync(
    join(g.logDir, 'events.jsonl'),
    JSON.stringify({ ...REAL_ARCHITECT_START, metadata: { phase: 'interviewing', round: 1 } }) + '\n',
  );

  const outcomes = recordReapedCancellations(
    { reaped: [{ pid: 7, dir: g.logDir, signal: 'SIGKILL', via: 'record' }], skipped: [] },
    { projectsRoot: g.projectsRoot, reason: 'story runner: teardown' },
  );

  assert.equal(outcomes[0].written, false);
  assert.match(String(outcomes[0].reason), /no start event/i);
  assert.equal(readStatus(g).phase, 'interviewing');
});

test('[6.11.14] an explicit session_kind still WINS over the dir name', (t) => {
  // The generic runners emit the field; the subtraction is a fallback, not a
  // replacement. A dir renamed by hand must not override what the runner said.
  const g = plantArchitectTurn({ dirName: `_renamed-${ARCHITECT_SESSION_ID}` });
  t.after(() => rmSync(g.root, { recursive: true, force: true }));
  writeFileSync(
    join(g.logDir, 'events.jsonl'),
    JSON.stringify({
      ...REAL_ARCHITECT_START,
      metadata: { ...REAL_ARCHITECT_START.metadata, session_kind: 'architect' },
    }) + '\n',
  );

  const outcomes = recordReapedCancellations(
    { reaped: [{ pid: 7, dir: g.logDir, signal: 'SIGKILL', via: 'record' }], skipped: [] },
    { projectsRoot: g.projectsRoot, reason: 'story runner: teardown' },
  );

  assert.equal(outcomes[0].kind, 'architect', 'the declared kind wins');
  assert.equal(readStatus(g).phase, 'cancelled');
});
