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
import { test, expect, vi, afterEach } from 'vitest';

import {
  parseCapability,
  // W6-B6 fix (wave-6 final gate, journey demo-builder DB-4) — the
  // UNFILTERED per-slug capability parse/fetch pair, sibling to
  // parseCapability's roster-shaped 3-key parse above.
  parseAgentCapability,
  fetchAgentCapability,
  // review round (GAP 1/GAP 2, R6-07 batch-H honesty pass): pinned directly
  // at the wire boundary, alongside parseCapability's own precedent above —
  // both are "carry-through-or-reject-whole-object" parsers.
  parseKbLintSummary,
  buildTriggerDeclaration,
  isValidCronSchedule,
  parseRunInputs,
  parseMaterials,
  parseInstructionsDraftResponse,
  parseRun,
  // AT-F1-1 (R4-12-F1): does NOT exist yet — the RED trigger for the new
  // wire-contract test at the bottom of this file. A missing named export of
  // an existing module resolves to `undefined` under this repo's vitest
  // module runner (not a collection-time throw, unlike a whole missing
  // module), so the existing pure-function tests above stay green and only
  // the AT-F1-1 test goes red, on its explicit `typeof … === 'function'`
  // guard.
  fetchContractStages,
  // W6-B11 — the aggregate sessions-index client read, same
  // "not-yet-exported resolves to undefined" RED convention as
  // fetchContractStages/AT-F1-1 above.
  fetchStudioSessions,
  // zyc review finding 1/2: same "not yet exported" RED convention as
  // AT-F1-1 above — pre-fix, both resolve to `undefined`, so calling either
  // throws a genuine "is not a function" RED rather than silently no-op-ing.
  WEBHOOK_FAMILY_TRIGGER_KINDS,
  isSameTriggerIdentity,
  // R1-06 WI-2 group A: same "not yet exported" RED convention as
  // AT-F1-1 above — does NOT exist on ./studio-client yet.
  // `/knowledge/new`'s `[data-field="kb-binding-band"]` select (forge-ui/
  // app/knowledge/new/page.tsx) needs a pure, DOM-free function to decide
  // (a) whether the band field renders at all (gated on binding `kind`) and
  // (b) what options it populates (the bound flow's real `bands`, sourced
  // from the new GET /api/studio/flows `bands:` field this same WI adds —
  // see cli/bridge-studio-flows.test.ts's companion route pin). Colocated
  // here, not as a new lib file, matching this module's existing convention
  // of exporting small pure derivation helpers alongside the `Flow` type
  // they read (parseCapability/parseFanout/buildTriggerDeclaration/etc.).
  deriveKbBandOptions,
  // R4-19-F2 T3: does not exist yet — same "not yet exported" RED convention
  // as AT-F1-1/fetchContractStages above: a missing named export resolves to
  // `undefined` under this repo's vitest module runner (not a collection-time
  // throw), so only the tests that actually CALL these two go red. These are
  // the typed client caller for the kb-cleanup session's kickoff route
  // (`POST /api/studio/kbs/:id/cleanup/start`, cli/ui-bridge.ts) — placed
  // alongside runKbMaintenance/deleteKb/createKb (this module) rather than
  // bridge-client.ts's startAuthoring/finalizeAuthoring, because every OTHER
  // `/api/studio/kbs/:id/...` route caller already lives here, and this one
  // nests under that same resource-id + action path shape. W6-B9 (reviewer
  // finding on W6-B8): the sibling `applyKbCleanup` (`.../cleanup/apply`) is
  // DELETED — kb-cleanup migrated onto the generic session shell (W6-B8),
  // whose approve affordance goes through the generic write route, and once
  // its one caller (SessionCleanupPanel.tsx) was deleted, this client
  // function had no production caller left.
  startKbCleanup,
  // W6-B13: the KB drain-to-green client (cli/bridge-studio-kb-drain.ts's
  // routes) — dispatch + the two read routes (specific-run poll and
  // active-or-latest reattach).
  dispatchKbDrain,
  fetchKbDrainRun,
  fetchActiveOrLatestKbDrain,
} from './studio-client';
// R1-06 WI-2 group B (3) / T1 Q3 — the bootstrapKb REMOVAL pin reads the
// module's export list, NOT a named import: once the export is genuinely
// gone a named import is a hard type error (W7-C3's tests tsc project),
// and an `in` check over the namespace is the stronger assertion anyway —
// it fails if the symbol comes back under any value at all, including
// `undefined`.
import * as StudioClientModule from './studio-client';
import type { Run, TriggerBuilderFields, ShippedTriggerKind, FlowTrigger, Flow } from './studio-client';
// AT-F1-1 REUSE (accepted-plan census): the row TYPE this route's rows parse
// into is session-client.ts's EXPORTED `ContractStageRow` (:248-258) — the
// same type the session-shell's contract-buildout artifact already uses. The
// test types its expectation as `ContractStageRow[]` so a third client-side
// mirror (a new type, or a hand-rolled row parser) diverges and fails.
import type { ContractStageRow } from './session-client';
// zyc review finding 1 pin — reads the REAL orchestrator SSOT lint directly
// (same "read the real thing, not a hand-copied mirror" mechanism
// flow-header-render.test.ts's pin 2 already established for
// SHIPPED_TRIGGER_KIND_IDS): proves a pr-merged/issue-raised trigger built
// via the real client path is one `orchestrator/studio/validate-triggers.ts`
// actually accepts, not just a shape this test file asserts by eye.
import { checkFlowTriggers } from '../../../orchestrator/studio/validate-triggers.ts';
import type { AgentDefinition, FlowDefinition } from '@forge/contracts';

// AT-F1-1 fetch harness — matches lib/agent-ledger.test.ts verbatim.
// `fetchContractStages` calls `resolveBridgeUrl()` (./bridge-client) then
// `fetch()`; under this repo's `environment: 'node'` vitest config the REAL
// `resolveBridgeUrl` returns '' (its `typeof window` SSR guard trips with no
// `window` global), short-circuiting before `fetch` is ever reached — so the
// fetch call is only exercisable with `resolveBridgeUrl` replaced by a fixed
// base. `vi.mock` is hoisted above every import by vitest, and matches by
// RESOLVED file path, so `'./bridge-client.ts'` here intercepts
// studio-client.ts's extensionless `from './bridge-client'` import. The
// factory returns ONLY `resolveBridgeUrl` (all studio-client.ts uses of
// bridge-client), and `standing-triggers.ts` imports nothing from
// bridge-client, so the module graph still loads for the pure tests above.
vi.mock('./bridge-client.ts', () => ({
  resolveBridgeUrl: vi.fn(async () => 'http://bridge.test'),
  // W7-A1: studio-client rides bridge-client's `bridgeFetch` (one transport,
  // crosscut-26) — the mock forwards to the stubbed global fetch against the
  // same fixed base, so each test's `vi.stubGlobal('fetch', …)` still drives it.
  bridgeFetch: vi.fn(async (path: string, init?: RequestInit) => (init === undefined ? fetch(`http://bridge.test${path}`) : fetch(`http://bridge.test${path}`, init))),
}));

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
// parseAgentCapability / fetchAgentCapability (W6-B6 fix — wave-6 final
// gate, journey demo-builder DB-4) — the UNFILTERED per-slug capability
// route's client parse + fetch. `GET /api/studio/agents/:slug/capability`
// resolves ONE named slug directly against the bridge's unfiltered SKILL.md
// defs, bypassing the `library:false` roster gate `fetchStudioAgents()`
// applies — the roster silently drops every kickoff-only system agent
// (demo-builder and its four siblings), which is the root cause of the
// model-tier picker rendering as the read-only 'fixed' chip for all of them.
// ---------------------------------------------------------------------------

