'use client';

import { useState } from 'react';

import { generationGalleryView, preferredGenerationFor, type GenerationGalleryView } from '@/lib/session-artifact-view';
import type { GenerationGalleryArtifact, GenerationGalleryEntry, GenerationGalleryItem } from '@/lib/session-client';
import { architectFileUrl, demoGenerationFileUrl } from '@/lib/bridge-client';

// ---------------------------------------------------------------------------
// GenerationGallery — the demo-builder's accumulating generation selector
// (R4-16). Modelled on DependencyDag.tsx: presentational, driven by a view
// model — `generationGalleryView` (lib/session-artifact-view.ts) owns every
// bit of derived state.
//
// R4-16 pin 2 (Finding D) — poll-stable selection: `DemoBuilderPanel` (the
// project-page caller) refetches the session shell every 3s, so `artifact`
// arrives as a BRAND-NEW object graph each tick even when the generations
// haven't changed. This component therefore does NOT store the derived
// `GenerationGalleryView` in state, and does NOT key any effect on
// `artifact` (both of those reset on every new reference, killing the
// operator's pick within 3 seconds — the exact bug this fixes). Instead it
// derives the view fresh on every render via `generationGalleryView` looked
// up BY VALUE, never by array position.
//
// R4-16 round 2 (pin 3, Finding C, MAJOR) — the cross-session selection
// leak: a bare `useState<number | null>` survived a session SWITCH too, not
// just a poll tick — `projects/[id]/page.tsx`'s `handleDemoSessionStarted`
// swaps `sessionId` without unmounting this component, so a generation
// picked in session A silently kept rendering (and would be what
// "finalize" sends) once the panel moved on to session B. The stored
// selection now carries the session id it was made in; `preferredGenerationFor`
// (lib/session-artifact-view.ts) only honours it when that id still matches
// the CURRENTLY-DISPLAYED `sessionId` — never via an artifact-identity
// `useEffect` (that was the earlier, now-replaced fix shape). `null` means
// "no explicit pick yet in this render"; the view's own default (newest)
// takes over, exactly matching the pre-fix behaviour until the operator
// clicks one.
//
// `project`/`sessionId` are OPTIONAL: this component is reachable both from
// DemoBuilderPanel (project page, R1-03-F2 entry — always has both) and from
// the generic `/sessions/[kind]/[sessionId]` deep-link route via
// SessionArtifactPane (D3: "falls out of the registry, zero extra code" —
// that route does not thread project/sessionId through today). Without
// them, per-item "view" links and the "finalize" action are honestly
// disabled rather than fabricating a broken link; the selection tracker
// falls back to `''` as a stable per-mount identity (a route with no
// sessionId never swaps sessions, so this never leaks anything).
// ---------------------------------------------------------------------------

export function GenerationGallery({
  artifact,
  project,
  sessionId,
  onFinalize,
}: {
  artifact: GenerationGalleryArtifact;
  project?: string;
  sessionId?: string;
  /** Enacts "finalize this generation" (POST /api/demo-builder/lock with the
   *  chosen generation number) — owned by the caller (DemoBuilderPanel),
   *  never by this presentational component. Absent ⇒ the control renders,
   *  disabled — never a silently-swallowed click. */
  onFinalize?: (generationNumber: number) => void;
}): JSX.Element {
  // Stable per-mount identity for a caller that doesn't thread `sessionId`
  // (the deep-link session-shell route) — see the module header above.
  const effectiveSessionId = sessionId ?? '';
  const [selection, setSelection] = useState<{ sessionId: string; number: number } | null>(null);
  const view: GenerationGalleryView = generationGalleryView(artifact, preferredGenerationFor(selection, effectiveSessionId));

  const selected = view.selectedIndex >= 0 ? view.generations[view.selectedIndex] : null;

  return (
    <div
      data-section="generation-gallery"
      data-generation-count={view.count}
      data-selected-generation={selected ? selected.number : ''}
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      {view.isEmpty ? (
        <div data-generation-empty="true" style={{ fontSize: 12.5, color: 'var(--faint)', fontStyle: 'italic', padding: '6px 0' }}>
          {view.emptyMessage}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {view.generations.map((g, i) => {
              const isSelected = i === view.selectedIndex;
              return (
                <button
                  key={g.number}
                  type="button"
                  data-action="select-generation"
                  data-generation-number={g.number}
                  data-generation-selected={isSelected ? 'true' : 'false'}
                  onClick={() => setSelection({ sessionId: effectiveSessionId, number: g.number })}
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: '1px solid var(--line)',
                    background: isSelected ? 'var(--ember, #FF9E4A)' : 'var(--panel-2)',
                    color: isSelected ? '#1a1206' : 'var(--text)',
                    cursor: 'pointer',
                  }}
                >
                  Gen {g.number}
                </button>
              );
            })}
          </div>

          {selected && (
            <GenerationDetail
              generation={selected}
              project={project}
              sessionId={sessionId}
              onFinalize={onFinalize}
            />
          )}
        </>
      )}
    </div>
  );
}

