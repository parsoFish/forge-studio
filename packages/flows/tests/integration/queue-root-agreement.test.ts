/**
 * The dispatch claim (kernel) and the queue (flows) name the SAME halt record
 * for a non-default forge root: both go through `forgeQueueRoot`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { claimDispatchSlot, forgeQueueRoot, haltPath, writeHalt, Halted } from '@forge/kernel';
import { getPaths, listPending } from '../../queue.ts';
import { serve } from '../../scheduler.ts';
import type { PhaseWiring } from '../../phase-wiring.ts';

test('with a non-default forge root, flows and the dispatch claim read haltPath(forgeQueueRoot(root))', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-qroot-'));
  try {
    const qr = forgeQueueRoot(root);
    assert.equal(qr, join(root, '_queue'));
    assert.equal(getPaths(qr).root, qr);
    assert.equal(haltPath(getPaths(qr).root), join(root, '_queue', 'halt.json'));
    mkdirSync(join(root, '_logs'), { recursive: true });
    writeHalt(qr, 'operator');
    assert.throws(() => claimDispatchSlot(root, 'run-x', 'mark', () => false), Halted);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('serve with no queueRoot opt reads the halt at forgeQueueRoot(cwd), the record the bridge writes', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forge-qroot-serve-')));
  const cwd = process.cwd();
  const log = console.log;
  try {
    const qr = forgeQueueRoot(root);
    mkdirSync(getPaths(qr).pending, { recursive: true });
    writeFileSync(
      join(getPaths(qr).pending, 'INIT-2026-10-04-default-root.md'),
      '---\ninitiative_id: INIT-2026-10-04-default-root\nproject: nonexistent\ncreated_at: 2026-10-04T00:00:00Z\niteration_budget: 10\ncost_budget_usd: 5\nclass: code\n---\nbody\n',
    );
    writeHalt(qr, 'operator');
    process.chdir(root);
    console.log = () => {};
    await serve({ mode: 'once', phaseWiring: {} as unknown as PhaseWiring, worktreesRoot: join(root, '_worktrees') });
    console.log = log;
    assert.deepEqual(listPending(getPaths(qr)), ['INIT-2026-10-04-default-root.md'], 'the halt at <root>/_queue held the claim');
  } finally {
    console.log = log;
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
  }
});
