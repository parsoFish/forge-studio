// @vitest-environment jsdom
/**
 * `ContractResolutionPanel` must publish the demo session id it mints on its
 * OWN root — `forge-8vfn.7.6.46`, T1 ruling 832.
 *
 * THE GAP, AND WHY NOTHING CAUGHT IT. Three components render
 * `<SessionMinted kind="demo">`. `DemoTimeline` got `data-demo-session-id` in
 * #490 and `DemoStageHandoff` in ruling 332; this one never did, so the only
 * id it published was `SessionMinted`'s generic `data-session-id` — the key
 * ruling 307 records as unbindable, because a minting surface renders inside
 * another session's page whose root carries that same key and shadows it.
 * DemoTimeline's own comment states the consequence: it "could never bind
 * /sessions/demo/<id> (S1 beat 8)".
 *
 * No story went red over it because no story reaches demo-minting through
 * contract resolution at all (verified with lane C against `tests/stories/`:
 * the only demo-sid binding is S1 beat 7 → 8, on DemoTimeline's root). That is
 * absence of COVERAGE, not evidence the site was fine — which is exactly why
 * the fix ships with a door rather than on a journey's word.
 *
 * THE SHAPE IS DELIBERATELY NOT THE SIBLINGS'. Both sibling doors assert
 * `hasAttribute(...) === false` before the mint, citing 6.11.5's "no id, no
 * key". Rulings 409/422/436/438 superseded that for every minting surface —
 * `''` before the mint, the id after, never absent — because absent is the
 * same race one step earlier: an observer collecting nested `data-*` in one
 * read cannot tell "no key" from "not yet". 438 fixed the READER instead, and
 * `NewIdeaBox.tsx:131` already ships the ratified form. Ruling 332 predates
 * that reversal by ~100 rulings. This door pins the CURRENT rule; the two
 * stale sites are a separate migration.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const MINTED = '2026-09-12T04-18-33-7c1de440';

vi.mock('@/lib/bridge-client', () => ({
  startDemoBuilder: vi.fn(async () => ({ ok: true, sessionId: MINTED })),
  startInstructions: vi.fn(async () => ({ ok: false })),
}));

// The ROUTE is the server classifier's answer, not a field on the clause — the
// first draft of this door mocked only the two starters and the real
// `preflightFixAgent` ran, returned no route, and `resolveAgent` fell through
// every branch minting nothing. The door reported that as an unpublished key,
// which is the right red for the wrong reason.
vi.mock('@/lib/studio-client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  preflightFixAgent: vi.fn(async () => ({ ok: true, route: 'demo-builder' })),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** An agent-tier FAILING clause. `pass: false` is what puts it in the panel's
 *  `failing` set (`!c.pass`) — the first draft wrote `status: 'failing'`, which
 *  no filter reads, and passed only because `undefined` is falsy. A fixture
 *  that works by accident is a fixture that stops working silently. */
const DEMO_CLAUSE = {
  id: 'demo-evidence',
  title: 'The build produces a demonstrable artifact',
  hard: true,
  pass: false,
  detail: 'No demo artifact was produced for the last cycle.',
  resolution: 'agent',
  route: 'demo-builder',
} as const;

const panel = () => container.querySelector('[data-section="contract-resolution"]');

async function render() {
  const { ContractResolutionPanel } = await import(
    '@/components/studio/project-builder/ContractResolutionPanel'
  );
  await act(async () => {
    root.render(React.createElement(ContractResolutionPanel, {
      projectId: 'gitweave',
      clauses: [DEMO_CLAUSE],
      boundKbId: null,
    }));
  });
}

test('832: the key is published from first paint, empty — never absent', async () => {
  await render();

  expect(panel(), 'the panel must render for a failing clause').not.toBeNull();
  // The ratified form (409/422/436/438). Present-and-empty is readable as "not
  // yet" by a bounded wait; an ABSENT key is indistinguishable from a surface
  // that does not publish at all, which is the defect this whole bead is about.
  expect(panel()!.getAttribute('data-demo-session-id')).toBe('');
  // No id, no LINK — the other half of 5.5, unchanged: an anchor that existed
  // before the mint would point at a session that was never created.
  expect(container.querySelector('[data-action="view-demo-session"]')).toBeNull();
});

test('832: once a demo clause mints a session, the id is on the panel root, not only the anchor', async () => {
  await render();

  const resolve = container.querySelector<HTMLButtonElement>('[data-action="resolve-clause-agent"]');
  expect(resolve, 'the agent-tier resolve control must render').not.toBeNull();

  await act(async () => {
    resolve!.click();
  });

  // The assertion SK-4 makes. Reading the panel's own root is what ruling 307
  // requires: `SessionMinted`'s generic key below is shadowed by the enclosing
  // session page's root and answers with the wrong session.
  expect(panel()!.getAttribute('data-demo-session-id')).toBe(MINTED);

  // One fact, published twice, both true — and the anchor still addresses it.
  const link = container.querySelector('[data-action="view-demo-session"]');
  expect(link, 'the way in must render once the id exists').not.toBeNull();
  expect(link!.getAttribute('data-session-id')).toBe(MINTED);
  expect(link!.getAttribute('href')).toContain(`/sessions/demo/${MINTED}`);
});
