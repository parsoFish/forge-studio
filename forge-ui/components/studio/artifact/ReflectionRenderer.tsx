'use client';

/**
 * Reflection artifact renderer.
 * 3-col went-well / friction / lessons + KB links + inconsistencies section.
 * Sourced from fetchReflection or the cycle's reflection artifact.
 */

export type ReflectionLesson = {
  text: string;
  target?: string;
};

export type ReflectionDoc = {
  wentWell?: string[];
  friction?: string[];
  lessons?: ReflectionLesson[];
  inconsistencies?: string[];
};

function ColHead({ children, variant }: { children: React.ReactNode; variant: 'good' | 'friction' | 'lessons' }) {
  const color = variant === 'good' ? 'var(--green)' : variant === 'friction' ? 'var(--amber)' : 'var(--steel)';
  return (
    <div style={{
      fontFamily: 'var(--font-display)',
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      color,
      marginBottom: 12,
      paddingBottom: 8,
      borderBottom: '1px solid var(--line)',
    }}>
      {children}
    </div>
  );
}

export function ReflectionRenderer({ doc }: { doc: ReflectionDoc }) {
  const wentWell    = doc.wentWell    ?? [];
  const friction    = doc.friction    ?? [];
  const lessons     = doc.lessons     ?? [];
  const inconsistencies = doc.inconsistencies ?? [];

  return (
    <div>
      {/* 3-col grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: 16,
        marginBottom: 24,
      }}>
        {/* Went well */}
        <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: 16 }}>
          <ColHead variant="good">Went well</ColHead>
          {wentWell.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--faint)' }}>None logged.</div>
          ) : (
            wentWell.map((item, i) => (
              <div
                key={i}
                style={{
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: 'var(--text)',
                  padding: '8px 0',
                  borderBottom: i < wentWell.length - 1 ? '1px solid var(--line)' : 'none',
                  display: 'flex',
                  gap: 8,
                }}
              >
                <span style={{ color: 'var(--green)', flexShrink: 0, marginTop: 2, fontSize: 14 }}>✓</span>
                {item}
              </div>
            ))
          )}
        </div>

        {/* Friction */}
        <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: 16 }}>
          <ColHead variant="friction">Friction</ColHead>
          {friction.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--faint)' }}>None logged.</div>
          ) : (
            friction.map((item, i) => (
              <div
                key={i}
                style={{
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: 'var(--text)',
                  padding: '8px 0',
                  borderBottom: i < friction.length - 1 ? '1px solid var(--line)' : 'none',
                  display: 'flex',
                  gap: 8,
                }}
              >
                <span style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 2, fontSize: 14 }}>△</span>
                {item}
              </div>
            ))
          )}
        </div>

        {/* Lessons */}
        <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: 16 }}>
          <ColHead variant="lessons">Lessons</ColHead>
          {lessons.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--faint)' }}>None logged.</div>
          ) : (
            lessons.map((lesson, i) => (
              <div
                key={i}
                style={{
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: 'var(--text)',
                  padding: '8px 0',
                  borderBottom: i < lessons.length - 1 ? '1px solid var(--line)' : 'none',
                }}
              >
                <div style={{ marginBottom: lesson.target ? 5 : 0, lineHeight: 1.5 }}>
                  {lesson.text}
                </div>
                {lesson.target && (
                  <a
                    href={`/knowledge?id=${encodeURIComponent(lesson.target)}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      fontWeight: 600,
                      color: 'var(--c-kb)',
                      background: 'rgba(74,222,128,.1)',
                      border: '1px solid rgba(74,222,128,.3)',
                      borderRadius: 3,
                      padding: '1px 6px',
                      marginTop: 4,
                      textDecoration: 'none',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    ⬡ {lesson.target}
                  </a>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Inconsistencies */}
      <div>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--faint)',
          marginBottom: 10,
          paddingBottom: 6,
          borderBottom: '1px solid var(--line)',
        }}>
          Inconsistencies
        </div>
        {inconsistencies.length === 0 ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '14px 16px',
            background: 'rgba(74,222,128,.07)',
            border: '1px solid rgba(74,222,128,.25)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--green)',
            fontSize: 13,
          }}>
            <span>✓</span>
            None — closes clean.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {inconsistencies.map((ic, i) => (
              <div key={i} style={{ color: 'var(--red)', fontSize: 13, padding: '6px 0' }}>
                ⚠ {ic}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
