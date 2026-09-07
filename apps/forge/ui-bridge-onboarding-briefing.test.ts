/**
 * Ruling 441 (option A2) — onboarding gets a REAL interview through the generic
 * surface, and there is exactly ONE dispatch site.
 *
 * WHAT WAS TRUE BEFORE. `POST /api/studio/onboarding/start` did four things in
 * one press: minted the session dir, wrote `status.json` at `running`, emitted
 * the shared `agent-run.dispatched` marker, and spawned the agent. So onboarding
 * had no interview on the generic spine at all — ADR 043 §Consequences even
 * records it as "explicitly out of scope… a fire-and-forget dispatch".
 *
 * WHY THE OBVIOUS FIX WAS PARKED. Simply putting a checkpoint before the
 * dispatch reds S1 beat 4, which asserts `onboard-run-status: 'running'`
 * immediately after the project page's "Run onboarding agent" press — a status
 * polled from the runId the start route returns BECAUSE it dispatched.
 *
 * WHAT A2 DOES INSTEAD. `start` mints at `briefing` and never dispatches; the
 * brief arrives through the SAME generic question-form affordance every other
 * briefed kind uses, and THAT dispatches. The project page's press does both in
 * one handler, so beat 4 still reads `running`; a session minted from the spine
 * (`/sessions/onboarding/new`) with no brief simply waits at `briefing` with the
 * question form showing — which is where the bare generic interview finally gets
 * exercised.
 *
 * These two tests are what make beat 4's premise checkable WITHOUT a funded run.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startBridge } from './ui-bridge.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-onboarding-briefing-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects', 'demoproj'), { recursive: true });
  // The affordance route resolves the kind from the REAL, checked-in
  // `studio/session-kinds.yaml` — copied byte-for-byte, the same way
  // `bridge-studio-affordances.test.ts` provisions its bridge, so this test
  // measures the descriptor that ships rather than a fixture of one.
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'session-kinds.yaml'), readFileSync(join(repoRoot, 'studio', 'session-kinds.yaml'), 'utf8'));
  writeFileSync(
    join(forgeRoot, 'studio', 'catalog.yaml'),
    ['sdks: []', 'models: []', 'tools: []', 'mcps: []', 'guards: []', 'community-skills: []', ''].join('\n'),
  );
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

/** The route emits `agent-run.dispatched` into `_logs/<runId>/events.jsonl` at
 *  t0 — the same marker the generic run host emits — so its presence is the
 *  honest observable for "this session was dispatched", with the spawn itself
 *  suppressed by FORGE_ARCHITECT_NO_SPAWN. */
function dispatched(runId: string): boolean {
  const p = join(forgeRoot, '_logs', runId, 'events.jsonl');
  return existsSync(p) && readFileSync(p, 'utf8').includes('agent-run.dispatched');
}

const sessionDirOf = (sessionId: string) => join(forgeRoot, 'projects', 'demoproj', '_onboarding', sessionId);
const statusOf = (sessionId: string) =>
  JSON.parse(readFileSync(join(sessionDirOf(sessionId), 'status.json'), 'utf8')) as Record<string, unknown>;

async function start(body: Record<string, unknown>): Promise<{ sessionId: string; runId: string }> {
  const res = await fetch(`${url}/api/studio/onboarding/start`, {
    method: 'POST', headers: CSRF, body: JSON.stringify({ project: 'demoproj', ...body }),
  });
  const text = await res.text();
  assert.equal(res.status, 200, text);
  return JSON.parse(text) as { sessionId: string; runId: string };
}

test('441: start ALONE mints at `briefing` and does NOT dispatch — the spine path waits for the operator', async () => {
  const { sessionId, runId } = await start({});

  assert.equal(statusOf(sessionId).phase, 'briefing', 'a session nobody briefed must not claim to be running');
  assert.ok(existsSync(join(sessionDirOf(sessionId), 'questions.json')), 'the question the operator has to answer is on disk, so the generic question-form has something to render');
  assert.equal(dispatched(runId), false, 'no agent may be spawned before the brief exists — this is the whole of ruling 441');
});

test('441: the brief arrives through the GENERIC affordance, and THAT dispatches — one press, `running`, exactly one dispatch (S1 beat 4`s premise)', async () => {
  const { sessionId, runId } = await start({});
  assert.equal(dispatched(runId), false);

  const res = await fetch(`${url}/api/studio/sessions/onboarding/${sessionId}/briefing-question-form`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify({
      project: 'demoproj',
      answers: [{ question: 'What is this project for?', answer: 'A markdown table-of-contents tool; the gate is `npm test`.' }],
    }),
  });
  const text = await res.text();
  assert.equal(res.status, 200, text);

  assert.equal(statusOf(sessionId).phase, 'running', 'answering the brief is what starts the agent');
  assert.equal(dispatched(runId), true, 'ONE dispatch site, and this is it');
  assert.ok(readFileSync(join(sessionDirOf(sessionId), 'prompt.md'), 'utf8').includes('table-of-contents'), 'the operator`s own words reach the agent verbatim');
});

test('441: a brief handed to START is RECORDED but still does not dispatch — one dispatch site, and it is the answer', async () => {
  // The project page collects the north star before it presses, so its start
  // call carries `inputs`. Those words must not be lost — but they must not
  // dispatch either, or there are two dispatch sites again and the bespoke form
  // stays a second way to do the same thing (which is what 441 removes). The
  // press stays one press because the page follows start with the answer POST;
  // that half is pinned in apps/studio, where the component lives.
  const { sessionId, runId } = await start({ inputs: { northStar: 'ship the sentinel feature 91a2', repo: 'projects/demoproj' } });

  assert.equal(statusOf(sessionId).phase, 'briefing', 'start never dispatches, however much it was told');
  assert.equal(dispatched(runId), false);
  assert.ok(
    readFileSync(join(sessionDirOf(sessionId), 'prompt.md'), 'utf8').includes('ship the sentinel feature 91a2'),
    'the operator inputs start was given are recorded verbatim, not discarded',
  );
});
