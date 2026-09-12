/**
 * The artifact a GATED run is actually waiting on — `forge-8vfn.7.6.62`.
 *
 * THE BUG THIS REPLACES IS A NAMING COLLISION. `run.gate`
 * (`packages/flows/run-view-types.ts:110`) is a NODE ID, "derived from the
 * run's own events (G9)" so a user-authored flow can name its gate node
 * anything. `node.gate` (`packages/contracts/studio-types.ts:161`) is the GATE
 * KIND — `plan` or `verdict`. Two fields, one name, different meanings.
 *
 * `RunRail.tsx` receives `flowId?: string` and NOT the flow definition, so it
 * held a node id with nothing to resolve it against and hardcoded
 * `type=verdict` for any run whose status was `gated`. `PhaseDrawer`'s
 * `ArtifactChip` was handed the type per entry and threw it away on the gate
 * branch while using it on the view branch. Both sent a PLAN-gated architect
 * run (`studio/flows/forge-architect/flow.yaml:10` — `gate: plan`) to a review
 * verdict that does not exist for it, where `lib/artifact-mode.ts` then
 * declines to render a gate it cannot justify and the operator lands somewhere
 * that looks broken.
 *
 * SO THIS RETURNS NULL RATHER THAN GUESSING, and every caller renders nothing
 * on null. Guessing is what produced the defect: a missing link is honest, a
 * wrong link spends the operator's attention on an artifact their run does not
 * have. The one thing this must never do is answer when it does not know.
 */

import type { Flow, Run } from './studio-client';

export type GateArtifactTarget = {
  /** `/artifact?run=…&type=<gate kind>&mode=gate` — the in-UI viewer, never a raw file route. */
  href: string;
  /** The gate KIND the parked node declares: `plan`, `verdict`, or whatever a user-authored flow names. */
  gateType: string;
  /** The NODE ID the run parked at (`run.gate`), so a surface can say WHICH station is holding. */
  gateNode: string;
};

/**
 * @param run  the run, or null while the page is still resolving one
 * @param flow the flow DEFINITION — required, because the gate kind lives on
 *             the node and nothing else carries it
 * @returns the gate target, or `null` when it cannot be derived from facts
 */
export function gateArtifactHref(run: Run | null, flow: Flow | null): GateArtifactTarget | null {
  if (run === null || flow === null) return null;
  if (run.status !== 'gated') return null;

  const gateNode = run.gate;
  if (typeof gateNode !== 'string' || gateNode === '') return null;

  const node = flow.nodes.find((n) => n.id === gateNode);
  const gateType = node?.gate;
  // A gate-less node is not an error: `run.gate` names where the run PARKED,
  // and a flow may park at a node that declares no gate kind. There is simply
  // no artifact to point at, and saying so beats naming the wrong one.
  if (typeof gateType !== 'string' || gateType === '') return null;

  return {
    href: `/artifact?run=${encodeURIComponent(run.id)}&type=${encodeURIComponent(gateType)}&mode=gate`,
    gateType,
    gateNode,
  };
}
