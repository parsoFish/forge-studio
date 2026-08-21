'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { StudioArchitectShell } from '@/components/StudioArchitectShell';
import { NotFound } from '@/components/NotFound';
import { FetchErrorState } from '@/components/FetchErrorState';
import { useCycleEvents } from '@/lib/use-cycle-events';
import { useNowTicker } from '@/lib/use-now-ticker';
import { fetchSessionShell, type SessionShellFetchResult } from '@/lib/session-client';
import { deriveSessionShellViewState, selectStage, backToProjectLink } from '@/lib/session-shell-view';
import {
  fetchArchitectSessions,
  listInstructionsSessions,
  fetchProjectBrainSessions,
  fetchStagedThemes,
  listDemoSessions,
  demoBuilderLock,
  type ArchitectSessionSummary,
  type InstructionsSessionSummary,
  type ProjectBrainSession,
  type DemoSessionSummary,
} from '@/lib/bridge-client';

import { SessionTranscript } from '@/components/studio/session/SessionTranscript';
import { SessionArtifactPane } from '@/components/studio/session/SessionArtifactPane';
import { SessionArchitectPanel } from '@/components/studio/session/SessionArchitectPanel';
import { SessionProjectBrainPanel } from '@/components/studio/session/SessionProjectBrainPanel';
import { SessionInteractivePanel } from '@/components/studio/session/SessionInteractivePanel';
import { SessionLifecycleBar } from '@/components/studio/session/SessionLifecycleBar';
import { StageSelector } from '@/components/studio/session/StageSelector';
import type { CancelOutcome } from '@/lib/session-lifecycle-client';

/** W6-B6 wired `demo`/`onboarding` onto the GENERIC interaction panel; W6-B8
 *  added `kb-cleanup`/`authoring`; W6-B9 adds `instructions`, deleting its
 *  bespoke `SessionInstructionsPanel` (no dual paths) — architect is now the
 *  ONLY kind left on its own panel, permanently (ADR-043 amendment §4: its
 *  branching council/interview control flow has no linear phase-table seam
 *  a generic ladder could express). */
/** W7-B3 (sessions-kinds-06 / community-14): community-refresh joined — its
 *  approve/reject verdict (studio/session-kinds.yaml `awaiting-review` row)
 *  was unreachable with NO panel at all. Parity with the registry is pinned
 *  by lib/generic-panel-kinds.test.ts: every turnSpec-declared kind must be
 *  here, so the next declared kind can never render a blank page. */
const GENERIC_PANEL_KINDS: ReadonlySet<string> = new Set(['demo', 'onboarding', 'kb-cleanup', 'authoring', 'instructions', 'community-refresh']);

/**
 * The shared interactive-session shell (R2-10 PR2, WI-7). Replaces
 * `/architect/[sessionId]/interview`, `/instructions/[sessionId]`, and
 * `/project-brain/[sessionId]` with ONE route generic over whatever kind is
 * declared in `studio/session-kinds.yaml` — chat transcript LEFT, the living
 * artifact RIGHT, this page-shell header above (mockups/studio-endstate-v2/
 * views-session.jsx).
 *
 * Two independent data sources are polled:
 *   - `fetchSessionShell` (lib/session-client.ts) — the new, read-only
 *     `GET /api/studio/sessions/:kind/:sessionId?project=` route. Derives the
 *     transcript (`turns`) and the living `artifact` for the two panes, via
 *     the pure `deriveSessionShellViewState` (lib/session-shell-view.ts).
 *   - the PRE-EXISTING per-kind session-summary endpoint
 *     (fetchArchitectSessions / listInstructionsSessions /
 *     fetchProjectBrainSessions[+fetchStagedThemes]) — unchanged from the
 *     three retired pages. Still powers architect's and project-brain's own
 *     bespoke panels (question forms, briefing, verdict, theme review — the
 *     new read route's payload carries no `questions`/`draftUrl`/`staleMs`/
 *     `mode`, fields that live only on this older, richer summary shape).
 *     W6-B9: instructions keeps ITS branch here too, but ONLY to resolve
 *     `project` for a deep link that omits `?project=` (mirrors the W6-B6
 *     demo fix, below) — every instructions affordance now renders from the
 *     generic `SessionInteractivePanel` instead.
 *
 * `project` (W7-A2): the shell route no longer REQUIRES it — the page hands
 * it whatever hint it has (the per-kind summary's `.project`, else the
 * optional `?project=` query param) and otherwise omits it; the bridge
 * resolves the anchor project server-side (`findSessionProject`,
 * cli/bridge-studio-sessions.ts) and echoes it on the payload, so a bare
 * `/sessions/<kind>/<sid>` deep link is a working address for every kind.
 * "Session not found" is ONLY the shell route's own 404 — never a missing
 * query param, never an infinite loading spinner.
 *
 * The page-chrome `title` (the breadcrumb + heading `StudioArchitectShell`
 * renders) is sourced from the shell route's `title` field — the session-kind
 * descriptor's declared `title` (studio/session-kinds.yaml), threaded
 * verbatim (R2-10 PR2, WI-8; mirrors how `artifact.label` already flowed).
 * Previously this page hardcoded its own local kind→title map — declared
 * data with no consumer, the same drift class the `artifact.label` fix
 * closed. While the shell route hasn't resolved yet (loading/error/no-
 * session), there is no wire `title` to show, so the raw `kind` slug is
 * shown instead — self-healing the instant the fetch settles, never a
 * fabricated or stale-cached label.
 */
