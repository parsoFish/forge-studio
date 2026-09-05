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
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

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
    }>;
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
