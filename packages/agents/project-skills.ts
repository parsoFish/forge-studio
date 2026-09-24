/**
 * composeProjectSkills (ADR 024 item 90) — fold a project's declared skills
 * (`@forge/projects/preflight-skills.ts`'s `loadDeclaredSkills`) into an
 * agent's system prompt, so `.forge/project.json`'s `skills[]` reaches every
 * agent that runs on the project instead of being a preflight-only fact
 * (`checkSkills`) nothing else ever reads.
 *
 * Pure: returns a NEW string (or `undefined`), never mutates `systemPrompt`
 * or `skills`. An empty list is a no-op — the prompt comes back
 * byte-identical (including `undefined` staying `undefined`) so every
 * existing spawn-capture golden fixture for a non-project-bound run is
 * unaffected.
 */

import { join } from 'node:path';
import { createLogger, type EventLogger, type Phase } from '@forge/kernel';
import { loadDeclaredSkills, type DeclaredSkill } from '@forge/projects/preflight-skills.ts';

export type { DeclaredSkill };

const SECTION_HEADING = '## Project skills (declared in .forge/project.json)';

export function composeProjectSkills(systemPrompt: string | undefined, skills: readonly DeclaredSkill[]): string | undefined {
  if (skills.length === 0) return systemPrompt;
  const body = skills.map((s) => `### ${s.id}\n\n${s.text.trim()}`).join('\n\n');
  const section = `${SECTION_HEADING}\n\n${body}`;
  return systemPrompt !== undefined ? `${systemPrompt}\n\n${section}` : section;
}

type OneShotSkillsCtx = {
  bindings?: { project?: { repoPath: string }; initiative?: { id: string } };
  systemPrompt?: string;
  logger?: EventLogger;
  runId: string;
  logsRoot?: string;
};

/** `runOneShotSpawn`'s item-90 wiring, collapsed to one call: load + compose,
 *  and — for a non-empty load only — emit `project_skills_loaded`. Absent
 *  `ctx.bindings.project` ⇒ no lookup, so a non-project run's systemPrompt
 *  (and the golden spawn-capture fixtures) stay byte-identical. */
export function loadAndComposeProjectSkills(ctx: OneShotSkillsCtx, forgeRoot: string, agentSlug: string): string | undefined {
  const skills = ctx.bindings?.project ? loadDeclaredSkills(ctx.bindings.project.repoPath, forgeRoot) : [];
  if (skills.length > 0) {
    const logger = ctx.logger ?? createLogger(ctx.runId, ctx.logsRoot ?? join(forgeRoot, '_logs'));
    logger.emit({
      initiative_id: ctx.bindings?.initiative?.id ?? ctx.runId,
      phase: 'orchestrator',
      skill: agentSlug,
      event_type: 'log',
      input_refs: [],
      output_refs: [],
      message: 'project_skills_loaded',
      metadata: { ids: skills.map((s) => s.id) },
    });
  }
  return composeProjectSkills(ctx.systemPrompt, skills);
}

/** `makeAgentWithTelemetry`'s `onProjectSkillsLoaded` callback: the same
 *  `project_skills_loaded` event, scoped like the loop's other sink events. */
export function makeProjectSkillsLoadedSink(
  logger: EventLogger,
  sinkCtx: { initiativeId: string; parentEventId: string; phase: Phase; skill: string; workItemId?: string },
): (ids: string[]) => void {
  return (ids) => {
    logger.emit({
      initiative_id: sinkCtx.initiativeId,
      parent_event_id: sinkCtx.parentEventId,
      phase: sinkCtx.phase,
      skill: sinkCtx.skill,
      event_type: 'log',
      input_refs: [],
      output_refs: [],
      message: 'project_skills_loaded',
      metadata: { ...(sinkCtx.workItemId ? { work_item_id: sinkCtx.workItemId } : {}), ids },
    });
  };
}