export default function SessionShellPage({
  params,
}: {
  params: { kind: string; sessionId: string };
}): JSX.Element {
  const kind = decodeURIComponent(params.kind);
  const sessionId = decodeURIComponent(params.sessionId);
  const queryProject = useSearchParams().get('project');
  const router = useRouter();

  // ---- per-kind session summary (drives the live interactive panel) -------

  const [summary, setSummary] = useState<KindSummary | null>(null);
  const [themes, setThemes] = useState<Array<{ name: string; content: string }>>([]);

  const refreshSummary = useCallback(() => {
    const settle = (next: KindSummary | null) => {
      setSummary(next);
    };
    if (kind === 'architect') {
      fetchArchitectSessions()
        .then((list) => settle(toArchitectSummary(list.find((s) => s.sessionId === sessionId) ?? null)))
        .catch(() => {});
    } else if (kind === 'instructions') {
      listInstructionsSessions()
        .then((list) => settle(toInstructionsSummary(list.find((s) => s.sessionId === sessionId) ?? null)))
        .catch(() => {});
    } else if (kind === 'project-brain') {
      fetchProjectBrainSessions()
        .then((list) => settle(toProjectBrainSummary(list.find((s) => s.session_id === sessionId) ?? null)))
        .catch(() => {});
    } else if (kind === 'demo') {
      // W6-B6 fix (the demo "Session not found" bug) — `demo` had NO branch
      // here at all, unlike architect/instructions/project-brain: it fell
      // into the generic `else` below, which only ever calls
      // `setSummaryAttempted(true)` and NEVER resolves `summary`, so `project`
      // (derived below as `summary?.data.project ?? queryProject ?? null`)
      // permanently depended on a `?project=` query param being present in
      // the URL with no fallback — any deep link or navigation that omitted
      // it (this batch's own kickoff `Start` button included) left `project`
      // stuck at `null` forever, tripping `noProjectKnown` and showing
      // "Session not found" even though `listDemoSessions()` — the SAME
      // per-kind list endpoint `DemoBuilderPanel`/the legacy `/demo/[sid]`
      // redirect already use — can resolve it, exactly like the three kinds
      // above.
      listDemoSessions()
        .then((list) => settle(toDemoSummary(list.find((s) => s.sessionId === sessionId) ?? null)))
        .catch(() => {});
    }
    // Every other kind (kb-cleanup / authoring / community-refresh /
    // onboarding) has no per-kind list route — the shell route alone carries
    // the page, resolving the project itself (W7-A2).
  }, [kind, sessionId]);

  useEffect(() => {
    refreshSummary();
    const poll = setInterval(refreshSummary, SUMMARY_POLL_MS);
    return () => clearInterval(poll);
  }, [refreshSummary]);

  // project-brain's staged-theme review — fetched only while awaiting-review,
  // mirroring the retired page exactly.
  useEffect(() => {
    if (!(summary?.kind === 'project-brain' && summary.data.phase === 'awaiting-review')) {
      setThemes([]);
      return;
    }
    let cancelled = false;
    fetchStagedThemes(summary.data.project, sessionId)
      .then((t) => {
        if (!cancelled) setThemes(t);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [summary, sessionId]);

  // ---- session-shell read route (drives the transcript + artifact panes) --

  // W7-A2 (community-06, knowledge-18, sessions-kinds-20) — the shell route
  // is fetched WITHOUT `?project=` when neither the per-kind summary nor the
  // URL knows it: the bridge resolves the anchor project server-side
  // (`findSessionProject`) and echoes it back on the payload, so a bare
  // `/sessions/<kind>/<sid>` deep link is a working address for EVERY kind
  // (kb-cleanup / authoring / community-refresh / onboarding included —
  // none of which has a per-kind list branch above, and whose anchor is a
  // pseudo-project no operator would guess). "Session not found" is now
  // ONLY the shell route's own 404, never a missing query param.
  const [shellResult, setShellResult] = useState<SessionShellFetchResult | null>(null);
  // W7A2-02 — the last cancel's real outcome; the bar keeps showing it once
  // the shell has refetched to terminal (the cancel button is gone by then).
  const [lastCancel, setLastCancel] = useState<CancelOutcome | null>(null);
  const shellProject = shellResult?.ok ? shellResult.payload.project : null;
  const project = summary?.data.project ?? queryProject ?? shellProject;
  const projectHint = summary?.data.project ?? queryProject ?? null;
  const refreshShell = useCallback(() => {
    void fetchSessionShell(kind, sessionId, projectHint).then(setShellResult);
  }, [kind, sessionId, projectHint]);

  useEffect(() => {
    refreshShell();
    const poll = setInterval(refreshShell, SHELL_POLL_MS);
    return () => clearInterval(poll);
  }, [refreshShell]);

  // W7-B5 (sessions-kinds-34): the operator's stage choice — applied over
  // the freshly-derived shell state via the pure `selectStage` (which
  // refuses a stage outside the session's declared set; a refusal falls
  // back to the derived default rather than fabricating a stage).
  const [stageOverride, setStageOverride] = useState<string | null>(null);
  // A different session must never inherit the previous one's stage choice.
  useEffect(() => { setStageOverride(null); }, [kind, sessionId]);
  const viewState = useMemo(() => {
    const base = deriveSessionShellViewState(shellResult);
    if (base.status === 'ready' && stageOverride !== null && stageOverride !== base.selectedStage) {
      const switched = selectStage(base, stageOverride);
      if (switched.ok) return switched.state;
    }
    return base;
  }, [shellResult, stageOverride]);

  // W7-B1 (sessions-kinds-07) — the artifact pane is wired for real on this
  // page now: `project`/`sessionId` thread through (generation "view →"
  // links need both), and a DEMO session that is still live gets a working
  // finalize — the SAME `demoBuilderLock` POST the project-page panel uses,
  // then a shell+summary refetch so the locked state lands. A failed lock
  // surfaces its error here (`data-section="finalize-error"`), never a
  // silently-swallowed click. Terminal (already locked/abandoned) sessions
  // keep the control disabled — the pane's own honest absent-handler state.
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const canFinalizeDemo = kind === 'demo' && project !== null && viewState.status === 'ready' && !viewState.terminal;
  const onFinalizeGeneration = canFinalizeDemo
    ? (generationNumber: number) => {
        setFinalizeError(null);
        void demoBuilderLock({ project: project as string, sessionId, generation: generationNumber })
          .then((r) => {
            if (!r.ok) setFinalizeError(r.error ?? 'failed to finalize this generation');
            refreshShell();
            refreshSummary();
          })
          .catch((err) => {
            setFinalizeError(err instanceof Error ? err.message : String(err));
          });
      }
    : undefined;



  // ---- live events (StageHex burst chips + activity log; architect/instructions) --

  const cycleId = `_${kind}-${sessionId}`;
  const nowMs = useNowTicker();
  const listChangedType = LIST_CHANGED_MESSAGE_TYPE[kind];
  const events = useCycleEvents(cycleId, (msg) => {
    if (listChangedType && msg.type === listChangedType) refreshSummary();
  });

  const ready = viewState.status !== 'loading';

  // W6-B9 reviewer fix — computed ONCE, pure (lib/session-shell-view.ts),
  // never re-derived inline in the JSX below: null for a non-terminal
  // session, one with no project known, OR a pseudo-project anchor with no
  // recognised destination (an unbound kb-cleanup/community-refresh session
  // anchored under ".kb-<id>"/".community-registry" is never a REAL
  // registered project — /projects/<that> would be a dead end).
  // W7-A2 (sessions-kinds-35): rendered in EVERY phase now (backToProjectLink
  // no longer gates on `terminal`) — the operator most needs a way out of a
  // session they are actively working on; a `.kb-<id>` anchor resolves to
  // that KB's own page, the community anchor to /community.
  const backTo = viewState.status === 'ready' ? backToProjectLink(project) : null;

  // W7-A4 (sessions-kinds-18 / crosscut-27): the two "nothing here" facts are
  // two honest answers through the ONE shared NotFound — and the page's DOM
  // state can no longer read "loading" while the body says "not found".
  //   - an unknown KIND: the shell route 404s with `unknown session kind …`
  //     (it resolves kinds against the live registry — there is deliberately
  //     no client-side kind list to mirror, so the server's own message is the
  //     discriminator here);
  //   - an unknown ID: the shell route's own 404 (W7-A2: the bridge resolves
  //     the anchor project server-side via `findSessionProject` and 404s when
  //     it can't — there is no longer a separate client-side "no project
  //     known" outcome to check; a `ready` viewState always carries a project).
  if (viewState.status === 'no-session' && /unknown session kind/i.test(viewState.error ?? '')) {
    return <NotFound kind="session kind" id={kind} backHref="/sessions" backLabel="Sessions" detail={viewState.error} />;
  }
  if (viewState.status === 'no-session') {
    return (
      <NotFound
        kind={`${kind} session`}
        id={sessionId}
        backHref="/sessions"
        backLabel="Sessions"
        detail="It may still be starting, or has been committed, rejected or abandoned."
      />
    );
  }

  return (
    <StudioArchitectShell
      dataPage="session"
      ready={ready}
      title={viewState.status === 'ready' ? viewState.title : kind}
      idLabel={sessionId}
      maxWidth={1320}
      mainData={{
        'data-session-kind': kind,
        'data-session-id': sessionId,
        'data-session-phase': viewState.status === 'ready' ? viewState.phase : '',
        'data-session-stage': viewState.status === 'ready' ? viewState.selectedStage : '',
        ...toStringDataAttrs(viewState.dataAttrs),
        ...(viewState.status === 'error'
          ? { 'data-session-error': 'true', 'data-session-error-kind': viewState.errorKind }
          : {}),
      }}
    >
      {viewState.status === 'ready' ? (
        <div>
          {/* W6-B9 — a GENERIC "back to project" link for every kind, rendered
              from the shell itself (never a per-panel one-off): whenever a
              session has settled (`viewState.terminal`, the SAME server-derived
              fact SessionInteractivePanel already gates its ActivityLog drawer
              on) AND `project` resolves to a REAL destination (`backTo`,
              above — never rendered for a pseudo-project anchor with no
              recognised kind, W6-B9 reviewer fix), there is nothing left for
              the operator to do here — closes the gap instructions' retired
              bespoke panel used to close ONLY for itself (its own
              committed/rejected states' `data-action="back-to-project"`
              link), now true for demo/onboarding/kb-cleanup/authoring/
              instructions alike. architect and project-brain keep their own
              additional bespoke nav (unaffected, unremoved) — this is purely
              additive. */}
          {backTo && (
            <Link
              href={backTo.href}
              data-action="back-to-project"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--dim)', textDecoration: 'none', marginBottom: 12 }}
            >
              ← Back to {backTo.label}
            </Link>
          )}
          {/* W7-A2 — the lifecycle banner for EVERY kind (architect and
              project-brain included, and kinds with no generic panel):
              crashed → the runner's error verbatim; stalled → the silence;
              terminal → honest per-phase copy; plus the ONE cancel control
              (`data-action="cancel"`) whenever the bridge says cancellable.
              Rendered from the shell payload's server-derived `lifecycle`,
              never re-derived here. */}
          <SessionLifecycleBar
            lifecycle={viewState.lifecycle}
            phase={viewState.phase}
            kind={kind}
            sessionId={sessionId}
            project={project}
            lastCancel={lastCancel}
            onCancelled={(outcome) => { setLastCancel(outcome); refreshShell(); refreshSummary(); }}
          />
          {/* W7-B5 (sessions-kinds-34): the stage selector the DOM contract
              always advertised (`data-session-selector-visible`) — rendered
              whenever the session declares more than one stage, switching
              the transcript AND the artifact pane below via selectStage. */}
          {viewState.stageSelectorVisible && (
            <StageSelector
              stages={viewState.stages}
              selectedStage={viewState.selectedStage}
              onSelect={setStageOverride}
            />
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 24, alignItems: 'start' }}>
            <SessionTranscript turns={viewState.turnsForStage} emptyMessage={viewState.emptyStageMessage}>
              {summary && summary.kind === 'architect' ? (
                <SessionArchitectPanel session={summary.data} events={events} nowMs={nowMs} />
              ) : summary && summary.kind === 'project-brain' ? (
                <SessionProjectBrainPanel session={summary.data} themes={themes} onRefresh={refreshSummary} />
              ) : GENERIC_PANEL_KINDS.has(kind) ? (
                <SessionInteractivePanel
                  kind={kind}
                  sessionId={sessionId}
                  project={project}
                  phase={viewState.phase}
                  affordances={viewState.affordances}
                  artifact={viewState.artifact}
                  modelTier={viewState.modelTier}
                  events={events}
                  terminal={viewState.terminal}
                  lifecycle={viewState.lifecycle}
                  finalized={viewState.finalized}
                  onChanged={refreshShell}
                  onPackageFinalized={(pkgKind, id) => router.push(pkgKind === 'hook' ? `/hooks/${encodeURIComponent(id)}` : `/skills/${encodeURIComponent(id)}`)}
                />
              ) : null}
            </SessionTranscript>
            <div>
              {finalizeError && (
                <div data-section="finalize-error" style={{ marginBottom: 10, fontSize: 12.5, color: 'var(--red, #f87171)' }}>
                  {finalizeError}
                </div>
              )}
              {/* W7-B1 (sessions-kinds-07): project/sessionId/finalize
                  threaded — see the handler above.
                  W7-C2 (sessions-kinds-30): the instructions summary already
                  carries the verdict context (where approve writes + the
                  current file's content, edit mode) — thread it so the
                  AGENTS.md draft pane can name its destination and offer a
                  diff. Undefined for every other kind. */}
              <SessionArtifactPane
                artifact={viewState.artifact}
                activeStage={viewState.selectedStage}
                project={project ?? undefined}
                sessionId={sessionId}
                onFinalizeGeneration={onFinalizeGeneration}
                draftContext={
                  summary?.kind === 'instructions'
                    ? {
                        targetPath: `${summary.data.projectRepoPath}/${summary.data.currentInstructionsFile ?? 'AGENTS.md'}`,
                        current: summary.data.currentInstructions,
                      }
                    : undefined
                }
              />
            </div>
          </div>
        </div>
      ) : viewState.status === 'error' ? (
        // W7-A1 (crosscut-09): the shared failure state instead of a bare
        // "TypeError: Failed to fetch" body — framed by WHETHER the bridge was
        // reached (network-error / no-bridge = unreachable; bad-request /
        // stage-conflict / server-error / non-json / malformed = it answered),
        // with the server's own message verbatim and a Retry that re-runs the
        // shell read (the SHELL_POLL_MS poll keeps retrying on its own too).
        <div data-section="session-error">
          <FetchErrorState
            what="this session"
            error={viewState.error}
            reachable={viewState.errorKind !== 'network-error' && viewState.errorKind !== 'no-bridge'}
            onRetry={refreshShell}
          />
        </div>
      ) : (
        <div style={{ color: 'var(--dim)', fontSize: 13 }}>Loading session…</div>
      )}
    </StudioArchitectShell>
  );
}

// ---------------------------------------------------------------------------
// Constants + small local helpers
// ---------------------------------------------------------------------------

const SHELL_POLL_MS = 3000;
const SUMMARY_POLL_MS = 3000;

/** Which live bridge-socket message signals "refetch the per-kind list" for
 *  a given kind — mirrors the retired architect/instructions pages'
 *  `useCycleEvents` `onSignal` wiring. project-brain never had one (it relied
 *  purely on its own poll), so it has no entry here. */
const LIST_CHANGED_MESSAGE_TYPE: Record<string, string> = {
  architect: 'architect-list-changed',
  instructions: 'instructions-list-changed',
  demo: 'demo-list-changed',
};

type KindSummary =
  | { kind: 'architect'; data: ArchitectSessionSummary }
  | { kind: 'instructions'; data: InstructionsSessionSummary }
  | { kind: 'project-brain'; data: ProjectBrainSession }
  | { kind: 'demo'; data: DemoSessionSummary };

function toArchitectSummary(data: ArchitectSessionSummary | null): KindSummary | null {
  return data ? { kind: 'architect', data } : null;
}
function toInstructionsSummary(data: InstructionsSessionSummary | null): KindSummary | null {
  return data ? { kind: 'instructions', data } : null;
}
function toProjectBrainSummary(data: ProjectBrainSession | null): KindSummary | null {
  return data ? { kind: 'project-brain', data } : null;
}
function toDemoSummary(data: DemoSessionSummary | null): KindSummary | null {
  return data ? { kind: 'demo', data } : null;
}

/** `StudioArchitectShell.mainData` is `Record<string,string>` — `dataAttrs`
 *  (lib/session-shell-view.ts) carries string|number|boolean values, so every
 *  value is stringified at this one boundary rather than loosening the
 *  shell's prop type. */
function toStringDataAttrs(attrs: Record<string, string | number | boolean>): Record<string, string> {
  return Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, String(v)]));
}
