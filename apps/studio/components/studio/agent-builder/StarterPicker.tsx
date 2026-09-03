'use client';

/**
 * StarterPicker — choose a curated starter (or start blank) for a new agent.
 *
 * Extracted from app/agents/[id]/page.tsx (D12 file-size split, R2-09) — a
 * pure move, no behaviour change. `data-section="starter-picker"` and
 * `data-starter-option` stay byte-identical (the agents journey drives both).
 *
 * Bead `forge-8vfn.5.15`: each option additionally publishes
 * `data-action="starter-<id>"`. `data-starter-option` is the identity the
 * journey queries by CSS; `data-action` is the only vocabulary a story beat's
 * `press` verb resolves, and picking a starter is the act that MOUNTS the rest
 * of the builder — `[data-action="toggle-advanced"]` does not exist on
 * `/agents/new` until it happens (S5 beat 4's second cause). Both attributes
 * stay: they answer different readers, and dropping either breaks one of them.
 */

import type { Agent } from '@/lib/studio-client';

type Props = {
  starters: Agent[];
  onPick: (s: Agent) => void;
  onBlank: () => void;
};

export function StarterPicker({ starters, onPick, onBlank }: Props) {
  return (
    <div data-component="starter-picker" data-section="starter-picker" style={{ padding: '8px 2px' }}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>
        Start from a starter
      </h2>
      <p style={{ fontSize: 13, color: 'var(--dim)', maxWidth: 520, lineHeight: 1.6, margin: '0 0 18px' }}>
        Pick a ready-made agent to begin. You can edit everything after — these just give you a
        clean, minimal starting point.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        {starters.map((s) => (
          <button
            key={s.id}
            type="button"
            data-starter-option={s.id}
            data-action={`starter-${s.id}`}
            onClick={() => onPick(s)}
            style={{
              textAlign: 'left',
              background: 'var(--panel)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius)',
              padding: '16px 16px 14px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
              {s.name}
            </span>
            <span style={{ fontSize: 12.5, color: 'var(--dim)', lineHeight: 1.5 }}>
              {s.purpose}
            </span>
          </button>
        ))}
        <button
          type="button"
          data-starter-option="blank"
          data-action="starter-blank"
          onClick={onBlank}
          style={{
            textAlign: 'left',
            background: 'transparent',
            border: '1px dashed var(--line)',
            borderRadius: 'var(--radius)',
            padding: '16px 16px 14px',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            Blank agent
          </span>
          <span style={{ fontSize: 12.5, color: 'var(--faint)', lineHeight: 1.5 }}>
            Start from scratch with sensible defaults.
          </span>
        </button>
      </div>
    </div>
  );
}
