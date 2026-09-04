/**
 * The flow SAVE route derives `kickoff` (T1 ruling 167, bead `forge-8vfn.6.11.1`).
 *
 * THE DEFECT. `PUT /api/studio/flows/:id` merged `kickoff: existing?.kickoff`
 * and nothing else, so a flow the Studio builder created carried no kickoff
 * block ever — `kickoffSurfaceId` fell through to `generic`, `/flows/<id>`
 * rendered the generic Start-Run picker, and a flow whose FIRST STATION is the
 * architect could not be launched from an idea. S4 beat 8:
 * `data-kickoff-kind: expected "idea", got "generic"`.
 *
 * Why here and not only in `packages/flows`: the derivation is unit-tested
 * beside its own module, but the thing that was broken is the ROUTE — it owns
 * the agents map the derivation reads and it owns the fill-vs-overwrite
 * decision. A green unit test with an unwired route is exactly the shape of
 * the defect. Self-contained fixture per this tree's convention.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';
import { loadFlowDefinition } from '@forge/flows/studio/flow-registry.ts';

/**
 * A roster agent. `fanout` is optional so one helper covers both the plain
 * agent and the work-item fan-out whose head implies the initiative picker.
 */
function skillMd(slug: string, opts: { fanout?: boolean; phase?: string } = {}): string {
  return [
    '---',
    `name: ${slug}`,
    `description: A ${slug} agent.`,
    'library: true',
    ...(opts.phase === undefined ? [] : [`phase: ${opts.phase}`]),
    `purpose: Does ${slug} things.`,
    'brainAccess: none',
    'interactivity: none',
    'composition:',
    '  skills: []',
    '  tools: []',
    '  mcps: []',
    '  guards: [event-log]',
    'runtime:',
    '  sdk: claude-agent-sdk',
    '  strategy: fixed',
    '  model: claude-sonnet-4-6',
    ...(opts.fanout
      ? [
          'fanout:',
          '  drivingArtifact: work-items',
          '  isolation: worktree',
          '  concurrencyCap: 1',
          '  perItemGate: item-declared',
        ]
      : []),
    'budgets: {}',
    'allowed-tools: []',
    'disallowed-tools: []',
    '---',
    '',
    `${slug} body.`,
  ].join('\n');
}

/** A flow whose head is a plain station — nothing about it names an input. */
function plainFlowYaml(id: string, extra: string[] = []): string {
  return [
    `id: ${id}`,
    `name: ${id}`,
    'version: 1',
    'goal: Ship something.',
    'project: null',
    'kb: null',
    'costCeilingUsd: 2',
    'origin: studio',
    'nodes:',
    '  - id: work',
    '    agent: worker',
    '  - id: review',
    '    gate: verdict',
    'edges:',
    '  - from: work',
    '    to: review',
    '    artifact: PLAN.md',
    'triggers: []',
    ...extra,
  ].join('\n');
}

