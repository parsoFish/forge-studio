'use client';

import { useState } from 'react';

import { postSessionAffordance, type SessionAffordance, type SessionArtifactPayload } from '@/lib/session-client';
import type { SessionLifecycle } from '@/lib/session-lifecycle-client';
import type { EventLogEntry } from '@/lib/bridge-client';
import { ActivityLog } from '@/components/studio/ActivityLog';
import { ProvenanceStrip } from '@/components/studio/session/ProvenanceStrip';
import { SessionQuestionFormAffordance } from '@/components/studio/session/SessionQuestionFormAffordance';
import { SessionVerdictAffordance } from '@/components/studio/session/SessionVerdictAffordance';
import type { GenerationSelection } from '@/lib/session-artifact-view';
import { type AuthoringPackageKind, isAuthoringPackageKind } from '@/lib/authoring-package-shape';

// ---------------------------------------------------------------------------
// SessionInteractivePanel — the GENERIC interaction panel (W6-B6, ADR-043
// docs/decisions/043-generic-interactive-surface.md 2026-08-15 amendment §1).
//
// Renders EXCLUSIVELY from the GET session-shell route's own `affordances[]`
// (`packages/sessions/studio/session-kinds.ts`'s `deriveSessionAffordances`,
// threaded onto the wire by `packages/sessions/bridge-studio-sessions.ts`, parsed by
// `apps/studio/lib/session-client.ts`) — it NEVER re-derives an affordance from
// `phase` itself. Availability is recomputed server-side on every GET AND
// re-checked server-side on every POST (`cli/bridge-studio-affordances.ts`,
// W6-B4) — a stale client that fires a phase-inappropriate affordance id
// 409s exactly as a forged one would; this panel is a thin, honest renderer
// over that already-derived contract, not a second source of truth.
//
// W6-B6 wired `demo`/`onboarding` onto this surface; W6-B8 added `kb-cleanup`
// and `authoring` (deleting their bespoke `SessionCleanupPanel`/
// `SessionAuthoringPanel`); W6-B9 adds `instructions` (deleting its bespoke
// `SessionInstructionsPanel`) — architect is now the ONLY kind that keeps its
// own panel, permanently (ADR-043 amendment §4 — its branching
// council/interview control flow has no linear phase-table seam).
//
// **File-size split (bead forge-8vfn.8.3.4).** This file used to render
// every affordance kind inline; it now owns ONLY the orchestration (which
// affordances are renderable, the zero-affordance state, the drawer, the
// finalized-object link, the per-affordance-id busy/error bookkeeping and
// the ONE generic `submit`) and delegates the two renderable kinds' actual
// markup to their own components:
//   - `question-form` → `SessionQuestionFormAffordance.tsx` (the free-text
//     briefing/answer box, and the per-question `ArchitectQuestionForm`
//     path for a real interview round).
//   - `verdict` → `SessionVerdictAffordance.tsx` (approve/reject/revise, the
//     generation picker, the authoring package-id field). See that file's
//     own header for the render contract each kind pins.
// `staged-review` / `next-turn` stay HIDDEN entirely (W6-B9 reviewer fix;
// previously rendered disabled with a "not yet wired" label). B4 returns 501
// `UnhandledAffordanceBody` for both — they describe what an `agent` step
// already did / where it advances to, not an operator write action, and a
// placeholder block for a control that can never work is clutter, not an
// honest affordance. `deriveSessionAffordances` still derives them onto the
// wire honestly — `isRenderableAffordance` filters them out of the DOM here,
// a presentation decision, not a data one.
//
// Every endpoint error — 409 wrong-phase (naming the offending affordance id
// + the currently-available set), 422, 501 UnhandledAffordanceBody — reaches
// the operator VERBATIM via `data-affordance-error`, never swallowed and
// never replaced by a generic "failed" string.
//
// The shared `ActivityLog` bottom drawer (W6-B7) renders in exactly ONE
// place: the ZERO-RENDERABLE-affordances early return, gated on `!terminal`
// (W6-B8) — `terminal` (session-client.ts, mirroring the server's own
// `isTerminalPhase`) is a session-level fact, not derived from
// `affordances.length` (a working, non-terminal phase can legitimately have
// zero affordances — onboarding's `running` phase is exactly that case, the
// one this gate most needs to cover). Every GENERIC_PANEL_KINDS kind gets
// this identically, never a per-kind branch.
// ---------------------------------------------------------------------------

