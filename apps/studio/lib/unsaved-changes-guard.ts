/**
 * unsaved-changes-guard — agents-48: the agent builder page had no
 * `beforeunload` guard at all. `app/agents/[id]/page.tsx`'s dirty-guard
 * (`handleSelectAgent`) covers only the in-page agent switcher; a tab
 * close, reload, or top-nav `<Link>` navigation bypassed it entirely and
 * silently discarded unsaved edits despite the page's own "Unsaved
 * changes" indicator claiming otherwise.
 *
 * Extracted as a pure attach/detach function rather than inlined in the
 * page's `useEffect` (the pattern `app/projects/[id]/page.tsx` ~375-386
 * uses) because nothing in apps/studio mounts a `page.tsx` in this test
 * suite, and a `'use client'` Next page may only export Next's own
 * whitelisted names (`lib/page-exports-whitelist.test.ts`) — the guard
 * cannot live inline in the page and still be unit-tested. Behaviour
 * mirrors the projects page's own effect byte-for-byte: dirty blocks
 * close/reload with a native confirmation prompt, clean registers nothing.
 */

type UnloadTarget = {
  addEventListener(type: 'beforeunload', handler: (e: BeforeUnloadEvent) => void): void;
  removeEventListener(type: 'beforeunload', handler: (e: BeforeUnloadEvent) => void): void;
};

/**
 * Attach the guard while `dirty` is true; returns the cleanup a `useEffect`
 * hands back to React. A clean form registers no listener — there is
 * nothing to warn about, and removing the "if nothing to guard" branch
 * would arm the prompt on every page, dirty or not (see the mutation test).
 */
export function attachUnsavedChangesGuard(target: UnloadTarget, dirty: boolean): () => void {
  if (!dirty) return () => {};
  const handler = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    e.returnValue = '';
  };
  target.addEventListener('beforeunload', handler);
  return () => target.removeEventListener('beforeunload', handler);
}
