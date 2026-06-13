'use client';

export function Instructions({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const parts = value.trim().length > 0
    ? value.trim().split(/[.\n]+/).map((s) => s.trim()).filter(Boolean)
    : [];

  return (
    <section>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        Standing Instructions <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
      </div>
      <div className="panel">
        <div className="panel-head"><span>Constraints injected into every agent working this project</span></div>
        <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <textarea
            className="input instructions-textarea"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, minHeight: 80, resize: 'vertical' }}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="TypeScript strict. Live calls behind env guard. Conventional commits…"
          />
          <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-display)', fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 6 }}>What agents will actually see</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {parts.length === 0
                ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, fontStyle: 'italic', color: 'var(--faint)' }}>— type instructions above —</span>
                : parts.map((t, i) => (
                    <span key={i} style={{ background: 'var(--panel-3)', border: '1px solid var(--line-2)', borderRadius: 4, padding: '3px 8px', fontSize: 11.5, color: 'var(--dim)', fontFamily: 'var(--font-mono)' }}>
                      {t}
                    </span>
                  ))
              }
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
