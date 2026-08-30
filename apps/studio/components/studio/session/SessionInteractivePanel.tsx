'use client';

import { useState } from 'react';

import { postSessionAffordance, type SessionAffordance, type SessionArtifactPayload, type FilePackageFile } from '@/lib/session-client';
import type { SessionLifecycle } from '@/lib/session-lifecycle-client';
import { ActivityLog } from '@/components/studio/ActivityLog';
import { ArchitectQuestionForm } from '@/components/ArchitectQuestionForm';
import type { EventLogEntry } from '@/lib/bridge-client';
import { disabledAttrs } from '@/lib/disabled-reason';
import { ProvenanceStrip } from '@/components/studio/session/ProvenanceStrip';
import { deriveApproveGate } from '@/lib/session-verdict-gate';
import {
  AUTHORING_PACKAGE_SHAPES,
  authoringPackageKindOf,
  isAuthoringPackageKind,
  type AuthoringPackageKind,
} from '@/lib/authoring-package-shape';

// ---------------------------------------------------------------------------
// SessionInteractivePanel — the GENERIC interaction panel (W6-B6, ADR-043
// docs/decisions/043-generic-interactive-surface.md 2026-08-15 amendment §1).
//
// Renders EXCLUSIVELY from the GET session-shell route's own `affordances[]`
// (`orchestrator/studio/session-kinds.ts`'s `deriveSessionAffordances`,
// threaded onto the wire by `cli/bridge-studio-sessions.ts`, parsed by
// `forge-ui/lib/session-client.ts`) — it NEVER re-derives an affordance from
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
// Per-affordance-kind rendering:
//   - `question-form` — a free-text answer box (no per-question granularity
//     on the wire — the operator reads the actual question text in the
//     transcript pane to the LEFT of this panel and replies here; the
//     transcript already surfaces the FULL pending question text at
//     `awaiting-answers` — `deriveSessionTranscript`,
//     orchestrator/studio/session-transcript.ts — so this box does not
//     duplicate it). Submits `{answers: [{question, answer}]}` — B4's
//     `handleInstructionsAnswer`'s exact body shape. instructions (W6-B9)
//     and demo (W6-B10, landed concurrently) are this affordance kind's
//     first two real consumers, and instructions derives it from TWO
//     phases: `awaiting-answers` (a real interview round) and `briefing` (the
//     pre-interview checkpoint every new session starts at,
//     `handleInstructionsBrief`, cli/bridge-studio-affordances.ts) — demo's
//     own `briefing` row works the same way via `handleDemoBrief`. The Send
//     button therefore does NOT require non-empty text (unlike an earlier
//     revision of this file): a briefing note is genuinely optional (the
//     bespoke routes they replace, `POST /api/instructions/brief` and
//     `POST /api/demo-builder/brief`, both always accepted an empty brief),
//     and an empty interview answer is harmless — the agent can simply
//     re-ask. No per-phase or per-kind special-casing here; the button
//     reads the SAME rule for all of them.
//   - `verdict` — approve/reject buttons, rendered from `affordance.meta.
//     verdicts` ONLY (W6-B6 post-merge review) — the server-derived, single
//     source of "which verdict values are legal here"
//     (`deriveSessionAffordances`, orchestrator/studio/session-kinds.ts:
//     the row's authored `verdicts:` list, or the ADR default
//     `['approve','reject']`); the SAME write route validates a posted
//     verdict against this SAME value, so there is no second, hand-kept
//     per-kind table on either side that could silently drift from
//     `studio/session-kinds.yaml` (kb-cleanup/authoring declare
//     `verdicts: [approve]` there — no rejection path, so the reject button
//     never renders for them, without this component knowing their names).
//     Approve additionally offers a generation picker (B4's
//     `handleDemoVerdict` accepts an optional `generation`) whenever the
//     session's own artifact IS a real `generation-gallery` with at least
//     one generation — driven by the wire artifact kind, never a `kind ===
//     'demo'` compare. W6-B9 (reviewer finding on W6-B8, replacing this
//     batch's original hardcoded shape): Approve's extra-fields gate is now
//     GENERIC — driven by `affordance.meta.requires` (the row's authored
//     `requires:` list, e.g. authoring's `awaiting-review` row declares
//     `['id']`), never a client-side "file-package needs an id" assumption.
//     When the artifact IS a real `file-package` (again driven by
//     `artifact.kind`, never `kind === 'authoring'`), a
//     `[data-field="session-package-id"]` text input renders alongside the
//     button — `id` (the library directory name) is an operator decision the
//     drafted package cannot make for itself (D4) — and Approve stays
//     disabled until every field `meta.requires` names is filled AND the
//     draft's shape is resolved (a client-side ADVISORY check ONLY, detected
//     purely by file PRESENCE — a `SKILL.md` at the package root ⇒ skill,
//     `hook.yaml` ⇒ hook, neither ⇒ still drafting — never a duplicate of a
//     server-enforced rule, unlike the old id-required gate this replaces).
//     `kind` itself is NEVER sent in the body — the write route
//     (cli/bridge-studio-affordances.ts) derives it server-side from the
//     REAL staged files, closing the class of defect where a client could
//     claim a kind that disagrees with what actually landed. On a successful
//     package-shaped approve, `onPackageFinalized` fires with the server's
//     own `{kind, id}` echo — bubbled up so the PAGE (not this panel)
//     navigates to `/skills/<id>`/`/hooks/<id>`, mirroring why `onChanged`
//     is a callback rather than a `useRouter()` call here: `useRouter()`
//     throws "invariant expected app router to be mounted" under
//     `renderToStaticMarkup`, the
//     harness this file's own DOM regression suite renders with.
//   - `staged-review` / `next-turn` — HIDDEN entirely (W6-B9 reviewer fix;
//     previously rendered disabled with a "not yet wired" label). B4 returns
//     501 `UnhandledAffordanceBody` for both — they describe what an `agent`
//     step already did / where it advances to, not an operator write
//     action, and a placeholder block for a control that can never work is
//     clutter, not an honest affordance, especially on the FIRST screen an
//     operator sees (instructions' `briefing` row derives exactly this
//     shape). `deriveSessionAffordances` still derives them onto the wire
//     honestly — `isRenderableAffordance` filters them out of the DOM here,
//     a presentation decision, not a data one.
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
// this identically, never a per-kind branch. W6-B10 originally added a
// SECOND gate (`showActivityLog`) for the "affordances exist but none are
// actionable" case (demo's `generating`, deriving only `staged-review`/
// `next-turn`) — W6-B9's `isRenderableAffordance` filter (below) made that
// second gate redundant: a phase whose ENTIRE derived set is non-renderable
// now has `renderableAffordances.length === 0` too, so it already takes the
// SAME early-return branch `{drawer}` lives in. One mechanism now covers
// both cases W6-B8 and W6-B10 each built their own gate for.
// ---------------------------------------------------------------------------

