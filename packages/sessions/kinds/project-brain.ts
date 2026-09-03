/**
 * The `project-brain` session kind — a registered step-handler variant
 * (ADR 043 as amended 2026-09-03, M4 ruling 60).
 *
 * Operator feedback R1-3b (2026-06-27) replaced the index-only "build project
 * brain" stub with a real agentic evaluation: an agent reads the managed
 * project from scratch and authors a draft set of theme pages into a session
 * staging dir; the operator reviews them; on approval the themes are committed
 * into the project's central brain (`brain/projects/<name>/`, ADR-035) and the
 * index is regenerated.
 *
 * This file holds ONLY that identity — the phase set, the agent spec, the two
 * steps that do work, and the shape the turn returns. Every piece of turn
 * plumbing it used to carry (containment, status read/write, logger, tool-event
 * sink, heartbeat, thinking sink, start/end events) now lives once in
 * `kind-turn.ts`; the brain half (plan composition, the commit, the staged
 * listing) is `@forge/knowledge`'s and was carved out ahead of this port.
 *
 * Ported from `orchestrator/project-brain-builder-runner.ts`, which this file
 * replaces. Byte-identical spawn behaviour is pinned by
 * `interactive-runners-golden.test.ts` against
 * `orchestrator/test-fixtures/spawn-capture/interactive-project-brain.json`.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { modelForSpec, resolveSessionModel, type ModelTier } from '@forge/agents/phase-agent.ts';
import { deriveAgentSpec } from '@forge/agents/studio/derive.ts';
import { skillPathRelative, loadSkillTurnPrompt } from '@forge/agents/skill-path.ts';
import {
  PROJECT_BRAIN_KIND_DIR,
  buildAnalyzePlan,
  commitProjectBrain,
  listStagedThemes,
} from '@forge/knowledge/project-brain-build.ts';
import type { KbBinding } from '@forge/contracts/studio/types.ts';

import { runAgentTurn } from '../interactive-session.ts';
import { runKindTurn, type KindTurnInput, type SessionKindVariant } from './kind-turn.ts';

export const projectBrainAgentSpec = deriveAgentSpec(skillPathRelative('project-brain-builder'));
export const PROJECT_BRAIN_MODEL = modelForSpec(projectBrainAgentSpec);

export type ProjectBrainPhase =
  | 'briefing'
  | 'analyzing'
  | 'awaiting-review'
  | 'committing'
  | 'committed'
  | 'abandoned';

export type ProjectBrainStatus = {
  session_id: string;
  /** The project id / name — the central-brain key (brain/projects/<project>/). */
  project: string;
  /** Absolute path to the project repo the agent reads. */
  project_repo_path: string;
  phase: ProjectBrainPhase;
  /** The operator's focus/guidance for the brain (persisted to prompt.md). */
  prompt: string;
  updated_at: string;
  /**
   * R1-06 WI-2 (F2 hand-off, T1 ruling Q4 option (a)): when this session was
   * started as the POST /api/studio/kbs create hand-off, these two fields
   * carry the target KB's OWN id + binding (which may differ from `project`
   * — an arbitrary directory the session dir merely nests under). Absent
   * (the ordinary, non-KB-scoped project-brain flow), the commit step falls
   * back to the historical default: `{ kind: 'project', ref: project }`.
   */
  kb_id?: string;
  kb_binding?: KbBinding;
  /**
   * ADR-043 §3 amendment (2026-08-15, wave-6 kickoff model-tier seam): an
   * operator-chosen model tier, validated by the bridge's
   * `/api/project-brain/start` route against `projectBrainAgentSpec`
   * (`strategy:fixed`, so the only legal value is the fixed model's own
   * tier) before it is ever persisted here. Absent ⇒ unchanged default
   * behavior (`PROJECT_BRAIN_MODEL`).
   */
  modelTier?: ModelTier;
};

