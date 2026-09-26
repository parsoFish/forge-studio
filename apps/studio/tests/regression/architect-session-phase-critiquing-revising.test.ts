/**
 * forge-8vfn.8.1.14 — the operator (and the story surface) must see
 * `critiquing`/`revising` on the SAME `data-session-phase` attribute they
 * already watch as a progress key, on the SAME element that carries it today
 * (the session shell's `<main data-session-phase>` root,
 * `app/sessions/[kind]/[sessionId]/page.tsx`). No new attribute, no new
 * element — this pins the EXISTING one, rendered.
 *
 * `[kind]/[sessionId]/page.tsx` is itself a `use client` page whose state
 * arrives from an effect-driven fetch — `renderToStaticMarkup` never runs
 * that effect (the same convention `session-shell-summary-fail-closed-
 * wiring.test.ts`'s header documents for this exact page: "source-text pins,
 * not rendered-DOM"). Two levels DO render, and together they close the gap
 * end to end, byte for byte:
 *
 *   1. `apps/studio/tests/contract/session-shell-view.test.ts` AT-108/AT-109
 *      pin that `sessionShellState(payload).phase` passes `payload.phase`
 *      through UNFILTERED — the page's root literally does
 *      `'data-session-phase': viewState.phase` with no derivation in between.
 *   2. THIS file renders `StudioArchitectShell` — the actual `<main>` the
 *      page mounts — with `mainData` carrying that exact key, proving the
 *      attribute genuinely reaches the DOM for both new values (the same
 *      shell `main-landmark.test.ts` already renders standalone).
 *
 * Also pins `SessionArchitectPanel`'s own honest status copy for the two
 * phases (the bespoke architect panel this shell mounts), so the operator
 * reading the panel body sees "checking the plan for gaps" / "revising the
 * plan" instead of the pre-fix "drafting the plan…" that survived unchanged
 * through both (m7-d-proof-S1 evidence).
 */
import { test, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The nav reads the active pillar from the router; nothing else these shells
// render touches Next runtime context (mirrors main-landmark.test.ts).
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

import { StudioArchitectShell } from '../../components/StudioArchitectShell';
import { SessionArchitectPanel } from '../../components/studio/session/SessionArchitectPanel';
import type { ArchitectSessionSummary } from '../../lib/bridge-client';

test('the session shell root renders data-session-phase="critiquing" / "revising" — the SAME attribute the stories already watch, no new one', () => {
  for (const phase of ['critiquing', 'revising']) {
    const html = renderToStaticMarkup(
      createElement(
        StudioArchitectShell,
        {
          dataPage: 'session',
          ready: true,
          title: 'Planning session',
          idLabel: 'sess-1',
          mainData: {
            'data-session-kind': 'architect',
            'data-session-id': 'sess-1',
            'data-session-phase': phase,
          },
        },
        null,
      ),
    );
    expect(html).toContain(`data-session-phase="${phase}"`);
  }
});

function session(phase: ArchitectSessionSummary['phase']): ArchitectSessionSummary {
  return {
    sessionId: '2026-09-26T06-35-53-c47340dc',
    project: 'story-s1',
    projectRepoPath: '/x/story-s1',
    phase,
    round: 1,
    idea: 'overlay team grant lint',
    questions: null,
    planUrl: null,
    completenessCritic: null,
    initiativeIds: [],
  };
}

function renderPanel(s: ArchitectSessionSummary): string {
  return renderToStaticMarkup(createElement(SessionArchitectPanel, { session: s, events: [], nowMs: 0 }));
}

test('SessionArchitectPanel renders honest, distinct status copy for critiquing and revising — never the frozen "drafting the plan…" text', () => {
  const critiquing = renderPanel(session('critiquing'));
  expect(critiquing).toContain('The architect is checking the plan for gaps…');
  expect(critiquing).not.toContain('drafting the plan');

  const revising = renderPanel(session('revising'));
  expect(revising).toContain('The architect is revising the plan…');
  expect(revising).not.toContain('drafting the plan');
});

test('SessionArchitectPanel treats critiquing/revising as ACTIVE (architect-hex working set) — the hex must not read idle mid-critique', () => {
  const critiquing = renderPanel(session('critiquing'));
  expect(critiquing).toContain('data-architect-active="true"');
  const revising = renderPanel(session('revising'));
  expect(revising).toContain('data-architect-active="true"');
});
