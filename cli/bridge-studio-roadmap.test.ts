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
  opts: { flowId?: string; deps?: string[] } = {},
): string {
  const { flowId = 'forge-develop', deps = [] } = opts;
  const depsBlock =
    deps.length > 0
      ? `depends_on_initiatives:\n${deps.map((d) => `  - ${d}`).join('\n')}\n`
      : '';
  return `---
initiative_id: ${id}
project: ${PROJECT_ID}
project_repo_path: /tmp/${PROJECT_ID}
created_at: 2026-06-13T10:00:00.000Z
iteration_budget: 5
cost_budget_usd: 2.0
phase: pending
flow_id: ${flowId}
${depsBlock}---

# ${id}
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
    initiatives: Array<{ initiativeId: string; ready: boolean; blockedBy: string[] }>;
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
