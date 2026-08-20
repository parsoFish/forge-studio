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

import { useEffect, useState, type CSSProperties } from 'react';
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

const RUN_PANEL_STYLE: CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  padding: '12px 14px',
  marginTop: 12,
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
  const [status, setStatus] = useState<PolledAgentRunStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [pollNonce, setPollNonce] = useState(0);

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
      // Functional update, not a bare setRunId(row.id): a real dispatch
      // (onRun, below) may have already set a FRESH runId while this fetch
      // was in flight — never stomp it with a stale reattach result.
      setRunId((current) => current ?? row.id);
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
      </section>
    );
  }

  const runState = status?.state ?? (runId ? 'running' : 'idle');
  const runningNow = runState === 'running';
  // W6-B14: the shared three-state contract — `watching` before the poll's
  // first real response lands too (a dispatched runId with no status yet is
  // still "being watched", not idle), never fabricated once a real
  // done/failed/timed-out status is in hand.
  const pollState = pollDisplayState(status) ?? (runId ? 'watching' : null);
  const effectiveCanRun = canRun && !blockedMessage && !standaloneBlockedReason;
  // W7-B5 (agents-29): the Run control stays disabled while the DISPATCHED
  // run itself is still running — not just during the POST — so a double
  // click can never start two concurrent runs and orphan the first.
  const controlsDisabled = !effectiveCanRun || dispatching || runningNow;

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

  const [cancelArmed, setCancelArmed] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
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
      <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>Run</h3>

      <select
        className="input"
        data-run-project
        value={project}
        onChange={(e) => setProject(e.target.value)}
        disabled={controlsDisabled}
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
        rows={2}
        placeholder={'inputs (one per line: key: value)\ne.g. repo: ./projects/foo\nnorthStar: ship X'}
        value={inputsText}
        onChange={(e) => setInputsText(e.target.value)}
        disabled={controlsDisabled}
        style={{ marginBottom: 8, fontFamily: 'var(--mono, monospace)', fontSize: 12 }}
      />

      <div data-component="cost-ceiling" style={{ marginBottom: 8 }}>
        <label className="field-label" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
          Cost ceiling (USD)
        </label>
        <div data-ceiling-enforceable={costCeilingEnforceable ? 'true' : 'false'}>
          <input
            className="input"
            type="number"
            data-run-cost-ceiling
            min={0}
            step="0.01"
            value={costCeiling}
            onChange={(e) => setManualCostCeiling(Number(e.target.value))}
            disabled={!costCeilingEnforceable || controlsDisabled}
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
        <label className="field-label" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
          Attach materials{declaredMaterialKinds.length > 0 ? ` (${declaredMaterialKinds.join(', ')})` : ' (none declared)'}
        </label>
        <input
          type="file"
          data-run-materials-input
          multiple
          onChange={(e) => void onMaterialsChange(e)}
          disabled={controlsDisabled}
        />
        {materialsError && (
          <p className="save-hint save-hint-dirty" style={{ fontSize: 11, margin: '4px 0 0' }}>{materialsError}</p>
        )}
      </section>

      {/* W7-B5 (agents-21): the Run control STATES the ceiling that will be
          in force — an uncapped dispatch can no longer look identical to a
          capped one. */}
      <button
        className="btn btn-primary"
        data-action="run-agent"
        data-run-ceiling={resolveCostCeilingForDispatch(costCeiling, costCeilingEnforceable) ?? ''}
        onClick={() => void onRun()}
        disabled={controlsDisabled}
        title={standaloneBlockedReason || blockedMessage || (canRun ? 'Dispatch this agent standalone' : 'Save the agent (no unsaved changes) to run it')}
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
              the failed status is shown — never only the word "failed". */}
          {status?.errorText && (
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
