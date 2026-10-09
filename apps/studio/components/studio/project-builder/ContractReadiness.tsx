'use client';

import { projectReadiness } from '@forge/contracts';
import type { DemoStep, PreflightResult } from '@/lib/studio-client';

export function ContractReadiness({
  northStar, instructions, demoSteps, skills, kb, preflight,
}: {
  northStar: string;
  instructions: string;
  demoSteps: DemoStep[];
  skills: string[];
  kb: string | null;
  preflight: PreflightResult | null;
}) {
  // The ONE readiness rule (SPEC §6): `projectReadiness` in `@forge/contracts`,
  // the same function the scheduler's claim gate calls. Nothing is computed
  // here — this component only renders the verdict.
  const verdict = projectReadiness({
    northStar,
    instructions,
    demoProcess: demoSteps,
    skills,
    kb,
    clauses: preflight === null ? null : preflight.clauses.map((c) => ({ clause: c.id, hard: c.hard, pass: c.pass })),
  });
  const uiChecks = verdict.checks.filter((c) => c.id !== 'preflight');
  const readyCount = uiChecks.filter((c) => c.ok).length;
  const uiAllReady = readyCount === uiChecks.length;
  const preflightLoaded = preflight !== null;
  const allReady = verdict.ready;

  // Preflight status attribute value for automation / e2e.
  const preflightStatus = !preflightLoaded ? 'pending' : verdict.checks.find((c) => c.id === 'preflight')!.ok ? 'ok' : 'hard-fail';

  // Ruling 169 (bead `forge-8vfn.6.5`): a created project reads what is still
  // OPEN until the demo agent has run, rather than being told by the create
  // form that its contract is finished. The two numbers are the same ones
  // `ContractResolutionPanel` derives — `failing = clauses.filter(c => !c.pass)`
  // and its `agent` subset — read here from the same `preflight` prop so they
  // cannot drift apart. `null` while preflight has not answered: pending is not
  // zero, and a panel that says "0 unresolved" before it has looked is the
  // overpromise this ruling removed one layer up.
  //
  // TEXT ONLY, deliberately: no new `data-*` key. The machine-readable form
  // already exists on `[data-section="contract-resolution"]`
  // (`data-resolution-failing-count`, `data-resolution-agent-count`), and a
  // second copy here would put one fact in two places.
  const openCounts = preflightLoaded
    ? (() => {
        const failing = preflight!.clauses.filter((c) => !c.pass);
        return { unresolved: failing.length, agentPending: failing.filter((c) => c.resolution === 'agent').length };
      })()
    : null;

  return (
    <div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 8 }}>Contract Readiness</div>
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
        data-ready-count={readyCount}
        data-flow-ready={allReady ? 'true' : 'false'}
        data-preflight-status={preflightStatus}
      >
        {uiChecks.map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: c.ok ? 'var(--text)' : 'var(--dim)' }}>
            <span style={{ fontSize: 13, flexShrink: 0, marginTop: 1 }}>{c.ok ? '✓' : '○'}</span>
            <span style={{ lineHeight: 1.4 }}>{c.text}</span>
          </div>
        ))}

        {/* Preflight clauses — merged into the unified checklist */}
        {preflight && preflight.clauses.length > 0 && (
          <>
            <div style={{ marginTop: 4, paddingTop: 8, borderTop: '1px solid var(--line)', fontSize: 10, fontFamily: 'var(--font-display)', fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 2 }}>forge preflight</div>
            {preflight.clauses.map((c) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11.5, color: c.pass ? 'var(--text)' : c.hard ? 'var(--red)' : 'var(--amber)', marginBottom: 4 }}>
                <span style={{ fontSize: 12, flexShrink: 0 }}>{c.pass ? '✓' : c.hard ? '✗' : '△'}</span>
                <span style={{ lineHeight: 1.4 }}>{c.id}: {c.title}</span>
              </div>
            ))}
          </>
        )}

        {!preflightLoaded && uiAllReady && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11.5, color: 'var(--faint)', marginTop: 4 }}>
            <span style={{ fontSize: 12, flexShrink: 0 }}>○</span>
            <span style={{ lineHeight: 1.4 }}>Preflight pending…</span>
          </div>
        )}

        {allReady && (
          <div style={{ marginTop: 10 }}>
            <span className="badge badge-project">✦ flow-ready</span>
          </div>
        )}
      </div>
      {openCounts !== null && openCounts.unresolved > 0 && (
        <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 8, fontFamily: 'var(--font-mono)' }}>
          contract: {openCounts.unresolved} unresolved · {openCounts.agentPending} agent-generated pending
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--faint)', fontStyle: 'italic', marginTop: 8, lineHeight: 1.5 }}>
        A flow won&apos;t accept a project that isn&apos;t contract-ready.
      </div>
    </div>
  );
}