/** The body the builder PUTs for a flow that BEGINS with the architect. */
const ARCHITECT_HEAD_BODY = {
  name: 'Story Flow',
  goal: 'Turn an idea into a reviewed change.',
  nodes: [
    { id: 'architect', agent: 'architect', gate: 'plan' },
    { id: 'work', agent: 'worker' },
    { id: 'review', gate: 'verdict' },
  ],
  edges: [
    { from: 'architect', to: 'work', artifact: 'PLAN.md' },
    { from: 'work', to: 'review', artifact: 'PR' },
  ],
  triggers: [],
};

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-flow-kickoff-'));
  for (const [slug, opts] of [
    ['architect', { phase: 'architect' }],
    ['worker', {}],
    ['fanner', { fanout: true }],
  ] as const) {
    mkdirSync(join(forgeRoot, 'skills', slug), { recursive: true });
    writeFileSync(join(forgeRoot, 'skills', slug, 'SKILL.md'), skillMd(slug, opts));
  }
  // A flow that already DECLARES a kickoff, whose head contradicts it.
  mkdirSync(join(forgeRoot, 'studio', 'flows', 'declared-flow'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'studio', 'flows', 'declared-flow', 'flow.yaml'),
    plainFlowYaml('declared-flow', ['kickoff:', '  kind: trigger-only']),
  );
  for (const state of ['pending', 'done', 'ready-for-review', 'failed', 'in-flight']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

async function putFlow(id: string, body: unknown): Promise<Response> {
  return fetch(`${bridgeUrl}/api/studio/flows/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
}

function onDisk(id: string): ReturnType<typeof loadFlowDefinition> {
  return loadFlowDefinition(join(forgeRoot, 'studio', 'flows', id, 'flow.yaml'));
}

test('S4 beat 8: CREATING a flow whose first station is the architect writes kickoff.kind=idea', async () => {
  const res = await putFlow('story-flow', { ...ARCHITECT_HEAD_BODY, create: true });
  assert.equal(res.status, 200);
  // The save REPORTS the kind it derived. The BUILD tab shows the operator
  // the launch surface read-only and cannot compute it (`apps/studio` imports
  // contracts only), so a save that derives silently leaves the builder
  // showing the pre-save answer until a reload.
  assert.equal(((await res.json()) as { kickoff?: unknown }).kickoff, 'idea');

  assert.deepEqual(onDisk('story-flow').kickoff, { kind: 'idea' });
  // The block is in the FILE, not merely in the response — the launcher reads
  // the file through a later GET, in another process.
  const yamlText = readFileSync(join(forgeRoot, 'studio', 'flows', 'story-flow', 'flow.yaml'), 'utf8');
  assert.match(yamlText, /kickoff:\s*\n?\s*kind: idea/);

  // ...and the read route hands the UI the same thing, which is what
  // `kickoffSurfaceId` dispatches on.
  const get = await fetch(`${bridgeUrl}/api/studio/flows/story-flow`);
  assert.equal(get.status, 200);
  assert.deepEqual(((await get.json()) as { flow: { kickoff?: unknown } }).flow.kickoff, { kind: 'idea' });
});

/**
 * The shape the BUILDER actually PUTs. `FlowBuilderCanvas.placeStationAt`
 * creates a station carrying `{agentRef}` and nothing else, and `rfNodesToFlow`
 * spreads `gate` in only when the node data has one — so an architect dragged
 * out of the palette arrives here with NO gate. This is the body S4 beat 4's
 * amendment will produce, and the case beat 8 stands on.
 */
test('the body the BUILDER sends — an architect head with no gate — still saves kickoff.kind=idea', async () => {
  const res = await putFlow('placed-arch-flow', {
    create: true,
    name: 'Placed Arch Flow',
    goal: 'Turn an idea into a reviewed change.',
    nodes: [
      { id: 'fn-m5b3x', agent: 'architect', x: 40, y: 120 },
      { id: 'work', agent: 'worker' },
      { id: 'review', gate: 'verdict' },
    ],
    edges: [
      { from: 'fn-m5b3x', to: 'work', artifact: 'PLAN.md' },
      { from: 'work', to: 'review', artifact: 'PR' },
    ],
    triggers: [],
  });
  assert.equal(res.status, 200, await res.text());
  assert.deepEqual(onDisk('placed-arch-flow').kickoff, { kind: 'idea' });
});

test('a head that fans out over work items saves kickoff.kind=initiative-select', async () => {
  const res = await putFlow('fanout-flow', {
    create: true,
    name: 'Fanout Flow',
    goal: 'Build every work item.',
    nodes: [{ id: 'build', agent: 'fanner' }, { id: 'review', gate: 'verdict' }],
    edges: [{ from: 'build', to: 'review', artifact: 'PR' }],
    triggers: [],
  });
  assert.equal(res.status, 200, await res.text());
  assert.deepEqual(onDisk('fanout-flow').kickoff, { kind: 'initiative-select' });
});

test('a save that derives NOTHING reports kickoff: null — absent, never a stale or invented kind', async () => {
  const res = await putFlow('null-report-flow', {
    create: true,
    name: 'Null Report Flow',
    goal: 'Do the thing.',
    nodes: [{ id: 'work', agent: 'worker' }, { id: 'review', gate: 'verdict' }],
    edges: [{ from: 'work', to: 'review', artifact: 'PR' }],
    triggers: [],
  });
  assert.equal(res.status, 200);
  const payload = (await res.json()) as { kickoff?: unknown };
  assert.equal(payload.kickoff, null);
  assert.ok('kickoff' in payload, 'the field must be PRESENT and null, not missing — the builder reads it every save');
});

test('a plain head writes NO kickoff block — the generic launcher stays the default rather than becoming a guess', async () => {
  const res = await putFlow('plain-flow', {
    create: true,
    name: 'Plain Flow',
    goal: 'Do the thing.',
    nodes: [{ id: 'work', agent: 'worker' }, { id: 'review', gate: 'verdict' }],
    edges: [{ from: 'work', to: 'review', artifact: 'PR' }],
    triggers: [],
  });
  assert.equal(res.status, 200, await res.text());
  assert.equal(onDisk('plain-flow').kickoff, undefined);
  assert.doesNotMatch(
    readFileSync(join(forgeRoot, 'studio', 'flows', 'plain-flow', 'flow.yaml'), 'utf8'),
    /kickoff:/,
  );
});

/**
 * THE FILL/OVERWRITE CONTROL at the route (§15.166's class). `declared-flow`
 * declares `trigger-only` — a kind that CANNOT be derived (a flow's own file
 * carries no trigger-entry signal), so it exists only because a human wrote
 * it. The save re-shapes the flow to an architect head, which derives `idea`.
 * The declaration must survive: a route that lets the derivation win here
 * silently retargets an operator's launch surface on an unrelated edit.
 */
test('a DECLARED kickoff survives a save that reshapes the flow into one that would derive a different kind', async () => {
  const before = readFileSync(join(forgeRoot, 'studio', 'flows', 'declared-flow', 'flow.yaml'), 'utf8');
  assert.match(before, /kind: trigger-only/, 'fixture no longer declares the kind this test is about');

  const res = await putFlow('declared-flow', ARCHITECT_HEAD_BODY);
  assert.equal(res.status, 200, await res.text());

  const saved = onDisk('declared-flow');
  assert.deepEqual(saved.kickoff, { kind: 'trigger-only' });
  assert.equal(saved.nodes[0]?.id, 'architect', 'the save itself must have landed — otherwise this proves nothing');
});