function GenerationDetail({
  generation,
  project,
  sessionId,
  onFinalize,
}: {
  generation: GenerationGalleryEntry;
  project?: string;
  sessionId?: string;
  onFinalize?: (generationNumber: number) => void;
}): JSX.Element {
  const hasFeedback = generation.feedback !== null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {generation.items.map((item) => (
          <GenerationItemCard
            key={item.path}
            item={item}
            generationNumber={generation.number}
            project={project}
            sessionId={sessionId}
          />
        ))}
      </div>

      <div
        data-section="generation-feedback"
        data-has-feedback={hasFeedback ? 'true' : 'false'}
        style={{
          fontSize: 12.5,
          color: hasFeedback ? 'var(--text)' : 'var(--faint)',
          fontStyle: hasFeedback ? 'normal' : 'italic',
          padding: '8px 12px',
          border: '1px solid var(--line)',
          borderRadius: 8,
          background: 'var(--panel)',
        }}
      >
        {hasFeedback ? (
          <>
            <strong style={{ color: 'var(--faint)', fontWeight: 700, textTransform: 'uppercase', fontSize: 10.5, letterSpacing: '.05em' }}>
              Feedback that drove this generation
            </strong>
            <div style={{ marginTop: 4 }}>{generation.feedback}</div>
          </>
        ) : (
          'No feedback — the initial brief.'
        )}
      </div>

      <button
        type="button"
        data-action="finalize-generation"
        data-generation-number={generation.number}
        onClick={() => onFinalize?.(generation.number)}
        disabled={!onFinalize}
        title={onFinalize ? undefined : 'Not available from this view'}
        style={{
          alignSelf: 'flex-start',
          fontSize: 13,
          fontWeight: 600,
          color: '#fff',
          background: onFinalize ? '#238636' : 'var(--panel-2)',
          border: '1px solid var(--line)',
          borderRadius: 6,
          padding: '7px 16px',
          cursor: onFinalize ? 'pointer' : 'default',
          opacity: onFinalize ? 1 : 0.5,
        }}
      >
        Finalize this generation
      </button>
    </div>
  );
}

/** html/markdown items are servable+renderable text; 'file' is an honest
 *  catch-all for anything else (D7: items carry metadata, never bodies) —
 *  the "view" affordance is offered only for the two kinds this route can
 *  meaningfully show inline, and only once project/sessionId are known. */
function isViewableKind(kind: GenerationGalleryItem['kind']): boolean {
  return kind === 'html' || kind === 'markdown';
}

function GenerationItemCard({
  item,
  generationNumber,
  project,
  sessionId,
}: {
  item: GenerationGalleryItem;
  generationNumber: number;
  project?: string;
  sessionId?: string;
}): JSX.Element {
  const canView = isViewableKind(item.kind) && !!project && !!sessionId;

  async function viewItem(): Promise<void> {
    if (!project || !sessionId) return;
    const abs = await architectFileUrl(demoGenerationFileUrl(project, sessionId, generationNumber, item.path));
    if (abs) window.open(abs, '_blank', 'noopener,noreferrer');
  }

  return (
    <div
      data-generation-item
      data-item-path={item.path}
      data-item-kind={item.kind}
      data-item-bytes={item.bytes}
      style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', background: 'var(--panel)' }}
    >
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--text)', wordBreak: 'break-word' }}>{item.path}</div>
      <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2 }}>
        {item.kind} · {item.bytes} bytes
      </div>
      {canView && (
        <button
          type="button"
          data-action="view-generation-item"
          data-item-path={item.path}
          onClick={() => void viewItem()}
          style={{ marginTop: 6, fontSize: 11.5, color: 'var(--ember)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          view →
        </button>
      )}
    </div>
  );
}
