/**
 * forge-8vfn.8.1.30 / T1 ruling 1693 — the PM's turn must emit `agent_heartbeat`
 * while it runs, the same as every dev-loop turn. Same defect class as the
 * reflector (`reflector-heartbeat.test.ts`): `runProjectManager`
 * (packages/stations/phases/project-manager.ts) calls `runAgent` with
 * `lifecycle: 'caller'`, and that branch only wires the heartbeat timer when
 * the caller hands in its own `turnSink` (packages/agents/run-agent.ts).
 *
 * The PM already builds a `pmToolSink` (`makeToolEventSink`, phase
 * 'project-manager') and feeds it `onToolUse` manually from its own
 * `onMessage` — this test proves passing that SAME sink as `turnSink` also
 * turns the heartbeat on, without touching (or duplicating) that existing
 * tool-use wiring.
 *
 * `options.heartbeatTimers` (this fix) mirrors `runAgent`'s own
 * `RunContext.heartbeatTimers` test-injection seam (7.6.148) one layer up —
 * same fake-timer shape `run-agent-w7b5.test.ts` uses.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runProjectManager, type PmQueryFn } from '../../phases/project-manager.ts';
import { createLogger, type EventLogEntry } from '@forge/kernel';
import type { CycleInput } from '@forge/flows';
import { testClassProfilePort } from '../test-fixtures/class-profile-port-fixture.ts';
import { canonicalDef } from '../test-fixtures/canonical-def-fixture.ts';

const MANIFEST_BODY = `---
initiative_id: INIT-2026-09-27-pm-hb
project: testproj
project_repo_path: ./projects/testproj
created_at: 2026-09-27T00:00:00Z
iteration_budget: 3
cost_budget_usd: 1
class: code
phase: in-flight
origin: architect
---

# Test initiative

## Acceptance criteria

Given the resource, when applied, then it persists in the external system.
`;

const WI_BODY = `---
work_item_id: WI-1
initiative_id: INIT-2026-09-27-pm-hb
status: pending
depends_on: []
acceptance_criteria:
  - given: "a test"
    when: "the function runs"
    then: "it returns a value"
files_in_scope:
  - src.ts
creates:
  - src.ts
quality_gate_cmd: ["echo", "gate-ok"]
estimated_iterations: 1
---

Body for WI-1.
`;

/** One brain-Read tool_use, one WI written, then a clean result — the
 *  minimal shape `runOnePmPass` needs to close successfully. */
function makeStubQueryFn(): PmQueryFn {
  return ({ options }) => {
    const cwd = (options as { cwd: string }).cwd;
    return (async function* () {
      yield {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'brain/cycles/themes/x.md' } }],
        },
      };
      const wiDir = resolve(cwd, '.forge', 'work-items');
      mkdirSync(wiDir, { recursive: true });
      writeFileSync(join(wiDir, 'WI-1.md'), WI_BODY);
      writeFileSync(join(wiDir, '_graph.md'), ['```mermaid', 'graph TD', '  WI-1["WI-1"]', '```'].join('\n'));
      yield { type: 'result', subtype: 'success', duration_ms: 1, total_cost_usd: 0.01 };
    })();
  };
}

/** `ticks` immediate fires, then nothing (run-agent-w7b5.test.ts's own `fakeTimers`). */
function fakeTimers(ticks: number) {
  let now = 0;
  return {
    setInterval: (fn: () => void, ms: number) => {
      for (let i = 0; i < ticks; i += 1) {
        now += ms;
        fn();
      }
      return 'handle';
    },
    clearInterval: (_h: unknown) => {},
    now: () => now,
  };
}

function readEvents(logFilePath: string): EventLogEntry[] {
  const text = readFileSync(logFilePath, 'utf8');
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as EventLogEntry);
}

test('8.1.30: a PM turn that is SLOW emits agent_heartbeat, named for the project-manager', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-pm-hb-'));
  try {
    const worktree = join(dir, 'projects', 'testproj');
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(worktree, 'package.json'), JSON.stringify({ name: 'testproj', version: '0.0.1' }));
    const manifestPath = join(dir, '_queue', 'in-flight', 'INIT-2026-09-27-pm-hb.md');
    mkdirSync(join(dir, '_queue', 'in-flight'), { recursive: true });
    writeFileSync(manifestPath, MANIFEST_BODY);
    const logsDir = join(dir, '_logs');
    mkdirSync(logsDir, { recursive: true });
    const logger = createLogger('TEST-pm-hb', logsDir);
    const input: CycleInput = {
      initiativeId: 'INIT-2026-09-27-pm-hb',
      manifestPath,
      projectRepoPath: worktree,
      worktreePath: worktree,
      cycleId: '2026-09-27T00-00-00_INIT-2026-09-27-pm-hb',
    };

    await runProjectManager(input, logger, {
      agentDef: canonicalDef('project-manager'),
      queryFn: makeStubQueryFn(),
      classProfiles: testClassProfilePort(),
      heartbeatTimers: fakeTimers(3),
    });

    const events = readEvents(logger.logFilePath);
    const heartbeats = events.filter((e) => e.event_type === 'agent_heartbeat');
    assert.ok(
      heartbeats.length > 0,
      `a PM turn must emit agent_heartbeat while it runs — got ${JSON.stringify(events.map((e) => e.event_type))}`,
    );
    for (const hb of heartbeats) {
      assert.equal(hb.phase, 'project-manager', 'the PM heartbeat must say phase project-manager');
      assert.equal(hb.skill, 'project-manager', 'the PM heartbeat must name the project-manager');
    }
    // The PM's own manual tool_use forwarding (pmToolSink) must NOT be
    // duplicated by wiring the same sink into runAgent's turnSink option.
    const toolUses = events.filter((e) => e.event_type === 'tool_use' && e.message === 'tool.Read');
    assert.equal(toolUses.length, 1, 'the PM tool_use event must be emitted exactly once, not doubled by turnSink wiring');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
