# packages/contracts — design notes

## `runnable-source.ts` — one rule, importable from a browser bundle

`forge-8vfn.7.6.132`, T1 rulings 1124 / 1134.

`enqueueFlowRun` has always claimed a `ready-for-review` manifest whose `flow_id` differs
from the target — its own comment names the case, *"a hand-off state (e.g. forge-architect
finalised with no review node) and IS runnable"*, and its claim-source list includes
`paths.readyForReview`. No UI surface offered it. Three surfaces each re-derived the rule by
hand and all three drifted the same way:

    RoadmapCanvas.tsx       status === 'pending' && ready && planned
    kickoff-candidates.ts   if (r.status !== 'planned') continue
    planned-initiatives.ts  listed _queue/pending/ only

So the transition the server implements was unreachable from the product. Measured on S10
run 19: a manifest carrying `flow_id: forge-architect` in `_queue/ready-for-review/`, target
`forge-develop` — claimable, offered by nothing, and the story's kickoff beat failed with
"no element carries that handle".

### Why it lives in `contracts`, and why it imports nothing

`check-boundaries` allows `apps/studio` to import from `packages/contracts` and nothing
else, so a rule three client-side surfaces must share can only live here.

It is importless by construction. With the rule in `packages/flows` — which reaches
`node:fs` and `node:path` — root `tsc` passed, the UI typecheck passed, and `npm run build`
failed with three `UnhandledSchemeError`s, because `RoadmapCanvas.tsx` is a `'use client'`
component and webpack refuses the `node:` scheme in a browser graph. That was measured, not
anticipated: the suite, the typechecks and the build are three different questions (§15.567).
`runnable-source-single.test.ts` doors the importlessness, because the breakage it prevents
surfaces far from this file.

### What it deliberately does NOT decide

Each surface keeps its own narrower policy ON TOP of the shared rule, composed rather than
replaced:

- the kickoff picker still refuses `done`/`failed` — offering every complete initiative is
  how one click yanked a shipped manifest out of `_queue/done` and re-ran it (W7-FIX-A3);
- the roadmap card still applies its own `ready && planned` dependency and decomposition
  gates, which the server does not speak to.

An unreadable `flow_id` resolves to NOT runnable (§15.504): "I cannot tell which flow parked
this" must never become "it belongs to a different flow", or a sibling is enqueued beside a
live gate.

## `run-view-types.ts` — three fields resolved toward the wire, not the server

Bead `forge-8vfn.5.17`, M7-C. `RunStatus`/`RunPhaseStatus`/`RunPhaseMeta`/`Run` moved here
from `packages/flows/run-view-types.ts` (parked there by M2-B to break the
`run-model.ts` ↔ `run-model-derive.ts` cycle) — their correct home, since `apps/studio`'s
`'use client'` components need them and `@forge/contracts` is the only package they may
import (`check-boundaries`). `apps/studio/lib/studio-client.ts` had hand-mirrored the same
four since M1-2, with no parity test comparing the two declarations
(`studio-client.test.ts:791` names the gap, citing bead `forge-cv9`).

Doing the move properly — replacing the studio mirror with an import of THIS declaration,
rather than leaving two copies typed identically by coincidence — surfaced that the two
mirrors had already drifted on three fields. Each is resolved below toward whichever side
is backed by a real, tested, load-bearing fact; none of the three is a behaviour change,
only a widened/corrected TYPE:

- **`Run.costUsd: number | null`, not `number`.** The flows-side derivation
  (`sumAuthoritativeCostUsd`) always sums to a real number, so this field looked safe as
  `number` there. But `apps/studio/lib/studio-client.ts`'s `parseRun` treats the wire
  payload as untrusted (`finiteNumberOr(r.costUsd, null)`), and `null` there is an honest,
  tested, load-bearing "no cost recorded" — never a fabricated `0` (bead `forge-ygys`,
  `apps/studio/tests/integration/run-cost-null.test.ts`). A type that only describes the
  server's own construction path is not honest about what the client legitimately produces
  from the same field over HTTP.
- **`Run.workItems[].costUsd`, optional, not required.** `parseRun` carries `workItems`
  through with `r.workItems ?? []` and no per-item validation, so the declared type must not
  claim a guarantee the parser doesn't enforce. `apps/studio/tests/unit/monitor-layout.test.ts`'s
  `makeRun()` fixture is real, typed, in-repo proof: its work items omit `costUsd` and
  compile today against the (correctly) optional studio field.
- **`Run.trigger.kind: string`, not `TriggerKindId`.** The flows-side `deriveTrigger`
  (`packages/flows/run-model.ts`) only ever reaches this field through an unchecked
  `manifest.trigger_kind as TriggerKindId` / `firing.on as TriggerKindId` cast — never a
  runtime check against `TRIGGER_KINDS` — and real manifests/firing events carry values
  (`'schedule'`) outside that shipped-kind union. Multiple in-repo test fixtures
  (`apps/studio/tests/unit/flow-ledger.test.ts`, `apps/studio/tests/integration/agent-ledger.test.ts`,
  `apps/studio/tests/contract/studio-client.test.ts`'s own `Required<Run>` field-parity pin)
  construct `trigger: { kind: 'schedule', … }` as real `Run` values today. Typing this field
  as `TriggerKindId` would make those constructions — which the wire genuinely produces —
  a compile error, which is the opposite of what a shared "wire-honest" type is for.

The alternative to all three — narrowing studio's parse/tests to match the server's naive
type instead — was rejected: it would either fabricate values the wire cannot promise
(`costUsd` defaulting to `0`) or reject real trigger data (`'schedule'`) the product already
handles correctly. The type that survives contact with the wire is the correct SSOT; the
narrower one was never proven, only unexercised.
