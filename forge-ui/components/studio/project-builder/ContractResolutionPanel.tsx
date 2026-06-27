'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

import { preflightFixAuto, preflightFixAgent, preflightFixStatus, type PreflightClause } from '@/lib/studio-client';
import { startInstructions, startDemoBuilder } from '@/lib/bridge-client';

/**
 * Stage D — guided contract-resolution panel. Mirrors LintResolutionPanel for
 * preflight clauses: each FAILING clause is grouped by its resolution tier.
 *   - AUTO  → one click applies every deterministic fixer.
 *   - AGENT → routes the clause to the matching builder (C8→instructions,
 *             DEMO→demo-builder) or the brain UI; the operator drives it there.
 *   - USER  → the operator's decision drives the preflight-fix agent, which
 *             applies it and re-runs preflight to confirm the clause cleared.
 * Load-bearing state is mirrored to data-* for the harness.
 */

type AgentState = 'running' | 'cleared' | 'not-cleared' | 'failed';

async function poll(projectId: string, runId: string): Promise<AgentState> {
  for (let i = 0; i < 45; i++) {
    const s = await preflightFixStatus(projectId, runId);
    if (s.state !== 'running') return s.state;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return 'running';
}

const btn: React.CSSProperties = {
  fontSize: 11.5, padding: '5px 11px', background: 'var(--panel-2)', color: 'var(--text)',
  border: '1px solid var(--line-2)', borderRadius: 5, cursor: 'pointer',
};

export function ContractResolutionPanel({
  projectId,
  clauses,
  onChanged,
}: {
  projectId: string;
  clauses: PreflightClause[];
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [runState, setRunState] = useState<Record<string, AgentState>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const failing = clauses.filter((c) => !c.pass);
  const auto = failing.filter((c) => c.resolution === 'auto');
  const agent = failing.filter((c) => c.resolution === 'agent');
  const user = failing.filter((c) => c.resolution === 'user');

  const applyAuto = useCallback(async () => {
    setBusy('auto'); setMsg(null);
    const r = await preflightFixAuto(projectId);
    setBusy(null);
    if (!r.ok) { setMsg(r.error ?? 'auto-fix failed'); return; }
    const cleared = r.applied.filter((a) => a.cleared).length;
    setMsg(`applied ${cleared}/${r.applied.length} auto-fix(es)${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}`);
    onChanged?.();
  }, [projectId, onChanged]);

  const resolveAgent = useCallback(async (c: PreflightClause) => {
    setBusy(`agent:${c.id}`); setMsg(null);
    setRunState((m) => ({ ...m, [c.id]: 'running' }));
    const r = await preflightFixAgent(projectId, { clauseId: c.id });
    setBusy(null);
    if (!r.ok) { setRunState((m) => ({ ...m, [c.id]: 'failed' })); setMsg(r.error ?? 'dispatch failed'); return; }
    // Agent-tier clauses route to an existing builder — navigate there.
    if (r.route === 'instructions') {
      const s = await startInstructions({ project: projectId, mode: 'init' });
      if (s.ok && s.sessionId) router.push(`/instructions/${encodeURIComponent(s.sessionId)}`);
    } else if (r.route === 'demo-builder') {
      const s = await startDemoBuilder({ project: projectId, mode: 'create' });
      if (s.ok && s.sessionId) router.push(`/demo/${encodeURIComponent(s.sessionId)}`);
    } else if (r.route === 'brain-fix') {
      setMsg('Resolve the stale brain citation from the Knowledge tab → Resolve Lint.');
    }
  }, [projectId, router]);

  const submitUser = useCallback(async (c: PreflightClause) => {
    const instruction = (notes[c.id] ?? '').trim();
    setBusy(`user:${c.id}`); setMsg(null);
    setRunState((m) => ({ ...m, [c.id]: 'running' }));
    const r = await preflightFixAgent(projectId, { clauseId: c.id, instruction });
    if (!r.ok || !r.runId) { setBusy(null); setRunState((m) => ({ ...m, [c.id]: 'failed' })); setMsg(r.error ?? 'dispatch failed'); return; }
    const state = await poll(projectId, r.runId);
    setBusy(null);
    setRunState((m) => ({ ...m, [c.id]: state }));
    if (state === 'cleared') onChanged?.();
    else setMsg(`agent could not clear ${c.id} (${state}) — refine your decision and retry`);
  }, [projectId, notes, onChanged]);

  if (failing.length === 0) return null;

  return (
    <div
      data-section="contract-resolution"
      data-resolution-failing-count={failing.length}
      data-resolution-auto-count={auto.length}
      data-resolution-agent-count={agent.length}
      data-resolution-user-count={user.length}
      style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line)' }}
    >
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 8 }}>
        Resolve contract gaps
      </div>
      {msg && <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 8, fontFamily: 'var(--font-mono)' }}>{msg}</div>}

      {/* STAGE 1 — AUTO */}
      {auto.length > 0 && (
        <div data-resolution-stage="auto" style={{ marginBottom: 12 }}>
          <Stage title={`Auto-fixable (${auto.length})`} sub="Deterministic — .gitignore entries, scaffolded context stubs." />
          {auto.map((c) => <ClauseRow key={c.id} c={c} state={undefined} />)}
          <button data-action="apply-preflight-auto" style={{ ...btn, marginTop: 6 }} disabled={busy !== null} onClick={() => void applyAuto()}>
            {busy === 'auto' ? 'Applying…' : `Apply ${auto.length} auto-fix${auto.length > 1 ? 'es' : ''}`}
          </button>
        </div>
      )}

      {/* STAGE 2 — AGENT */}
      {agent.length > 0 && (
        <div data-resolution-stage="agent" style={{ marginBottom: 12 }}>
          <Stage title={`Agent-resolvable (${agent.length})`} sub="Routes to the matching builder (AGENTS.md / demo) to author it." />
          {agent.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ClauseRow c={c} state={runState[c.id]} />
              <button data-action="resolve-clause-agent" data-resolve-clause-id={c.id} style={btn} disabled={busy !== null} onClick={() => void resolveAgent(c)}>
                {busy === `agent:${c.id}` ? 'Routing…' : 'Resolve with agent'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* STAGE 3 — USER (one at a time) */}
      {user.length > 0 && (
        <div data-resolution-stage="user" data-user-total={user.length} style={{ marginBottom: 8 }}>
          <Stage title={`Needs your decision (${user.length})`} sub="State the decision (or your reasoning to accept it as-is); the agent applies it and re-runs preflight." />
          {user.map((c) => (
            <div key={c.id} data-user-clause data-user-clause-id={c.id} style={{ marginBottom: 10 }}>
              <ClauseRow c={c} state={runState[c.id]} />
              <textarea
                data-component="clause-decision-input"
                data-decision-clause-id={c.id}
                value={notes[c.id] ?? ''}
                onChange={(e) => setNotes((m) => ({ ...m, [c.id]: e.target.value }))}
                placeholder={c.fixHint ?? 'How should this be resolved?'}
                rows={2}
                style={{ width: '100%', marginTop: 6, fontSize: 12, fontFamily: 'var(--font-mono)', background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--line-2)', borderRadius: 5, padding: 7, resize: 'vertical' }}
              />
              <button
                data-action="apply-clause-decision"
                data-apply-clause-id={c.id}
                style={{ ...btn, marginTop: 4 }}
                disabled={busy !== null || (notes[c.id] ?? '').trim() === ''}
                onClick={() => void submitUser(c)}
              >
                {busy === `user:${c.id}` ? 'Applying…' : 'Apply decision'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stage({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>{title}</div>
      <div style={{ fontSize: 10.5, color: 'var(--faint)' }}>{sub}</div>
    </div>
  );
}

const STATE_GLYPH: Record<AgentState, string> = { running: '⏳', cleared: '✓', 'not-cleared': '⚠', failed: '✗' };

function ClauseRow({ c, state }: { c: PreflightClause; state?: AgentState }) {
  return (
    <div
      data-resolution-clause
      data-clause-id={c.id}
      data-clause-resolution={c.resolution ?? ''}
      data-clause-route={c.route ?? ''}
      data-agent-run-state={state ?? ''}
      style={{ flex: 1, display: 'flex', gap: 6, alignItems: 'baseline', padding: '3px 0', fontSize: 11.5, color: c.hard ? 'var(--red)' : 'var(--amber)' }}
    >
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--faint)' }}>{state ? STATE_GLYPH[state] : c.id}</span>
      <span style={{ flex: 1, color: 'var(--dim)' }}>{c.title}</span>
    </div>
  );
}