/** W6-B9 reviewer fix — a GENERIC "does this panel have an actual renderer
 *  for this affordance kind" predicate, keyed on `kind` alone (never on
 *  `phase`/session `kind` — the SAME discipline every other branch in this
 *  file already holds). `staged-review`/`next-turn` are real, honestly
 *  DERIVED wire data (`deriveSessionAffordances` legitimately emits
 *  `next-turn` for any `noop` row that also declares `next` — instructions'
 *  OWN `briefing`/`awaiting-answers` rows both do) describing what an agent
 *  step already wrote / where it advances to, not an operator WRITE action
 *  (B4's write route 501s both, `UnhandledAffordanceBody`) — but a
 *  placeholder "not yet wired" block for them is CLUTTER, not an honest
 *  affordance, especially on `briefing`, the FIRST screen every new
 *  instructions session lands the operator on. Filtering renders here (a
 *  presentation decision) rather than at `deriveSessionAffordances` (the
 *  wire contract, a data decision) keeps `affordances[]` itself the full,
 *  honest derived set — `[data-affordance-count]` reflects what's actually
 *  IN THE DOM (the CWC discipline this whole file's header note leans on),
 *  never a count the operator can't see. */
const RENDERABLE_AFFORDANCE_KINDS: ReadonlySet<SessionAffordance['kind']> = new Set(['question-form', 'verdict']);

