import type { ReactElement } from 'react';
import type { Provenance } from '../lib/studio-client';

/**
 * The badge's value space is exactly the wire's `Provenance`
 * (`'ootb' | 'operator' | 'unknown'`, `lib/studio-client.ts`). It used to
 * widen this with a badge-component-only `'vision'` ("declared but not
 * built yet"), but no object type on the wire ever carried
 * `provenance: 'vision'` — `parseProvenance` (`lib/studio-client.ts`) and
 * every real call site (`LibraryCard.tsx`) only ever produce the three real
 * tokens below, so `'vision'` was declared data with no source (forge-r2j)
 * and is removed rather than kept for a future caller that does not exist.
 */
export type ProvenanceBadgeValue = Provenance;

/**
 * OOTB-provenance badge (R6-03-F3; REWRITTEN forge-3oq, R6-07 batch-H
 * honesty pass):
 *
 *   ootb     -> a small "ootb" badge  (this object ships out of the box)
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
  // operator-authored, unknown (the server cannot attest), or null/undefined:
  // the unbadged default. A badge is only ever shown from a REAL positive signal.
  return null;
}
