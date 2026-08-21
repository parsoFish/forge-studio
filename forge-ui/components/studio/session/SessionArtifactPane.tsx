'use client';

import { useState } from 'react';

import { FilePackage } from '@/components/studio/FilePackage';
import { DependencyDag } from '@/components/studio/DependencyDag';
import { GenerationGallery } from '@/components/studio/GenerationGallery';
import { ContractBuildout } from '@/components/studio/ContractBuildout';
import { roadmapDraftView, markdownDraftView, cleanupPlanView, type SessionArtifactView, type CleanupPlanView, sessionArtifactView } from '@/lib/session-artifact-view';
import { lineDiff, type DiffRow } from '@/lib/text-diff';
import type { SessionArtifactPayload, RoadmapDraftRow, CleanupPlanAction, CleanupActionState } from '@/lib/session-client';

/** W7-C2 (sessions-kinds-30) — the verdict context for a markdown-draft
 *  artifact: where approving will WRITE (`targetPath`, absolute), and the
 *  CURRENT on-disk content when the session is editing an existing file
 *  (`current`; null in init mode — nothing to diff against). Threaded by
 *  the page from the per-kind summary that already carries both fields
 *  (InstructionsSessionSummary.currentInstructions/projectRepoPath) —
 *  declared-but-unconsumed wire data until now. */
export type MarkdownDraftContext = {
  targetPath: string;
  current: string | null;
};

// ---------------------------------------------------------------------------
// SessionArtifactPane — the RIGHT-hand "living artifact" pane of the shared
// session shell (R2-10 PR2, WI-7). One module covering all seven LIVE
// artifact kinds (roadmap-draft / markdown-draft / brain-structure /
// generation-gallery — R4-16 / contract-buildout — R4-17 / file-package —
// R4-21 / cleanup-plan — R4-19-F2) — mirrors session-artifact-view.ts's own
// "one module, not one file per kind" precedent (they are tightly-related
// renderers for the SAME pane of the SAME page).
//
// D10 (R4-17, binding, ruled by T2): branch selection DELEGATES to the
// `sessionArtifactView` dispatcher instead of a bespoke
// `artifact.kind === X ? ... : <Y>` ternary. The PRIOR ternary's final
// `else` unconditionally rendered `<GenerationGallery>`, so a kind the pane
// didn't explicitly branch on silently misrendered as a gallery instead of
// failing loudly — a declared-data-fails-open instance, and this initiative
// adds a new kind, so it ships the guard. `sessionArtifactView` is the ONE
// exhaustive dispatcher every live kind resolves through (session-artifact-
// view.test.ts's AT-84..122): an unhandled/unknown kind THROWS there, naming
// it, never silently matching another kind's view shape. This pane calls it
// ONCE, up front, purely to pick which branch to render (`view.kind`) — and
// catches its throw into an EXPLICIT, visible failure state
// (`UnhandledArtifactBody`), never any specific renderer. The duplicate
// ternary this replaces is deleted, not left beside the new path.
//
// Row/empty/state LOGIC is never re-implemented here: roadmap-draft and
// markdown-draft still dispatch through the pure `roadmapDraftView`/
// `markdownDraftView` (lib/session-artifact-view.ts) inside their own body
// components — the top-level `sessionArtifactView` call above exists for the
// BRANCH DECISION (and is contract-buildout's sole path, since that kind's
// view IS its render input), not to replace those per-kind calls; the two
// pure functions are cheap and side-effect-free, so computing a kind's view
// twice (once for dispatch, once for render) costs nothing observable.
// brain-structure's `themeCount` is a direct passthrough field on the
// artifact (no derived logic to reuse), and its file tabs render through the
// SHARED `FilePackage` component — no second tab-strip is written here;
// `FilePackage` is handed the raw `files` and manages its own tab-selection
// state via the same `filePackageTabs`/`selectFile` primitives
// `lib/session-artifact-view.ts`'s (unused-by-this-component)
// `brainStructureView`/`selectBrainStructureFile` also wrap. generation-gallery
// follows the SAME "hand the raw data to a self-contained component" pattern:
// `GenerationGallery` owns its own selection state internally (mirrors
// `FilePackage`, not a state lift here) — as a poll-stable generation NUMBER
// fed through `generationGalleryView`'s optional `preferredNumber` (R4-16 pin
// 2, Finding D), not an index derived from whichever `artifact` object
// reference happened to arrive on the latest 3s poll tick. contract-buildout
// (R4-17) hands `ContractBuildout` the ALREADY-COMPUTED `sessionArtifactView`
// output directly — that view IS its render input (mode:'checklist'|'detail'),
// so there is no second call to make.
//
// `project`/`sessionId` are OPTIONAL passthrough, needed only by
// generation-gallery's per-item "view" links + "finalize" action (D7: gallery
// items carry metadata, never bodies, so viewing one requires resolving a
// bridge URL keyed on project+session+generation+filename). The other kinds
// ignore them entirely. `onFinalizeGeneration` is likewise optional —
// owned and wired by whichever caller has a live demo-builder session to act
// on (DemoBuilderPanel); the generic `/sessions/[kind]/[sessionId]` deep-link
// route renders the gallery read-only without it (D3: "zero extra code").
// `activeStage` (R4-17) is the currently-selected session stage
// (session-shell-view.ts's `state.selectedStage`) — threaded straight to the
// dispatcher; every stage-UNAWARE kind (everything except contract-buildout)
// treats it as a no-op (session-artifact-view.test.ts's AT-91/109).
//
// The wrapper carries the mandated DOM-as-metrics contract
// (docs/forge-ui-dom-and-harness.md): `data-section="session-artifact"`,
// `data-artifact-kind`, `data-artifact-label` — `label` sourced straight from
// the artifact payload (R2-10 PR2's T2 Correction 1: the label lives once, in
// studio/session-kinds.yaml, threaded through the wire — never a second
// client-side kind→label lookup).
// ---------------------------------------------------------------------------

