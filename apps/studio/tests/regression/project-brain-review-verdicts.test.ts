// @vitest-environment jsdom
/**
 * forge-mfv5.1.15 — the project-brain review gate offers THREE verdicts, not
 * two. A draft with a factual error used to be abandonable only (and fully
 * re-run); "Revise with notes" sends the operator's notes to the next draft.
 *
 * Mounts the real `SessionProjectBrainPanel` (jsdom + react-dom/client + `act`,
 * the technique `reflection-poll-render.test.ts` establishes) with the bridge
 * client mocked, and drives the review block through its DOM contract:
 *   data-action="revise-brain"        reveals
 *   data-field="brain-revise-notes"   and
 *   data-action="send-brain-revise"   (disabled + a reason while notes are empty)
 *   data-brain-round                  on the review block ("Draft round N")
 *
 * RUN: npx vitest run apps/studio/tests/regression/project-brain-review-verdicts.test.ts
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const reviseMock = vi.fn<(i: { project: string; sessionId: string; feedback: string }) => Promise<{ ok: boolean; error?: string }>>();
const approveMock = vi.fn<(i: unknown) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/bridge-client', () => ({
  projectBrainBrief: vi.fn(async () => ({ ok: true })),
  projectBrainApprove: (i: unknown) => approveMock(i),
  projectBrainAbandon: vi.fn(async () => ({ ok: true })),
  projectBrainRevise: (i: { project: string; sessionId: string; feedback: string }) => reviseMock(i),
}));

import { SessionProjectBrainPanel } from '@/components/studio/session/SessionProjectBrainPanel';
import type { ProjectBrainSession } from '@/lib/bridge-client';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  reviseMock.mockReset();
  reviseMock.mockResolvedValue({ ok: true });
  approveMock.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function session(extra: Record<string, unknown> = {}): ProjectBrainSession {
  return {
    session_id: 's1', project: 'demoproj', phase: 'awaiting-review', prompt: '', updated_at: '2026-10-09T00:00:00Z', ...extra,
  } as ProjectBrainSession;
}

async function mount(s: ProjectBrainSession, onRefresh: () => void = () => {}): Promise<void> {
  await act(async () => {
    root.render(React.createElement(SessionProjectBrainPanel, {
      session: s, themes: [{ name: 'structure.md', content: '# s' }], onRefresh, terminal: true,
    }));
  });
}

const q = <T extends Element = HTMLElement>(sel: string): T | null => container.querySelector<T>(sel);

/** Set a controlled textarea's value the way a user's typing reaches React. */
async function type(el: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

test('the review block renders all three verdicts: approve, revise, abandon', async () => {
  await mount(session());
  expect(q('[data-section="brain-review"]')).not.toBeNull();
  expect(q('[data-action="approve-brain"]')).not.toBeNull();
  expect(q('[data-action="revise-brain"]')).not.toBeNull();
  expect(q('[data-action="abandon-brain"]')).not.toBeNull();
  // The notes box is not on screen until the operator chooses to revise.
  expect(q('[data-field="brain-revise-notes"]')).toBeNull();
});

test('revise reveals the notes box; send is disabled WITH a reason while the notes are empty', async () => {
  await mount(session());
  await act(async () => { q('[data-action="revise-brain"]')!.click(); });
  const notes = q<HTMLTextAreaElement>('[data-field="brain-revise-notes"]');
  expect(notes).not.toBeNull();
  const send = q<HTMLButtonElement>('[data-action="send-brain-revise"]')!;
  expect(send.disabled).toBe(true);
  expect(send.getAttribute('data-disabled-reason')).toMatch(/notes/i);
  expect(send.getAttribute('title')).toBe(send.getAttribute('data-disabled-reason'));

  await type(notes!, '   ');
  expect(q<HTMLButtonElement>('[data-action="send-brain-revise"]')!.disabled).toBe(true);

  await type(notes!, 'the build command is npm run build');
  const ready = q<HTMLButtonElement>('[data-action="send-brain-revise"]')!;
  expect(ready.disabled).toBe(false);
  expect(ready.hasAttribute('data-disabled-reason')).toBe(false);
});

test('typing notes + send calls projectBrainRevise with them, then refreshes', async () => {
  const onRefresh = vi.fn();
  await mount(session(), onRefresh);
  await act(async () => { q('[data-action="revise-brain"]')!.click(); });
  await type(q<HTMLTextAreaElement>('[data-field="brain-revise-notes"]')!, 'drop the monorepo claim');
  await act(async () => { q('[data-action="send-brain-revise"]')!.click(); });

  expect(reviseMock).toHaveBeenCalledTimes(1);
  expect(reviseMock).toHaveBeenCalledWith({ project: 'demoproj', sessionId: 's1', feedback: 'drop the monorepo claim' });
  expect(approveMock).not.toHaveBeenCalled();
  expect(onRefresh).toHaveBeenCalled();
});

test('a failed revise shows the error and keeps the typed notes', async () => {
  reviseMock.mockResolvedValue({ ok: false, error: 'session is not awaiting review (phase: analyzing)' });
  await mount(session());
  await act(async () => { q('[data-action="revise-brain"]')!.click(); });
  await type(q<HTMLTextAreaElement>('[data-field="brain-revise-notes"]')!, 'fix the build line');
  await act(async () => { q('[data-action="send-brain-revise"]')!.click(); });

  expect(q('[data-section="brain-revise-error"]')?.textContent).toMatch(/not awaiting review/);
  expect(q<HTMLTextAreaElement>('[data-field="brain-revise-notes"]')!.value).toBe('fix the build line');
});

test('data-brain-round shows the round (1 when status carries none) and the copy says so', async () => {
  await mount(session());
  expect(q('[data-section="brain-review"]')!.getAttribute('data-brain-round')).toBe('1');
  expect(q('[data-section="brain-review"]')!.textContent).toMatch(/Draft round 1/);

  await act(async () => { root.unmount(); });
  root = createRoot(container);
  await mount(session({ round: 3 }));
  expect(q('[data-section="brain-review"]')!.getAttribute('data-brain-round')).toBe('3');
  expect(q('[data-section="brain-review"]')!.textContent).toMatch(/Draft round 3/);
});

test('approve still works from the three-verdict block', async () => {
  await mount(session({ round: 2 }));
  await act(async () => { q('[data-action="approve-brain"]')!.click(); });
  expect(approveMock).toHaveBeenCalledTimes(1);
  expect(reviseMock).not.toHaveBeenCalled();
});
