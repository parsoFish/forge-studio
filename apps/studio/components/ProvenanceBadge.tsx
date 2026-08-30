import type { ReactElement } from 'react';
import type { Provenance } from '../lib/studio-client';

/**
 * The badge's own value space widens the wire's `Provenance`
 * (`'ootb' | 'operator' | 'unknown'`, `lib/studio-client.ts`) with `'vision'`
 * — a BADGE-COMPONENT concern ("declared but not built yet"), not a wire
 * value: no object type on the wire ever carries `provenance: 'vision'`.
 */
export type ProvenanceBadgeValue = Provenance | 'vision';

/**
 * OOTB-provenance badge (R6-03-F3; REWRITTEN forge-3oq, R6-07 batch-H
 * honesty pass):
 *
 *   ootb     -> a small "ootb" badge  (this object ships out of the box)
 *   vision   -> a dim "planned" badge (declared but not built yet)
 *   operator -> nothing; operator-authored objects are the unbadged default
 *   unknown  -> nothing; the server itself could not attest a provenance —
 *               an honest "no data", never upgraded to "operator" or "ootb"
 *
 * `provenance` is a SERVER FACT now — every object type (Flow / Agent /
 * Project / Kb, `lib/studio-client.ts`) carries its own real `provenance`
 * field on the wire. This component only RENDERS that field; it no longer
 * infers one. `provenanceOfFlowOrigin` (the prior client-side inference from
 * `flow.origin`) is DELETED — origin-based inference was itself the defect
 * (a client claiming to know something only the server can actually attest,
 * and doing so for Flow alone while every other object type rendered no
 * badge at all).
 */
export function ProvenanceBadge({
  provenance,
}: {
  provenance?: ProvenanceBadgeValue | null;
}): ReactElement | null {
  if (provenance === 'ootb') {
    return <span className="badge badge-ootb" data-provenance="ootb">ootb</span>;
  }
  if (provenance === 'vision') {
    return <span className="badge badge-dim" data-provenance="vision">planned</span>;
  }
  // operator-authored, unknown (the server cannot attest), or null/undefined:
  // the unbadged default. A badge is only ever shown from a REAL positive signal.
  return null;
}
