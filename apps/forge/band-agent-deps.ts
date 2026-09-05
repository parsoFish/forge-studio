/**
 * The assembly seam for `packages/agents/band-agent-run.ts`'s `BandAgentDeps`.
 *
 * `packages/agents` is rank 3. The two band pipelines are `@forge/factory`
 * (rank 7) and the queue/manifest readers are `@forge/flows` (rank 6), so none
 * of them may be imported there — before this carve the whole surface lived in
 * `orchestrator/`, outside the package graph, which is what the four
 * `legacy-to-package` rows it carried were about. `apps/forge` sits above every
 * package and is the one tree that may hold all three at once, so the binding
 * lives here and the CLI passes it in (`cli.ts`'s `agent` case).
 *
 * This module is deliberately nothing but the binding: no validation, no
 * defaulting, no reshaping. Every guard the standalone surface applies — the
 * initiative-id charset, the in-flight refusal, the worktree bounds check —
 * stays in the package that owns the seam.
 */

import { isChangeClass, type ChangeClass } from '@forge/factory/class-profiles.ts';
import { runAdversarialReview } from '@forge/factory/phases/adversarial-review.ts';
import { parseManifest } from '@forge/flows/manifest.ts';
import { getPaths } from '@forge/flows/queue.ts';
import type { BandAgentDeps } from '@forge/agents/band-agent-run.ts';

/**
 * The real band pipelines, queue paths and manifest parser.
 *
 * `getPaths` and `parseManifest` are passed by reference: `BandQueuePaths` and
 * `BandInitiativeFields` declare their fields by name, so a rename on the flows
 * side fails the repo-wide typecheck HERE (COMMON §15.71) rather than passing
 * against the fakes in the package's own tests.
 */
/**
 * The manifest's `class` reaches `packages/agents` as a plain string — that
 * package may not name the example factory's class vocabulary. Narrowing it is
 * the assembly's job, and it FAILS CLOSED: an unknown class is not reviewed
 * under a guessed policy.
 */
function asChangeClass(value: string): ChangeClass {
  if (!isChangeClass(value)) {
    throw new Error(
      value === ''
        ? 'band dispatch: the initiative declares no `class` — the change class selects the review lenses (ADR 051) and has no default'
        : `band dispatch: "${value}" is not a change class the installed factory knows — no lens profile can be selected for it`,
    );
  }
  return value;
}

export const bandAgentDeps: BandAgentDeps = {
  queuePaths: getPaths,
  parseInitiativeManifest: parseManifest,
  runPipeline: async ({ input, logger, queryFn }) =>
    await runAdversarialReview({ ...input, changeClass: asChangeClass(input.changeClass) }, logger, { queryFn }),
};
