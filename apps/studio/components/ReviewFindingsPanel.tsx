'use client';

/**
 * ReviewFindingsPanel — the adversarial-review agent's findings (R4-08-F3),
 * rendered on the /artifact verdict surface in BOTH gate and view mode.
 *
 * These are agent CLAIMS the operator weighs before deciding — never a gate by
 * themselves (ADR-021: approve IS the merge and stays human). An empty
 * findings array is an explicit clean pass and renders as such.
 *
 * W7-B7 (artifact-plan-16): a MISSING artifact used to render nothing — the
 * operator could not tell "clean pass" from "the critique never ran". A
 * caller that KNOWS the artifact is absent passes `absentNote` and gets an
 * explicit one-liner (`data-findings-state="absent"`); callers that merely
 * haven't fetched yet keep passing null alone and render nothing, as before.
 * Review r1: a caller whose FETCH failed passes `errorNote` instead and gets
 * the explicit error one-liner (`data-findings-state="error"`) — a transient
 * failure must never render the fabricated claim that the review did not run.
 *
 * DOM-as-metrics: [data-section="review-findings"][data-findings-count]
 * [data-findings-state="present|absent|error"], per-row
 * [data-finding][data-finding-severity][data-finding-category].
 */

export type ReviewFindingsDoc = {
  initiative_id?: string;
  headSha?: string;
  reviewedAt?: string;
  summary?: string;
  /** The lenses this class was reviewed under — recorded so "no finding under
   *  this lens" is distinguishable from "this lens was never applied". */
  lenses?: string[];
  /** One verdict per acceptance criterion. The REVIEWER's, not the author's
   *  (spec §5 item 5): the read-only agent that did not build the branch is the
   *  one that judges whether a criterion is met. */
  acEvaluations?: Array<{ criterion?: string; verdict?: 'met' | 'partial' | 'missed'; evidence?: string }>;
  /** The reviewer's narrative of the change. */
  whyWhatHow?: { why?: string; what?: string; how?: string };
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

const VERDICT_COLOURS: Record<string, string> = {
  met: 'var(--green, #3fb950)',
  partial: 'var(--amber, #d29922)',
  missed: 'var(--red, #f85149)',
};

const SEVERITY_COLOURS: Record<string, string> = {
  blocker: 'var(--red, #f85149)',
  major: 'var(--amber, #d29922)',
  minor: 'var(--dim, #8b949e)',
  info: 'var(--faint, #6e7681)',
};

const SEVERITY_ORDER = ['blocker', 'major', 'minor', 'info'];

export function ReviewFindingsPanel({ doc, absentNote = false, errorNote = false }: { doc: ReviewFindingsDoc | null; absentNote?: boolean; errorNote?: boolean }) {
  if (!doc) {
    // Review r1: error beats absence — a failed fetch says NOTHING about
    // whether the artifact exists, so the fabricated "did not run" claim is
    // replaced by an honest load-failure note.
    if (errorNote) {
      return (
        <div
          data-section="review-findings"
          data-findings-state="error"
          style={{ border: '1px solid var(--line)', borderRadius: 8, background: 'var(--panel)', padding: '10px 16px', display: 'flex', alignItems: 'baseline', gap: 10 }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)' }}>
            Adversarial review
          </span>
          <span style={{ fontSize: 12, color: 'var(--amber, #d29922)' }}>
            findings could not be loaded — reload to retry. (This is a fetch failure, not evidence the review never ran.)
          </span>
        </div>
      );
    }
    if (!absentNote) return null;
    return (
      <div
        data-section="review-findings"
        data-findings-state="absent"
        style={{ border: '1px solid var(--line)', borderRadius: 8, background: 'var(--panel)', padding: '10px 16px', display: 'flex', alignItems: 'baseline', gap: 10 }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)' }}>
          Adversarial review
        </span>
        <span style={{ fontSize: 12, color: 'var(--dim)' }}>
          did not run for this cycle — no findings artifact was produced.
        </span>
      </div>
    );
  }
  const evaluations = doc.acEvaluations ?? [];
  const whyWhatHow = doc.whyWhatHow;
  const lenses = doc.lenses ?? [];
  const findings = [...(doc.findings ?? [])].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity ?? 'info') - SEVERITY_ORDER.indexOf(b.severity ?? 'info'),
  );
  return (
    <div
      data-section="review-findings"
      data-findings-state="present"
      data-findings-count={findings.length}
      data-review-lenses={lenses.join(',')}
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
        <div style={{ padding: '10px 16px', fontSize: 13, color: 'var(--dim)', borderBottom: '1px solid var(--line)' }}>
          {doc.summary}
        </div>
      )}
      {whyWhatHow && (
        <div
          data-section="why-what-how"
          style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          {(['why', 'what', 'how'] as const).map((k) =>
            whyWhatHow[k] ? (
              <div key={k} data-narrative={k} style={{ fontSize: 12, color: 'var(--dim)' }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--faint)', marginRight: 8 }}>{k}</span>
                {whyWhatHow[k]}
              </div>
            ) : null,
          )}
        </div>
      )}
      <div
        data-section="ac-verdicts"
        data-ac-eval-count={evaluations.length}
        style={{ padding: '10px 16px', borderBottom: findings.length > 0 ? '1px solid var(--line)' : 'none', display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)' }}>
          Acceptance criteria
        </span>
        {evaluations.length === 0 ? (
          <span style={{ fontSize: 12, color: 'var(--dim)' }}>this initiative declared no acceptance criteria</span>
        ) : (
          evaluations.map((e, i) => (
            <div key={i} data-ac-verdict={e.verdict ?? 'missed'} style={{ fontSize: 12, color: 'var(--dim)', display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: VERDICT_COLOURS[e.verdict ?? 'missed'] }}>{e.verdict}</span>
              <span>{e.criterion}{e.evidence ? ` — ${e.evidence}` : ''}</span>
            </div>
          ))
        )}
      </div>
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
