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
  parseRun,
} from './studio-client';
import type { Run } from './studio-client';

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

// ---------------------------------------------------------------------------
// parseRun — the declared-data-fails-open defect, applied to reflectionLost
// (R6-05 Task 2)
//
// MEASURED: `Run` (studio-client.ts:46-90) DECLARES both `reflectionLost?:
// string` and `reflectionLostNote?: string` — carried for R6-01's RunRail
// card (components/studio/RunRail.tsx:293-306 already reads
// `run.reflectionLost`/`run.reflectionLostNote` off a parsed Run and renders
// them). But `parseRun` (studio-client.ts:552-577) enumerates its return
// object's fields explicitly and does NOT list `reflectionLost` or
// `reflectionLostNote` anywhere in that list — so a raw server payload
// carrying either field has it silently dropped before RunRail (or any
// other consumer, including R6-05's own ledger) ever sees it. This is the
// SAME "declared-data-fails-open" class `parseRun`'s own header comment
// already names for `trigger` (studio-client.ts:572-575, "an absent
// `trigger` key must stay absent... this field was parsed and served
// end-to-end, then silently dropped here") — reflectionLost/
// reflectionLostNote are two more fields in that exact same boat, just not
// yet fixed. `parseCapability`'s explicit-undefined-on-malformed contract
// (this file, "undefined/absent input returns undefined") is the sibling
// discipline: a value that IS present must be carried, not defaulted away.
// ---------------------------------------------------------------------------

function baseRawRun(over: Partial<Run> = {}): Run {
  return {
    id: 'CYCLE-r6-05-parseRun',
    flowId: 'forge-develop',
    initiativeId: 'INIT-r6-05',
    initiative: 'ParseRun probe',
    status: 'complete',
    origin: 'architect',
    costUsd: 1.0,
    phases: {},
    phaseMeta: {},
    artifactsReady: {},
    workItems: [],
    flowLineage: ['forge-develop'],
    ...over,
  };
}

test('parseRun carries reflectionLost + reflectionLostNote through to the client, instead of dropping them (declared-data-fails-open)', () => {
  // KILLS the CURRENT state of parseRun: it does not list either field, so
  // both are silently discarded even though a real reflector crash/budget/
  // max-turns loss is exactly what these fields exist to surface honestly
  // (RunRail.tsx:293's "reflection lost" amber note — 2.10 reflection
  // honesty). A cycle whose reflection genuinely crashed must not read back
  // through parseRun as if nothing were lost.
  const raw = baseRawRun({ reflectionLost: 'crash', reflectionLostNote: 'reflector process exited with SIGSEGV mid brain-write' });
  const parsed = parseRun(raw);

  expect(parsed.reflectionLost).toBe('crash');
  expect(parsed.reflectionLostNote).toBe('reflector process exited with SIGSEGV mid brain-write');
});

test('parseRun leaves reflectionLost/reflectionLostNote ABSENT for a run that carries neither — never coerced to "" or a fabricated cause', () => {
  // KILLS: `reflectionLost: r.reflectionLost ?? ''` (or any other default),
  // which would make every ordinary, never-reflection-lost run carry a
  // truthy-looking (or falsy-but-present) field — RunRail's
  // `{run.reflectionLost && (...)}` guard treats an empty string as falsy
  // today, so this specific defect happens to be inert on THAT one consumer,
  // but a `''` key present where the type says "absent when not lost" is
  // still a lie any OTHER consumer (this initiative's own ledger narrative,
  // Task 3) could trip on.
  const raw = baseRawRun();
  const parsed = parseRun(raw);

  expect('reflectionLost' in parsed).toBe(false);
  expect('reflectionLostNote' in parsed).toBe(false);
  expect(parsed.reflectionLost).toBeUndefined();
  expect(parsed.reflectionLostNote).toBeUndefined();
});

test('parseRun carries reflectionLost independently of reflectionLostNote — a lost reflection with no note is not silently paired away', () => {
  // KILLS: an implementation that only carries the pair together (e.g. `if
  // (r.reflectionLost && r.reflectionLostNote)`), which would hide a real
  // loss whenever the note happens to be absent. The two fields are declared
  // independently optional on the type; the parse must respect that.
  const raw = baseRawRun({ reflectionLost: 'max-turns' });
  const parsed = parseRun(raw);

  expect(parsed.reflectionLost).toBe('max-turns');
  expect('reflectionLostNote' in parsed).toBe(false);
});