test('parseAgentCapability: a well-formed range descriptor is carried through verbatim, allowedTiers included', () => {
  expect(parseAgentCapability({
    interactive: false, runtimeSdks: ['claude'], fanoutCapable: false,
    materials: [], costCeilingEnforceable: false, allowedTiers: ['sonnet', 'opus'],
  })).toEqual({
    interactive: false, runtimeSdks: ['claude'], fanoutCapable: false,
    materials: [], costCeilingEnforceable: false, allowedTiers: ['sonnet', 'opus'],
  });
});

test('parseAgentCapability: a fixed-strategy descriptor has no allowedTiers key — stays absent, never fabricated as []', () => {
  const parsed = parseAgentCapability({
    interactive: false, runtimeSdks: ['claude'], fanoutCapable: false,
    materials: [], costCeilingEnforceable: false,
  });
  expect(parsed).not.toBeNull();
  expect(parsed && 'allowedTiers' in parsed).toBe(false);
});

test('parseAgentCapability: undefined/absent/malformed input returns null, never a fabricated stand-in', () => {
  expect(parseAgentCapability(undefined)).toBeNull();
  expect(parseAgentCapability(null)).toBeNull();
  expect(parseAgentCapability({})).toBeNull();
  expect(parseAgentCapability({ interactive: 'yes', runtimeSdks: ['claude'] })).toBeNull();
  expect(parseAgentCapability({ interactive: true, runtimeSdks: 'claude' })).toBeNull();
  expect(parseAgentCapability('not-an-object')).toBeNull();
  expect(parseAgentCapability(42)).toBeNull();
});

test('parseAgentCapability: an allowedTiers array with ANY unrecognised element degrades the WHOLE array to absent, not a partial list', () => {
  const parsed = parseAgentCapability({
    interactive: false, runtimeSdks: ['claude'], fanoutCapable: false,
    materials: [], costCeilingEnforceable: false, allowedTiers: ['sonnet', 'not-a-real-tier'],
  });
  expect(parsed && 'allowedTiers' in parsed).toBe(false);
});

test('fetchAgentCapability: issues one GET to /api/studio/agents/:slug/capability and returns the parsed descriptor', async () => {
  const fetchSpy = vi.fn(async (..._args: FetchArgs) => ({
    ok: true,
    status: 200,
    json: async () => ({
      slug: 'demo-builder',
      capability: {
        interactive: true, runtimeSdks: ['claude'], fanoutCapable: false,
        materials: [], costCeilingEnforceable: false, allowedTiers: ['sonnet', 'opus'],
      },
    }),
  }));
  vi.stubGlobal('fetch', fetchSpy);

  const capability = await fetchAgentCapability('demo-builder');

  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(fetchSpy).toHaveBeenCalledWith(`${BRIDGE_BASE}/api/studio/agents/demo-builder/capability`);
  expect(capability?.allowedTiers).toEqual(['sonnet', 'opus']);
});

test('fetchAgentCapability: a 404 (unknown slug) resolves to null, never throws', async () => {
  const fetchSpy = vi.fn(async (..._args: FetchArgs) => ({ ok: false, status: 404, json: async () => ({ error: 'unknown agent' }) }));
  vi.stubGlobal('fetch', fetchSpy);

  expect(await fetchAgentCapability('no-such-agent')).toBeNull();
});

// ---------------------------------------------------------------------------
// parseKbLintSummary (review round on forge-2am, R6-07 batch-H honesty pass)
// ---------------------------------------------------------------------------
//
// GAP 1 (MAJOR): today `error` is handled as
// `typeof l.error === 'string' ? {error: l.error} : {}` — a PRESENT
// but wrong-typed `error` is silently dropped instead of rejecting the whole
// object. `error`'s presence is the server's "the lint run itself threw"
// signal (KbLintSummary's own header above); dropping it turns a real
// lint-failure into a fabricated counts-only "clean" summary — exactly the
// declared-data-fails-open shape this seam exists to close.
//
// GAP 2 (MINOR): `typeof x === 'number'` admits NaN/Infinity/negative/
// non-integer, and nothing today checks `checksRun <= checksTotal`.

test('parseKbLintSummary: a present-but-non-string `error` (42 / true / {}) invalidates the WHOLE object to null — kills the `typeof l.error === "string" ? {error} : {}` implementation, which silently DROPS a present-but-wrong-typed error instead of rejecting the object', () => {
  const base = { errors: 0, flags: 0, checksRun: 5, checksTotal: 10 };
  expect(parseKbLintSummary({ ...base, error: 42 })).toBeNull();
  expect(parseKbLintSummary({ ...base, error: true })).toBeNull();
  expect(parseKbLintSummary({ ...base, error: {} })).toBeNull();
});

test('parseKbLintSummary: GAP 1 wire-level assertion — the reviewer-reproduced { errors:0, flags:0, checksRun:5, checksTotal:10, error:42 } payload never becomes the counts-only summary {errors:0,flags:0,checksRun:5,checksTotal:10} (dropping `error` instead of rejecting fabricates an all-clean verdict)', () => {
  const parsed = parseKbLintSummary({ errors: 0, flags: 0, checksRun: 5, checksTotal: 10, error: 42 });
  expect(parsed).not.toEqual({ errors: 0, flags: 0, checksRun: 5, checksTotal: 10 });
  expect(parsed).toBeNull();
});

test('parseKbLintSummary: `error: null` means ABSENT and stays a VALID counts-only summary — null is not itself a rejection reason', () => {
  const parsed = parseKbLintSummary({ errors: 0, flags: 0, checksRun: 5, checksTotal: 10, error: null });
  expect(parsed).toEqual({ errors: 0, flags: 0, checksRun: 5, checksTotal: 10 });
  expect(parsed && 'error' in parsed).toBe(false);
});

test('parseKbLintSummary: `error` absent entirely also stays VALID, with no `error` key on the result', () => {
  const parsed = parseKbLintSummary({ errors: 0, flags: 0, checksRun: 5, checksTotal: 10 });
  expect(parsed).toEqual({ errors: 0, flags: 0, checksRun: 5, checksTotal: 10 });
  expect(parsed && 'error' in parsed).toBe(false);
});

test('parseKbLintSummary: positive control — a well-formed summary WITH a real string `error` still parses, carrying `error` through verbatim', () => {
  const parsed = parseKbLintSummary({ errors: 0, flags: 0, checksRun: 5, checksTotal: 10, error: 'lint run threw' });
  expect(parsed).toEqual({ errors: 0, flags: 0, checksRun: 5, checksTotal: 10, error: 'lint run threw' });
});

test('parseKbLintSummary: NaN in any count field invalidates the whole object to null — kills a bare `typeof x === "number"` check, which admits NaN', () => {
  const base = { errors: 0, flags: 0, checksRun: 5, checksTotal: 10 };
  expect(parseKbLintSummary({ ...base, errors: NaN })).toBeNull();
  expect(parseKbLintSummary({ ...base, flags: NaN })).toBeNull();
  expect(parseKbLintSummary({ ...base, checksRun: NaN })).toBeNull();
  expect(parseKbLintSummary({ ...base, checksTotal: NaN })).toBeNull();
});

