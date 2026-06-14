# Forge Studio M6 — Multi-Runtime Adapter Framework (ADR-029): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**SCOPE (operator-directed 2026-06-14):** Build the **framework** so a second SDK can be added later — do NOT add a real second SDK or any new external dependency now. The deliverable is: a `RuntimeAdapter` interface, a registry, a conformance contract suite proven by an **in-repo example/stub adapter (no external SDK)**, `strategy: range` model routing made live **across Claude tiers** (haiku→sonnet→opus — no second runtime needed to demonstrate it), and a registry-driven SDK picker. Adding a real Codex/Gemini/local SDK later = implement the interface + register + install the dep (an ask-first event at that time).

**Goal:** The agent runtime is pluggable. `createClaudeAgent` becomes the reference implementation of a `RuntimeAdapter` interface, moved to `loops/_adapters/claude/` behaviour-identically. A registry maps an sdk id → adapter factory. A conformance suite defines the contract every adapter must satisfy, proven against the Claude adapter AND a dependency-free example adapter. `strategy: range` routing lands in the adapter/spec layer (cheapest-capable-tier-first, escalate on gate failure) — live for Claude tiers today. The SDK picker is driven by which adapters are registered.

**Architecture:** Extract the existing `QueryFn` + `AgentInvocation` seams (already injectable) into a named `RuntimeAdapter` contract. `loops/_adapters/claude/` holds the moved (not rewritten) Claude code; `loops/_adapters/registry.ts` resolves adapters by sdk id; `loops/_adapters/conformance.ts` is the shared contract test. The range router lives next to `modelForSpec` (resolve a tier list → pick cheapest-capable, escalate on gate failure). **No new npm dep** — the example adapter is an in-repo mock; the Claude adapter keeps the existing `@anthropic-ai/claude-agent-sdk` dep.

**Tech Stack:** Existing — TS ESM + node:test, the existing Claude SDK (unchanged), the M0 catalog/registry, the M2 agent-builder RuntimePicker. **No new dependencies.**

---

## Ground-truth facts (verified 2026-06-13/14 — do NOT re-derive)

**The two existing seams (already injectable — M6 names + formalizes them):**
- `QueryFn` (`loops/ralph/claude-agent.ts:22`): `(params: {prompt, options?}) => AsyncIterable<unknown>` — the SDK-call boundary. Every phase uses `sdkQuery as unknown as QueryFn` (PM `project-manager.ts:224`, dev `developer-loop.ts:250`, reflector, architect `architect-runner.ts:196`). The `@anthropic-ai/claude-agent-sdk` `query` is the only SDK import (`claude-agent.ts:16`).
- `AgentInvocation` (`loops/ralph/runner.ts:133`): `(params:{promptPath,agentMdPath,fixPlanPath,worktreePath,iteration}) => Promise<AgentIterationInfo>` — the Ralph-runner boundary. The stub at `runner.ts:142` (`{filesChanged:[],costUsd:0}`) is the minimal implementation; `createClaudeAgent` returns this shape.

**createClaudeAgent (`loops/ralph/claude-agent.ts:178`, the factory to wrap):** `ClaudeAgentOptions` (model/allowedTools/disallowedTools/maxTurns/maxBudgetUsd/permissionMode/systemPrompt/queryFn/idleDeadlineMs/onHeartbeat/onToolUse/onUsageDelta/timers). Calls `withIdleDeadline(queryFn({prompt,options}))` (`:256`), assembles options (cwd/allowedTools/permissionMode acceptEdits/model/maxTurns/abortController, `:184`), returns `{filesChanged, costUsd, toolsUsed, bashCommands, lastAssistantText, tokensIn/Out, cacheReadTokens, cacheCreationTokens}` (`:386`). Cost from `result.total_cost_usd` (`:345`); usage from the result message (`:338`); heartbeat sidecar `setInterval` (`:240`); idle-deadline `withIdleDeadline` from `orchestrator/stream-deadline.ts`.

**Model tiering (`orchestrator/phase-agent.ts`):** `ModelTier = 'haiku'|'sonnet'|'opus'` (:21); `MODEL_BY_TIER` (:27, the 3 claude model ids); `modelForSpec(spec) → MODEL_BY_TIER[spec.tier]` (:50); `PhaseAgentSpec {phase,skill,tier,allowedTools,disallowedTools}` (:33).

**range routing is GATED, not implemented:** `deriveAgentSpec` (`orchestrator/studio/derive.ts:31`) THROWS `if (def.runtime.strategy !== 'fixed' || !def.runtime.model)` with comment "range routing lands M6". `AgentRuntime` (`studio/types.ts:14`) already has `{sdk, strategy: 'fixed'|'range', model?, range?: string[], subagentModel?}`. The range[] is stored (M0 schema + M2 RuntimePicker UI) but no code routes on it.

