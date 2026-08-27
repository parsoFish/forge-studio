'use client';

/**
 * RunPanel — dispatch a non-interactive agent standalone (R2-01-F3) from the
 * agent page and poll its run for live status + cost (the F1 "events/cost
 * visible" AC). Interactive agents keep their bespoke session pages — the
 * generic host refuses them here, mirroring the server-side guard.
 *
 * Extracted from app/agents/[id]/page.tsx (D12 file-size split, R2-09) — a
 * pure move, no behaviour change. Every `data-*` attribute the agents
 * journey drives (`data-section="agent-run"`, `data-run-dispatchable`,
 * `data-run-id`, `data-run-status`, `data-run-cost`, `data-run-blocked`,
 * `data-run-inputs`, `data-action="run-agent"`,
 * `data-component="connection-run-block"`) stays byte-identical — a
 * contract other initiatives depend on.
 *
 * R6-04 WI-3 expands this panel IN PLACE: a project picker (was free text,
 * now a real `<select>` driven by the `projects` prop), a materials-attach
 * section driven by the agent's declared kinds, an editable cost-ceiling
 * input (disabled + explained when the agent's loop strategy can't enforce
 * one — `costCeilingEnforceable`, orchestrator/studio/derive.ts), and ONE
 * Run affordance for every agent shape: dispatch for a non-interactive
 * agent, or a real session-entry link (or an explicit no-entry-point state,
 * never a fabricated href) for an interactive one.
 *
 * R6-01 WI-4 adds one more read-only block to the SAME panel: the standing
 * triggers that already target this agent (`StandingTriggers.tsx`, fed by the
 * parent page's `GET /api/triggers` fetch) — provenance an operator needs
 * before deciding whether to dispatch by hand.
 *
 * The client-side materials/cost-ceiling gates
 * (`../../../lib/run-panel-view.ts`) are a CONVENIENCE MIRROR of the
 * server's own checks (cli/ui-bridge.ts) — the server remains the
 * authority and re-validates both regardless of what this component does.
 *
 * KNOWN GAP (documented, not closed here): this file cannot be exercised by
 * a simulated click/file-select/change event — no jsdom or
 * `@testing-library/react` is installed in this repo (see
 * `lib/run-panel-render.test.ts`'s header). The wiring below is therefore
 * verified by `tsc` + the pure-logic unit tests in `run-panel-view.test.ts`
 * only; a real-browser journey beat (a later work item) is what proves
 * clicking Run actually calls `dispatchAgentRun` with the chosen values.
 *
 * W6-B7 adds the shared `ActivityLog` bottom drawer, mounted once `runId` is
 * set. `runId` doubles as the run's cycle id (`cli/ui-bridge.ts` mints it
 * `_agent-<slug>-<stamp>` and logs straight into `_logs/<runId>/` — see the
 * `useCycleEvents` call site's own comment below), so no extra id derivation
 * is needed to wire the drawer's live event subscription.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import {
  dispatchAgentRun,
  parseRunInputs,
  fetchLatestStandaloneRun,
  cancelAgentRun,
  type MaterialUpload,
} from '@/lib/studio-client';
import { pollAgentRun, pollDisplayState, type PolledAgentRunStatus } from '@/lib/agent-dispatch';
import {
  validateMaterialsClientSide,
  resolveCostCeilingForDispatch,
  resolveCeilingFieldValue,
} from '@/lib/run-panel-view';
import { StandingTriggers } from './StandingTriggers';
import type { StandingTrigger } from '@/lib/standing-triggers';
import { ActivityLog } from '@/components/studio/ActivityLog';
import { useCycleEvents } from '@/lib/use-cycle-events';
import { disabledAttrs } from '@/lib/disabled-reason';
import { deriveRunGating, runStateOf } from '@/lib/run-panel-gating';

// W8-B1 (ON-8): the panel is PINNED to the top of its scrolling column.
// It renders first in `.col-right` (app/agents/[id]/page.tsx) and sticks
// there, so the one control this page exists for cannot be scrolled away
// behind the YAML preview and the readiness list. Same idiom as the
// GateBar's fixed verdict bar and DemoReviewSurface's sticky verdict form —
// the existing prior art for "a control that would otherwise sit arbitrarily
// far down normal flow", not a new pattern.
//
// W8-F4 (ON-8, hostile re-verification): the panel grows (project picker,
// ceiling, materials, standing triggers, a live run's log) — putting the
// scroll bound on this ROOT (the previous shape of this constant) meant the
// dispatch control rendered INSIDE the panel's own scroll region, reachable
// only by scrolling past four form blocks first. A `paddingTop: 4000`
// mutation into this object proved it: the button moved 4000px down and
// every gate stayed green, because "it scrolls internally and the button
// stays reachable" is reachable-BY-scrolling, the exact claim's own
// negation. The fix is a bounded flex COLUMN split into two children: this
// root only lays out and clips (`overflow: 'hidden'`, no padding of its
// own); `RUN_PANEL_BODY_STYLE` is the ONE scroll region, holding everything
// that can grow; `RUN_PANEL_ACTIONS_STYLE` is a non-shrinking footer row
// that holds the dispatch controls and never scrolls, so content growth can
// no longer move the control at all. See `lib/agent-run-reachable.test.ts`.
const RUN_PANEL_STYLE: CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  marginTop: 12,
  position: 'sticky',
  top: 0,
  zIndex: 30,
  background: 'var(--bg-2)',
  maxHeight: 'calc(100vh - 96px)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  // `.col-right` (app/globals.css) is itself a COLUMN FLEX container with
  // `overflow-y: auto`, so every child is `flex-shrink: 1` by default and a
  // tall sibling (the YAML preview) compresses this panel toward its
  // min-content height — which, with the body free to collapse to 0, is just
  // the actions row. Measured in the browser by the agents journey before this
  // line existed: the panel was crushed to ~57px, the actions row overflowed
  // its own clip box, and `elementFromPoint` at the button's centre landed on
  // something else — the button was CLIPPED, and Playwright's click on it did
  // nothing. `flexShrink: 0` makes the column scroll (which is what its
  // `overflow-y: auto` is for) instead of crushing the one control this page
  // exists for. Pinned by lib/agent-run-reachable.test.ts.
  flexShrink: 0,
};

/** The panel's ONE scroll region — every block that can grow (the form, the
 *  live run log, standing triggers) renders inside this, never the dispatch
 *  controls. Owns the padding `RUN_PANEL_STYLE` gave up (the root is now a
 *  pure layout box). See `RUN_PANEL_STYLE`'s comment for why this split
 *  exists. */
