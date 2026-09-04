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
| `kinds/instructions.ts` | `instructionsSessionDir` · `runInstructionsTurn` |
| `kinds/registry.ts` | `SESSION_KIND_RUNNERS` |
| `routes.ts` | `sessionsRoutes` |
| `session-readability.ts` | `parseGuardedEventsJsonl` |
| `session-resolution.ts` | `invalidProjectReason` · `sessionIsReadable` |
| `session-status-io.ts` | `guardedReadSessionStatus` · `guardedWriteSessionStatus` |
| `studio/session-kinds-validate.ts` | `validateSessionKinds` |
| `studio/session-kinds.ts` | `SESSION_STAGES` · `loadSessionKinds` |
| `studio/session-transcript.ts` | `deriveSessionArtifact` · `safeReadFileInSession` |

### Types

`ArchitectManifestPorts` · `ArchitectStatus` · `ContractStage` · `ContractStageRow` · `ContractStageStatus` · `DemoBuilderStatus` · `DraftInitiative` · `InstructionsStatus` · `InteractiveTurnStatus` · `ParseManifestPort` · `QueryFn` · `RunInteractiveTurnResult` · `SessionKindDescriptor` · `SessionsRouteDeps` · `SpawnTurnOutcome`

## Three status pairs, and why only two are exported

Three read/write status pairs live in this package and they are **not** interchangeable. All six are named here so the near-collision that produced them cannot silently return.

- **`readSessionStatus` / `writeSessionStatus`** (`interactive-session.ts`) — the generic, unguarded primitives, superseded in production by the guarded pair below and retained as the base and for tests.
- **`guardedReadSessionStatus` / `guardedWriteSessionStatus`** (`session-status-io.ts`) — the containment-checked pair every production writer goes through. `guardedWriteSessionStatus` also enforces the **sticky-cancel refusal**: once a session is `cancelled`, a later write cannot move it back.
- **`guardedReadStatus` / `guardedWriteStatus`** (`kinds/architect-session.ts`) — the architect kind's own `ArchitectStatus` accessors, leaf-guarded the same way. **Deliberately not exported**: no module outside this package imports them, and a door should advertise the surface others actually reach, not everything that happens to be public inside.

The sticky-cancel rule is why the session pair is not in `@forge/kernel`, where it would otherwise belong: pushing it down would relocate sessions' lifecycle vocabulary into a rank-0 package.

### The fourth pair, and why it is gone

Until M4-sessions s6 there was a fourth: a raw `readStatus`/`writeStatus` in `kinds/architect.ts`, typed to `ArchitectStatus`, doing an unguarded `join(sessionDir, 'status.json')` write. It had **zero production callers** — the SEC-04 appliers had already moved every call site onto the guarded architect pair — and survived only because three test fixtures used it to plant a status file.

It was one letter of difference from the generic pair in one direction, and an exact collision with the injected step-writer `writeStatus` destructured out of the step args in its own module in the other. It was deleted rather than renamed, and `tests/regression/kind-turn-log-contract.test.ts` now locks the property that `kinds/architect.ts` names no `status.json` leaf under **any** identifier — the lock it replaced named one spelling, and had never matched anything.

## Three things this package does NOT export

- **The bridge host's helpers.** Body policy is the host's; a route arm takes its body from `ctx.readBody()` through the route envelope (T1 ruling 30), never by importing the host.
- **Kernel's id vocabulary.** `SLUG_RE`, `FORGE_ROOT` and friends are kernel's names; an importer wanting the id rules takes them from the package that defines them.
- **The manifest functions.** They are `packages/flows`', reached through `ArchitectManifestPorts` — a rank-4 package naming a rank-5 module in a value position is the edge the port exists to avoid.