export function SessionArtifactPane({
  artifact,
  project,
  sessionId,
  activeStage,
  onFinalizeGeneration,
  draftContext,
}: {
  artifact: SessionArtifactPayload;
  project?: string;
  sessionId?: string;
  activeStage?: string;
  onFinalizeGeneration?: (generationNumber: number) => void;
  /** W7-C2 — markdown-draft only; every other kind ignores it (same
   *  optional-passthrough convention as `project`/`sessionId` above). */
  draftContext?: MarkdownDraftContext;
}): JSX.Element {
  let view: SessionArtifactView | null = null;
  let dispatchError: string | null = null;
  try {
    view = sessionArtifactView(artifact, activeStage);
  } catch (err) {
    dispatchError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div
      data-section="session-artifact"
      data-artifact-kind={artifact.kind}
      data-artifact-label={artifact.label}
      style={{
        border: '1px solid var(--line)',
        borderRadius: 10,
        background: 'var(--panel)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--line)',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '.05em',
          textTransform: 'uppercase',
          color: 'var(--faint)',
        }}
      >
        {artifact.label}
      </div>
      <div style={{ padding: 16, overflow: 'auto' }}>
        {view === null ? (
          <UnhandledArtifactBody kind={artifact.kind} error={dispatchError ?? 'sessionArtifactView produced no view'} />
        ) : view.kind === 'roadmap-draft' ? (
          <RoadmapDraftBody artifact={artifact as Extract<SessionArtifactPayload, { kind: 'roadmap-draft' }>} />
        ) : view.kind === 'markdown-draft' ? (
          <MarkdownDraftBody artifact={artifact as Extract<SessionArtifactPayload, { kind: 'markdown-draft' }>} draftContext={draftContext} />
        ) : view.kind === 'brain-structure' ? (
          <BrainStructureBody artifact={artifact as Extract<SessionArtifactPayload, { kind: 'brain-structure' }>} />
        ) : view.kind === 'generation-gallery' ? (
          <GenerationGallery
            artifact={artifact as Extract<SessionArtifactPayload, { kind: 'generation-gallery' }>}
            project={project}
            sessionId={sessionId}
            onFinalize={onFinalizeGeneration}
          />
        ) : view.kind === 'contract-buildout' ? (
          <ContractBuildout view={view} activeStage={activeStage} />
        ) : view.kind === 'file-package' ? (
          <FilePackageBody artifact={artifact as Extract<SessionArtifactPayload, { kind: 'file-package' }>} />
        ) : view.kind === 'cleanup-plan' ? (
          <CleanupPlanBody artifact={artifact as Extract<SessionArtifactPayload, { kind: 'cleanup-plan' }>} />
        ) : (
          <UnhandledArtifactBody kind={artifact.kind} error={`sessionArtifactView returned an unhandled view kind ${JSON.stringify((view as { kind: string }).kind)}`} />
        )}
      </div>
    </div>
  );
}

