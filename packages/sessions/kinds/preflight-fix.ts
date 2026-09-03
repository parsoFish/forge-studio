/**
 * The preflight-fix session kind — port 6 of ruling 60.
 *
 * IDENTITY only: the skill, the prompt, the branch the edits land on, and what
 * "cleared" means. The twelve plumbing behaviours live in `kinds/fix-turn.ts`.
 *
 * The generic "operator decided, agent applies the decision" path for USER-tier
 * `forge preflight` clauses. AGENT-tier clauses (C8/DEMO/BRAIN) do NOT come
 * here — the bridge routes those to the instructions / demo-builder /
 * brain-fix kinds.
 *
 * Unlike brain-fix this turn is UNFENCED (`acceptEdits`, the grant intact),
 * which is the shape it has always had: it edits the operator's own managed
 * project under an explicit per-clause decision, and its durability seam is
 * that project's `forge-studio` branch rather than a write-root list. Stated
 * because the two kinds sit side by side and the difference is deliberate.
 */
import { runPreflight, type ClauseId } from '@forge/projects/preflight.ts';
import { ensureStudioBranch, commitStudioChange } from '@forge/projects/project-repo-tx.ts';
import { deriveAgentSpec } from '@forge/agents/studio/derive.ts';
import { modelForSpec } from '@forge/agents/phase-agent.ts';
import { skillPathRelative } from '@forge/agents/skill-path.ts';

import { runFixTurn, type FixTurnInput, type FixTurnResult, type FixTurnVariant } from './fix-turn.ts';

export const preflightFixAgentSpec = deriveAgentSpec(skillPathRelative('preflight-fix'));
export const PREFLIGHT_FIX_MODEL = modelForSpec(preflightFixAgentSpec);

export type { QueryFn } from './fix-turn.ts';

export type RunPreflightFixInput = FixTurnInput & {
  /** Absolute path to the managed project being fixed. */
  projectDir: string;
  /** The preflight clause to clear. */
  clause: ClauseId;
  /** The operator's decision / fix instruction (USER-tier note). */
  instruction: string;
  /** The clause's current failure detail (context for the agent). */
  detail?: string;
};

export type RunPreflightFixResult = FixTurnResult & {
  /** True when the post-turn re-run found the clause now passing. */
  cleared: boolean;
};

export const preflightFixKind: FixTurnVariant<RunPreflightFixInput, RunPreflightFixResult, void> = {
  cycleIdPrefix: '_preflight-fix',
  eventPhase: 'orchestrator',
  eventSkill: 'preflight-fix',
  skillName: 'preflight-fix',
  fallbackPrompt: 'You are the forge preflight-fix agent.',
  inputRefs: (input) => [input.projectDir],
  startMessage: (input) => `preflight-fix.start (clause=${input.clause}, project=${input.projectDir})`,
  startMetadata: (input) => ({ runId: input.runId, clause: input.clause }),

  prepare: ({ input, skillPrompt }) => {
    // Land the agent's edits on the project's forge-studio branch so they
    // persist (the working tree the verify re-run reads is this branch). A
    // non-git project is not an error — the edits simply stay in the tree.
    try {
      ensureStudioBranch(input.projectDir);
    } catch {
      /* non-git project — edits stay in the tree */
    }

    const userPayload = [
      '## Fix task',
      '',
      `**Project (cwd):** ${input.projectDir}`,
      `**Preflight clause:** ${input.clause}`,
      ...(input.detail ? [`**Current failure:** ${input.detail}`] : []),
      `**Operator decision:** ${input.instruction || '(none provided)'}`,
      '',
      'Apply ONLY the minimal edit that clears this clause, per the operator decision. Touch nothing else, then stop.',
    ].join('\n');

    return {
      pre: undefined,
      spawn: {
        prompt: [skillPrompt, '', userPayload].join('\n'),
        // The bespoke runner's key order, unchanged — see fix-turn.ts's header
        // on why order is pinned evidence rather than style.
        options: {
          cwd: input.projectDir,
          model: PREFLIGHT_FIX_MODEL,
          permissionMode: 'acceptEdits',
          allowedTools: [...preflightFixAgentSpec.allowedTools],
          disallowedTools: [...preflightFixAgentSpec.disallowedTools],
          maxTurns: 8,
        },
      },
    };
  },

  finish: ({ input, crashed }) => {
    if (crashed) {
      // No commit and no verification re-run on this path, exactly as before:
      // a crashed turn's partial edits are not promoted to the branch and
      // nothing is claimed about the clause.
      return { result: { runId: input.runId, cleared: false }, endMetadata: {} };
    }

    // Persist the agent's edits onto forge-studio (durable; survives a later
    // tree reset) BEFORE the verification re-run reads the working tree.
    try {
      commitStudioChange(input.projectDir, `forge-studio: preflight-fix ${input.clause}`);
    } catch {
      /* best-effort */
    }

    // Verification gate: re-run preflight and read the clause's pass flag.
    let cleared = false;
    try {
      const report = runPreflight(input.projectDir, { forgeRoot: input.forgeRoot });
      cleared = report.clauses.some((c) => c.clause === input.clause && c.pass);
    } catch {
      cleared = false;
    }

    return {
      result: { runId: input.runId, cleared },
      endMetadata: { runId: input.runId, clause: input.clause, cleared },
    };
  },
};

/** Run one preflight-fix turn. The entry point's name and shape are unchanged. */
export async function runPreflightFixTurn(input: RunPreflightFixInput): Promise<RunPreflightFixResult> {
  return runFixTurn(preflightFixKind, input);
}
