/**
 * W8-A3 — the flow monitor's launch surface, rendered.
 *
 * TWO defects are pinned here, and both are `declared-data-fails-open`:
 *
 *  WI-2 / `flows-25` (S2). `data-can-start` was a SECOND enumeration of which
 *  kickoff kinds launch something, written in `kickoff-candidates.ts` and
 *  maintained by hand next to the dispatch in `FlowKickoff.tsx` that actually
 *  decides what renders. It listed `trigger-only` as the only non-launching
 *  kind and never learned about `initiative-select`, whose entire body is an
 *  informational note and a link to `/projects`. `/flows/forge-develop`
 *  therefore advertised `data-can-start="true"` on a page with no start
 *  control anywhere. The cure is constructive, not a second detector: there is
 *  now ONE table (`lib/kickoff-surface.ts`), the component dispatches on it,
 *  `canStartFlow` reads `launches` off the same row, and the closure test at
 *  the bottom of this file RENDERS every row and refuses to let the row lie.
 *
 *  WI-1 / `flows-37` (S1). The generic picker's `<option>` label was
 *  `{initiativeId}{· project}` and nothing else, so an initiative queued under
 *  another flow was visually indistinguishable from one of this flow's own —
 *  and Start Run took it. Options now disclose the flow of origin and carry
 *  `data-repoint`, and a repoint routes through an in-DOM confirmation step
 *  rather than posting immediately.
 *
 * Renders the REAL component with `react-dom/server`'s `renderToStaticMarkup`
 * (the convention established by `lib/run-panel-render.test.ts` — no jsdom, no
 * testing-library, neither is installed). `next/navigation` is mocked because
 * the `idea` surface calls `useRouter()`, which throws outside an app-router
 * provider; nothing else about the component is stubbed.
 */
import { test, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/flows/f',
  useSearchParams: () => new URLSearchParams(),
}));

import { FlowKickoff } from '../components/studio/FlowKickoff.tsx';
import { KICKOFF_SURFACES, kickoffSurfaceId, canStartFlow } from './kickoff-surface.ts';
import type { Flow } from './studio-client.ts';
import type { KickoffCandidate } from './kickoff-candidates.ts';

function flowWith(kind: string | null): Flow {
  const base: Flow = { id: 'f', name: 'f', goal: '', nodes: [], edges: [], triggers: [] };
  return kind === null ? base : { ...base, kickoff: { kind } as Flow['kickoff'] };
}

/** The kickoff kind that produces each surface id (`generic` = no kickoff block). */
const KIND_FOR_SURFACE: Record<string, string | null> = {
  idea: 'idea',
  'initiative-select': 'initiative-select',
  'trigger-only': 'trigger-only',
  generic: null,
};

function render(kind: string | null, candidates: KickoffCandidate[] = []): string {
  return renderToStaticMarkup(FlowKickoff({ flow: flowWith(kind), candidates }) as never);
}

// ---------------------------------------------------------------------------
// flows-25 — the closure. This is the whole cure: the table cannot claim a
// launcher it does not render, because this test renders every row.
// ---------------------------------------------------------------------------

test('flows-25: EVERY kickoff surface renders a launch control if and only if its row says launches:true', () => {
  const ids = Object.keys(KICKOFF_SURFACES);
  expect(ids.sort()).toEqual(['generic', 'idea', 'initiative-select', 'trigger-only']);

  for (const id of ids) {
    const surface = KICKOFF_SURFACES[id as keyof typeof KICKOFF_SURFACES];
    const kind = KIND_FOR_SURFACE[id];
    const markup = render(kind);

    expect(markup, `${id}: the component must dispatch to its own surface`).toContain(`data-kickoff-kind="${id}"`);

    if (surface.launches) {
      expect(surface.launchAction, `${id}: a launching surface must name its control`).toBeTruthy();
      expect(markup, `${id}: launches:true but no [data-action="${surface.launchAction}"] in the rendered markup`)
        .toContain(`data-action="${surface.launchAction}"`);
    } else {
      expect(surface.launchAction, `${id}: a non-launching surface names no control`).toBeNull();
      // Nothing that starts anything: NO launcher's action may appear — the set
      // is read off the table itself, so adding a fifth surface with a new
      // launch action cannot silently narrow this check (review round 1).
      const everyLaunchAction = Object.values(KICKOFF_SURFACES)
        .map((sfc) => sfc.launchAction)
        .filter((a): a is string => a !== null);
      for (const action of everyLaunchAction) {
        expect(markup, `${id}: launches:false but the markup carries [data-action="${action}"]`)
          .not.toContain(`data-action="${action}"`);
      }
    }

    // The attribute automation reads agrees with what was just rendered.
    expect(canStartFlow(flowWith(kind)), `${id}: canStartFlow must agree with the rendered surface`).toBe(surface.launches);
  }
});

test('flows-25: forge-develop\'s initiative-select monitor reports data-can-start FALSE — it renders a note and a link, not a launcher', () => {
  const develop = flowWith('initiative-select');
  expect(canStartFlow(develop)).toBe(false);
  const markup = render('initiative-select');
  expect(markup).toContain('data-action="open-projects"'); // the way there IS still offered
  expect(markup).not.toContain('data-action="start-run"');
});

test('flows-25: an authored flow with no kickoff block still reports data-can-start TRUE (the generic Start Run)', () => {
  expect(canStartFlow(flowWith(null))).toBe(true);
  expect(render(null)).toContain('data-action="start-run"');
});

test('flows-25: a null flow can start nothing, and an unrecognised kind falls back to the generic surface', () => {
  expect(canStartFlow(null)).toBe(false);
  expect(kickoffSurfaceId(flowWith('something-new-and-unknown'))).toBe('generic');
});

// ---------------------------------------------------------------------------
// flows-37 — the picker discloses the flow of origin
// ---------------------------------------------------------------------------

function candidate(over: Partial<KickoffCandidate> = {}): KickoffCandidate {
  return { initiativeId: 'INIT-2026-08-18-alpha', project: 'demo-project', currentFlowId: null, isRepoint: false, ...over };
}

test('flows-37: an option for an initiative queued under ANOTHER flow names that flow and is marked data-repoint="true"', () => {
  const markup = render(null, [
    candidate({ initiativeId: 'INIT-2026-08-18-alpha', currentFlowId: 'forge-architect', isRepoint: true }),
    candidate({ initiativeId: 'INIT-2026-08-18-beta', currentFlowId: 'f', isRepoint: false }),
  ]);
  expect(markup).toContain('forge-architect');
  expect(markup).toMatch(/data-repoint="true"/);
  expect(markup).toMatch(/data-repoint="false"/);
});

test('flows-37: no confirmation panel is rendered until a repoint is actually attempted', () => {
  const markup = render(null, [candidate({ currentFlowId: 'forge-architect', isRepoint: true })]);
  expect(markup).not.toContain('data-component="repoint-confirm"');
});

test('flows-37: the generic picker still renders its Start Run control with candidates present', () => {
  expect(render(null, [candidate()])).toContain('data-action="start-run"');
});
