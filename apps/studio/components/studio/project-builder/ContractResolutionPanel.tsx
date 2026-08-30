'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { preflightFixAuto, preflightFixAgent, type PreflightClause } from '@/lib/studio-client';
import { startInstructions, startDemoBuilder } from '@/lib/bridge-client';
import { SessionMinted } from '@/components/studio/session/SessionMinted';
import { agentResolveLabel, brainFixHref, isAgentRouteBlocked, BRAIN_FIX_UNBOUND_HINT } from '@/lib/contract-resolution-view';
import { pollPreflightFix, pollDisplayState, type PolledPreflightFixStatus } from '@/lib/agent-dispatch';

/**
 * Stage D — guided contract-resolution panel. Mirrors LintResolutionPanel for
 * preflight clauses: each FAILING clause is grouped by its resolution tier.
 *   - AUTO  → one click applies every deterministic fixer.
 *   - AGENT → routes the clause to the matching builder (C8→instructions,
 *             DEMO→demo-builder) or the project's OWN bound KB's health tab
 *             (BRAIN→brain-fix, `/knowledge?id=<boundKbId>&tab=health`); the
 *             operator drives resolution there. `boundKbId` is the REAL
 *             binding threaded down from the project page's own `kb` state
 *             (`KbBind.tsx`) — never derived from the project id (a
 *             project's KB is operator-rebindable to any KB, or unbound
 *             entirely — see `contract-resolution-view.ts`'s `brainFixHref`
 *             header for why guessing here is unsafe). When there is no
 *             bound KB the brain-fix button is disabled with an honest hint
 *             (`isAgentRouteBlocked` / `BRAIN_FIX_UNBOUND_HINT`) rather than
 *             navigating to a guess. NONE of these three routes runs an
 *             agent turn from the click itself — see `agentResolveLabel`
 *             (./contract-resolution-view.ts), which the button label uses so
 *             it never claims "with agent" for a click that only navigates.
 *   - USER  → the operator's decision drives the preflight-fix agent, which
 *             applies it and re-runs preflight to confirm the clause cleared
 *             (this tier — and only this tier — genuinely dispatches + polls
 *             an agent turn).
 * Load-bearing state is mirrored to data-* for the harness.
 *
 * W6-B14: `submitUser` used to `await` a hand-rolled 45×2s poll loop DIRECTLY
 * inside the click handler — the THIRD independent instance of the fragile-
 * poll-loop class W6-B13 already fixed twice (pollAgentRun/pollKbDrain/
 * pollAgentFix). It now routes through the shared `pollPreflightFix`
 * (`./lib/agent-dispatch.ts`), rendering the same three-visible-state
 * contract every other fixed poll surface in this app does —
 * `data-poll-state="watching|timed-out|terminal"` per clause, plus a
 * `data-action="re-check"` affordance once timed out. Dispatched
 * imperatively from the click handler (not a `useEffect`, mirroring
 * `KbDrainPanel.tsx`'s own user-tier fix poll — see that file's header for
 * why), with each clause's in-flight poll's stop fn tracked in a ref map and
 * cancelled on unmount, so a nav-away never leaves a poll trying to
 * `setState` on a dead component. No server-side reattach exists for this
 * tier (a preflight-fix runId is not independently discoverable without
 * already knowing it — unlike consolidate/onboarding, there is no per-clause
 * "active run" index) — a reload genuinely starts fresh, same as before.
 */

type AgentState = 'running' | 'cleared' | 'not-cleared' | 'failed' | 'unknown' | 'timed-out';

const btn: React.CSSProperties = {
  fontSize: 11.5, padding: '5px 11px', background: 'var(--panel-2)', color: 'var(--text)',
  border: '1px solid var(--line-2)', borderRadius: 5, cursor: 'pointer',
};

