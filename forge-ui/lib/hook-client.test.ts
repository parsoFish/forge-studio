/**
 * Tests for forge-ui/lib/hook-client.ts (R3-03-F4) — DOES NOT EXIST YET.
 * Vitest cannot even collect this file until it lands (module-not-found is
 * the expected red, mirroring skill-library-view.test.ts's own header note).
 *
 * hook-client.ts mirrors skill-client.ts's role exactly — client-side fetch
 * helpers + types for the `/api/studio/hooks*` bridge routes (see
 * cli/bridge-studio-hooks.ts's own header for the transport shapes this
 * carries through verbatim) — extracted straight into its own file (not
 * added to studio-client.ts, which already has zero headroom under this
 * repo's file-size discipline) the same way skill-client.ts and
 * template-client.ts were split out.
 *
 * ---------------------------------------------------------------------------
 * ONE DELIBERATE DEVIATION FROM skill-client.ts, flagged here (full rationale
 * in the T3 final report): skill-client.ts's `parseSkillLibraryEntry` /
 * `parseSkillDetail` are PRIVATE — nothing in this repo tests them directly,
 * which is exactly how skill-client.ts's own `usedBy: Array.isArray(x) ? x :
 * []` permissive-parse bug shipped un-pinned (an unreachable/malformed
 * `usedBy` silently became a confident empty array instead of a surfaced
 * error). template-client.ts fixed the STYLE (throws on a malformed
 * required field) but still doesn't export its parser for direct testing.
 * studio-client.ts's `parseCapability` IS exported and IS unit-tested
 * directly (studio-client.test.ts) — that is the real, already-proven
 * precedent for pinning client-side parse behaviour without fetch/DOM.
 * hook-client.ts is required to EXPORT `parseHookLibraryEntry` /
 * `parseHookDetail` so this exact coverage gap cannot recur here. This file
 * tests ONLY those two pure functions — no fetch, no window, no jsdom (this
 * repo's vitest config is `environment: 'node'` with no DOM; that is a
 * standing decision, not an oversight, and this file does not need to touch
 * it: `resolveBridgeUrl()` requires `window`, which does not exist under
 * plain node — testing the async fetchers end-to-end would require stubbing
 * globals with no precedent anywhere in this codebase, so it is left to the
 * bridge-route tests (cli/bridge-studio-hooks.test.ts) to pin the over-the-
 * wire behaviour, and to this file to pin the parse boundary in isolation).
 * ---------------------------------------------------------------------------
 */
import { test, expect } from 'vitest';
import { parseHookLibraryEntry, parseHookDetail } from './hook-client.ts';

// ---------------------------------------------------------------------------
// parseHookLibraryEntry — the ok:true (well-formed) branch
// ---------------------------------------------------------------------------

const WELL_FORMED_OK_ENTRY = {
  ok: true,
  id: 'pre-pr-security-review',
  name: 'pre-pr-security-review',
  description: 'Run security-review before any PR-creating command.',
  on: 'PreToolUse',
  matcher: 'Bash(gh pr create)',
  permissions: { env: [], read: [], network: false },
  carriedBy: ['developer-ralph'],
  carriedByDerivation: { source: 'skills/*/SKILL.md (composition.hooks)', scanned: 12 },
  scanVerdict: 'clean',
  trust: 'approved',
  runnable: true,
};

test('parseHookLibraryEntry: a well-formed ok:true entry round-trips every field verbatim', () => {
  const parsed = parseHookLibraryEntry(WELL_FORMED_OK_ENTRY);
  expect(parsed).toEqual(WELL_FORMED_OK_ENTRY);
});

test('parseHookLibraryEntry: matcher is legitimately optional — absent stays undefined, never coerced to a string', () => {
  const { matcher: _drop, ...withoutMatcher } = WELL_FORMED_OK_ENTRY;
  const parsed = parseHookLibraryEntry(withoutMatcher);
  expect(parsed.ok).toBe(true);
  expect((parsed as { matcher?: string }).matcher).toBeUndefined();
});

