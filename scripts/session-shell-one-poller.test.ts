/**
 * Acceptance test — sessions-kinds-37: the generic session shell page
 * (`/sessions/[kind]/[sessionId]`) drives its shell read AND its per-kind
 * summary read off ONE poller, not two independent 3s `setInterval` timers.
 *
 * THE DEFECT: the page ran `setInterval(refreshShell, SHELL_POLL_MS)` in one
 * `useEffect` and `setInterval(refreshSummary, SUMMARY_POLL_MS)` in a
 * second, completely independent `useEffect` — two uncoordinated timers on
 * the same page, each firing its own network read on its own clock. That is
 * the exact "two independent polls" shape this campaign has already
 * diagnosed and closed once for Home (`home-no-new-polling.test.ts`) and
 * once inside this very page for the artifact/summary race
 * (`GenerationGallery.tsx`'s own R4-16 header comment).
 *
 * Source-level pin (same technique as `session-artifact-threading.test.ts` /
 * `home-no-new-polling.test.ts`): the page is a hook-heavy client component
 * with real poll loops — asserting on rendered behaviour would need the
 * whole bridge mocked, so the wiring is pinned structurally instead: exactly
 * one `setInterval(` call site may exist in the page source, and the
 * per-kind summary read stays gated behind the existing, already-tested
 * `shouldPollSessionSummary` predicate (`lib/session-shell-view.ts`) so a
 * legacy/settled session still does not poll it — the unification must not
 * regress forge-d5ib.
 *
 * RUN: node --test --experimental-strip-types scripts/session-shell-one-poller.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(ROOT, 'apps', 'studio', 'app', 'sessions', '[kind]', '[sessionId]', 'page.tsx');

test('sessions-kinds-37: the session shell page opens exactly ONE setInterval poller, not two independent ones', () => {
  const src = readFileSync(PAGE, 'utf8');
  const matches = src.match(/setInterval\(/g) ?? [];
  assert.equal(matches.length, 1, `expected exactly one setInterval(...) call site in the session shell page, found ${matches.length}`);
});

test('sessions-kinds-37: the one poller still gates the per-kind summary read behind shouldPollSessionSummary (forge-d5ib must not regress)', () => {
  const src = readFileSync(PAGE, 'utf8');
  assert.ok(
    src.includes('shouldPollSessionSummary'),
    'the unified poller must still consult shouldPollSessionSummary before refetching the per-kind summary',
  );
});
