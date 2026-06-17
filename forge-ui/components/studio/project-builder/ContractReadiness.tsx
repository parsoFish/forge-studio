'use client';

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
  const ns = northStar.trim();
  const nsOk = ns.length > 0 && ns.length <= 140;
  const instrOk = instructions.trim().length > 0;
  const hasCapture = demoSteps.some((s) => s.kind === 'capture');
  const hasVerify = demoSteps.some((s) => s.kind === 'verify');
  const demoOk = hasCapture && hasVerify;
  const skillOk = skills.length > 0;
  const kbOk = !!kb;

  const uiChecks = [
    { ok: nsOk,    text: 'North star set (≤ 140 chars)' },
    { ok: instrOk, text: 'Instructions present' },
    { ok: demoOk,  text: 'Demo has ≥ 1 capture + ≥ 1 verify step' },
    { ok: skillOk, text: '≥ 1 relevant skill bound' },
    { ok: kbOk,    text: 'Knowledge base bound' },
  ];

  const readyCount = uiChecks.filter((c) => c.ok).length;
  const uiAllReady = readyCount === uiChecks.length;

  // Preflight gate: must be loaded and have no failing hard clauses.
  const preflightLoaded = preflight !== null;
  const hardFailures = preflightLoaded
    ? preflight!.clauses.filter((c) => c.hard && !c.pass)
    : [];
  const preflightOk = preflightLoaded && hardFailures.length === 0;

  // Combined verdict: both surfaces must pass.
  const allReady = uiAllReady && preflightOk;

  // Preflight status attribute value for automation / e2e.
  const preflightStatus = !preflightLoaded ? 'pending' : hardFailures.length > 0 ? 'hard-fail' : 'ok';

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
      <div style={{ fontSize: 11, color: 'var(--faint)', fontStyle: 'italic', marginTop: 8, lineHeight: 1.5 }}>
        A flow won&apos;t accept a project that isn&apos;t contract-ready.
      </div>
    </div>
  );
}