// ---------------------------------------------------------------------------
// parseHookLibraryEntry — the ok:false (malformed) branch: exactly the
// discriminated-union shape hook-library.ts's own listHookLibrary produces
// (see that module's header comment on HookLibraryEntry) — carries NO
// hook-shaped keys at all.
// ---------------------------------------------------------------------------

const MALFORMED_ENTRY = {
  ok: false,
  id: 'malformed-hook',
  carriedBy: [],
  carriedByDerivation: { source: 'skills/*/SKILL.md (composition.hooks)', scanned: 3 },
  error: 'studio/hooks/malformed-hook/hook.yaml: "on" must be one of PreToolUse, PostToolUse, ...',
};

test('parseHookLibraryEntry: a malformed ok:false entry round-trips id/carriedBy/carriedByDerivation/error and NOTHING else', () => {
  const parsed = parseHookLibraryEntry(MALFORMED_ENTRY);
  expect(parsed).toEqual(MALFORMED_ENTRY);
  expect(Object.keys(parsed).sort()).toEqual(['carriedBy', 'carriedByDerivation', 'error', 'id', 'ok']);
});

// ---------------------------------------------------------------------------
// THE permissive-parse refusal — skill-client.ts / template-client.ts's
// `Array.isArray(x) ? x : []` shape turned a malformed/missing array into a
// confident empty answer. hook-client.ts must REFUSE (throw) instead — this
// is also "the empty-vs-unknown distinction" the pure view-state module
// (hook-library-view.ts) relies on upstream of itself: a REAL `carriedBy: []`
// (scanned N, found none) must never be indistinguishable from a malformed
// transport that silently became `[]`.
// ---------------------------------------------------------------------------

test('parseHookLibraryEntry: carriedBy missing or non-array THROWS — never silently coerced to []', () => {
  const { carriedBy: _drop, ...missingCarriedBy } = WELL_FORMED_OK_ENTRY;
  expect(() => parseHookLibraryEntry(missingCarriedBy)).toThrow();
  expect(() => parseHookLibraryEntry({ ...WELL_FORMED_OK_ENTRY, carriedBy: 'not-an-array' })).toThrow();
  expect(() => parseHookLibraryEntry({ ...WELL_FORMED_OK_ENTRY, carriedBy: null })).toThrow();
});

test('parseHookLibraryEntry: carriedByDerivation missing, non-object, or with a wrong-typed field THROWS — never defaulted to {source:"",scanned:0}', () => {
  const { carriedByDerivation: _drop, ...missing } = WELL_FORMED_OK_ENTRY;
  expect(() => parseHookLibraryEntry(missing)).toThrow();
  expect(() => parseHookLibraryEntry({ ...WELL_FORMED_OK_ENTRY, carriedByDerivation: 'nope' })).toThrow();
  expect(() => parseHookLibraryEntry({ ...WELL_FORMED_OK_ENTRY, carriedByDerivation: { source: 'x' } })).toThrow();
  expect(() => parseHookLibraryEntry({ ...WELL_FORMED_OK_ENTRY, carriedByDerivation: { source: 1, scanned: 2 } })).toThrow();
  expect(() => parseHookLibraryEntry({ ...WELL_FORMED_OK_ENTRY, carriedByDerivation: { source: 'x', scanned: '2' } })).toThrow();
});

test('parseHookLibraryEntry: an unrecognised `on` value THROWS — never coerced to a guessed lifecycle event', () => {
  expect(() => parseHookLibraryEntry({ ...WELL_FORMED_OK_ENTRY, on: 'PreCommit' })).toThrow();
  expect(() => parseHookLibraryEntry({ ...WELL_FORMED_OK_ENTRY, on: undefined })).toThrow();
});

test('parseHookLibraryEntry: an unrecognised `scanVerdict` value THROWS', () => {
  expect(() => parseHookLibraryEntry({ ...WELL_FORMED_OK_ENTRY, scanVerdict: 'suspicious' })).toThrow();
});

test('parseHookLibraryEntry: an unrecognised `trust` value THROWS — never defaulted to the most permissive label', () => {
  expect(() => parseHookLibraryEntry({ ...WELL_FORMED_OK_ENTRY, trust: 'trusted' })).toThrow();
});

