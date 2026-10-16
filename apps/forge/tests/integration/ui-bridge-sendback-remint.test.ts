/**
 * forge-mfv5.1.47 (row 3) — the send-back event the REAL verdict door writes is
 * enough to re-mint its fix work item byte-for-byte after `.forge/work-items/`
 * is lost: post a send-back through the bridge, keep a snapshot of the dev
 * items only (the measured I3b shape — the snapshot predates the fix item),
 * wipe the queue, restore, and compare the re-minted file with the one the
 * bridge compiled. Two shapes: a typed send-back (checks, its own gate and
 * scope) and a comments send-back (no gate of its own — the project gate).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { startBridge } from '../../ui-bridge.ts';
import { serializeWorkItem } from '@forge/flows';
import { restoreWorkItemsForResume } from '@forge/stations';

function setup(slug: string): { forgeRoot: string; worktreePath: string; initiativeId: string; cycleId: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), `bv-remint-${slug}-`));
  const initiativeId = `INIT-2026-10-16-${slug}`;
  const worktreePath = join(forgeRoot, '_worktrees', initiativeId);
  const projectRepoPath = join(forgeRoot, 'projects', 'test-project');
  mkdirSync(join(worktreePath, '.forge', 'work-items'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', worktreePath]);
  execFileSync('git', ['-C', worktreePath, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base']);
  mkdirSync(projectRepoPath, { recursive: true });
  const cycleId = `2026-10-16T00-00-00_${initiativeId}`;
  writeFileSync(
    join(worktreePath, '.forge', 'work-items', 'WI-1.md'),
    serializeWorkItem({
      work_item_id: 'WI-1', initiative_id: initiativeId, status: 'complete', depends_on: [],
      acceptance_criteria: [{ given: 'g', when: 'w', then: 't' }], files_in_scope: ['src/a.ts'],
      quality_gate_cmd: ['npm', 'test'], estimated_iterations: 3, body: '# WI-1\n',
    }),
  );
  const snap = join(forgeRoot, '_logs', cycleId, 'work-items-snapshot');
  mkdirSync(snap, { recursive: true });
  cpSync(join(worktreePath, '.forge', 'work-items', 'WI-1.md'), join(snap, 'WI-1.md'));
  const rfr = join(forgeRoot, '_queue', 'ready-for-review');
  mkdirSync(rfr, { recursive: true });
  writeFileSync(join(rfr, `${initiativeId}.md`), [
    '---', `initiative_id: ${initiativeId}`, `cycle_id: ${cycleId}`, 'project: test-project',
    `project_repo_path: ${projectRepoPath}`, `worktree_path: ${worktreePath}`,
    'created_at: 2026-10-16T00:00:00.000Z', 'iteration_budget: 5', 'cost_budget_usd: 2.0', 'class: code',
    '---', '', '# Test initiative',
  ].join('\n'));
  return { forgeRoot, worktreePath, initiativeId, cycleId };
}

async function sendBackThenRemint(slug: string, verdict: Record<string, unknown>): Promise<{ compiled: string; reminted: string; result: unknown }> {
  const w = setup(slug);
  const { url, close } = await startBridge({
    forgeRoot: w.forgeRoot,
    port: 0,
    mergePr: () => { throw new Error('mergePr must not be called on send-back'); },
    finalizeAfterMerge: async () => { throw new Error('finalizeAfterMerge must not be called on send-back'); },
  });
  try {
    const res = await fetch(`${url}/api/verdict`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      body: JSON.stringify({ initiativeId: w.initiativeId, kind: 'send-back', ...verdict }),
    });
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    const compiled = readFileSync(join(w.worktreePath, '.forge', 'work-items', 'WI-2.md'), 'utf8');
    rmSync(join(w.worktreePath, '.forge', 'work-items'), { recursive: true, force: true }); // the measured loss
    const result = restoreWorkItemsForResume({ worktreePath: w.worktreePath, initiativeId: w.initiativeId, cycleId: w.cycleId, logsRoot: join(w.forgeRoot, '_logs') });
    const reminted = readFileSync(join(w.worktreePath, '.forge', 'work-items', 'WI-2.md'), 'utf8');
    return { compiled, reminted, result };
  } finally {
    await close();
    rmSync(w.forgeRoot, { recursive: true, force: true });
  }
}

test('re-mint: a TYPED send-back (checks, own gate, own scope) re-mints byte-identical to what the bridge compiled', async () => {
  const { compiled, reminted, result } = await sendBackThenRemint('typed', {
    rationale: 'AC1 unmet at head: the run must fail naming the var.',
    acceptanceCriteria: [{ given: 'the acceptance tier', when: 'pytest runs', then: 'it fails naming GW_CALLER_TOKEN', check: { argv: ['python3', '-m', 'pytest', 'tests/acceptance', '-q'], expect: 'fail', unsetEnv: ['GW_CALLER_TOKEN'] } }],
    concernKind: 'code-fix',
    qualityGateCmd: ['python3', '-m', 'pytest', 'tests/'],
    filesInScope: ['tests/acceptance/test_x.py'],
  });
  assert.deepEqual(result, { status: 'restored', fromSnapshot: ['WI-1'], reminted: ['WI-2'] });
  assert.equal(reminted, compiled);
});

test('re-mint: a COMMENTS send-back (no gate of its own) re-mints byte-identical — the event records the gate the item got', async () => {
  const { compiled, reminted, result } = await sendBackThenRemint('comments', {
    rationale: 'The demo shows a test-name table, not the live GET response.',
    acceptanceCriteria: [{ given: 'the review page', when: 'the demo renders', then: 'the live GET response is embedded' }],
    derivedFrom: 'comments',
    concernKind: 'code-fix',
  });
  assert.deepEqual(result, { status: 'restored', fromSnapshot: ['WI-1'], reminted: ['WI-2'] });
  assert.equal(reminted, compiled);
});
