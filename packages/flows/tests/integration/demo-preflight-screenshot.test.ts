/**
 * Row 4 of forge-nk1y.45 at the preflight door: a screenshot checkpoint with no
 * route and no steps would record a bare root-page load — refused by name
 * before capture, like an unrunnable command. Pure: a tmp demo.json, nothing
 * spawned (§6.16).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { preflightDemoCaptureCommands } from '../../phases/orchestrated-capture.ts';

function preflight(checkpoints: unknown[]): ReturnType<typeof preflightDemoCaptureCommands> {
  const dir = mkdtempSync(join(tmpdir(), 'preflight-shot-'));
  try {
    writeFileSync(join(dir, 'demo.json'), JSON.stringify({ checkpoints }));
    return preflightDemoCaptureCommands(join(dir, 'demo.json'), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a screenshot checkpoint with neither route nor steps is refused by name', () => {
  const r = preflight([{ label: 'Plan 1: WI-1', form: 'screenshot', kind: 'screenshot', caption: 'c' }]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.problems, ['checkpoint "Plan 1: WI-1": a screenshot checkpoint names no route and no steps — capture would record a bare root-page load']);
});

test('a route, or steps, is enough; gate output and harness tables are not browser captures', () => {
  assert.deepEqual(preflight([
    { label: 'a', form: 'screenshot', route: '/dash' },
    { label: 'b', kind: 'screenshot', steps: [{ click: '#go' }] },
    { label: 'g', form: 'test-evidence' },
    { label: 'h', kind: 'harness' },
  ]), { ok: true, problems: [] });
});
