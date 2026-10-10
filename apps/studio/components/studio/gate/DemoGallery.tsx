'use client';

/**
 * The demo on the verdict gate (forge-mfv5.1.31): a station-track rail of the
 * checkpoints grouped by work item (hex node filled = changed, hollow =
 * unchanged, amber = unknown) and ONE checkpoint at a time, before and after
 * side by side, contained in a `--pane-xl` pane. A command checkpoint opens on
 * its captured stdout (the frames are 320 px stills — forge-nk1y.30); frame
 * and video are one press away; either side enlarges into a <dialog>.
 *
 * The evidence was captured by the orchestrator (D-15); nothing here grades
 * it. DOM: [data-section="demo-comparison"], the selected checkpoint's header
 * is its comment region (`[data-demo-region="checkpoint-<n>"]`, n 1-based) and
 * carries [data-checkpoint][data-checkpoint-kind][data-checkpoint-delta];
 * [data-side][data-media-kind]; actions `select-checkpoint`, `media-mode`,
 * `enlarge-evidence`.
 */
import { useEffect, useRef, useState } from 'react';

import type { DemoApiDiffEntry, DemoModelCheckpoint } from '@/lib/bridge-client';
import type { ReviewComment } from '@/lib/review-comments-client';
import { defaultSideMode, groupCheckpoints, stripAnsi, type SideMode } from '@/lib/gate-view';
import { JsonDiffView } from '@/components/review/evidence';
import { RegionComments, type CommentHandlers } from './RegionComments';
import { FrameLightbox } from './FrameLightbox';
import { SideBody, type Side, type SideMedia } from './SideBody';
import { pane, paneHeader, paneTitle, meta, word, wiTag, miniBtn, DELTA_COLOUR } from './styles';

type Selection = { kind: 'checkpoint' | 'apidiff'; index: number };

export function sideMedia(cp: DemoModelCheckpoint, side: Side, videoUrl: (src?: string | null) => string | null): SideMedia {
  return side === 'before'
    ? { output: stripAnsi(cp.beforeOutput), image: cp.beforeImage ?? null, video: videoUrl(cp.beforeVideoSrc), note: cp.beforeNote ?? '' }
    : { output: stripAnsi(cp.afterOutput), image: cp.afterImage ?? null, video: videoUrl(cp.afterVideoSrc), note: cp.afterNote ?? '' };
}

