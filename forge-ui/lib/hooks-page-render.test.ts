/**
 * Render pins for the /hooks library page's search box + community union
 * (W8-B4, library-38 S2 REGRESSION — a regression introduced by the
 * library-11 fix).
 *
 * ACTUAL, as measured at the wave-7 gate: the `/hooks` search box never
 * filtered the COMMUNITY section, so "No hooks match your search." rendered
 * DIRECTLY ABOVE a matching community card — the page asserted "no matches"
 * while displaying a match. Root cause: `app/hooks/page.tsx` derived
 * `communityHooks` via `communityHooksToUnion(communityItems, …)` with NO
 * query applied, while the local list WAS query-filtered
 * (`filterHooks(entries, query)`); the empty state was gated on the local
 * `filtered.length === 0` alone.
 *
 * This file renders the REAL `HookLibraryResults` component
 * (components/studio/HookLibraryResults.tsx) — the presentational results
 * block `app/hooks/page.tsx` now delegates to, extracted specifically so
 * this file can pin it with fixed props via react-dom/server's
 * renderToStaticMarkup, mirroring lib/library-hub-render.test.ts's own
 * precedent for `components/studio/LibraryHub.tsx` (same rationale: a page
 * component with its own fetch/useEffect can't be usefully pinned this way,
 * so the pure, props-driven render block is extracted and exported).
 * It lives under components/studio/, NOT inside app/hooks/page.tsx itself —
 * a page.tsx file may only export Next's own whitelisted route exports
 * (default, metadata, ...); a stray extra named export there fails
 * `next build`'s generated route-type check (confirmed by reproducing that
 * exact tsc error before moving this component out). No jsdom (this repo's
 * vitest config is `environment: 'node'`, per hook-library-view.test.ts's
 * own header) — renderToStaticMarkup needs none.
 *
 * Also pins library-09 (S2 PARTIAL — approval invisible on the index) at
 * ITS first call site (`app/hooks/page.tsx`'s `HookCard`, rendered here via
 * `HookLibraryResults`) — see lib/library-hub-render.test.ts for the SECOND
 * call site's pin (`components/studio/LibraryHub.tsx`'s `ShelfHookCard`).
 *
 * RUN: npx vitest run lib/hooks-page-render.test.ts   (from forge-ui/)
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { HookLibraryResults } from '@/components/studio/HookLibraryResults';
import type { HookLibraryEntry, HookLibraryEntryOk } from './hook-client.ts';
import type { CommunityItem } from './community-client.ts';

// ---------------------------------------------------------------------------
// Fixtures — mirrors hook-library-view.test.ts's okEntry + community-view /
// library-hub-render.test.ts's makeCommunityItem conventions exactly.
// ---------------------------------------------------------------------------

function okEntry(overrides: Partial<HookLibraryEntryOk> & { id: string }): HookLibraryEntryOk {
  return {
    ok: true,
    name: overrides.id,
    description: '',
    on: 'PreToolUse',
    permissions: { env: [], read: [], network: false },
    carriedBy: [],
    carriedByDerivation: { source: 'skills/*/SKILL.md (composition.hooks)', scanned: 0 },
    scanVerdict: 'clean',
    trust: 'needs-review',
    runnable: false,
    ...overrides,
  };
}

function communityHookItem(id: string, overrides: Partial<CommunityItem> = {}): CommunityItem {
  return {
    id, kind: 'hook', name: id, desc: '', upstream: '', hub: null, signals: null,
    vendored: false, installState: 'not-installed', probeState: null, origin: 'catalog',
    fetchedAt: null, fetchedBy: 'seed', upstreamUpdatedAt: null,
    ...overrides,
  };
}

function render(props: Parameters<typeof HookLibraryResults>[0]): string {
  return renderToStaticMarkup(React.createElement(HookLibraryResults, props));
}

const NO_MATCH_TEXT = 'No hooks match your search.';

// ---------------------------------------------------------------------------
// Pin 1 (library-38): a query matching ONLY a community hook renders the
// community card AND does NOT render the empty state. This is the EXACT
// contradiction the gate observed — assert both halves in one test.
// ---------------------------------------------------------------------------

test('library-38 pin 1: a query matching only a community hook renders its card and NOT the empty state', () => {
  const html = render({
    status: 'ready',
    error: null,
    query: 'block-protected-branch',
    filtered: [], // the local list has nothing matching
    communityHooks: [communityHookItem('block-protected-branch-push', { name: 'block-protected-branch-push' })],
  });
  expect(html).toContain('data-card-type="community-hook"');
  expect(html).toContain('data-hook-id="block-protected-branch-push"');
  expect(html).not.toContain(NO_MATCH_TEXT);
});

