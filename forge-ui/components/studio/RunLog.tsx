/**
 * RunLog — the shared line renderer for a single run's event log (R6-04
 * WI-4 item 2). Renders `RunLogLine[]` (already mapped by
 * `../../lib/run-log-line.ts` — the event->kind mapping is deliberately a
 * separate, pure, unit-tested module so this component stays pure
 * presentation) as the scrolling session log on the new standalone run view
 * (`./agent-builder/RunView.tsx`).
 *
 * Built here as ONE component; a later initiative extends it for per-node
 * flow logs — that's exactly why the mapping (`RunLogLine[]` in) is
 * decoupled from rendering: a future caller can feed it lines derived from
 * a different event source without this component changing at all.
 *
 * NOT `EventTail.tsx` — that is a different, existing, already-wired
 * cross-phase tail on the flow monitor page. This is a new sibling for a
 * different surface: one run's own log, not a cross-phase multiplexed tail.
 * `EventTail.tsx` is not modified or retrofitted by this file.
 *
 * `data-log-line="true"` is an explicit STRING value (not a bare/boolean
 * attribute), matching this codebase's established convention for every
 * other such flag (e.g. RunPanel.tsx's `data-run-dispatchable="true"`).
 */

import type { RunLogLine } from '@/lib/run-log-line';

type Props = {
  lines: RunLogLine[];
};

export function RunLog({ lines }: Props) {
  return (
    <div data-component="run-log" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.7 }}>
      {lines.length === 0 ? (
        <div data-component="run-log-empty" className="muted" style={{ fontStyle: 'italic', fontSize: 12 }}>
          No log lines yet.
        </div>
      ) : (
        lines.map((line, i) => (
          <div key={i} data-log-line="true" data-log-kind={line.kind} style={{ display: 'flex', gap: 8 }}>
            <span data-log-kind-badge style={{ color: 'var(--faint)', flexShrink: 0, textTransform: 'uppercase', fontSize: 10 }}>
              {line.kind}
            </span>
            <span style={{ color: 'var(--dim)', whiteSpace: 'pre-wrap' }}>{line.text}</span>
          </div>
        ))
      )}
    </div>
  );
}