/** W6-B9 reviewer fix — a GENERIC "does this panel have an actual renderer
 *  for this affordance kind" predicate, keyed on `kind` alone (never on
 *  `phase`/session `kind`). `staged-review`/`next-turn` are real, honestly
 *  DERIVED wire data describing what an agent step already wrote / where it
 *  advances to, not an operator WRITE action — but a placeholder "not yet
 *  wired" block for them is CLUTTER, not an honest affordance. Filtering
 *  renders here (a presentation decision) rather than at
 *  `deriveSessionAffordances` (the wire contract, a data decision) keeps
 *  `affordances[]` itself the full, honest derived set —
 *  `[data-affordance-count]` reflects what's actually IN THE DOM, never a
 *  count the operator can't see. */
const RENDERABLE_AFFORDANCE_KINDS: ReadonlySet<SessionAffordance['kind']> = new Set(['question-form', 'verdict']);

function isRenderableAffordance(affordance: SessionAffordance): boolean {
  return RENDERABLE_AFFORDANCE_KINDS.has(affordance.kind);
}

export function SessionInteractivePanel({
  kind,
  sessionId,
  project,
  phase,
  affordances,
  artifact = null,
  modelTier = null,
  events,
  terminal,
  legacy = false,
  lifecycle,
  onChanged,
  onPackageFinalized,
  finalized = null,
  selectedGeneration = null,
  onSelectGeneration = () => {},
}: {
  /** The session-kind id (e.g. 'demo', 'onboarding') — the POST route's own
   *  `:kind` segment. */
  kind: string;
  sessionId: string;
  project: string | null;
  /** The session's CURRENT phase — shown only in the provenance strip; every
   *  actual affordance decision comes from `affordances[]` itself, never
   *  re-derived from this value. */
  phase: string;
  affordances: SessionAffordance[];
  artifact?: SessionArtifactPayload | null;
  /** Read-only — the session's kickoff-selected tier, or `null` when none
   *  was recorded. Never editable from this panel (ADR-043 §3: the tier is
   *  chosen once, at kickoff). */
  modelTier?: string | null;
  /** This session's live event stream, handed straight to the shared
   *  `ActivityLog` drawer — REQUIRED (W6-B8; the real page always has one,
   *  even if empty before the first event lands). */
  events: EventLogEntry[];
  /** W6-B8 — session-client.ts's `terminal` (mirrors the server's own
   *  `isTerminalPhase`), the ONE gate for the ActivityLog drawer (`drawer`
   *  below, rendered only in the zero-renderable-affordances early return):
   *  it renders only while `!terminal` — a settled session has nothing left
   *  to watch work, onboarding's `running` phase legitimately has zero
   *  affordances while genuinely working. */
  terminal: boolean;
  /** W8-F6 (bead forge-6gv.27) — session-client.ts's `legacy`: this session's
   *  working dir is gone and its central event log is the ONLY surviving
   *  record of it. Such a session is ALWAYS `terminal: true`, so the
   *  `!terminal` drawer gate would hide the one thing there is left to show.
   *  `legacy` therefore re-opens the drawer — with `phaseActive` false,
   *  because nothing is running: the log is history, not a live feed. */
  legacy?: boolean;
  /** W7-A2 — the shell payload's server-derived lifecycle
   *  (session-lifecycle-client.ts). Read ONLY to pick the zero-affordance
   *  copy below (working / stopped / terminal). */
  lifecycle?: SessionLifecycle;
  /** Called after ANY successful POST (question-form submit or verdict) so
   *  the caller can re-fetch the session shell. Optional — a panel under a
   *  DOM-pin test never passes one. */
  onChanged?: () => void;
  /** W6-B8 — called when a verdict-approve's response echoes back a real
   *  `{kind, id}` naming one of `AUTHORING_PACKAGE_SHAPES`'s kinds — the
   *  PAGE navigates to the landed package's own detail page; this panel
   *  never calls `useRouter()` itself. */
  onPackageFinalized?: (packageKind: AuthoringPackageKind, id: string) => void;
  /** W7-C2 (sessions-kinds-36) — the shell payload's persisted pointer at
   *  the object this session produced. Rendered as a PERMANENT link in the
   *  terminal state. */
  finalized?: { kind: string; id: string; exists: boolean } | null;
  /** bead forge-8vfn.8.3.4 — the ONE generation selection, lifted to the
   *  session page and shared verbatim with `GenerationGallery`
   *  (`SessionArtifactPane`'s own `selectedGeneration` prop) so the two
   *  controls can never disagree about which generation an approve locks.
   *  Optional, defaulting to "nothing picked" / a no-op setter, so a DOM-pin
   *  test that predates this (or any kind whose artifact is never a
   *  generation-gallery) needs no update — the real page always passes the
   *  live pair. */
  selectedGeneration?: GenerationSelection;
  onSelectGeneration?: (next: GenerationSelection) => void;
}): JSX.Element {
  const [answerText, setAnswerText] = useState('');
  const [packageId, setPackageId] = useState('');
  const [notesText, setNotesText] = useState('');
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseFeedback, setReviseFeedback] = useState('');
  const [busyAffordanceId, setBusyAffordanceId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(affordance: SessionAffordance, body: Record<string, unknown>): Promise<void> {
    if (!project) {
      setErrors((prev) => ({ ...prev, [affordance.id]: 'no project known for this session — cannot submit' }));
      return;
    }
    setBusyAffordanceId(affordance.id);
    setErrors((prev) => {
      const { [affordance.id]: _drop, ...rest } = prev;
      return rest;
    });
    const result = await postSessionAffordance(kind, sessionId, affordance.id, { project, ...body });
    setBusyAffordanceId(null);
    if (!result.ok) {
      // Never swallowed — the server's own message (409 available-set, 422,
      // 501 UnhandledAffordanceBody) reaches the operator verbatim.
      setErrors((prev) => ({ ...prev, [affordance.id]: result.error }));
      return;
    }
    setAnswerText('');
    setPackageId('');
    setNotesText('');
    setReviseOpen(false);
    setReviseFeedback('');
    // W6-B8 — a package-shaped verdict response bubbles up to the page for
    // navigation. Driven by the RESPONSE shape, not by `kind`/`affordance`.
    const data = result.data;
    const packageKind = data['kind'];
    const packageIdEcho = data['id'];
    if (isAuthoringPackageKind(packageKind) && typeof packageIdEcho === 'string') {
      onPackageFinalized?.(packageKind, packageIdEcho);
    }
    onChanged?.();
  }

  const drawer = (!terminal || legacy) && (
    <ActivityLog label={`${kind} activity`} events={events} phaseLabel={phase} phaseActive={!legacy} />
  );

  // W6-B9 reviewer fix — filtered to what this panel can actually RENDER;
  // `data-affordance-count` and the empty-state gate both read this, not the
  // raw wire `affordances`, so the DOM metric never over-counts placeholder
  // sections nothing draws.
  const renderableAffordances = affordances.filter(isRenderableAffordance);

  if (renderableAffordances.length === 0) {
    // W7-A2 (sessions-kinds-11/27, home-sessions-09, knowledge-16) — the
    // zero-affordance branch is lifecycle-aware: a terminal session names
    // its phase; a crashed/stalled one points at the lifecycle banner above;
    // a working one says the agent is working and nothing is asked of the
    // operator.
    const reason: 'terminal' | 'stopped' | 'working' =
      terminal || lifecycle?.state === 'terminal' ? 'terminal'
      : lifecycle?.state === 'crashed' || lifecycle?.state === 'stalled' ? 'stopped'
      : 'working';
    const copy =
      // W8-F6 — a legacy session's phase can honestly be `''`.
      reason === 'terminal' && phase === '' ? 'Session ended — nothing further to do here.'
      : reason === 'terminal' ? `Session ${phase} — nothing further to do here.`
      : reason === 'stopped' ? 'The agent turn stopped — see the banner above for the error and to cancel this session.'
      : 'Agent is working — no operator action needed right now.';
    return (
      <div data-component="session-interactive-panel" data-affordance-count={0}>
        <ProvenanceStrip phase={phase} modelTier={modelTier} />
        <div data-section="session-no-affordances" data-no-affordance-reason={reason} style={{ fontSize: 12.5, color: 'var(--faint)', padding: '10px 0' }}>
          {copy}
        </div>
        <FinalizedLink finalized={finalized} />
        {drawer}
      </div>
    );
  }

  return (
    <div data-component="session-interactive-panel" data-affordance-count={renderableAffordances.length}>
      <ProvenanceStrip phase={phase} modelTier={modelTier} />

      {renderableAffordances.map((affordance) => {
        const error = errors[affordance.id];
        const busy = busyAffordanceId === affordance.id;

        if (affordance.kind === 'question-form') {
          return (
            <SessionQuestionFormAffordance
              key={affordance.id}
              affordance={affordance}
              project={project}
              sessionId={sessionId}
              kind={kind}
              answerText={answerText}
              setAnswerText={setAnswerText}
              error={error}
              busy={busy}
              submit={submit}
              onChanged={onChanged}
            />
          );
        }

        if (affordance.kind === 'verdict') {
          return (
            <SessionVerdictAffordance
              key={affordance.id}
              affordance={affordance}
              artifact={artifact}
              sessionId={sessionId}
              selectedGeneration={selectedGeneration}
              onSelectGeneration={onSelectGeneration}
              packageId={packageId}
              setPackageId={setPackageId}
              notesText={notesText}
              setNotesText={setNotesText}
              reviseOpen={reviseOpen}
              setReviseOpen={setReviseOpen}
              reviseFeedback={reviseFeedback}
              setReviseFeedback={setReviseFeedback}
              error={error}
              busy={busy}
              submit={submit}
            />
          );
        }

        // Structurally unreachable TODAY — `renderableAffordances` is
        // already filtered to `RENDERABLE_AFFORDANCE_KINDS` (question-form/
        // verdict only). Kept as defense-in-depth against
        // `RENDERABLE_AFFORDANCE_KINDS` drifting ahead of the render
        // branches above — fails honestly rather than silently rendering
        // nothing.
        return (
          <div key={affordance.id} data-section="session-affordance" data-affordance-kind={affordance.kind} style={{ fontSize: 11.5, color: 'var(--faint)' }}>
            unrecognised affordance kind &quot;{affordance.kind}&quot;
          </div>
        );
      })}
      {/* No `{drawer}` here (this branch: renderableAffordances.length > 0) —
          W6-B9's isRenderableAffordance filter (above) makes W6-B10's
          separate `showActivityLog` flag redundant: a phase whose ENTIRE
          derived affordances[] is non-renderable never reaches this branch
          at all — renderableAffordances is empty, so execution takes the
          EARLY RETURN above instead, where `{drawer}` already renders it. */}
    </div>
  );
}

