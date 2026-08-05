'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { StudioArchitectShell } from '@/components/StudioArchitectShell';
import { useCycleEvents } from '@/lib/use-cycle-events';
import { useNowTicker } from '@/lib/use-now-ticker';
import { fetchSessionShell, type SessionShellFetchResult } from '@/lib/session-client';
import { deriveSessionShellViewState } from '@/lib/session-shell-view';
import {
  fetchArchitectSessions,
  listInstructionsSessions,
  fetchProjectBrainSessions,
  fetchStagedThemes,
  type ArchitectSessionSummary,
  type InstructionsSessionSummary,
  type ProjectBrainSession,
} from '@/lib/bridge-client';

import { SessionTranscript } from '@/components/studio/session/SessionTranscript';
import { SessionArtifactPane } from '@/components/studio/session/SessionArtifactPane';
import { SessionArchitectPanel } from '@/components/studio/session/SessionArchitectPanel';
import { SessionInstructionsPanel } from '@/components/studio/session/SessionInstructionsPanel';
import { SessionProjectBrainPanel } from '@/components/studio/session/SessionProjectBrainPanel';

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
 *     three retired pages. This is what still powers every LIVE operator
 *     affordance (question forms, briefing, verdict, theme review): the new
 *     read route's payload carries no `questions`/`draftUrl`/`staleMs`/
 *     `mode` — those fields live only on the older, richer summary shape,
 *     and every one of those affordances is a T2-mandated carry-over, wired
 *     to the SAME endpoints/clients as before, not reinvented here.
 *
 * `project` is required by `fetchSessionShell` but not by the per-kind list
 * endpoints (which return every session, `.project` included) — so `project`
 * is sourced from the per-kind summary once it resolves, falling back to an
 * optional `?project=` query param (the one piece of state project-brain's
 * retired page already read this way). If neither ever resolves (the
 * session-id genuinely doesn't exist for this kind), the page fails closed
 * to the same "session not found" state the shell route's own 404 produces
 * — never an infinite loading spinner.
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

  // ---- per-kind session summary (drives the live interactive panel) -------

  const [summary, setSummary] = useState<KindSummary | null>(null);
  const [summaryAttempted, setSummaryAttempted] = useState(false);
  const [themes, setThemes] = useState<Array<{ name: string; content: string }>>([]);

  const refreshSummary = useCallback(() => {
    const settle = (next: KindSummary | null) => {
      setSummary(next);
      setSummaryAttempted(true);
    };
    if (kind === 'architect') {
      fetchArchitectSessions()
        .then((list) => settle(toArchitectSummary(list.find((s) => s.sessionId === sessionId) ?? null)))
        .catch(() => setSummaryAttempted(true));
    } else if (kind === 'instructions') {
      listInstructionsSessions()
        .then((list) => settle(toInstructionsSummary(list.find((s) => s.sessionId === sessionId) ?? null)))
        .catch(() => setSummaryAttempted(true));
    } else if (kind === 'project-brain') {
      fetchProjectBrainSessions()
        .then((list) => settle(toProjectBrainSummary(list.find((s) => s.session_id === sessionId) ?? null)))
        .catch(() => setSummaryAttempted(true));
    } else {
      setSummaryAttempted(true); // an unrecognised kind — nothing to fetch here; the shell route's own 404 carries the page
    }
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

  const project = summary?.data.project ?? queryProject ?? null;

  // ---- session-shell read route (drives the transcript + artifact panes) --

  const [shellResult, setShellResult] = useState<SessionShellFetchResult | null>(null);
  const refreshShell = useCallback(() => {
    if (!project) return;
    void fetchSessionShell(kind, sessionId, project).then(setShellResult);
  }, [kind, sessionId, project]);

  useEffect(() => {
    if (!project) return;
    refreshShell();
    const poll = setInterval(refreshShell, SHELL_POLL_MS);
    return () => clearInterval(poll);
  }, [project, refreshShell]);

  const viewState = useMemo(() => deriveSessionShellViewState(shellResult), [shellResult]);

  // Fail-closed: no session found in the per-kind list AND no ?project= to
  // even attempt the shell route — never leave the page spinning forever.
  const noProjectKnown = project === null && summaryAttempted;

  // ---- live events (StageHex burst chips + activity log; architect/instructions) --

  const cycleId = `_${kind}-${sessionId}`;
  const nowMs = useNowTicker();
  const listChangedType = LIST_CHANGED_MESSAGE_TYPE[kind];
  const events = useCycleEvents(cycleId, (msg) => {
    if (listChangedType && msg.type === listChangedType) refreshSummary();
  });

  const ready = viewState.status !== 'loading' || noProjectKnown;

  return (
    <StudioArchitectShell
      dataPage="session"
      ready={ready}
      title={viewState.status === 'ready' ? viewState.title ?? kind : kind}
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
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 24, alignItems: 'start' }}>
          <SessionTranscript turns={viewState.turnsForStage} emptyMessage={viewState.emptyStageMessage}>
            {summary && summary.kind === 'architect' ? (
              <SessionArchitectPanel session={summary.data} events={events} nowMs={nowMs} />
            ) : summary && summary.kind === 'instructions' ? (
              <SessionInstructionsPanel session={summary.data} events={events} nowMs={nowMs} onRefresh={refreshSummary} />
            ) : summary && summary.kind === 'project-brain' ? (
              <SessionProjectBrainPanel session={summary.data} themes={themes} onRefresh={refreshSummary} />
            ) : null}
          </SessionTranscript>
          <SessionArtifactPane artifact={viewState.artifact} />
        </div>
      ) : viewState.status === 'error' ? (
        <div data-section="session-error" style={{ fontSize: 13, color: '#f85149' }}>
          {viewState.error}
        </div>
      ) : viewState.status === 'no-session' || noProjectKnown ? (
        <div style={{ color: 'var(--dim)', fontSize: 13 }}>
          Session not found (it may still be starting, or has been committed/rejected/abandoned).{' '}
          <Link href="/" style={{ color: 'var(--ember)' }}>
            Back to Forge Studio
          </Link>
          .
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
};

type KindSummary =
  | { kind: 'architect'; data: ArchitectSessionSummary }
  | { kind: 'instructions'; data: InstructionsSessionSummary }
  | { kind: 'project-brain'; data: ProjectBrainSession };

function toArchitectSummary(data: ArchitectSessionSummary | null): KindSummary | null {
  return data ? { kind: 'architect', data } : null;
}
function toInstructionsSummary(data: InstructionsSessionSummary | null): KindSummary | null {
  return data ? { kind: 'instructions', data } : null;
}
function toProjectBrainSummary(data: ProjectBrainSession | null): KindSummary | null {
  return data ? { kind: 'project-brain', data } : null;
}

/** `StudioArchitectShell.mainData` is `Record<string,string>` — `dataAttrs`
 *  (lib/session-shell-view.ts) carries string|number|boolean values, so every
 *  value is stringified at this one boundary rather than loosening the
 *  shell's prop type. */
function toStringDataAttrs(attrs: Record<string, string | number | boolean>): Record<string, string> {
  return Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, String(v)]));
}
