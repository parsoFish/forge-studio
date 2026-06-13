'use client';

export function NorthStar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const n = value.length;
  const over = n > 140;
  return (
    <section>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        North Star <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
      </div>
      <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 60% 80% at 15% 50%, rgba(92,200,255,.07) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ padding: '12px 18px 10px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>✦</span>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--c-project)' }}>North Star</span>
          <span style={{ fontSize: 12, color: 'var(--faint)', fontStyle: 'italic', marginLeft: 'auto', maxWidth: 340, textAlign: 'right' }}>every agent decision in every flow gets judged against this line</span>
        </div>
        <div style={{ padding: '16px 20px 14px', position: 'relative' }}>
          <textarea
            rows={2}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="One sentence that defines what done looks like for this project…"
            style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 500, color: 'var(--text)', lineHeight: 1.45, resize: 'none', minHeight: 56, padding: 0, boxSizing: 'border-box' }}
          />
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: over ? 'var(--amber)' : 'var(--faint)', textAlign: 'right', marginTop: 6 }}>
            {n} / 140
          </div>
        </div>
      </div>
    </section>
  );
}