export function DemoGallery({
  checkpoints, apiDiff, cycleId, bridgeBase, comments, disabled, handlers, focusRegion = null,
}: {
  checkpoints: DemoModelCheckpoint[];
  /** The bridge origin videos are served from (`/api/artifact`), or null until the page resolved it. */
  bridgeBase: string | null;
  apiDiff: DemoApiDiffEntry[];
  cycleId: string;
  comments: ReviewComment[];
  disabled: boolean;
  handlers: CommentHandlers;
  /** A jump request naming `checkpoint-<n>` / `apidiff-<n>` selects that stop and scrolls the demo into view. */
  focusRegion?: { id: string; seq: number } | null;
}): JSX.Element {
  const videoUrl = (src?: string | null): string | null =>
    bridgeBase && src ? `${bridgeBase}/api/artifact/${encodeURIComponent(cycleId)}/${encodeURIComponent(src)}` : null;

  const [sel, setSel] = useState<Selection>({ kind: checkpoints.length > 0 ? 'checkpoint' : 'apidiff', index: 0 });
  const [modes, setModes] = useState<Partial<Record<Side, SideMode>>>({});
  const lightbox = useRef<HTMLDialogElement>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const root = useRef<HTMLElement>(null);
  const select = (next: Selection): void => { setSel(next); setModes({}); };
  useEffect(() => {
    const m = focusRegion ? /^(checkpoint|apidiff)-(\d+)$/.exec(focusRegion.id) : null;
    if (!m) return;
    setSel({ kind: m[1] as Selection['kind'], index: Number(m[2]) - 1 });
    setModes({});
    root.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [focusRegion]);
  const openLightbox = (): void => { setLightboxOpen(true); lightbox.current?.showModal(); };
  const blockingIn = (region: string): number => comments.filter((x) => x.region === region && x.blocking && !x.resolved).length;

  const groups = groupCheckpoints(checkpoints);
  const changed = checkpoints.filter((c) => c.delta === 'changed').length;
  const cp = sel.kind === 'checkpoint' ? checkpoints[sel.index] : undefined;
  const api = sel.kind === 'apidiff' ? apiDiff[sel.index] : undefined;
  const regionId = `${sel.kind}-${sel.index + 1}`;
  const regionComments = comments.filter((c) => c.region === regionId);
  const media = cp ? { before: sideMedia(cp, 'before', videoUrl), after: sideMedia(cp, 'after', videoUrl) } : null;
  const modeOf = (side: Side): SideMode => modes[side] ?? (media ? defaultSideMode(media[side]) : 'note');
  const step = (by: number): void => {
    if (checkpoints.length === 0 || sel.kind !== 'checkpoint') return;
    select({ kind: 'checkpoint', index: (sel.index + by + checkpoints.length) % checkpoints.length });
  };

  return (
    <section ref={root} data-section="demo-comparison" style={pane}>
      <header style={paneHeader}>
        <h2 style={paneTitle}>The change, checkpoint by checkpoint</h2>
        <span style={meta}>
          {checkpoints.length} checkpoint{checkpoints.length === 1 ? '' : 's'} · {changed} changed · captured by the orchestrator, before and after · press either side to enlarge
        </span>
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: 'calc(var(--pane-md) + var(--space-5)) minmax(0, 1fr)', height: 'var(--pane-xl)' }}>
        <nav aria-label="Checkpoints" style={{ borderRight: '1px solid var(--line)', overflowY: 'auto', padding: 'var(--space-2) 0' }}>
          {groups.map((g) => (
            <div key={`${g.wi}-${g.items[0]!.index}`}>
              <div style={{ ...wiTag, padding: 'var(--space-2) var(--space-4) var(--space-1)' }}>{g.wi || 'checkpoints'}</div>
              {g.items.map(({ index, cp: c }) => (
                <Stop key={index} label={c.caption || c.label} delta={c.delta ?? 'unknown'} current={sel.kind === 'checkpoint' && sel.index === index}
                  commentCount={comments.filter((x) => x.region === `checkpoint-${index + 1}`).length} blocking={blockingIn(`checkpoint-${index + 1}`)}
                  attrs={{ 'data-checkpoint-index': String(index) }} onClick={() => select({ kind: 'checkpoint', index })} />
              ))}
            </div>
          ))}
          {apiDiff.length > 0 && (
            <div>
              <div style={{ ...wiTag, padding: 'var(--space-2) var(--space-4) var(--space-1)' }}>API</div>
              {apiDiff.map((d, index) => (
                <Stop key={index} label={`${d.name} (${d.change})`} delta="changed" current={sel.kind === 'apidiff' && sel.index === index}
                  commentCount={comments.filter((x) => x.region === `apidiff-${index + 1}`).length} blocking={blockingIn(`apidiff-${index + 1}`)}
                  attrs={{ 'data-apidiff-index': String(index) }} onClick={() => select({ kind: 'apidiff', index })} />
              ))}
            </div>
          )}
        </nav>

        <div style={{ padding: 'var(--space-3) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0, overflowY: 'auto' }}>
          {cp && media && (
            <>
              <div
                id={`region-${regionId}`}
                data-demo-region={regionId}
                data-region-comment-count={regionComments.length}
                data-region-collapsed="false"
                data-checkpoint={cp.label}
                data-checkpoint-kind={cp.kind ?? 'screenshot'}
                data-checkpoint-delta={cp.delta ?? 'unknown'}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}
              >
                <span style={{ ...word, fontSize: 'var(--text-sm)', letterSpacing: '.12em', color: DELTA_COLOUR[cp.delta ?? 'unknown'], border: '2px solid currentColor', borderStyle: cp.delta === 'unknown' || !cp.delta ? 'dashed' : 'solid', borderRadius: 'var(--radius-sm)', padding: '0 var(--space-3)', flex: 'none' }}>
                  {cp.delta ?? 'unknown'}
                </span>
                <h3 title={cp.caption} style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--text-lg)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cp.caption || cp.label}</h3>
                {cp.command && (
                  <code title={cp.command} style={{ ...meta, background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: '0 var(--space-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>$ {cp.command}</code>
                )}
              </div>

              {cp.kind === 'harness' && cp.metrics && cp.metrics.length > 0 ? (
                <MetricRows rows={cp.metrics} />
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 'var(--space-4)' }}>
                  {(['before', 'after'] as const).map((side) => (
                    <SidePanel key={side} side={side} media={media[side]} mode={modeOf(side)}
                      onMode={(m) => setModes((prev) => ({ ...prev, [side]: m }))}
                      onEnlarge={openLightbox} />
                  ))}
                </div>
              )}

              <pre data-section="checkpoint-delta" aria-label="What differs" style={{ margin: 0, height: 'var(--pane-xs)', overflow: 'auto', flex: 'none', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-1) var(--space-2)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--dim)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {cp.deltaExcerpt
                  ? stripAnsi(cp.deltaExcerpt).split('\n').map((l, i) => (
                    <span key={i} style={{ color: l.startsWith('+') ? 'var(--green)' : l.startsWith('-') ? 'var(--red)' : undefined }}>{l}{'\n'}</span>
                  ))
                  : cp.delta === 'unchanged' ? 'The output is identical after normalising durations, timestamps and paths.' : 'No difference excerpt was recorded for this checkpoint.'}
              </pre>
            </>
          )}

          {api && (
            <div id={`region-${regionId}`} data-demo-region={regionId} data-region-comment-count={regionComments.length} data-region-collapsed="false">
              <h3 style={{ margin: '0 0 var(--space-2)', fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 600 }}>{api.name} <span style={{ ...word, color: 'var(--ember)' }}>{api.change}</span></h3>
              <JsonDiffView before={api.before} after={api.after} />
            </div>
          )}

          {(cp || api) && (
            <RegionComments key={regionId} regionId={regionId} comments={regionComments} disabled={disabled} handlers={handlers}
              addLabel={cp ? 'Comment on this checkpoint' : 'Comment on this change'} />
          )}
          {!cp && !api && <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--dim)' }}>This demo captured no checkpoints.</p>}
        </div>
      </div>

      <FrameLightbox
        ref={lightbox}
        open={lightboxOpen}
        onClosed={() => setLightboxOpen(false)}
        caption={cp?.caption || cp?.label || ''}
        delta={cp?.delta ?? 'unknown'}
        media={media}
        modeOf={modeOf}
        onStep={step}
      />
    </section>
  );
}

