# Prompt: cut the end-state mockup into a modular backlog

Copy everything below the line into a fresh Claude Code session in
`~/forge`. It is a PLANNING session — no product code changes.

---

Cut the Studio end-state mockup into a modular backlog of initiatives in
`docs/roadmaps/` (the planning SSOT). This is a planning-only session: you
may write/amend roadmap docs and nothing else.

## Skills / process to invoke

1. `brain-query --scope forge-dev` FIRST (planner rule — mandatory): pull
   conventions on initiative sizing, roadmap format, and any prior
   UI-modularity lessons before cutting anything.
2. `superpowers:brainstorming` before drafting the cut — the decision
   points below are genuine forks; surface them to me via AskUserQuestion
   in ONE round before writing.
3. `superpowers:writing-plans` discipline for the roadmap docs themselves.
4. Do NOT invoke journey-sync / builders — no forge-ui changes this session.

## Inputs (read in this order)

1. `mockups/studio-endstate-v2/README.md` — what the mockup asserts, round
   by round (rounds 2–6 are the feature registry).
2. `mockups/studio-endstate-v2/as-built-inventory.md` — the as-built
   surface inventory (2026-08-03) the mockup must be diffed against.
3. `docs/roadmaps/` register + `R2-runnable-componentry.md`,
   `R3-library-componentry.md`, `R4-ootb-suite.md`,
   `R6-operator-experience.md` — most cuts AMEND these, don't duplicate.
4. The mockup itself, live: `python3 -m http.server 4311 --directory
   mockups` → `http://localhost:4311/studio-endstate-v2/index.html`
   (+ `?journey=<id>` replays; 27 ids in `journeys-data.jsx`).

## The mission (operator intent, verbatim spirit)

The mockups are the north star for making forge MODULAR: after this cut I
want to iterate on ONE surface at a time — "a feature for the skills
library", "the agent builder", "one agent", "one flow" — instead of
holistic features that touch components across the board. Every initiative
must therefore be scoped to exactly one module boundary.

## Module boundaries (one initiative never spans two)

home-dashboard · flows-home/monitor · flow-builder · flow-run-detail ·
agents-home/monitor · agent-builder · agent-kickoff+run · sessions-surface ·
projects-list/detail · project-roadmap-tab · demo-showcase · library-skills ·
library-hooks · library-connections · library-templates · community-browser ·
kb-explore · kb-create/maintain · triggers-runtime · per-OOTB-agent (one
each) · per-OOTB-flow (one each).

## Cutting rules

- Initiative = a LARGE-but-single-module bundle: the feature + its tests +
  its journey update in one (never a tests-only split). Follow the register
  format: F-items, acceptance signals, ⚑ operator-gates, `depends:` edges.
- Prefer AMENDING the owning roadmap (R2/R3/R4/R6/R7) over new files; a new
  file only if a module has no home (e.g. community-browser).
- Every initiative names its mockup evidence (journey id + surface) as the
  acceptance reference, and its as-built baseline from the inventory.
- Mark ALREADY-ALIGNED items as as-built baseline entries, not initiatives
  (e.g. develop topology, hex canvas + ArtifactPicker edges, 4-kind
  triggers, KB force-graph, skills builder, architect interview).
- Output: amended/created roadmap files + a short cut-summary table
  (initiative · module · roadmap home · size guess · depends) + a
  recommended execution order that starts with the smallest
  modularity-proving slice.

## Decision points — ask me BEFORE cutting (one AskUserQuestion round)

1. **Hooks vocabulary**: catalog "hooks" today are forge-infra
   (cost-guard, merge-gate…); the mockup recasts hooks as agent-lifecycle
   customisations (PreToolUse/SessionEnd…) with generic binding from the
   Agent Builder. Adopt the mockup vocabulary for R3-03 (renaming/splitting
   the infra list), or keep two distinct concepts?
2. **Parallel branches**: R2-D1 (parallel-WORK merge-resolution) is a
   NO-GO. The mockup's branching is plan-band read-only parallelism
   (demo-design ∥ research → join at developer) — no code merge involved.
   Re-open as a scoped R2 initiative, or park?
3. **KB ingest button**: the mockup exposes "Kick off ingestion" as a
   manual KB op; as-built deliberately restricts ingest to reflection.
   Adopt the button or keep the policy (and drop it from the mockup)?
4. **Roadmap viz**: SerpentineTimeline (as-built) vs dependency-DAG
   columns (mockup) — converge on which, or DAG-as-second-view?
5. **Trigger scoping**: mockup adds per-project trigger scoping + two new
   trigger framings (on-agent-complete, project hooks like PR-closed).
   Fold into R2-04's successor as one triggers-runtime initiative?

## Known mockup-ahead deltas to seed the cut (from the diff)

Library: hooks/connections/templates managed libraries + detail pages +
security scan + community browser/install (R3). Runs: kickoff screens
(ceiling, materials), line-level node logs, typed outputs (R6
run-observability). Projects: roadmap full-page tab, completed-run
dig-in, contract/north-star panel placement, demo showcase page (R4-11).
Home dashboard + attention strip (R6). Agents: instructions field parity,
materials config, run consolidation (R2/R4). Per-agent/flow run journeys
= acceptance material for the OOTB R4 initiatives.
