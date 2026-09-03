# `@forge/agents`

Runs **one agent**: resolve it, spawn it under a pinned SDK seam, keep what it
spawns contained, classify how it ended. `SPEC.md` §1 is the contract;
`contract.test.ts` enforces it against this file.

Rank 3 in the allow-graph. It may import `contracts`, `kernel`, `library`,
`knowledge` and `projects`. Anything above — `sessions`, `flows`, `factory`,
`orchestrator/`, `cli/` — arrives by **injection at `apps/forge`**, never by
import. That is why the route table and the band surface take a deps object
rather than importing what they need.

## API (57 values)

| seam | exports |
|---|---|
| run one agent | `runAgent` · `isSafeRunId` · `dispatchAgentRun` · `cmdAgent` · `cmdAgentRun` · `cmdAgentDispatch` · `parseAgentDispatchArgs` · `findSessionProject` |
| bands | `resolveBandGuard` · `BAND_GUARD_IDS` · `PLATFORM_GUARD_IDS` · `BAND_CANONICAL_SLUG` · `runBandAgentStandalone` · `isStandaloneBandAgent` · `dispatchStandaloneBand` |
| the Ralph loop | `runRalphLoop` · `makeQualityGateFromCmd` · `resolveGateTimeoutMs` |
| the Agent kind | `loadAgentDefinition` · `listAgentDefinitions` · `listStarterAgents` · `isStudioAgent` · `isUnfilteredStudioAgent` · `deriveAgentSpec` · `agentCapabilityDescriptor` · `serializeAgentDefinition` |
| the reverse index | `agentUsageIndex` · `agentsUsing` |
| adapters | `getAdapter` · `resolveSdkId` · `isSdkAvailable` |
| the pinned SDK seam | `pinnedSdkQuery` · `pinnedStreamQuery` · `withRunMarker` · `withIdleDeadline` |
| spawn containment | `processesCarryingMarker` |
| skill packages | `skillPath` · `skillsDir` · `skillPathRelative` · `assertSkillSlug` · `listSkillMdDirs` · `loadSkillTurnPrompt` · `splitSkillTurnSections` |
| model resolution | `modelForSpec` · `resolveSessionModel` · `MODEL_BY_TIER` |
| events and classification | `makeToolEventSink` · `extractLiveToolDetails` · `classifyCycleFailure` · `classifyCrash` · `matchesRateLimitSignature` |
| scope and hooks | `takeScopeSnapshot` · `scopeViolations` · `sdkHooksForAgent` |
| AGENTS.md and HTTP | `composeAgentsMd` · `agentsRoutes` |
| the legacy dispatch table | `AGENT_RUNNERS` |

### Types (7)

`BandGuardId` · `BandAgentDeps` · `StreamQueryFn` · `ModelTier` ·
`AgentsRouteDeps` · `AgentUsageIndex` · `AgentUsageKind`

## Three things the door deliberately does not do

**It does not re-export `@forge/kernel`'s id vocabulary.** `skill-path.ts`
re-exports `SLUG_RE`, `PROJECT_ID_RE`, `FORGE_ROOT`, `isReservedId` and the rest
so its own callers need one import instead of two. Those are kernel's names.
Take them from kernel.

**`agentUsageIndex` is how library asks about agents.** Library is rank 2 and
may not import this package, so the index is injected at
`apps/forge/routes.ts` (T1 rulings 13 and 73). It answers "which agents use this
skill / hook / connection" from ONE walk, with a `scanned` count, because the
consumers are listings — a per-id lookup would turn one walk into N and could
not report `scanned` at all. `agentsUsing(kind, id, root)` is the thin per-id
wrapper over the same index.

**`AGENT_RUNNERS` is exported although it is empty.** All four legacy kinds have
been ported to `packages/sessions/kinds/`. It stays because
`packages/sessions/studio/session-kinds.test.ts` asserts against it — the
tripwire keeping ADR-043 §3's dispatch fork from re-opening the per-runner cap
park — and because `knownAgentIds` derives the operator's usage line from the
union of both tables, so a ported kind cannot go invisible while still working.

## Layout

`run-agent.ts` is the spawn primitive; `agent-dispatch.ts` and
`agent-dispatch-cmd.ts` are the one-shot dispatch verb; `agent-run.ts` is the
interactive turn verb. `band-agent-run.ts` runs the two banded successors
through their real flow pipelines, injected. `ralph/` is the multi-iteration
loop. `studio/` is the Agent kind — loader, derivation, usage index, hook
dispatch. `_adapters/` is the SDK registry. `routes.ts` plus
`bridge-agents-*.ts` are the HTTP surface, assembled at `apps/forge/routes.ts`.
Design notes: `design.md`.
