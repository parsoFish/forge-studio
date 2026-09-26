/**
 * packages/flows/cycle-pr-open.ts — the develop flow's PR-open step (`openPrInline`),
 * split out of cycle-helpers.ts when forge-8vfn.8.1.24 grew it past the 800-line cap.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { EventLogger } from '@forge/kernel';
import { matchesDnsFailureSignature } from '@forge/agents';
import type { CycleInput } from './cycle-context.ts';
import { DEMO_MD_BASENAME, worktreeDemoMdPath, worktreeDemoRelDir } from './demo-paths.ts';
import { openPullRequest } from './pr.ts';
import { persistManifestResumeFromIntegrate } from './manifest.ts';

// ---------------------------------------------------------------------------
// openPrInline
// ---------------------------------------------------------------------------

/**
 * REV-6: inline PR-opening (previously `runReviewer`). Opens the PR from the
 * unifier-authored `.forge/pr-description.md`, emitting every event the old
 * `runReviewer` emitted (verbatim phase/skill/message values) so the forge-ui
 * phase hexes and e2e harness remain unaffected.
 *
 * Returns `ReviewerOutcome` — always `'pr-open'` on success, or throws on
 * failure. Bead `forge-8vfn.8.1.24` / T1 ruling 1609: the throw's cause now
 * differs by what actually failed —
 *   - a genuinely missing demo/PR-description prerequisite throws with a
 *     structured `unifier.prerequisite-missing` event (matching the former
 *     reviewer.ts behaviour exactly);
 *   - prerequisites present but `openPullRequest` itself failed (push / gh)
 *     throws `reviewer.pr-open-failed: <the real cause>` — no more generic
 *     "missing prerequisites: " with nothing named after the colon.
 */
export async function openPrInline(
  input: CycleInput,
  logger: EventLogger,
): Promise<import('./cycle-context.ts').ReviewerOutcome> {
  const start = logger.emit({
    initiative_id: input.initiativeId,
    phase: 'review-loop',
    skill: 'review-router',
    event_type: 'start',
    input_refs: [input.worktreePath, input.manifestPath],
    output_refs: [],
  });

  const prDescriptionPath = resolve(input.worktreePath, '.forge', 'pr-description.md');
  const prTitle = `forge: ${input.initiativeId}`;
  const result = openPullRequest(input.worktreePath, prDescriptionPath, prTitle);
  const prUrl = 'url' in result ? result.url : null;
  const errorText = 'error' in result ? result.error : null;

  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: start.event_id,
    phase: 'review-loop',
    skill: 'review-router',
    event_type: prUrl ? 'log' : 'error',
    input_refs: [prDescriptionPath],
    output_refs: prUrl ? [prUrl] : [],
    message: prUrl ? 'reviewer.pr-opened' : 'reviewer.pr-open-failed',
    metadata: { url: prUrl, pr_created: prUrl !== null, error: errorText },
  });

  if (!prUrl) {
    // Resolved through the demo-path SSOT (plan 2.5 / N3): the diagnostic must
    // name the path the unifier actually authors (artifactRoot-resolved), or a
    // clean delivery on an artifactRoot project reads as "demo missing" at a
    // location nothing writes to (the 2026-07-05 false-negative theme).
    const demoMdPath = worktreeDemoMdPath(input.worktreePath, input.initiativeId);
    const demoMdRel = `${worktreeDemoRelDir(input.worktreePath, input.initiativeId)}/${DEMO_MD_BASENAME}`;
    const prDescPath = resolve(input.worktreePath, '.forge', 'pr-description.md');
    const missing: string[] = [];
    if (!existsSync(demoMdPath)) missing.push(demoMdRel);
    if (!existsSync(prDescPath)) missing.push('.forge/pr-description.md');

    if (missing.length > 0) {
      logger.emit({
        initiative_id: input.initiativeId,
        parent_event_id: start.event_id,
        phase: 'review-loop',
        skill: 'review-router',
        event_type: 'error',
        input_refs: [input.worktreePath],
        output_refs: [],
        message: 'unifier.prerequisite-missing',
        metadata: { missing, demo_md_path: demoMdPath, pr_description_path: prDescPath },
      });
      logger.emit({
        initiative_id: input.initiativeId,
        parent_event_id: start.event_id,
        phase: 'review-loop',
        skill: 'review-router',
        event_type: 'end',
        input_refs: [input.worktreePath],
        output_refs: [input.worktreePath],
        metadata: { outcome: 'failed', pr_url: null, missing_prerequisites: missing },
      });
      throw new Error(
        `reviewer.pr-open-failed: unifier did not author a PR — missing prerequisites: ${missing.join(', ')}. ` +
          `Dev-loop work items must produce their declared \`creates:\` paths before the unifier can build a demo bundle.`,
      );
    }

    // Bead forge-8vfn.8.1.24 / T1 ruling 1609: both prerequisites exist — the
    // dev-loop + integrate + adversarial-review bands already succeeded, and
    // the failure is `openPullRequest` itself (push / gh), not a missing
    // artefact. When the cause matches the environment/DNS/transient-network
    // signatures PR #946 taught the classifier, stamp the ADR-019 resume
    // marker BEFORE throwing: a resume must reuse the preserved worktree and
    // re-enter at `integrate` (skipping PM + per-WI dev-loop, ADR 019) rather
    // than wipe `.forge/work-items/` and rebuild everything from scratch.
    // `persistManifestResumeFromIntegrate` already existed for exactly this
    // case; it had no caller until now.
    if (errorText !== null && matchesDnsFailureSignature(errorText)) {
      persistManifestResumeFromIntegrate(input.manifestPath);
    }

    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'review-loop',
      skill: 'review-router',
      event_type: 'end',
      input_refs: [input.worktreePath],
      output_refs: [input.worktreePath],
      metadata: { outcome: 'failed', pr_url: null, missing_prerequisites: [] },
    });
    throw new Error(`reviewer.pr-open-failed: ${errorText ?? 'gh/git failed with no diagnostic message'}`);
  }

  const outcome: import('./cycle-context.ts').ReviewerOutcome = 'pr-open';
  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: start.event_id,
    phase: 'review-loop',
    skill: 'review-router',
    event_type: 'end',
    input_refs: [input.worktreePath],
    output_refs: [prUrl],
    metadata: { outcome, pr_url: prUrl },
  });

  return outcome;
}
