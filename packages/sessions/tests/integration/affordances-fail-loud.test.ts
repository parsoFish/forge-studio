/**
 * W7-C2 T1 review — the generic affordance WRITE route's FAIL-LOUD arms,
 * pinned directly.
 *
 * Three of them are unreachable through the shipped `studio/session-kinds.yaml`
 * (which is exactly why the review flagged them as unexercised):
 *
 *   1. `!producer`               — a row declaring `revise` with NO `step: agent`
 *                                  row landing on it, i.e. nothing to re-run.
 *   2. `reviseSpawnAgentId null` — a kind with a producer but no wired turn
 *                                  spawner.
 *   3. a failed spawn (A7)       — `spawnAgentTurn` reporting `{ok:false}`.
 *
 * All three are driven here against a SYNTHETIC registry and INJECTED deps,
 * through this package's own route TABLE — the same table `apps/forge`
 * assembles — with only the two things a real bridge cannot fake (the registry
 * and the spawner) substituted. The bare http server this file used to stand up
 * went with the M4 row-37 carve: COMMON §5 forbids a package test booting one,
 * and nothing it added was asserted (rulings 30/49/50). Nothing here weakens
 * the sibling suites: `affordances-revise.test.ts` owns every reachable path
 * against the REAL checked-in yaml, and `cli/bridge-studio-affordances.test.ts`
 * still drives a real bridge for the host's own request policy.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

import type { SpawnTurnOutcome } from '../../bridge-studio-session-helpers.ts';
import type { SessionsRouteDeps } from '../../routes.ts';
import { affordanceDeps, postAt, type HandlerResponse } from './test-fixtures/affordance-handler.ts';

let forgeRoot: string;
let deps: SessionsRouteDeps;
/** What the injected spawner answers on the NEXT call — the one seam a real
 *  bridge cannot fake (a detached spawn either works or the machine is
 *  broken). */
let spawnOutcome: SpawnTurnOutcome = { ok: true, spawned: false };
let spawnCalls = 0;

/** The synthetic registry. `noproducer` declares `revise` on a verdict row
 *  with no agent-step row landing on it; `orphanspawner` has a real producer
 *  but an id no spawner is wired for. */
const SYNTHETIC_KINDS = [
  {
    id: 'noproducer',
    agent: 'instructions-creator',
    title: 'No producer',
    legacyRoutes: [],
    stages: ['instructions'],
    defaultStage: 'instructions',
    artifact: { kind: 'markdown-draft', label: 'Draft' },
    panel: {
      phases: [
        { phase: 'awaiting-verdict', step: 'noop', awaits: 'verdict', verdicts: ['approve', 'revise', 'reject'] },
        { phase: 'rejected', step: 'terminal' },
      ],
    },
  },
  {
    id: 'orphanspawner',
    agent: 'instructions-creator',
    title: 'Orphan spawner',
    legacyRoutes: [],
    stages: ['instructions'],
    defaultStage: 'instructions',
    artifact: { kind: 'markdown-draft', label: 'Draft' },
    panel: {
      phases: [
        { phase: 'drafting', step: 'agent', writes: ['draft'], next: 'awaiting-verdict' },
        { phase: 'awaiting-verdict', step: 'noop', awaits: 'verdict', verdicts: ['approve', 'revise', 'reject'] },
        { phase: 'rejected', step: 'terminal' },
      ],
    },
  },
  {
    id: 'instructions',
    agent: 'instructions-creator',
    title: 'Instructions',
    legacyRoutes: [],
    stages: ['instructions'],
    defaultStage: 'instructions',
    artifact: { kind: 'markdown-draft', label: 'Draft' },
    panel: {
      phases: [
        { phase: 'drafting', step: 'agent', writes: ['draft'], next: 'awaiting-verdict' },
        { phase: 'awaiting-verdict', step: 'noop', awaits: 'verdict', verdicts: ['approve', 'revise', 'reject'] },
        { phase: 'rejected', step: 'terminal' },
      ],
    },
  },
];

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'affordances-fail-loud-'));
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'session-kinds.yaml'), yaml.dump(SYNTHETIC_KINDS), 'utf8');

  deps = affordanceDeps(forgeRoot, {
    spawnAgentTurn: () => { spawnCalls += 1; return spawnOutcome; },
  });
});

