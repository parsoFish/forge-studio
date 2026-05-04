/**
 * Smoke test for the Ralph runner skeleton. Proves the wiring works:
 * - templates stamp into a worktree
 * - stop conditions fire (iteration budget) when nothing changes
 * - the runner returns a structured result
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, type LoopInput } from './runner.ts';

test('Ralph runner: stamps templates and exits on iteration budget', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-ralph-'));
  try {
    const workItemPath = join(dir, 'WI-1.md');
    writeFileSync(workItemPath, '# WI-1: smoke test\n\nDoes nothing.\n');

    const input: LoopInput = {
      workItemSpecPath: workItemPath,
      worktreePath: dir,
      initiativeBudget: { iterations: 2, usd: 1 },
      brainQueryResults: '_(no brain context — smoke test)_',
      cycleId: 'cycle-test',
      initiativeId: 'INIT-test',
    };

    const result = await run(input);

    // Templates should have been stamped.
    assert.ok(existsSync(join(dir, 'PROMPT.md')), 'PROMPT.md created');
    assert.ok(existsSync(join(dir, 'AGENT.md')), 'AGENT.md created');
    assert.ok(existsSync(join(dir, 'fix_plan.md')), 'fix_plan.md created');

    // The stub agent makes no progress, so we exit on iteration-budget or wedged.
    assert.ok(['failed', 'wedged'].includes(result.status), `status was ${result.status}`);
    assert.ok(result.iterations >= 1, 'at least one iteration ran');
    assert.equal(result.cost_usd, 0, 'stub agent costs nothing');
    assert.ok(result.duration_ms >= 0, 'duration tracked');

    // Verify PROMPT.md substitution worked.
    const prompt = readFileSync(join(dir, 'PROMPT.md'), 'utf8');
    assert.ok(prompt.includes('WI-1'), 'WI id substituted');
    assert.ok(prompt.includes('INIT-test'), 'initiative id substituted');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
