/**
 * forge-8vfn.8.1.48 (ruling 1891, row 160) — a POSITIVE DOM signal for "the
 * interview is over", so a story branches on that instead of on the ABSENCE
 * of `[data-field="question-freetext"]`.
 *
 * RUN 41's SHAPE, READ FROM THE TRIAGE: the architect asked no questions at
 * all and went straight from `interviewing` to `exploring` — the question
 * form never rendered, and S10 beat 4's repeat had no way to tell that apart
 * from a genuinely missing affordance. It waited its whole declared bound.
 *
 * `data-interview-state="asking"|"concluded"` is monotonic across the pair
 * `interviewing`/`awaiting-answers` (another question can still arrive) vs
 * every later phase (the architect decided it had enough, whether that took
 * zero rounds or several) — see `architectInterviewState`,
 * `apps/studio/lib/architect-hex.ts`. `data-interview-questions` is the
 * CURRENT round's pending question count, already on the wire as
 * `session.questions` — `0` whenever there is nothing pending, which is
 * exactly run 41's shape once the interview concludes.
 */
import { test, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SessionArchitectPanel } from '../../components/studio/session/SessionArchitectPanel';
import type { ArchitectSessionSummary } from '../../lib/bridge-client';

function session(
  phase: ArchitectSessionSummary['phase'],
  questions: ArchitectSessionSummary['questions'] = null,
): ArchitectSessionSummary {
  return {
    sessionId: '2026-09-27T22-54-57-56dc2949',
    project: 'gitpulse',
    projectRepoPath: '/x/gitpulse',
    phase,
    round: 1,
    idea: 'exclude-author-flag',
    questions,
    planUrl: null,
    completenessCritic: null,
    initiativeIds: [],
  };
}

function renderPanel(s: ArchitectSessionSummary): string {
  return renderToStaticMarkup(createElement(SessionArchitectPanel, { session: s, events: [], nowMs: 0 }));
}

test('run 41 shape: interviewing with 0 pending questions reads asking, not concluded', () => {
  const html = renderPanel(session('interviewing'));
  expect(html).toContain('data-interview-state="asking"');
  expect(html).toContain('data-interview-questions="0"');
});

test('run 41 shape: the interview concludes straight to exploring with 0 questions ever rendered', () => {
  const html = renderPanel(session('exploring'));
  expect(html).toContain('data-interview-state="concluded"');
  expect(html).toContain('data-interview-questions="0"');
});

test('awaiting-answers with rendered questions still reads asking, with the pending count', () => {
  const html = renderPanel(
    session('awaiting-answers', [
      { question: 'Which command is the gate?', header: 'gate command' },
      { question: 'Does exclude win over include?', header: 'precedence' },
    ] as ArchitectSessionSummary['questions']),
  );
  expect(html).toContain('data-interview-state="asking"');
  expect(html).toContain('data-interview-questions="2"');
});

const PHASES_PAST_THE_INTERVIEW = [
  'drafting',
  'critiquing',
  'revising',
  'awaiting-verdict',
  'finalizing',
  'committed',
] as const;

test('every phase past the interview reads concluded, not only exploring', () => {
  for (const phase of PHASES_PAST_THE_INTERVIEW) {
    const html = renderPanel(session(phase));
    expect(html, `phase ${phase}`).toContain('data-interview-state="concluded"');
  }
});
