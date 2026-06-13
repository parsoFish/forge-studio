'use client';

// ---------------------------------------------------------------------------
// ReadinessPanel — 6-check list + ready badge when all pass
// ---------------------------------------------------------------------------

type AgentState = {
  purpose: string;
  skills: string[];
  hooks: string[];
  process: string;
  interactivity: string;
  runtimeConfigured: boolean;
};

type Props = { state: AgentState };

type Check = { key: string; label: string; ok: boolean };

export function ReadinessPanel({ state }: Props) {
  const checks: Check[] = [
    { key: 'purpose',       label: 'Purpose defined',               ok: state.purpose.trim().length > 0 },
    { key: 'skill',         label: 'At least one skill',            ok: state.skills.length > 0 },
    { key: 'hook',          label: 'Observability hook attached',   ok: state.hooks.length > 0 },
    { key: 'process',       label: 'Process described',             ok: state.process.trim().length > 0 },
    { key: 'interactivity', label: 'Interactivity described',       ok: state.interactivity.trim().length > 0 },
    { key: 'runtime',       label: 'Runtime configured (SDK + model)', ok: state.runtimeConfigured },
  ];

  const readyCount = checks.filter((c) => c.ok).length;
  const allReady = readyCount === 6;

  return (
    <div className="readiness-panel panel" style={{ padding: '12px 12px 14px' }} data-component="readiness-panel">
      <div className="panel-head" style={{ margin: '-12px -12px 10px', padding: '10px 12px' }}>Readiness</div>
      <ul className="readiness-list" id="readiness-list" data-ready-count={readyCount}>
        {checks.map((c) => (
          <li
            key={c.key}
            className={`readiness-item${c.ok ? ' ok' : ''}`}
            data-check={c.key}
          >
            <span className="ri-dot" />
            {c.label}
          </li>
        ))}
      </ul>
      <div
        className={`ready-badge${allReady ? ' visible' : ''}`}
        id="ready-badge"
        aria-live="polite"
      >
        <span className="dot" />
        Ready to use in flows
      </div>
    </div>
  );
}
