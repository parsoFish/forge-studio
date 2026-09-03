# `@forge/sessions` — design

The ADR-043 spine: interactive session lifecycle, transcript, turn and finalize,
plus one module per **session kind** under `kinds/`.

Governing decisions: [ADR 043](../../docs/decisions/043-generic-interactive-surface.md)
(generic interactive surface) · [ADR 024](../../docs/decisions/024-phases-as-subagents-invoking-skills.md)
(agents compose skills) · [ADR 003](../../docs/decisions/003-skills-as-prompts.md) (a prompt is skill
content, not re-baked TS).

## The two drivers, and why there are two

ADR 043's original plan was that every bespoke runner would become **data** — a `turnSpec` phase
table the generic `runInteractiveTurn` walks. Measured against the code (M4 sessions PARK 2, recorded
in the ADR's 2026-09-03 amendment) that is not reachable inside M4: `style: structured` is a stub
behind an empty `SCHEMA_IDS`, the dispatchable finalizer set is `copyStagingToLibrary` alone,
`runFinalizeStep` slug-gates a `packageId` that instructions sessions never carry, and
`FinalizerContext` cannot reach `status`. **M4 ruling 60** took the other half of the ADR's own
architect carve-out instead: a runner that cannot become data becomes a **registered step-handler
variant**, and the drivers own the shared plumbing while each kind owns its identity — *a spine
dissolves shared plumbing, not identity*.

| driver | drives | keyed by | dispatch table |
|---|---|---|---|
| `kinds/kind-turn.ts` | the four session kinds — architect, instructions, demo-builder, project-brain | a session DIRECTORY: `projectRoot` + `kindDir` + `sessionId` + `status.json` + a phase | `kinds/registry.ts` (`SESSION_KIND_RUNNERS`), reached by `forge agent run <agent-id> <session-id>` |
| `kinds/fix-turn.ts` | the two session-LESS fix kinds — brain-fix, preflight-fix | a `runId` alone | `kinds/fix-registry.ts` (`FIX_KIND_RUNNERS`), reached by `forge brain fix` / `forge preflight fix` |

`kind-turn.ts` owns fifteen behaviours and permits **exactly two** optional hooks
(`onMissingStatus`, `preamble`) — **M4 ruling 78** closed that budget, and a kind wanting a third
gets its own entry point instead, because a hook added to a shared driver for one kind is the
ADR-043 machinery ruling 60 declined arriving through the back door.

**`fix-turn.ts` is that "own entry point", taken deliberately rather than by bending the other
driver.** `kind-turn.ts`'s first act is `resolveGuardedPath(projectRoot, [kindDir, sessionId])`
followed by a `guardedReadSessionStatus` whose absence is a refusal, then a phase lookup and a
guarded status WRITE. The two fix turns have none of that — no `projectRoot`, no kind dir, no
`status.json`, no phase — so making session state optional there would have been the same back door
under a different name. The machinery itself is bead `forge-8vfn.6.6` (M5), which carries PARK 2's
five blockers as its acceptance list.

### The twelve behaviours `fix-turn.ts` owns

Copied line for line between `brain-fix-runner.ts` and `preflight-fix-runner.ts` before ports 5–6:

1. `logsRoot` defaulting to `<forgeRoot>/_logs`
2. `createLogger(cycleId, logsRoot)`
3. the heartbeat dir and its throttled `.heartbeat` write
4. the `start` event
5. `makeToolEventSink` with the interactive `{readOnlySampleRate:1, cap:200}` opts
6. `makeReasoningSink` + `makeThinkingSink` on one sink context
7. the skill-prompt read through `skillPath(name, forgeRoot)`, with its literal fallback
8. the `sdkHooksForAgent` wiring, so no kind can spawn hook-blind
9. `queryFn` defaulting to the pinned SDK query, and the `AbortController`
10. the `withIdleDeadline` stream loop — tool details and `toolSeq`, the `text` / `thinking` /
    `redacted_thinking` blocks, `total_cost_usd`
11. the crash path: the `error` event, `flushIteration(1)`, an early return with **no** `end` event
12. `flushIteration(1)` and the `end` event carrying `cost_usd`

### Why `fix-turn.ts` does not call `runAgentTurn` — a fail-closed branch

`interactive-session.ts`'s `runAgentTurn` is the same shape (its own header calls it *"the brain-fix
/ demo-builder shape"*) and reusing it would dissolve behaviour 10 outright. It computes:

```ts
const fenced = args.writeRoots !== undefined && args.writeRoots.length > 0;
```

brain-fix hands an **empty** root list to `writeRootFenceOptions` *deliberately* when
`resolveKbBrainDir` resolves nothing — installing `permissionMode:'default'`, stripping every
fence-gated grant, and installing a `canUseTool` that denies a write matching no root. Every write
refused; the runner's own comment calls that deliberate. Under `runAgentTurn` an empty list means
**unfenced**: `acceptEdits`, the grant intact, no `canUseTool`. Routing brain-fix through it would
convert a deny-all into an allow-all, and both success arms of the port's pin would still be green.

So the loop lives in `fix-turn.ts` and the fence stays the **kind's** decision, expressed in the
options bag it hands over. `tests/regression/fix-turn-capture.test.ts` arm 3 pins that branch, and
mutation M8 in the pin's PR is this precise wrong port.

### Why the kind supplies the options bag

The two bags are ordered differently — brain-fix `cwd, model, disallowedTools, maxTurns,
permissionMode, allowedTools, canUseTool`; preflight-fix `cwd, model, permissionMode, allowedTools,
disallowedTools, maxTurns` — with `abortController` last in both. A shared builder could not preserve
both orders, and key order is a byte-level difference the pin records **separately** so a port cannot
hide a reorder inside a deep-equal. The kind returns the assembled bag; the driver appends
`abortController` and nothing else, which is why every capture survived ports 5–6 unchanged.

## The two dispatch tables are a UNION

`AT-7` — the tripwire for a descriptor silently gaining a `turnSpec` and bypassing its runner — read
`AGENT_RUNNERS` alone, so each kind would have dropped out of it at the exact moment it ported
(§15.77). **Anything enumerating "every session-kind runner" must read `SESSION_KIND_RUNNERS` AND
`FIX_KIND_RUNNERS`.** They are separate files rather than one because `registry.ts` statically
imports all four session kinds, and a `forge brain fix` that resolved through it would load
`kinds/architect.ts` + `architect-plan.ts` (~2,400 lines) to run a single theme repair.

`SESSION_KIND_RUNNERS`'s **declaration order is part of the operator surface**: `knownAgentIds()`
concatenates its keys into `forge agent run`'s usage line (§15.79). `FIX_KIND_RUNNERS` feeds no
derived list — its two ids are typed by the operator as subcommands (`forge brain fix`,
`forge preflight fix`) — so it has no ordering contract, which is stated here so the next port does
not assume symmetry.

## Per-session SDK / model / effort

The model is exposed and proven live: each kind derives its spec from `skills/<name>/SKILL.md`
(ADR 024) and `modelForSpec` resolves the tier, and the M1 `kickoff-model-tier` field is pinned by
S9 beat 5. **Recording** it — the chosen tier appearing in the session's own transcript/cost line —
is NOT built, and `effort` and an SDK selector do not exist in the product at all. Exit row 7 is
half-met and this paragraph is the honest as-built statement, not a plan.

## The transcript is the honest record, for now

The event log stops before the dispatched agent (bead `forge-8vfn.5.38`), so a spawned agent's own
spend and lifetime are not in forge's ledger — S9 run 3's 17 calls / 369k input / $— were recovered
from the HOST's per-cwd usage records, not from forge. Until 5.38 closes, a session's transcript is
the honest record of what happened and the event log is incomplete by construction. Containment of
the spawn itself (every spawn passing an explicit cwd) is bead `forge-8vfn.5.37`'s, wave 3.
