/**
 * W7-B7 pins (artifact-plan-18) — POST /api/runs/:id/gates/verdict must accept
 * the run HANDLE the UI actually posts.
 *
 * Live-reproduced defect: run ids on this route are routinely CYCLE ids
 * (`<timestamp>_INIT-…` — the monitor's amber demo pill and GateBar both post
 * the `?run=` handle), but the branch passed `initiativeId: runId` straight to
 * `applyReviewVerdict`, whose INIT_ID_RE check 400s
 * "initiativeId must match INIT-YYYY-MM-DD-slug format" — so the demo gate bar
 * was dead on every real run (approve silently, send-back with a rendered
 * error). The fix recovers the embedded initiative id server-side (strip the
 * `<timestamp>_` prefix when the tail matches the manifest id convention) —
 * defence in depth alongside the client's own `effectiveInitiativeId`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { recoverInitiativeId } from './bridge-studio-runs.ts';
import { startBridge } from './ui-bridge.ts';

// ---------------------------------------------------------------------------
// Pure recovery rule
// ---------------------------------------------------------------------------

test('recoverInitiativeId: a bare INIT- id passes through unchanged', () => {
  assert.equal(recoverInitiativeId('INIT-2026-07-11-cli-sort-flag'), 'INIT-2026-07-11-cli-sort-flag');
});

test('recoverInitiativeId: a cycle id yields its embedded initiative id', () => {
  assert.equal(
    recoverInitiativeId('2026-07-11T17-26-34_INIT-2026-07-11-cli-sort-flag'),
    'INIT-2026-07-11-cli-sort-flag',
  );
});

test('recoverInitiativeId: an unrecoverable id is returned verbatim (the route 400s downstream, unchanged)', () => {
  assert.equal(recoverInitiativeId('not-a-run'), 'not-a-run');
  // The tail after the first `_` is not INIT-shaped either — no false recovery.
  assert.equal(recoverInitiativeId('2026-01-01T00-00-00_nonsense'), '2026-01-01T00-00-00_nonsense');
});

// ---------------------------------------------------------------------------
// Route-level: a cycle-id POST reaches the verdict handler (no format 400)
// ---------------------------------------------------------------------------

function manifestMd(overrides: Record<string, unknown>): string {
  const id = overrides.initiative_id as string;
  const data: Record<string, unknown> = {
    initiative_id: id,
    project: 'test-project',
    created_at: '2026-01-01T00:00:00.000Z',
    iteration_budget: 5,
    cost_budget_usd: 2.0,
    ...overrides,
  };
  const yamlLines = Object.entries(data).map(
    ([k, v]) => `${k}: ${typeof v === 'string' ? JSON.stringify(v) : v}`,
  );
  return ['---', ...yamlLines, '---', '', `# ${id}`, ''].join('\n');
}

test('POST /api/runs/<cycleId>/gates/verdict approve: the cycle id resolves to its initiative and the verdict applies (was a 400 dead control)', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'b7-gate-id-'));
  try {
    for (const s of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
      mkdirSync(join(forgeRoot, '_queue', s), { recursive: true });
    }
    mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
    mkdirSync(join(forgeRoot, '_worktrees'), { recursive: true });
    mkdirSync(join(forgeRoot, 'projects'), { recursive: true });

    const id = 'INIT-2026-01-01-gate-id-recovery';
    const cycleId = `2026-01-01T00-00-00_${id}`;
    const wt = join(forgeRoot, '_worktrees', id);
    mkdirSync(wt, { recursive: true });
    writeFileSync(
      join(forgeRoot, '_queue', 'ready-for-review', `${id}.md`),
      manifestMd({ initiative_id: id, worktree_path: wt, cycle_id: cycleId }),
    );

    const { url, close } = await startBridge({
      forgeRoot,
      port: 0,
      mergePr: () => true,
      finalizeAfterMerge: async () => {},
    });
    try {
      const res = await fetch(`${url}/api/runs/${encodeURIComponent(cycleId)}/gates/verdict`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
        body: JSON.stringify({ verdict: 'approve', rationale: 'demo gate approve' }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(res.status, 200, `expected the recovered initiative id to apply (got ${res.status}: ${JSON.stringify(body)})`);
      assert.equal(body.ok, true);
    } finally {
      await close();
    }
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
