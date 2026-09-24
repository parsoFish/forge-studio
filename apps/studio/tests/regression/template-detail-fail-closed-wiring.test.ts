/**
 * forge-5rr (projects-45): `/templates/[id]` — the pending scan's note was
 * "no FetchErrorState/PageLoadError/catch visible near the read — possibly
 * a genuine gap." On inspection the not-found claim was ALREADY correctly
 * gated on a real bridge-answered HTTP 404 (`fetchTemplate`'s status-shaped,
 * never-throwing read — same shape as `/community/[kind]/[id]`'s) — but,
 * unlike its `/connections|/hooks|/skills/[id]` siblings, the error state
 * had NO Retry at all (a static banner) and no bridge-recovery resubscribe
 * (crosscut-22): a down bridge left the operator with no way forward short
 * of a manual page reload.
 *
 * Source-text pins (same convention as `community-surface-wiring.test.ts`'s
 * own header explains): a `use client` page with an effect-driven fetch,
 * invisible to `renderToStaticMarkup`.
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (): string => readFileSync(resolve(__dirname, '..', '..', 'app', 'templates', '[id]', 'page.tsx'), 'utf8');

test('the not-found claim is reachable ONLY off a genuine HTTP 404 — never a transport failure', () => {
  const src = read();
  expect(src).toMatch(/if \(r\.status === 404\) \{\s*setState\('not-found'\);/);
  expect(src).not.toMatch(/if \(!r\.ok\) \{\s*setState\('not-found'\)/);
});

test('a non-404 failure (bridge down or answered-but-refused) renders the shared PageLoadError with Retry, not a static dead-end banner', () => {
  const src = read();
  expect(src).toMatch(/import \{ PageLoadError \} from '@\/components\/PageLoadError'/);
  expect(src).toMatch(/import \{ useBridgeRecoveryWhenFailed \} from '@\/lib\/use-bridge-status'/);
  expect(src).toMatch(/useState<\{ error: string; status\?: number \} \| null>\(null\)/);
  expect(src).toMatch(/setLoadError\(\{ error: r\.error \?\? [^,]+, status: r\.status \}\)/);
  expect(src).toMatch(/<PageLoadError[\s\S]{0,200}page="template-detail"/);
  expect(src).toMatch(/<PageLoadError[\s\S]{0,400}onRetry=\{reload\}/);
});

test('a failed load re-fills on bridge recovery — never stuck until the operator presses Retry by hand', () => {
  const src = read();
  expect(src).toMatch(/useBridgeRecoveryWhenFailed\(\s*loadError !== null,\s*reload,?\s*\)/);
});
