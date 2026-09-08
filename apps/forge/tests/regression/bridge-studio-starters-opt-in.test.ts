/**
 * Starter agents are EXPLICIT OPT-IN — operator ruling 384, shape settled by
 * T1 ruling 459 (option 1, seed-then-save).
 *
 * WHAT WAS WRONG. Saving a flow silently materialised roster agents the
 * operator never authored: `PUT /api/studio/flows/:id` planned the closed
 * starter set (`dev`/`plan`/`review`) for any node referencing one and copied
 * whole packages into `skills/`. An operator who dragged a station onto the
 * seeded canvas and pressed Save gained three agents they did not ask for,
 * and a story run's save wrote outside its own artifacts.
 *
 * WHY THE ORDER IS LOAD-BEARING, and why this file tests the refusal as
 * carefully as the seed. The save did not merely materialise as a side
 * effect — it folded the planned definitions into the agents map so
 * `validateFlow`'s agent-ref check would pass. None of `dev`, `plan` or
 * `review` exists in a checkout (only `skills/architect` does), so a save
 * that stops materialising them has three unresolvable refs. That is the
 * honest outcome and it must be REFUSED NAMING THEM, not half-saved: a flow
 * whose stations point at agents that do not exist is not a flow yet.
 * Ruling 459 refused the alternative (tolerate a planned starter and report a
 * finding) because `can-start` would then have to learn a valid-but-
 * incomplete state.
 *
 * The first-run consequence is deliberate and goes to the operator
 * separately: a fresh install's seeded canvas is not saveable until
 * `seed starter agents` is pressed. That is what explicit opt-in means.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startBridge } from '../../ui-bridge.ts';

const REAL_ROOT = process.cwd();
const STARTERS = ['dev', 'plan', 'review'] as const;

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'starters-opt-in-'));
  for (const d of ['_queue/in-flight', '_queue/done', '_queue/failed', '_queue/pending', '_logs', 'skills', 'studio/flows']) {
    mkdirSync(join(forgeRoot, d), { recursive: true });
  }
  // The real starter library — the closed set this feature offers. Copied in
  // so the seed action has something true to materialise; inventing fixture
  // starters would test this file's idea of the set rather than the product's.
  cpSync(join(REAL_ROOT, 'studio', 'starters', 'agents'), join(forgeRoot, 'studio', 'starters', 'agents'), { recursive: true });
  // `architect` is a SHIPPED roster agent, not a starter — the flow below
  // references it too, and it must resolve without any seeding.
  cpSync(join(REAL_ROOT, 'skills', 'architect'), join(forgeRoot, 'skills', 'architect'), { recursive: true });

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

async function send(path: string, method: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${bridgeUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>) };
}

/**
 * A flow whose stations reference the starter set — S4's shape, and
 * OTHERWISE VALID on purpose. Every edge carries an artifact, the ceiling and
 * goal are set, and `architect` is a real shipped agent: if the body were
 * merely invalid the save would be refused for some other reason and this
 * file would prove nothing about starters. The first draft of this fixture
 * had exactly that defect — the save failed with a bare `validation failed`
 * and the artifact assertions passed because nothing had run far enough to
 * materialise anything.
 */
const flowBody = (id: string) => ({
  id,
  create: true,
  name: id,
  goal: 'a flow that references the starter roster',
  costCeilingUsd: 2,
  nodes: [
    { id: 'architect', agent: 'architect' },
    { id: 'plan', agent: 'plan' },
    { id: 'dev', agent: 'dev' },
    { id: 'review', agent: 'review' },
    // A human gate, because `validateFlow` refuses a zero-gate flow outright
    // ("unbounded unattended spending"). Without it the save is refused for a
    // reason that has nothing to do with starters, and this file would be
    // asserting against the wrong failure — the second time this fixture had
    // to be corrected for exactly that.
    { id: 'approve', gate: 'human' },
  ],
  edges: [
    { from: 'architect', to: 'plan', artifact: 'PLAN.md' },
    { from: 'plan', to: 'dev', artifact: 'PLAN.md' },
    { from: 'dev', to: 'review', artifact: 'DIFF.md' },
    { from: 'review', to: 'approve', artifact: 'DIFF.md' },
  ],
  triggers: [],
});

const seeded = (slug: string) => existsSync(join(forgeRoot, 'skills', slug));

test('384: a flow SAVE writes no roster agents — and is refused, naming the starters it cannot resolve', async () => {
  for (const s of STARTERS) assert.equal(seeded(s), false, `precondition: skills/${s} must not exist yet`);

  const r = await send('/api/studio/flows/save-writes-nothing', 'PUT', flowBody('save-writes-nothing'));

  // The ARTIFACT, not just the status: nothing may land in skills/.
  for (const s of STARTERS) {
    assert.equal(seeded(s), false, `a save must not materialise skills/${s} — that is the whole of ruling 384`);
  }
  assert.notEqual(r.status, 200, 'a flow whose stations point at agents that do not exist is not a flow yet');
  const whole = JSON.stringify(r.json);
  for (const s of STARTERS) {
    assert.ok(whole.includes(s), `the refusal must NAME what is missing so the operator can act — "${s}" absent from: ${whole}`);
  }
});

test('384: the seed action materialises exactly the closed set and NAMES what it wrote', async () => {
  const r = await send('/api/studio/starters/seed', 'POST', {});
  assert.equal(r.status, 200, `seeding must succeed; got ${r.status} ${JSON.stringify(r.json)}`);

  const wrote = r.json.seeded as string[];
  assert.deepEqual([...wrote].sort(), [...STARTERS].sort(), 'the response names exactly what it wrote');
  for (const s of STARTERS) assert.equal(seeded(s), true, `skills/${s} must exist after seeding`);
});

test('384: pressed twice it writes once — the second press names the existing three and creates nothing new', async () => {
  const before = STARTERS.map((s) => seeded(s));
  assert.deepEqual(before, [true, true, true], 'precondition: the previous test seeded them');

  const r = await send('/api/studio/starters/seed', 'POST', {});
  assert.equal(r.status, 200);
  assert.deepEqual((r.json.seeded as string[]) ?? [], [], 'nothing NEW was written the second time');
  assert.deepEqual(
    [...((r.json.existing as string[]) ?? [])].sort(),
    [...STARTERS].sort(),
    'and it says which ones were already there, rather than reporting a silent no-op',
  );
});

test('384: once seeded, the same save that was refused now succeeds — seed-then-save is a real path, not a dead end', async () => {
  const r = await send('/api/studio/flows/save-after-seed', 'PUT', flowBody('save-after-seed'));
  assert.equal(r.status, 200, `after seeding the flow must save; got ${r.status} ${JSON.stringify(r.json)}`);
  assert.ok(existsSync(join(forgeRoot, 'studio', 'flows', 'save-after-seed', 'flow.yaml')), 'the flow really landed on disk');
});