function Stop({ label, delta, current, commentCount, blocking, attrs, onClick }: {
  label: string; delta: string; current: boolean; commentCount: number; blocking: number; attrs: Record<string, string>; onClick: () => void;
}): JSX.Element {
  const filled = delta === 'changed';
  return (
    <button
      data-action="select-checkpoint"
      {...attrs}
      data-delta={delta}
      data-stop-blocking={blocking}
      aria-current={current ? 'true' : undefined}
      onClick={onClick}
      style={{
        position: 'relative', display: 'grid', gridTemplateColumns: 'var(--space-4) minmax(0, 1fr)', gap: 'var(--space-2)', alignItems: 'start',
        width: '100%', textAlign: 'left', border: 0, cursor: 'pointer', padding: 'var(--space-1) var(--space-4)',
        background: current ? 'var(--panel-2)' : 'none', color: 'inherit',
      }}
    >
      {/* the track */}
      <span aria-hidden style={{ position: 'absolute', left: 'calc(var(--space-4) + var(--space-2) - var(--space-1) / 4)', top: 0, bottom: 0, width: 'calc(var(--space-1) / 2)', background: 'var(--line)' }} />
      {/* the station: a hex, filled when the evidence changed */}
      <span aria-hidden style={{ position: 'relative', width: 'var(--space-4)', height: 'calc(var(--space-4) + var(--space-1) / 2)', marginTop: 'calc(var(--space-1) / 2)', clipPath: 'var(--hex-clip)', background: DELTA_COLOUR[delta] ?? 'var(--line-2)' }}>
        {!filled && <span style={{ position: 'absolute', inset: 'calc(var(--space-1) * 0.75)', clipPath: 'var(--hex-clip)', background: current ? 'var(--panel-2)' : 'var(--panel)' }} />}
      </span>
      <span style={{ fontSize: 'var(--text-sm)', lineHeight: 1.35, color: current ? 'var(--text)' : 'var(--dim)', overflowWrap: 'anywhere' }}>
        <span style={{ ...word, display: 'block', color: DELTA_COLOUR[delta] ?? 'var(--faint)' }}>
          {delta}{commentCount > 0 ? ` · ${commentCount} comment${commentCount === 1 ? '' : 's'}` : ''}
          {blocking > 0 && <span style={{ color: 'var(--amber)' }}>{` · ${blocking} open blocker${blocking === 1 ? '' : 's'}`}</span>}
        </span>
        {label}
      </span>
    </button>
  );
}

