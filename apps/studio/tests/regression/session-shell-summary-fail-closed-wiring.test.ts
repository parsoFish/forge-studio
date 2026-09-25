/**
 * forge-5rr (projects-45): `/sessions/[kind]/[sessionId]` — WIRING pin for
 * the per-kind SUMMARY read's swallow-to-nothing catches.
 *
 * Why this page needed its OWN bespoke test rather than reusing
 * `detail-pages-fail-closed-wiring.test.ts`'s shared `expectFailClosedPrimitives`:
 * this page's `NotFound` branch is driven entirely by `fetchSessionShell` /
 * `deriveSessionShellViewState` (`lib/session-shell-view.ts`), which was
 * ALREADY correct — `viewState.status === 'no-session'` is reachable ONLY
 * off a genuine `errorKind === 'not-found'`, never a transport failure
 * (pinned at the pure-logic level, `apps/studio/tests/contract/session-shell-view.test.ts`
 * AT-63/AT-65). It renders via `StudioArchitectShell` + an inline
 * `FetchErrorState`, not the standalone `PageLoadError` component, so the
 * shared assertion's regexes cannot match it textually — that is why the
 * page is EXEMPT in `detail-pages-fail-closed-wiring.test.ts`, not COMPLIANT.
 *
 * The REAL defect the pending scan flagged ("several `.catch(() => {})`
 * sites... the same swallow-to-nothing shape crosscut-08 is about") lives
 * one level down: `refreshSummaryNow`'s four per-kind summary reads
 * (`fetchArchitectSessions` / `listInstructionsSessions` /
 * `fetchProjectBrainSessions` / `listDemoSessions`, all `bridgeReadOrThrow` —
 * fail-closed, THROW on failure) were caught into `.catch(() => {})` and
 * discarded. For `architect`/`project-brain` (not in `GENERIC_PANEL_KINDS`,
 * so they have no fallback panel) that silently blanked the ENTIRE left
 * column while the page still reported `viewState.status === 'ready'` — a
 * confidently-wrong "nothing here" exactly like the pre-fix `/agents/<id>`
 * blank builder this whole contract exists to prevent.
 *
 * Source-text pins, not rendered-DOM: this is a `use client` page whose
 * state arrives from an effect-driven fetch, which `renderToStaticMarkup`
 * never runs — same convention as `community-surface-wiring.test.ts` and
 * `detail-pages-fail-closed-wiring.test.ts`'s own header explains.
 *
 * DISCLOSED, NOT FIXED HERE: `fetchStagedThemes`'s own `.catch(() => {})`
 * (project-brain's staged-theme review) has the identical shape — a failed
 * read leaves `themes` at `[]`, and the panel's "0 draft theme(s)" copy
 * cannot distinguish that from a genuinely empty review. Left alone because
 * fixing it honestly means threading a themes-specific error through
 * `SessionProjectBrainPanel`'s props (a second component's public API), and
 * because it is materially less severe than the summary swallow: BOTH
 * self-heal on the next 3s poll (`SUMMARY_POLL_MS`/an unconditional
 * re-fetch), but the summary swallow blanked the whole panel meanwhile,
 * while this one only understates a count during the same brief window.
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PAGE_PATH = resolve(__dirname, '..', '..', 'app', 'sessions', '[kind]', '[sessionId]', 'page.tsx');
const read = (): string => readFileSync(PAGE_PATH, 'utf8');

/** The body of `refreshSummaryNow` — the ONLY function this bead's fix
 *  touches. Slicing it out means a change to the (deliberately untouched)
 *  staged-themes catch below it can never accidentally satisfy — or break —
 *  these assertions. */
function refreshSummaryNowBody(src: string): string {
  const start = src.indexOf('const refreshSummaryNow = useCallback(');
  expect(start, 'refreshSummaryNow not found — has it been renamed?').toBeGreaterThan(-1);
  const end = src.indexOf('}, [kind, sessionId]);', start);
  expect(end, 'refreshSummaryNow\'s closing `}, [kind, sessionId]);` not found').toBeGreaterThan(start);
  return src.slice(start, end);
}

test('refreshSummaryNow captures a failed per-kind summary read into summaryError — no catch discards it silently', () => {
  const body = refreshSummaryNowBody(read());
  // The bare swallow this fix removes. Every catch in this function must be
  // wired to something that OBSERVABLY changes state.
  expect(body).not.toMatch(/\.catch\(\(\) => \{\}\)/);
  // All four per-kind reads (architect / instructions / project-brain /
  // demo) share the same failure handler.
  const catchCount = (body.match(/\.catch\(fail\)/g) ?? []).length;
  expect(catchCount, 'expected all four summary reads to share one named failure handler').toBe(4);
});

test('a successful settle clears any previously-recorded summaryError — a stale error must not survive past the next good read', () => {
  const src = read();
  expect(src).toMatch(/const settle = \(next: KindSummary \| null\) => \{\s*setSummary\(next\);\s*setSummaryError\(null\);/);
});

test('summaryError is the shared {error,status} shape (fetchErrorPropsFrom), imported alongside FetchErrorState', () => {
  const src = read();
  expect(src).toMatch(/import \{ FetchErrorState, fetchErrorPropsFrom \} from '@\/components\/FetchErrorState'/);
  expect(src).toMatch(/useState<\{ error: string; status\?: number \} \| null>\(null\)/);
  const body = refreshSummaryNowBody(src);
  expect(body).toMatch(/const fail = \(err: unknown\) => setSummaryError\(fetchErrorPropsFrom\(err\)\);/);
});

test('architect / project-brain (the two kinds with NO generic-panel fallback) render a retryable error instead of a silent blank panel when their summary read fails', () => {
  const src = read();
  // Must be reachable ONLY when `summary` itself is still null (never papers
  // over a summary that DID resolve) and only for the two kinds that would
  // otherwise render nothing at all.
  expect(src).toMatch(/summaryError !== null && \(kind === 'architect' \|\| kind === 'project-brain'\)/);
  expect(src).toMatch(/<FetchErrorState[\s\S]{0,200}error=\{summaryError\.error\}/);
  expect(src).toMatch(/<FetchErrorState[\s\S]{0,300}onRetry=\{refreshSummary\}/);
  expect(src).toContain('data-section="session-summary-error"');
});
