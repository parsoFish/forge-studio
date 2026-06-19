# ADR 033 — Studio first-flow UX: UI-first creation, in-UI onboarding, curated starters

**Status:** accepted (2026-06-16)

**Relates to:** ADR-027 (studio object model), ADR-028 (flow engine), ADR-031
(Studio is the product). Realises the install-to-first-flow north star;
campaign plan in [`../reference/studio-first-flow-ux.md`](../reference/studio-first-flow-ux.md).

## Context

Studio's machinery exists (defs-as-data object model, flow-builder canvas,
agent/project builders, the architect→plan→run→verdict→reflect path, and a
Playwright DOM-as-metrics validation substrate), but the **happy path for a
brand-new user is broken**:

- The library "+ New Project / Agent / Flow / KB" actions are disabled
  (`forge-ui/app/page.tsx`); creation only happens via hand-typed URLs or CLI.
- Project onboarding is CLI-only (`forge-onboard-project` skill).
- Builder forms expose low-level config up front (RuntimePicker cost/SDK/strategy,
  raw Given/When/Then ACs, open-catalog skill search) — the opposite of "show
  only what's required."
- There is no first-run orientation: a fresh install drops the user on an empty
  library with greyed-out buttons and no next step.

The north star is that a new user can: **install → build a plan/dev/review
flow → onboard a project → give the flow work**, with minimal exposed config and
provable results at each step.

## Decision

1. **Creation is UI-first.** Every Studio object (agent, flow, project, KB) is
   creatable from a visible on-screen control on the library, routed through the
   empty state. No object's *only* creation path is a hand-typed URL or a CLI
   skill. (The CLI/skill paths remain for automation and recovery.)

2. **Project onboarding moves into the UI.** A guided "New Project" flow registers
   a project by writing its `.forge/project.json` (the project is then
   auto-discovered from disk — there is no registry file) and must satisfy the
   same invariants the `forge-onboard-project` skill enforces
   (`docs/forge-project-contract.md`). The validation is **reused, not forked** —
   advanced contract clauses (C7 live-tier, standing ACs, ci-gate) live behind
   "Advanced".

3. **A curated, clean-room starter library** ships under `studio/starters/`:
   minimal `plan`, `dev`, `review` agents and a `basic` (plan → dev → review +
   verdict gate) flow. Starters are **templates**, not live objects — they carry
   none of the weight of forge's production phase agents (no brain access, no
   phase coupling, no composed forge skills). `forge studio lint` does not scan
   `studio/starters/`; their integrity gate is `orchestrator/studio/starters.test.ts`.
   Creating an object from a starter pre-fills the builder and **instantiates** a
   live object (`skills/<slug>/SKILL.md`, `studio/flows/<slug>/flow.yaml`).

4. **Progressive disclosure is the Studio form standard.** A field is *required*
   only if the object cannot function without it; everything else ships a working
   default behind a single, labelled "Advanced" group (max two levels). Object
   creation defaults over choices — a valid object is creatable with near-zero input.

5. **No dead ends.** Prefer enabling the primary action and validating on submit
   over a silently disabled button; if a control must be disabled, it states why.
   Every empty/error/no-results surface offers a concrete next step.

These standards are grounded in the first-run UX research digest captured in the
spec (NN/g empty states + progressive disclosure, Smashing disabled-vs-enabled,
activation/TTFV benchmarks).

## Validation

Each user journey is proven by a fast, repeatable **seeded** Playwright walkthrough
extending `scripts/e2e-journey.mjs` (soft `check()` + DOM-as-metrics) plus
`forge studio lint`. A single operator-gated **real-money capstone**
(`verify:cycle`, betterado live tier) proves real capability. The campaign closes
when a dead-path crawler comes up empty twice running and the full journey passes
end to end.

## Consequences

- The library becomes the home of creation; `app/page.tsx` CTAs are wired to real
  flows (J2–J4), not greyed placeholders.
- `FlowNode` gains optional persisted positions (ADR-027 amendment, J3) so authored
  layouts survive a reload.
- Starters add a new content directory but no new live-object scanning surface;
  the lint contract is unchanged.
- Advanced config remains fully accessible — it is collapsed, not removed; v2's
  power users lose nothing.
