import type { ReactElement } from 'react';

export type Provenance = 'ootb' | 'operator' | 'vision';

/**
 * OOTB-provenance badge (R6-03-F3), mirroring the end-state mockup
 * (mockups/studio-endstate-v2/components.jsx `ProvenanceBadge`):
 *
 *   ootb     -> a small "ootb" badge  (this object ships out of the box)
 *   vision   -> a dim "planned" badge (declared but not built yet)
 *   operator -> nothing; operator-authored objects are the unbadged default
 *
 * The badge is only ever rendered from a REAL provenance signal, never a
 * fabricated default. Today the one object type carrying a per-object OOTB
 * signal is Flow (`origin`) — see `provenanceOfFlowOrigin`. Other object types
 * have no per-object provenance field yet (a server data-model gap reported at
 * R6-03-F3 close); this component is the shared primitive they adopt once they
 * do.
 */
export function ProvenanceBadge({ provenance }: { provenance?: Provenance | null }): ReactElement | null {
  if (provenance === 'ootb') {
    return <span className="badge badge-ootb" data-provenance="ootb">ootb</span>;
  }
  if (provenance === 'vision') {
    return <span className="badge badge-dim" data-provenance="vision">planned</span>;
  }
  return null; // operator-authored (or unknown): the default, unbadged
}

/**
 * Map a Flow's `origin` to provenance. Only the shipped seeds
 * (`seed` / `ootb-library`) are OOTB; everything else — operator `studio`, or
 * an absent origin — is operator-authored and carries no badge. Never claims
 * OOTB without the seed signal.
 */
export function provenanceOfFlowOrigin(origin?: string | null): Provenance {
  return origin === 'seed' || origin === 'ootb-library' ? 'ootb' : 'operator';
}
