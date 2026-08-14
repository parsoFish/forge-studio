/**
 * Call-site regression lock for `SessionCleanupPanel.tsx`'s SHIPPED BLOCKER
 * (R4-19-F2 WI-4c defect fix): `onApprove` (the "Approve & apply" button's
 * click handler) calls
 *
 *   const result = await applyKbCleanup(sessionId, { project, sessionId });
 *
 * `applyKbCleanup`'s FIRST argument is the KB id — it builds `POST
 * /api/studio/kbs/<id>/cleanup/apply` (forge-ui/lib/studio-client.ts). The
 * panel passes the SESSION id instead. Session ids are timestamp-first
 * (`newArchitectSessionId()`, cli/ui-bridge.ts — `2026-08-14T09-24-01-
 * a34fff82`-shaped) and the apply route validates the URL's `:id` segment
 * with `SLUG_RE` (`/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/`, orchestrator/
 * skill-path.ts) BEFORE any lookup (cli/ui-bridge.ts's `kbCleanupApplyMatch`
 * handler) — a timestamp-shaped session id never matches (it starts with a
 * digit, not `SLUG_RE`'s required leading `[a-z]`), so "Approve" always 400s
 * "invalid kb id" as shipped.
 *
 * WHY THIS IS A SOURCE-TEXT TEST, NOT A `renderToStaticMarkup` RENDER TEST
 * (mirrors `knowledge-page-kb-maintenance.test.ts`'s own header rationale for
 * the identical class of problem, and is DISTINCT from this directory's own
 * `SessionAuthoringPanel.test.ts`, which DOES render via
 * `renderToStaticMarkup`): that sibling file's own header states plainly
 * that `useState`/click-handler interaction does not run under
 * `renderToStaticMarkup` — it only captures the INITIAL synchronous render
 * pass. The bug this file exists to kill lives entirely inside `onApprove`'s
 * ASYNC BODY, which only ever runs after a real click event — a jsdom +
 * `@testing-library/react` (or equivalent) interaction harness would be a
 * NEW dependency this test-writer pass may not add (this repo's own stated
 * convention, restated in `SessionAuthoringPanel.test.ts`'s header for the
 * exact same limitation). So this file reads the REAL component source and
 * isolates the actual `applyKbCleanup(...)` call expression, then reasons
 * about the REAL identifier it passes — a faithful, non-lossy proxy for the
 * literal call the shipped component makes (the call text IS what executes;
 * there is no interpolation or dynamic call-site construction here to lose
 * fidelity over). What CANNOT be proven this way — that clicking the real
 * button in a real browser actually invokes this exact call with these exact
 * runtime values, and that the resulting fetch/response cycle updates the
 * DOM correctly — is explicitly left to the journey harness (see this WI's
 * task report).
 *
 * RUN: npx vitest run components/studio/session/SessionCleanupPanel.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PANEL_PATH = resolve(__dirname, './SessionCleanupPanel.tsx');

/** Mirrors `orchestrator/skill-path.ts`'s real `SLUG_RE` verbatim — the SAME
 *  regex `cli/ui-bridge.ts`'s `kbCleanupApplyMatch` handler runs against the
 *  apply route's `:id` URL segment (`if (!SLUG_RE.test(urlKbId)) { ... 400
 *  "invalid kb id" }`). Hand-copied, never cross-imported: forge-ui cannot
 *  import orchestrator TS directly (see forge-ui/lib/studio-client.ts's
 *  `MATERIAL_KINDS` comment for this file set's standing convention on why
 *  every such mirror is a deliberate, documented copy, not a shortcut). */
const SLUG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** A realistic KB id — a plain slug, e.g. what `writeKb('forge-dev', ...)`
 *  fixtures across this campaign's server-side tests use. */
const REALISTIC_KB_ID = 'forge-dev';

/** A realistic SESSION id — `newArchitectSessionId()`'s real shape
 *  (cli/ui-bridge.ts): `YYYY-MM-DDTHH-mm-ss` plus an 8-hex-char entropy
 *  suffix. Matches the exact fixture shape `forge-ui/lib/studio-client.
 *  test.ts`'s AT-F2-2/AT-F2-5 already use for a real sessionId. */
const REALISTIC_SESSION_ID = '2026-08-14T09-24-01-a34fff82';

/** Realistic fixture values, keyed by the identifier NAME a correct/buggy
 *  call site could plausibly pass as `applyKbCleanup`'s first argument.
 *  `onApprove`'s only two in-scope identifiers are the panel's own `kbId`
 *  prop (the fix) and its `sessionId` prop (the shipped bug) — see the
 *  component's own destructured parameter list. */
const CALL_SITE_ID_FIXTURES: Record<string, string> = {
  kbId: REALISTIC_KB_ID,
  sessionId: REALISTIC_SESSION_ID,
};

const source = readFileSync(PANEL_PATH, 'utf8');

