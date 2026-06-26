import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runPreflightFixTurn, type QueryFn } from './preflight-fix-runner.ts';

function setup(): { forgeRoot: string; projectDir: string; logsRoot: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'pf-fix-'));
  const projectDir = join(forgeRoot, 'projects', 'demoproj');
  mkdirSync(projectDir, { recursive: true });
  return { forgeRoot, projectDir, logsRoot: join(forgeRoot, '_logs') };
}

/** A query stub that runs `effect` (the agent's "edit") then yields a result. */
function makeQueryFn(effect?: () => void): QueryFn {
  return () => {
    async function* gen(): AsyncGenerator<unknown> {
      effect?.();
      yield { type: 'result', total_cost_usd: 0 };
    }
    return gen();
  };
}

test('agent edit clears the clause → cleared: true (re-run verified)', async () => {
  const { forgeRoot, projectDir, logsRoot } = setup();
  try {
    // C5 (locked-core) fails with no constraints doc; the agent writes one.
    const r = await runPreflightFixTurn({
      runId: 'test-c5',
      projectDir,
      clause: 'C5',
      instruction: 'forge honours git ownership; never edit tests to pass.',
      forgeRoot,
      logsRoot,
      queryFn: makeQueryFn(() => writeFileSync(join(projectDir, 'CONSTRAINTS.md'), '# Constraints\n\nNo test tampering.\n')),
    });
    assert.equal(r.cleared, true);
    assert.ok(existsSync(join(projectDir, 'CONSTRAINTS.md')));
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('agent makes no edit → cleared: false (verification gate holds)', async () => {
  const { forgeRoot, projectDir, logsRoot } = setup();
  try {
    const r = await runPreflightFixTurn({
      runId: 'test-noop',
      projectDir,
      clause: 'C5',
      instruction: '',
      forgeRoot,
      logsRoot,
      queryFn: makeQueryFn(), // no effect
    });
    assert.equal(r.cleared, false);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('emits a heartbeat + start/end events under _preflight-fix-<runId>/', async () => {
  const { forgeRoot, projectDir, logsRoot } = setup();
  try {
    await runPreflightFixTurn({
      runId: 'test-hb',
      projectDir,
      clause: 'C5',
      instruction: 'x',
      forgeRoot,
      logsRoot,
      queryFn: makeQueryFn(),
    });
    assert.ok(existsSync(join(logsRoot, '_preflight-fix-test-hb', 'events.jsonl')), 'event log written');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
