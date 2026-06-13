'use client';

import type { Kb } from '@/lib/studio-client';

export function KbBind({ kb, kbs, onChange }: { kb: string | null; kbs: Kb[]; onChange: (v: string | null) => void }) {
  const boundKb = kb ? kbs.find((k) => k.id === kb) : null;

  return (
    <div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 6 }}>Knowledge Base</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {boundKb ? (
          <span className="chip" data-kind="kb">
            <span className="dot" />
            {boundKb.name}
            <span className="x" onClick={() => onChange(null)} style={{ cursor: 'pointer' }}>×</span>
          </span>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--faint)', fontStyle: 'italic' }}>None bound</span>
        )}
      </div>
      <select
        value={kb ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        style={{
          width: '100%', background: 'var(--panel)', border: '1px solid var(--line-2)',
          borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'var(--font-body)',
          fontSize: 12.5, padding: '6px 10px', cursor: 'pointer', outline: 'none', marginBottom: 8,
        }}
      >
        <option value="">— bind a knowledge base —</option>
        {kbs.map((k) => <option key={k.id} value={k.id}>{k.name} [{k.scope}]</option>)}
      </select>
      <button
        className="btn btn-ghost"
        style={{ width: '100%', justifyContent: 'center', fontSize: 12 }}
        disabled
        title="KB create is M5"
      >
        + Create project brain
      </button>
    </div>
  );
}
