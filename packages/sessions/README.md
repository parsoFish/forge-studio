# `@forge/sessions`

The **ADR 043 interactive spine**: session kinds, turnSpec, transcript, lifecycle and finalizers. It owns the **5 Session** seam of `SPEC.md` — **run one interactive session** — and it is **rank 4**.

Rank is not trivia here; it is why several things in this package are shaped the way they are. `packages/knowledge` is rank 2 and may not import this package, so the guarded session-status IO it needs arrives as a **port knowledge declares and `apps/forge` binds** (M4 ruling 99). The manifest functions live in `packages/flows` at rank 5, so the architect kind takes its manifest work through `ArchitectManifestPorts` rather than importing them.

The test that holds this file honest is `contract.test.ts` beside it: it reads the API list out of **this document** at run time and fails against an empty index (T1 ruling 31).

## API

| module | exports |
|---|---|
| `bridge-studio-lifecycle.ts` | `DEFAULT_STALL_CEILING_MS` · `extractErrorMessage` · `isTurnAlive` · `killTrackedRun` · `sessionLogDirName` |
| `bridge-studio-session-helpers.ts` | — |
| `interactive-finalizers.ts` | `InteractiveFinalizerError` |
| `interactive-runner.ts` | `runInteractiveTurn` |
| `interactive-session.ts` | `REDACTED_THINKING_MARKER` · `readSessionStatus` · `writeSessionStatus` |
| `kinds/architect-ports.ts` | — |
| `kinds/architect.ts` | `ARCHITECT_MODEL` · `architectAgentSpec` · `buildManifest` · `listArchitectSessions` · `readArchitectSessionStats` · `runArchitectTurn` |
| `kinds/brain-fix.ts` | `runBrainFixTurn` |
| `kinds/demo-builder.ts` | `DEMO_HTML_REL_PATH` · `demoSessionDir` · `demoTaskLines` |
| `kinds/fix-registry.ts` | `FIX_KIND_RUNNERS` |
| `kinds/instructions.ts` | `instructionsSessionDir` · `runInstructionsTurn` |
| `kinds/registry.ts` | `SESSION_KIND_RUNNERS` |
| `routes.ts` | `sessionsRoutes` |
| `session-phases.ts` | `LEGACY_SESSION_TERMINAL_PHASES` · `LEGACY_SESSION_AWAITS_PHASES` · `LEGACY_SESSION_WORKING_PHASES` |
| `session-readability.ts` | `parseGuardedEventsJsonl` · `readSessionCostUsd` · `parseGuardedFirstEvent` |
| `session-resolution.ts` | `invalidProjectReason` · `sessionIsReadable` · `findSessionProject` |
| `session-status-io.ts` | `guardedReadSessionStatus` · `guardedWriteSessionStatus` · `CANCELLED_PHASE` |
| `session-write-fence.ts` | `writeRootFenceOptions` |
| `packages/sessions/studio/session-kinds-validate.ts` | `validateSessionKinds` |
| `packages/sessions/studio/session-kinds.ts` | `SESSION_STAGES` · `loadSessionKinds` |
| `packages/sessions/studio/session-transcript.ts` | `deriveSessionArtifact` · `safeReadFileInSession` |
| `turn-cost-rows.ts` | `EMIT_FAILED_SIDECAR` · `EMIT_FAILED_STDERR_MARKER` · `emitTurnCostRow` · `emitTurnEndedUnpricedRow` |

### Types

`ArchitectManifestPorts` · `ArchitectStatus` · `BashFenceMode` · `BashFenceOptions` · `ContractStage` · `ContractStageRow` · `ContractStageStatus` · `DemoBuilderStatus` · `DraftInitiative` · `FixKindId` · `FixKindRunner` · `InstructionsStatus` · `InteractiveTurnStatus` · `ParseManifestPort` · `QueryFn` · `RunInteractiveTurnResult` · `SessionKindDescriptor` · `SessionsRouteDeps` · `SpawnTurnOutcome` · `WriteRootCanUseTool`

## One door, plus a documented cycle-avoidance exception and one test-only subpath

`package.json` maps `"."`, `"./testing"`, and — kept deep on purpose — two
literal subpaths pointing at `packages/sessions/studio/session-kinds.ts`
and `packages/sessions/studio/session-transcript.ts`.
`packages/projects/contract-stages.ts` imports `SESSION_STAGES` and three
transcript symbols through those two deep paths rather than the door: going
through `@forge/sessions` there crashed `packages/sessions/contract.test.ts`
with `ReferenceError: Cannot access 'SESSION_STAGES' before initialization` —
the door eagerly pulls in this package's whole module graph, and something
reachable from it cycles back into `contract-stages.ts` before that
same file's module finishes initializing. Bead `forge-8vfn.5.31` kept
this one deep import rather than "fixing" the door at the cost of a live TDZ
crash; every other consumer of this package goes through the door.

`@forge/sessions/testing` exports `stubArchitectManifestPorts` and three
`kinds/architect-critic.ts` symbols (`COMPLETENESS_CRITIC_MODEL`,
`completenessCriticAgentSpec`, `CRITIC_MAX_TOTAL_PROMPT_CHARS`) — each has no
production consumer outside this package, only test files reach for them.
`turn-cost-rows.ts`'s `emitTurnCostRow`/`emitTurnEndedUnpricedRow`/
`EMIT_FAILED_STDERR_MARKER` moved OFF this subpath onto the main door instead
(the "module | exports" table above): `scripts/stories/
structured-unpriced-halts.test.ts` and its siblings import them from the bare
`@forge/sessions` specifier, so the door is read as the spec here rather than
the original "test-only" classification.

