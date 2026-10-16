/**
 * forge-mfv5.1.47 (row 3) — the dev loop's door for a develop RESUME whose
 * `.forge/work-items/` is gone: it restores the queue from the cycle's own
 * record before it reads it, or refuses by name with a
 * `work-items.restore-refused` event — never the unclassified
 * "developer-loop: no work items found". The refusal case drives the real
 * `runDeveloperLoop` door: it throws before any agent can be spawned (no
 * classProfiles port, no SDK — §6.16), so a broken restore cannot reach Y.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { EventLogEntry, EventLogger } from '@forge/kernel';
import type { CycleInput } from '@forge/flows';
import type { AgentDefinition } from '@forge/contracts';
import { runDeveloperLoop } from '../../phases/developer-loop.ts';
import { restoreDevWorkItemsAtResume } from '../../phases/dev-work-items-restore.ts';

const ID = 'INIT-2026-10-16-devloop-restore';
const CYCLE = `2026-10-16T08-00-00_${ID}`;

function recordingLogger(): { logger: EventLogger; entries: Array<{ message: string; event_type: string; metadata?: Record<string, unknown> }> } {
  const entries: Array<{ message: string; event_type: string; metadata?: Record<string, unknown> }> = [];
  const logger = {
    cycleId: CYCLE,
    logFilePath: '/dev/null',
    emit(partial: Omit<EventLogEntry, 'event_id' | 'cycle_id' | 'started_at'>) {
      entries.push({ message: partial.message ?? '', event_type: partial.event_type, metadata: partial.metadata as Record<string, unknown> | undefined });
      return { ...partial, event_id: 'e', cycle_id: CYCLE, started_at: new Date().toISOString() } as EventLogEntry;
    },
  };
  return { logger: logger as unknown as EventLogger, entries };
}

function world(withSnapshot: boolean): { dir: string; input: CycleInput } {
  const dir = mkdtempSync(join(tmpdir(), 'forge-devloop-restore-'));
  const wt = join(dir, 'wt');
  mkdirSync(join(wt, '.forge', 'work-items'), { recursive: true });
  const logsRoot = join(dir, '_logs');
  mkdirSync(join(logsRoot, CYCLE), { recursive: true });
  if (withSnapshot) {
    mkdirSync(join(logsRoot, CYCLE, 'work-items-snapshot'));
    writeFileSync(join(logsRoot, CYCLE, 'work-items-snapshot', 'WI-1.md'), [
      '---', 'work_item_id: WI-1', `initiative_id: ${ID}`, 'status: complete', 'depends_on: []',
      'acceptance_criteria:', '  - given: g', '    when: w', '    then: t', 'files_in_scope:', '  - README.md',
      'quality_gate_cmd:', '  - "true"', 'estimated_iterations: 1', '---', '# WI-1', '',
    ].join('\n'));
  }
  const input = { initiativeId: ID, manifestPath: join(dir, 'm.md'), projectRepoPath: wt, worktreePath: wt, logsRoot, resumeFrom: 'develop' } as unknown as CycleInput;
  return { dir, input };
}

test('dev loop: a develop resume with an EMPTY queue and no snapshot is refused by name at the door — never "no work items found"', async () => {
  const w = world(false);
  const { logger, entries } = recordingLogger();
  try {
    await assert.rejects(
      () => runDeveloperLoop(w.input, logger, { slug: 'developer' } as unknown as AgentDefinition),
      (err: Error) => /work items not restorable: no work-items-snapshot/.test(err.message) && !/no work items found/.test(err.message),
    );
    const refused = entries.find((e) => e.message === 'work-items.restore-refused');
    assert.equal(refused?.event_type, 'error');
    assert.match(String(refused?.metadata?.reason), /no work-items-snapshot/);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('dev loop: a develop resume with an EMPTY queue and a snapshot is restored before the queue is read', () => {
  const w = world(true);
  const { logger, entries } = recordingLogger();
  try {
    restoreDevWorkItemsAtResume(w.input, logger);
    assert.ok(existsSync(join(w.input.worktreePath, '.forge', 'work-items', 'WI-1.md')));
    assert.deepEqual(entries.find((e) => e.message === 'work-items.restored')?.metadata?.from_snapshot, ['WI-1']);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('dev loop: a run that is not a develop resume is never restored into (a fresh queue stays the PM\'s)', () => {
  const w = world(true);
  const { logger, entries } = recordingLogger();
  try {
    restoreDevWorkItemsAtResume({ ...w.input, resumeFrom: undefined } as CycleInput, logger);
    assert.ok(!existsSync(join(w.input.worktreePath, '.forge', 'work-items', 'WI-1.md')));
    assert.equal(entries.length, 0);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});
