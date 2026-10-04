/**
 * The dispatch claim (kernel) and the queue (flows) name the SAME halt record
 * for a non-default forge root: both go through `forgeQueueRoot`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { claimDispatchSlot, forgeQueueRoot, haltPath, writeHalt, Halted } from '@forge/kernel';
import { getPaths } from '../../queue.ts';

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
