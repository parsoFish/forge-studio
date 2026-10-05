# `@forge/agents`

Runs **one agent**: resolve it, spawn it under a pinned SDK seam, keep what it
spawns contained, classify how it ended. `SPEC.md` §1 is the contract;
`contract.test.ts` enforces it against this file.

Rank 3 in the allow-graph. It may import `contracts`, `kernel`, `library`,
`knowledge` and `projects`. Anything above — `sessions`, `flows`, `factory`,
`orchestrator/`, `cli/` — arrives by **injection at `apps/forge`**, never by
import. That is why the route table and the band surface take a deps object
rather than importing what they need.

## API (67 values)

| seam | exports |
|---|---|
| run one agent | `runAgent` · `isSafeRunId` · `resolveOneShotBudgetUsd` · `dispatchAgentRun` · `findSessionProject` |
| dispatch terminus recording | `installDispatchSignalGuard` · `recordDispatchTerminal` |
| bands | `resolveBandGuard` · `BAND_GUARD_IDS` · `PLATFORM_GUARD_IDS` · `BAND_CANONICAL_SLUG` · `runBandAgentStandalone` · `isStandaloneBandAgent` · `dispatchStandaloneBand` |
| the Ralph loop | `runRalphLoop` · `makeQualityGateFromCmd` · `resolveGateTimeoutMs` |
| the Agent kind | `loadAgentDefinition` · `listAgentDefinitions` · `listStarterAgents` · `isStudioAgent` · `isUnfilteredStudioAgent` · `deriveAgentSpec` · `agentCapabilityDescriptor` · `serializeAgentDefinition` · `PHASE_EXECUTOR_KINDS` |
| the reverse index | `agentUsageIndex` · `agentsUsing` |
| adapters | `getAdapter` · `resolveSdkId` · `isSdkAvailable` |
| the pinned SDK seam | `pinnedSdkQuery` · `pinnedStreamQuery` · `withRunMarker` · `withIdleDeadline` · `StreamDeadlineError` |
| spawn containment | `processesCarryingMarker` · `readRunMarkers` · `tokenBelongsToRunDir` · `AGENT_RUN_MARKER_FILE` |
| skill packages | `skillPath` · `skillsDir` · `skillPathRelative` · `assertSkillSlug` · `listSkillMdDirs` · `listSkillDirs` · `loadSkillTurnPrompt` · `splitSkillTurnSections` · `SLUG_RE` (kernel's own object, re-exported — AT-89) |
| declared-skill composition | `makeProjectSkillsLoadedSink` |
| the agent-slug route helpers | `SAFE_AGENT_SLUG_RE` |
| studio agent validation | `validateAgent` |
| model resolution | `modelForSpec` · `resolveSessionModel` · `MODEL_BY_TIER` · `resolveModelTier` |
| events and classification | `makeToolEventSink` · `extractLiveToolDetails` · `classifyCycleFailure` · `classifyCrash` · `matchesRateLimitSignature` · `matchesDnsFailureSignature` |
| scope and hooks | `takeScopeSnapshot` · `scopeViolations` · `sdkHooksForAgent` |
| AGENTS.md and HTTP | `composeAgentsMd` · `agentsRoutes` |

### Types (14)

`BandGuardId` · `BandAgentDeps` · `StreamQueryFn` · `ModelTier` ·
`AgentsRouteDeps` · `AgentUsageIndex` · `AgentUsageKind` · `AgentInvocation` ·
`QueryFn` · `ClaudeAgentOptions` · `ToolUseLiveDetail` · `GateRunInfo` ·
`PhaseAgentSpec` · `SdkHooksOption`

### Eight literal production subpaths, forced by a cycle

`package.json` also maps eight literal subpaths — `phase-agent.ts`,
`packages/agents/studio/derive.ts`, `skill-path.ts`,
`pinned-sdk-query.ts`, `packages/agents/studio/hook-dispatch.ts`,
`tool-event-emit.ts`, `stream-deadline.ts` and
`packages/agents/studio/agent-registry.ts` — bead `forge-8vfn.5.31`'s repoint work
surfaced a live cross-package cycle: `agent-run.ts`/`agent-dispatch-cmd.ts`
(back then still in this package) imported `@forge/sessions` (an
already-baselined allow-graph violation), and a dozen-plus
`packages/sessions/*.ts`/`kinds/*.ts` files call `deriveAgentSpec(
skillPathRelative(...))` — or build a `kinds/registry.ts`-style object
literal of sibling kind modules — at their OWN top level. A sessions file
reached through THIS door would nest back into `@forge/sessions` while still
mid-load, throwing a TDZ `ReferenceError`/`TypeError` that reproduces under
plain `node --experimental-strip-types` (not a bundler-only quirk). Each of
the eight files above reaches no higher than `@forge/kernel`/`@forge/library`/
`@forge/contracts`, so a sessions `kinds/*.ts` file importing them directly
never re-enters `@forge/sessions` — see `packages/sessions/kinds/
architect-session.ts`'s own module doc for the full chain that was measured.
`agent-run.ts` and `agent-dispatch-cmd.ts` live in
`apps/forge/` (they never belonged to this seam — they compose agents with
sessions and flows), so this door's own top level no longer imports sessions
at all; the eight subpaths stay exactly as they were, unvalidated against
whether that specific cycle edge still applies, since collapsing them is a
separate, unstarted effort.

### The one test-only subpath

`@forge/agents/testing` exports `packages/agents/studio/materials.ts`'s vocabulary
(`MATERIAL_KINDS`, `MAX_MATERIALS_COUNT`, `MAX_MATERIAL_BYTES`,
`MAX_MATERIALS_TOTAL_BYTES`), `DEFAULT_IDLE_DEADLINE_MS`, `registeredSdkIds`,
and `DispatchAgentRunOpts`/`DispatchAgentRunResult` — each has no production
consumer outside this package, only test files reach for them, so they stay
off the main door (bead `forge-8vfn.5.31`).

## Three things the door deliberately does not do

**It does not re-export most of `@forge/kernel`'s id vocabulary.** `skill-path.ts`
re-exports `SLUG_RE`, `PROJECT_ID_RE`, `FORGE_ROOT`, `isReservedId` and the rest
so its own callers need one import instead of two. Those are kernel's names.
Take them from kernel — with one exception: `SLUG_RE` itself IS on this door
(the "skill packages" row above), because a pinned regression guard
(`apps/forge/tests/integration/skill-install-agent-identity.test.ts`'s AT-89,
surviving two prior relocations) asserts this door's `SLUG_RE` is the SAME
object kernel defines, not a second regex with a matching source. The test is
read as the spec here; the door forwards kernel's live binding rather than
redeclaring it.

**`agentUsageIndex` is how library asks about agents.** Library is rank 2 and
may not import this package, so the index is injected at
`apps/forge/routes.ts` (T1 rulings 13 and 73). It answers "which agents use this
skill / hook / connection" from ONE walk, with a `scanned` count, because the
consumers are listings — a per-id lookup would turn one walk into N and could
not report `scanned` at all. `agentsUsing(kind, id, root)` is the thin per-id
wrapper over the same index.

## Crash and recovery

A run's durable record is its `_logs/<runId>/` directory: `events.jsonl`,
`stderr.log`, `turn.pid`, and — for anything spawned through `runAgent` — an
appended `agent-run.marker` (`spawn-marker.ts:95-168`) carrying one
`<runId>:<uuid>` token per line, idempotent to re-record. A dispatch that
returns or throws normally gets its terminus written by
`recordDispatchTerminal` (`dispatch-terminal.ts:97-120`) — best-effort but
never silent: an unwritable log is reported to stderr, not swallowed,
because the alternative is a perpetually "running" record.
`installDispatchSignalGuard` (`dispatch-terminal.ts:158-…`) catches
`SIGTERM`/`SIGINT`/`SIGHUP` and writes the same terminus before exiting
`128+signo`, idempotent (first signal wins, later ones exit without
writing) and always uninstalled in the caller's `finally`. `SIGKILL` cannot
be caught, so a `-9`'d run genuinely ends with no terminus — stated as a
reader-side residual this seam cannot close (`dispatch-terminal.ts:45-48`):
a dead pid plus no terminal event has to be read as finished, not written
around.

A standalone run's live/crashed/stalled state is never stored either — it
is re-derived each read from `events.jsonl`/`stderr.log`/`turn.pid` mtimes
(`readStandaloneLivenessFacts`, `bridge-agents-run-state.ts:256-291`), with
a terminal marker (`done`/`failed`/`cancelled`) never overridden by a later
stale-looking poll (`bridge-agents-run-state.ts:293-306`). Liveness is the
same `/proc/<pid>/cmdline` ownership proof sessions uses (`isTurnAlive`,
injected via `AgentRunStateDeps` from `@forge/sessions` since this package
is rank 3), never a bare pid check. Orphaned agent processes are reaped by
`scripts/stories/reap.mjs` walking ppid/pgid links; the marker file is the
third rung, for a process that escapes both (a `setsid`'d grandchild that
also re-parents before the snapshot) — `processesCarryingMarker`
(`spawn-marker.ts:245-276`) never throws and matches by uid plus a *whole*
`FORGE_AGENT_RUN_MARKER=<token>` environ entry, never a name/argv pattern,
and it is cooperative, not enforced: a process that deliberately scrubs its
env before re-exec is invisible to it. A cost-ceiling halt classifies
`terminal`/non-recoverable, never auto-retried
(`failure-classifier.ts:558-567`): "resumable" there means an operator can
raise the ceiling and requeue from that phase boundary, not that the
scheduler retries it unattended.

Tests: `packages/agents/tests/regression/dispatch-terminal.test.ts` (SIGTERM terminus,
idempotence, unwritable-log reporting), `packages/agents/tests/regression/spawn-marker.test.ts`
(token binding + sweep), `packages/agents/tests/unit/failure-classifier.test.ts`
(cost-ceiling classification). Standalone crashed/stalled derivation is
proven in `apps/forge/tests/regression/ui-bridge-standalone-stalled.test.ts`,
outside this package because `AgentRunStateDeps` is bound at `apps/forge`.

## Layout

`run-agent.ts` is the spawn primitive; `agent-dispatch.ts` is the one-shot
dispatch verb's package-side half (`dispatchAgentRun` — resolve, assemble the
prompt, run it). Its CLI wrapper `agent-dispatch-cmd.ts` (`cmdAgentDispatch`)
and the interactive turn verb `agent-run.ts` (`cmdAgent`/`cmdAgentRun`/
`AGENT_RUNNERS`) live in `apps/forge/`: both compose this package with
`@forge/sessions` and `@forge/flows`, which is the assembly's job, not this
one-door package's. `agent-dispatch.ts` no longer fires `on: agent-complete`
triggers itself — `cmdAgentDispatch` does that immediately after
`dispatchAgentRun` returns, since firing them needs `@forge/flows` (rank 6),
above this package's rank. `band-agent-run.ts` runs the two banded successors
through their real flow pipelines, injected. `ralph/` is the multi-iteration
loop. `studio/` is the Agent kind — loader, derivation, usage index, hook
dispatch. `_adapters/` is the SDK registry. `routes.ts` plus
`bridge-agents-*.ts` are the HTTP surface, assembled at `apps/forge/routes.ts`.
Design notes: `design.md`.

`project-skills.ts`'s `composeProjectSkills` folds a project's declared
`.forge/project.json` `skills[]` (`@forge/projects`'s
`loadDeclaredSkills`) into an agent's system prompt (SPEC §1); both
spawn builders — `run-agent.ts`'s one-shot path and `ralph/claude-agent.ts`'s
dev-loop path — call it, not just this package's own public door.
