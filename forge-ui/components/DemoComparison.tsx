'use client';

import { useEffect, useState } from 'react';
import { resolveBridgeUrl } from '@/lib/bridge-client';
import type { DemoModel, DemoModelCheckpoint, DemoHarnessMetricRow, DemoAcEvaluation } from '@/lib/bridge-client';

/**
 * ADR 021 — renders the unifier-authored structured `demo.json` natively (the
 * in-UI equivalent of `renderComparisonHtml`). The schema this renders IS the
 * contract the unifier fills, which is what makes demos consistent. Forge dark
 * theme; mirrors the plan screen's "rich artifact on its own page" treatment.
 *
 * Renders ALL sections: summary (with PR link), apiDiff before/after,
 * testEvidence pass/fail table, filesChanged annotated list, checkpoints,
 * usage_example fenced block, impact bullets, acceptanceCriteria, diffStat.
 */
const PARITY_COLOR: Record<DemoHarnessMetricRow['parity'], string> = {
  match: '#2ea043',
  within: '#2ea043',
  diverged: '#f85149',
  // "incomplete" = net-new metric, no prior baseline. Informational blue, NOT
  // the amber warning it used to be — a new test that PASSES is not a problem.
  incomplete: '#58a6ff',
};

const TEST_RESULT_COLOR: Record<string, string> = {
  pass: '#2ea043',
  fail: '#f85149',
  // skip = not run in this gate (e.g. a live test with no creds) — benign, neutral.
  skip: '#8b949e',
};

/**
 * Display label for a parity value. `incomplete` reads as "no prior baseline =
 * newly added"; surface it as "new" so a passing net-new test isn't misread as
 * an unfinished / broken one (the `after` column carries the real result).
 */
function parityLabel(parity: DemoHarnessMetricRow['parity']): string {
  return parity === 'incomplete' ? 'new' : parity;
}