test('parseHookLibraryEntry: `runnable` missing or non-boolean THROWS — never defaulted to false or true', () => {
  const { runnable: _drop, ...missing } = WELL_FORMED_OK_ENTRY;
  expect(() => parseHookLibraryEntry(missing)).toThrow();
  expect(() => parseHookLibraryEntry({ ...WELL_FORMED_OK_ENTRY, runnable: 'yes' })).toThrow();
});

test('parseHookLibraryEntry: permissions with a non-array env/read or non-boolean network THROWS', () => {
  expect(() => parseHookLibraryEntry({ ...WELL_FORMED_OK_ENTRY, permissions: { env: 'GH_TOKEN', read: [], network: false } })).toThrow();
  expect(() => parseHookLibraryEntry({ ...WELL_FORMED_OK_ENTRY, permissions: { env: [], read: [], network: 'false' } })).toThrow();
  expect(() => parseHookLibraryEntry({ ...WELL_FORMED_OK_ENTRY, permissions: undefined })).toThrow();
});

test('parseHookLibraryEntry: a missing/non-boolean `ok` THROWS — the discriminator itself is not optional', () => {
  const { ok: _drop, ...missing } = WELL_FORMED_OK_ENTRY;
  expect(() => parseHookLibraryEntry(missing)).toThrow();
  expect(() => parseHookLibraryEntry({ ...WELL_FORMED_OK_ENTRY, ok: 'true' })).toThrow();
});

test('parseHookLibraryEntry: not a plain object (array, null, string, number) THROWS', () => {
  expect(() => parseHookLibraryEntry(null)).toThrow();
  expect(() => parseHookLibraryEntry([])).toThrow();
  expect(() => parseHookLibraryEntry('nope')).toThrow();
  expect(() => parseHookLibraryEntry(42)).toThrow();
});

// ---------------------------------------------------------------------------
// parseHookDetail — entry fields + files + scan. A declared:true finding
// must round-trip UNCHANGED through the client too (the "downgraded, never
// hidden" rule is load-bearing at every layer, not just the scanner).
// ---------------------------------------------------------------------------

const WELL_FORMED_DETAIL = {
  ...WELL_FORMED_OK_ENTRY,
  files: [
    { path: 'hook.yaml', body: 'id: pre-pr-security-review\non: PreToolUse\n' },
    { path: 'scripts/run.sh', body: '#!/usr/bin/env bash\necho ok\n' },
  ],
  scan: {
    verdict: 'findings',
    findings: [
      { category: 'env-read', severity: 'info', message: 'declared read of GH_TOKEN', match: 'GH_TOKEN', declared: true },
    ],
  },
};

test('parseHookDetail: files + scan round-trip verbatim, including a declared:true finding (never dropped or coerced)', () => {
  const parsed = parseHookDetail(WELL_FORMED_DETAIL);
  expect(parsed.files).toEqual(WELL_FORMED_DETAIL.files);
  expect(parsed.scan).toEqual(WELL_FORMED_DETAIL.scan);
  expect(parsed.scan.findings[0]!.declared).toBe(true);
});

test('parseHookDetail: files missing or non-array THROWS — never coerced to []', () => {
  const { files: _drop, ...missing } = WELL_FORMED_DETAIL;
  expect(() => parseHookDetail(missing)).toThrow();
  expect(() => parseHookDetail({ ...WELL_FORMED_DETAIL, files: 'nope' })).toThrow();
});

test('parseHookDetail: scan missing, non-object, or with a non-array findings THROWS', () => {
  const { scan: _drop, ...missing } = WELL_FORMED_DETAIL;
  expect(() => parseHookDetail(missing)).toThrow();
  expect(() => parseHookDetail({ ...WELL_FORMED_DETAIL, scan: { verdict: 'clean' } })).toThrow();
  expect(() => parseHookDetail({ ...WELL_FORMED_DETAIL, scan: { verdict: 'clean', findings: 'nope' } })).toThrow();
});

test('parseHookDetail: an unrecognised scan.verdict THROWS', () => {
  expect(() => parseHookDetail({ ...WELL_FORMED_DETAIL, scan: { verdict: 'suspicious', findings: [] } })).toThrow();
});
