/**
 * Row 174 (forge-8vfn.8.5.9) — "not claimable" beside Start development.
 *
 * A project is born contract-green before anything is installed, but
 * `forge serve`'s claim refuses a ground on DEPS (its declared gate needs
 * node_modules it does not have). Contract Readiness counts DEPS the same way
 * (SPEC §6); the preflight read's `runnableGate` is that one DEPS clause, and
 * this says so where the operator is about to press Start development,
 * instead of leaving the refusal in `_logs/daemon/serve.log`.
 */
export function NotClaimableNotice({
  projectId,
  runnableGate,
}: {
  projectId: string;
  runnableGate: { pass: boolean; detail: string } | null;
}): JSX.Element | null {
  if (runnableGate === null || runnableGate.pass) return null;
  return (
    <div
      data-section="not-claimable"
      data-clause="DEPS"
      style={{ background: 'var(--bg-2)', border: '1px solid var(--yellow)', borderRadius: 'var(--radius)', padding: '10px 12px' }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--yellow)', marginBottom: 4 }}>
        Not claimable: DEPS — run <code>npm ci</code> in <code>projects/{projectId}</code>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--dim)', lineHeight: 1.5 }}>
        forge serve refuses to claim this project&apos;s initiatives until its declared gate can run.
        After installing, forge serve re-checks it within five minutes — no restart needed. {runnableGate.detail}
      </div>
    </div>
  );
}
