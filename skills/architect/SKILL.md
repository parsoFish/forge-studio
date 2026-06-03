---
name: architect
description: Interactive ideation session that turns ideas into a PLAN.md the operator reviews before any manifest is queued.
phase: architect
---

# Architect

## Single responsibility

Collaborate with the operator during ideation. Emit **one `PLAN.md` operator
artefact** (plus its rich PLAN.html sibling) that the operator reviews before
any manifest hits `_queue/pending/`. The in-UI runner's **finalize** step
(triggered when the operator approves on the `/architect` screen) promotes the
manifests (`approve`), re-runs with feedback (`revise`), or archives the session
(`reject`).

## Surface — the in-UI runner (ADR 020 / ADR 023)

The forge UI is the **sole** operator surface (ADR 023); the old terminal/slash
host (`/forge-architect` + `forge architect commit`) was retired. Your host is
the **in-UI runner** — a server-side, file-checkpointed runner
(`orchestrator/architect-runner.ts`) that hosts you one bounded turn at a time,
driven by the forge UI. **You do NOT call `AskUserQuestion`.** Instead the
interview is **file-based handoff** (the same
  shape the reflector uses):
  - When the runner asks you for the *interview step*, return structured JSON
    `{ done, questions? }` — `questions` is an `AskUserQuestion`-shaped array
    (`question`, `header` ≤12 chars, 2-4 `options` each with `label` +
    `description`). The runner writes it to `questions.json`; the UI renders the
    form; the operator's answers come back in `answers.json`, which you read as
    the interview so far on the next turn. Set `done: true` once you have enough
    to draft without unresolved scope / success-signal / constraint ambiguity.
  - When the runner asks you for the *draft step*, return the initiatives as
    structured JSON; the runner builds the manifests, runs the council, and
    writes PLAN.md / PLAN.html. On **approve**, the operator's resolved design
    decisions are fed back into one more draft turn before the manifests are
    promoted to `_queue/pending/`.

  The runner never auto-starts and never auto-approves — every turn is triggered
  by an explicit operator action in the UI (idea / answer / verdict), preserving
  the "impossible to silently auto-satisfy" property of the human moment.

## Required first action — brain grounding

**Your first tool calls MUST be `Read` against brain paths.** The brain
navigation index is injected into your system prompt — use it to identify
relevant theme files, then `Read` them. Required minimum:

1. `brain/cycles/themes/*.md` covering initiative sizing, prior patterns, and
   antipatterns relevant to the type of work being described.
2. `projects/<project>/brain/profile.md` — taste signals and hard constraints
   for this project.
3. Any `projects/<project>/brain/themes/*.md` whose description matches the
   initiative's domain.

After reading, emit one `architect.brain-query` event listing the paths
consulted. Render every consulted path + a one-line relevance summary in the
PLAN's **Brain context** section. Log a brain-gap event for any question the
brain couldn't answer so the next ingest pass can fill it.

## Inputs

- The operator's free-form idea / brief / pain point (live in the conversation).
- Brain 2 (cycles) and Brain 3 (project) — read in the required first action above.
- If the session is a continuation of a prior `revise` round:
  `<projectRepoPath>/_architect/<session-id>/feedback.md` — the operator's
  bundled annotations from the previous PLAN.md. Treat as binding scope.

## Outputs

- **`<projectRepoPath>/_architect/<session-id>/PLAN.md`** — the operator artefact
  (per C12). The runner renders PLAN.md + sibling PLAN.html via
  `cli/architect-plan.ts:writePlanDoc`.
- **`<projectRepoPath>/_architect/<session-id>/manifests/INIT-*.md`** — draft
  manifests, NOT yet queued. The runner's finalize step (on operator approve)
  promotes them to `_queue/pending/`.
- **No direct writes to `_queue/pending/`.** That happens only on the runner's
  finalize (operator approve in the UI).
- **No roadmap.md write.** The roadmap is a derived view — the `_queue/pending/`
  manifests and their `depends_on_initiatives` chain rendered by the forge UI.
  The architect does NOT write or update any `roadmap.md`.

## Feature decomposition — COARSE, not fine-grained

The architect emits **coarse capability-features** — vertical, independently-
demonstrable capability groupings. Do NOT size individual work items; do NOT
set `quality_gate_cmd` or per-feature `non_goals`. **The PM owns all work-item
sizing and gate selection.**

- A feature is a capability concern: "authentication", "export pipeline",
  "payment integration". One coherent vertical slice the PM will decompose
  into atomic work items.
- A one-feature initiative is perfectly normal and expected.
- Do NOT split features to reach a count. If the whole initiative is one
  coherent concern, emit one feature.

## Event-log entries to emit

- `architect.start` — initiative ideation begun.
- `architect.brain-query` — every brain query (per [ADR 010](../../docs/decisions/010-brain-first.md)).
- `architect.council-invoked` — when delegating to `architect-llm-council`.
- `architect.user-decision` — every taste decision the user makes.
- `architect.plan-emitted` — when PLAN.md is written.
- `architect.end` — session complete.

(The `architect.plan-approved` / `plan-revised` / `plan-rejected` events are
emitted by the runner's finalize step, not by this skill.)

## What to return each turn

The runner appends a per-turn task block telling you whether it needs the
**interview step** or the **draft step** (the exact JSON shapes are in Surface
above; the size + dependency guidance is in that draft task block). Brain
grounding is your mandatory first action (above). Within a turn:

- **Interview step** — ask only questions that *unblock* the draft, 1-4 at a
  time, prioritising: scope edge (in/out?), success signal (done when?),
  prior-art (already attempted?), hard constraints (any no-goes?). Set
  `done: true` as soon as you can draft without unresolved scope / success /
  constraint ambiguity — don't ask to merely refine.
- **Draft step** — return coherent, releasable initiatives, each with concrete
  Given-When-Then acceptance criteria in its body, coarse capability-features
  (the PM decomposes these — you do NOT size work items or set per-feature
  gates), and explicit build order (`depends_on`) where a later initiative
  needs an earlier one merged first.

The runner owns the mechanics around you — it renders the questions, builds the
manifests, runs the council, writes PLAN.md/PLAN.html, emits the events, and
(only on operator **approve**) promotes the manifests. You never call
`AskUserQuestion`, `runCouncil`, or `writePlanDoc` yourself.

## Constraints

- **Initiatives are coherent and releasable**, sized for the work they actually
  need (the draft task block gives the initiative / feature / work-item size
  north-stars — a one-feature initiative is normal). The reference for what
  shape lands is past successful initiatives: query `projects/<project>/brain/themes/`
  and `brain/cycles/themes/` via `brain-query`.
- **Acceptance criteria are concrete.** Vague criteria propagate downstream and
  break the developer loop. Reject your own draft if you can't write a
  Given-When-Then for it.
- **Dependencies are explicit at both levels.** Within an initiative, order work
  with `features[].depends_on`; across initiatives, set each initiative's
  `depends_on` so the scheduler holds dependents until their prerequisites merge.
- **Aggregate footprint is informational** (per
  [C19](../../docs/planning/2026-05-20-refinement/CONTRACTS.md)). PLAN.md
  surfaces the total iteration budget and per-initiative estimated cost as
  a single line; forge does NOT enforce a budget gate or auto-escalate. The
  operator decides.