export function ContractResolutionPanel({
  projectId,
  clauses,
  boundKbId,
  onChanged,
}: {
  projectId: string;
  clauses: PreflightClause[];
  /** The project's REAL bound KB id, or `null` if none is bound —
   *  `KbBind.tsx`'s own `kb` state, threaded straight through (never
   *  re-derived from `projectId`; see this file's header +
   *  `contract-resolution-view.ts`'s `brainFixHref`). Drives whether the
   *  brain-fix agent-tier button is navigable or must render disabled. */
  boundKbId: string | null;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  // forge-8vfn.5.5: the demo session a DEMO-tier clause mints, rendered here
  // instead of being consumed by a `router.push` inside the same click.
  const [demoSessionId, setDemoSessionId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [runStatus, setRunStatus] = useState<Record<string, PolledPreflightFixStatus>>({});
  const [msg, setMsg] = useState<string | null>(null);

  // Per-clause in-flight poll stop fns + last dispatched runId (for
  // "Re-check") — a plain ref, since these are driven imperatively from
  // click handlers, not a useEffect reacting to state (mirrors
  // KbDrainPanel.tsx's own submitUserAnswer / userPollStopRef).
  const pollStopRef = useRef<Record<string, () => void>>({});
  const runIdRef = useRef<Record<string, string>>({});
  useEffect(() => {
    return () => { Object.values(pollStopRef.current).forEach((stop) => stop()); };
  }, []);

  const startPoll = useCallback((clauseId: string, runId: string) => {
    pollStopRef.current[clauseId]?.();
    runIdRef.current[clauseId] = runId;
    pollStopRef.current[clauseId] = pollPreflightFix(projectId, runId, {
      onUpdate: (s) => {
        setRunStatus((m) => ({ ...m, [clauseId]: s }));
        if (s.state === 'cleared') onChanged?.();
        // W7-FIX-A1 A1-10: a FAILED read (ok:false 'unknown') is still being
        // watched — never reported as "agent could not clear".
        else if (pollDisplayState(s) === 'terminal') {
          setMsg(`agent could not clear ${clauseId} (${s.state}) — refine your decision and retry`);
        }
      },
    });
  }, [projectId, onChanged]);

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
    setRunStatus((m) => ({ ...m, [c.id]: { ok: true, state: 'running', cleared: false } }));
    const r = await preflightFixAgent(projectId, { clauseId: c.id });
    setBusy(null);
    if (!r.ok) {
      setRunStatus((m) => ({ ...m, [c.id]: { ok: false, state: 'failed', cleared: false } }));
      setMsg(r.error ?? 'dispatch failed');
      return;
    }
    // Agent-tier clauses route to an existing builder — navigate there.
    if (r.route === 'instructions') {
      const s = await startInstructions({ project: projectId, mode: 'init' });
      if (s.ok && s.sessionId) router.push(`/sessions/instructions/${encodeURIComponent(s.sessionId)}`);
    } else if (r.route === 'demo-builder') {
      // W6-B10 (R1-03-F2 reversed): navigates straight to the dedicated
      // session screen, exactly like the 'instructions' branch above —
      // there is no inline panel to hand a started session off to anymore.
      // forge-8vfn.5.5: publish the id, then let the operator (or a story
      // beat) follow it — navigating inside the minting click made the id
      // unobservable to everything, so no story could bind /sessions/demo/<id>.
      const s = await startDemoBuilder({ project: projectId, mode: 'create' });
      if (s.ok && s.sessionId) setDemoSessionId(s.sessionId);
    } else if (r.route === 'brain-fix') {
      // Defense in depth: the button itself is disabled whenever
      // boundKbId is null (isAgentRouteBlocked, below) so this branch
      // should be unreachable without one — but never navigate on a guess
      // if it somehow fires anyway; say why instead.
      if (boundKbId) router.push(brainFixHref(boundKbId));
      else setMsg(BRAIN_FIX_UNBOUND_HINT);
    }
  }, [projectId, router, boundKbId]);

  const submitUser = useCallback(async (c: PreflightClause) => {
    const instruction = (notes[c.id] ?? '').trim();
    setBusy(`user:${c.id}`); setMsg(null);
    setRunStatus((m) => ({ ...m, [c.id]: { ok: true, state: 'running', cleared: false } }));
    const r = await preflightFixAgent(projectId, { clauseId: c.id, instruction });
    setBusy(null);
    if (!r.ok || !r.runId) {
      setRunStatus((m) => ({ ...m, [c.id]: { ok: false, state: 'failed', cleared: false } }));
      setMsg(r.error ?? 'dispatch failed');
      return;
    }
    startPoll(c.id, r.runId);
  }, [projectId, notes, startPoll]);

  const recheckUser = useCallback((clauseId: string) => {
    const runId = runIdRef.current[clauseId];
    if (runId) startPoll(clauseId, runId);
  }, [startPoll]);

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
      {/* W7-B6 (projects-24): while one clause runs, every OTHER clause's
          controls are disabled — say so once, at the top, instead of a wall
          of silently-grey buttons. */}
      {busy !== null && (
        <div data-section="resolution-busy-reason" style={{ fontSize: 10.5, color: 'var(--faint)', marginBottom: 8 }}>
          {busyReason(busy)} — other clauses unlock when it finishes.
        </div>
      )}

      {/* STAGE 1 — AUTO */}
      {auto.length > 0 && (
        <div data-resolution-stage="auto" style={{ marginBottom: 12 }}>
          <Stage title={`Auto-fixable (${auto.length})`} sub="Deterministic — .gitignore entries, scaffolded context stubs." />
          {auto.map((c) => <ClauseRow key={c.id} c={c} status={undefined} />)}
          <button data-action="apply-preflight-auto" style={{ ...btn, marginTop: 6 }} disabled={busy !== null} onClick={() => void applyAuto()}>
            {busy === 'auto' ? 'Applying…' : `Apply ${auto.length} auto-fix${auto.length > 1 ? 'es' : ''}`}
          </button>
        </div>
      )}

      {/* STAGE 2 — AGENT */}
      {agent.length > 0 && (
        <div data-resolution-stage="agent" style={{ marginBottom: 12 }}>
          <Stage title={`Agent-resolvable (${agent.length})`} sub="Routes to the matching builder (AGENTS.md / demo) to author it." />
          {agent.map((c) => {
            const blocked = isAgentRouteBlocked(c.route, boundKbId);
            return (
              <div key={c.id} style={{ marginBottom: blocked ? 6 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ClauseRow c={c} status={runStatus[c.id]} />
                  <button
                    data-action="resolve-clause-agent"
                    data-resolve-clause-id={c.id}
                    data-resolve-blocked={blocked ? 'true' : 'false'}
                    style={btn}
                    disabled={busy !== null || blocked}
                    title={blocked ? BRAIN_FIX_UNBOUND_HINT : busy !== null ? `${busyReason(busy)} — one clause at a time` : undefined}
                    onClick={() => void resolveAgent(c)}
                  >
                    {busy === `agent:${c.id}` ? 'Routing…' : agentResolveLabel(c.route)}
                  </button>
                </div>
                {blocked && (
                  <div data-component="brain-fix-unbound-hint" style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 3 }}>
                    {BRAIN_FIX_UNBOUND_HINT}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* STAGE 3 — USER (one at a time) */}
      {user.length > 0 && (
        <div data-resolution-stage="user" data-user-total={user.length} style={{ marginBottom: 8 }}>
          <Stage title={`Needs your decision (${user.length})`} sub="State the decision (or your reasoning to accept it as-is); the agent applies it and re-runs preflight." />
          {user.map((c) => {
            const status = runStatus[c.id];
            const clausePollState = pollDisplayState(status ?? null);
            return (
              <div key={c.id} data-user-clause data-user-clause-id={c.id} {...(clausePollState ? { 'data-poll-state': clausePollState } : {})} style={{ marginBottom: 10 }}>
                <ClauseRow c={c} status={status} />
                <textarea
                  data-component="clause-decision-input"
                  data-field={`clause-decision-${c.id}`}
                  data-decision-clause-id={c.id}
                  value={notes[c.id] ?? ''}
                  onChange={(e) => setNotes((m) => ({ ...m, [c.id]: e.target.value }))}
                  placeholder={c.fixHint ?? 'How should this be resolved?'}
                  rows={2}
                  style={{ width: '100%', marginTop: 6, fontSize: 12, fontFamily: 'var(--font-mono)', background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--line-2)', borderRadius: 5, padding: 7, resize: 'vertical' }}
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button
                    data-action="apply-clause-decision"
                    data-apply-clause-id={c.id}
                    style={btn}
                    disabled={busy !== null || (notes[c.id] ?? '').trim() === ''}
                    title={busy !== null ? `${busyReason(busy)} — one clause at a time` : (notes[c.id] ?? '').trim() === '' ? 'state the decision (or your reasoning) first' : undefined}
                    onClick={() => void submitUser(c)}
                  >
                    {busy === `user:${c.id}` ? 'Applying…' : 'Apply with agent'}
                  </button>
                  {clausePollState === 'timed-out' && (
                    <button
                      data-action="re-check"
                      data-recheck-clause-id={c.id}
                      style={btn}
                      onClick={() => recheckUser(c.id)}
                    >
                      Re-check
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <SessionMinted kind="demo" sessionId={demoSessionId} project={projectId} />
    </div>
  );
}

/** W7-B6 (projects-24): the one-at-a-time lock, in words. */
function busyReason(busy: string): string {
  if (busy === 'auto') return 'Auto-fixes are applying';
  const [kind, id] = busy.split(':');
  return kind === 'agent' ? `Clause ${id} is routing to its builder` : `Clause ${id} is applying with the agent`;
}

function Stage({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>{title}</div>
      <div style={{ fontSize: 10.5, color: 'var(--faint)' }}>{sub}</div>
    </div>
  );
}

const STATE_GLYPH: Record<AgentState, string> = { running: '⏳', cleared: '✓', 'not-cleared': '⚠', failed: '✗', unknown: '?', 'timed-out': '⏸' };

function ClauseRow({ c, status }: { c: PreflightClause; status?: PolledPreflightFixStatus }) {
  const state = status?.state as AgentState | undefined;
  return (
    <div
      data-resolution-clause
      data-clause-id={c.id}
      data-clause-resolution={c.resolution ?? ''}
      data-clause-route={c.route ?? ''}
      data-agent-run-state={state ?? ''}
      {...(status?.ok === false && status.error ? { 'data-agent-run-read-error': status.error, title: `status read failed: ${status.error}` } : {})}
      style={{ flex: 1, display: 'flex', gap: 6, alignItems: 'baseline', padding: '3px 0', fontSize: 11.5, color: c.hard ? 'var(--red)' : 'var(--amber)' }}
    >
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--faint)' }}>{state ? STATE_GLYPH[state] : c.id}</span>
      <span style={{ flex: 1, color: 'var(--dim)' }}>{c.title}</span>
    </div>
  );
}
