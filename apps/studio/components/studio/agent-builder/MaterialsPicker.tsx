'use client';

/**
 * MaterialsPicker — the allowed-input-materials toggle section (R2-09 C4).
 * One toggle per MATERIAL_KINDS entry; labels the `data-files` kind
 * "data files" in the UI while keeping the id kebab-case everywhere else
 * (the DOM attribute value, the saved AgentDefinition field).
 *
 * These are surfaced on the agent's kickoff screen so the operator can
 * upload matching material — ENFORCEMENT of the declared set happens at
 * R6-04-F2's upload seam, not in this UI; this section only declares.
 */

import { MATERIAL_KINDS } from '@/lib/studio-client';

// Display label only — the id in the DOM (`data-material`) and on the wire
// (AgentState.materials, MATERIAL_KINDS) stays kebab-case.
const MATERIAL_LABELS: Record<string, string> = {
  images: 'images',
  documents: 'documents',
  audio: 'audio',
  'data-files': 'data files',
};

type Props = {
  materials: string[];
  onToggle: (kind: string) => void;
};

export function MaterialsPicker({ materials, onToggle }: Props) {
  return (
    <div
      className="field-group"
      data-component="materials-picker"
      data-section="materials"
      data-materials-count={materials.length}
    >
      <label className="field-label" style={{ marginBottom: 4 }}>Allowed input materials</label>
      <p className="save-hint" style={{ margin: '0 0 6px' }}>
        What the operator may upload when kicking this agent off. Enforcement happens at
        upload time — declaring a kind here only makes it selectable there.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {MATERIAL_KINDS.map((kind) => {
          const selected = materials.includes(kind);
          return (
            <span
              key={kind}
              role="button"
              tabIndex={0}
              data-material={kind}
              data-selected={selected ? 'true' : 'false'}
              className={`material-toggle${selected ? ' selected' : ''}`}
              onClick={() => onToggle(kind)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(kind); }
              }}
            >
              {MATERIAL_LABELS[kind] ?? kind}
            </span>
          );
        })}
      </div>
    </div>
  );
}