test('parseKbLintSummary: Infinity in any count field invalidates the whole object to null', () => {
  const base = { errors: 0, flags: 0, checksRun: 5, checksTotal: 10 };
  expect(parseKbLintSummary({ ...base, errors: Infinity })).toBeNull();
  expect(parseKbLintSummary({ ...base, checksTotal: Infinity })).toBeNull();
});

test('parseKbLintSummary: a negative count invalidates the whole object to null — the reviewer-reproduced {errors:NaN,flags:2,checksRun:-1,checksTotal:10} class of render (data-attention-checks-run="-1") must never parse clean', () => {
  expect(parseKbLintSummary({ errors: 0, flags: 2, checksRun: -1, checksTotal: 10 })).toBeNull();
});

test('parseKbLintSummary: a non-integer count (1.5) invalidates the whole object to null', () => {
  expect(parseKbLintSummary({ errors: 1.5, flags: 0, checksRun: 5, checksTotal: 10 })).toBeNull();
});

test('parseKbLintSummary: checksRun > checksTotal invalidates the whole object to null — kills the inverted n/a-invariant that would render "50/10 checks ran"', () => {
  expect(parseKbLintSummary({ errors: 0, flags: 0, checksRun: 11, checksTotal: 10 })).toBeNull();
});

test('parseKbLintSummary: positive control — well-formed finite/integer/bounded summaries (all-zero, and checksRun === checksTotal, and a real dirty summary) still parse', () => {
  expect(parseKbLintSummary({ errors: 0, flags: 0, checksRun: 0, checksTotal: 10 }))
    .toEqual({ errors: 0, flags: 0, checksRun: 0, checksTotal: 10 });
  expect(parseKbLintSummary({ errors: 0, flags: 0, checksRun: 10, checksTotal: 10 }))
    .toEqual({ errors: 0, flags: 0, checksRun: 10, checksTotal: 10 });
  expect(parseKbLintSummary({ errors: 3, flags: 4, checksRun: 7, checksTotal: 10 }))
    .toEqual({ errors: 3, flags: 4, checksRun: 7, checksTotal: 10 });
});

// ---------------------------------------------------------------------------
// buildTriggerDeclaration / isValidCronSchedule (R2-04-F4)
// ---------------------------------------------------------------------------

