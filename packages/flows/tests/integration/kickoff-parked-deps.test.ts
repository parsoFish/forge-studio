/**
 * forge-nk1y.38 — a kickoff-parked initiative with an unmerged dependency must read BLOCKED.
 *
 * gitweave I3b (2026-10-12): parked at the Kickoff gate in `_queue/ready-for-review/` with
 * `flow_id: forge-architect` and `depends_on_initiatives: [I3a]` while I3a was in flight. The
 * roadmap card read `data-initiative-ready=true`, `data-blocked-by=""` and counted toward
 * "Start eligible", because `checkInitiativeDeps` read `pending/` only and returned [] for any
 * flow_id but forge-develop. The dependency is about the BUILD, so readiness for kickoff is judged
 * on the manifest wherever it is parked, whatever flow it last ran. The scheduler's claim gate is
 * unchanged: a pending decompose run (forge-architect) is still free to plan ahead of its deps.
 *
 * Fixture shape copied from the live I3b manifest (frontmatter keys and values, trimmed).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listPlannedInitiatives } from '../../planned-initiatives.ts';
import { DEVELOP_FLOW_ID } from '../../enqueue-flow-run.ts';
import { checkInitiativeDeps, unmetBuildDeps, UNPARSEABLE_MANIFEST_BLOCKER } from '../../scheduler.ts';
import { getPaths } from '../../queue.ts';

const I3A = 'INIT-2026-10-11-i3a-green-apply-path';
const I3B = 'INIT-2026-10-11-i3b-self-service';

function setup(): string {
  const q = join(mkdtempSync(join(tmpdir(), 'kickoff-deps-')), '_queue');
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'merged', 'done', 'failed']) mkdirSync(join(q, d), { recursive: true });
  return q;
}

function manifest(id: string, flowId: string, deps: string[] = []): string {
  return [
    '---',
    `initiative_id: ${id}`,
    'project: gitweave',
    "created_at: '2026-10-11T00:00:00.000Z'",
    'iteration_budget: 5',
    'cost_budget_usd: 40',
    'class: code',
    'phase: pending',
    'origin: architect',
    `cycle_id: 2026-10-12T05-14-21_${id}`,
    `flow_id: ${flowId}`,
    ...(deps.length > 0 ? ['depends_on_initiatives:', ...deps.map((d) => `  - ${d}`)] : []),
    '---',
    `# ${id}`,
    '',
  ].join('\n');
}

function withQueue(fn: (q: string) => void): void {
  const q = setup();
  try { fn(q); } finally { rmSync(join(q, '..'), { recursive: true, force: true }); }
}

test('I3b parked at kickoff (ready-for-review, forge-architect) behind an in-flight I3a reads BLOCKED by I3a', () => withQueue((q) => {
  writeFileSync(join(q, 'ready-for-review', `${I3B}.md`), manifest(I3B, 'forge-architect', [I3A]));
  writeFileSync(join(q, 'in-flight', `${I3A}.md`), manifest(I3A, DEVELOP_FLOW_ID));
  const planned = listPlannedInitiatives(q, DEVELOP_FLOW_ID);
  const i3b = planned.find((p) => p.initiativeId === I3B);
  assert.ok(i3b, 'I3b is offered on the kickoff surface (an architect hand-off)');
  assert.equal(i3b!.ready, false);
  assert.deepEqual(i3b!.blockedBy, [I3A]);
  assert.deepEqual(unmetBuildDeps(`${I3B}.md`, getPaths(q)), [I3A]);
}));

test('once I3a reaches merged/ (or done/), I3b reads ready', () => withQueue((q) => {
  writeFileSync(join(q, 'ready-for-review', `${I3B}.md`), manifest(I3B, 'forge-architect', [I3A]));
  writeFileSync(join(q, 'in-flight', `${I3A}.md`), manifest(I3A, DEVELOP_FLOW_ID));
  renameSync(join(q, 'in-flight', `${I3A}.md`), join(q, 'merged', `${I3A}.md`));
  const i3b = listPlannedInitiatives(q, DEVELOP_FLOW_ID).find((p) => p.initiativeId === I3B);
  assert.equal(i3b!.ready, true);
  assert.deepEqual(i3b!.blockedBy, []);
}));

test('control — the scheduler claim gate is unchanged: a pending decompose run is not held behind its deps; a pending build is', () => withQueue((q) => {
  const paths = getPaths(q);
  writeFileSync(join(q, 'pending', `${I3B}.md`), manifest(I3B, 'forge-architect', [I3A]));
  assert.deepEqual(checkInitiativeDeps(`${I3B}.md`, paths), [], 'plan-everything-before-kickoff stands');
  writeFileSync(join(q, 'pending', `${I3B}.md`), manifest(I3B, DEVELOP_FLOW_ID, [I3A]));
  assert.deepEqual(checkInitiativeDeps(`${I3B}.md`, paths), [I3A]);
}));

test('refusal: an unreadable kickoff-parked manifest is BLOCKED by name, never ready', () => withQueue((q) => {
  writeFileSync(join(q, 'ready-for-review', `${I3B}.md`), '---\ninitiative_id: [unclosed\n---\n');
  assert.deepEqual(unmetBuildDeps(`${I3B}.md`, getPaths(q)), [UNPARSEABLE_MANIFEST_BLOCKER]);
}));

test('a manifest in neither pending/ nor ready-for-review/ has no kickoff readiness to judge', () => withQueue((q) => {
  writeFileSync(join(q, 'in-flight', `${I3B}.md`), manifest(I3B, DEVELOP_FLOW_ID, [I3A]));
  assert.deepEqual(unmetBuildDeps(`${I3B}.md`, getPaths(q)), []);
}));