export type RunProjectBrainTurnInput = KindTurnInput;

export type RunProjectBrainTurnResult = {
  phase: ProjectBrainPhase;
  wrote: string[];
  /** The staged (or committed) theme file names. */
  themes?: string[];
};

export function projectBrainSessionDir(projectRoot: string, sessionId: string): string {
  return join(projectRoot, PROJECT_BRAIN_KIND_DIR, sessionId);
}

function stagingThemesDir(sessionDir: string): string {
  return join(sessionDir, 'themes');
}

export const projectBrainKind: SessionKindVariant<ProjectBrainStatus, RunProjectBrainTurnResult> = {
  id: 'project-brain',
  kindDir: PROJECT_BRAIN_KIND_DIR,
  label: 'project-brain runner',
  eventLabel: 'project-brain turn',
  eventPhase: 'project-brain',
  eventSkill: 'project-brain-builder',
  initiativeId: (sessionId) => `project-brain-${sessionId}`,

  steps: {
    // --- analyze: the agent reads the project + authors staged themes --------
    analyzing: async ({ input, status, plumbing, writeStatus }) => {
      const staging = stagingThemesDir(plumbing.sessionDir);
      mkdirSync(staging, { recursive: true });

      const skillFor = (turnId: string) =>
        loadSkillTurnPrompt({
          name: 'project-brain-builder',
          turnId,
          skillPromptPath: input.skillPromptPath,
        });
      const { cwd, prompt } = buildAnalyzePlan(status, plumbing.forgeRoot, staging, skillFor);

      await runAgentTurn({
        queryFn: plumbing.queryFn,
        prompt,
        cwd,
        model: resolveSessionModel(projectBrainAgentSpec, status.modelTier),
        allowedTools: projectBrainAgentSpec.allowedTools,
        disallowedTools: projectBrainAgentSpec.disallowedTools,
        // W8-B6 — hook dispatch comes from the driver already bound to this
        // turn's logger and initiative id, so no kind can spawn hook-blind.
        ...plumbing.hooksForSkill(projectBrainAgentSpec.skill),
        maxTurns: 30,
        onToolUse: plumbing.onToolUse,
        onHeartbeat: plumbing.onHeartbeat,
        onThinking: plumbing.onThinking,
        label: `project-brain-${input.sessionId}`,
      });

      const themes = listStagedThemes(input.projectRoot, input.sessionId);
      if (themes.length === 0) {
        throw new Error(
          'project-brain runner: the agent turn produced no theme files — re-run to retry, or refine the guidance.',
        );
      }
      writeStatus({ ...status, phase: 'awaiting-review' });
      return { phase: 'awaiting-review', wrote: themes.map((t) => join(staging, t)), themes };
    },

    // --- commit: copy staged themes into the central project brain -----------
    committing: async ({ input, status, plumbing, writeStatus }) => {
      // The brain half is `@forge/knowledge`'s; the phase transition is this
      // kind's, because it is the half that may touch the session's status.
      const committed = commitProjectBrain({
        projectRoot: input.projectRoot,
        sessionId: input.sessionId,
        forgeRoot: plumbing.forgeRoot,
        status,
      });
      writeStatus({ ...status, phase: 'committed' });
      return { phase: 'committed', wrote: committed.wrote, themes: committed.themes };
    },

    abandoned: async ({ status, writeStatus }) => {
      writeStatus({ ...status, phase: 'abandoned' });
      return { phase: 'abandoned', wrote: [] };
    },
  },

  otherwise: (status) => ({ phase: status.phase, wrote: [] }),
  startMetadata: (status) => ({ project: status.project }),
  endMetadata: (result) => ({ theme_count: result.themes?.length ?? 0 }),
};

export async function runProjectBrainTurn(
  input: RunProjectBrainTurnInput,
): Promise<RunProjectBrainTurnResult> {
  return await runKindTurn(projectBrainKind, input);
}
