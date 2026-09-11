/**
 * plan-everything-before-kickoff — roadmap eligibility surfaced.
 *
 * Covers `GET /api/studio/projects/:id/roadmap` (buildProjectRoadmap):
 *   - a pending initiative with no deps is ready, blockedBy=[]
 *   - a pending initiative with an unmet build-flow dep is blocked
 *   - a decompose-flow (forge-architect) initiative is NEVER blocked by
 *     unmet deps — mirrors the scheduler's flow_id-aware gate end-to-end
 *   - once the dep lands in done/, the dependent flips to ready
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from '../../ui-bridge.ts';

const PROJECT_ID = 'test-project';

function makeManifest(
  id: string,
  opts: { flowId?: string; deps?: string[]; cycleId?: string; title?: string; body?: string } = {},
): string {
  const { flowId = 'forge-develop', deps = [], cycleId, title, body } = opts;
  const depsBlock =
    deps.length > 0
      ? `depends_on_initiatives:\n${deps.map((d) => `  - ${d}`).join('\n')}\n`
      : '';
  const cycleBlock = cycleId ? `cycle_id: ${cycleId}\n` : '';
  const titleBlock = title ? `title: ${JSON.stringify(title)}\n` : '';
  return `---
initiative_id: ${id}
project: ${PROJECT_ID}
project_repo_path: /tmp/${PROJECT_ID}
created_at: 2026-06-13T10:00:00.000Z
iteration_budget: 5
cost_budget_usd: 2.0
class: code
phase: pending
flow_id: ${flowId}
${depsBlock}${cycleBlock}${titleBlock}---

${body ?? `# ${id}`}
`;
}

function makeWorkItem(id: string, initiativeId: string): string {
  return `---
work_item_id: ${id}
initiative_id: ${initiativeId}
---

## ${id}
`;
}

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-studio-roadmap-'));

  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

  writeFileSync(join(forgeRoot, '_queue', 'pending', 'INIT-A.md'), makeManifest('INIT-A'));
  writeFileSync(
    join(forgeRoot, '_queue', 'pending', 'INIT-B.md'),
    makeManifest('INIT-B', { deps: ['INIT-A'] }),
  );
  writeFileSync(
    join(forgeRoot, '_queue', 'pending', 'INIT-C.md'),
    makeManifest('INIT-C', { flowId: 'forge-architect', deps: ['INIT-A'] }),
  );
  // R4-11-F2: a pending initiative that HAS been decomposed (a WI snapshot
  // exists under its cycle_id) — the "planned" fixture for the roadmap's
  // plan-trigger lock.
  writeFileSync(
    join(forgeRoot, '_queue', 'pending', 'INIT-D.md'),
    makeManifest('INIT-D', { cycleId: 'cycle-init-d' }),
  );
  mkdirSync(join(forgeRoot, '_logs', 'cycle-init-d', 'work-items-snapshot'), { recursive: true });
  writeFileSync(
    join(forgeRoot, '_logs', 'cycle-init-d', 'work-items-snapshot', 'WI-1.md'),
    makeWorkItem('WI-1', 'INIT-D'),
  );

  // `forge-8vfn.7.6.21` — a CLAIMED initiative with no decomposition. This is
  // the shape lane C's S10 run 10 produced: the scheduler moved the manifest to
  // `_queue/in-flight/` and the PM had not yet written a `work_items:` key, so
  // the roadmap's input for that card is `{status: 'in-flight', workItems:
  // undefined}`. The UI side of the same claim is pinned in
  // `apps/studio/tests/contract/roadmap-canvas-render.test.ts`.
  writeFileSync(join(forgeRoot, '_queue', 'in-flight', 'INIT-E.md'), makeManifest('INIT-E'));

  // `forge-8vfn.7.6.23` — a manifest the parser REFUSES. `class` is required
  // (ADR-051, packages/flows/manifest.ts:117, "There is no default"), and this
  // one omits it. Written by hand rather than through makeManifest so the
  // refusal is the fixture's whole point and cannot drift if makeManifest gains
  // a default.
  writeFileSync(
    join(forgeRoot, '_queue', 'pending', 'INIT-UNPARSEABLE.md'),
    [
      '---',
      'initiative_id: INIT-UNPARSEABLE',
      `project: ${PROJECT_ID}`,
      "created_at: '2026-09-11T00:00:00.000Z'",
      'iteration_budget: 1',
      'cost_budget_usd: 1',
      '---',
      '',
      '## no class key',
      '',
    ].join('\n'),
  );

  // `forge-8vfn.7.6.18` — the scheduler CLAIMED this one and then REFUSED its own
  // claim, writing the failing hard-clause NAMES onto the manifest (#646). Real
  // shape: lane C's run 9 left exactly this on gitpulse's manifest, and my own G2
  // resume 7 hit the same clause from the other side.
  writeFileSync(
    join(forgeRoot, '_queue', 'pending', 'INIT-BLOCKED.md'),
    makeManifest('INIT-BLOCKED') + '\n',
  );
  {
    const p = join(forgeRoot, '_queue', 'pending', 'INIT-BLOCKED.md');
    writeFileSync(p, readFileSync(p, 'utf8').replace(/^---\n/, '---\nclaim_blocked_clauses: SKILLS\n'));
  }

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

type RoadmapBody = {
  roadmap: {
    projectId: string;
    initiatives: Array<{
      initiativeId: string;
      title: string;
      status: string;
      ready: boolean;
      blockedBy: string[];
      workItems?: Array<{ id: string }>;
      completedAt?: string;
      blockedClauses?: string[];
    }>;
    unparseable?: Array<{ path: string; message: string }>;
  };
};

async function fetchRoadmap(): Promise<RoadmapBody['roadmap']> {
  const res = await fetch(`${bridgeUrl}/api/studio/projects/${PROJECT_ID}/roadmap`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as RoadmapBody;
  return body.roadmap;
}

test('roadmap: pending initiative with no deps → ready=true, blockedBy=[]', async () => {
  const roadmap = await fetchRoadmap();
  const a = roadmap.initiatives.find((i) => i.initiativeId === 'INIT-A');
  assert.ok(a, 'INIT-A present in roadmap');
  assert.equal(a!.ready, true);
  assert.deepEqual(a!.blockedBy, []);
});

test('roadmap: pending initiative with unmet build-flow dep → ready=false, blockedBy=[dep]', async () => {
  const roadmap = await fetchRoadmap();
  const b = roadmap.initiatives.find((i) => i.initiativeId === 'INIT-B');
  assert.ok(b, 'INIT-B present in roadmap');
  assert.equal(b!.ready, false);
  assert.deepEqual(b!.blockedBy, ['INIT-A']);
});

test('roadmap: flow_id=forge-architect (decompose) → ready=true even with unmet dep', async () => {
  const roadmap = await fetchRoadmap();
  const c = roadmap.initiatives.find((i) => i.initiativeId === 'INIT-C');
  assert.ok(c, 'INIT-C present in roadmap');
  assert.equal(c!.ready, true);
  assert.deepEqual(c!.blockedBy, []);
});

test('roadmap: malformed frontmatter in pending/ → skipped by the builder, never surfaces as ready', async () => {
  // No frontmatter at all — parseManifest throws. The builder must fail SAFE:
  // the unreadable initiative is dropped from the roadmap entirely (and the
  // scheduler gate independently blocks it via UNPARSEABLE_MANIFEST_BLOCKER),
  // rather than surfacing it as a ready/startable card.
  const badPath = join(forgeRoot, '_queue', 'pending', 'INIT-BAD.md');
  writeFileSync(badPath, '# not a manifest\n');
  try {
    const roadmap = await fetchRoadmap();
    const bad = roadmap.initiatives.find((i) => i.initiativeId === 'INIT-BAD');
    assert.equal(bad, undefined, 'the unparseable manifest is not listed (and so can never show ready)');
  } finally {
    rmSync(badPath, { force: true });
  }
});

test('roadmap: pending initiative with no WI snapshot → workItems undefined (unplanned)', async () => {
  const roadmap = await fetchRoadmap();
  const a = roadmap.initiatives.find((i) => i.initiativeId === 'INIT-A');
  assert.ok(a, 'INIT-A present in roadmap');
  assert.equal(a!.status, 'pending');
  assert.equal(a!.workItems, undefined, 'no WI snapshot exists yet — reads as unplanned');
});

test('roadmap: pending initiative with cycle_id + WI snapshot → workItems defined (planned)', async () => {
  const roadmap = await fetchRoadmap();
  const d = roadmap.initiatives.find((i) => i.initiativeId === 'INIT-D');
  assert.ok(d, 'INIT-D present in roadmap');
  assert.equal(d!.status, 'pending', 'still queue-pending — decomposition is independent of queue state');
  assert.ok(d!.workItems, 'a WI snapshot exists — reads as planned even while pending');
  assert.deepEqual(
    d!.workItems!.map((w) => w.id),
    ['WI-1'],
  );
});

// ---------------------------------------------------------------------------
// mock finding I3 → W7-A4 (projects-10 / flows-26): title source. betterado
// manifests all open their body with the SAME boilerplate heading ("Goal" /
// "Summary" / "Context" / "Overview"), so a heading scrape put one word on
// every card — and the "skip boilerplate" refinement still titled 52 cards
// "Background" / "Constraints" / "Acceptance criteria". The ONE derivation
// (`initiativeTitle`, orchestrator/manifest.ts) is metadata-only: frontmatter
// `title:` > initiativeId. A body heading is NEVER a title.
// ---------------------------------------------------------------------------

test('roadmap: a body whose headings are section labels — the card title is the initiativeId, never a scraped heading (W7-A4)', async () => {
  const path = join(forgeRoot, '_queue', 'pending', 'INIT-TITLE1.md');
  writeFileSync(
    path,
    makeManifest('INIT-TITLE1', {
      body: '## Goal\n\nShip a dark-mode toggle.\n\n## Add dark mode toggle\n\nImplement the settings switch.',
    }),
  );
  try {
    const roadmap = await fetchRoadmap();
    const t = roadmap.initiatives.find((i) => i.initiativeId === 'INIT-TITLE1');
    assert.ok(t, 'INIT-TITLE1 present in roadmap');
    assert.equal(t!.title, 'INIT-TITLE1');
  } finally {
    rmSync(path, { force: true });
  }
});

test('roadmap: every heading is boilerplate → the card title falls back to the initiativeId, never a boilerplate word', async () => {
  const path = join(forgeRoot, '_queue', 'pending', 'INIT-TITLE2.md');
  writeFileSync(
    path,
    makeManifest('INIT-TITLE2', {
      body: '## Goal\n\nShip it.\n\n## Summary\n\nDetails.\n\n## Context\n\nBackground.',
    }),
  );
  try {
    const roadmap = await fetchRoadmap();
    const t = roadmap.initiatives.find((i) => i.initiativeId === 'INIT-TITLE2');
    assert.ok(t, 'INIT-TITLE2 present in roadmap');
    assert.equal(t!.title, 'INIT-TITLE2');
  } finally {
    rmSync(path, { force: true });
  }
});

test('roadmap: a frontmatter title: field wins over heading scrape entirely', async () => {
  const path = join(forgeRoot, '_queue', 'pending', 'INIT-TITLE3.md');
  writeFileSync(
    path,
    makeManifest('INIT-TITLE3', {
      title: 'Dark mode toggle for the settings page',
      body: '## Goal\n\nShip a dark-mode toggle.\n',
    }),
  );
  try {
    const roadmap = await fetchRoadmap();
    const t = roadmap.initiatives.find((i) => i.initiativeId === 'INIT-TITLE3');
    assert.ok(t, 'INIT-TITLE3 present in roadmap');
    assert.equal(t!.title, 'Dark mode toggle for the settings page');
  } finally {
    rmSync(path, { force: true });
  }
});

// ---------------------------------------------------------------------------
// W6-RV-2: completedAt threaded from the memoized run derivation (no second
// events.jsonl parser) — packages/flows/run-list-cache.ts::cachedListRuns.
// ---------------------------------------------------------------------------

test('roadmap: a done initiative with a real cycle.end event carries completedAt', async () => {
  const cycleId = 'cycle-init-e';
  writeFileSync(
    join(forgeRoot, '_queue', 'done', 'INIT-E.md'),
    makeManifest('INIT-E', { cycleId }),
  );
  mkdirSync(join(forgeRoot, '_logs', cycleId), { recursive: true });
  const completedIso = '2026-06-20T03:15:00.000Z';
  writeFileSync(
    join(forgeRoot, '_logs', cycleId, 'events.jsonl'),
    [
      JSON.stringify({
        event_id: 'EV_1', cycle_id: cycleId, initiative_id: 'INIT-E',
        phase: 'orchestrator', skill: 'cycle', event_type: 'start',
        input_refs: [], output_refs: [], started_at: '2026-06-20T02:00:00.000Z', message: 'cycle.start',
      }),
      JSON.stringify({
        event_id: 'EV_2', cycle_id: cycleId, initiative_id: 'INIT-E',
        phase: 'orchestrator', skill: 'cycle', event_type: 'end',
        input_refs: [], output_refs: [], started_at: completedIso, message: 'cycle.end',
        metadata: { status: 'done' },
      }),
    ].join('\n') + '\n',
  );
  try {
    const roadmap = await fetchRoadmap();
    const e = roadmap.initiatives.find((i) => i.initiativeId === 'INIT-E');
    assert.ok(e, 'INIT-E present in roadmap');
    assert.equal(e!.completedAt, completedIso, 'completedAt is the real cycle.end started_at');
  } finally {
    rmSync(join(forgeRoot, '_queue', 'done', 'INIT-E.md'), { force: true });
    rmSync(join(forgeRoot, '_logs', cycleId), { recursive: true, force: true });
  }
});

test('roadmap: a pending initiative with no cycle log has no completedAt (never fabricated)', async () => {
  const roadmap = await fetchRoadmap();
  const a = roadmap.initiatives.find((i) => i.initiativeId === 'INIT-A');
  assert.ok(a, 'INIT-A present in roadmap');
  assert.equal(a!.completedAt, undefined, 'no cycle log yet — completedAt stays honestly absent');
});

test('roadmap: dep moves to done/ → dependent initiative flips to ready', async () => {
  renameSync(
    join(forgeRoot, '_queue', 'pending', 'INIT-A.md'),
    join(forgeRoot, '_queue', 'done', 'INIT-A.md'),
  );
  try {
    const roadmap = await fetchRoadmap();
    const b = roadmap.initiatives.find((i) => i.initiativeId === 'INIT-B');
    assert.ok(b, 'INIT-B present in roadmap');
    assert.equal(b!.ready, true);
    assert.deepEqual(b!.blockedBy, []);
  } finally {
    // Restore so any later test in this file sees the original fixture state.
    renameSync(
      join(forgeRoot, '_queue', 'done', 'INIT-A.md'),
      join(forgeRoot, '_queue', 'pending', 'INIT-A.md'),
    );
  }
});

test('roadmap: CLAIMED initiative with no WI snapshot → status in-flight, workItems undefined (`forge-8vfn.7.6.21`)', async () => {
  const roadmap = await fetchRoadmap();
  const e = roadmap.initiatives.find((i) => i.initiativeId === 'INIT-E');
  assert.ok(e, 'INIT-E present in roadmap');
  assert.equal(e!.status, 'in-flight', 'the scheduler claimed it — the manifest sits in _queue/in-flight/');
  assert.equal(
    e!.workItems,
    undefined,
    'and nothing has decomposed it yet — a claim is not a plan, which is exactly what the card must not call "planned"',
  );
});

// ---------------------------------------------------------------------------
// `forge-8vfn.7.6.23` — a manifest that fails to parse must be NAMED, never
// silently skipped.
//
// `parseManifest` is deliberately fail-fast; `scanProjectManifests` wrapped it in
// `catch { continue; }` and threw that verdict away. Measured cost: three seeded
// manifests on disk, route 200 with `count: 0`, and a page reporting "No
// initiatives found for this project" — which is a DIFFERENT problem from the one
// that was true, with a different fix.
//
// §15.400 — what else could make these assertions pass? A count alone would pass
// if any other fixture happened to be unparseable, so each asserts the PATH and
// the parser's own MESSAGE, and the last one asserts the good initiatives are
// STILL returned: a change that made the whole scan fail closed would satisfy a
// "names the bad one" test while destroying the route.
// ---------------------------------------------------------------------------

test('roadmap: a manifest the parser refuses is REPORTED with its path and the parser\'s own message (`forge-8vfn.7.6.23`)', async () => {
  const roadmap = await fetchRoadmap();
  const bad = (roadmap.unparseable ?? []).find((u) => u.path.endsWith('INIT-UNPARSEABLE.md'));
  assert.ok(bad, `the unparseable manifest must be named — got ${JSON.stringify(roadmap.unparseable ?? [])}`);
  assert.match(
    bad!.message,
    /class/,
    'and the parser\'s own message must travel, so the operator learns WHICH field, not merely that something failed',
  );
});

test('roadmap: the refused manifest is NOT counted as an initiative, and the good ones still are', async () => {
  const roadmap = await fetchRoadmap();
  assert.equal(
    roadmap.initiatives.find((i) => i.initiativeId === 'INIT-UNPARSEABLE'),
    undefined,
    'a manifest that would not parse cannot appear as an initiative',
  );
  for (const id of ['INIT-A', 'INIT-D', 'INIT-E']) {
    assert.ok(
      roadmap.initiatives.find((i) => i.initiativeId === id),
      `${id} must still be returned — naming the bad manifest must not fail the whole scan closed`,
    );
  }
});

// ---------------------------------------------------------------------------
// `forge-8vfn.7.6.18` — the daemon's own refusal reaches the surface.
//
// The hard gate is RIGHT and stays: a project that is not contract-ready must not
// have work claimed against it. The defect is that the fact the daemon knows,
// decides on, and WRITES DOWN never reached the roadmap or the start-work view,
// so the operator watched a queue that simply did not move. Measured by lane C
// (run 9, gitpulse, twenty minutes reading `unplanned`) and by me from the other
// side (G2 resume 7, four seconds, $0.00, the same SKILLS clause).
//
// §15.400 — what else could make these pass? `ready` alone would pass if the
// initiative were dependency-blocked for an unrelated reason, so the first test
// asserts blockedBy is EMPTY while ready is false: the clause is the only cause.
// ---------------------------------------------------------------------------

test('roadmap: a claim the scheduler REFUSED carries its failing clause names, and is not ready (`forge-8vfn.7.6.18`)', async () => {
  const roadmap = await fetchRoadmap();
  const b = roadmap.initiatives.find((i) => i.initiativeId === 'INIT-BLOCKED');
  assert.ok(b, 'INIT-BLOCKED present in the roadmap');
  assert.deepEqual(b!.blockedClauses, ['SKILLS'], 'the failing hard-clause NAMES travel, not merely a boolean');
  assert.deepEqual(b!.blockedBy, [], 'and it is not dependency-blocked — the clause is the only reason it is held');
  assert.equal(b!.ready, false, 'so it must not read ready, which is what offered it to Plan for twenty minutes');
});

test('roadmap: an initiative with no refusal carries no clauses and stays ready', async () => {
  const roadmap = await fetchRoadmap();
  const a = roadmap.initiatives.find((i) => i.initiativeId === 'INIT-A');
  assert.ok(a, 'INIT-A present');
  assert.equal(a!.ready, true, 'the fix must not hold back an initiative nothing refused');
  assert.ok(
    a!.blockedClauses === undefined || a!.blockedClauses.length === 0,
    'and it carries no clause names',
  );
});
