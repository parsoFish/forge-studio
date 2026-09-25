/**
 * runAgent + `ctx.bindings.project` (ADR 024 item 90) — a project's declared
 * `.forge/project.json` `skills[]` must reach the spawned agent's
 * `systemPrompt`, not just resolve at preflight time and go nowhere.
 *
 * Uses the same `oneShotClone` / `capturingQueryFn` DI pattern as
 * `run-agent.test.ts` (real fixture def, cloned with a declared
 * `loopStrategy: 'one-shot'`), `lifecycle: 'caller'` so no logger/runId
 * ceremony is needed, and injects `ctx.logger` (a bare in-memory recorder) to
 * assert the `project_skills_loaded` event.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAgent } from '../../run-agent.ts';
import { listAgentDefinitions } from '../../studio/agent-registry.ts';
import type { StreamQueryFn } from '../../pinned-sdk-query.ts';
import type { AgentDefinition } from '@forge/contracts';
import type { EventLogEntry } from '@forge/kernel';
import { FORGE_ROOT } from '@forge/kernel';

function oneShotClone(def: AgentDefinition): AgentDefinition {
  return { ...def, runtime: { ...def.runtime, loopStrategy: 'one-shot' }, budgets: {} };
}

function capturingQueryFn(calls: Array<{ prompt: string; options: Record<string, unknown> }>): StreamQueryFn {
  return ((params: { prompt: string; options: Record<string, unknown> }) => {
    calls.push(params);
    async function* gen() {
      yield { type: 'result', subtype: 'success', total_cost_usd: 0.01, usage: { input_tokens: 1, output_tokens: 1 } };
    }
    return gen();
  }) as unknown as StreamQueryFn;
}

/** In-memory EventLogger — avoids touching the real `_logs/` tree. */
function fakeLogger(): { emit: (e: Omit<EventLogEntry, 'event_id' | 'cycle_id' | 'started_at'>) => EventLogEntry; entries: EventLogEntry[]; cycleId: string; logFilePath: string } {
  const entries: EventLogEntry[] = [];
  return {
    cycleId: 'test-cycle',
    logFilePath: '/dev/null',
    entries,
    emit: (partial) => {
      const entry = { event_id: `e${entries.length}`, cycle_id: 'test-cycle', started_at: new Date().toISOString(), ...partial } as EventLogEntry;
      entries.push(entry);
      return entry;
    },
  };
}

function declareProjectWithSkill(dir: string, skillId: string, skillText: string): void {
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(join(dir, '.forge', 'project.json'), JSON.stringify({ testProcess: { local: { cmd: ['true'] } }, skills: [skillId] }));
  mkdirSync(join(dir, '.forge', 'skills', skillId), { recursive: true });
  writeFileSync(join(dir, '.forge', 'skills', skillId, 'SKILL.md'), skillText);
}

test('runAgent: a project binding declaring a skill folds its SKILL.md text into systemPrompt and emits project_skills_loaded', async () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-project-skills-'));
  try {
    const projectDir = mkdtempSync(join(scratchRoot, 'proj-'));
    declareProjectWithSkill(projectDir, 'x', '# x\n\nDo the x thing.');

    const defs = listAgentDefinitions(join(FORGE_ROOT, 'skills'));
    const base = defs.find((d) => d.slug === 'project-scoped-review');
    assert.ok(base);
    const def = oneShotClone(base!);

    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));
    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    const logger = fakeLogger();

    await runAgent(def, {
      runId: '',
      workdir,
      prompt: 'p',
      systemPrompt: 'BASE SYSTEM PROMPT',
      lifecycle: 'caller',
      logger: logger as never,
      bindings: { project: { name: 'proj', repoPath: projectDir } },
      queryFn: capturingQueryFn(calls),
    });

    assert.equal(calls.length, 1);
    const sentPrompt = calls[0]!.options.systemPrompt as string;
    assert.ok(sentPrompt.startsWith('BASE SYSTEM PROMPT'));
    assert.match(sentPrompt, /## Project skills \(declared in \.forge\/project\.json\)/);
    assert.match(sentPrompt, /### x/);
    assert.match(sentPrompt, /Do the x thing\./);

    const skillsEvent = logger.entries.find((e) => e.message === 'project_skills_loaded');
    assert.ok(skillsEvent, 'expected a project_skills_loaded event');
    assert.deepEqual(skillsEvent!.metadata?.ids, ['x']);
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test('runAgent: no project binding — systemPrompt is byte-identical to before, and no project_skills_loaded event fires', async () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-project-skills-nobind-'));
  try {
    const defs = listAgentDefinitions(join(FORGE_ROOT, 'skills'));
    const base = defs.find((d) => d.slug === 'project-scoped-review');
    assert.ok(base);
    const def = oneShotClone(base!);

    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));
    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    const logger = fakeLogger();

    await runAgent(def, {
      runId: '',
      workdir,
      prompt: 'p',
      systemPrompt: 'BASE SYSTEM PROMPT',
      lifecycle: 'caller',
      logger: logger as never,
      // deliberately no bindings.project
      queryFn: capturingQueryFn(calls),
    });

    assert.equal(calls[0]!.options.systemPrompt, 'BASE SYSTEM PROMPT');
    assert.equal(logger.entries.find((e) => e.message === 'project_skills_loaded'), undefined);
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test('runAgent: a project binding with NO declared skills leaves systemPrompt untouched', async () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-project-skills-empty-'));
  try {
    const projectDir = mkdtempSync(join(scratchRoot, 'proj-'));
    mkdirSync(join(projectDir, '.forge'), { recursive: true });
    writeFileSync(join(projectDir, '.forge', 'project.json'), JSON.stringify({ testProcess: { local: { cmd: ['true'] } } }));

    const defs = listAgentDefinitions(join(FORGE_ROOT, 'skills'));
    const base = defs.find((d) => d.slug === 'project-scoped-review');
    assert.ok(base);
    const def = oneShotClone(base!);

    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));
    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    const logger = fakeLogger();

    await runAgent(def, {
      runId: '',
      workdir,
      prompt: 'p',
      systemPrompt: 'BASE SYSTEM PROMPT',
      lifecycle: 'caller',
      logger: logger as never,
      bindings: { project: { name: 'proj', repoPath: projectDir } },
      queryFn: capturingQueryFn(calls),
    });

    assert.equal(calls[0]!.options.systemPrompt, 'BASE SYSTEM PROMPT');
    assert.equal(logger.entries.find((e) => e.message === 'project_skills_loaded'), undefined);
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});
