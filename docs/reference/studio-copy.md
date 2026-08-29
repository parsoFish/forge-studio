# Studio copy — the facts extracted from `mockups/`

Reference. This page is the surviving home of every fact that forge-ui and the
scripts still took from the `mockups/` tree before it was deleted. It exists so
that deleting a 94 MB directory of design prototypes does not lose a live
reference: each entry names the constant or behaviour, its value, and the mockup
decision that justified it.

The mockups themselves were seven rounds of end-state design work (2026-08-03).
Their conclusions landed in the roadmaps and in the code below; the prototypes
were never shipped and are not a current-state description of Studio.

## `forge-ui/lib/home-view.ts` — status is derived, never declared

The Home mockup (`studio-endstate-v2/views-home.jsx` + `data.jsx`) invented
`flow.status`, `agent.status` and `kb.status` fields. **Those fields do not exist
on the real wire types** — none of `Flow`, `Agent`, `Project` or `Kb` carries a
`status`. A mockup can draw a field into existence; a product cannot.

`home-view.ts` is therefore a pure derivation module: live status on Home is
derived from the run-model (`Run[]`) and the attention aggregate
(`ProjectAttentionItem[]`), never read off a fabricated field.

This is the record of the `declared-data-fails-open` antipattern — a field that is
parsed and surfaced but enforced nowhere. It was the recurring top finding across
the wave-4 and wave-8 campaigns. The cure that holds is structural: **derive the
value from its source of truth and give the object no field to store a stale copy
in.** The mockup is the illustration of the disease; this module is the cure.

## `forge-ui/lib/home-view.ts` — the active-sessions strip budget

`HOME_SESSIONS_STRIP_LIMIT = 4`.

From `session-surface-v1/sessions-index.html`, the "Home active-sessions strip"
variant, mockup decision point №11: a **four-card budget, needs-you first,
overflow to `/sessions`**.

The ordering half of that decision is not enforced here — the bridge's aggregate
sessions-index route already returns rows needs-you-first-then-newest
(`sortAndCapSessionIndexRows`), so the derivation takes a straight slice and never
re-sorts.

## `forge-ui/lib/roadmap-dag-layout.ts` — dependency-depth columns

Two facts.

**The walk.** The mockup (`studio-endstate-v2/views-projects.jsx:282`) laid the
roadmap out by walking a single `dep` per initiative. The shipped layout
generalises that to `string[]` parents: an initiative's column is one past its
deepest in-set parent — `column = max(parent column) + 1` over all of
`dependsOnInitiatives`, with roots at column 0. That is the longest-path-from-a-root
depth, not a hop count along one chain. It is also hardened beyond the mockup: the
walk is memoised and cycle-guarded, so a dependency cycle terminates instead of
hanging.

**The cap.** `MAX_COLUMN = 12`, mirroring the mockup's own DAG cap from the round-6
and round-7 layout notes. Every column is clamped to it, so neither a pathological
deep chain nor a cycle can explode the column count.

## `forge-ui/lib/roadmap-time-layout.ts` — the roadmap canvas visual

`roadmap-uplift/b-prime.html` was the operator-locked visual for the roadmap
canvas — the "B-prime" variant chosen from the round-6 alternatives. The
time-ordered layout in this module implements it.

## Story parity is retired

`scripts/journeys/story-registry.mjs` held 27 dispositions, one per scripted story
in `studio-endstate-v2/journeys-data.jsx`, and `scripts/story-parity.mjs` derived a
parity report by parsing that mockup at test time.

That guard is retired. The nine operator stories plus the smoke story
([`docs/roadmaps/1.0.md`](../roadmaps/1.0.md) §3) replace it: a story is the
operator flow the mockup was a picture of, and unlike the mockup it executes —
serving as end-to-end test, demo clip and usage documentation from one script.
Parity against a drawing is no longer a thing forge measures.
