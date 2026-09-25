/**
 * The run view's shape (ADR 028 §3: "a run is derived, never stored").
 *
 * Moved here from `packages/contracts/run-view-types.ts` (bead `forge-8vfn.5.17`,
 * M2-B's cycle-break relocation): the ONE declaration for
 * `RunStatus`/`RunPhaseStatus`/`RunPhaseMeta`/`Run`, shared by the server
 * derivation (`@forge/flows`'s `run-model.ts`/`run-model-derive.ts`) and the
 * `'use client'` wire-parse path (`apps/studio/lib/studio-client.ts`'s
 * `parseRun`), which hand-mirrored these four with no parity test holding
 * them in step until now (`studio-client.test.ts`, bead `forge-cv9`).
 *
 * The two mirrors had drifted on three fields — `costUsd`, `workItems[].costUsd`
 * and `trigger.kind` — and this declaration resolves each toward the
 * WIRE-HONEST side rather than the server's own naive derivation (which
 * neither field ever violates, but neither proves): see `design.md`
 * §"Run view types — three fields resolved toward the wire, not the server"
 * for the measured reason each one differs from what a fresh `Run` type
 * would naively declare. That section also carries the field-level rationale
 * this header used to hold, moved out because comment volume — not field
 * count — is what this package's LOC cap measures (the `runnable-source.ts`
 * row's own precedent).
 */

export type RunStatus = 'planned' | 'active' | 'gated' | 'complete' | 'failed';
export type RunPhaseStatus = 'pending' | 'active' | 'complete' | 'retrying' | 'failed';

export type RunPhaseMeta = {
  costUsd: number;
  retries: number;
  model?: string;
  lastProgressAt?: string;          // ISO — UI computes "Nm ago"
  lastEventAt?: string;              // latest event of ANY type on this node (design.md)
  wedged?: boolean;                 // no tool progress ≥30 min while active|retrying
  iter?: number;
  iterBudget?: number;
  brainReads?: number;
  delivered?: { files: number; insertions: number; commits: number };
  gateChecks?: { id: string; pass: boolean; detail?: string }[];
  findings?: { total: number; blocker: number; major: number; minor: number; info: number };
};

export type Run = {
  id: string;
  flowId: string;
  initiativeId: string;
  initiative: string;
  project?: string;                  // the manifest's project slug (GateBar)
  architectSessionId?: string;       // the architect session that produced this initiative
  status: RunStatus;
  origin: 'architect' | 'human-directed' | 'triggered';
  /**
   * `null` = no cost recorded, never a fabricated 0 (bead `forge-ygys`).
   * Server derivation always sums to a real number; `null` is the client
   * wire-parse's honest response to a missing/non-finite payload field.
   */
  costUsd: number | null;
  startedAt?: string;
  completedAt?: string;              // the real cycle-completion instant (W6-RV-2)
  phases: Record<string, RunPhaseStatus>;
  phaseMeta: Record<string, RunPhaseMeta>;
  artifactsReady: Partial<Record<'plan' | 'work-items' | 'pr' | 'demo' | 'verdict' | 'reflection', 'view' | 'gate'>>;
  gate?: string;
  gateNote?: string;
  failedAt?: string;
  failNote?: string;
  /** A cost-ceiling stop — resumable, distinct from an ordinary crash (ON-7 defect 2). */
  stopOnBudget?: {
    spentUsd: number;
    ceilingUsd: number;
    resumable: true;
    completedWorkItems: number;
    totalWorkItems: number;
    stoppedBeforeNode?: string;
  };
  reflectionLost?: string;           // merged/closed cycle whose reflection was lost (cause)
  reflectionLostNote?: string;
  /** `costUsd` optional per work item — the wire-parse carries this array through unvalidated. */
  workItems?: { id: string; status: RunPhaseStatus; costUsd?: number; task?: string; dependsOn?: string[]; delivered?: { files: number; insertions: number; commits: number } }[];
  prUrl?: string;                    // this run's PR URL, from its own reviewer.pr-opened event
  flowLineage: string[];             // the seed flows this run traversed
  /**
   * What started this run — derived, never stored/authored. `kind` is a bare
   * `string`, not `TriggerKindId`: real manifests and flow-firing events
   * carry values (e.g. `'schedule'`) outside that shipped-kind union, and
   * `deriveTrigger` (`@forge/flows`) only ever reaches this field through an
   * unchecked `as TriggerKindId` cast — see `design.md`.
   */
  trigger?: {
    kind: string;
    source: string;
    scope: string | null;
  };
};