/** Isolates the argument list text of the REAL `applyKbCleanup(...)` call in
 *  the component's source — e.g. `"sessionId, { project, sessionId }"` as
 *  shipped. Throws loudly (never a silently-empty extraction) if the call
 *  site cannot be found at all — a missing anchor must never be mistaken for
 *  "the call passes no arguments". The object literal has no parens of its
 *  own, so the first `)` after `applyKbCleanup(` is genuinely the call's
 *  closing paren — no paren-depth walk is needed (unlike the brace-matching
 *  `extractFunctionBody` precedent, whose target CAN nest braces). */
function extractApplyKbCleanupCallArgs(src: string): string {
  const match = src.match(/applyKbCleanup\(([\s\S]*?)\)/);
  if (!match) {
    throw new Error(`extractApplyKbCleanupCallArgs: no "applyKbCleanup(...)" call found in ${PANEL_PATH} — has the call site moved, been renamed, or been refactored into a helper?`);
  }
  return match[1];
}

/** Isolates the FIRST top-level argument's identifier from the extracted
 *  call-args text — e.g. `"sessionId"` from `"sessionId, { project,
 *  sessionId }"`. Splitting on the first `,` is safe here specifically
 *  because the SECOND argument is the object literal (its own internal
 *  commas never appear before the outer split point). */
function firstArgIdentifier(callArgs: string): string {
  const first = callArgs.split(',')[0]?.trim();
  if (!first) {
    throw new Error(`firstArgIdentifier: could not isolate a first argument from call-args text: ${JSON.stringify(callArgs)}`);
  }
  return first;
}

const callArgs = extractApplyKbCleanupCallArgs(source);

test('precondition: the extracted applyKbCleanup(...) call really is the approve action\'s real call site, and there is exactly one such call in the file — anchors the extraction itself; if this fails, the RED tests below are meaningless', () => {
  expect(callArgs).toContain('project');
  expect(callArgs).toContain('sessionId');
  const occurrences = (source.match(/applyKbCleanup\(/g) ?? []).length;
  expect(occurrences, 'expected exactly one applyKbCleanup(...) call site in SessionCleanupPanel.tsx — a second, unexpected call would make "the" extracted call ambiguous').toBe(1);
});

test('sanity anchor: the two realistic id fixtures genuinely disagree on SLUG_RE (a slug-shaped kb id passes, a timestamp-shaped session id fails) — otherwise the RED tests below could never distinguish which identifier the call site actually passes', () => {
  expect(SLUG_RE.test(REALISTIC_KB_ID)).toBe(true);
  expect(SLUG_RE.test(REALISTIC_SESSION_ID)).toBe(false);
});

test('R4-19-F2 WI-4c AT-CALL-1 (RED — the regression lock for the shipped argument swap): the apply URL built from SessionCleanupPanel\'s REAL applyKbCleanup(...) call site is built from the KB id, not the session id — contains the kb slug, does NOT contain the session id', () => {
  const arg = firstArgIdentifier(callArgs);
  const idUsed = CALL_SITE_ID_FIXTURES[arg];
  expect(
    idUsed,
    `firstArgIdentifier extracted "${arg}" from the real call site, but no realistic fixture is defined for it in CALL_SITE_ID_FIXTURES — update the fixture map above if the call site's variable names changed`,
  ).toBeDefined();

  // Mirrors applyKbCleanup's OWN url construction verbatim
  // (forge-ui/lib/studio-client.ts: `/api/studio/kbs/${encodeURIComponent(id)}/cleanup/apply`).
  const url = `/api/studio/kbs/${encodeURIComponent(idUsed)}/cleanup/apply`;

  expect(url, `expected the apply URL built from the panel's REAL call site to contain the kb slug "${REALISTIC_KB_ID}" — got: ${url} (built from identifier "${arg}")`).toContain(REALISTIC_KB_ID);
  expect(url, `expected the apply URL built from the panel's REAL call site to NOT contain the session id "${REALISTIC_SESSION_ID}" — got: ${url} (built from identifier "${arg}") — this is the shipped argument swap`).not.toContain(REALISTIC_SESSION_ID);
});

test('R4-19-F2 WI-4c AT-CALL-2 (RED — proves the swap is FATAL by construction, not just "two strings differ"): the id value SessionCleanupPanel\'s REAL applyKbCleanup(...) call site passes as the URL\'s ":id" segment must satisfy the server\'s own SLUG_RE — cli/ui-bridge.ts\'s kbCleanupApplyMatch handler runs this exact check BEFORE any KB lookup and 400s "invalid kb id" on failure, which is WHY the shipped swap can never complete, not merely why it looks wrong', () => {
  const arg = firstArgIdentifier(callArgs);
  const idUsed = CALL_SITE_ID_FIXTURES[arg];
  expect(idUsed, `no realistic fixture defined for extracted identifier "${arg}"`).toBeDefined();

  expect(
    SLUG_RE.test(idUsed),
    `the value SessionCleanupPanel's REAL call site actually passes ("${idUsed}", from identifier "${arg}") does not match SLUG_RE (${SLUG_RE}) — the server's real, first-line validation (cli/ui-bridge.ts's kbCleanupApplyMatch handler) — which is exactly why "Approve" 400s "invalid kb id" as shipped`,
  ).toBe(true);
});
