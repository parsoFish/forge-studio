/**
 * Tests for `parseCapability` (R2-02-F1/AC3) — the client-side parse of the
 * server-computed `capability` field on GET /api/studio/agents and
 * GET /api/studio/starters. AC3 requires the descriptor be carried through
 * verbatim, never re-derived client-side; this locks the parse boundary
 * (well-formed → passed through, absent/malformed → undefined, no throw).
 *
 * Also covers `buildTriggerDeclaration` + `isValidCronSchedule` (R2-04-F4) —
 * the pure, DOM-free trigger-authoring logic FlowHeader's kind selector
 * delegates to, extracted so it's unit-testable without mounting the
 * component.
 */
import { test, expect } from 'vitest';

import {
  parseCapability,
  buildTriggerDeclaration,
  isValidCronSchedule,
  parseRunInputs,
  parseMaterials,
  parseInstructionsDraftResponse,
} from './studio-client';

test('parseRunInputs: one key:value per line → inputs map; blanks ignored', () => {
  expect(parseRunInputs('repo: ./projects/foo\nnorthStar: ship X\n\n')).toEqual({
    repo: './projects/foo',
    northStar: 'ship X',
  });
});

test('parseRunInputs: the FIRST colon splits, so a value may contain colons (a URL)', () => {
  expect(parseRunInputs('repo: https://github.com/x/y')).toEqual({ repo: 'https://github.com/x/y' });
});

test('parseRunInputs: a line with no colon (or empty key) is skipped, no throw', () => {
  expect(parseRunInputs('novalue\n: orphan\nok: yes')).toEqual({ ok: 'yes' });
  expect(parseRunInputs('')).toEqual({});
});

test('parseCapability: a well-formed descriptor is carried through verbatim', () => {
  expect(parseCapability({ interactive: true, runtimeSdks: ['claude-code'], fanoutCapable: true }))
    .toEqual({ interactive: true, runtimeSdks: ['claude-code'], fanoutCapable: true });
  expect(parseCapability({ interactive: false, runtimeSdks: [] }))
    .toEqual({ interactive: false, runtimeSdks: [], fanoutCapable: false });
});

test('parseCapability: R2-03-F2 — fanoutCapable degrades to false against an older payload', () => {
  // A pre-F2 bridge payload lacks fanoutCapable → false, not whole-object undefined.
  expect(parseCapability({ interactive: false, runtimeSdks: ['claude'] }))
    .toEqual({ interactive: false, runtimeSdks: ['claude'], fanoutCapable: false });
  expect(parseCapability({ interactive: false, runtimeSdks: ['claude'], fanoutCapable: true })?.fanoutCapable).toBe(true);
});

test('parseCapability: undefined/absent input returns undefined', () => {
  expect(parseCapability(undefined)).toBeUndefined();
  expect(parseCapability(null)).toBeUndefined();
});

test('parseCapability: malformed shapes return undefined without throwing (older bridge payload)', () => {
  expect(parseCapability({})).toBeUndefined();
  expect(parseCapability({ interactive: 'yes', runtimeSdks: ['claude-code'] })).toBeUndefined();
  expect(parseCapability({ interactive: true, runtimeSdks: 'claude-code' })).toBeUndefined();
  expect(parseCapability({ interactive: true })).toBeUndefined();
  expect(parseCapability('not-an-object')).toBeUndefined();
  expect(parseCapability(42)).toBeUndefined();
});

// ---------------------------------------------------------------------------
// buildTriggerDeclaration / isValidCronSchedule (R2-04-F4)
// ---------------------------------------------------------------------------

test('buildTriggerDeclaration: flow-complete/merged build {on, target} with no other fields', () => {
  expect(buildTriggerDeclaration('flow-complete', { targetId: 'forge-develop' }))
    .toEqual({ on: 'flow-complete', target: { kind: 'flow', ref: 'forge-develop' } });
  expect(buildTriggerDeclaration('merged', { targetId: 'forge-reflect' }))
    .toEqual({ on: 'merged', target: { kind: 'flow', ref: 'forge-reflect' } });
});