// ---------------------------------------------------------------------------
// parseRun — FIELD-PARITY PIN (R6-05 Task A, round 2)
//
// `parseRun` has now dropped a declared `Run` field on THREE separate
// occasions: `trigger` (a prior initiative, fixed — see this file's header
// comment on `parseRun`'s own `trigger` line, studio-client.ts:572-575),
// then `reflectionLost` + `reflectionLostNote` (the two tests directly
// above, this initiative). Each time, the field was declared on the client
// `Run` type, served correctly by the bridge, and silently discarded at
// parseRun's last hop — because `parseRun` enumerates its return object's
// fields BY HAND, and a newly-added field is trivial to forget to list.
//
// FEASIBILITY, decided: closing the whole CLASS (not just another instance)
// requires generalising "does parseRun carry every declared field" WITHOUT
// hand-listing the fields again here — a second manually-maintained
// enumeration would be exactly as forgettable as `parseRun`'s own. The
// mechanism below avoids that: `raw` is typed `Required<Run>`. TypeScript's
// `-?` mapped-type modifier strips every field's optionality, so this object
// literal fails to typecheck unless EVERY key currently declared on `Run` is
// present with a real value. When a fourth field is added to `Run`, this
// fixture must grow to include it (or a human's editor/a manually-run `tsc`
// flags it); once it's added here, the RUNTIME loop below picks it up
// automatically — it iterates `Object.keys(raw)`, not a second hand-written
// list — so extending coverage to a new field needs no test-CODE change,
// only a fixture-VALUE addition. This is the same compile-time-backstop
// idiom `history-ledger.test.ts`'s type-level exhaustiveness pin already
// uses for a closed union, applied here to a record's fields instead.
//
// HONEST CAVEAT (measured this round, see `history-ledger.test.ts`'s D10
// header note for the full trail): this compile-time backstop is NOT a CI
// gate in this repo today. `forge-ui/tsconfig.json` excludes `**/*.test.ts`
// from its own `include`, and the root `tsconfig.json` never lists
// `forge-ui/**` — so neither `tsc` (root `npm run build`) nor `next build`
// (forge-ui's own build) ever type-checks this file; verified directly by
// running `npx tsc --noEmit -p forge-ui/tsconfig.json` unmodified (exits 0
// despite sibling test files in this same round importing modules that do
// not exist on disk) and then re-running with `include` widened to cover
// test files, which immediately surfaces those exact errors. So a fourth
// field added WITHOUT updating this fixture will not fail CI on its own —
// but the RUNTIME loop below, which IS CI-enforced (`npm run test:ui`),
// covers every field ALREADY present in the fixture today (all 20 of them,
// including the two that are currently silently dropped), which is
// strictly more than the two hand-picked instance tests above cover
// individually, and it costs nothing extra to extend once a field is added
// to the fixture for any reason (including just to satisfy the type error).
//
// NOT COVERED (deliberately, per the task brief): this pin proves parseRun
// carries every declared FIELD through. It does NOT prove the client `Run`
// type admits every VALUE the server can produce — `origin` is typed
// `'architect' | 'human-directed'` here, and the fixture below literally
// cannot assign `'triggered'` (which the server CAN produce, per
// `orchestrator/run-model.ts`'s `VALID_ORIGINS`) without a compile error.
// That is bead forge-cv9's separate defect (the type admitting every
// server-produced VALUE, not whether a field survives parsing) —
// deliberately not stretched into this pin.
// ---------------------------------------------------------------------------

test('parseRun: FIELD-PARITY PIN — every field declared on the client Run type survives a fully-populated raw payload, verbatim', () => {
  // KILLS: parseRun silently omitting ANY field from its return object's
  // hand-enumerated field list — the exact defect class `trigger` and
  // `reflectionLost`/`reflectionLostNote` both hit (see the two tests
  // directly above). Fails at whichever specific key is dropped, current or
  // future.
  //
  // Every field below is set to a value DIFFERENT from parseRun's own `??`
  // fallback default (status/origin/costUsd), and every object/array field
  // is non-empty, so a defaulted-instead-of-carried field cannot
  // coincidentally match the expectation.
  const raw: Required<Run> = {
    id: 'CYCLE-field-parity-probe',
    flowId: 'forge-develop',
    initiativeId: 'INIT-field-parity',
    initiative: 'Field parity probe',
    status: 'complete',        // NOT parseRun's default ('planned')
    origin: 'architect',       // NOT parseRun's default ('human-directed')
    costUsd: 9.99,               // NOT parseRun's default (0)
    startedAt: '2026-01-01T00:00:00Z',
    phases: { dev: 'complete' },                        // non-empty (default would be {})
    phaseMeta: { dev: { costUsd: 1.5, retries: 2 } },    // non-empty
    artifactsReady: { plan: 'view' },                    // non-empty
    gate: 'demo',
    gateNote: 'needs you',
    failedAt: '2026-01-02T00:00:00Z',
    failNote: 'CI red on merge',
    reflectionLost: 'crash',
    reflectionLostNote: 'reflector process exited with SIGSEGV mid brain-write',
    workItems: [
      { id: 'WI-1', status: 'complete', costUsd: 1.2, task: 'do the thing', dependsOn: ['WI-0'], delivered: { files: 2, insertions: 10, commits: 1 } },
    ],
    flowLineage: ['forge-develop'],
    trigger: { kind: 'schedule', source: 'cron', scope: null },
  };

  const parsed = parseRun(raw);

  for (const key of Object.keys(raw) as (keyof Run)[]) {
    expect(parsed[key], `field "${key}" was dropped (undefined) by parseRun`).not.toBeUndefined();
    expect(parsed[key], `field "${key}" was mutated, not carried through verbatim`).toEqual(raw[key]);
  }
});
