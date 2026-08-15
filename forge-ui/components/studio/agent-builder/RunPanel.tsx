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
 */

import { useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import {
  dispatchAgentRun,
  parseRunInputs,
  type MaterialUpload,
} from '@/lib/studio-client';
import { pollAgentRun, type PolledAgentRunStatus } from '@/lib/agent-dispatch';
import {
  validateMaterialsClientSide,
  resolveCostCeilingForDispatch,
  resolveCeilingFieldValue,
} from '@/lib/run-panel-view';
import { StandingTriggers } from './StandingTriggers';
import type { StandingTrigger } from '@/lib/standing-triggers';

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

  // Poll the dispatched run's status until it leaves 'running' (done/failed/
  // suppressed) or the bounded ceiling trips — a run that dies without a
  // terminal marker, or a suppressed run that writes no events, must never
  // poll forever, and never silently freeze on a stale 'running' once the
  // ceiling is hit (agent-dispatch.ts's explicit 'timed-out' state).
  useEffect(() => {
    if (!runId) return;
    return pollAgentRun(runId, { onUpdate: setStatus });
  }, [runId]);

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
  const effectiveCanRun = canRun && !blockedMessage;
  const controlsDisabled = !effectiveCanRun || dispatching;

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

      <button
        className="btn btn-primary"
        data-action="run-agent"
        onClick={() => void onRun()}
        disabled={controlsDisabled}
        title={blockedMessage || (canRun ? 'Dispatch this agent standalone' : 'Save the agent (no unsaved changes) to run it')}
      >
        {dispatching ? 'Dispatching…' : 'Run agent'}
      </button>
      {blockedMessage && (
        <p data-component="connection-run-block" className="save-hint save-hint-dirty" style={{ fontSize: 12, margin: '6px 0 0' }}>
          {blockedMessage}
        </p>
      )}
      {!blockedMessage && !canRun && <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>Save the agent to run it.</p>}
      {error && <p className="save-hint save-hint-dirty" style={{ marginTop: 6 }}>{error}</p>}
      {runId && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <div>run <code>{runId}</code></div>
          <div>
            status: <strong>{runState}</strong>
            {status ? ` · $${status.costUsd.toFixed(4)} · ${status.events} events` : ''}
          </div>
        </div>
      )}

      {standingTriggersList}
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
