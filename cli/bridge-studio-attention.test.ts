/**
 * R4-11-T4 (F4) — cross-project attention aggregate.
 *
 * Covers `GET /api/studio/projects/attention` (buildProjectAttention):
 *   - planned/in-flight/gated/merged counts per registered project, scoped
 *     by manifest ownership (project frontmatter), not just queue-dir totals
 *   - the completeness-flagged count reads the LATEST `plan.completeness`
 *     event per initiative (R4-05-F6) — a re-decomposition's newer event
 *     wins over a stale flagged one
 *   - every item carries a link-through to its project's roadmap
 *   - best-effort: an unregistered/malformed project never throws the whole
 *     aggregate
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

const PROJECT_A = 'attn-project-a';
const PROJECT_B = 'attn-project-b';

function makeManifest(
  id: string,
  project: string,
  opts: { cycleId?: string } = {},
): string {
  const cycleBlock = opts.cycleId ? `cycle_id: ${opts.cycleId}\n` : '';
  return `---
initiative_id: ${id}
project: ${project}
project_repo_path: /tmp/${project}
created_at: 2026-07-18T10:00:00.000Z
iteration_budget: 5
cost_budget_usd: 2.0
phase: pending
flow_id: forge-develop
${cycleBlock}---

# ${id}
`;
}

function makeCompletenessEvent(cycleId: string, initId: string, flagged: boolean, eventId: string): string {
  return JSON.stringify({
    event_id: eventId,
    cycle_id: cycleId,
    initiative_id: initId,
    phase: 'project-manager',
    skill: 'project-manager',
    event_type: 'log',
    input_refs: [],
    output_refs: [],
    started_at: '2026-07-18T10:05:00.000Z',
    message: 'plan.completeness',
    metadata: { stated_units: 3, covered_units: flagged ? 2 : 3, uncovered: flagged ? ['a stated unit'] : [], flagged },
  });
}

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-studio-attention-'));

  for (const state of ['pending', 'in-flight', 'ready-for-review', 'merged', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

  // Projects are auto-discovered from disk (B1).
  mkdirSync(join(forgeRoot, 'projects', PROJECT_A, '.forge'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'projects', PROJECT_A, '.forge', 'project.json'),
    JSON.stringify({ name: 'Attention Project A' }),
  );
  mkdirSync(join(forgeRoot, 'projects', PROJECT_B), { recursive: true });

  // ---- Project A: one initiative in each attention-bearing state ----------
  writeFileSync(join(forgeRoot, '_queue', 'pending', 'A-PLANNED.md'), makeManifest('A-PLANNED', PROJECT_A));
  writeFileSync(join(forgeRoot, '_queue', 'in-flight', 'A-INFLIGHT.md'), makeManifest('A-INFLIGHT', PROJECT_A));
  writeFileSync(join(forgeRoot, '_queue', 'ready-for-review', 'A-GATED.md'), makeManifest('A-GATED', PROJECT_A));
  writeFileSync(join(forgeRoot, '_queue', 'merged', 'A-MERGED.md'), makeManifest('A-MERGED', PROJECT_A));
  // Not attention-bearing — must not be counted anywhere.
  writeFileSync(join(forgeRoot, '_queue', 'done', 'A-DONE.md'), makeManifest('A-DONE', PROJECT_A));
  writeFileSync(join(forgeRoot, '_queue', 'failed', 'A-FAILED.md'), makeManifest('A-FAILED', PROJECT_A));

  // ---- Project B: completeness-flag fixtures -------------------------------
  // B-FLAGGED: latest plan.completeness event is flagged=true.
  writeFileSync(
    join(forgeRoot, '_queue', 'pending', 'B-FLAGGED.md'),
    makeManifest('B-FLAGGED', PROJECT_B, { cycleId: 'cycle-b-flagged' }),
  );
  mkdirSync(join(forgeRoot, '_logs', 'cycle-b-flagged'), { recursive: true });
  writeFileSync(
    join(forgeRoot, '_logs', 'cycle-b-flagged', 'events.jsonl'),
    makeCompletenessEvent('cycle-b-flagged', 'B-FLAGGED', true, 'EV_1') + '\n',
  );

  // B-RESOLVED: an EARLIER flagged=true event, then a LATER flagged=false
  // event (a re-decomposition covered the gap) — the latest must win.
  writeFileSync(
    join(forgeRoot, '_queue', 'pending', 'B-RESOLVED.md'),
    makeManifest('B-RESOLVED', PROJECT_B, { cycleId: 'cycle-b-resolved' }),
  );
  mkdirSync(join(forgeRoot, '_logs', 'cycle-b-resolved'), { recursive: true });
  writeFileSync(
    join(forgeRoot, '_logs', 'cycle-b-resolved', 'events.jsonl'),
    [
      makeCompletenessEvent('cycle-b-resolved', 'B-RESOLVED', true, 'EV_1'),
      makeCompletenessEvent('cycle-b-resolved', 'B-RESOLVED', false, 'EV_2'),
    ].join('\n') + '\n',
  );

  // B-CLEAN: no cycle_id / no events at all — never flagged, never throws.
  writeFileSync(join(forgeRoot, '_queue', 'pending', 'B-CLEAN.md'), makeManifest('B-CLEAN', PROJECT_B));

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

type AttentionItem = {
  projectId: string;
  name: string;
  link: string;
  planned: number;
  inFlight: number;
  gated: number;
  merged: number;
  flagged: number;
};

async function fetchAttention(): Promise<AttentionItem[]> {
  const res = await fetch(`${bridgeUrl}/api/studio/projects/attention`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { attention: AttentionItem[] };
  return body.attention;
}

test('attention: returns one entry per registered project', async () => {
  const attention = await fetchAttention();
  const ids = attention.map((a) => a.projectId).sort();
  assert.deepEqual(ids, [PROJECT_A, PROJECT_B].sort());
});

test('attention: project A counts planned/in-flight/gated/merged, ignores done/failed', async () => {
  const attention = await fetchAttention();
  const a = attention.find((x) => x.projectId === PROJECT_A);
  assert.ok(a, 'project A present');
  assert.equal(a!.planned, 1);
  assert.equal(a!.inFlight, 1);
  assert.equal(a!.gated, 1);
  assert.equal(a!.merged, 1);
});

test('attention: name sources from project.json when present, falls back to id otherwise', async () => {
  const attention = await fetchAttention();
  const a = attention.find((x) => x.projectId === PROJECT_A);
  const b = attention.find((x) => x.projectId === PROJECT_B);
  assert.equal(a!.name, 'Attention Project A');
  assert.equal(b!.name, PROJECT_B);
});

test('attention: every item links through to its project roadmap surface', async () => {
  const attention = await fetchAttention();
  for (const item of attention) {
    assert.equal(item.link, `/projects/${item.projectId}`);
  }
});

test('attention: completeness-flagged counts the LATEST plan.completeness event per initiative', async () => {
  const attention = await fetchAttention();
  const b = attention.find((x) => x.projectId === PROJECT_B);
  assert.ok(b, 'project B present');
  // B-FLAGGED (flagged) + B-RESOLVED (latest event flips to false, excluded) + B-CLEAN (no events) → 1.
  assert.equal(b!.flagged, 1);
});
