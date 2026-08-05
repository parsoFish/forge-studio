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
 * `data-run-id`, `data-run-status`, `data-run-cost`, `data-run-blocked`)
 * stays byte-identical.
 */

import { useEffect, useState, type CSSProperties } from 'react';
import {
  dispatchAgentRun,
  getAgentRunStatus,
  parseRunInputs,
  type AgentRunStatus,
} from '@/lib/studio-client';

const RUN_PANEL_STYLE: CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  padding: '12px 14px',
  marginTop: 12,
};

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
};

export function RunPanel({ slug, interactive, canRun, blockedMessage }: Props) {
  const [project, setProject] = useState('');
  const [inputsText, setInputsText] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<AgentRunStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);

  // Poll the dispatched run's status until it leaves 'running' (done/failed/
  // suppressed) or a bounded backstop trips — a run that dies without a
  // terminal marker, or a suppressed run that writes no events, must never
  // poll forever.
  useEffect(() => {
    if (!runId) return;
    let active = true;
    let attempts = 0;
    const MAX_ATTEMPTS = 90; // ~3 min at 2s
    const poll = async (): Promise<string> => {
      const s = await getAgentRunStatus(runId);
      if (active) setStatus(s);
      return s.state;
    };
    void poll();
    const id = setInterval(() => {
      attempts += 1;
      void poll().then((st) => { if (st !== 'running' || attempts >= MAX_ATTEMPTS) clearInterval(id); });
    }, 2000);
    return () => { active = false; clearInterval(id); };
  }, [runId]);

  if (interactive) {
    return (
      <section data-component="run-panel" data-section="agent-run" data-run-dispatchable="false" style={RUN_PANEL_STYLE}>
        <h3 style={{ margin: '0 0 6px', fontSize: 13 }}>Run</h3>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          Interactive agent — run it from its own session page.
        </p>
      </section>
    );
  }

  const runState = status?.state ?? (runId ? 'running' : 'idle');
  const effectiveCanRun = canRun && !blockedMessage;

  const onRun = async () => {
    setError(null);
    setDispatching(true);
    setStatus(null);
    try {
      const inputs = parseRunInputs(inputsText);
      const opts: { project?: string; inputs?: Record<string, string> } = {};
      if (project.trim()) opts.project = project.trim();
      if (Object.keys(inputs).length > 0) opts.inputs = inputs;
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
      <input
        className="input"
        type="text"
        placeholder="project (optional)"
        value={project}
        onChange={(e) => setProject(e.target.value)}
        disabled={!effectiveCanRun || dispatching}
        style={{ marginBottom: 8 }}
      />
      <textarea
        className="input"
        data-run-inputs
        rows={2}
        placeholder={'inputs (one per line: key: value)\ne.g. repo: ./projects/foo\nnorthStar: ship X'}
        value={inputsText}
        onChange={(e) => setInputsText(e.target.value)}
        disabled={!effectiveCanRun || dispatching}
        style={{ marginBottom: 8, fontFamily: 'var(--mono, monospace)', fontSize: 12 }}
      />
      <button
        className="btn btn-primary"
        data-action="run-agent"
        onClick={() => void onRun()}
        disabled={!effectiveCanRun || dispatching}
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
    </section>
  );
}
