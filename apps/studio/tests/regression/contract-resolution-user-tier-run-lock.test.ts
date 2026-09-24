// @vitest-environment jsdom
/**
 * `ContractResolutionPanel.tsx`'s USER-tier "Apply with agent" button —
 * bead `forge-8vfn.8.3.1` (projects-45).
 *
 * THE DEFECT. `submitUser` clears `busy` (`setBusy(null)`) the INSTANT the
 * dispatch POST resolves, but the dispatched preflight-fix agent is tracked
 * separately, in `runStatus`/`startPoll` — set to `'running'` optimistically
 * before the POST even fires, then kept live by `pollPreflightFix`. The
 * button's `disabled` prop consulted ONLY `busy`, so it re-enabled the
 * moment the POST returned even though the clause's own row still showed
 * `data-agent-run-state="running"` — a second click dispatched a SECOND
 * agent onto the same clause (duplicate spend, two agents writing one
 * clause). Wave-7 regate projects-45 reproduced this against a real
 * dispatch (`data-agent-run-state=running` at t+2/6/14s with the button
 * re-enabled).
 *
 * Mounted via `createRoot`+`act`, following
 * `apps/studio/tests/regression/agent-builder-handles.test.ts`'s established pattern
 * (no jsdom elsewhere in this repo's studio suite) — the transition under
 * test is a state update inside an async click handler, which
 * `renderToStaticMarkup` cannot observe. The page/component under test is
 * imported ONCE at module scope (never inside a test body — that shape was
 * the F5/F6 flake, fixed in #807).
 *
 * RUN: npx vitest run --root apps/studio apps/studio/tests/regression/contract-resolution-user-tier-run-lock.test.ts
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ContractResolutionPanel } from '@/components/studio/project-builder/ContractResolutionPanel';
import type { PreflightClause } from '@/lib/studio-client';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/lib/studio-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/studio-client')>()),
  preflightFixAgent: vi.fn(async () => ({ ok: true, runId: 'run-1' })),
}));

// `pollDisplayState` is kept REAL (imported via `importOriginal`) — only
// `pollPreflightFix` itself is replaced, capturing its `onUpdate` so the
// test can deliver a terminal status on demand instead of waiting on a real
// bounded poll loop.
let capturedOnUpdate: ((s: { ok: boolean; state: string; cleared: boolean }) => void) | null = null;
vi.mock('@/lib/agent-dispatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agent-dispatch')>()),
  pollPreflightFix: vi.fn((_projectId: string, _runId: string, opts: { onUpdate: (s: any) => void }) => {
    capturedOnUpdate = opts.onUpdate;
    return vi.fn(); // stop fn
  }),
}));

const CLAUSE: PreflightClause = {
  id: 'C1', title: 'needs a decision', hard: true, pass: false, detail: 'd', resolution: 'user',
};

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
  capturedOnUpdate = null;
});

function mount() {
  root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(ContractResolutionPanel, { projectId: 'gitpulse', clauses: [CLAUSE], boundKbId: null }),
    );
  });
}

const q = (sel: string) => container.querySelector(sel);
const button = () => q('[data-action="apply-clause-decision"]') as HTMLButtonElement;

async function typeDecision(text: string) {
  const textarea = q('[data-field="clause-decision-C1"]') as HTMLTextAreaElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

test('the apply button stays disabled with a reason once the run is dispatched, through the POST resolving, and re-enables only on a terminal poll status', async () => {
  mount();
  await typeDecision('accept as-is');

  expect(button().disabled).toBe(false);

  // Press apply — this fires the dispatch POST (mocked to resolve
  // immediately) and starts the (mocked) poll.
  await act(async () => {
    button().click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  // The dispatch POST has resolved — `busy` is back to null — but the
  // clause's own run is still `'running'` (the optimistic status
  // `submitUser` sets before the POST even fires, then owned by the poll).
  // This is the exact defect: disabled must consult that, not just `busy`.
  expect(q('[data-clause-id="C1"]')?.getAttribute('data-agent-run-state')).toBe('running');
  expect(button().disabled).toBe(true);
  expect(button().getAttribute('data-disabled-reason')).toMatch(/C1/);

  // A terminal status delivered through the dispatch's own poll re-enables
  // it (the decision text is still in place).
  expect(capturedOnUpdate).not.toBeNull();
  await act(async () => {
    capturedOnUpdate!({ ok: true, state: 'cleared', cleared: true });
  });

  expect(button().disabled).toBe(false);
  expect(button().hasAttribute('data-disabled-reason')).toBe(false);
});
