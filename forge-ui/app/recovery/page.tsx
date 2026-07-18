'use client';
/**
 * Recovery screen (S9/DEC-6) — the operator surface for stuck cycles, replacing the
 * retired `forge review --inspect/--abandon` + `forge requeue` CLI verbs. Lists the
 * recoverable initiatives (in-flight / ready-for-review / failed), inspects the
 * selected one's preserved worktree (branch / commits / diff / PR draft), and offers
 * requeue + abandon — all over the bridge recovery routes.
 */
import { useEffect, useState, useCallback } from 'react';
import { StudioNav } from '@/components/StudioNav';
import {
  fetchCycles,
  fetchRecovery,
  recoveryRequeue,
  recoveryAbandon,
  type RecoveryInspect,
} from '@/lib/bridge-client';
import { groupCyclesByInitiative, type InitiativeGroup } from '@/lib/cycle-grouping';

// R4-11-F1: `merged` is deliberately EXCLUDED here. It's a transient
// pass-through — closure promotes it on to `done/` in the SAME finalize
// sweep that lands it in `merged/`, but that sweep spans the post-merge CI
// watch plus the reflector run, so a manifest legitimately sits in
// `merged/` for minutes, not instantaneously. It's still never a parking
// state an operator needs to act on — so it doesn't belong in the "needs
// attention" recovery list the way a genuinely stuck
// in-flight/ready-for-review/failed cycle does. (The bridge's
// `bridge-recovery.ts` locate() + `forge-requeue.ts` candidates DO still
// search `merged/` defensively, for the rare crash-between-the-two-moves
// case — but that's a manual escape hatch, not something this list surfaces
// routinely.)
const RECOVERABLE = new Set(['in-flight', 'ready-for-review', 'failed']);

export default function RecoveryPage() {
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<InitiativeGroup[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<RecoveryInspect | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>('');

  const load = useCallback(async () => {
    const snap = await fetchCycles();
    const all = [...(snap?.live ?? []), ...(snap?.recent ?? [])];
    // One card per initiative (collapses resume/requeue attempts onto the
    // active cycle — see lib/cycle-grouping.ts), newest-first, recoverable
    // states only.
    const recoverable = groupCyclesByInitiative(all).filter((g) => RECOVERABLE.has(g.status));
    setItems(recoverable);
    setReady(true);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const inspect = useCallback(async (initiativeId: string) => {
    setSelected(initiativeId);
    setDetail(null);
    setDetail(await fetchRecovery(initiativeId));
  }, []);

  const doAction = useCallback(async (kind: 'requeue' | 'abandon', initiativeId: string) => {
    setBusy(true);
    setNote('');
    const res = kind === 'requeue'
      ? await recoveryRequeue(initiativeId, { resetRetries: true })
      : await recoveryAbandon(initiativeId);
    setBusy(false);
    setNote(res.ok ? `${kind} ok` : `${kind} failed: ${res.error ?? 'unknown'}`);
    if (res.ok) { setSelected(null); setDetail(null); await load(); }
  }, [load]);

  return (
    <main
      data-page="recovery"
      data-page-ready={ready ? 'true' : 'false'}
      data-recovery-count={items.length}
      style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)' }}
    >
      <StudioNav />
      <div style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{ fontSize: 18, letterSpacing: '.4px' }}>Recovery</h1>
        <p style={{ color: 'var(--dim)', fontSize: 13 }}>
          Stuck initiatives (in-flight / ready-for-review / failed). Inspect the preserved worktree,
          then requeue or abandon. The CLI recovery verbs were retired (DEC-6) — this is the surface.
        </p>

        {ready && items.length === 0 && (
          <p data-section="recovery-empty" style={{ color: 'var(--faint)', fontSize: 13, marginTop: 24 }}>
            No recoverable initiatives — every cycle is pending, running cleanly, or done.
          </p>
        )}

        <ul data-section="recovery-list" style={{ listStyle: 'none', padding: 0, marginTop: 16 }}>
          {items.map((c) => (
            <li
              key={c.initiativeId}
              data-recovery-item
              data-recovery-initiative={c.initiativeId}
              data-recovery-status={c.status}
              data-recovery-attempt-count={c.attemptCount}
              style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px', marginBottom: 8 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
                <code style={{ fontSize: 12 }}>{c.initiativeId}</code>
                <span style={{ fontSize: 11, color: 'var(--dim)' }}>{c.status}</span>
                {c.attemptCount > 1 && (
                  <span
                    data-recovery-prior-attempts={c.attemptCount - 1}
                    title={`${c.attemptCount - 1} prior attempt(s): ${c.priorCycleIds.join(', ')}`}
                    style={{ fontSize: 10, color: 'var(--faint)', border: '1px solid var(--border)', borderRadius: 10, padding: '1px 7px' }}
                  >
                    ×{c.attemptCount}
                  </span>
                )}
                <span style={{ display: 'flex', gap: 8 }}>
                  <button data-action="recovery-inspect" onClick={() => void inspect(c.initiativeId)}
                    style={btn('var(--border)')}>Inspect</button>
                  <button data-action="recovery-requeue" disabled={busy} onClick={() => void doAction('requeue', c.initiativeId)}
                    style={btn('var(--accent)')}>Requeue</button>
                  <button data-action="recovery-abandon" disabled={busy} onClick={() => void doAction('abandon', c.initiativeId)}
                    style={btn('#a33')}>Abandon</button>
                </span>
              </div>

              {selected === c.initiativeId && detail && (
                <div data-section="recovery-detail" data-recovery-detail-initiative={c.initiativeId} style={{ marginTop: 10, fontSize: 12 }}>
                  <div>branch: <code>{detail.branch}</code> · worktree: {detail.worktreeExists ? 'preserved' : 'gone'} · PR draft: {detail.prDraftChars ?? 0} chars</div>
                  {detail.commits && detail.commits.length > 0 && (
                    <pre data-recovery-commits style={{ background: 'var(--panel)', padding: 8, borderRadius: 4, marginTop: 6, overflowX: 'auto' }}>
                      {detail.commits.join('\n')}
                    </pre>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>

        {note && <p data-recovery-note style={{ fontSize: 12, color: 'var(--dim)', marginTop: 12 }}>{note}</p>}
      </div>
    </main>
  );
}

function btn(bg: string): React.CSSProperties {
  return { fontSize: 11, padding: '3px 10px', background: bg, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' };
}
