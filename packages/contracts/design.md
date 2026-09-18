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