function isRenderableAffordance(affordance: SessionAffordance): boolean {
  return RENDERABLE_AFFORDANCE_KINDS.has(affordance.kind);
}

/** Detects a drafted authoring package's shape purely by file PRESENCE —
 *  delegates to `authoringPackageKindOf` (forge-ui/lib/authoring-package-
 *  shape.ts), the ONE enumeration of "which marker file names which shape"
 *  on this side of the cli/forge-ui boundary (W8-B4 FIX-1; that module's
 *  header explains why this is a hand-mirrored copy of the SERVER's own
 *  array, not an import, and how the two are kept honest). `'unknown'`
 *  covers "still drafting" (no marker file has landed yet) — mirrors the
 *  retired `SessionAuthoringPanel`'s identical helper's own contract. */
type DraftShape = AuthoringPackageKind | 'unknown';

function draftShapeOf(files: readonly FilePackageFile[]): DraftShape {
  return authoringPackageKindOf(files.map((f) => f.path));
}

/** The package-id field's label — was a hardcoded `shape === 'hook' ? …
 *  : 'Skill id …'` two-way branch (the SAME blind spot as `draftShapeOf`)
 *  that mislabeled a template draft's id field "Skill id" (W8-B4 FIX-1).
 *  Derived from `AUTHORING_PACKAGE_SHAPES`'s own kind names so a future
 *  fourth shape gets an honest label for free rather than falling into the
 *  'skill' default. */
function packageIdFieldLabel(shape: DraftShape | null): string {
  const known = AUTHORING_PACKAGE_SHAPES.find((s) => s.kind === shape);
  const noun = known ? `${known.kind[0]!.toUpperCase()}${known.kind.slice(1)}` : 'Skill';
  return shape === 'template' ? `${noun} id (file name, without .md)` : `${noun} id (directory name)`;
}

/** The "still resolving" advisory naming every marker file this route looks
 *  for — was a hardcoded "a SKILL.md or hook.yaml" sentence (W8-B4 FIX-1)
 *  that silently fell behind the moment `template.md` became a real third
 *  shape. Built FROM `AUTHORING_PACKAGE_SHAPES`, mirroring the server's own
 *  409 message (cli/bridge-studio-affordances.ts). */
function shapeWaitingHint(): string {
  const names = AUTHORING_PACKAGE_SHAPES.map((s) => s.filename);
  return `Waiting for the draft to include a ${names.slice(0, -1).join(', ')} or ${names[names.length - 1]} before this can be saved.`;
}

