'use client';

/**
 * ReviewFindingsPanel — the adversarial-review agent's findings (R4-08-F3),
 * rendered on the /artifact verdict surface in BOTH gate and view mode.
 *
 * These are agent CLAIMS the operator weighs before deciding — never a gate by
 * themselves (ADR-021: approve IS the merge and stays human). An empty
 * findings array is an explicit clean pass and renders as such; a missing
 * artifact (pre-R4-10 cycles) renders nothing — the caller passes null.
 *
 * DOM-as-metrics: [data-section="review-findings"][data-findings-count],
 * per-row [data-finding][data-finding-severity][data-finding-category].
 */

export type ReviewFindingsDoc = {
  initiative_id?: string;
  headSha?: string;
  reviewedAt?: string;
  summary?: string;
  findings?: Array<{
    id?: string;
    severity?: 'blocker' | 'major' | 'minor' | 'info';
    category?: string;
    title?: string;
    detail?: string;
    evidence?: Array<{ file?: string; line?: number; excerpt?: string }>;
    acRef?: string;
  }>;
};

const SEVERITY_COLOURS: Record<string, string> = {
  blocker: 'var(--red, #f85149)',
  major: 'var(--amber, #d29922)',
  minor: 'var(--dim, #8b949e)',
  info: 'var(--faint, #6e7681)',
};

const SEVERITY_ORDER = ['blocker', 'major', 'minor', 'info'];

export function ReviewFindingsPanel({ doc }: { doc: ReviewFindingsDoc | null }) {
  if (!doc) return null;
  const findings = [...(doc.findings ?? [])].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity ?? 'info') - SEVERITY_ORDER.indexOf(b.severity ?? 'info'),
  );
  return (
    <div
      data-section="review-findings"
      data-findings-count={findings.length}
      style={{ border: '1px solid var(--line)', borderRadius: 8, background: 'var(--panel)', overflow: 'hidden' }}
    >
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)' }}>
          Adversarial review
        </span>
        <span style={{ fontSize: 12, color: 'var(--dim)' }}>
          {findings.length === 0 ? 'clean pass — no findings' : `${findings.length} finding${findings.length === 1 ? '' : 's'}`}
          {doc.headSha ? ` · reviewed @ ${doc.headSha.slice(0, 7)}` : ''}
        </span>
      </div>
      {doc.summary && (
        <div style={{ padding: '10px 16px', fontSize: 13, color: 'var(--dim)', borderBottom: findings.length > 0 ? '1px solid var(--line)' : 'none' }}>
          {doc.summary}
        </div>
      )}
      {findings.map((f, i) => (
        <div
          key={f.id ?? i}
          data-finding={f.id ?? `RF-${i + 1}`}
          data-finding-severity={f.severity ?? 'info'}
          data-finding-category={f.category ?? ''}
          style={{ padding: '10px 16px', borderBottom: i < findings.length - 1 ? '1px solid var(--line)' : 'none', display: 'flex', flexDirection: 'column', gap: 4 }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: SEVERITY_COLOURS[f.severity ?? 'info'] }}>
              {f.severity ?? 'info'}
            </span>
            <span style={{ fontSize: 11, color: 'var(--faint)' }}>{f.category}</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{f.title}</span>
          </div>
          {f.detail && <div style={{ fontSize: 12, color: 'var(--dim)' }}>{f.detail}</div>}
          {(f.evidence ?? []).map((e, j) => (
            <div key={j} style={{ fontSize: 11, fontFamily: 'var(--mono, monospace)', color: 'var(--faint)' }}>
              {e.file}{typeof e.line === 'number' ? `:${e.line}` : ''}{e.excerpt ? ` — ${e.excerpt}` : ''}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
