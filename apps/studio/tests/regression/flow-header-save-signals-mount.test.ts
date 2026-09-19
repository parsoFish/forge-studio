// @vitest-environment jsdom
/**
 * forge-8vfn.5.12 — T2 gap-close: the post-save state transitions this bead's
 * fix drives (`setLintState('clean')`, `setSavedKb`) are real `onClick` ->
 * `useSaveState` -> `setState` commits, not derivable from a single static
 * render. `renderToStaticMarkup` (this directory's usual tool, see
 * ../contract/flow-header-render.test.ts's header) proves the FIRST frame
 * only. This file opts into jsdom + a real `createRoot`/`act` mount, driving
 * the product's own door (`[data-action="save-flow"]`) — the same pattern
 * ./agent-builder-handles.test.ts established for the identical class of gap.
 *
 * Renders the SMALLEST component that owns the save button — `FlowHeader`
 * itself — rather than the whole `/flows/[id]` page: `onSave` is already a
 * prop `FlowHeader` calls directly (`page.tsx`'s `handleBuildSave`, which
 * talks to `saveFlow`/the canvas ref, is a separate, already-covered unit),
 * so mocking it in place exercises exactly the code this bead touched
 * (FlowHeader.tsx's `useSaveState` wrapper) without also having to stand up
 * `FlowBuilderCanvas`'s ReactFlow tree.
 *
 * The two states are made to DISAGREE on purpose: the roster's persisted kb
 * ('old-kb') differs from the kb this save actually writes ('gitpulse',
 * `state.kb`) — a test where both already matched could pass on the
 * pre-fix code too (the static roster-fallback alone would satisfy it),
 * proving nothing about `setSavedKb` firing on the click.
 *
 * MUTATION PASS (recorded in the report, not re-run here): both new tests
 * were re-run against a scratch revert of `setLintState`/`setSavedKb` back to
 * the pre-fix wrapper (only `setSaveFindings`/`setSavedKickoffKind`, no lint
 * state, no persisted-kb update) — both go red naming the stale attribute.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Partial mock: only the network read `FlowHeader` fires on mount (the kb
// roster for its OWN select, unrelated to the `flows` PROP this test drives
// data-flow-kb through) is replaced. Every other export — including the type
// re-exports the component under test imports — stays real.
vi.mock('@/lib/studio-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/studio-client')>()),
  fetchStudioKbs: vi.fn(async () => []),
}));

// The component under test is imported ONCE, at module scope (vi.mock above
// is hoisted, so the mock still applies) — see bb0c9d4b's fix elsewhere in
// this lane: an in-body `await import(...)` charges the transform to that
// test's 5 s budget and starves later tests on a contended host.
import { FlowHeader, type FlowHeaderState } from '@/components/studio/flow-builder/FlowHeader';
import type { Flow } from '@/lib/studio-client';

/** The roster's PERSISTED kb for this flow deliberately disagrees with the
 *  kb the save below writes, so a passing test proves the POST-SAVE update
 *  fired rather than the static roster-fallback alone. */
const FLOWS: Flow[] = [
  { id: 'story-flow', name: 'Story Flow', goal: '', kb: 'old-kb', nodes: [], edges: [], triggers: [] },
];

const STATE: FlowHeaderState = { name: 'Story Flow', goal: 'Ship it.', project: '', kb: 'gitpulse', triggers: [] };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

const q = (sel: string) => container.querySelector(sel);
const press = async (action: string) => {
  const el = q(`[data-action="${action}"]`);
  expect(el, `[data-action="${action}"] must exist to be pressed`).not.toBeNull();
  await act(async () => {
    (el as HTMLElement).click();
  });
};

/** Mounts the real FlowHeader with a caller-controlled `onSave`, and lets its
 *  one mount-time fetch (the kb roster, mocked above) settle. */
async function mountHeader(onSave: () => Promise<{ ok: boolean; version?: number; error?: string; findings?: unknown[]; kickoff?: string | null }>) {
  root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(FlowHeader, {
        flowId: 'story-flow',
        state: STATE,
        onChange: () => {},
        onSave,
        flows: FLOWS,
        onFlowSelect: () => {},
      }),
    );
  });
  await act(async () => { await Promise.resolve(); });
}

test('pressing save-flow with a 200 response flips the lint verdict to clean and the persisted-kb badge to the value just saved', async () => {
  const onSave = vi.fn(async () => ({ ok: true as const, version: 2 }));
  await mountHeader(onSave);

  // Before the press: unsaved verdict, and the kb badge reads the ROSTER's
  // persisted value (this mount's local edit, 'gitpulse', has not been saved).
  expect(q('[data-component="flow-save-findings"]')?.getAttribute('data-lint-state')).toBe('unsaved');
  expect(q('[data-component="flow-header"]')?.getAttribute('data-flow-kb')).toBe('old-kb');

  await press('save-flow');

  expect(onSave).toHaveBeenCalledTimes(1);
  const findings = q('[data-component="flow-save-findings"]');
  expect(findings?.getAttribute('data-lint-state')).toBe('clean');
  expect(findings?.getAttribute('data-finding-count')).toBe('0');
  // The badge now reports what THIS save actually wrote, not the stale roster.
  expect(q('[data-component="flow-header"]')?.getAttribute('data-flow-kb')).toBe('gitpulse');
});

test('pressing save-flow with a 400 + per-node findings sets the findings verdict, and leaves the persisted-kb badge unmoved (nothing was actually written)', async () => {
  const onSave = vi.fn(async () => ({
    ok: false as const,
    error: 'validation failed',
    findings: [
      { level: 'error', object: 'flow:f', check: 'agent-ref', message: 'Node "x" references unknown agent "ghost"' },
      { level: 'error', object: 'flow:f', check: 'node-shape', message: 'Node "y" has neither "agent" nor "gate"' },
    ],
  }));
  await mountHeader(onSave);

  await press('save-flow');

  expect(onSave).toHaveBeenCalledTimes(1);
  const findings = q('[data-component="flow-save-findings"]');
  expect(findings?.getAttribute('data-lint-state')).toBe('findings');
  expect(findings?.getAttribute('data-finding-count')).toBe('2');
  // A REJECTED save never persisted anything — the badge must still read the
  // roster's OLD value, not the local edit the rejected PUT tried to write.
  expect(q('[data-component="flow-header"]')?.getAttribute('data-flow-kb')).toBe('old-kb');
});