function generationOptions(artifact: SessionArtifactPayload | null): number[] {
  if (!artifact || artifact.kind !== 'generation-gallery') return [];
  return artifact.generations.map((g) => g.number).sort((a, b) => b - a);
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
  /** This session's live event stream (the SAME `useCycleEvents(cycleId)`
   *  feed the page already computes for the StageHex burst chips / the
   *  retired `DemoBuilderPanel`/`SessionInstructionsPanel` used), handed
   *  straight to the shared `ActivityLog` drawer — REQUIRED (W6-B8; the
   *  real page always has one, even if empty before the first event lands;
   *  test call sites default it via their own local helper, not a prop
   *  default, mirroring how `phase` is required). */
  events: EventLogEntry[];
  /** W6-B8 — session-client.ts's `terminal` (mirrors the server's own
   *  `isTerminalPhase`), the ONE gate for the ActivityLog drawer (`drawer`
   *  below, rendered only in the zero-renderable-affordances early return):
   *  it renders only while `!terminal` — a settled session has nothing left
   *  to watch work, onboarding's `running` phase legitimately has zero
   *  affordances while genuinely working. A working phase whose affordances
   *  are all non-renderable (demo's `generating`) reaches this SAME branch
   *  too (see `isRenderableAffordance`'s doc comment) — one gate, not two. */
  terminal: boolean;
  /** W8-F6 (bead forge-6gv.27) — session-client.ts's `legacy`: this session's
   *  working dir is gone and its central event log is the ONLY surviving
   *  record of it. Such a session is ALWAYS `terminal: true` (nothing can
   *  advance it), so the `!terminal` drawer gate would hide the one thing
   *  there is left to show. `legacy` therefore re-opens the drawer — with
   *  `phaseActive` false, because nothing is running: the log is history, not
   *  a live feed. Optional with a `false` default only so the many pre-W8-F6
   *  call sites in this repo's own tests need no mechanical update (the same
   *  reason `events`/`terminal` were introduced that way); every real call
   *  site passes the wire value. */
  legacy?: boolean;
  /** W7-A2 — the shell payload's server-derived lifecycle
   *  (session-lifecycle-client.ts). Read ONLY to pick the zero-affordance
   *  copy below (working / stopped / terminal) — the banner that actually
   *  shows a crash/stall + the cancel control is `SessionLifecycleBar`,
   *  rendered by the PAGE for every kind (this panel is generic-kinds
   *  only). Optional so a DOM-pin test that predates it still renders; the
   *  real page always passes it. */
  lifecycle?: SessionLifecycle;
  /** Called after ANY successful POST (question-form submit or verdict) so
   *  the caller can re-fetch the session shell. Optional — a panel under a
   *  DOM-pin test never passes one. */
  onChanged?: () => void;
  /** W6-B8 — called when a verdict-approve's response echoes back a real
   *  `{kind, id}` naming one of `AUTHORING_PACKAGE_SHAPES`'s kinds (the
   *  `file-package` artifact's finalize shape, `runFinalize`'s own
   *  response) — the PAGE navigates to the landed package's own detail
   *  page; this panel never calls `useRouter()` itself (see this file's
   *  header). Optional — a panel under a DOM-pin test never passes one, and
   *  no other affordance shape ever triggers it. Widened to
   *  `AuthoringPackageKind` (W8-B4 FIX-1) — was `'skill' | 'hook'` only,
   *  which silently dropped a `kind:'template'` response on the floor. */
  onPackageFinalized?: (packageKind: AuthoringPackageKind, id: string) => void;
  /** W7-C2 (sessions-kinds-36) — the shell payload's persisted pointer at
   *  the object this session produced (written at finalize success, read
   *  back on every GET). Rendered as a PERMANENT link in the terminal
   *  state — the durable sibling of `onPackageFinalized`'s one-shot
   *  redirect. Optional so a DOM-pin test that predates it still renders;
   *  the real page always passes the payload's value (null included). */
  finalized?: { kind: string; id: string; exists: boolean } | null;
}): JSX.Element {
  const [answerText, setAnswerText] = useState('');
  const [pickedGeneration, setPickedGeneration] = useState<string>('');
  const [packageId, setPackageId] = useState('');
  const [notesText, setNotesText] = useState('');
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseFeedback, setReviseFeedback] = useState('');
  const [busyAffordanceId, setBusyAffordanceId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // W6-B6 post-merge review: driven by the WIRE artifact kind, never a
  // `kind === 'demo'` compare — generationOptions itself already returns
  // [] for any artifact that isn't a real generation-gallery, so demo is
  // simply the only kind that will ever have one, without this component
  // needing to know its name.
  const generations = generationOptions(artifact);

  // W6-B8 — same discipline, for authoring's file-package shape: driven by
  // `artifact.kind`, never `kind === 'authoring'`.
  const packageArtifact = artifact !== null && artifact.kind === 'file-package' ? artifact : null;
  const packageShape = packageArtifact ? draftShapeOf(packageArtifact.files) : null;

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
    // W6-B8 — a package-shaped verdict response (`runFinalize`'s own
    // `{ok:true, kind, id}`) bubbles up to the page for navigation. Driven by
    // the RESPONSE shape, not by `kind`/`affordance` — any future affordance
    // whose write handler happens to echo the same two fields gets the same
    // treatment, for free. `isAuthoringPackageKind` (W8-B4 FIX-1) checks
    // membership in `AUTHORING_PACKAGE_SHAPES` — was a hardcoded `=== 'skill'
    // || === 'hook'` pair that silently dropped a `kind:'template'` response.
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

  // W6-B9 reviewer fix — filtered to what this panel can actually RENDER
  // (see isRenderableAffordance's own doc comment); `data-affordance-count`
  // and the empty-state gate both read this, not the raw wire `affordances`,
  // so the DOM metric never over-counts placeholder sections nothing draws.
  const renderableAffordances = affordances.filter(isRenderableAffordance);

  if (renderableAffordances.length === 0) {
    // W7-A2 (sessions-kinds-11/27, home-sessions-09, knowledge-16) — the
    // zero-affordance branch is lifecycle-aware, never the one flat sentence
    // for every terminal, working AND crashed state: a terminal session
    // names its phase; a crashed/stalled one points at the lifecycle banner
    // above (which carries the error + Cancel); a working one says the agent
    // is working and nothing is asked of the operator. `data-no-affordance-
    // reason` mirrors that three-way split for the DOM contract.
    const reason: 'terminal' | 'stopped' | 'working' =
      terminal || lifecycle?.state === 'terminal' ? 'terminal'
      : lifecycle?.state === 'crashed' || lifecycle?.state === 'stalled' ? 'stopped'
      : 'working';
    const copy =
      // W8-F6 — a legacy session's phase can honestly be `''` (its log never
      // recorded one), and `Session  — nothing further to do here.` is not a
      // sentence. Say what is actually true instead of interpolating a hole.
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
          // W7-C2 (sessions-kinds-17/19, bead forge-lzv) — when the bridge
          // attached the PENDING questions (meta.questions, awaiting-answers
          // only), render one control per question by REUSING the
          // ArchitectQuestionForm component (per-question options + a
          // free-text override each) instead of the single flattened box.
          // Its submit posts the REAL question text with each answer —
          // `{answers: [{question, answer}, …]}`, the same wire shape
          // `handleInstructionsAnswer` has always accepted — which is what
          // keeps the durable answers.json (and the transcript derived from
          // it) honest; the old hardcoded 'Operator response' placeholder
          // permanently overwrote the questions in the record.
          const pendingQuestions = affordance.meta?.questions ?? [];
          if (pendingQuestions.length > 0) {
            return (
              <div key={affordance.id} data-section="session-affordance" data-affordance-kind="question-form" style={sectionStyle}>
                <ArchitectQuestionForm
                  project={project ?? ''}
                  sessionId={sessionId}
                  round={0}
                  questions={pendingQuestions.map((q) => ({ id: q.id, question: q.question, header: q.header ?? '', options: q.options }))}
                  sectionName="session-interview"
                  heading="Interview"
                  onSubmitAnswers={async ({ answers }) => {
                    if (!project) return { ok: false, error: 'no project known for this session — cannot submit' };
                    const result = await postSessionAffordance(kind, sessionId, affordance.id, { project, answers });
                    if (!result.ok) return { ok: false, error: result.error };
                    onChanged?.();
                    return { ok: true };
                  }}
                />
              </div>
            );
          }
          // W7-C2 (sessions-kinds-17's briefing half) — the free-text box
          // keeps carrying the briefing checkpoint and any awaiting-answers
          // round whose questions did not reach the wire, but the BRIEFING
          // copy is its own: a brand-new session's first screen is an
          // optional brief, not an "Answer" to a question nobody asked.
          // Keyed on `affordance.phase` — the server-derived field this
          // panel already reads — never the session `kind`.
          const isBriefing = affordance.phase === 'briefing';
          return (
            <div key={affordance.id} data-section="session-affordance" data-affordance-kind="question-form" style={sectionStyle}>
              <div style={labelStyle}>{isBriefing ? 'Brief the agent (optional)' : 'Answer'}</div>
              {isBriefing && (
                <div style={{ fontSize: 12, color: 'var(--faint)', marginBottom: 6 }}>
                  Anything you want the agent to focus on before it starts — leave empty to just start.
                </div>
              )}
              <textarea
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                placeholder={isBriefing ? 'Focus / guidance (optional)…' : 'Your answer…'}
                rows={3}
                data-field="session-answer"
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
              />
              {error && <ErrorLine message={error} />}
              <button
                type="button"
                className="btn btn-primary"
                data-action="submit-answers"
                {...disabledAttrs(busy ? 'Submitting…' : null)}
                onClick={() => void submit(affordance, { answers: [{ question: isBriefing ? 'Briefing note' : 'Operator response', answer: answerText.trim() }] })}
                style={{ opacity: busy ? 0.5 : 1 }}
              >
                {busy ? 'Sending…' : isBriefing ? 'Start →' : 'Send answer'}
              </button>
            </div>
          );
        }

        if (affordance.kind === 'verdict') {
          // W6-B6 post-merge review: rendered from the server-derived
          // `meta.verdicts` ONLY — never a per-kind name compare. Every
          // `verdict`-kind affordance carries this field (deriveSessionAffordances
          // always attaches it); the empty-array fallback is defensive only
          // (a malformed/older payload), never a fabricated "both" default.
          const verdicts = affordance.meta?.verdicts ?? [];
          // W6-B9 (reviewer finding on W6-B8) — Approve's gate is now
          // GENERIC, driven by the server-derived `affordance.meta.requires`
          // (studio/session-kinds.yaml's authored `requires:` list — e.g.
          // authoring's `awaiting-review` row declares `['id']`), never a
          // hardcoded "file-package needs an id" assumption. `providedFields`
          // is the panel's own (currently sole) source of collected extra
          // values — today only the package-id input below, mapped to the
          // field name `'id'`; a `requires` field this panel has no UI to
          // collect for simply never satisfies, honestly disabling Approve
          // rather than guessing. `packageArtifact`/`packageShape` are
          // computed once, outside this map, from `artifact.kind` — never
          // from `affordance` or `kind`.
          const requiresFields = affordance.meta?.requires ?? [];
          // W8-B3 (sessions-kinds-06/R01) — keyed on the phase row's OWN
          // authored `requires:` list, not on `artifact.kind === 'file-package'`.
          // The artifact kind was never the right source of truth for "does
          // this verdict need an id": `file-package` used to be deliberately
          // REUSED by the now-retired community-refresh kind (W8-B5b WI-3, a
          // registry.yaml + evidence draft that never contained a SKILL.md),
          // so keying off it rendered a "Skill id (directory name)" field on a
          // kind whose awaiting-review row asked for no id at all — and then
          // gated Approve on a shape that draft could never have. `requires:`
          // is the one wire signal the SERVER also enforces, so client and
          // server gate on the same fact regardless of which kind reuses
          // `file-package` next. ONE derivation, in lib/session-verdict-gate.ts
          // — see that module's header for why this is not four locals here
          // any more.
          const gate = deriveApproveGate({ requires: requiresFields, idValue: packageId, packageShape, busy });
          const idRequired = gate.idRequired;
          return (
            <div key={affordance.id} data-section="session-affordance" data-affordance-kind="verdict" style={sectionStyle}>
              {generations.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={labelStyle}>Generation to lock (optional — defaults to the latest)</div>
                  <select
                    value={pickedGeneration}
                    onChange={(e) => setPickedGeneration(e.target.value)}
                    data-field="session-generation-pick"
                    style={inputStyle}
                  >
                    <option value="">auto (latest — #{generations[0]})</option>
                    {generations.map((n) => (
                      <option key={n} value={n}>
                        generation #{n}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {idRequired && (
                <div style={{ marginBottom: 10 }}>
                  <div style={labelStyle}>{packageIdFieldLabel(packageShape)}</div>
                  <input
                    value={packageId}
                    onChange={(e) => setPackageId(e.target.value)}
                    placeholder="e.g. pr-diff-summary"
                    data-field="session-package-id"
                    style={inputStyle}
                  />
                  {gate.shapeBlocksApprove && (
                    <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 4 }}>
                      {shapeWaitingHint()}
                    </div>
                  )}
                </div>
              )}
              {/* W7-C2 (sessions-kinds-29) — the rationale field, one per
                  verdict affordance, sent as the OPTIONAL `notes` body field
                  with approve/reject/revise alike; the bridge appends it to
                  the session's verdicts.json and the transcript renders it
                  as an operator turn — a reject is never invisible in the
                  record again. */}
              <div style={{ marginBottom: 10 }}>
                <div style={labelStyle}>Notes (optional — recorded with your decision)</div>
                <textarea
                  value={notesText}
                  onChange={(e) => setNotesText(e.target.value)}
                  placeholder="Why?"
                  rows={2}
                  data-field="session-verdict-notes"
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>
              {gate.hint !== null && (
                <div data-requires-hint style={{ fontSize: 11.5, color: 'var(--dim)', margin: '0 0 8px' }}>
                  {gate.hint}
                </div>
              )}
              {error && <ErrorLine message={error} />}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {verdicts.includes('approve') && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    data-action="verdict-approve"
                    {...disabledAttrs(gate.disabledReason)}
                    onClick={() =>
                      void submit(affordance, {
                        verdict: 'approve',
                        ...(pickedGeneration ? { generation: Number(pickedGeneration) } : {}),
                        ...(notesText.trim().length > 0 ? { notes: notesText.trim() } : {}),
                        // Generic: every field the server's own meta.requires
                        // names rides along, sourced from the SAME
                        // `gate.providedFields` map the gate judged — never a
                        // per-kind {kind,id} literal, and never a second copy
                        // collected differently from the one that decided the
                        // button was clickable. `kind` itself is NOT sent at
                        // all (W6-B9): the write route derives it server-side
                        // from the REAL staged files, never a client guess.
                        ...gate.providedFields,
                      })
                    }
                    style={{ opacity: gate.disabledReason !== null ? 0.5 : 1 }}
                  >
                    {busy ? 'Working…' : 'Approve'}
                  </button>
                )}
                {/* W7-C2 (sessions-kinds-09/23, library-24, bead forge-4ei) —
                    the revise branch, rendered from the SAME server-derived
                    meta.verdicts list as its two siblings. First click opens
                    the feedback box; the send button posts {verdict:
                    'revise', feedback} — the write route requires non-empty
                    feedback, so the send stays disabled until there is
                    some. */}
                {verdicts.includes('revise') && (
                  <button
                    type="button"
                    className="btn"
                    data-action="verdict-revise"
                    disabled={busy}
                    onClick={() => setReviseOpen((open) => !open)}
                    style={{ opacity: busy ? 0.5 : 1 }}
                  >
                    Request changes
                  </button>
                )}
                {verdicts.includes('reject') && (
                  <button
                    type="button"
                    className="btn"
                    data-action="verdict-reject"
                    disabled={busy}
                    onClick={() => void submit(affordance, { verdict: 'reject', ...(notesText.trim().length > 0 ? { notes: notesText.trim() } : {}) })}
                    style={{ opacity: busy ? 0.5 : 1 }}
                  >
                    {busy ? 'Working…' : 'Reject'}
                  </button>
                )}
              </div>
              {verdicts.includes('revise') && reviseOpen && (
                <div data-section="session-revise" style={{ marginTop: 10 }}>
                  <div style={labelStyle}>What should change?</div>
                  <textarea
                    value={reviseFeedback}
                    onChange={(e) => setReviseFeedback(e.target.value)}
                    placeholder="Describe the changes to apply in the next draft…"
                    rows={3}
                    data-field="session-revise-feedback"
                    style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                  />
                  {/* W7-C3 merge: C2 added this CTA in parallel with the
                      disabled-reason convention, so it shipped with a bare
                      `disabled`. It has TWO disabling branches and one reason
                      must cover both -- the empty-feedback branch is the client
                      half of the server's own 400 ("feedback is required for
                      kind revise"), so it says the same thing. */}
                  <button
                    type="button"
                    className="btn btn-primary"
                    data-action="verdict-revise-send"
                    {...disabledAttrs(busy ? 'Submitting…' : reviseFeedback.trim().length === 0 ? 'Describe what should change first' : null)}
                    onClick={() =>
                      void submit(affordance, {
                        verdict: 'revise',
                        feedback: reviseFeedback.trim(),
                        ...(notesText.trim().length > 0 ? { notes: notesText.trim() } : {}),
                      })
                    }
                    style={{ opacity: busy || reviseFeedback.trim().length === 0 ? 0.5 : 1 }}
                  >
                    {busy ? 'Sending…' : 'Send for revision'}
                  </button>
                </div>
              )}
            </div>
          );
        }

        // Structurally unreachable TODAY — `renderableAffordances` is
        // already filtered to `RENDERABLE_AFFORDANCE_KINDS` (question-form/
        // verdict only; `staged-review`/`next-turn` never reach this map at
        // all any more, W6-B9 reviewer fix — see `isRenderableAffordance`'s
        // own doc comment for why hiding them entirely, not rendering a
        // disabled "not yet wired" placeholder, is the honest behaviour).
        // Kept as defense-in-depth against `RENDERABLE_AFFORDANCE_KINDS`
        // drifting ahead of the render branches above (a THIRD kind added
        // there with no matching `if` here) — fails honestly rather than
        // silently rendering nothing.
        return (
          <div key={affordance.id} data-section="session-affordance" data-affordance-kind={affordance.kind} style={sectionStyle}>
            <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>unrecognised affordance kind &quot;{affordance.kind}&quot;</div>
          </div>
        );
      })}
      {/* No `{drawer}` here (this branch: renderableAffordances.length > 0) —
          W6-B9's isRenderableAffordance filter (above) makes W6-B10's
          separate `showActivityLog` flag redundant, not just stale: a phase
          whose ENTIRE derived affordances[] is non-renderable (demo's
          `generating`, e.g. `[staged-review, next-turn]`) never reaches
          this branch at all — renderableAffordances is empty, so execution
          takes the EARLY RETURN above instead, where `{drawer}` (gated on
          `!terminal`, W6-B8) already renders it. This branch is only ever
          reached when at least one REAL actionable control exists, so a
          trailing unconditional `{drawer}` here would double-render the
          ActivityLog alongside a live verdict/question-form control — the
          exact double-render W6-B10 introduced `showActivityLog` to avoid,
          now achieved for free by the filter instead of a second flag. */}
    </div>
  );
}