after(async () => {
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

function seed(project: string, kind: string, sessionId: string, phase: string): string {
  const dir = join(forgeRoot, 'projects', project, `_${kind}`, sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase }, null, 2), 'utf8');
  return dir;
}

function readPhase(dir: string): string {
  return (JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8')) as { phase: string }).phase;
}

async function postRevise(kind: string, sessionId: string, project: string, feedback = 'change it'): Promise<HandlerResponse> {
  return postAt(forgeRoot, `/api/studio/sessions/${kind}/${sessionId}/awaiting-verdict-verdict`, { project, verdict: 'revise', feedback }, deps);
}

test('C2-FIX-501-1: a `revise` row with NO agent-step producer to re-run fails LOUD (501 naming the kind + phase) — never guessed around, nothing written', async () => {
  const dir = seed('failloud1', 'noproducer', '2026-08-21T00-00-001-fl', 'awaiting-verdict');
  const res = await postRevise('noproducer', '2026-08-21T00-00-001-fl', 'failloud1');
  const body = res.json<{ ok: boolean; kind: string; error: string }>();
  assert.equal(res.status, 501);
  assert.equal(body.ok, false);
  assert.equal(body.kind, 'verdict');
  assert.match(body.error, /noproducer/);
  assert.match(body.error, /awaiting-verdict/);
  assert.equal(readPhase(dir), 'awaiting-verdict', 'a refused revise never moves the session');
});

test('C2-FIX-501-2: a kind with a real producer but NO wired turn spawner fails LOUD (501 naming the kind)', async () => {
  const dir = seed('failloud2', 'orphanspawner', '2026-08-21T00-00-002-fl', 'awaiting-verdict');
  const res = await postRevise('orphanspawner', '2026-08-21T00-00-002-fl', 'failloud2');
  const body = res.json<{ ok: boolean; error: string }>();
  assert.equal(res.status, 501);
  assert.equal(body.ok, false);
  assert.match(body.error, /orphanspawner/);
  assert.equal(readPhase(dir), 'awaiting-verdict');
});

test('C2-FIX-A7-1: a FAILED spawn is reported (500) and the session is put back on its verdict row — never 200 with a session working forever on a turn that never started', async () => {
  const sessionId = '2026-08-21T00-00-003-fl';
  const dir = seed('failloud3', 'instructions', sessionId, 'awaiting-verdict');
  spawnOutcome = { ok: false, error: 'EMFILE: too many open files' };
  const before = spawnCalls;
  const res = await postRevise('instructions', sessionId, 'failloud3', 'tighten the intro');
  const text = res.text;
  assert.equal(res.status, 500, `expected an honest failure, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { error: string; phase: string };
  assert.match(body.error, /EMFILE/, 'the real cause reaches the operator, never a swallowed best-effort');
  assert.equal(body.phase, 'awaiting-verdict');
  assert.equal(spawnCalls, before + 1);
  assert.equal(
    readPhase(dir),
    'awaiting-verdict',
    'the phase is rolled back to the row the operator acted from — a session left in a working phase with no log dir can never be derived as stalled (bridge-studio-lifecycle.ts), so it would read `working` forever with needsYou:false',
  );
  assert.equal(readFileSync(join(dir, 'feedback.md'), 'utf8'), 'tighten the intro', 'the operator\'s pending note survives for the retry');
  spawnOutcome = { ok: true, spawned: false };
});

test('C2-FIX-A7-2: a DELIBERATE no-spawn (the dry bridge / FORGE_ARCHITECT_NO_SPAWN seam) is not a failure — 200, phase advanced', async () => {
  const sessionId = '2026-08-21T00-00-004-fl';
  const dir = seed('failloud4', 'instructions', sessionId, 'awaiting-verdict');
  spawnOutcome = { ok: true, spawned: false };
  const res = await postRevise('instructions', sessionId, 'failloud4');
  assert.equal(res.status, 200, res.text);
  assert.equal(readPhase(dir), 'drafting');
});
