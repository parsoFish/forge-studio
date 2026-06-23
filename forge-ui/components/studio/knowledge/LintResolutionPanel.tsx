'use client';

import { useState, useCallback } from 'react';

import {
  lintKb,
  fixAutoKb,
  dispatchAgentFix,
  getAgentFixStatus,
  type LintFinding,
  type ResolutionCounts,
} from '@/lib/studio-client';

/**
 * Guided lint-resolution panel — works off `forge brain lint` findings, each
 * classified into a resolution tier (auto / agent / user). It:
 *   - AUTO  → one click applies every deterministic fixer.
 *   - AGENT → one click dispatches an LLM fix-turn per finding, streamed by re-lint.
 *   - USER  → walks the operator through each decision; the answer drives an agent
 *             turn that applies it (then re-lints to confirm it cleared).
 * Mirrors all load-bearing state to data-* for the harness.
 */

const ZERO: ResolutionCounts = { auto: 0, agent: 0, user: 0 };
const key = (f: LintFinding): string => `${f.kind ?? f.check ?? '?'}::${f.file}`;

type AgentState = 'running' | 'cleared' | 'not-cleared' | 'failed';

async function pollFix(kbId: string, runId: string): Promise<AgentState> {
  for (let i = 0; i < 45; i++) {
    const s = await getAgentFixStatus(kbId, runId);
    if (s.state !== 'running') return s.state;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return 'running';
}

const btn: React.CSSProperties = {
  fontSize: 11.5, padding: '5px 11px', background: 'var(--panel-2)', color: 'var(--text)',
  border: '1px solid var(--line-2)', borderRadius: 5, cursor: 'pointer',
};
const tierLabel: Record<string, string> = { auto: 'Auto-fix', agent: 'Agent', user: 'Needs you' };

export function LintResolutionPanel({ kbId, onChanged }: { kbId: string; onChanged?: () => void }) {
  const [findings, setFindings] = useState<LintFinding[] | null>(null);
  const [counts, setCounts] = useState<ResolutionCounts>(ZERO);
  const [busy, setBusy] = useState<'scan' | 'auto' | 'agent' | 'user' | null>(null);
  const [note, setNote] = useState('');
  const [userIdx, setUserIdx] = useState(0);
  const [agentRun, setAgentRun] = useState<Record<string, AgentState>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setBusy('scan'); setMsg(null);
    const r = await lintKb(kbId);
    setBusy(null);
    if (!r.ok) { setMsg(r.error ?? 'lint failed'); return; }
    setFindings(r.findings); setCounts(r.counts); setUserIdx(0); setAgentRun({}); setNote('');
  }, [kbId]);

  const reScan = useCallback(async () => {
    const r = await lintKb(kbId);
    if (r.ok) { setFindings(r.findings); setCounts(r.counts); setUserIdx(0); }
    onChanged?.();
  }, [kbId, onChanged]);

  const auto = (findings ?? []).filter((f) => f.resolution === 'auto');
  const agent = (findings ?? []).filter((f) => f.resolution === 'agent');
  const user = (findings ?? []).filter((f) => f.resolution === 'user');
  const total = findings?.length ?? 0;
  const allResolved = findings !== null && total === 0;

  async function applyAuto() {
    setBusy('auto'); setMsg(null);
    const r = await fixAutoKb(kbId);
    setBusy(null);
    if (!r.ok) { setMsg(r.error ?? 'auto-fix failed'); return; }
    setMsg(`applied ${r.applied.length} auto-fix(es)${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}`);
    setFindings(r.remaining); setCounts(r.counts);
    onChanged?.();
  }

  async function fixAllAgent() {
    setBusy('agent'); setMsg(null);
    for (const f of agent) {
      const k = key(f);
      setAgentRun((m) => ({ ...m, [k]: 'running' }));
      const d = await dispatchAgentFix(kbId, { file: f.file, check: f.check ?? '', kind: f.kind ?? '', fixHint: f.fixHint, message: f.message });
      if (!d.ok || !d.runId) { setAgentRun((m) => ({ ...m, [k]: 'failed' })); continue; }
      const state = await pollFix(kbId, d.runId);
      setAgentRun((m) => ({ ...m, [k]: state }));
    }
    setBusy(null);
    await reScan();
  }

  async function submitUser() {
    const f = user[userIdx];
    if (!f) return;
    setBusy('user'); setMsg(null);
    const decision = note.trim();
    const hint = decision
      ? `The operator decided: ${decision}\n\nApply this decision to resolve the finding: ${f.message}`
      : f.fixHint;
    const d = await dispatchAgentFix(kbId, { file: f.file, check: f.check ?? '', kind: f.kind ?? '', fixHint: hint, message: f.message });
    if (!d.ok || !d.runId) { setBusy(null); setMsg(d.error ?? 'dispatch failed'); return; }
    const state = await pollFix(kbId, d.runId);
    setBusy(null);
    setNote('');
    if (state === 'cleared') { await reScan(); }
    else { setMsg(`agent could not apply it (${state}) — refine your answer and retry`); }
  }

  const curUser = user[Math.min(userIdx, Math.max(0, user.length - 1))];

  return (
    <div
      data-section="lint-resolution"
      data-lint-scanned={findings !== null ? 'true' : 'false'}
      data-lint-findings-count={total}
      data-lint-auto-count={auto.length}
      data-lint-agent-count={agent.length}
      data-lint-user-count={user.length}
      data-lint-findings-resolved={allResolved ? 'true' : 'false'}
      style={{ borderBottom: '1px solid var(--line)', padding: '14px 16px' }}
    >
      <div className="panel-head" style={{ padding: 0, marginBottom: 10 }}>
        <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6l3 3 5-6" fill="none" stroke="var(--c-kb)" strokeWidth="1.5" /></svg>
        RESOLVE LINT
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button data-action="lint-scan" style={btn} disabled={busy !== null} onClick={() => void scan()}>
          {busy === 'scan' ? 'Scanning…' : findings === null ? 'Scan for issues' : 'Re-scan'}
        </button>
        {findings !== null && (
          <span style={{ fontSize: 11.5, color: 'var(--dim)', fontFamily: 'var(--font-mono)' }}>
            {total === 0 ? 'clean ✓' : `${total} finding(s): ${auto.length} auto · ${agent.length} agent · ${user.length} you`}
          </span>
        )}
      </div>
      {msg && <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 8, fontFamily: 'var(--font-mono)' }}>{msg}</div>}

      {/* STAGE 1 — AUTO */}
      {auto.length > 0 && (
        <div data-lint-stage="auto" style={{ marginTop: 14 }}>
          <Stage title={`Auto-fixable (${auto.length})`} sub="Deterministic — regenerate indexes, fix dates, re-file mis-routed themes." />
          {auto.map((f) => <FindingRow key={key(f)} f={f} state={undefined} />)}
          <button data-action="apply-auto-fixes" style={{ ...btn, marginTop: 6, borderColor: 'var(--c-kb)', color: 'var(--c-kb)' }} disabled={busy !== null} onClick={() => void applyAuto()}>
            {busy === 'auto' ? 'Applying…' : `Apply ${auto.length} auto-fix${auto.length > 1 ? 'es' : ''}`}
          </button>
        </div>
      )}

      {/* STAGE 2 — AGENT */}
      {agent.length > 0 && (
        <div data-lint-stage="agent" style={{ marginTop: 14 }}>
          <Stage title={`Agent-resolvable (${agent.length})`} sub="An agent edits each file, then forge re-lints to confirm it cleared." />
          {agent.map((f) => <FindingRow key={key(f)} f={f} state={agentRun[key(f)]} />)}
          <button data-action="fix-all-with-agent" style={{ ...btn, marginTop: 6, borderColor: 'var(--c-kb)', color: 'var(--c-kb)' }} disabled={busy !== null} onClick={() => void fixAllAgent()}>
            {busy === 'agent' ? 'Agents working…' : `Fix all ${agent.length} with agent`}
          </button>
        </div>
      )}

      {/* STAGE 3 — USER (one at a time) */}
      {user.length > 0 && curUser && (
        <div data-lint-stage="user" data-user-index={userIdx} data-user-total={user.length} style={{ marginTop: 14 }}>
          <Stage title={`Needs your decision (${userIdx + 1}/${user.length})`} sub="Your answer drives the fix; the agent applies it and re-lints." />
          <FindingRow f={curUser} state={undefined} />
          <textarea
            data-component="user-resolution-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={userPrompt(curUser)}
            rows={3}
            style={{ width: '100%', marginTop: 8, fontSize: 12, fontFamily: 'var(--font-mono)', background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--line-2)', borderRadius: 5, padding: 7, resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button data-action="submit-user-resolution" style={{ ...btn, borderColor: 'var(--c-kb)', color: 'var(--c-kb)' }} disabled={busy !== null || note.trim() === ''} onClick={() => void submitUser()}>
              {busy === 'user' ? 'Applying…' : 'Apply answer'}
            </button>
            <button data-action="skip-user-resolution" style={btn} disabled={busy !== null} onClick={() => { setNote(''); setUserIdx((i) => i + 1); }}>
              Skip
            </button>
          </div>
        </div>
      )}

      {allResolved && <div style={{ marginTop: 12, fontSize: 12, color: 'var(--c-kb)' }}>All lint findings resolved ✓</div>}
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

function FindingRow({ f, state }: { f: LintFinding; state?: AgentState }) {
  return (
    <div
      data-lint-finding
      data-lint-finding-kind={f.kind ?? ''}
      data-lint-finding-resolution={f.resolution ?? ''}
      data-agent-run-state={state ?? ''}
      style={{ display: 'flex', gap: 6, alignItems: 'baseline', padding: '3px 0', fontSize: 11.5, color: 'var(--dim)', borderTop: '1px solid var(--line)' }}
    >
      <span style={{ fontFamily: 'var(--font-mono)', color: f.category === 'error' ? 'var(--c-red, #f87171)' : 'var(--faint)', fontSize: 10 }}>
        {state ? STATE_GLYPH[state] : tierLabel[f.resolution ?? ''] ?? ''}
      </span>
      <span style={{ flex: 1 }}>{f.message}</span>
    </div>
  );
}

/** A targeted prompt for the operator per user-finding kind. */
function userPrompt(f: LintFinding): string {
  switch (f.kind) {
    case 'frontmatter.bad-category':
      return 'Which category is correct? (pattern | antipattern | decision | operation | reference)';
    case 'contradiction':
      return 'Which theme is correct, or are both valid in context? Say what to keep/retire.';
    case 'cleanup.load-bearing':
    case 'cleanup.routine':
    case 'cleanup.untriaged':
      return 'Keep, archive, or delete this cycle archive? (and why)';
    default:
      return 'How should this be resolved?';
  }
}