export function DemoComparison({ model, cycleId }: { model: DemoModel; cycleId?: string }): JSX.Element {
  // Resolve the bridge base once so video checkpoints can build their artifact
  // URL (a kind:'video' checkpoint stores a relative sibling path served via
  // /api/artifact on the bridge, not the Next origin).
  const [bridgeBase, setBridgeBase] = useState('');
  useEffect(() => { resolveBridgeUrl().then(setBridgeBase).catch(() => {}); }, []);
  return (
    <div data-section="demo-comparison" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header: title + essence */}
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#e6edf3' }}>{model.title}</div>
        <div
          style={{
            marginTop: 8,
            padding: '10px 14px',
            borderLeft: '3px solid #2b333c',
            background: '#0d131b',
            borderRadius: '0 6px 6px 0',
            fontSize: 13,
            color: '#c9d1d9',
          }}
        >
          {model.essence}
        </div>
      </div>

      {/* Intent & Outcome — foregrounded per-AC evaluation (MVUS req b).
          Rendered when acEvaluations is present; replaces the plain AC list. */}
      {model.acEvaluations && model.acEvaluations.length > 0 && (
        <AcEvaluationSection essence={model.essence} evaluations={model.acEvaluations} />
      )}

      {/* Summary section */}
      {model.summary && (
        <div data-section="demo-summary">
          <SectionLabel>Summary</SectionLabel>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#c9d1d9' }}>
            {model.summary.bullets.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
          {(model.summary.prUrl || model.summary.branch || model.summary.commitSha) && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#8b949e', display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {model.summary.prUrl && (
                <a href={model.summary.prUrl} target="_blank" rel="noreferrer" style={{ color: '#58a6ff' }}>
                  PR: {model.summary.prUrl}
                </a>
              )}
              {model.summary.branch && <span>Branch: <code style={{ background: '#161b22', padding: '1px 4px', borderRadius: 3 }}>{model.summary.branch}</code></span>}
              {model.summary.commitSha && <span>Commit: <code style={{ background: '#161b22', padding: '1px 4px', borderRadius: 3 }}>{model.summary.commitSha.slice(0, 8)}</code></span>}
            </div>
          )}
        </div>
      )}

      {/* API / Behaviour diff */}
      {model.apiDiff && model.apiDiff.length > 0 && (
        <div data-section="demo-api-diff">
          <SectionLabel>API / Behaviour Diff</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {model.apiDiff.map((entry, i) => (
              <div key={i} style={{ border: '1px solid #21262d', borderRadius: 6, padding: '10px 14px', background: '#0b0f14' }}>
                <div style={{ fontSize: 12, color: '#e6edf3', fontWeight: 600, marginBottom: 6 }}>
                  {entry.name}
                  <span style={{ marginLeft: 8, fontWeight: 400, color: entry.change === 'added' ? '#2ea043' : entry.change === 'removed' ? '#f85149' : '#d29922', fontSize: 11, textTransform: 'uppercase' }}>
                    {entry.change}
                  </span>
                </div>
                {(entry.before !== undefined || entry.after !== undefined) && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {entry.before !== undefined && (
                      <div>
                        <div style={{ fontSize: 10, color: '#6e7681', marginBottom: 3, textTransform: 'uppercase' }}>before</div>
                        <pre style={{ margin: 0, overflow: 'auto', background: '#010409', border: '1px solid #21262d', borderRadius: 4, padding: 8, fontSize: 11, color: '#c9d1d9' }}>{entry.before}</pre>
                      </div>
                    )}
                    {entry.after !== undefined && (
                      <div>
                        <div style={{ fontSize: 10, color: '#6e7681', marginBottom: 3, textTransform: 'uppercase' }}>after</div>
                        <pre style={{ margin: 0, overflow: 'auto', background: '#010409', border: '1px solid #21262d', borderRadius: 4, padding: 8, fontSize: 11, color: '#c9d1d9' }}>{entry.after}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Test evidence */}
      {model.testEvidence && model.testEvidence.length > 0 && (
        <div data-section="demo-test-evidence">
          <SectionLabel>Test Evidence</SectionLabel>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: '#6e7681', textAlign: 'left' }}>
                <th style={th}>test</th>
                <th style={th}>result</th>
                <th style={th}>delta</th>
              </tr>
            </thead>
            <tbody>
              {model.testEvidence.map((r, i) => (
                <tr key={i} style={{ borderTop: '1px solid #21262d' }}>
                  <td style={{ ...td, color: '#c9d1d9' }}>{r.name}</td>
                  <td style={{ ...td, color: TEST_RESULT_COLOR[r.result] ?? '#c9d1d9', fontWeight: 600 }} title={r.result === 'skip' ? 'Not run in this gate (e.g. a live test with no credentials present) — not a failure.' : undefined}>{r.result}</td>
                  <td style={{ ...td, color: '#8b949e' }}>{r.delta ?? '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} style={{ ...td, color: '#6e7681', fontFamily: 'inherit', fontSize: 11, paddingTop: 8 }}>
                  <strong style={{ color: '#8b949e' }}>pass</strong> / <strong style={{ color: '#8b949e' }}>fail</strong> = result · <strong style={{ color: '#8b949e' }}>skip</strong> = not run in this gate (e.g. a live test with no creds) — not a failure · delta <strong style={{ color: '#8b949e' }}>new</strong> = test added by this change
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Checkpoints — shape-aware heading mirrors the derived DEMO.html so the
          in-UI demo and the PR artifact present the same section structure. */}
      {(model.checkpoints?.length ?? 0) > 0 && (
        <div data-section="demo-checkpoints">
          <SectionLabel>{checkpointsHeading(model.checkpoints)}</SectionLabel>
          {model.checkpoints.map((c, i) => (
            <CheckpointCard key={`${c.label}-${i}`} cp={c} cycleId={cycleId} bridgeBase={bridgeBase} />
          ))}
        </div>
      )}

      {/* Usage example */}
      {model.usage_example && (
        <div data-section="demo-usage-example">
          <SectionLabel>Usage Example</SectionLabel>
          <pre style={{ overflow: 'auto', background: '#010409', border: '1px solid #21262d', borderRadius: 6, padding: 10, fontSize: 12, color: '#c9d1d9', margin: 0 }}>
            {model.usage_example}
          </pre>
        </div>
      )}

      {/* Impact bullets */}
      {model.impact && model.impact.length > 0 && (
        <div data-section="demo-impact">
          <SectionLabel>Impact</SectionLabel>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#c9d1d9' }}>
            {model.impact.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </div>
      )}

      {/* Acceptance criteria — plain list shown only when acEvaluations absent.
          When acEvaluations is present the AcEvaluationSection above covers it. */}
      {!model.acEvaluations?.length && model.acceptanceCriteria && model.acceptanceCriteria.length > 0 && (
        <div data-section="demo-acs">
          <SectionLabel>Acceptance criteria</SectionLabel>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#c9d1d9' }}>
            {model.acceptanceCriteria.map((ac, i) => (
              <li key={i}>{ac}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Files changed */}
      <details style={{ fontSize: 12, color: '#8b949e' }}>
        <summary style={{ cursor: 'pointer' }}>
          Changed files (<code>git diff --stat {model.baseRef ?? 'main'}..{model.changedRef ?? 'HEAD'}</code>)
        </summary>
        {model.filesChanged && model.filesChanged.length > 0 && (
          <ul style={{ margin: '8px 0 4px', paddingLeft: 18, fontSize: 12, color: '#c9d1d9' }}>
            {model.filesChanged.map((f, i) => (
              <li key={i}><code style={{ color: '#79c0ff' }}>{f.path}</code>{f.note ? <span style={{ color: '#8b949e' }}> — {f.note}</span> : null}</li>
            ))}
          </ul>
        )}
        <pre style={{ overflow: 'auto', background: '#010409', border: '1px solid #21262d', borderRadius: 6, padding: 10, marginTop: 4 }}>
          {model.diffStat}
        </pre>
      </details>

    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ fontSize: 12, fontWeight: 600, color: '#8b949e', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
      {children}
    </div>
  );
}

/** Shape-aware checkpoints heading — mirrors cli/demo-model.ts so the in-UI demo
 *  and the derived DEMO.html present the same section structure (no phantom label). */
function checkpointsHeading(checkpoints: DemoModelCheckpoint[]): string {
  if (checkpoints.some((c) => c.kind === 'screenshot' || c.kind === 'video')) return 'Visual Changes';
  if (checkpoints.length > 0 && checkpoints.every((c) => c.kind === 'harness')) return 'Test Evidence';
  return 'Visual Changes';
}

/** Build a bridge artifact URL for a relative media path (video sibling), or null. */
function mediaUrl(bridgeBase: string, cycleId: string | undefined, src?: string | null): string | null {
  if (!bridgeBase || !cycleId || !src) return null;
  return `${bridgeBase}/api/artifact/${encodeURIComponent(cycleId)}/${encodeURIComponent(src)}`;
}

function CheckpointCard({ cp, cycleId, bridgeBase }: { cp: DemoModelCheckpoint; cycleId?: string; bridgeBase: string }): JSX.Element {
  return (
    <figure
      data-checkpoint={cp.label}
      data-checkpoint-kind={cp.kind ?? 'screenshot'}
      style={{ margin: 0, border: '1px solid #21262d', borderRadius: 8, padding: 14, background: '#0b0f14' }}
    >
      <figcaption style={{ fontSize: 13, color: '#e6edf3', marginBottom: 10, fontWeight: 500 }}>{cp.caption}</figcaption>
      {cp.kind === 'harness' && cp.metrics && cp.metrics.length > 0 ? (
        <MetricTable rows={cp.metrics} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Side label="before" note={cp.beforeNote} image={cp.beforeImage} video={mediaUrl(bridgeBase, cycleId, cp.beforeVideoSrc)} />
          <Side label="after" note={cp.afterNote} image={cp.afterImage} video={mediaUrl(bridgeBase, cycleId, cp.afterVideoSrc)} />
        </div>
      )}
    </figure>
  );
}

function Side({ label, note, image, video }: { label: string; note?: string; image?: string | null; video?: string | null }): JSX.Element {
  return (
    <div data-side={label} data-media-kind={video ? 'video' : image ? 'image' : 'note'}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6e7681', marginBottom: 6 }}>{label}</div>
      {video ? (
        <video controls preload="metadata" playsInline src={video} style={{ width: '100%', border: '1px solid #21262d', borderRadius: 6, display: 'block', background: '#000' }} />
      ) : image ? (
        // Only data: URIs reach here (validateDemoModel rejects remote/scheme refs).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt={`${label} state`} style={{ width: '100%', border: '1px solid #21262d', borderRadius: 6, display: 'block' }} />
      ) : (
        <div style={{ fontSize: 13, color: '#c9d1d9' }}>{note ?? <span style={{ color: '#6e7681' }}>—</span>}</div>
      )}
      {(video || image) && note && <div style={{ fontSize: 12, color: '#8b949e', marginTop: 6 }}>{note}</div>}
    </div>
  );
}

function MetricTable({ rows }: { rows: DemoHarnessMetricRow[] }): JSX.Element {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ color: '#6e7681', textAlign: 'left' }}>
          <th style={th}>metric</th>
          <th style={th}>before</th>
          <th style={th}>after</th>
          <th style={th}>Δ</th>
          <th style={th}>parity</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const d = r.deltaPct === null ? '—' : `${r.deltaPct > 0 ? '+' : ''}${r.deltaPct.toFixed(1)}%`;
          return (
            <tr key={i} style={{ borderTop: '1px solid #21262d' }}>
              <td style={td}>{r.label}</td>
              <td style={td}>{r.before ?? '—'}{r.unit ? ` ${r.unit}` : ''}</td>
              <td style={td}>{r.after ?? '—'}{r.unit ? ` ${r.unit}` : ''}</td>
              <td style={td}>{d}</td>
              <td style={{ ...td, color: PARITY_COLOR[r.parity], fontWeight: 600 }} title={r.parity === 'incomplete' ? 'Newly added — no prior baseline to compare. The "after" column is the result.' : undefined}>{parityLabel(r.parity)}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={5} style={{ ...td, color: '#6e7681', fontFamily: 'inherit', fontSize: 11, paddingTop: 8 }}>
            <strong style={{ color: '#8b949e' }}>match</strong>/<strong style={{ color: '#8b949e' }}>within</strong> = unchanged · <strong style={{ color: '#8b949e' }}>new</strong> = newly added, no prior baseline (see <em>after</em> — PASS means the new test is green) · <strong style={{ color: '#8b949e' }}>diverged</strong> = regressed (the only state that signals a problem)
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

const VERDICT_COLOR: Record<DemoAcEvaluation['verdict'], string> = {
  met: '#2ea043',
  partial: '#d29922',
  missed: '#f85149',
};

const VERDICT_BG: Record<DemoAcEvaluation['verdict'], string> = {
  met: 'rgba(46,160,67,0.15)',
  partial: 'rgba(210,153,34,0.15)',
  missed: 'rgba(248,81,73,0.15)',
};

/**
 * Foregrounded "Intent & Outcome" section (MVUS req b). Shown near the top when
 * `acEvaluations` is present; mirrors the `data-section="demo-evaluation"` +
 * `data-ac-verdict` attributes used by the static HTML renderer and e2e harness.
 */
function AcEvaluationSection({ essence, evaluations }: { essence: string; evaluations: DemoAcEvaluation[] }): JSX.Element {
  return (
    <div
      data-section="demo-evaluation"
      data-ac-eval-count={evaluations.length}
      style={{ border: '1px solid #21262d', borderRadius: 8, padding: 14, background: '#0b0f14' }}
    >
      <SectionLabel>Intent &amp; Outcome</SectionLabel>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: '#8b949e', fontStyle: 'italic' }}>{essence}</p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ color: '#6e7681', textAlign: 'left' }}>
            <th style={{ ...th, width: '2rem' }}>#</th>
            <th style={th}>Acceptance criterion</th>
            <th style={{ ...th, width: '6rem' }}>Verdict</th>
            <th style={th}>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {evaluations.map((e, i) => (
            <tr key={i} data-ac-verdict={e.verdict} style={{ borderTop: '1px solid #21262d' }}>
              <td style={{ ...td, color: '#6e7681' }}>{i + 1}</td>
              <td style={{ ...td, color: '#c9d1d9' }}>{e.criterion}</td>
              <td style={td}>
                <span style={{
                  display: 'inline-block',
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: 0.7,
                  padding: '2px 7px',
                  borderRadius: 999,
                  fontWeight: 600,
                  color: VERDICT_COLOR[e.verdict],
                  background: VERDICT_BG[e.verdict],
                }}>
                  {e.verdict}
                </span>
              </td>
              <td style={{ ...td, color: '#8b949e', fontFamily: 'inherit' }}>{e.evidence}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = { padding: '4px 8px', fontWeight: 500 };
const td: React.CSSProperties = { padding: '4px 8px', color: '#c9d1d9', fontFamily: 'ui-monospace, Menlo, monospace' };
