'use client';

import { computeReadinessChecks, capabilityInteractive, type ReadinessInput, type ReadinessState } from '@/lib/agent-readiness';

// ---------------------------------------------------------------------------
// ReadinessPanel — the 7-check list (R2-02-F4: the `runtime` check is sourced
// from the server-computed F1 capability descriptor, not a client
// heuristic) + a ready badge when all pass, plus an informational
// `[data-capability-interactive]` chip that visibly reflects the descriptor's
// `interactive` fact (not a pass/fail gate — see agent-readiness.ts).
//
// THE TWO COUNTS ARE DIFFERENT QUESTIONS (rulings 400/410, T1 M6):
//   [data-ready-count]  how many checks PASS. Unchanged meaning — the
//                       connections journey (scripts/journeys/connections.mjs
//                       CONN-3) asserts `readyCount < totalChecks` against it.
//   [data-ready-total]  how many checks EXIST. Stable at every input, because
//                       `computeReadinessChecks` now always names all seven.
// S5 beat 9 measured why the second one had to exist: it asserted
// `data-ready-count: "6"`, and the panel answered 7 once the story fenced a
// tool — the count moved with the agent's bindings, so no observer could
// assert it. The passing count is still worth publishing; it was just never
// the stable thing.
//
// THE BADGE WAITS FOR EVERY ROW TO RESOLVE, not merely for the passing ones
// to add up. While the connections fetch is unresolved its row reads
// `pending`, and a panel that lit "Ready to use in flows" on the other six
// would be claiming an agent is ready before anything knows whether its bound
// tools are real. That was live behaviour before this change.
// ---------------------------------------------------------------------------

/**
 * One phrase per state, for the aria-label and the title. `pending` needs its
 * own words: "not met" would report an unanswered check as a failed one, and
 * a screen-reader user would hear a defect that may not exist.
 */
const OUTCOME_TEXT: Record<ReadinessState, string> = {
  ready: 'passed',
  'not-ready': 'not met',
  pending: 'still checking',
};

type Props = { state: ReadinessInput };

export function ReadinessPanel({ state }: Props) {
  const checks = computeReadinessChecks(state);
  const interactive = capabilityInteractive(state.capability);

  const readyCount = checks.filter((c) => c.state === 'ready').length;
  const allReady = checks.every((c) => c.state === 'ready');

  return (
    <div className="readiness-panel panel" style={{ padding: '12px 12px 14px' }} data-component="readiness-panel">
      <div className="panel-head" style={{ margin: '-12px -12px 10px', padding: '10px 12px' }}>Readiness</div>
      {/* W7-B5 (agents-13): pass/fail is DATA + text, not only a CSS class —
          `data-ok` per row, an aria-label naming the outcome, and a title
          that always says passed/not-met (with the check's own detail when
          it has one) so screen readers and the journey harness can tell the
          two states apart. */}
      <ul className="readiness-list" id="readiness-list" data-ready-count={readyCount} data-ready-total={checks.length}>
        {checks.map((c) => (
          <li
            key={c.key}
            className={`readiness-item${c.state === 'ready' ? ' ok' : ''}`}
            data-check={c.key}
            data-check-state={c.state}
            data-ok={c.state === 'ready' ? 'true' : 'false'}
            aria-label={`${c.label}: ${OUTCOME_TEXT[c.state]}`}
            title={c.detail ?? `${c.label} — ${OUTCOME_TEXT[c.state]}`}
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