test('buildTriggerDeclaration: missing targetId returns null for every kind', () => {
  expect(buildTriggerDeclaration('flow-complete', { targetId: '' })).toBeNull();
  expect(buildTriggerDeclaration('cron', { targetId: '', schedule: '0 3 * * *' })).toBeNull();
  expect(buildTriggerDeclaration('webhook', {
    targetId: '', webhookId: 'h', webhookProvider: 'github',
    webhookEvents: ['push'], webhookSecretEnv: 'SECRET', webhookSources: 'a/b',
  })).toBeNull();
});

test('buildTriggerDeclaration: cron requires a non-empty schedule; concurrency defaults to forbid', () => {
  expect(buildTriggerDeclaration('cron', { targetId: 'nightly' })).toBeNull();
  expect(buildTriggerDeclaration('cron', { targetId: 'nightly', schedule: '   ' })).toBeNull();
  expect(buildTriggerDeclaration('cron', { targetId: 'nightly', schedule: '0 3 * * *' }))
    .toEqual({ on: 'cron', target: { kind: 'flow', ref: 'nightly' }, schedule: '0 3 * * *', concurrency: 'forbid' });
  expect(buildTriggerDeclaration('cron', { targetId: 'nightly', schedule: '0 3 * * *', concurrency: 'allow' }))
    .toEqual({ on: 'cron', target: { kind: 'flow', ref: 'nightly' }, schedule: '0 3 * * *', concurrency: 'allow' });
});

test('buildTriggerDeclaration: webhook requires id/provider/secretEnv + non-empty events and sources', () => {
  const base = {
    targetId: 'develop', webhookId: 'myproj-push', webhookProvider: 'github' as const,
    webhookEvents: ['push' as const], webhookSecretEnv: 'MYPROJ_WEBHOOK_SECRET', webhookSources: 'parsoFish/myproj',
  };
  expect(buildTriggerDeclaration('webhook', base)).toEqual({
    on: 'webhook',
    target: { kind: 'flow', ref: 'develop' },
    webhook: {
      id: 'myproj-push', provider: 'github', events: ['push'],
      secretEnv: 'MYPROJ_WEBHOOK_SECRET', sources: ['parsoFish/myproj'],
    },
  });
  expect(buildTriggerDeclaration('webhook', { ...base, webhookEvents: [] })).toBeNull();
  expect(buildTriggerDeclaration('webhook', { ...base, webhookSources: '' })).toBeNull();
  expect(buildTriggerDeclaration('webhook', { ...base, webhookSecretEnv: undefined })).toBeNull();
  expect(buildTriggerDeclaration('webhook', { ...base, webhookId: undefined })).toBeNull();
});

test('buildTriggerDeclaration: webhook sources is a trimmed, comma-split list', () => {
  const result = buildTriggerDeclaration('webhook', {
    targetId: 'develop', webhookId: 'h', webhookProvider: 'gitea',
    webhookEvents: ['push', 'release'], webhookSecretEnv: 'SECRET',
    webhookSources: ' parsoFish/a , parsoFish/b ,,',
  });
  expect(result?.webhook?.sources).toEqual(['parsoFish/a', 'parsoFish/b']);
});

test('isValidCronSchedule: valid croner patterns pass, empty/invalid do not throw and return false', () => {
  expect(isValidCronSchedule('0 3 * * *')).toBe(true);
  expect(isValidCronSchedule('*/5 * * * *')).toBe(true);
  expect(isValidCronSchedule('')).toBe(false);
  expect(isValidCronSchedule('   ')).toBe(false);
  expect(isValidCronSchedule('not a cron pattern')).toBe(false);
  expect(isValidCronSchedule('99 99 * * *')).toBe(false);
});

// ---------------------------------------------------------------------------
// parseMaterials (R2-09 D1) — wire parse of AgentDefinition.materials
// ---------------------------------------------------------------------------

test('parseMaterials: an array of strings parses as-is', () => {
  expect(parseMaterials(['images', 'audio'])).toEqual(['images', 'audio']);
  expect(parseMaterials([])).toEqual([]);
});

test('parseMaterials: absent (undefined/null) parses to undefined', () => {
  expect(parseMaterials(undefined)).toBeUndefined();
  expect(parseMaterials(null)).toBeUndefined();
});

