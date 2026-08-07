/**
 * DOM regression + acceptance tests for the shared log-line renderer
 * COMPONENT (R6-04 WI-4 item 2) — `components/studio/RunLog.tsx`, a NEW
 * component that does not exist yet. Renders `RunLogLine[]` (already mapped
 * by `./run-log-line.ts` — see that file's header for why the event→kind
 * mapping is a separate, pure, unit-tested module) as the scrolling session
 * log on the new standalone run view
 * (`components/studio/agent-builder/RunView.tsx`, pinned separately in
 * `./run-view-render.test.ts`). The task brief explicitly says this
 * component will be EXTENDED by a later initiative for per-node flow logs —
 * that is exactly why the mapping (`RunLogLine[]` in) is decoupled from
 * rendering here: a future caller can feed it lines derived from a
 * DIFFERENT event source without this component changing at all.
 *
 * NOT `components/studio/EventTail.tsx` — that is a DIFFERENT, EXISTING,
 * already-wired cross-phase tail on the flow monitor page and must not be
 * retrofitted or modified (task brief, explicit — and this file does not
 * import or reference it). `RunLog` is a NEW sibling file for a DIFFERENT
 * surface: one run's own log, not a cross-phase multiplexed tail.
 *
 * Uses the SAME `renderToStaticMarkup` idiom as `./run-panel-render.test.ts`
 * — see that file's header for the full "no jsdom /
 * `@testing-library/react` in this repo" rationale, and for why the
 * `resolve.alias['@']` + `oxc.jsx` additions to `vitest.config.ts` (already
 * landed by that same test-writer pass) make this possible without a new
 * dependency.
 *
 * ASSUMED EXPORTS from `../components/studio/RunLog.tsx`:
 *
 *   export function RunLog({ lines }: { lines: RunLogLine[] }): JSX.Element
 *
 * ASSUMED data-* CONTRACT (none of these exist yet — every assertion below
 * using them is a legitimate RED against a not-yet-created file):
 *
 *   [data-component="run-log"]                              the log container
 *   [data-log-line="true"][data-log-kind="think"|"tool"|"out"]   one row per line
 *   [data-component="run-log-empty"]                        shown when lines is []
 *
 * (`data-log-line="true"` — an explicit STRING value, not a bare/boolean
 * attribute — matching this codebase's own established convention for
 * every other such flag, e.g. RunPanel.tsx's `data-run-dispatchable="true"`,
 * `data-ceiling-enforceable="true"`.)
 *
 * RUN: npx vitest run lib/run-log-render.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RunLog } from '@/components/studio/RunLog';
import type { RunLogLine } from './run-log-line.ts';

function render(lines: RunLogLine[]): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToStaticMarkup(React.createElement(RunLog as any, { lines }));
}

test('container present with data-component="run-log"', () => {
  const html = render([]);
  expect(html).toContain('data-component="run-log"');
});

test('empty lines -> an honest empty state, not a fabricated/placeholder row — kills "renders sample/placeholder rows when given []"', () => {
  const html = render([]);
  expect(html).toContain('data-component="run-log-empty"');
  expect(html).not.toContain('data-log-line="true"');
});

test('one row per line, each carrying data-log-kind matching that line\'s own kind — kills "kind ignored, every row rendered identically"', () => {
  const lines: RunLogLine[] = [
    { kind: 'think', text: 'THINK-MARKER', eventType: 'iteration' },
    { kind: 'tool', text: 'TOOL-MARKER', eventType: 'tool_use' },
    { kind: 'out', text: 'OUT-MARKER', eventType: 'end' },
  ];
  const html = render(lines);
  expect((html.match(/data-log-line="true"/g) ?? []).length).toBe(3);
  expect(html).toContain('data-log-kind="think"');
  expect(html).toContain('data-log-kind="tool"');
  expect(html).toContain('data-log-kind="out"');
});

test('each line\'s text is rendered VERBATIM, never truncated/summarised/fabricated — kills "text replaced with a generic label per kind"', () => {
  const html = render([{ kind: 'out', text: 'UNIQUE-TEXT-MARKER-4471', eventType: 'log' }]);
  expect(html).toContain('UNIQUE-TEXT-MARKER-4471');
});

test('lines render in the GIVEN order (the caller has already ordered them oldest-first) — kills "reverses/reorders the lines"', () => {
  const html = render([
    { kind: 'out', text: 'FIRST-MARKER', eventType: 'start' },
    { kind: 'out', text: 'SECOND-MARKER', eventType: 'end' },
  ]);
  expect(html.indexOf('FIRST-MARKER')).toBeGreaterThanOrEqual(0);
  expect(html.indexOf('FIRST-MARKER')).toBeLessThan(html.indexOf('SECOND-MARKER'));
});