**Catalog (`studio/catalog.yaml`):** sdks claude(available:true)/codex(false)/gemini(false); models with sdk/tier/costIn/costOut (claude haiku 1/5, sonnet 3/15, opus 5/25). The cost fields (M5 added) enable cheapest-first range routing.

**SDK picker (`forge-ui/components/studio/agent-builder/RuntimePicker.tsx`):** non-installed SDK disabled via `sdkAvailable(sdk) = sdk.available !== false` (:55, toast on click); fixed/range strategy toggle (:75, writes runtime.strategy); range chips push/filter runtime.range (:81). All stored, range not enforced.

**No adapter abstraction exists:** `loops/` has only `README.md` + `ralph/`. `loops/_adapters/` does NOT exist. The extraction points: claude-agent.ts:16/22/178, runner.ts:133, phase-agent.ts:27, derive.ts:31, catalog.yaml, RuntimePicker.tsx:55.

**Spec-side strategy:** the invocation files (pm/dev/unifier/reflector) call `deriveAgentSpec` → `modelForSpec` → pass model to the SDK. `deriveAgentSpec` currently forces `strategy:fixed`. For range, the spec must carry the tier LIST + the runner picks at spawn.

---

## Design decisions locked for M6 (framework-only)

1. **`RuntimeAdapter` interface = the formalized QueryFn+AgentInvocation contract.** Define (in `loops/_adapters/types.ts`):
```ts
export type RuntimeAdapter = {
  id: string;                         // sdk id: 'claude', 'example', (later 'codex'/'gemini')
  available: boolean;                 // is the underlying SDK/dep installed
  createAgent(opts: AdapterAgentOptions): AgentInvocation;   // the Ralph-runner callable
  query: QueryFn;                     // the raw SDK-call boundary (for PM/reflector/architect direct-stream phases)
};
```
The Claude adapter wraps `createClaudeAgent` + `sdkQuery`. The interface is exactly what the existing seams already satisfy — extraction, not redesign.
2. **Claude adapter is MOVED, behaviour-identical.** `loops/_adapters/claude/` holds the moved `claude-agent.ts` (or a thin adapter wrapping it in place — prefer moving it under `_adapters/claude/` and re-exporting from the old path so existing imports don't break, OR update imports). **verify:cycle routine tier is the guard** — the move must be behaviour-identical (the full existing suite passes unchanged + a real cycle still runs green).
3. **The conformance suite is proven WITHOUT a new dep.** `loops/_adapters/conformance.ts` exports `runAdapterConformance(adapter)` — a contract test (the adapter's createAgent returns an AgentInvocation that yields the AgentIterationInfo shape; query yields the expected message stream; callbacks fire). Proven against (a) the Claude adapter (with an injected mock queryFn — no real API), and (b) an in-repo **example adapter** (`loops/_adapters/example/` — a dependency-free mock that implements RuntimeAdapter by echoing/no-op, satisfying the contract). The example adapter proves the registry handles >1 adapter + the conformance suite is real, WITHOUT any external SDK.
4. **Registry** (`loops/_adapters/registry.ts`): `getAdapter(sdkId): RuntimeAdapter`, `listAdapters(): RuntimeAdapter[]`, `registeredSdkIds()`. Claude + example registered. `available` reflects whether the dep is present (claude: true; example: true [it's a mock]; codex/gemini: not registered until added). The catalog's `available` flag is reconciled with the registry (an sdk is selectable iff a registered adapter reports available).
5. **range routing lands in the spec/adapter layer (Claude tiers today):** remove the `deriveAgentSpec` strategy:fixed throw. For `strategy:range`, the spec carries the tier list (from runtime.range → tiers via the catalog); a `resolveRangeModel(spec, {escalate?})` picks the cheapest-capable tier first (by costIn+costOut from the catalog) and escalates to the next tier on gate failure (the dev-loop's retry/gate-fail path bumps the tier). This works ACROSS CLAUDE TIERS (haiku→sonnet→opus) — no second SDK needed. A `fixed` spec is unchanged. The cross-SDK range (claude+codex models in one range) is the later drop-in (the schema already allows it).
6. **UI: registry-driven picker.** RuntimePicker's `sdkAvailable` is driven by the adapter registry (via the catalog reconciled with `registeredSdkIds`) — a registered+available adapter is selectable; others disabled "coming soon". The range strategy UI (already present) becomes functional (range stored + now enforced by M6-5's routing). No real 2nd SDK → codex/gemini stay disabled, but the picker auto-enables any registered adapter.
7. **NO new dep, NO real 2nd SDK.** The example adapter is the proof-of-pluggability. Adding Codex/Gemini/local later: implement RuntimeAdapter in `loops/_adapters/<sdk>/`, register it, install the dep (ask-first). The framework is complete when the example adapter passes conformance + the registry drives the UI + range routes across Claude tiers.

---

## Tasks

### Task 1: ADR-029 + RuntimeAdapter interface + Claude adapter extraction
**Files:** `docs/decisions/029-runtime-adapters.md`, `loops/_adapters/types.ts` (RuntimeAdapter + AdapterAgentOptions), `loops/_adapters/claude/` (move/wrap createClaudeAgent), update imports, tests.
- [ ] ADR-029: record the adapter seam (RuntimeAdapter = QueryFn+AgentInvocation formalized; Claude is the reference, moved behaviour-identically; registry + conformance; range routing in the spec layer; cross-SDK range + real 2nd SDK deferred to a later drop-in needing ask-first). Status Accepted.
- [ ] `loops/_adapters/types.ts`: `RuntimeAdapter` (id/available/createAgent/query) + `AdapterAgentOptions` (the subset of ClaudeAgentOptions an adapter needs). Re-export AgentInvocation/AgentIterationInfo/QueryFn types from here (the canonical adapter contract).
- [ ] `loops/_adapters/claude/index.ts`: `claudeAdapter: RuntimeAdapter` = `{id:'claude', available:true, createAgent: (o)=>createClaudeAgent(o), query: sdkQuery as QueryFn}`. MOVE `claude-agent.ts` under `_adapters/claude/` (or keep it + wrap — prefer keeping claude-agent.ts where it is to minimize churn, and add the thin adapter that wraps it; the "move" is logical — the adapter is the new public seam). Behaviour-identical: createClaudeAgent unchanged.
- [ ] **No behaviour change** — the full existing suite passes UNCHANGED (the Claude path is identical; the adapter is a new wrapper). If any test breaks, the wrap isn't transparent — fix the wrap.
- [ ] Spine green; commit `feat(runtime): ADR-029 RuntimeAdapter interface + Claude reference adapter (behaviour-identical) (M6-1)`.

### Task 2: Adapter registry + conformance suite + example adapter (no dep)
**Files:** `loops/_adapters/registry.ts`, `loops/_adapters/conformance.ts`, `loops/_adapters/example/index.ts` (dependency-free mock adapter), tests.
- [ ] `registry.ts`: `getAdapter(id): RuntimeAdapter` (throw on unknown), `listAdapters()`, `registeredSdkIds()`. Register claudeAdapter + exampleAdapter.
- [ ] `example/index.ts`: `exampleAdapter: RuntimeAdapter` = a dependency-free mock — `createAgent` returns an AgentInvocation that produces a deterministic AgentIterationInfo (e.g. echoes the prompt path, costUsd 0, no files); `query` yields a minimal valid message stream. NO external SDK. This proves the registry handles >1 adapter + exercises the conformance contract for real.
- [ ] `conformance.ts`: `runAdapterConformance(adapter, {queryFn?}): void` (a node:test-driven contract: createAgent returns a callable; calling it yields a well-formed AgentIterationInfo {filesChanged:string[], costUsd:number, ...}; query yields an AsyncIterable; the callbacks/shape hold). Run it against BOTH the Claude adapter (with an injected mock queryFn — no real API call) AND the example adapter.
- [ ] TDD: the conformance suite passes for claude (mock queryFn) + example; registry.getAdapter('claude'|'example') works, unknown → throws; registeredSdkIds() = ['claude','example'].
- [ ] Spine green; commit `feat(runtime): adapter registry + conformance contract proven by a dependency-free example adapter (M6-2)`.

### Task 3: strategy:range model routing (across Claude tiers)
**Files:** `orchestrator/phase-agent.ts` (resolveRangeModel) or a new `orchestrator/model-range.ts`, `orchestrator/studio/derive.ts` (remove the strategy:fixed throw; support range), tests.
- [ ] `resolveRangeModel(rangeModelIds: string[], catalog, {escalateToTier?}): string` — given the range (model ids from runtime.range), order by cost (costIn+costOut from the catalog, cheapest first); pick the cheapest by default; `escalateToTier` (or an escalation index) bumps to the next-pricier on gate failure. Pure function, catalog-driven.
- [ ] `deriveAgentSpec`: remove the `strategy !== 'fixed'` throw. For `strategy:range`, the derived spec carries the tier (the cheapest-capable from the range) OR a marker that the runner resolves at spawn. SIMPLEST: deriveAgentSpec for range → spec.tier = the cheapest tier in the range (so the existing modelForSpec works); the escalation-on-gate-failure is a dev-loop hook (on a gate fail, bump to the next range tier for the retry). Keep `fixed` unchanged (spec.tier from the single model).
- [ ] The escalation: the dev-loop's retry path (the existing gate-fail → retry) bumps the model tier when the agent's strategy is range (cheapest → next on each gate failure, capped at the priciest in the range). Wire minimally: pass the range + current escalation level into the spawn; modelForSpec/resolveRangeModel picks accordingly. (If full dev-loop escalation wiring is deep, deliver resolveRangeModel + the derive support + a range spec resolving to the cheapest tier at spawn, and note the escalation-on-gate-failure as the dev-loop hook — the routing mechanism is the deliverable; the escalation is additive.)
- [ ] TDD: resolveRangeModel picks cheapest; escalates to next tier; a range agent def derives without throwing (spec.tier = cheapest); a fixed agent def unchanged. The no-drift derivation test (M0/M2) still green for the fixed in-cycle agents.
- [ ] Spine green; commit `feat(runtime): strategy:range model routing across Claude tiers (cheapest-first, escalate on gate failure) (M6-3)`.

### Task 4: Registry-driven SDK picker + live range UI
**Files:** `cli/bridge-studio.ts` (or bridge-studio-kbs/the catalog GET — expose registeredSdkIds/availability), `forge-ui/components/studio/agent-builder/RuntimePicker.tsx`, `forge-ui/lib/studio-client.ts`, tests.
- [ ] The catalog GET (or a new GET /api/studio/adapters) reflects the registry: each sdk's `available` = a registered adapter reports available. (Reconcile the static catalog.yaml `available` with the live registry — the registry is the source of truth for "selectable".)
- [ ] RuntimePicker: `sdkAvailable` driven by the registry-reflected catalog (a registered+available adapter → selectable). The range strategy toggle + range chips are already present (M2) — now they map to a real routing behaviour (M6-3). Show the range as functional (the saved agent's strategy:range is honoured). codex/gemini stay disabled (not registered).
- [ ] Next build green; commit `feat(studio-ui): registry-driven SDK picker; range strategy live (M6-4)`.

### Task 5: e2e + verify:cycle (behaviour-identical guard)
**Files:** `scripts/e2e-journey.mjs`, `docs/forge-studio/work-items.md`.
- [ ] e2e: a beat exercising the range strategy in the agent builder (set an agent to strategy:range with ≥2 Claude tiers, the picker reflects it, the YAML preview shows range) — emulated, soft-assert. (No real 2nd SDK to demo.)
- [ ] Full spine: npm test + build + brain lint + studio lint + ui:journey (exit 0, frames).
- [ ] **verify:cycle (authorized, routine tier):** the adapter extraction (M6-1) is the behaviour-identical change that MUST be guarded — re-run verify:cycle to confirm a real cycle still runs through the Claude adapter exactly as before. Use the M3-M5 setup (base f61d186, FORGE_SKIP_CONTRACT_CHECK, clear stale forge branch + resume_from). The dev-agent non-determinism caveat applies (a gate-too-loose FAIL is the orthogonal corpus artifact, not an M6 regression — what matters is the cycle runs through the adapter + reaches the dev gate, proving the extraction is transparent). Document.
- [ ] Commit `feat(runtime): e2e range-strategy beat; M6 — adapter framework complete (M6-5)`; tick work-items M6.

## Task order
1 (interface + Claude adapter, the behaviour-identical extraction) → 2 (registry + conformance + example) → 3 (range routing) → 4 (UI) → 5 (e2e + verify). 3 and 4 can overlap after 2 (routing logic vs UI). Task 1 is the risk (the extraction must be transparent — the full suite is the unit guard, verify:cycle the real guard).

## Self-review notes
- Roadmap M6 ws-1 (ADR-029 + adapter seam)→T1, ws-2 (2nd adapter)→T2 BUT scoped to an in-repo EXAMPLE adapter (no new dep, no real SDK — per the operator's 2026-06-14 direction), ws-3 (strategy:range)→T3, ws-4 (UI)→T4. The conformance suite (the "gate" for a real 2nd adapter) is built + proven by the example adapter, so a real SDK later just runs the existing conformance suite.
- **NO new npm dep** — confirmed by the example-adapter-as-mock decision. A real Codex/Gemini/local SDK is a later drop-in (implement RuntimeAdapter + register + install the dep = ask-first at that time). This plan delivers the framework, not the runtime.
- M6-1 is behaviour-identical (the Claude path is unchanged behind the new wrapper) — guarded by the full suite + verify:cycle.
- range routing is live for Claude tiers (haiku→sonnet→opus); cross-SDK range is schema-ready, deferred.
- After M6, all six Forge Studio milestones are complete; the system is fully pluggable (definitions, flows, KBs, runtimes) with a real 2nd SDK as the only remaining ask-first drop-in.