/** W7-C2 (library-22) — a hand-mirrored copy of `SLUG_RE`
 *  (orchestrator/skill-path.ts), per this file set's no-cross-boundary-
 *  import convention. ADVISORY only (disable + hint); the write route's own
 *  check is the enforcement. */

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
    // wrote no pointer at all (instructions' AGENTS.md, demo's lock,
    // kb-cleanup's KB). Each names the object's own home page.
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
  // W7-C2 T1 review (P0-4) — `exists` is DERIVED server-side on every read
  // (cli/bridge-studio-sessions.ts's `finalizedObjectExists`). A pointer at
  // an object that has since been deleted or renamed renders the honest
  // record WITHOUT a link — this used to emit `/skills/<id>` with no
  // existence check at all, so a stale pointer left the operator a dead link
  // forever. An unrecognised kind takes the same no-link branch (never a
  // guessed href).
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

function ErrorLine({ message }: { message: string }): JSX.Element {
  return (
    <div data-affordance-error style={{ fontSize: 12.5, color: 'var(--red, #f87171)', margin: '6px 0' }}>
      {message}
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  border: '1px solid var(--line)', borderRadius: 10, padding: '14px 16px',
  background: 'var(--panel)', marginBottom: 10,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 600, color: 'var(--dim)', marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'var(--bg)',
  color: 'var(--text)',
  border: '1px solid var(--line)',
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 13,
};
