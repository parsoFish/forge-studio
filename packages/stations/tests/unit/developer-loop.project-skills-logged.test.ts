/**
 * ADR 024 item 90 — the dev loop's `makeAgentWithTelemetry` wires
 * `onProjectSkillsLoaded` (developer-loop.ts) into a `project_skills_loaded`
 * log event. `claude-agent.project-skills.test.ts` already pins that
 * `createClaudeAgent` FIRES the callback with the declared skill ids; this
 * file pins the other half — that `makeAgentWithTelemetry`'s own callback
 * turns that firing into the correctly-shaped `logger.emit` call.
 *
 * `runDeveloperLoop` itself can't be driven end-to-end here (same documented
 * constraint as `developer-loop.cost-ceiling.test.ts` /
 * `developer-loop.wi-concurrent-dispatch.test.ts`: it always spawns a real
 * Claude SDK query internally, with no injection seam on `CycleInput`). This
 * instead calls the exported `makeAgentWithTelemetry` directly — the exact
 * function the commit under test changed — through the REAL `claude` adapter
 * (`getAdapter('claude').createAgent` → `createClaudeAgent`), with only the
 * SDK's own `query()` faked via `queryFn` (the same DI seam
 * `claude-agent.project-skills.test.ts` uses). No worktree/merge/gate
 * machinery is needed: `createClaudeAgent` only reads `worktreePath`'s
 * `.forge/project.json` + `.forge/skills/<id>/SKILL.md` and `promptPath`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { EventLogEntry, EventLogger } from '@forge/kernel';
import type { QueryFn } from '@forge/agents';
import { makeAgentWithTelemetry } from '../../phases/developer-loop.ts';

/** Records every emitted entry; mirrors `developer-loop.cost-ceiling.test.ts`'s `makeRawLogger`. */
function makeRecordingLogger(): { logger: EventLogger; emitted: EventLogEntry[] } {
  const emitted: EventLogEntry[] = [];
  let n = 0;
  const logger: EventLogger = {
    cycleId: 'cycle-skills-logged',
    logFilePath: '/dev/null',
    emit(partial) {
      const entry = {
        event_id: partial.event_id ?? `e${++n}`,
        cycle_id: 'cycle-skills-logged',
        started_at: partial.started_at ?? new Date().toISOString(),
        ...partial,
      } as EventLogEntry;
      emitted.push(entry);
      return entry;
    },
  };
  return { logger, emitted };
}

/** Yields the minimal valid `result` message — no assistant/tool_use blocks needed. */
function fakeQuery(): QueryFn {
  return (() => {
    async function* gen() {
      yield { type: 'result', subtype: 'success', total_cost_usd: 0, num_turns: 1 };
    }
    return gen();
  }) as unknown as QueryFn;
}

function declareProjectWithSkill(dir: string, skillId: string): void {
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(
    join(dir, '.forge', 'project.json'),
    JSON.stringify({ testProcess: { local: { cmd: ['true'] } }, skills: [skillId] }),
  );
  mkdirSync(join(dir, '.forge', 'skills', skillId), { recursive: true });
  writeFileSync(join(dir, '.forge', 'skills', skillId, 'SKILL.md'), `# ${skillId}\n\nDo the ${skillId} thing.`);
}

test('makeAgentWithTelemetry: a worktree declaring project skill "x" logs project_skills_loaded with metadata.ids === ["x"]', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-devloop-project-skills-logged-'));
  try {
    writeFileSync(join(dir, 'PROMPT.md'), 'test prompt');
    declareProjectWithSkill(dir, 'x');

    const { logger, emitted } = makeRecordingLogger();
    const { agent } = makeAgentWithTelemetry(
      logger,
      {
        initiativeId: 'INIT-skills-logged',
        parentEventId: 'parent-1',
        phase: 'developer-loop',
        skill: 'developer-ralph',
        workItemId: 'WI-1',
      },
      { queryFn: fakeQuery() },
    );

    await agent({
      promptPath: join(dir, 'PROMPT.md'),
      agentMdPath: join(dir, 'AGENT.md'),
      fixPlanPath: join(dir, 'fix_plan.md'),
      worktreePath: dir,
      iteration: 1,
    });

    const skillsEvent = emitted.find((e) => e.message === 'project_skills_loaded');
    assert.ok(skillsEvent, `expected a 'project_skills_loaded' log event among: ${JSON.stringify(emitted.map((e) => e.message))}`);
    assert.deepEqual(skillsEvent!.metadata?.ids, ['x'], 'metadata.ids must carry exactly the declared skill id');
    assert.equal(skillsEvent!.event_type, 'log');
    assert.equal(skillsEvent!.metadata?.work_item_id, 'WI-1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
