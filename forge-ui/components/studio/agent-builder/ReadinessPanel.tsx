'use client';

import { computeReadinessChecks, capabilityInteractive, type ReadinessInput } from '@/lib/agent-readiness';

// ---------------------------------------------------------------------------
// ReadinessPanel — 6-check list (R2-02-F4: the `runtime` check is sourced
// from the server-computed F1 capability descriptor, not a client
// heuristic) + a ready badge when all pass, plus an informational
// `[data-capability-interactive]` chip that visibly reflects the descriptor's
// `interactive` fact (not a pass/fail gate — see agent-readiness.ts).
// ---------------------------------------------------------------------------

type Props = { state: ReadinessInput };

export function ReadinessPanel({ state }: Props) {
  const checks = computeReadinessChecks(state);
  const interactive = capabilityInteractive(state.capability);

  const readyCount = checks.filter((c) => c.ok).length;
  const allReady = readyCount === checks.length;

  return (
    <div className="readiness-panel panel" style={{ padding: '12px 12px 14px' }} data-component="readiness-panel">
      <div className="panel-head" style={{ margin: '-12px -12px 10px', padding: '10px 12px' }}>Readiness</div>
      {/* W7-B5 (agents-13): pass/fail is DATA + text, not only a CSS class —
          `data-ok` per row, an aria-label naming the outcome, and a title
          that always says passed/not-met (with the check's own detail when
          it has one) so screen readers and the journey harness can tell the
          two states apart. */}
      <ul className="readiness-list" id="readiness-list" data-ready-count={readyCount}>
        {checks.map((c) => (
          <li
            key={c.key}
            className={`readiness-item${c.ok ? ' ok' : ''}`}
            data-check={c.key}
            data-ok={c.ok ? 'true' : 'false'}
            aria-label={`${c.label}: ${c.ok ? 'passed' : 'not met'}`}
            title={c.detail ?? (c.ok ? `${c.label} — passed` : `${c.label} — not met`)}
          >
            <span className="ri-dot" />
            {c.label}
            {/* No visually-hidden pass/fail span here (review round 1): the
                `aria-label` on this same <li> overrides its entire contents
                for assistive tech, so a hidden span repeating the outcome is
                announced to nobody — it only costs a DOM node and a
                duplicated string per check. The outcome reaches every reader
                that needs it: aria-label (screen readers), title (pointer),
                data-ok (journeys + render pins), the CSS class (sighted). */}
          </li>
        ))}
      </ul>
      <div
        className={`capability-chip${interactive ? ' interactive' : ''}`}
        data-capability-interactive={interactive ? 'true' : 'false'}
        title="Derived from the agent's surface (F1 capability descriptor) — informational, not a readiness gate."
      >
        <span className="ri-dot" />
        {interactive ? 'Interactive agent (interactive-session runner)' : 'Unattended agent (runs in flow nodes)'}
      </div>
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