test('buildTriggerDeclaration: flow-complete/merged build {on, target} with no other fields', () => {
  expect(buildTriggerDeclaration('flow-complete', { targetId: 'forge-develop' }))
    .toEqual({ on: 'flow-complete', target: { kind: 'flow', ref: 'forge-develop' } });
  expect(buildTriggerDeclaration('merged', { targetId: 'retro-flow' }))
    .toEqual({ on: 'merged', target: { kind: 'flow', ref: 'retro-flow' } });
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

// ---------------------------------------------------------------------------
// forge-zyc pin 3 — agent-complete completability (RED today).
//
// orchestrator/studio/validate-triggers.ts:279-287's `trigger-agent-complete`
// check requires a non-empty `agent:` on every `on: 'agent-complete'` row —
// a row without one can never fire (orchestrator/flow-trigger.ts:132-165's
// `fireAgentCompleteTriggers` strict-matches `trigger.agent ===
// completedAgentSlug`, so an absent `agent` never matches any real slug).
// `buildTriggerDeclaration` is the ONLY place FlowHeader builds a trigger row
// from user input — if it can never emit an `agent:` key for kind
// 'agent-complete', a row saved through the UI is UNCOMPLETABLE: it would
// fail studio-lint's trigger-agent-complete check on save (once pin 2's
// mirror gap is separately closed and the kind becomes selectable at all).
//
// `TriggerBuilderFields` today (:264-277) carries no `agentSlug` field, and
// `buildTriggerDeclaration` (:290-319) falls through to the generic
// `return { on: kind, target }` for any kind that isn't 'cron'/'webhook' — no
// `agent:` key is ever emitted, for any kind. `ShippedTriggerKind` also
// doesn't include 'agent-complete' yet (pin 2's mirror gap) — cast past that
// here since this pin is about the BUILDER's per-kind behaviour, independent
// of whether the kind is offered in the UI selector.
// ---------------------------------------------------------------------------

test('RED (forge-zyc pin 3): buildTriggerDeclaration("agent-complete", {targetId, agentSlug}) must produce a declaration carrying agent: <slug> — today it emits no "agent" key at all', () => {
  const fields = { targetId: 'forge-develop', agentSlug: 'developer' } as unknown as TriggerBuilderFields;
  const trigger = buildTriggerDeclaration('agent-complete' as unknown as ShippedTriggerKind, fields);
  expect(trigger).not.toBeNull();
  // The defect: today's builder returns { on: 'agent-complete', target } —
  // no `agent` key at all — so this is the RED assertion.
  expect((trigger as unknown as { agent?: string } | null)?.agent).toBe('developer');
});

// companion (not independently RED) — paired with the RED pin above: proves
// the four already-shipped kinds' declarations stay untouched by whatever
// implementation adds agentSlug/agent-complete handling — none of them
// should ever grow a stray "agent" key just because `fields.agentSlug` now
// exists on the input. Passes today (the current builder ignores
// `agentSlug` entirely, for every kind) — its purpose is to fail LOUDLY if a
// future fix threads `agentSlug` into the generic fallback branch instead of
// an `agent-complete`-specific one.
test('companion: buildTriggerDeclaration for flow-complete/merged/cron carries no stray "agent" key even when fields.agentSlug is set', () => {
  const withStrayAgentSlug = { targetId: 'forge-develop', agentSlug: 'developer' } as unknown as TriggerBuilderFields;
  expect(buildTriggerDeclaration('flow-complete', withStrayAgentSlug))
    .toEqual({ on: 'flow-complete', target: { kind: 'flow', ref: 'forge-develop' } });
  expect(buildTriggerDeclaration('merged', withStrayAgentSlug))
    .toEqual({ on: 'merged', target: { kind: 'flow', ref: 'forge-develop' } });
  expect(buildTriggerDeclaration('cron', { ...withStrayAgentSlug, schedule: '0 3 * * *' }))
    .toEqual({ on: 'cron', target: { kind: 'flow', ref: 'forge-develop' }, schedule: '0 3 * * *', concurrency: 'forbid' });
});

// ---------------------------------------------------------------------------
// zyc review finding 1 (MAJOR, route-works≠feature-works) — pr-merged /
// issue-raised must build a REAL "webhook" block, not the bare {on,target}
// fallback.
//
// cli/bridge-hooks.ts's `findWebhookTrigger` (~:94-115) resolves an incoming
// delivery ONLY by scanning every flow for a trigger whose
// `webhook.id === hookId` (WEBHOOK_FAMILY_KIND_IDS covers webhook/pr-merged/
// issue-raised alike). Before this fix, `buildTriggerDeclaration` only built
// a `webhook:` block for `kind === 'webhook'` — pr-merged/issue-raised fell
// through to the generic `return { on: kind, target }` with no webhook key
// at all, so a trigger authored through the real UI/client path was
// authorable-but-permanently-dead: no hook URL could ever address it.
// ---------------------------------------------------------------------------

function prMergedWebhookFields(): TriggerBuilderFields {
  return {
    targetId: 'forge-develop',
    webhookId: 'myproj-pr-merged',
    webhookProvider: 'github',
    webhookEvents: ['pull_request'],
    webhookSecretEnv: 'MYPROJ_WEBHOOK_SECRET',
    webhookSources: 'parsoFish/myproj',
  };
}

test('RED (zyc finding 1): buildTriggerDeclaration("pr-merged", {...webhook fields}) must emit a real "webhook" block, not the bare {on,target} fallback', () => {
  const trigger = buildTriggerDeclaration('pr-merged', prMergedWebhookFields());
  // Precondition: the fields were complete enough to build SOMETHING at all
  // (a null here would mean the test fixture itself is broken, not the
  // production defect this test targets).
  expect(trigger).not.toBeNull();
  expect(trigger?.on).toBe('pr-merged');
  // The defect: today's builder returns { on: 'pr-merged', target } — no
  // "webhook" key — so this is the RED assertion.
  expect(trigger?.webhook).toEqual({
    id: 'myproj-pr-merged',
    provider: 'github',
    events: ['pull_request'],
    secretEnv: 'MYPROJ_WEBHOOK_SECRET',
    sources: ['parsoFish/myproj'],
  });
});

test('RED (zyc finding 1): a pr-merged trigger built via the real client path is one validate-triggers.ts actually accepts (webhook.id present, zero lint findings)', () => {
  const trigger = buildTriggerDeclaration('pr-merged', prMergedWebhookFields());
  expect(trigger).not.toBeNull();
  // findWebhookTrigger's ONLY match key — must be present for the delivery
  // to ever be routable at all.
  expect(trigger?.webhook?.id).toBe('myproj-pr-merged');

  const flow: FlowDefinition = {
    id: 'flow-a', name: 'Flow A', version: 1, goal: '', project: 'demo-project', kb: null,
    costCeilingUsd: 0, origin: 'studio', nodes: [], edges: [],
    triggers: trigger ? [trigger] : [],
    path: '/dev/null/flow.yaml',
  };
  const findings = checkFlowTriggers(flow, new Map<string, AgentDefinition>(), {
    flowIds: new Set(['flow-a', 'forge-develop']),
    flowProjectOf: () => 'demo-project',
  });
  expect(findings).toEqual([]);
});

test('companion (zyc finding 1): issue-raised builds the SAME real webhook shape (the sibling kind, not just pr-merged)', () => {
  const trigger = buildTriggerDeclaration('issue-raised', {
    targetId: 'forge-develop',
    webhookId: 'myproj-issue-raised',
    webhookProvider: 'github',
    webhookEvents: ['issues'],
    webhookSecretEnv: 'MYPROJ_WEBHOOK_SECRET',
    webhookSources: 'parsoFish/myproj',
  });
  expect(trigger?.webhook?.id).toBe('myproj-issue-raised');
  const flow: FlowDefinition = {
    id: 'flow-a', name: 'Flow A', version: 1, goal: '', project: 'demo-project', kb: null,
    costCeilingUsd: 0, origin: 'studio', nodes: [], edges: [],
    triggers: trigger ? [trigger] : [],
    path: '/dev/null/flow.yaml',
  };
  expect(checkFlowTriggers(flow, new Map<string, AgentDefinition>(), {
    flowIds: new Set(['flow-a', 'forge-develop']),
    flowProjectOf: () => 'demo-project',
  })).toEqual([]);
});

// companion — the un-widened kinds (flow-complete/merged/cron/agent-complete)
// must never grow a stray "webhook" key just because WEBHOOK_FAMILY_TRIGGER_
// KINDS now drives the branch condition instead of a literal `=== 'webhook'`.
test('companion (zyc finding 1): non-webhook-family kinds still build no "webhook" key at all', () => {
  expect(buildTriggerDeclaration('flow-complete', { targetId: 'forge-develop' })?.webhook).toBeUndefined();
  expect(buildTriggerDeclaration('merged', { targetId: 'forge-develop' })?.webhook).toBeUndefined();
  expect(
    buildTriggerDeclaration('agent-complete', { targetId: 'forge-develop', agentSlug: 'developer' })?.webhook,
  ).toBeUndefined();
});

test('WEBHOOK_FAMILY_TRIGGER_KINDS: webhook, pr-merged and issue-raised are members — the render gate + builder branch condition FlowHeader.tsx and buildTriggerDeclaration share', () => {
  expect([...WEBHOOK_FAMILY_TRIGGER_KINDS].sort()).toEqual(['issue-raised', 'pr-merged', 'webhook']);
});

// ---------------------------------------------------------------------------
// zyc review finding 2 (MINOR, guard-asymmetry) — `isSameTriggerIdentity`
// must treat `agent` as part of an `agent-complete` row's identity so a
// SECOND row at the same target with a DIFFERENT source agent is not
// mistaken for a duplicate of the first.
//
// FlowHeader.tsx's add-dedup (~:116) and its target-flow dropdown filter
// (~:396) each independently compared only `(on, target)` — excluding a
// valid 2nd agent-complete row for the same target with a different agent,
// even though the server fires each row independently
// (orchestrator/flow-trigger.ts's `fireAgentCompleteTriggers` matches
// per-row by `trigger.agent === completedAgentSlug`).
// ---------------------------------------------------------------------------

test('RED (zyc finding 2): isSameTriggerIdentity must NOT treat two agent-complete rows with the SAME target but a DIFFERENT agent as duplicates', () => {
  const existing: FlowTrigger = { on: 'agent-complete', target: { kind: 'flow', ref: 'forge-develop' }, agent: 'developer' };
  // Precondition: the fixture really is an agent-complete row aimed at the
  // target this test probes against.
  expect(existing.on).toBe('agent-complete');
  expect(existing.target.ref).toBe('forge-develop');

  // Same kind + same target, DIFFERENT agent — a real second trigger, must
  // NOT be reported as a duplicate. This is the RED assertion.
  expect(isSameTriggerIdentity(existing, 'agent-complete', 'forge-develop', 'reviewer')).toBe(false);
});

test('companion (zyc finding 2): two agent-complete rows with the SAME target AND the SAME agent ARE a real duplicate', () => {
  const existing: FlowTrigger = { on: 'agent-complete', target: { kind: 'flow', ref: 'forge-develop' }, agent: 'developer' };
  expect(isSameTriggerIdentity(existing, 'agent-complete', 'forge-develop', 'developer')).toBe(true);
});

test('companion (zyc finding 2): a different target flow is never a duplicate, regardless of agent', () => {
  const existing: FlowTrigger = { on: 'agent-complete', target: { kind: 'flow', ref: 'forge-develop' }, agent: 'developer' };
  expect(isSameTriggerIdentity(existing, 'agent-complete', 'retro-flow', 'developer')).toBe(false);
});

test('companion (zyc finding 2): every OTHER kind stays (on,target)-only — a differing "agent" argument is never consulted (a second cron/webhook/flow-complete/merged row at the same target IS a real duplicate)', () => {
  const cron: FlowTrigger = { on: 'cron', target: { kind: 'flow', ref: 'nightly' }, schedule: '0 3 * * *' };
  expect(isSameTriggerIdentity(cron, 'cron', 'nightly', '')).toBe(true);
  expect(isSameTriggerIdentity(cron, 'cron', 'nightly', 'anything')).toBe(true);

  const flowComplete: FlowTrigger = { on: 'flow-complete', target: { kind: 'flow', ref: 'forge-develop' } };
  expect(isSameTriggerIdentity(flowComplete, 'flow-complete', 'forge-develop', '')).toBe(true);
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
    // W8-A3 (flows-23): the architect session that produced the initiative,
    // served by orchestrator/run-model.ts and carried through parseRun.
    architectSessionId: '2026-08-14T15-26-59-072e0775',
    // W7-A3 (flows-29): served by orchestrator/run-model.ts since W6-RV-2, but
    // was silently dropped here — the exact declared-data-fails-open class
    // this pin exists for. MonitorSummary's ELAPSED depends on it.
    completedAt: '2026-01-01T01:04:00Z',
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
    // W7-B7 (artifact-plan-17): the PR artifact page's link source.
    prUrl: 'https://github.com/parsoFish/gitpulse/pull/12',
    // W6-SW-3 (sweep C8#1): declared on Run and carried by parseRun, so
    // `Required<Run>` demands it here — the pin is only a FIELD-PARITY pin
    // if it enumerates every field (GateBar depends on this one).
    project: 'gitpulse',
    // W8-A2 (ON-7, bead forge-6gv.3.4): the derived budget-stop outcome.
    // `Required<Run>` demands it the moment the field is declared, which is
    // exactly what this parity probe is for — it caught the omission at
    // `test:ui:typecheck` (a CI gate the main tsc pass does not cover).
    // Values differ from every default so a dropped field cannot coincide.
    stopOnBudget: {
      spentUsd: 80.83237065,
      ceilingUsd: 52,
      resumable: true,
      completedWorkItems: 6,
      totalWorkItems: 6,
      stoppedBeforeNode: 'demo',
    },
  };

  const parsed = parseRun(raw);

  for (const key of Object.keys(raw) as (keyof Run)[]) {
    expect(parsed[key], `field "${key}" was dropped (undefined) by parseRun`).not.toBeUndefined();
    expect(parsed[key], `field "${key}" was mutated, not carried through verbatim`).toEqual(raw[key]);
  }
});

test("W7-C3 (forge-cv9): the client Run type admits every server-producible origin — 'triggered' included", () => {
  // orchestrator/run-model.ts types origin 'architect'|'human-directed'|'triggered'
  // (R2-08-F4 made 'triggered' a real, producible value); the client type was
  // narrower, so any consumer switching on origin either failed to compile
  // against real data or was written to handle only two cases. The annotation
  // below is the TYPE-level half (gate-enforced by the forge-ui tests tsc
  // project, forge-opj); the runtime half proves parseRun carries the value.
  const origin: Run['origin'] = 'triggered';
  const parsed = parseRun({ id: 'CYCLE-triggered-origin', origin });
  expect(parsed.origin).toBe('triggered');
});

// ---------------------------------------------------------------------------
// AT-F1-1 (R4-12-F1, rule 38 — wire-contract + caller-count) —
// `fetchContractStages(id)`: the FIRST client function to fetch
// `GET /api/studio/projects/:id/contract-stages`.
//
// KILLS THE ZERO-CALLER GAP: no client function fetches this route today.
// studio-client.ts already fetches a project's projects list / preflight /
// repo-status, but NOTHING hits `contract-stages` — so R4-12-F1's project-page
// "contract buildout" checklist ([data-component="contract-buildout"], the
// [data-checklist-row][data-checklist-status]/[data-detail-line] vocabulary in
// docs/forge-ui-dom-and-harness.md:794-821) has no data source until this
// lands. The route + its 200 body already exist and are server-tested
// (cli/bridge-studio.ts's `contractStagesMatch` branch, built from
// cli/contract-stages.ts's `deriveContractStages`); the missing seam is the
// CLIENT fetch. This test pins that seam BEFORE it is written.
//
// REUSE, not a third mirror: the rows parse into session-client.ts's exported
// `ContractStageRow` (imported above) via its own `parseContractStageRow`
// (session-client.ts:401-414) — the SAME parser the session-shell's
// contract-buildout artifact already runs. The return is typed
// `ContractStageRow[]`, and the parsed rows must equal the captured server
// rows verbatim, so a new client-side row type, or a hand-rolled row parser
// inside studio-client.ts, diverges here and fails.
//
// CAPTURED_CONTRACT_STAGES is the REAL 200-body SHAPE of the route
// (`{ ok, project, stages, sourcesScanned }`, cli/bridge-studio.ts's
// `sendJson(res, 200, { ok:true, project:id, stages:result.rows,
// sourcesScanned:result.sourcesScanned })`), with rows in the canonical
// `deriveContractStages` order (contract, instructions, secrets, demo,
// roadmap — cli/contract-stages.ts:305-311) and each row's real per-field
// shape:
//   - secrets.detail is a `string[]` of env-var NAMES ONLY (D3, load-bearing:
//     cli/contract-stages.ts:165-169 — `[...requiresEnv]`, never a value).
//     `GITHUB_TOKEN` here is a fake IDENTIFIER used as a name; this is a
//     public repo, so it is never a real secret value.
//   - instructions.bytes is a real `number` (the byte length read off disk,
//     cli/contract-stages.ts:146-156), while the config/lock-JSON-backed
//     stages (contract, secrets, demo) carry `bytes: null`.
//
// Fetch harness matches lib/agent-ledger.test.ts: `resolveBridgeUrl` is
// vi.mock'd to a fixed base (above the imports), `fetch` is stubbed for this
// one call, and the SPY is asserted for EXACTLY ONE GET at the exact URL
// (rule 38: caller-count is load-bearing — a project-page render must not
// N+1 this route, and a wrong/hand-rolled path must not silently 404 the
// checklist into emptiness).
// ---------------------------------------------------------------------------

// W7-C3 (forge-opj): a `vi.fn(async () => …)` mock declares ZERO parameters,
// so `fetchSpy.mock.calls[0][0]` is an out-of-range index on a 0-tuple —
// invisible while nothing type-checked these files, and it silently defeats
// every wire-contract (URL + init) assertion's type safety. Declaring the
// fetch-shaped parameters costs no behaviour change and makes those
// assertions check real fetch arguments.
type FetchArgs = [input: string, init?: RequestInit];

const BRIDGE_BASE = 'http://bridge.test';

const CAPTURED_CONTRACT_STAGES: {
  ok: true;
  project: string;
  stages: ContractStageRow[];
  sourcesScanned: string[];
} = {
  ok: true,
  project: 'mdtoc',
  stages: [
    { stage: 'contract', status: 'present', source: '.forge/project.json', detail: ['gate command: npm test'], bytes: null },
    { stage: 'instructions', status: 'present', source: 'AGENTS.md', detail: ['source file: AGENTS.md'], bytes: 1487 },
    // D3 (security): secrets.detail is env-var NAMES ONLY — never a value.
    // GITHUB_TOKEN is a fake identifier standing in for a declared name.
    { stage: 'secrets', status: 'present', source: '.forge/project.json', detail: ['GITHUB_TOKEN'], bytes: null },
    { stage: 'demo', status: 'present', source: '.forge/project.json + .forge/demo/demo.lock.json', detail: ['step: capture', 'step: verify', 'step: present'], bytes: null },
    { stage: 'roadmap', status: 'present', source: 'roadmap.md', detail: ['brain profile: present (brain/projects/mdtoc/profile.md)'], bytes: 20416 },
  ],
  sourcesScanned: [
    '.forge/project.json (contract: testProcess.local.cmd) + .forge/contract-compliance-report.json',
    'AGENTS.md | CLAUDE.md (instructions)',
    '.forge/project.json (secrets: testProcess.acceptance.requiresEnv — NAMES ONLY, never a value)',
    '.forge/project.json (demoProcess) + .forge/demo/demo.lock.json (built)',
    'roadmap.md + brain/projects/mdtoc/profile.md (C4 divergence visibility, not a verdict)',
  ],
};

const CONTRACT_STAGE_ORDER = ['contract', 'instructions', 'secrets', 'demo', 'roadmap'];

afterEach(() => {
  vi.unstubAllGlobals();
});

test('AT-F1-1: fetchContractStages(id) issues EXACTLY ONE GET to /api/studio/projects/:id/contract-stages and parses the real 5-row payload into ContractStageRow[] in canonical order (reuses the session-client row type + parser — no third mirror)', async () => {
  // KILL 1 (zero-caller gap): no client function fetches this route today.
  // Until `fetchContractStages` is exported this binding is `undefined` -> RED
  // here, naming exactly the gap this AT closes.
  expect(
    typeof fetchContractStages,
    'fetchContractStages is not exported from ./studio-client yet — the zero-caller gap this AT closes',
  ).toBe('function');

  const fetchSpy = vi.fn(async (..._args: FetchArgs) => ({
    ok: true,
    status: 200,
    json: async () => CAPTURED_CONTRACT_STAGES,
  }));
  vi.stubGlobal('fetch', fetchSpy);

  const rows = await fetchContractStages('mdtoc');

  // --- caller-count + wire-contract (rule 38) ---
  // EXACTLY ONE GET — kills an N+1 render and any double-fetch.
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  // The exact URL — kills a hand-rolled / wrong path (e.g. dropping the
  // /studio/ segment, or a `?project=` query shape) that would 404 silently.
  expect(fetchSpy.mock.calls[0][0]).toBe(`${BRIDGE_BASE}/api/studio/projects/mdtoc/contract-stages`);
  // A read — a bare GET (no init, or an explicit method:'GET'); never POST/PUT.
  const init = fetchSpy.mock.calls[0][1] as { method?: string } | undefined;
  expect(init?.method ?? 'GET').toBe('GET');

  // --- parses into ContractStageRow[] of length 5, canonical order ---
  expect(Array.isArray(rows)).toBe(true);
  expect(rows).toHaveLength(5);
  expect(rows.map((r) => r.stage)).toEqual(CONTRACT_STAGE_ORDER);

  // secrets row: detail is a string[] of env NAMES only (D3) — never a value.
  const secrets = rows[2];
  expect(secrets.stage).toBe('secrets');
  expect(Array.isArray(secrets.detail)).toBe(true);
  expect(secrets.detail.every((d) => typeof d === 'string')).toBe(true);
  expect(secrets.detail).toEqual(['GITHUB_TOKEN']);

  // instructions row: bytes is a real number (byte length read off disk).
  const instructions = rows[1];
  expect(instructions.stage).toBe('instructions');
  expect(typeof instructions.bytes).toBe('number');
  expect(instructions.bytes).toBe(1487);

  // REUSE proof: the parsed rows carry the real ContractStageRow shape
  // verbatim (parseContractStageRow round-trips stage/status/source/detail/
  // bytes). A re-derived or renamed client mirror would diverge here.
  expect(rows).toEqual(CAPTURED_CONTRACT_STAGES.stages);
});

// ---------------------------------------------------------------------------
// W6-B11 — fetchStudioSessions: the client read for the aggregate in-flight
// sessions index (cli/ui-bridge.ts's GET /api/studio/sessions).
// ---------------------------------------------------------------------------

const SESSION_INDEX_ROWS = [
  {
    kind: 'instructions', sessionId: '2026-08-02T11-00-00', project: 'gitpulse', phase: 'awaiting-verdict',
    terminal: false, needsYou: true, modelTier: 'sonnet', updatedAt: '2026-08-02T11:00:00.000Z',
    href: '/sessions/instructions/2026-08-02T11-00-00?project=gitpulse',
  },
];

test('fetchStudioSessions() defaults to ?active=1 (operator-locked: in-flight sessions only) and parses the wire rows verbatim', async () => {
  expect(typeof fetchStudioSessions, 'fetchStudioSessions is not exported from ./studio-client yet').toBe('function');

  const fetchSpy = vi.fn(async (..._args: FetchArgs) => ({ ok: true, status: 200, json: async () => ({ sessions: SESSION_INDEX_ROWS }) }));
  vi.stubGlobal('fetch', fetchSpy);

  const rows = await fetchStudioSessions();

  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${BRIDGE_BASE}/api/studio/sessions?active=1`);
  expect(rows).toEqual(SESSION_INDEX_ROWS);
});

test('fetchStudioSessions(false) fetches the unfiltered index (no ?active= query)', async () => {
  const fetchSpy = vi.fn(async (..._args: FetchArgs) => ({ ok: true, status: 200, json: async () => ({ sessions: [] }) }));
  vi.stubGlobal('fetch', fetchSpy);

  await fetchStudioSessions(false);

  expect(fetchSpy.mock.calls[0][0]).toBe(`${BRIDGE_BASE}/api/studio/sessions`);
});

// W7-A1 (home-sessions-29 / home-sessions-V01): this pin used to assert the
// DEFECT — "degrades to [] (never throws) on non-2xx" — the exact swallow that
// made /sessions render "No sessions in flight" on a 500. Flipped: a non-2xx
// REJECTS with a BridgeReadError carrying the bridge's own status + text, so no
// caller can receive a value it could mistake for an empty index.
test('fetchStudioSessions() REJECTS with BridgeReadError{status:500, message:"boom"} when the bridge responds non-2xx — never resolves []', async () => {
  const fetchSpy = vi.fn(async (..._args: FetchArgs) => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }));
  vi.stubGlobal('fetch', fetchSpy);

  await expect(fetchStudioSessions()).rejects.toMatchObject({ name: 'BridgeReadError', status: 500, message: 'boom' });
});

// ---------------------------------------------------------------------------
// R4-19-F2 T3 — startKbCleanup: the typed client caller for the kb-cleanup
// session's kickoff route (cli/ui-bridge.ts):
//   POST /api/studio/kbs/:id/cleanup/start  -> {ok:true, sessionId, project}
// (route body verified by direct reading of cli/ui-bridge.ts's own
// kbCleanupStartMatch handler — the sendJson shapes pinned below are its
// REAL success/error bodies, not invented ones).
//
// THE GAP this block kills: without this exported function, NO client code
// anywhere can reach the route — a kb-cleanup launcher wired up in
// forge-ui/app/knowledge/page.tsx (next to the existing kb-lint/kb-index/
// kb-maintain-session/kb-delete buttons) would have to hand-roll a fetch, or
// worse, silently have no way to start a cleanup session at all.
//
// W6-B9 (reviewer finding on W6-B8): this block used to ALSO cover
// `applyKbCleanup` (`POST /api/studio/kbs/:id/cleanup/apply`) — that route
// is DELETED (kb-cleanup migrated onto the generic session shell, W6-B8;
// approving now goes through the generic write route, and once its one
// caller — SessionCleanupPanel.tsx — was deleted, the bespoke apply route
// had no production caller left). Its three tests (AT-F2-4..6) are deleted
// with it.
//
// Uses the SAME fetch-mocking harness as AT-F1-1 immediately above
// (`vi.mock('./bridge-client.ts', ...)` at this file's top resolves
// resolveBridgeUrl() to BRIDGE_BASE; `vi.stubGlobal('fetch', fetchSpy)` +
// this file's `afterEach(() => vi.unstubAllGlobals())` per-test).
//
// HOME: studio-client.ts, alongside runKbMaintenance/deleteKb/createKb —
// every OTHER `/api/studio/kbs/:id/...` route caller already lives in this
// module. bridge-client.ts's startAuthoring/finalizeAuthoring is the OTHER
// viable per-session-kind precedent, but that module's callers are for
// session kinds with no natural resource-id (authoring/architect/
// instructions/demo-builder/project-brain all key off `project` + a
// server-minted `sessionId` alone) — kb-cleanup nests under an existing KB
// resource id exactly like maintenance/delete/create already do.
// ---------------------------------------------------------------------------

test('R4-19-F2 AT-F2-1: startKbCleanup is not exported from ./studio-client yet — the zero-caller gap that leaves a kb-cleanup launcher with no route to call', () => {
  expect(
    typeof startKbCleanup,
    'startKbCleanup is not exported from ./studio-client yet',
  ).toBe('function');
});

test('R4-19-F2 AT-F2-2: startKbCleanup(id) issues EXACTLY ONE POST to /api/studio/kbs/:id/cleanup/start with the x-forge-csrf header, and returns {ok:true, sessionId, project} from a real 200 body — BOTH fields matter: a launcher navigating to the session page needs "project" for its ?project=<anchor> query param, not just "sessionId" (kb-cleanup sessions for a non-project-bound KB anchor under a ".kb-<id>" scratch project, cli/ui-bridge.ts\'s KB_SEEDING_ANCHOR_PREFIX carve-out — a launcher that re-derives "project" from the kbId itself, rather than using what this route returns, would silently mis-anchor every non-project KB\'s session URL', async () => {
  const fetchSpy = vi.fn(async (..._args: FetchArgs) => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, sessionId: '2026-08-14T08-34-38-a34fff82', project: '.kb-forge-dev' }),
  }));
  vi.stubGlobal('fetch', fetchSpy);

  const result = await startKbCleanup('forge-dev');

  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${BRIDGE_BASE}/api/studio/kbs/forge-dev/cleanup/start`);
  const init = fetchSpy.mock.calls[0][1] as { method?: string; headers?: Record<string, string> } | undefined;
  expect(init?.method).toBe('POST');
  expect(init?.headers?.['x-forge-csrf']).toBe('1');

  expect(result).toEqual({ ok: true, sessionId: '2026-08-14T08-34-38-a34fff82', project: '.kb-forge-dev' });
});