test('parseMaterials: a non-array value is a parse FAILURE (undefined) — never silently coerced to []', () => {
  // A real finding in this campaign was a client turning a missing/malformed
  // field into a fabricated default value instead of reporting the absence —
  // this pins the fix: a malformed payload must never masquerade as a
  // legitimate "declared empty" ([]), which D2 gives real meaning to.
  expect(parseMaterials('images')).toBeUndefined();
  expect(parseMaterials(42)).toBeUndefined();
  expect(parseMaterials({ images: true })).toBeUndefined();
});

test('parseMaterials: a non-string entry inside the array is also a parse failure, not a partial list', () => {
  expect(parseMaterials(['images', 42])).toBeUndefined();
});

// ---------------------------------------------------------------------------
// parseInstructionsDraftResponse (R2-09 D8) — pure parse boundary for the
// POST .../instructions-draft response, mirroring parseCapability's
// carry-through-or-undefined convention so the async fetch wrapper
// (requestInstructionsDraft, not exercised here — see final report for why)
// stays a thin, untestable-by-design I/O shell around a testable core.
// ---------------------------------------------------------------------------

test('parseInstructionsDraftResponse: ok path returns the draft + derivation', () => {
  const result = parseInstructionsDraftResponse(200, { ok: true, draft: '# Draft\n', derivation: { sources: [] } });
  expect(result).toEqual({ ok: true, draft: '# Draft\n', derivation: { sources: [] } });
});

test('parseInstructionsDraftResponse: a non-ok status surfaces the error, not an empty draft', () => {
  const result = parseInstructionsDraftResponse(404, { error: 'unknown slug' });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toBe('unknown slug');
});

test('parseInstructionsDraftResponse: a malformed 200 payload (missing draft) is an ERROR, not an invented empty draft', () => {
  const result = parseInstructionsDraftResponse(200, { ok: true });
  expect(result.ok).toBe(false);
});

// 2026-08-05 adversarial-review round 2, finding E/12: `studioPut`/`studioPost`
// in this same file both respect the response BODY's own `ok` field
// (`typeof data.ok === 'boolean' ? data.ok : true`) — an explicit `ok:false`
// in a 2xx body is a real failure signal, not decoration. This function
// currently ignores `p['ok']` entirely and derives success purely from HTTP
// status + shape presence, so a 200 body carrying `{ok:false, draft:'x'}`
// is misreported as a successful draft.
test('parseInstructionsDraftResponse: a 2xx body with an explicit ok:false is a FAILURE, not a successful draft (matches studioPut/studioPost)', () => {
  const result = parseInstructionsDraftResponse(200, {
    ok: false,
    draft: 'a draft the server itself says is not valid',
    derivation: { sources: [] },
    error: 'draft composition failed validation',
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toBe('draft composition failed validation');
});

// 2026-08-05 adversarial-review round 3, finding D/7: `derivation` is typed
// (`InstructionsDraftDerivation`) but the parser only guards `undefined`/
// `null` before casting `p['derivation'] as InstructionsDraftDerivation` —
// the SHAPE (an object carrying a `sources` ARRAY) is never checked. Inert
// today (only `draft` is consumed downstream), but it is exactly the
// declared-but-unvalidated-shape defect class this campaign treats as real:
// a malformed `derivation` must make the parse report a failure, never hand
// a consumer a garbage object dressed up as `InstructionsDraftDerivation`.
test('parseInstructionsDraftResponse: derivation: 42 (not an object at all) is a parse FAILURE', () => {
  const result = parseInstructionsDraftResponse(200, { ok: true, draft: '# Draft\n', derivation: 42 });
  expect(result.ok).toBe(false);
});

test('parseInstructionsDraftResponse: derivation: {} (missing sources) is a parse FAILURE', () => {
  const result = parseInstructionsDraftResponse(200, { ok: true, draft: '# Draft\n', derivation: {} });
  expect(result.ok).toBe(false);
});

test('parseInstructionsDraftResponse: derivation: [] (an array, not {sources: [...]}) is a parse FAILURE', () => {
  const result = parseInstructionsDraftResponse(200, { ok: true, draft: '# Draft\n', derivation: [] });
  expect(result.ok).toBe(false);
});

test('parseInstructionsDraftResponse: derivation: {sources: "nope"} (sources present but not an array) is a parse FAILURE', () => {
  const result = parseInstructionsDraftResponse(200, { ok: true, draft: '# Draft\n', derivation: { sources: 'nope' } });
  expect(result.ok).toBe(false);
});