const RUN_PANEL_BODY_STYLE: CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  padding: '12px 14px',
};

/** The pinned, non-scrolling footer row: the dispatch/cancel buttons and the
 *  text explaining why they're disabled. `flex: '0 0 auto'` so a tall body
 *  can never shrink it away — the flex-layout mirror of "content growth
 *  cannot move the control" that `RUN_PANEL_BODY_STYLE` provides on the
 *  scroll axis. */
const RUN_PANEL_ACTIONS_STYLE: CSSProperties = {
  flex: '0 0 auto',
  borderTop: '1px solid var(--line)',
  padding: '12px 14px',
};

type Project = { id: string; name: string };

type Props = {
  slug: string;
  interactive: boolean;
  canRun: boolean;
  /** R3-04-F3/D9.3: non-empty iff a bound tool/mcp is not real probe-
   *  `available` — NAMES the unready component(s) and their state
   *  (`blockedRunMessage`, connection-library-view.ts). "Agent not ready"
   *  alone is a documented failure of this AC, so this string is rendered
   *  verbatim, never summarised away. */
  blockedMessage: string;
  /** The real managed-project list (GET /api/studio/projects), never a
   *  hardcoded set — drives the project `<select>`. */
  projects: Project[];
  /** This agent's declared upload kinds (capability.materials /
   *  AgentDefinition.materials, R2-09 D1-D4) — the materials-attach section
   *  offers exactly these, never the full MATERIAL_KINDS vocabulary. */
  declaredMaterialKinds: string[];
  /** GET /api/studio/agents' top-level `defaultCostCeilingUsd` sibling
   *  field (run-level policy, never a literal in this component). Seeds the
   *  editable ceiling input's initial value. */
  defaultCostCeilingUsd: number;
  /** orchestrator/studio/derive.ts `agentCapabilityDescriptor().costCeilingEnforceable`
   *  — server-computed, threaded through as-is. `false` disables the
   *  ceiling input rather than letting an operator submit a value the
   *  server will 400. */
  costCeilingEnforceable: boolean;
  /** The real route to this interactive agent's own session entry point,
   *  resolved by the parent page (see app/agents/[id]/page.tsx's
   *  `sessionEntryHrefForAgent` — not every interactive agent has one).
   *  `null`/absent renders the explicit no-entry-point state, never a
   *  fabricated link. */
  sessionEntryHref?: string | null;
  /** W7-B5 (agents-21): non-null iff this agent can NEVER be dispatched
   *  standalone (a ralph-loop agent — the bridge refuses the dispatch).
   *  Rendered verbatim, disables the Run control. */
  standaloneBlockedReason?: string | null;
  /** W7-B5 (agents-36): the unready bound-connection ids named inside
   *  `blockedMessage` — rendered as links to `/connections/<id>` so the
   *  operator can go fix them, instead of hunting for the route by hand. */
  unreadyConnectionIds?: string[];
  /** R6-01 WI-4: the FULL unfiltered `GET /api/triggers` roster, fetched by
   *  the parent page and threaded down whole — filtering to this agent
   *  happens in `StandingTriggers` itself, never at a call site.
   *
   *  Optional because the pinned `lib/run-panel-render.test.ts` constructs
   *  this component without it; absent renders the honest empty state rather
   *  than throwing. The real caller (app/agents/[id]/page.tsx) ALWAYS passes
   *  it — an absent prop here would silently understate an agent's wiring,
   *  so it must not become a normal way to mount this panel. */
  standingTriggers?: StandingTrigger[];
};