// ---------------------------------------------------------------------------
// Pin 2 (library-38, the CONTROL): a query matching nothing in EITHER list
// DOES render the empty state. Without this pin, pin 1 could be satisfied
// by "never show the empty state at all" — this proves the empty state
// still fires for a genuine no-match.
// ---------------------------------------------------------------------------

test('library-38 pin 2 (control): a query matching nothing in either list renders the empty state', () => {
  const html = render({
    status: 'ready',
    error: null,
    query: 'this-matches-absolutely-nothing-xyz',
    filtered: [],
    communityHooks: [],
  });
  expect(html).toContain(NO_MATCH_TEXT);
});

// ---------------------------------------------------------------------------
// Pin 3 (library-38, no regression): a query matching only a LOCAL hook
// still renders that card, with no empty state, exactly as before the fix.
// ---------------------------------------------------------------------------

test('library-38 pin 3: a query matching only a local hook still renders its card, no regression', () => {
  const html = render({
    status: 'ready',
    error: null,
    query: 'pre-pr-security-review',
    filtered: [okEntry({ id: 'pre-pr-security-review', name: 'pre-pr-security-review' })],
    communityHooks: [],
  });
  expect(html).toContain('data-card-type="hook"');
  expect(html).toContain('data-hook-id="pre-pr-security-review"');
  expect(html).not.toContain(NO_MATCH_TEXT);
});

// ---------------------------------------------------------------------------
// Pin 4 (library-09, first call site): hookBadges() emits a positive
// "approved" badge for an approved entry, and it is actually VISIBLE in the
// rendered card markup here — not just returned by the pure function (see
// hook-library-view.test.ts for the function-level pin). See
// lib/library-hub-render.test.ts for the SECOND call site
// (components/studio/LibraryHub.tsx's ShelfHookCard).
// ---------------------------------------------------------------------------

test('library-09 pin 4 (call site 1: app/hooks/page.tsx HookCard): an approved hook renders a visible "approved" badge', () => {
  const html = render({
    status: 'ready',
    error: null,
    query: '',
    filtered: [okEntry({ id: 'approved-hook', name: 'approved-hook', trust: 'approved', scanVerdict: 'clean' })],
    communityHooks: [],
  });
  expect(html).toContain('data-hook-trust="approved"');
  expect(html).toContain('>approved<');
});

// ---------------------------------------------------------------------------
// Pin 5 (library-09, negative arms unchanged): needs-review / overridden /
// blocked still render their own badges — the fix is not "always show
// approved" or "stop showing the others".
// ---------------------------------------------------------------------------

test('library-09 pin 5: needs-review, overridden and blocked badges still render (the fix is not "always show approved")', () => {
  const html = render({
    status: 'ready',
    error: null,
    query: '',
    filtered: [
      okEntry({ id: 'needs-review-hook', name: 'needs-review-hook', trust: 'needs-review', scanVerdict: 'clean' }),
      okEntry({ id: 'overridden-hook', name: 'overridden-hook', trust: 'overridden', scanVerdict: 'blocked' }),
    ],
    communityHooks: [],
  });
  expect(html).toContain('data-hook-trust="needs-review"');
  expect(html).toContain('>needs-review<');
  expect(html).toContain('data-hook-trust="overridden"');
  expect(html).toContain('>overridden<');
  // the overridden hook's verdict STAYS blocked — never laundered, at the
  // render layer too (mirrors hook-library-view.test.ts's own pin).
  expect(html).toContain('data-hook-verdict="blocked"');
  expect(html).toContain('>blocked<');
});

// ---------------------------------------------------------------------------
// Supporting coverage: data-section="community-hooks" data-count reflects
// the ALREADY-FILTERED communityHooks length (the count prop this component
// receives, not a re-derivation) — HookLibraryResults never re-filters.
// ---------------------------------------------------------------------------

test('the community section\'s data-count matches the (already-filtered) communityHooks length it was given', () => {
  const html = render({
    status: 'ready',
    error: null,
    query: 'irrelevant-to-this-check',
    filtered: [],
    communityHooks: [communityHookItem('a'), communityHookItem('b')],
  });
  expect(html).toContain('data-section="community-hooks" data-count="2"');
});

test('an empty communityHooks array renders no community section at all', () => {
  const html = render({
    status: 'ready',
    error: null,
    query: '',
    filtered: [okEntry({ id: 'a' })],
    communityHooks: [],
  });
  expect(html).not.toContain('data-section="community-hooks"');
});
