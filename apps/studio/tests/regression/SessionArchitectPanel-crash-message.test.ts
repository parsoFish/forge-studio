/**
 * forge-6gv.3 / forge-rmyc — SessionArchitectPanel's StuckWarning must
 * render the runner's OWN crash message (`session.lifecycle.error`,
 * `packages/sessions/bridge-studio-lifecycle.ts::extractErrorMessage`) for a
 * `crashed` session, never the pre-fix "go check the log file yourself"
 * copy. Naming a log file path was never an error message — the operator
 * had to open a terminal and cat it themselves.
 *
 * THE GAP: no test imported SessionArchitectPanel/StuckWarning at all before
 * this file. Suppressing `crashError` entirely (reverting the fix line)
 * passed the full forge-ui suite — the fix was completely unenforced.
 *
 * Kills: a StuckWarning that falls back to the stderr.log copy for a
 * `lifecycle.state === 'crashed'` session instead of rendering
 * `lifecycle.error`.
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SessionArchitectPanel } from '../../components/studio/session/SessionArchitectPanel';
import type { ArchitectSessionSummary } from '../../lib/bridge-client';

function crashedSession(errorMessage: string | null): ArchitectSessionSummary {
  return {
    sessionId: '2026-09-25T00-00-00-deadbeef',
    project: 'gitweave',
    projectRepoPath: '/x/gitweave',
    phase: 'drafting',
    round: 3,
    idea: 'overlay team grant lint',
    questions: null,
    planUrl: null,
    completenessCritic: null,
    initiativeIds: [],
    // Working phase + past STALE_THRESHOLD_MS (120_000) => isSessionStale
    // is true => StuckWarning renders (architect-hex.ts).
    staleMs: 300_000,
    lifecycle: {
      state: 'crashed',
      needsYou: true,
      error: errorMessage,
      idleMs: 300_000,
      cancellable: false,
    },
  };
}

function renderPanel(session: ArchitectSessionSummary): string {
  return renderToStaticMarkup(React.createElement(SessionArchitectPanel, { session, events: [], nowMs: 0 }));
}

test('a crashed session renders the runner\'s own crash message, not the stderr.log fallback copy', () => {
  const html = renderPanel(crashedSession('OOM killed while drafting: heap out of memory'));
  expect(html).toContain('The architect crashed while');
  expect(html).toContain('OOM killed while drafting: heap out of memory');
  // The exact pre-fix defect: falling back to the log-path copy alongside
  // (or instead of) the real message.
  expect(html).not.toContain('stderr.log');
  expect(html).not.toContain('may have stalled');
});

test('a stale-but-not-crashed session still renders the honest "may have stalled" copy, never a fabricated crash message', () => {
  const session = crashedSession('unused');
  session.lifecycle = { state: 'stalled', needsYou: true, error: null, idleMs: 300_000, cancellable: false };
  const html = renderPanel(session);
  expect(html).toContain('may have stalled');
  expect(html).toContain('stderr.log');
  expect(html).not.toContain('The architect crashed while');
});