export function RunPanel({
  slug,
  interactive,
  canRun,
  blockedMessage,
  projects,
  declaredMaterialKinds,
  defaultCostCeilingUsd,
  costCeilingEnforceable,
  sessionEntryHref = null,
  standaloneBlockedReason = null,
  unreadyConnectionIds = [],
  standingTriggers = [],
}: Props) {
  const [project, setProject] = useState('');
  const [inputsText, setInputsText] = useState('');
  // R6-04 WI-3 round-2 fix (real defect a full-gate journey run found): do
  // NOT `useState(defaultCostCeilingUsd)` — that snapshots the prop's value
  // at first mount and never re-syncs once the parent page's async fetch
  // resolves it, so the field stayed stuck at the initial `0` forever and a
  // stale `0` reached the wire for every one-shot agent (the server
  // correctly 400s `v <= 0`). Instead: track ONLY whether the operator has
  // manually typed something (`undefined` until they do); the DISPLAYED
  // value is recomputed from the CURRENT `defaultCostCeilingUsd` prop on
  // every render via `resolveCeilingFieldValue` (lib/run-panel-view.ts),
  // unless a manual override is present, in which case it always wins —
  // even a manually-typed `0` (a legitimate FIELD value, independent of
  // `resolveCostCeilingForDispatch`'s separate refusal to DISPATCH `0`).
  const [manualCostCeiling, setManualCostCeiling] = useState<number | undefined>(undefined);
  const costCeiling = resolveCeilingFieldValue(defaultCostCeilingUsd, manualCostCeiling);
  const [materials, setMaterials] = useState<MaterialUpload[]>([]);
  const [materialsError, setMaterialsError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  // W7-D1: the ledger status a run id was REATTACHED from. Held so the panel
  // never has to GUESS a reattached run's state before the poll's first real
  // response — see `runStateOf` and this file's gating section below.
  const [reattachedStatus, setReattachedStatus] = useState<string | null>(null);
  const [status, setStatus] = useState<PolledAgentRunStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);
  // W7-D1: set the instant a dispatch claims this panel, so an in-flight
  // reattach fetch that resolves afterwards cannot adopt a stale historical
  // run over the run the operator just started.
  const dispatchedRef = useRef(false);
  const [pollNonce, setPollNonce] = useState(0);
  // W7-B5 (agents-30) cancel state. These live UP HERE with every other hook,
  // ABOVE the `if (interactive) return …` early return below — not next to
  // the `onCancel` handler that reads them, where they were first written.
  // `interactive` comes from an async fetch (`app/agents/[id]/page.tsx` reads
  // `state.capability?.interactive`), so it is `false` on the first render of
  // a mounted panel and can flip to `true` when the agent resolves or when
  // the operator picks a different agent. A hook below the early return means
  // that flip renders FEWER hooks than the previous render — React error #300,
  // which unmounts the whole builder page. Caught by the walkthrough gate on
  // `/agents/community-refresh` (an interactive agent, since retired,
  // W8-B5b WI-3), not by a unit test: the same rule `lib/use-cycle-events.ts`
  // cites for its own guard.
  const [cancelArmed, setCancelArmed] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);

  // W6-B14: reattach on mount — this panel only ever knew its dispatched
  // runId from its OWN `runId` state, so a nav-away-and-back (or a reload)
  // forgot it even while the standalone dispatch kept running server-side.
  // `GET /api/agents/:slug/history` (R6-06 WI-1) already joins every
  // execution path for this agent into one ledger; this reads back the most
  // recent STANDALONE row (a bare dispatch from THIS panel, never a
  // flow-node run) whose own status is still 'running' and resumes polling
  // it — never a guess: an idle mount with nothing active stays idle.
  useEffect(() => {
    if (runId) return;
    // W7-B5 (agents-02): an EMPTY slug is the not-yet-loaded builder mount —
    // never fire GET /api/agents//history for it (the bridge now 400s it).
    if (!slug) return;
    let cancelled = false;
    // W7-B5 (agents-26): reattaches to the latest standalone run of ANY
    // status (fetchLatestStandaloneRun no longer filters 'running'), so a
    // finished/failed run stays visible after a reload — its real terminal
    // state, cost and link — instead of vanishing. A still-running row
    // resumes polling exactly as before (the poll observes the live state).
    fetchLatestStandaloneRun(slug).then((row) => {
      if (cancelled || !row) return;
      // A real dispatch (onRun, below) may have already claimed this panel
      // while the fetch was in flight — never stomp it with a stale reattach.
      // W7-D1: the guard is a REF, not a functional `setRunId` update, because
      // the id and its status must be adopted together or not at all (a
      // `setState` inside another setter's updater is not allowed to be the
      // deciding read — the updater must stay pure).
      if (dispatchedRef.current) return;
      setRunId(row.id);
      // W7-D1: record the row's OWN status alongside the id. Without this the
      // panel fell through to "a runId with no status yet is still being
      // watched" and fabricated 'running' for a run the ledger had already
      // reported terminal — the lock that made an agent whose last run died
      // permanently un-runnable.
      setReattachedStatus(row.status);
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Poll the dispatched run's status until it leaves 'running' (done/failed/
  // suppressed) or the bounded ceiling trips — a run that dies without a
  // terminal marker, or a suppressed run that writes no events, must never
  // poll forever, and never silently freeze on a stale 'running' once the
  // ceiling is hit (agent-dispatch.ts's explicit 'timed-out' state).
  // `pollNonce` lets the "Re-check" button restart a bounded poll for the
  // SAME runId after a watch timeout, without needing runId itself to change.
  useEffect(() => {
    if (!runId) return;
    return pollAgentRun(runId, { onUpdate: setStatus });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, pollNonce]);

  // W6-B7: `runId` (minted `_agent-<slug>-<stamp>` — `cli/ui-bridge.ts`'s
  // `POST /api/agents/:slug/run`) IS the run's cycle id — `createLogger`
  // there writes straight to `_logs/<runId>/events.jsonl`, the exact path
  // `GET /api/events/<cycleId>` reads. So the shared live drawer just
  // subscribes to `runId` directly, no separate derivation needed. Called
  // unconditionally (hooks rule) with `''` before a run is dispatched — the
  // empty-cycleId fetch 404s and is caught silently (`use-cycle-events.ts`),
  // and no WS `event` message can ever carry `cycleId: ''`, so this is inert
  // until `runId` is actually set, at which point the effect's `[cycleId]`
  // dependency cleanly re-subscribes.
  const events = useCycleEvents(runId ?? '');

  // R6-01 WI-4: what already starts this agent WITHOUT an operator is a fact
  // about the agent, not about its dispatchability — so it renders on BOTH
  // branches below, including the interactive early return. (`reflector`,
  // the one agent a standing trigger targets today, declares `surface: both`
  // → `interactive: false`, so it takes the main branch; an interactive agent
  // must not lose the list to an early return regardless.)
  const standingTriggersList = <StandingTriggers agentSlug={slug} triggers={standingTriggers} />;

  if (interactive) {
    return (
      <section data-component="run-panel" data-section="agent-run" data-run-dispatchable="false" style={RUN_PANEL_STYLE}>
        <div data-run-panel-body style={RUN_PANEL_BODY_STYLE}>
          <h3 style={{ margin: '0 0 6px', fontSize: 13 }}>Run</h3>
          {sessionEntryHref ? (
            <Link data-action="go-to-session" href={sessionEntryHref} className="btn btn-primary">
              Go to session
            </Link>
          ) : (
            <p data-component="session-entry-missing" className="muted" style={{ fontSize: 12, margin: 0 }}>
              Interactive agent — no reachable session entry point yet.
            </p>
          )}
          {standingTriggersList}
        </div>
      </section>
    );
  }

  // W7-D1: ONE derivation for the run state and for everything gated on it —
  // `lib/run-panel-gating.ts`, exhaustively tested there because the defect it
  // fixes lived in effect-driven state that `renderToStaticMarkup` never runs.
  const runState = runStateOf({ status, runId, reattachedStatus });
  const runningNow = runState === 'running';
  // W6-B14: the shared three-state contract — `watching` before the poll's
  // first real response lands too (a dispatched runId with no status yet is
  // still "being watched", not idle), never fabricated once a real
  // done/failed/timed-out status is in hand.
  const pollState = pollDisplayState(status) ?? (runId ? 'watching' : null);
  // W7-B5 (agents-29) as AMENDED by W7-D1: the RUN CONTROL stays disabled
  // while a run we are actively observing is still running, so a double click
  // can never start two concurrent runs and orphan the first. The FORM does
  // not — editing the next run's project while one is in flight harms
  // nothing, and disabling it is what bricked the surface: a reattached run
  // that died without a terminal marker reports 'running' forever, and
  // `pollAgentRun`'s timeout keeps that last real state (adding only
  // `pollExhausted`), so the lock never lifted on its own.
  const gating = deriveRunGating({
    canRun,
    blockedMessage,
    standaloneBlockedReason,
    dispatching,
    runState,
    pollExhausted: status?.pollExhausted === true,
  });

  const onMaterialsChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setMaterialsError(null);
    if (files.length === 0) {
      setMaterials([]);
      return;
    }
    const check = validateMaterialsClientSide(
      files.map((f) => ({ filename: f.name, sizeBytes: f.size })),
      declaredMaterialKinds,
      slug,
    );
    if (!check.ok) {
      setMaterials([]);
      setMaterialsError(check.error);
      return;
    }
    const encoded = await Promise.all(files.map(async (f) => ({
      filename: f.name,
      contentBase64: await fileToBase64(f),
    })));
    setMaterials(encoded);
  };

  // W7-B5 (agents-30): cancel the live dispatched run — two-step confirm,
  // then POST /api/agents/runs/:runId/cancel and re-poll for the sticky
  // 'cancelled' terminal.
  const onCancel = async () => {
    if (!runId) return;
    if (!cancelArmed) {
      setCancelArmed(true);
      return;
    }
    setCancelBusy(true);
    setError(null);
    try {
      const r = await cancelAgentRun(runId);
      if (!r.ok) setError(r.error ?? 'cancel failed');
    } finally {
      setCancelBusy(false);
      setCancelArmed(false);
      setPollNonce((n) => n + 1);
    }
  };

  const onRun = async () => {
    setError(null);
    setDispatching(true);
    setStatus(null);
    // W7-D1: claim the panel BEFORE the POST, so a reattach fetch that
    // resolves mid-dispatch cannot adopt a stale historical run over this one.
    dispatchedRef.current = true;
    setReattachedStatus(null);
    try {
      const inputs = parseRunInputs(inputsText);
      const opts: {
        project?: string;
        inputs?: Record<string, string>;
        costCeilingUsd?: number;
        materials?: MaterialUpload[];
      } = {};
      if (project.trim()) opts.project = project.trim();
      if (Object.keys(inputs).length > 0) opts.inputs = inputs;
      const ceilingForDispatch = resolveCostCeilingForDispatch(costCeiling, costCeilingEnforceable);
      if (ceilingForDispatch !== undefined) opts.costCeilingUsd = ceilingForDispatch;
      if (materials.length > 0) opts.materials = materials;
      const r = await dispatchAgentRun(slug, Object.keys(opts).length ? opts : undefined);
      if (r.ok && r.runId) setRunId(r.runId);
      else setError(r.error ?? 'dispatch failed');
    } finally {
      setDispatching(false);
    }
  };

  return (
    <section
      data-component="run-panel"
      data-section="agent-run"
      data-run-dispatchable="true"
      data-run-id={runId ?? ''}
      data-run-status={runState}
      data-run-cost={status?.costUsd ?? 0}
      data-run-blocked={blockedMessage ? 'true' : 'false'}
      {...(pollState ? { 'data-poll-state': pollState } : {})}
      style={RUN_PANEL_STYLE}
    >
      <div data-run-panel-body style={RUN_PANEL_BODY_STYLE}>
        <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>Run</h3>

        <select
          className="input"
          data-run-project
          aria-label="Run against project"
          value={project}
          onChange={(e) => setProject(e.target.value)}
          {...disabledAttrs(gating.formDisabledReason, 'Run this agent against a managed project')}
          style={{ marginBottom: 8 }}
        >
          <option value="">no project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <textarea
          className="input"
          data-run-inputs
          aria-label="Run inputs (one per line, key: value)"
          rows={2}
          placeholder={'inputs (one per line: key: value)\ne.g. repo: ./projects/foo\nnorthStar: ship X'}
          value={inputsText}
          onChange={(e) => setInputsText(e.target.value)}
          {...disabledAttrs(gating.formDisabledReason, 'Inputs handed to this run')}
          style={{ marginBottom: 8, fontFamily: 'var(--mono, monospace)', fontSize: 12 }}
        />

        <div data-component="cost-ceiling" style={{ marginBottom: 8 }}>
          <label className="field-label" htmlFor="run-cost-ceiling" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
            Cost ceiling (USD)
          </label>
          <div data-ceiling-enforceable={costCeilingEnforceable ? 'true' : 'false'}>
            <input
              className="input"
              id="run-cost-ceiling"
              type="number"
              data-run-cost-ceiling
              min={0}
              step="0.01"
              value={costCeiling}
              {...disabledAttrs(
                !costCeilingEnforceable
                  ? "This agent's loop strategy can't enforce a per-run cost ceiling, so the field is disabled — submitting one would be refused by the server anyway."
                  : gating.formDisabledReason,
                'The cost ceiling this run will be dispatched with',
              )}
              onChange={(e) => setManualCostCeiling(Number(e.target.value))}
            />
            {!costCeilingEnforceable && (
              <p data-component="ceiling-explanation" className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
                This agent&apos;s loop strategy can&apos;t enforce a per-run cost ceiling, so the field is disabled —
                submitting one would be refused by the server anyway.
              </p>
            )}
          </div>
        </div>

        <section
          data-section="materials-attach"
          data-materials-declared={declaredMaterialKinds.join(',')}
          style={{ marginBottom: 8 }}
        >
          <label className="field-label" htmlFor="run-materials-input" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
            Attach materials{declaredMaterialKinds.length > 0 ? ` (${declaredMaterialKinds.join(', ')})` : ' (none declared)'}
          </label>
          <input
            type="file"
            id="run-materials-input"
            data-run-materials-input
            multiple
            onChange={(e) => void onMaterialsChange(e)}
            {...disabledAttrs(gating.formDisabledReason, 'Attach materials of the kinds this agent declares')}
          />
          {materialsError && (
            <p className="save-hint save-hint-dirty" style={{ fontSize: 11, margin: '4px 0 0' }}>{materialsError}</p>
          )}
        </section>

        {runId && (
          <div style={{ marginTop: 8, fontSize: 12 }}>
            {/* W7-B5 (agents-26): the runId LINKS to its run page — it used to
                be inert <code> text with no way through. */}
            <div>
              run{' '}
              <Link data-action="open-run" href={`/agents/${encodeURIComponent(slug)}/run/${encodeURIComponent(runId)}`}>
                <code>{runId}</code>
              </Link>
            </div>
            <div>
              status: <strong>{runState}</strong>
              {status ? ` · $${status.costUsd.toFixed(4)} · ${status.events} events` : ''}
              {status?.ok === false && status.error ? (
                <span data-run-read-error className="muted" style={{ marginLeft: 6 }}>· status read failed: {status.error}</span>
              ) : null}
              {pollState === 'timed-out' && (
                <>
                  <span className="muted" data-component="poll-exhausted-note" style={{ marginLeft: 6 }}>
                    · stopped watching — the run may still be going
                  </span>
                  <button
                    type="button"
                    data-action="re-check"
                    className="btn btn-sm"
                    style={{ marginLeft: 8 }}
                    onClick={() => setPollNonce((n) => n + 1)}
                  >
                    Re-check
                  </button>
                </>
              )}
            </div>
            {/* W7-B5 (agents-19): the failure reason, verbatim, right where
                the failed status is shown — never only the word "failed".
                Review round 1: suppressed on a CANCELLED run for the same
                reason RunView's banner is — a child killed by the cancel can
                write its own `agent-dispatch.failed` marker on the way out,
                and reporting that as this run's failure misdescribes an
                outcome the operator chose. */}
            {status?.errorText && status.state !== 'cancelled' && (
              <p data-component="run-error" className="save-hint save-hint-dirty" style={{ margin: '4px 0 0' }}>
                {status.errorText}
              </p>
            )}
          </div>
        )}

        {standingTriggersList}

        {/* W6-B7: the shared live thinking/working drawer — mounted only once
            a run actually exists (no cycle id to subscribe to before then). */}
        {runId && (
          <ActivityLog
            label={`agent run · ${slug}`}
            events={events}
            phaseLabel={runState}
            phaseActive={runState === 'running'}
            costUsd={status?.costUsd}
          />
        )}
      </div>

      <div data-run-panel-actions style={RUN_PANEL_ACTIONS_STYLE}>
        {/* W7-B5 (agents-21): the Run control STATES the ceiling that will be
            in force — an uncapped dispatch can no longer look identical to a
            capped one. */}
        <button
          className="btn btn-primary"
          data-action="run-agent"
          data-run-ceiling={resolveCostCeilingForDispatch(costCeiling, costCeilingEnforceable) ?? ''}
          onClick={() => void onRun()}
          {...disabledAttrs(gating.runDisabledReason, 'Dispatch this agent standalone')}
        >
          {dispatching
            ? 'Dispatching…'
            : (() => {
                const ceiling = resolveCostCeilingForDispatch(costCeiling, costCeilingEnforceable);
                return ceiling !== undefined ? `Run agent ($${ceiling} cap)` : 'Run agent (no cost cap)';
              })()}
        </button>
        {runningNow && runId && (
          <button
            type="button"
            className="btn"
            data-action="cancel-run"
            data-cancel-armed={cancelArmed ? 'true' : 'false'}
            disabled={cancelBusy}
            onClick={() => void onCancel()}
            style={{ marginLeft: 8 }}
          >
            {cancelBusy ? 'Cancelling…' : cancelArmed ? 'Confirm cancel' : 'Cancel run'}
          </button>
        )}
        {standaloneBlockedReason && (
          <p data-component="standalone-blocked" className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
            {standaloneBlockedReason}
          </p>
        )}
        {blockedMessage && (
          <p data-component="connection-run-block" className="save-hint save-hint-dirty" style={{ fontSize: 12, margin: '6px 0 0' }}>
            {blockedMessage}
          </p>
        )}
        {/* W7-B5 (agents-36): the named connections, linked — the message
            above stays verbatim (a pinned contract); these are the way to go
            FIX what it names. */}
        {blockedMessage && unreadyConnectionIds.length > 0 && (
          <p data-component="connection-run-block-links" style={{ fontSize: 12, margin: '4px 0 0' }}>
            Fix:{' '}
            {unreadyConnectionIds.map((id, i) => (
              <span key={id}>
                {i > 0 ? ' · ' : ''}
                <Link data-action="fix-connection" data-connection-id={id} href={`/connections/${encodeURIComponent(id)}`}>
                  {id}
                </Link>
              </span>
            ))}
          </p>
        )}
        {!blockedMessage && !canRun && <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>Save the agent to run it.</p>}
        {error && <p className="save-hint save-hint-dirty" style={{ marginTop: 6 }}>{error}</p>}
      </div>
    </section>
  );
}

/** Encode a browser `File` as base64 (the `POST /api/agents/:slug/run`
 *  `materials[].contentBase64` wire shape). Runs entirely client-side —
 *  never called during server rendering (only from the file-input's
 *  onChange handler above). */
async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