## Three status pairs, and why only two are exported

Three read/write status pairs live in this package and they are **not** interchangeable. All six are named here so the near-collision that produced them cannot silently return.

- **`readSessionStatus` / `writeSessionStatus`** (`interactive-session.ts`) — the generic, unguarded primitives, superseded in production by the guarded pair below and retained as the base and for tests.
- **`guardedReadSessionStatus` / `guardedWriteSessionStatus`** (`session-status-io.ts`) — the containment-checked pair every production writer goes through. `guardedWriteSessionStatus` also enforces the **sticky-cancel refusal**: once a session is `cancelled`, a later write cannot move it back.
- **`guardedReadStatus` / `guardedWriteStatus`** (`kinds/architect-session.ts`) — the architect kind's own `ArchitectStatus` accessors, leaf-guarded the same way. **Deliberately not exported**: no module outside this package imports them, and a door should advertise the surface others actually reach, not everything that happens to be public inside.

The sticky-cancel rule is why the session pair is not in `@forge/kernel`, where it would otherwise belong: pushing it down would relocate sessions' lifecycle vocabulary into a rank-0 package.

### The fourth pair, and why it is gone

Until M4-sessions s6 there was a fourth: a raw `readStatus`/`writeStatus` in `kinds/architect.ts`, typed to `ArchitectStatus`, doing an unguarded `join(sessionDir, 'status.json')` write. It had **zero production callers** — the SEC-04 appliers had already moved every call site onto the guarded architect pair — and survived only because three test fixtures used it to plant a status file.

It was one letter of difference from the generic pair in one direction, and an exact collision with the injected step-writer `writeStatus` destructured out of the step args in its own module in the other. It was deleted rather than renamed, and `packages/sessions/tests/regression/kind-turn-log-contract.test.ts` now locks the property that `kinds/architect.ts` names no `status.json` leaf under **any** identifier — the lock it replaced named one spelling, and had never matched anything.

## Three things this package does NOT export

- **The bridge host's helpers.** Body policy is the host's; a route arm takes its body from `ctx.readBody()` through the route envelope (T1 ruling 30), never by importing the host.
- **Kernel's id vocabulary.** `SLUG_RE`, `FORGE_ROOT` and friends are kernel's names; an importer wanting the id rules takes them from the package that defines them.
- **The manifest functions.** They are `packages/flows`', reached through `ArchitectManifestPorts` — a rank-4 package naming a rank-5 module in a value position is the edge the port exists to avoid.

## Crash and recovery

`status.json` is the durable per-session checkpoint. `writeSessionStatus` / `guardedWriteSessionStatus` (`interactive-session.ts:59-68`, `session-status-io.ts:135-148`) are both a plain `writeFileSync`, not tmp+rename — a crash mid-write can truncate it — and the readers treat unparseable JSON as absence, not corruption: `readSessionStatus` / `guardedReadSessionStatus` catch and return `null`, never throw. `guardedWriteSessionStatus` reads-then-writes with no lock of its own, but it does enforce sticky-cancel: an on-disk `cancelled` phase always wins over an incoming write that would move off it (`cancelledPhaseWins`, `session-status-io.ts:104-106`) — the write is refused (`null`, file byte-unchanged) rather than let a turn that finishes after the operator cancelled resurrect the session into `complete`/`failed` (`session-status-io.ts:124-148`). `.heartbeat` is a separate, best-effort liveness file (`makeHeartbeatWriter`, `heartbeat.ts:95-108`, throttled to 2 s, swallows its own write errors) plus an interval ticker (`startHeartbeatTicker`, `heartbeat.ts:68-88`) so a genuinely-alive SDK call that streams nothing for minutes is not misread as dead.

Whether a session is crashed is never stored — it is re-derived on every read from `status.json`'s phase + mtime, `.heartbeat`/`events.jsonl` mtimes, and `stderr.log`: "derive, not store" (`bridge-studio-lifecycle.ts:8-19`). `deriveSessionLifecycle` (`bridge-studio-lifecycle.ts:144-165`) resolves, in order: terminal wins outright; no live turn plus a `stderr.log` newer than `status.json` reads `crashed`; an open operator gate reads `awaiting-operator`; a working session silent past its ceiling (180 s default, 120 s for `architect` — `DEFAULT_STALL_CEILING_MS` / `STALL_CEILING_MS_BY_KIND`, `bridge-studio-lifecycle.ts:91-99`) reads `stalled`; no liveness signal at all is honestly `working` (unknown), never a guessed `stalled`. Liveness itself is a proof of ownership, not a bare pid check: `isTurnAlive` (`bridge-studio-lifecycle.ts:241-258`) requires the session id appear as a *whole* `/proc/<pid>/cmdline` argv element, failing closed on an unreadable `/proc`, a recycled pid, the bridge's own pid, or a substring match — `killTrackedTurn` / `killTrackedRun` (`bridge-studio-lifecycle.ts:387-424`) only ever SIGTERM (group, then pid) a process this check proved is theirs.

Tests: `packages/sessions/tests/regression/interactive-session-cancel-sticky.test.ts` (sticky-cancel refusal), `packages/sessions/tests/unit/heartbeat-ticker.test.ts` (interval ticker vs. message-flow heartbeat), `apps/forge/tests/integration/bridge-studio-lifecycle.test.ts` (crashed/stalled/awaiting-operator derivation, `isTurnAlive` ownership proof).