test('R4-19-F2 AT-F2-3: startKbCleanup(id): a real 404 "unknown kb" body round-trips the server\'s error message VERBATIM as {ok:false, error} — never a generic "failed" string — and carries no sessionId/project', async () => {
  const fetchSpy = vi.fn(async (..._args: FetchArgs) => ({
    ok: false,
    status: 404,
    json: async () => ({ error: 'unknown kb: bogus' }),
  }));
  vi.stubGlobal('fetch', fetchSpy);

  const result = await startKbCleanup('bogus');
  // `expect(result.ok).toBe(false)` does not NARROW the union for the reads
  // below — assert-then-narrow, so a future {ok:true} regression fails here
  // rather than at an `any`-shaped property read.
  if (result.ok) throw new Error(`expected a failure result, got ${JSON.stringify(result)}`);
  expect(result.ok).toBe(false);
  expect(result.error).toBe('unknown kb: bogus');
  expect((result as { sessionId?: string }).sessionId).toBeUndefined();
  expect((result as { project?: string }).project).toBeUndefined();
});

// ---------------------------------------------------------------------------
// W6-B13: KB drain-to-green client (dispatchKbDrain / fetchKbDrainRun /
// fetchActiveOrLatestKbDrain) — the ONE-button, server-owned counterpart to
// the retired LintResolutionPanel scan/apply-all loop. Mirrors the
// startKbCleanup/applyKbCleanup fetch-assertion style directly above.
// ---------------------------------------------------------------------------

