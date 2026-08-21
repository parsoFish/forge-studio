/**
 * Flow-builder artifact catalog (R3-06 / R2-05-F1 fold-in).
 *
 * WHY duplicated here rather than fetched from the registry: the flow
 * builder's ArtifactPicker/FlowBuilderCanvas/AgentPalette consume this list
 * SYNCHRONOUSLY while rendering (no loading state, no network round-trip), so
 * it cannot simply be an async fetch from `studio/artifact-templates/`.
 *
 * WHAT enforces it: `forge-ui/lib/flow-artifact-catalog.test.ts` (AT-52/AT-53)
 * pins this module's id set EXACTLY equal to the on-disk
 * `studio/artifact-templates/` id set, in both directions — any future
 * divergence (a template added/removed on disk without this list following)
 * is a red CI run, not a silent drift. Two former entries here — `reflection`
 * and `demo` — had no on-disk template and were deleted as part of this fix;
 * `forge studio lint`'s promoted `artifact/no-template` check (R2-05-F1) would
 * otherwise let an operator pick either and author a flow that fails lint.
 *
 * Full derivation from the registry (so this hand-kept list can be retired
 * entirely) is out of scope here — tracked as batch-C / R2-05 follow-on work.
 */

export type ArtifactDef = {
  id: string;
  name: string;
  desc: string;
};

export const ARTIFACTS: ArtifactDef[] = [
  { id: 'plan', name: 'PLAN.md', desc: 'Approved plan: scope, ACs, decomposition.' },
  { id: 'work-items', name: 'work-items/*.md', desc: 'Self-contained work item specs.' },
  { id: 'wi-branches', name: 'wi-branches', desc: 'One reviewed branch per completed WI.' },
  { id: 'pr', name: 'PR', desc: 'Unified PR with demo evidence attached.' },
  { id: 'verdict', name: 'verdict.json', desc: 'Approve / send-back decision with reasons.' },
  // R4-07/R4-08: the wave-4 successor-agent artifacts (registered templates).
  { id: 'demo-fix-spec', name: 'demo-fix-spec.json', desc: 'Demo AC-miss judgment: scoped fix proposals for the develop agent.' },
  { id: 'review-findings', name: 'review-findings.json', desc: 'Adversarial critique: severity-ranked findings with file:line evidence.' },
  // R4-18: an onboard-shaped flow's onboard → contract-check edge (the OOTB
  // wrapper was retired in W7-C1; the artifact kind stays authorable).
  { id: 'contract', name: 'Contract', desc: 'Onboarding convergence signal: the project is ready for the real forge↔project contract preflight.' },
];
