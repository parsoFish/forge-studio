/**
 * The `project-brain` session kind — a registered step-handler variant
 * (SPEC §5).
 *
 * Operator feedback R1-3b (2026-06-27) replaced the index-only "build project
 * brain" stub with a real agentic evaluation: an agent reads the managed
 * project from scratch and authors a draft set of theme pages into a session
 * staging dir; the operator reviews them; on approval the themes are committed
 * into the project's central brain (`brain/projects/<name>/`, SPEC §4) and the
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
 * `packages/kernel/tests/test-fixtures/spawn-capture/interactive-project-brain.json`.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sessionDirSegments } from '@forge/kernel';

// Deep paths, not the door (bead forge-8vfn.5.31, same cycle as
// architect-session.ts's own module doc — `kinds/registry.ts` needs
// `projectBrainKind` fully bound at its own top level).
import { modelForSpec, resolveSessionModel, type ModelTier } from '@forge/agents/phase-agent.ts';
import { deriveAgentSpec } from '@forge/agents/studio/derive.ts';
import { skillPathRelative, loadSkillTurnPrompt } from '@forge/agents/skill-path.ts';
import {
  PROJECT_BRAIN_KIND_DIR,
  buildAnalyzePlan,
  commitProjectBrain,
  listStagedThemes,
} from '@forge/knowledge';
import type { KbBinding } from '@forge/contracts';

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
  /** forge-mfv5.1.15 — the draft round; absent = 1, bumped by `/revise`. */
  round?: number;
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
   * SPEC §5 (2026-08-15, wave-6 kickoff model-tier seam): an
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
  /** Committed themes the category-index writer could not file (and why). */
  unindexed?: Array<{ theme: string; reason: string }>;
};

/** The session dir: `<logsRoot>/_sessions/<project>/_project-brain/<sessionId>`. */
export function projectBrainSessionDir(logsRoot: string, project: string, sessionId: string): string {
  return join(logsRoot, ...sessionDirSegments(project, PROJECT_BRAIN_KIND_DIR, sessionId));
}

function stagingThemesDir(sessionDir: string): string {
  return join(sessionDir, 'themes');
}

/** name -> sha256 of each staged theme's content, for the revise round's
 *  "did the turn change anything" check. A read failure propagates by name
 *  (the file was listed a moment ago) rather than hashing as empty. */
function stagedThemeHashes(logsRoot: string, project: string, sessionId: string, staging: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of listStagedThemes(logsRoot, project, sessionId)) {
    out.set(name, createHash('sha256').update(readFileSync(join(staging, name))).digest('hex'));
  }
  return out;
}

function sameHashes(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [name, hash] of a) if (b.get(name) !== hash) return false;
  return true;
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

      // forge-mfv5.1.15 — consume-once feedback.md ("Revise with notes"),
      // deleted only once the step resolves, so a failed turn's retry keeps it.
      return await plumbing.withOperatorFeedback(async (feedback) => {
        const skillFor = (turnId: string) =>
          loadSkillTurnPrompt({
            name: 'project-brain-builder',
            turnId,
            skillPromptPath: input.skillPromptPath,
          });
        const { cwd, prompt } = buildAnalyzePlan(status, plumbing.forgeRoot, staging, skillFor, feedback);
        // A revise round starts with round N's themes already staged, so the
        // "no theme files" guard below can never fire; snapshot the staged
        // content instead, so a turn that applied none of the notes is caught.
        const before = feedback === null ? null : stagedThemeHashes(plumbing.logsRoot, input.project, input.sessionId, staging);

        await runAgentTurn({
          queryFn: plumbing.queryFn,
          maxBudgetUsd: plumbing.turnBudgetUsd(), // row 193b — the session's remaining, at dispatch
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

        const themes = listStagedThemes(plumbing.logsRoot, input.project, input.sessionId);
        if (themes.length === 0) {
          throw new Error(
            'project-brain runner: the agent turn produced no theme files — re-run to retry, or refine the guidance.',
          );
        }
        if (before !== null && sameHashes(before, stagedThemeHashes(plumbing.logsRoot, input.project, input.sessionId, staging))) {
          throw new Error(
            "project-brain runner: revise round changed no staged theme — the operator's notes were not applied — re-run to retry; the notes are kept.",
          );
        }
        writeStatus({ ...status, phase: 'awaiting-review' });
        return { phase: 'awaiting-review', wrote: themes.map((t) => join(staging, t)), themes };
      });
    },

    // --- commit: copy staged themes into the central project brain -----------
    committing: async ({ input, status, plumbing, writeStatus }) => {
      // The brain half is `@forge/knowledge`'s; the phase transition is this
      // kind's, because it is the half that may touch the session's status.
      const committed = commitProjectBrain({
        logsRoot: plumbing.logsRoot,
        sessionId: input.sessionId,
        forgeRoot: plumbing.forgeRoot,
        status,
      });
      writeStatus({ ...status, phase: 'committed' });
      return { phase: 'committed', wrote: committed.wrote, themes: committed.themes, unindexed: committed.unindexed };
    },

    abandoned: async ({ status, writeStatus }) => {
      writeStatus({ ...status, phase: 'abandoned' });
      return { phase: 'abandoned', wrote: [] };
    },
  },

  otherwise: (status) => ({ phase: status.phase, wrote: [] }),
  startMetadata: (status) => ({ project: status.project }),
  endMetadata: (result) => ({ theme_count: result.themes?.length ?? 0, unindexed_count: result.unindexed?.length ?? 0 }),
};

export async function runProjectBrainTurn(
  input: RunProjectBrainTurnInput,
): Promise<RunProjectBrainTurnResult> {
  return await runKindTurn(projectBrainKind, input);
}