const MODE_LABEL: Record<SideMode, string> = { output: 'output', frame: 'frame', video: 'video', note: 'note' };

function SidePanel({ side, media, mode, onMode, onEnlarge }: {
  side: Side; media: SideMedia; mode: SideMode; onMode: (m: SideMode) => void; onEnlarge: () => void;
}): JSX.Element {
  const available: SideMode[] = [
    ...(media.output ? ['output' as const] : []),
    ...(media.image ? ['frame' as const] : []),
    ...(media.video ? ['video' as const] : []),
  ];
  return (
    <div data-side={side} data-media-kind={mode} style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
        <span style={{ ...word, letterSpacing: '.1em', color: 'var(--faint)' }}>{side}</span>
        {available.length > 1 && (
          <span style={{ marginLeft: 'auto', display: 'flex', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
            {available.map((m) => (
              <button key={m} data-action="media-mode" data-media-mode={m} aria-pressed={m === mode} onClick={() => onMode(m)}
                style={{ ...miniBtn, border: 0, borderRadius: 0, background: m === mode ? 'var(--panel-3)' : 'none', color: m === mode ? 'var(--text)' : 'var(--faint)' }}>
                {MODE_LABEL[m]}
              </button>
            ))}
          </span>
        )}
      </div>
      {/* A plain box — captured output stays selectable and scrollable, a <video> keeps its own
          controls; enlarging is the button over it. */}
      <div style={{ position: 'relative', width: '100%', aspectRatio: '2 / 1', overflow: 'hidden', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)' }}>
        <SideBody media={media} mode={mode} side={side} size="small" />
        <button data-action="enlarge-evidence" aria-label={`Enlarge the ${side} evidence`} onClick={onEnlarge}
          style={{ ...miniBtn, position: 'absolute', top: 'var(--space-2)', right: 'var(--space-2)' }}>Enlarge</button>
      </div>
    </div>
  );
}

function MetricRows({ rows }: { rows: NonNullable<DemoModelCheckpoint['metrics']> }): JSX.Element {
  const cell: React.CSSProperties = { padding: 'var(--space-1) var(--space-2)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', borderTop: '1px solid var(--line)' };
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr style={{ color: 'var(--faint)', textAlign: 'left', fontSize: 'var(--text-xs)' }}><th>metric</th><th>before</th><th>after</th><th>parity</th></tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td style={cell}>{r.label}</td>
            <td style={cell}>{r.before ?? '—'}{r.unit ? ` ${r.unit}` : ''}</td>
            <td style={cell}>{r.after ?? '—'}{r.unit ? ` ${r.unit}` : ''}</td>
            <td style={{ ...cell, color: r.parity === 'diverged' ? 'var(--red)' : r.parity === 'incomplete' ? 'var(--steel)' : 'var(--green)' }}>{r.parity === 'incomplete' ? 'new' : r.parity}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
