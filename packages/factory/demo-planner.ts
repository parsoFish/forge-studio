/**
 * The develop factory's demo planner (forge-mfv5.1.19, D-45): one SDK turn of
 * the `demo-agent` skill, no tools, whose reply is the plan. The integrate band
 * (`@forge/stations`) validates the reply by name, captures and compares; this
 * module only asks. A harness that suppresses spawns gets `spawn-suppressed`,
 * never a made-up plan.
 */

import { readFileSync } from 'node:fs';

import { runAgent, type StreamQueryFn } from '@forge/agents';
import type { DemoPlannerInput, DemoPlannerPort } from '@forge/stations';

export function renderDemoPlannerPrompt(input: DemoPlannerInput): string {
  const list = (items: readonly string[]): string => (items.length > 0 ? items.map((i) => `- \`${i}\``).join('\n') : '- (none)');
  return [
    `# Plan the demo for: ${input.title}`,
    '',
    '## Work items and their user stories',
    ...input.workItems.map((wi) => `### ${wi.id}: ${wi.title}\n\n${wi.story.trim()}\n`),
    '## Acceptance criteria',
    ...input.acceptanceCriteria.map((ac) => `- ${ac}`),
    '',
    `## Diff\n\n${input.diffStat}\n\nChanged files: ${input.changedFiles.join(', ') || '(none)'}`,
    '',
    '## Allowed means (name nothing else)',
    `Commands (cli-before-after):\n${list(input.allowed.commands)}`,
    `API commands (api-before-after, prints JSON):\n${list(input.allowed.apiCommands)}`,
    `API paths on the tree's own server (api-before-after):\n${list(input.allowed.apiPaths)}`,
    `Routes (screenshot):\n${list(input.allowed.routes)}`,
    '',
    'Reply with the plan JSON only.',
  ].join('\n');
}

/** The plan JSON in a reply: its single fenced `json` block, else the whole reply. `null` when neither parses. */
export function extractPlanJson(reply: string): unknown {
  const fenced = /```json\s*\n([\s\S]*?)\n```/.exec(reply);
  try {
    return JSON.parse((fenced ? fenced[1]! : reply).trim());
  } catch {
    return null;
  }
}

export function createDemoPlanner(opts: { queryFn?: StreamQueryFn } = {}): DemoPlannerPort {
  return {
    async plan(def, input, logger, signal) {
      const env = process.env;
      if (!opts.queryFn && (env.FORGE_DRY_BRIDGE === '1' || env.FORGE_ARCHITECT_NO_SPAWN === '1')) {
        return { ok: false, reason: 'spawn-suppressed', detail: env.FORGE_DRY_BRIDGE === '1' ? 'FORGE_DRY_BRIDGE' : 'FORGE_ARCHITECT_NO_SPAWN' };
      }
      let reply: string | undefined;
      let spawn;
      try {
        spawn = await runAgent(def, {
          runId: input.cycleId,
          workdir: input.worktreePath,
          cwd: input.worktreePath,
          prompt: renderDemoPlannerPrompt(input),
          systemPrompt: `# ${def.slug} skill contract\n\n${readFileSync(def.path, 'utf8')}`,
          lifecycle: 'caller',
          logger,
          streamGuard: { label: def.slug, signal },
          bindings: { initiative: { id: input.initiativeId } },
          queryFn: opts.queryFn,
          onMessage: (msg) => {
            const m = msg as { type?: string; result?: unknown };
            if (m.type === 'result' && typeof m.result === 'string') reply = m.result;
          },
        });
      } catch (err) {
        return { ok: false, reason: 'spawn-failed', detail: err instanceof Error ? err.message : String(err) };
      }
      if (spawn.resultSubtype !== undefined && spawn.resultSubtype !== 'success') {
        return { ok: false, reason: 'spawn-failed', detail: `the planner ended ${spawn.resultSubtype}`, costUsd: spawn.costUsd };
      }
      const raw = reply === undefined ? null : extractPlanJson(reply);
      if (raw === null) return { ok: false, reason: 'no-plan', detail: 'the reply carried no plan JSON', costUsd: spawn.costUsd };
      return { ok: true, raw, costUsd: spawn.costUsd };
    },
  };
}
