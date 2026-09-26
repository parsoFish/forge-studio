import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync  } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listPlannedInitiatives } from '../../planned-initiatives.ts';
import { DEVELOP_FLOW_ID } from '../../enqueue-flow-run.ts';

function setup(): string {
  const queueRoot = join(mkdtempSync(join(tmpdir(), 'planned-')), '_queue');
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(queueRoot, d), { recursive: true });
  }
  return queueRoot;
}

function manifest(id: string, opts: { project?: string; deps?: string[]; title?: string } = {}): string {
  const lines = [
    '---',
    `initiative_id: ${id}`,
    `project: ${opts.project ?? 'demo'}`,
    "created_at: '2026-06-26T00:00:00.000Z'",
    'iteration_budget: 2',
    'cost_budget_usd: 1',
    'class: code',
    'phase: pending',
    'origin: architect',
  ];
  if (opts.deps && opts.deps.length) {
    lines.push('depends_on_initiatives:');
    for (const d of opts.deps) lines.push(`  - ${d}`);
  }
  lines.push('---', `# ${opts.title ?? id}`, '');
  return lines.join('\n');
}

test('lists pending initiatives, all ready when no deps', () => {
  const q = setup();
  try {
    writeFileSync(join(q, 'pending', 'INIT-2026-06-26-a.md'), manifest('INIT-2026-06-26-a', { title: 'Alpha feature' }));
    const planned = listPlannedInitiatives(q, DEVELOP_FLOW_ID);
    assert.equal(planned.length, 1);
    assert.equal(planned[0].initiativeId, 'INIT-2026-06-26-a');
    assert.equal(planned[0].project, 'demo');
    assert.equal(planned[0].title, 'Alpha feature');
    assert.equal(planned[0].ready, true);
    assert.deepEqual(planned[0].blockedBy, []);
  } finally {
    rmSync(join(q, '..'), { recursive: true, force: true });
  }
});

test('marks blocked when a dependency is not yet in done/', () => {
  const q = setup();
  try {
    writeFileSync(join(q, 'pending', 'INIT-2026-06-26-b.md'), manifest('INIT-2026-06-26-b', { deps: ['INIT-2026-06-26-a'] }));
    const planned = listPlannedInitiatives(q, DEVELOP_FLOW_ID);
    assert.equal(planned[0].ready, false);
    assert.deepEqual(planned[0].blockedBy, ['INIT-2026-06-26-a']);
  } finally {
    rmSync(join(q, '..'), { recursive: true, force: true });
  }
});

test('dependency satisfied once it lands in done/ → ready', () => {
  const q = setup();
  try {
    writeFileSync(join(q, 'pending', 'INIT-2026-06-26-b.md'), manifest('INIT-2026-06-26-b', { deps: ['INIT-2026-06-26-a'] }));
    writeFileSync(join(q, 'done', 'INIT-2026-06-26-a.md'), manifest('INIT-2026-06-26-a'));
    const planned = listPlannedInitiatives(q, DEVELOP_FLOW_ID);
    assert.equal(planned[0].ready, true);
    assert.deepEqual(planned[0].blockedBy, []);
  } finally {
    rmSync(join(q, '..'), { recursive: true, force: true });
  }
});

test('empty pending → []', () => {
  const q = setup();
  try {
    assert.deepEqual(listPlannedInitiatives(q, DEVELOP_FLOW_ID), []);
  } finally {
    rmSync(join(q, '..'), { recursive: true, force: true });
  }
});

/*
 * `forge-8vfn.7.6.132` — the develop kickoff surface lists the HAND-OFF
 * manifests too, not only `_queue/pending/`. T1 ruling 1124.
 *
 * `/api/runs/planned` is the forge-develop kickoff surface, and it listed
 * `_queue/pending/` alone. `enqueueFlowRun` has always ALSO claimed a
 * `ready-for-review` manifest whose `flow_id` differs from the target — its own
 * comment names "forge-architect finalised with no review node" as exactly that
 * case. So the surface could not offer what the server would accept, and S10
 * run 19 walked into it: `flow_id: forge-architect` parked in
 * `_queue/ready-for-review/`, claimable, offered by nothing.
 *
 * The filter is now `isRunnableSource`, the one predicate that lives beside the
 * server's rule, so this surface cannot drift from it again.
 */
test('7.6.132: a ready-for-review architect manifest IS listed for the develop surface', () => {
  const q = setup();
  try {
    mkdirSync(join(q, 'ready-for-review'), { recursive: true });
    writeFileSync(
      join(q, 'ready-for-review', 'INIT-handoff.md'),
      manifest('INIT-handoff', { title: 'Planned by the architect' }).replace('origin: architect', 'origin: architect\nflow_id: forge-architect'),
    );
    const planned = listPlannedInitiatives(q, DEVELOP_FLOW_ID);
    assert.equal(planned.length, 1, 'the hand-off must be offered — the server would claim it');
    assert.equal(planned[0].initiativeId, 'INIT-handoff');
  } finally { rmSync(join(q, '..'), { recursive: true, force: true }); }
});

test('7.6.132: a ready-for-review manifest of the TARGET flow is NOT listed', () => {
  // The guard half. A develop cycle parked at its own gate must not be offered
  // as a source for another develop run — that is the sibling race the server
  // refuses at `:160`, and widening the surface without this would create it.
  const q = setup();
  try {
    mkdirSync(join(q, 'ready-for-review'), { recursive: true });
    writeFileSync(
      join(q, 'ready-for-review', 'INIT-parked.md'),
      manifest('INIT-parked').replace('origin: architect', 'origin: architect\nflow_id: forge-develop'),
    );
    assert.deepEqual(listPlannedInitiatives(q, DEVELOP_FLOW_ID), []);
  } finally { rmSync(join(q, '..'), { recursive: true, force: true }); }
});

test('7.6.132: a ready-for-review manifest with NO flow id is not listed', () => {
  // §15.504 reaching the surface: an unreadable flow id must not become "a
  // different flow", or an unidentifiable parked manifest gets offered as a
  // source.
  const q = setup();
  try {
    mkdirSync(join(q, 'ready-for-review'), { recursive: true });
    writeFileSync(join(q, 'ready-for-review', 'INIT-noflow.md'), manifest('INIT-noflow'));
    assert.deepEqual(listPlannedInitiatives(q, DEVELOP_FLOW_ID), []);
  } finally { rmSync(join(q, '..'), { recursive: true, force: true }); }
});
