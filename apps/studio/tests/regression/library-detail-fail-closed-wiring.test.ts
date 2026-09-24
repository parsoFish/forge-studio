/**
 * forge-5rr (projects-45): `/connections/[id]`, `/hooks/[id]`, `/skills/[id]`
 * — the pending scan's three "unverified" siblings ("Renders NotFound AND
 * an inline FetchErrorState with its own error/errorStatus state — not the
 * shared kit; unverified whether a transport failure reaches it.").
 *
 * On inspection all three already had the crosscut-08 defect class CLOSED:
 * each page's own `fetch<Thing>Detail`-shaped read never throws (a
 * `{ok,status?,error?}` result, same shape as `/community/[kind]/[id]`'s),
 * and each page's `not-found` state is reachable ONLY off a real,
 * bridge-answered HTTP 404 (`r.status === 404`) — never a transport
 * failure. Each ALSO already had a working Retry (`onRetry={() => { if (id)
 * void load(id); }}`) wired to its inline `FetchErrorState`. The one thing
 * missing on all three, uniformly: no bridge-recovery resubscribe
 * (crosscut-22) — a down bridge that comes back never self-heals the page;
 * the operator must press Retry by hand.
 *
 * Source-text pins (same convention as `community-surface-wiring.test.ts`
 * and `detail-pages-fail-closed-wiring.test.ts`'s own header explains): all
 * three are `use client` pages with effect-driven fetches, invisible to
 * `renderToStaticMarkup`.
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string): string => readFileSync(resolve(__dirname, '..', '..', rel), 'utf8');

const PAGES = [
  { name: 'connections', path: 'app/connections/[id]/page.tsx', notFoundGuard: /if \(r\.status === 404\) \{\s*setState\('not-found'\);/ },
  { name: 'hooks', path: 'app/hooks/[id]/page.tsx', notFoundGuard: /if \(r\.status === 404\) \{\s*setState\('not-found'\);/ },
  { name: 'skills', path: 'app/skills/[id]/page.tsx', notFoundGuard: /if \(skillResult\.status === 404\) \{\s*setState\('not-found'\);/ },
];

for (const { name, path, notFoundGuard } of PAGES) {
  test(`${name} detail: the not-found claim is reachable ONLY off a genuine HTTP 404 — never a transport failure`, () => {
    const src = read(path);
    expect(src).toMatch(notFoundGuard);
  });

  test(`${name} detail: already had a working Retry wired to its FetchErrorState (measured, not assumed)`, () => {
    const src = read(path);
    expect(src).toMatch(/<FetchErrorState[\s\S]{0,300}onRetry=\{\(\) => \{ if \(id\) void load\(id\); \}\}/);
  });

  test(`${name} detail: a failed load now re-fills on bridge recovery too — never stuck until the operator presses Retry by hand`, () => {
    const src = read(path);
    expect(src).toMatch(/import \{ useBridgeRecoveryWhenFailed \} from '@\/lib\/use-bridge-status'/);
    expect(src).toMatch(/useBridgeRecoveryWhenFailed\(\s*state === 'error',\s*\(\) => \{ if \(id\) void load\(id\); \},?\s*\)/);
  });
}
