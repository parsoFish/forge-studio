'use client';

import { modelChipLabel } from '@/lib/model-chip';

/**
 * ProvenanceStrip — the one-line "where this view came from" strip every
 * session panel carries: the phase the affordances were derived from, and the
 * model tier the session is running on.
 *
 * W8-B3 (ON-5, sessions-kinds-R02): extracted out of
 * `SessionInteractivePanel` so `SessionProjectBrainPanel` renders the SAME
 * strip rather than a second copy that could drift. project-brain was the only
 * one of the eight kinds with no provenance at all; a second hand-written
 * strip beside this one is exactly the two-sources-of-truth shape the rest of
 * this directory spends its comments avoiding.
 */
export function ProvenanceStrip({ phase, modelTier }: { phase: string; modelTier: string | null }): JSX.Element {
  return (
    <div
      data-section="session-provenance"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--faint)',
        fontFamily: 'ui-monospace, Menlo, monospace', padding: '2px 0 10px',
      }}
    >
      <span>derived from phase {phase}</span>
      <span
        data-component="session-model-chip"
        data-model-tier={modelTier ?? ''}
        style={{
          border: '1px solid var(--line-2)', borderRadius: 999, padding: '1px 8px',
          color: 'var(--dim)', whiteSpace: 'nowrap',
        }}
      >
        {/* W7-A2/W7-C3 (sessions-kinds-31) — a null tier is honestly "not
            recorded", never the literal word "default" (not a tier the picker
            offers). One rule, unit-pinned: lib/model-chip.ts. */}
        model: {modelChipLabel(modelTier)}
      </span>
    </div>
  );
}