test('W6-B13: dispatchKbDrain(id) issues EXACTLY ONE POST to /api/studio/kbs/:id/drain with the x-forge-csrf header, and returns {ok:true, runId} from a real 200 body', async () => {
  const fetchSpy = vi.fn(async (..._args: FetchArgs) => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, runId: 'forge-dev-drain-abc123' }),
  }));
  vi.stubGlobal('fetch', fetchSpy);

  const result = await dispatchKbDrain('forge-dev');

  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${BRIDGE_BASE}/api/studio/kbs/forge-dev/drain`);
  const init = fetchSpy.mock.calls[0][1] as { method?: string; headers?: Record<string, string> } | undefined;
  expect(init?.method).toBe('POST');
  expect(init?.headers?.['x-forge-csrf']).toBe('1');
  expect(result).toEqual({ ok: true, runId: 'forge-dev-drain-abc123' });
});

test('W6-B13: dispatchKbDrain: a real 409 "already active" body round-trips the server\'s error message VERBATIM as {ok:false, error} — never a generic "failed" string', async () => {
  const fetchSpy = vi.fn(async (..._args: FetchArgs) => ({
    ok: false,
    status: 409,
    json: async () => ({ error: 'a drain run is already active for this kb', runId: 'forge-dev-drain-existing' }),
  }));
  vi.stubGlobal('fetch', fetchSpy);

  const result = await dispatchKbDrain('forge-dev');
  expect(result.ok).toBe(false);
  expect(result.error).toBe('a drain run is already active for this kb');
  // studioPost drops the response body on any non-2xx (shared contract with
  // every other route in this module) — a caller recovers the active run's
  // real id via fetchActiveOrLatestKbDrain, never by trusting this field.
  expect(result.runId).toBeUndefined();
});

test('W6-B13: fetchKbDrainRun(id, runId) issues EXACTLY ONE GET to /api/studio/kbs/:id/drain/:runId and returns the full status verbatim', async () => {
  const fetchSpy = vi.fn(async (..._args: FetchArgs) => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true, runId: 'forge-dev-drain-abc123', kbId: 'forge-dev', state: 'running', round: 2,
      counts: { auto: 0, agent: 1, user: 0 }, perFinding: [], costUsd: 0.12, updatedAt: '2026-08-15T00:00:00.000Z',
    }),
  }));
  vi.stubGlobal('fetch', fetchSpy);

  const result = await fetchKbDrainRun('forge-dev', 'forge-dev-drain-abc123');

  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${BRIDGE_BASE}/api/studio/kbs/forge-dev/drain/forge-dev-drain-abc123`);
  const init = fetchSpy.mock.calls[0][1] as { method?: string } | undefined;
  expect(init?.method ?? 'GET').toBe('GET');
  expect(result.state).toBe('running');
  expect(result.round).toBe(2);
  expect(result.counts).toEqual({ auto: 0, agent: 1, user: 0 });
});