function RoadmapDraftBody({ artifact }: { artifact: Extract<SessionArtifactPayload, { kind: 'roadmap-draft' }> }): JSX.Element {
  const view = roadmapDraftView(artifact);
  if (view.isEmpty) {
    return <EmptyNote text={view.emptyMessage ?? 'No roadmap rows yet.'} />;
  }
  // R4-15 (adversarial-review fix, 2026-08-06): `view.dag` is the ONE shared
  // dependency-DAG view — already computed once by `roadmapDraftView` — read
  // by BOTH the DAG below and the table's "depends on" column. Neither this
  // component nor `DependencyDag` calls `dependencyDagView` a second time,
  // and the table never falls back to `row.dependsOn` verbatim (that field
  // stays undeduped/unsorted on the wire on purpose — only this shared view
  // normalises it), so the two surfaces structurally cannot disagree on what
  // a manifest declared.
  // Zipped POSITIONALLY, not through an id-keyed lookup (adversarial-review
  // round 2, 2026-08-06). `dependencyDagView` emits exactly one node per input
  // row, in input order, so `view.dag.nodes[i]` IS `view.rows[i]` — whereas an
  // id-keyed Map is last-write-wins, and two rows CAN share an initiativeId:
  // `deriveRoadmapDraft` reads `initiative_id` from each manifest's
  // frontmatter, not from its filename, so two files in one session's
  // manifests/ can declare the same id. That collision rendered one
  // initiative's dependency list as another's — wrong data, not missing data.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <DependencyDag view={view.dag} labelOf={(row: RoadmapDraftRow) => row.initiativeId} statusOf={(row: RoadmapDraftRow) => row.phase} />
      <table data-component="roadmap-draft-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--faint)', fontSize: 11 }}>
            <th style={thStyle}>initiative</th>
            <th style={thStyle}>project</th>
            <th style={thStyle}>phase</th>
            <th style={thStyle}>origin</th>
            <th style={thStyle}>depends on</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row, index) => {
            const deps = view.dag.nodes[index]?.deps ?? [];
            return (
              <tr
                key={`${row.initiativeId}#${index}`}
                data-roadmap-row={row.initiativeId}
                data-roadmap-depends-on={deps.join(',')}
                style={{ borderTop: '1px solid var(--line)' }}
              >
                <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)' }}>{row.initiativeId}</td>
                <td style={tdStyle}>{row.project}</td>
                <td style={tdStyle}>{row.phase}</td>
                <td style={tdStyle}>{row.origin}</td>
                <td style={tdStyle}>{deps.length > 0 ? deps.join(', ') : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MarkdownDraftBody({
  artifact,
  draftContext,
}: {
  artifact: Extract<SessionArtifactPayload, { kind: 'markdown-draft' }>;
  draftContext?: MarkdownDraftContext;
}): JSX.Element {
  // W7-C2 (sessions-kinds-30) — the draft-vs-current toggle. Hook order is
  // stable: declared before any early return, and inert (never read) for
  // the no-draft/empty states below.
  const [showDiff, setShowDiff] = useState(false);
  const view = markdownDraftView(artifact);
  if (view.state === 'no-draft') {
    return <EmptyNote data-markdown-draft-state="no-draft" text="No draft yet — the agent has not written AGENTS.draft.md." />;
  }
  if (view.state === 'empty-draft') {
    return <EmptyNote data-markdown-draft-state="empty-draft" text="The draft file exists but is currently empty." />;
  }
  // W7-C2 (sessions-kinds-30) — the verdict context: name the destination
  // an approve will write, and offer a diff against the CURRENT file when
  // the session is editing one (draftContext.current !== null). Sourced
  // from summary fields already on the wire — absent context renders the
  // draft exactly as before.
  const canDiff = draftContext !== undefined && draftContext.current !== null;
  const body = (
    <pre
      data-markdown-draft-state="has-content"
      style={{
        margin: 0,
        fontFamily: 'var(--font-mono)',
        fontSize: 12.5,
        lineHeight: 1.55,
        color: 'var(--text)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {view.body}
    </pre>
  );
  if (draftContext === undefined) return body;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        data-draft-target={draftContext.targetPath}
        style={{ fontSize: 11.5, color: 'var(--dim)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}
      >
        Approving writes <code>{draftContext.targetPath}</code>
        {draftContext.current === null ? ' (new file)' : ' (replaces the current file)'}
      </div>
      {canDiff && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="btn"
            data-action="draft-view-draft"
            disabled={!showDiff}
            onClick={() => setShowDiff(false)}
            style={{ fontSize: 11.5, opacity: showDiff ? 1 : 0.6 }}
          >
            Draft
          </button>
          <button
            type="button"
            className="btn"
            data-action="draft-view-diff"
            disabled={showDiff}
            onClick={() => setShowDiff(true)}
            style={{ fontSize: 11.5, opacity: showDiff ? 0.6 : 1 }}
          >
            Diff vs current
          </button>
        </div>
      )}
      {canDiff && showDiff ? <DraftDiffBody current={draftContext.current as string} draft={view.body} /> : body}
    </div>
  );
}

/** W7-C2 — the diff view: lineDiff rows with +/- gutters; a null result
 *  (over the size cap) renders an honest note, never a hung tab. */
function DraftDiffBody({ current, draft }: { current: string; draft: string }): JSX.Element {
  const rows = lineDiff(current, draft);
  if (rows === null) {
    return <EmptyNote data-draft-diff-state="too-large" text="These files are too large to diff here — review the draft directly." />;
  }
  const rowStyle = (row: DiffRow): React.CSSProperties =>
    row.type === 'add'
      ? { background: 'rgba(74, 222, 128, 0.10)', color: 'var(--text)' }
      : row.type === 'del'
        ? { background: 'rgba(248, 113, 113, 0.10)', color: 'var(--dim)', textDecoration: 'line-through' }
        : { color: 'var(--text)' };
  return (
    <div data-draft-diff-state="rendered" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.5, overflowX: 'auto' }}>
      {rows.map((row, i) => (
        <div key={i} data-diff-row={row.type} style={{ display: 'flex', gap: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', ...rowStyle(row) }}>
          <span aria-hidden="true" style={{ width: 12, flexShrink: 0, textAlign: 'center', color: row.type === 'add' ? 'var(--green)' : row.type === 'del' ? 'var(--red)' : 'var(--faint)' }}>
            {row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' '}
          </span>
          <span>{row.text || ' '}</span>
        </div>
      ))}
    </div>
  );
}

function BrainStructureBody({ artifact }: { artifact: Extract<SessionArtifactPayload, { kind: 'brain-structure' }> }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div data-brain-theme-count={artifact.themeCount} style={{ fontSize: 12.5, color: 'var(--dim)' }}>
        {artifact.themeCount} theme file{artifact.themeCount === 1 ? '' : 's'} seeded.
      </div>
      <FilePackage files={artifact.files} />
    </div>
  );
}

function FilePackageBody({ artifact }: { artifact: Extract<SessionArtifactPayload, { kind: 'file-package' }> }): JSX.Element {
  return <FilePackage files={artifact.files} />;
}

// ---------------------------------------------------------------------------
// CleanupPlanBody — R4-19-F2, the kb-cleanup session's artifact. The three
// action states (open/cleared/unknown) are LOAD-BEARING (cleanupPlanView's
// own doc): a real run once reported every action 'cleared' while nothing had
// been repaired, because absence of a finding was wrongly treated as proof of
// repair. Every visual cue below (dot colour, left-border stripe, AND a
// spelled-out label) is deliberately triple-redundant so the three states
// read as distinct even to an operator not attending to colour alone — never
// collapsing 'unknown' into 'cleared' at the presentation layer, which is
// exactly how that defect would resurface here.
// ---------------------------------------------------------------------------

const CLEANUP_ACTION_STATE_STYLE: Record<CleanupActionState, { color: string; label: string; bg: string }> = {
  open: { color: 'var(--red)', label: 'Open — still outstanding', bg: 'rgba(248, 113, 113, 0.08)' },
  cleared: { color: 'var(--green)', label: 'Cleared — repair confirmed', bg: 'rgba(74, 222, 128, 0.08)' },
  unknown: { color: 'var(--amber)', label: 'Unknown — coverage not established', bg: 'rgba(251, 191, 36, 0.08)' },
};

function CleanupPlanBody({ artifact }: { artifact: Extract<SessionArtifactPayload, { kind: 'cleanup-plan' }> }): JSX.Element {
  const view = cleanupPlanView(artifact);
  return (
    <div
      data-component="cleanup-plan"
      data-cleanup-plan-state={view.state}
      data-cleanup-plan-settled={view.settled}
      style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      <CleanupPlanStatusBanner view={view} />
      {view.state === 'no-plan' ? (
        <EmptyNote text="No cleanup plan yet — the agent has not drafted plan/cleanup-plan.md." />
      ) : (
        <>
          <pre
            style={{
              margin: 0,
              fontFamily: 'var(--font-mono)',
              fontSize: 12.5,
              lineHeight: 1.55,
              color: 'var(--text)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {view.plan}
          </pre>
          {view.state === 'has-actions' && <CleanupActionList actions={view.actions} />}
        </>
      )}
    </div>
  );
}

/** Never claims "open" as the reason a plan is unsettled when it isn't —
 *  AT-127's exact shape (settled:false with openFindingCount:0, because of
 *  an 'unknown' row) would otherwise read as a contradiction on screen
 *  ("0 open findings" next to "not settled"). Names the unknown rows
 *  explicitly instead of only the server's open count. */
function CleanupPlanStatusBanner({ view }: { view: CleanupPlanView }): JSX.Element | null {
  if (view.state !== 'has-actions') return null;
  const unknownCount = view.actions.filter((a) => a.state === 'unknown').length;
  if (view.settled) {
    return (
      <div style={{ fontSize: 12.5, color: 'var(--green)', fontWeight: 600 }}>All actions cleared — plan settled.</div>
    );
  }
  const parts: string[] = [];
  if (view.openFindingCount > 0) parts.push(`${view.openFindingCount} open`);
  if (unknownCount > 0) parts.push(`${unknownCount} unverified (coverage unknown)`);
  return (
    <div style={{ fontSize: 12.5, color: 'var(--amber)', fontWeight: 600 }}>
      Not settled{parts.length > 0 ? ` — ${parts.join(', ')}` : ''}.
    </div>
  );
}

function CleanupActionList({ actions }: { actions: CleanupPlanAction[] }): JSX.Element {
  return (
    <ul data-section="cleanup-action-list" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {actions.map((action, index) => {
        const style = CLEANUP_ACTION_STATE_STYLE[action.state];
        return (
          <li
            key={`${action.kind}#${action.target}#${index}`}
            data-cleanup-action-state={action.state}
            style={{
              borderLeft: `3px solid ${style.color}`,
              background: style.bg,
              borderRadius: 6,
              padding: '8px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: style.color, flexShrink: 0 }} />
              <strong style={{ fontSize: 12, color: style.color, textTransform: 'uppercase', letterSpacing: '.03em' }}>{style.label}</strong>
            </div>
            <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--dim)' }}>
              [{action.kind}] {action.target}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text)' }}>{action.proposal}</div>
          </li>
        );
      })}
    </ul>
  );
}

/** D10's explicit failure state: an artifact kind `sessionArtifactView` could
 *  not resolve to a renderer (reserved or genuinely unrecognised) reaches
 *  here instead of silently rendering as any specific kind's view — the
 *  dispatcher's thrown message (naming the offending kind) is shown
 *  verbatim, never swallowed. */
function UnhandledArtifactBody({ kind, error }: { kind: string; error: string }): JSX.Element {
  return (
    <div
      data-section="session-artifact-unhandled"
      data-artifact-unhandled-kind={kind}
      style={{ fontSize: 12.5, color: 'var(--red)', padding: '6px 0' }}
    >
      This artifact kind has no renderer: {error}
    </div>
  );
}

function EmptyNote({ text, ...rest }: { text: string } & Record<string, string>): JSX.Element {
  return (
    <div {...rest} style={{ fontSize: 12.5, color: 'var(--faint)', fontStyle: 'italic', padding: '6px 0' }}>
      {text}
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: '6px 10px 6px 0', fontWeight: 600 };
const tdStyle: React.CSSProperties = { padding: '7px 10px 7px 0', color: 'var(--text)', verticalAlign: 'top' };
