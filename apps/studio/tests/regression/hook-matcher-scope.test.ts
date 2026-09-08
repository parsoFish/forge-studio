// @vitest-environment jsdom
/**
 * `/hooks/new` offers a matcher only where one can be honoured — the product
 * half of story S7 beats 7–10 (T1 ruling 415).
 *
 * WHAT WAS MEASURED. S7 beat 7 fills eight fields and presses `create-hook`,
 * and the run reported no fill error and no press error — it failed on
 *
 *     ✗ 7. Write the hook by hand …
 *          no real-nav path to "/hooks/story-s7-hook" from "/hooks/new"
 *
 * i.e. every act landed and the page stayed put. The cause was the server
 * refusing the create: the beat declares `matcher: '*'` on `SessionEnd`, and
 * `hookTriggerError` (`packages/library/studio/hook-library.ts:151-166`)
 * rejects a matcher on an event that carries no tool — "a matcher can only be
 * honoured on PreToolUse or PostToolUse. Dispatch would never fire this
 * hook." Beats 8, 9 and 10 sat behind it.
 *
 * THE SERVER RULE IS RIGHT AND IS NOT WHAT CHANGED. It is W8-B6, documented
 * at its own definition, and already pinned by a door test with this exact
 * payload (`bridge-studio-community.test.ts`'s vendored-trigger case and
 * `bridge-studio-hooks.test.ts:680-698`). What was wrong is that the FORM
 * offered a field the selected event could never honour, so an operator
 * could fill it in and learn only on submit. The beat's own matcher fill is
 * removed by a separate, attended story amendment; this file is the product
 * half.
 *
 * TWO ASSERTIONS, AND THE SECOND IS THE ONE THAT MATTERS. Hiding a control
 * does not clear its state: type a matcher on PreToolUse, switch the event to
 * SessionEnd, and the input disappears while the value is still held. A fix
 * that only stopped RENDERING the field would still SEND it, and the create
 * would still 400 — the same dead end with the cause now invisible. So the
 * gate lives at the submit boundary too, and the second test presses that
 * exact sequence rather than trusting the first.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import NewHookPage from '@/app/hooks/new/page';

// The parameter is declared because this test READS it: `vi.fn(async () => …)`
// types `mock.calls[0]` as the empty tuple, so indexing it is a type error —
// and a mock whose recorded arguments cannot be inspected cannot answer the
// question this file exists to ask (what was SENT, not merely what rendered).
type CreateHookInput = Record<string, unknown>;
const createHook = vi.fn(
  async (_input: CreateHookInput) => ({ ok: true, id: 'story-s7-hook' }) as { ok: boolean; id?: string; error?: string },
);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/hooks/new',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}));

vi.mock('@/lib/hook-client', async (importOriginal) => {
  // The real constants and predicate — only the network call is stubbed, so a
  // drift in the mirrored event list would surface here rather than be mocked
  // away by a hand-written copy of the list.
  const real = await importOriginal<typeof import('@/lib/hook-client')>();
  return { ...real, createHook: (input: CreateHookInput) => createHook(input) };
});

// The page mounts `AuthoringLauncher` alongside the manual form (the operator
// ruling that both doors are real), so this file's mocks must cover that
// subtree too — these two exports are its, not the hook form's.
vi.mock('@/lib/studio-client', () => ({
  fetchStudioProjects: vi.fn(async () => []),
  fetchAgentCapability: vi.fn(async () => ({ allowedTiers: [], strategy: 'fixed' })),
}));

vi.mock('@/lib/bridge-client', () => ({
  startAuthoring: vi.fn(async () => ({ ok: true, sessionId: 'unused-by-this-file' })),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  createHook.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function setControlled(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}

const field = (name: string) => container.querySelector(`[data-field="${name}"]`);

async function mount(): Promise<void> {
  await act(async () => { root.render(React.createElement(NewHookPage)); });
  await act(async () => { await Promise.resolve(); });
}

test('415: a tool-scoped event offers the matcher; a tool-less one replaces it with the reason', async () => {
  await mount();

  setControlled(field('hook-on') as HTMLSelectElement, 'PreToolUse');
  await act(async () => { await Promise.resolve(); });
  expect(field('hook-matcher'), 'PreToolUse carries a tool, so a matcher is meaningful').not.toBeNull();

  setControlled(field('hook-on') as HTMLSelectElement, 'SessionEnd');
  await act(async () => { await Promise.resolve(); });
  expect(field('hook-matcher'), 'SessionEnd carries no tool — the server would refuse any matcher').toBeNull();

  const note = container.querySelector('[data-section="hook-matcher-unavailable"]');
  expect(note, 'the field must not simply vanish — the operator is told why').not.toBeNull();
  expect(note!.getAttribute('data-matcher-unavailable-event')).toBe('SessionEnd');
});

test('415: a matcher typed under a tool-scoped event is NOT SENT after switching to a tool-less one', async () => {
  await mount();

  setControlled(field('hook-on') as HTMLSelectElement, 'PreToolUse');
  await act(async () => { await Promise.resolve(); });
  setControlled(field('hook-matcher') as HTMLInputElement, 'Bash(gh pr create)');
  await act(async () => { await Promise.resolve(); });

  // The operator changes their mind about the event. The input disappears;
  // its VALUE does not, and that is the whole point of this test.
  setControlled(field('hook-on') as HTMLSelectElement, 'SessionEnd');
  setControlled(field('hook-name') as HTMLInputElement, 'story S7 hook');
  setControlled(field('hook-description') as HTMLInputElement, 'Note that a session ended.');
  setControlled(field('hook-script-body') as HTMLTextAreaElement, '#!/usr/bin/env bash\nexit 0\n');
  await act(async () => { await Promise.resolve(); });

  await act(async () => { (container.querySelector('[data-action="create-hook"]') as HTMLButtonElement).click(); });
  await act(async () => { await Promise.resolve(); });

  expect(createHook).toHaveBeenCalledTimes(1);
  const payload = createHook.mock.calls[0][0];
  expect(payload.on).toBe('SessionEnd');
  expect(
    Object.hasOwn(payload, 'matcher'),
    'sending a matcher the server must reject is the dead end this fix exists to close',
  ).toBe(false);
});
