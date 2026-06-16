# Studio starters — the curated "out of the box" library

These are **templates**, not live agents or flows. They are the clean, minimal set a brand-new user
picks from when they create their first agents and flow in Studio:

- `agents/plan/SKILL.md` — a minimal **Plan** agent (read code + request → write a plan).
- `agents/dev/SKILL.md` — a minimal **Dev** agent (follow the plan → make the checks pass).
- `agents/review/SKILL.md` — a minimal **Review** agent (check the change → human verdict gate).
- `flows/basic.yaml` — the most basic flow: **plan → dev → review (+ verdict gate)**.

## Why a separate `studio/starters/` directory

The starters are deliberately **clean-room**. They carry none of the weight of forge's production
phase agents (`architect`, `project-manager`, `developer-ralph`, `developer-unifier`, `reflector`):
no brain access, no phase coupling, no composed forge skills — just a tiny self-contained process
body, a sensible default model, and the minimum tools each role needs.

They live here, not in `skills/` or `studio/flows/`, so that:

- `forge studio lint` (which scans `skills/` and `studio/flows/`) does **not** treat them as live
  objects — they are inert reference content until a user instantiates one.
- the curated set stays a small, browsable menu, separate from the live agent surface.

## How they become live objects

When a user creates an object in Studio from a starter, the starter's content pre-fills the builder
form; saving **instantiates** it into a live object:

- a starter agent → `skills/<slug>/SKILL.md` (via `PUT /api/studio/agents/:slug`)
- the basic flow → `studio/flows/<slug>/flow.yaml`

Validity is enforced by `orchestrator/studio/starters.test.ts` (every starter passes
`validateAgent` / `validateFlow`) and, once instantiated, by `forge studio lint`.

See ADR-033 for the design.