test('W6-B13: fetchKbDrainRun: a 404 "unknown drain run" degrades to an honest ok:false fallback — never throws, never fabricates a terminal state', async () => {
  const fetchSpy = vi.fn(async (..._args: FetchArgs) => ({
    ok: false,
    status: 404,
    json: async () => ({ error: 'unknown drain run' }),
  }));
  vi.stubGlobal('fetch', fetchSpy);

  const result = await fetchKbDrainRun('forge-dev', 'bogus-run');
  expect(result.ok).toBe(false);
  expect(result.runId).toBe('bogus-run');
  // W7-A1: the bridge's OWN text, verbatim — not a neutral "no drain status
  // available" that hides what the server actually said.
  expect(result.error).toBe('unknown drain run');
});

test('W6-B13: fetchActiveOrLatestKbDrain(id) issues EXACTLY ONE GET to /api/studio/kbs/:id/drain (no trailing runId segment) and passes runId:null through when no run has ever been dispatched', async () => {
  const fetchSpy = vi.fn(async (..._args: FetchArgs) => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, runId: null }),
  }));
  vi.stubGlobal('fetch', fetchSpy);

  const result = await fetchActiveOrLatestKbDrain('forge-dev');

  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${BRIDGE_BASE}/api/studio/kbs/forge-dev/drain`);
  expect(result.runId).toBeNull();
});

test('W6-B13: fetchActiveOrLatestKbDrain: reattaches to a real active-or-latest run\'s full status when one exists', async () => {
  const fetchSpy = vi.fn(async (..._args: FetchArgs) => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true, runId: 'forge-dev-drain-xyz789', kbId: 'forge-dev', state: 'needs-you', round: 3,
      counts: { auto: 0, agent: 0, user: 1 },
      perFinding: [{ key: 'contradiction::theme.md', check: 'contradiction', kind: 'contradiction', file: 'theme.md', message: 'conflicting guidance', tier: 'user', outcome: 'needs-you' }],
      costUsd: 0.34, updatedAt: '2026-08-15T00:05:00.000Z',
    }),
  }));
  vi.stubGlobal('fetch', fetchSpy);

  const result = await fetchActiveOrLatestKbDrain('forge-dev');
  expect(result.runId).toBe('forge-dev-drain-xyz789');
  expect(result.state).toBe('needs-you');
  expect(result.perFinding).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// R1-06 WI-2 group B (3): bootstrapKb REMOVAL (T1 ruling Q3) — dead code + a
// competing seed path now that KB create hands off to the real project-brain
// agent flow (R1-06-F2). RED today means the export still exists.
// ---------------------------------------------------------------------------

test('RED (R1-06 WI-2 group B, T1 Q3): bootstrapKb must be REMOVED from studio-client — it is a dead, competing seed path', () => {
  expect(Object.keys(StudioClientModule)).not.toContain('bootstrapKb');
});

// ---------------------------------------------------------------------------
// ACCEPTANCE TESTS (T3, R1-06 WI-2 group A) — `deriveKbBandOptions`, the
// pure option-derivation function `/knowledge/new`'s new
// `[data-field="kb-binding-band"]` select must call to decide (a) whether it
// renders at all and (b) what it's populated with.
//
// Why a pure function rather than a `*-render.test.ts` DOM assertion: unlike
// RunPanel/FlowRunDetail/RoadmapCanvas (the components this repo's
// `*-render.test.ts` files render via `renderToStaticMarkup`), NewKbPage
// (forge-ui/app/knowledge/new/page.tsx) is the `app/` ROUTE component
// itself, not a props-driven presentational component — it calls
// `useRouter()` (next/navigation) and owns ALL of `kind`/`ref`/`flows` as
// internal `useState`, populated by a `useEffect` fetch. `useEffect` never
// runs under `renderToStaticMarkup` (SSR-only, no jsdom in this repo — see
// run-panel-render.test.ts's header), so every such render only ever
// observes the SAME fixed initial state (kind='flow', flows=[]) regardless
// of what any mock returns — there is no way to observe an "ABSENT for
// kind=project" render or a "populated from a bound flow's real bands"
// render without simulating a state transition, which requires jsdom/
// interaction plumbing this repo does not have. No other /knowledge or /new
// page has a render test to follow (confirmed: zero matches in this repo for
// "knowledge/new" across forge-ui/lib/*.test.ts before this WI). The
// contract below is exactly what the page's render logic must reduce to:
//   - kind !== 'flow'  -> null   (the page must render NO
//     `[data-field="kb-binding-band"]` element at all)
//   - kind === 'flow'  -> string[] (the bound flow's `bands`, or `[]` when
//     unbound/bandless — the page renders the field with these as its
//     `<option>`s, even when empty, since it's still "present" per kind)
//
// RED today: `deriveKbBandOptions` does not exist on ./studio-client.ts —
// the import above resolves to `undefined`, so the `typeof` guard fails.
// ---------------------------------------------------------------------------

const BANDED_FLOWS: Pick<Flow, 'id' | 'name' | 'bands'>[] = [
  // Mirrors the REAL shipped forge-develop flow's derived band vocabulary
  // (confirmed live via listFlowBandIds(repoRoot, 'forge-develop') ->
  // ['demo-band', 'review-band'], cli/flow-band-vocab.ts) — same ground
  // truth cli/bridge-studio-flows.test.ts's companion route pin uses.
  { id: 'forge-develop', name: 'Forge Develop', bands: ['demo-band', 'review-band'] },
  { id: 'forge-architect', name: 'Forge Architect', bands: [] },
];

test('RED (R1-06 WI-2 group A): deriveKbBandOptions is not exported from ./studio-client yet — the missing-feature gap this pin closes', () => {
  expect(
    typeof deriveKbBandOptions,
    'deriveKbBandOptions is not exported from ./studio-client yet — /knowledge/new has no way to derive the ' +
      'kb-binding-band options a flow-scoped KB binding needs',
  ).toBe('function');
});

test('deriveKbBandOptions("flow", flows, "forge-develop") returns exactly that flow\'s REAL bands: ["demo-band","review-band"]', () => {
  expect(deriveKbBandOptions('flow', BANDED_FLOWS, 'forge-develop')).toEqual(['demo-band', 'review-band']);
});

test('deriveKbBandOptions("flow", flows, ref) for a bound flow with NO bands returns [] — present-but-empty, not undefined/null', () => {
  expect(deriveKbBandOptions('flow', BANDED_FLOWS, 'forge-architect')).toEqual([]);
});

test('deriveKbBandOptions("flow", flows, "") for an UNBOUND ref (no flow selected yet) returns [] — never throws, never the whole flows list', () => {
  expect(deriveKbBandOptions('flow', BANDED_FLOWS, '')).toEqual([]);
});

test('deriveKbBandOptions("project", flows, ref) is ALWAYS null regardless of ref/flows — the field must not render for a project binding', () => {
  // Even a ref that WOULD resolve real bands under kind="flow" must not leak
  // through when kind="project" — proves the kind-gate is checked first/
  // independently, not just "no matching flow found".
  expect(deriveKbBandOptions('project', BANDED_FLOWS, 'forge-develop')).toBeNull();
  expect(deriveKbBandOptions('project', BANDED_FLOWS, '')).toBeNull();
});
