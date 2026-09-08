/**
 * M6-A exit row 1 (rulings 417-419) — "SDK / model / effort are set per
 * session" (1.0.md §3, row S9) at the onboarding kickoff's own door.
 *
 * S9 beat 11 asserts that kickoff renders `data-model-tier-picker="range"`; it
 * rendered `fixed`, because `skills/onboarding-agent/SKILL.md` declared
 * `strategy: fixed` and there was no envelope to offer. The fix is the SKILL
 * edit ADR 043's own rationale named ("widening it is a SKILL.md edit rather
 * than a UI decision"), and THIS route is what that widened envelope has to
 * survive: a tier chosen on the form is worth nothing if the route drops it,
 * and worse than nothing if the route accepts one the agent's skill forbids.
 *
 * These drive the REAL route on the REAL skills roster (`deriveAgentSpec`
 * resolves against the forge install, not `forgeRoot`), so they fail the day
 * that SKILL.md stops declaring the envelope.
 *
 * Its own file rather than an append to `ui-bridge-onboarding-start.test.ts`:
 * that file is at 769 lines against the 800-line cap, and an exemption is a
 * ceiling, not a licence.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startBridge } from '../../ui-bridge.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-onboarding-tier-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects', 'demoproj'), { recursive: true });
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

test('M6-A row 1: a modelTier inside onboarding-agent\'s declared envelope is accepted and PERSISTED — a choice the operator makes on the form is a fact the session states about itself', async () => {
  const res = await fetch(`${url}/api/studio/onboarding/start`, {
    method: 'POST', headers: CSRF,
    body: JSON.stringify({ project: 'demoproj', modelTier: 'opus' }),
  });
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as { sessionId: string };
  const status = JSON.parse(
    readFileSync(join(forgeRoot, 'projects', 'demoproj', '_onboarding', body.sessionId, 'status.json'), 'utf8'),
  ) as { modelTier?: string };
  assert.equal(status.modelTier, 'opus', 'every turn runner reads the tier back off status.json — a route that drops it silently runs the default');
});

test('M6-A row 1: a modelTier OUTSIDE the skill-declared envelope is refused by name — never widened, never silently defaulted', async () => {
  const res = await fetch(`${url}/api/studio/onboarding/start`, {
    method: 'POST', headers: CSRF,
    body: JSON.stringify({ project: 'demoproj', modelTier: 'haiku' }),
  });
  assert.equal(res.status, 400);
  const body = JSON.parse(await res.text()) as { error: string };
  assert.match(body.error, /haiku/, 'the refusal must name the offending value');
});

test('M6-A row 1: an unknown sdk is refused by name; the agent\'s own declared sdk is accepted', async () => {
  const bad = await fetch(`${url}/api/studio/onboarding/start`, {
    method: 'POST', headers: CSRF,
    body: JSON.stringify({ project: 'demoproj', sdk: 'not-a-real-sdk' }),
  });
  assert.equal(bad.status, 400, 'ruling 418: an unknown sdk is refused by name, never silently defaulted');
  const badBody = JSON.parse(await bad.text()) as { error: string };
  assert.match(badBody.error, /not-a-real-sdk/);
  assert.match(badBody.error, /claude/, 'the refusal names the real allowed set, like resolveSessionModel\'s own contract');

  const ok = await fetch(`${url}/api/studio/onboarding/start`, {
    method: 'POST', headers: CSRF,
    body: JSON.stringify({ project: 'demoproj', sdk: 'claude' }),
  });
  assert.equal(ok.status, 200, await ok.text());
});
