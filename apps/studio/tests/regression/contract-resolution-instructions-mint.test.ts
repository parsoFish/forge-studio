// @vitest-environment jsdom
/**
 * `ContractResolutionPanel`'s agent-tier `instructions` route MINTS AND
 * STAYS — the sibling of `forge-8vfn.7.6.46` (T1 ruling 832,
 * `contract-resolution-mint.test.ts`), which fixed the `demo-builder` route
 * in the same `resolveAgent` handler but left `instructions`
 * (`ContractResolutionPanel.tsx:141`, pre-fix) still `router.push`ing from
 * inside the click that minted the id. `forge-8vfn.5.10` re-derived this as
 * one of the four surviving mint-then-navigate sites.
 *
 * THE KEY MUST BE DISTINCTLY NAMED (ruling 307, restated in
 * `contract-resolution-mint.test.ts`'s own header): this panel can render
 * INSIDE a session page (S1's onboarding session hosts the same five-stage
 * Contract Buildout), whose own root also carries a generic
 * `data-session-id` — so `data-instructions-session-id` on the panel's own
 * root, not `SessionMinted`'s generic key, is what a future beat could bind.
 *
 * NO QUERY STRING on the href, unchanged from the pre-fix `router.push`
 * target (`/sessions/instructions/<id>`, no `?project=`) — see
 * `authoring-launcher-mint.test.ts` for why an exact-href-matched anchor must
 * never carry one.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// The component under test is imported ONCE, at module scope (`vi.mock`
// below is hoisted, so the mocks still apply) — the #807 fix (bb0c9d4b):
// an in-body `await import(...)` charges that module's transform to
// whichever test runs first (measured here under CPU starvation, up to
// 1735ms — well over the 5000ms per-test budget's safety margin) instead
// of vitest's own untimed transform/setup phase.
import { ContractResolutionPanel } from '@/components/studio/project-builder/ContractResolutionPanel';

const MINTED = '2026-09-25T00-00-00-crpinstr01';
const push = vi.fn();

vi.mock('@/lib/bridge-client', () => ({
  startInstructions: vi.fn(async () => ({ ok: true, sessionId: MINTED })),
  startDemoBuilder: vi.fn(async () => ({ ok: false })),
}));

vi.mock('@/lib/studio-client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  preflightFixAgent: vi.fn(async () => ({ ok: true, route: 'instructions' })),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  push.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const panel = () => container.querySelector('[data-section="contract-resolution"]');

/** An agent-tier FAILING clause routed at `instructions` (`pass: false` is
 *  what puts it in the panel's `failing` set — see the sibling door's own
 *  note on this exact fixture shape). */
const INSTRUCTIONS_CLAUSE = {
  id: 'c8-gate-command',
  title: 'CLAUDE.md carries the gate command',
  hard: true,
  pass: false,
  detail: 'No gate command declared.',
  resolution: 'agent',
  route: 'instructions',
} as const;

async function render() {
  await act(async () => {
    root.render(React.createElement(ContractResolutionPanel, {
      projectId: 'gitweave',
      clauses: [INSTRUCTIONS_CLAUSE],
      boundKbId: null,
    }));
  });
}

test('the key is published from first paint, empty — never absent', async () => {
  await render();

  expect(panel(), 'the panel must render for a failing clause').not.toBeNull();
  expect(panel()!.getAttribute('data-instructions-session-id')).toBe('');
  expect(container.querySelector('[data-action="view-instructions-session"]')).toBeNull();
});

test('once an instructions clause mints a session, the id is on the panel root and the click does not navigate', async () => {
  await render();

  const resolve = container.querySelector<HTMLButtonElement>('[data-action="resolve-clause-agent"]');
  expect(resolve, 'the agent-tier resolve control must render').not.toBeNull();

  await act(async () => {
    resolve!.click();
  });
  await act(async () => {});

  expect(panel()!.getAttribute('data-instructions-session-id')).toBe(MINTED);
  expect(push, 'the click itself must never navigate').not.toHaveBeenCalled();

  const link = container.querySelector('[data-action="view-instructions-session"]');
  expect(link, 'the way in must render once the id exists').not.toBeNull();
  expect(link!.getAttribute('data-session-id')).toBe(MINTED);
  expect(link!.getAttribute('href')).toBe(`/sessions/instructions/${MINTED}`);
});