/** W7-C2 (sessions-kinds-36) — the permanent "what this session produced"
 *  link, rendered in the zero-affordance (terminal) branch whenever the
 *  shell payload carries a persisted `finalized` pointer. A plain anchor,
 *  not `useRouter()` — same renderToStaticMarkup constraint the header
 *  documents for `onPackageFinalized`. An unrecognised kind renders the
 *  honest text without a link, never a guessed href. */
function FinalizedLink({ finalized }: { finalized: { kind: string; id: string; exists: boolean } | null }): JSX.Element | null {
  if (finalized === null) return null;
  const href =
    finalized.kind === 'skill' ? `/skills/${encodeURIComponent(finalized.id)}`
    : finalized.kind === 'hook' ? `/hooks/${encodeURIComponent(finalized.id)}`
    // W8-B4 FIX-1 — the third AUTHORING_PACKAGE_SHAPES kind; was missing
    // here, so a finalized template rendered the honest label below with NO
    // link at all (the same no-link branch a deleted skill/hook takes).
    : finalized.kind === 'template' ? `/templates/${encodeURIComponent(finalized.id)}`
    : finalized.kind === 'community-registry' ? '/community'
    // W7-C2 T1 review (P0-4) — the three kinds whose producers previously
    // wrote no pointer at all. Each names the object's own home page.
    : finalized.kind === 'agents-md' ? `/projects/${encodeURIComponent(finalized.id)}`
    : finalized.kind === 'demo' ? `/projects/${encodeURIComponent(finalized.id)}/showcase`
    : finalized.kind === 'kb' ? '/knowledge'
    : null;
  const label =
    finalized.kind === 'community-registry' ? 'Committed to the community registry'
    : finalized.kind === 'agents-md' ? `AGENTS.md committed to "${finalized.id}"`
    : finalized.kind === 'demo' ? `Demo locked for "${finalized.id}"`
    : finalized.kind === 'kb' ? `Cleanup applied to knowledge base "${finalized.id}"`
    : `Committed as ${finalized.kind} "${finalized.id}"`;
  // W7-C2 T1 review (P0-4) — `exists` is DERIVED server-side on every read.
  // A pointer at an object that has since been deleted or renamed renders
  // the honest record WITHOUT a link.
  if (href === null || !finalized.exists) {
    return (
      <div
        data-section="session-finalized"
        data-finalized-exists={finalized.exists ? 'true' : 'false'}
        style={{ fontSize: 12.5, color: 'var(--dim)', padding: '4px 0 10px' }}
      >
        {finalized.exists ? `${label}.` : `${label} — no longer present.`}
      </div>
    );
  }
  return (
    <div data-section="session-finalized" data-finalized-exists="true" style={{ fontSize: 12.5, padding: '4px 0 10px' }}>
      <a data-action="open-finalized" href={href} style={{ color: 'var(--ember, #ff9e4a)', textDecoration: 'none' }}>
        {label} →
      </a>
    </div>
  );
}
