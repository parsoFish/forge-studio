/**
 * unsaved-changes-guard.test.ts — agents-48: leaving the agent builder
 * silently discarded unsaved changes despite the "Unsaved changes"
 * indicator. `handleSelectAgent` (app/agents/[id]/page.tsx) guards only the
 * in-page agent switcher; a tab close, reload, or top-nav `<Link>`
 * navigation bypassed it entirely with no warning at all — contrast
 * `app/projects/[id]/page.tsx` ~375-386, which registers a `beforeunload`
 * guard for exactly this class of loss.
 *
 * RUN: cd apps/studio && npx vitest run tests/regression/unsaved-changes-guard.test.ts
 */
import { expect, test, vi } from 'vitest';

import { attachUnsavedChangesGuard } from '@/lib/unsaved-changes-guard';

function fakeWindow() {
  const listeners = new Map<string, (e: BeforeUnloadEvent) => void>();
  return {
    addEventListener: (type: string, fn: (e: BeforeUnloadEvent) => void) => { listeners.set(type, fn); },
    removeEventListener: (type: string) => { listeners.delete(type); },
    dispatch(event: { preventDefault: () => void; returnValue: string }) {
      listeners.get('beforeunload')?.(event as unknown as BeforeUnloadEvent);
    },
    has: (type: string) => listeners.has(type),
  };
}

test('THE DEFECT: a dirty form blocks the tab from closing — beforeunload is prevented and returnValue is set', () => {
  const win = fakeWindow();
  attachUnsavedChangesGuard(win, true);
  const event = { preventDefault: vi.fn(), returnValue: '' };
  win.dispatch(event);
  expect(event.preventDefault).toHaveBeenCalled();
  expect(event.returnValue).toBe('');
});

test('a clean form registers no guard at all — nothing to warn about', () => {
  const win = fakeWindow();
  attachUnsavedChangesGuard(win, false);
  expect(win.has('beforeunload')).toBe(false);
});

test('the cleanup function tears the listener down', () => {
  const win = fakeWindow();
  const cleanup = attachUnsavedChangesGuard(win, true);
  expect(win.has('beforeunload')).toBe(true);
  cleanup();
  expect(win.has('beforeunload')).toBe(false);
});
