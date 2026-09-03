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
 * All three are driven here against a SYNTHETIC registry and an INJECTED
 * `AffordanceRouteContext`, calling `handleStudioAffordanceRoutes` directly
 * over a bare http server — the same handler `cli/ui-bridge.ts` dispatches to,
 * with only the two things a real bridge cannot fake (the registry and the
 * spawner) substituted. Nothing here weakens or duplicates the real-bridge
 * suites: `cli/bridge-studio-affordances{,-revise}.test.ts` still own every
 * reachable path against the REAL checked-in yaml.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import yaml from 'js-yaml';

import { handleStudioAffordanceRoutes, type AffordanceRouteContext, type SpawnTurnOutcome } from './bridge-studio-affordances.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

let forgeRoot: string;
let baseUrl: string;
let server: Server;
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

  const ctx: AffordanceRouteContext = {
    forgeRoot,
    logsRoot: join(forgeRoot, '_logs'),
    spawnAgentTurn: () => { spawnCalls += 1; return spawnOutcome; },
    // ruling 86: the port is required on the context. This test drives no
    // consolidate path, so a THROWING stub is the honest value — one that
    // returned a plausible result would hide a future dispatch from here.
    runFixTurn: async () => { throw new Error('unexpected brain-fix dispatch in this test'); },
    broadcastKindChanged: () => {},
  };
  server = createServer((req, res) => {
    void handleStudioAffordanceRoutes(req, res, ctx, req.url ?? '', req.method ?? 'GET').then((handled) => {
      if (!handled) { res.statusCode = 404; res.end('unrouted'); }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
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

async function postRevise(kind: string, sessionId: string, project: string, feedback = 'change it'): Promise<Response> {
  return fetch(`${baseUrl}/api/studio/sessions/${kind}/${sessionId}/awaiting-verdict-verdict`, {
    method: 'POST', headers: CSRF, body: JSON.stringify({ project, verdict: 'revise', feedback }),
  });
}

test('C2-FIX-501-1: a `revise` row with NO agent-step producer to re-run fails LOUD (501 naming the kind + phase) — never guessed around, nothing written', async () => {
  const dir = seed('failloud1', 'noproducer', '2026-08-21T00-00-001-fl', 'awaiting-verdict');
  const res = await postRevise('noproducer', '2026-08-21T00-00-001-fl', 'failloud1');
  const body = (await res.json()) as { ok: boolean; kind: string; error: string };
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
  const body = (await res.json()) as { ok: boolean; error: string };
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
  const text = await res.text();
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
  assert.equal(res.status, 200, await res.text());
  assert.equal(readPhase(dir), 'drafting');
});
