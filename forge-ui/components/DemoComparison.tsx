'use client';

import { useEffect, useState } from 'react';
import { fetchArtifactText, resolveBridgeUrl } from '@/lib/bridge-client';
import type { DemoModel, DemoModelCheckpoint, DemoHarnessMetricRow, InteractiveSurface } from '@/lib/bridge-client';

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
  incomplete: '#d29922',
};

const TEST_RESULT_COLOR: Record<string, string> = {
  pass: '#2ea043',
  fail: '#f85149',
  skip: '#d29922',
};

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
                  <td style={{ ...td, color: TEST_RESULT_COLOR[r.result] ?? '#c9d1d9', fontWeight: 600 }}>{r.result}</td>
                  <td style={{ ...td, color: '#8b949e' }}>{r.delta ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Checkpoints — shape-aware heading mirrors the derived DEMO.html so the
          in-UI demo and the PR artifact present the same section structure. */}
      {model.checkpoints.length > 0 && (
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

      {/* Acceptance criteria */}
      {model.acceptanceCriteria && model.acceptanceCriteria.length > 0 && (
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

      {/* Interactive review surfaces (re-review #8, Stage 0/1) — explore the
          new capability, not just read about it. Renders only when the demo
          declares them; the static demo above is unchanged when absent. */}
      {model.interactiveSurfaces && model.interactiveSurfaces.length > 0 && (
        <div data-section="demo-interactive" data-interactive-count={model.interactiveSurfaces.length}>
          <SectionLabel>Try it — explore the new capability</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {model.interactiveSurfaces.map((s, i) => (
              <InteractiveSurfaceCard key={i} surface={s} cycleId={cycleId} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const EXECUTING_SURFACE_KINDS = new Set(['hcl-replan', 'api-replay', 'ui-preview', 'cli-run', 'snippet-run']);

/**
 * One interactive surface. Stage 0/1 is NON-EXECUTING: `portal-link` is a deep
 * link; `live-query` fetches an already-captured artifact (served via the
 * existing /api/artifact route) and renders it on demand, degrading clearly
 * when no capture exists (e.g. a no-credentials run). Executing kinds render a
 * disabled "coming soon" affordance. Mirrors load-bearing state to
 * data-surface-state per the DOM-as-metrics convention.
 */
function InteractiveSurfaceCard({ surface, cycleId }: { surface: InteractiveSurface; cycleId?: string }): JSX.Element {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<string | null>(null);
  const isExecuting = EXECUTING_SURFACE_KINDS.has(surface.kind);

  async function runLiveQuery(): Promise<void> {
    if (!surface.artifact || !cycleId) {
      setState('error');
      setResult('No captured artifact is declared for this surface. Run the project demo skill with live credentials to populate it.');
      return;
    }
    setState('running');
    // MUST go through the bridge base — /api/artifact lives on the bridge, not
    // the Next origin (a relative fetch 404s).
    const { ok, status, text } = await fetchArtifactText(cycleId, surface.artifact);
    if (!ok) {
      setState('error');
      setResult(`No live capture found (${status || 'no bridge'}). Re-run the project's demo skill with credentials to capture the real resource.`);
      return;
    }
    try { setResult(JSON.stringify(JSON.parse(text), null, 2)); } catch { setResult(text); }
    setState('done');
  }

  return (
    <div
      data-interactive-surface={surface.kind}
      data-surface-state={state}
      style={{ border: '1px solid #21262d', borderRadius: 8, padding: 12, background: '#0b0f14' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: '#e6edf3', fontWeight: 500 }}>{surface.label}</span>
        {surface.portalUrl && (
          <a
            data-action="open-portal"
            href={surface.portalUrl}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12, color: '#79c0ff', textDecoration: 'none', border: '1px solid #21262d', borderRadius: 6, padding: '2px 8px' }}
          >
            ↗ Open in portal
          </a>
        )}
        {surface.kind === 'live-query' && (
          <button
            data-action="run-live-query"
            onClick={runLiveQuery}
            disabled={state === 'running'}
            style={{ fontSize: 12, color: '#e6edf3', background: '#1f6feb', border: 'none', borderRadius: 6, padding: '3px 10px', cursor: state === 'running' ? 'default' : 'pointer' }}
          >
            {state === 'running' ? 'Querying…' : 'Show the live resource'}
          </button>
        )}
        {isExecuting && (
          <span
            data-surface-disabled="true"
            title="Executing surfaces (re-plan / replay / preview) arrive in a later stage"
            style={{ fontSize: 11, color: '#8b949e', border: '1px dashed #30363d', borderRadius: 6, padding: '2px 8px' }}
          >
            interactive run — coming soon
          </span>
        )}
      </div>
      {surface.seed && (
        <pre style={{ overflow: 'auto', background: '#010409', border: '1px solid #21262d', borderRadius: 6, padding: 10, marginTop: 8, fontSize: 12, color: '#c9d1d9' }}>
          {surface.seed}
        </pre>
      )}
      {result !== null && (
        <pre
          data-surface-result
          style={{ overflow: 'auto', background: '#010409', border: `1px solid ${state === 'error' ? '#f85149' : '#21262d'}`, borderRadius: 6, padding: 10, marginTop: 8, fontSize: 12, color: state === 'error' ? '#f0a4a0' : '#7ee787' }}
        >
          {result}
        </pre>
      )}
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
              <td style={{ ...td, color: PARITY_COLOR[r.parity], fontWeight: 600 }}>{r.parity}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const th: React.CSSProperties = { padding: '4px 8px', fontWeight: 500 };
const td: React.CSSProperties = { padding: '4px 8px', color: '#c9d1d9', fontFamily: 'ui-monospace, Menlo, monospace' };
