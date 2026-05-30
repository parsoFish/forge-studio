---
initiative_id: INIT-2026-05-10-trafficgame-simplification-arch
project: trafficGame
project_repo_path: projects/trafficGame
created_at: '2026-05-10T18:00:00.000Z'
iteration_budget: 10
cost_budget_usd: 15
phase: pending
quality_gate_cmd:
  - npm
  - test
depends_on_initiatives:
  - INIT-2026-05-10-trafficgame-simplification-source
features:
  - feature_id: FEAT-1
    title: >-
      CanvasScreen base-class lifecycle (subsumes the canvas-overlay-clear
      initiative)
    depends_on: []
  - feature_id: FEAT-2
    title: GameRenderState audit + split (32 fields → coherent shape)
    depends_on: []
  - feature_id: FEAT-3
    title: Delete SimulationTimeScale deprecated methods
    depends_on: []
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-10-trafficgame-simplification-arch
---

# Phase 3 — Architectural cleanups

## Context

Final phase of the simplification, per [`projects/trafficGame/docs/SIMPLIFICATION_PLAN.md`](../../projects/trafficGame/docs/SIMPLIFICATION_PLAN.md). Three small, mostly independent items that close the architectural gaps surfaced during the canvas-overlay debug session.

After this lands, the existing pending feature initiatives (`intersection-backpressure`, `world-graph-foundation`, `world-graph-ux`) execute against a clean codebase — and the original `canvas-overlay-clear` initiative becomes redundant (FEAT-1 here is the same work, scoped properly).

**Important precedent:** the originally-queued `INIT-2026-05-10-canvas-overlay-clear` initiative is **subsumed by FEAT-1 of this initiative**. The roadmap reflects this; the architect (next pass) should remove `INIT-2026-05-10-canvas-overlay-clear` from `_queue/pending/` after this initiative completes — or delete it now, with a note in the roadmap.

## Features

### FEAT-1 — `CanvasScreen` base-class lifecycle (cumulative-darken bug fix)

**Acceptance criteria (Given-When-Then):**

- **Given** the `CanvasScreen` base class at `src/ui/CanvasScreen.ts`, **when** FEAT-1 is complete, **then** it exposes a redraw lifecycle that calls `ctx.clearRect(0, 0, canvas.width, canvas.height)` exactly once before the subclass's `draw()` body executes on every redraw entry-point.
- **Given** every existing `CanvasScreen` subclass under `src/ui/`, **when** audited, **then** every subclass that previously painted a translucent dim layer (`rgba(...,a)` + `fillRect` of full-canvas extent) routes its redraw through the new lifecycle. At minimum: `GameMenu`, `LevelCompleteOverlay`. Any other subclass found to use the dim-layer pattern is migrated.
- **Given** the in-game menu is open with the underlying frame loop paused, **when** the player hovers each menu button in sequence (≥5 hover events), **then** a Playwright spec under `tests/visual/` (added in Phase 1) shows the canvas opacity at the 5th hover is within tolerance of the 1st hover (no cumulative darkening).
- **Given** the level-complete overlay is shown and any of its interactive elements is hovered 3+ times, **when** the visual spec runs, **then** the overlay's apparent dim-layer opacity does not increase between the 1st and Nth hover.
- **Given** the closed menu and overlay with the underlying game frame redrawing normally, **when** verified, **then** there is no visible regression in the steady-state menu rendering.

**Files in scope:** `src/ui/CanvasScreen.ts`, every subclass that paints a dim layer (likely `GameMenu.ts`, `LevelCompleteOverlay.ts`), new Playwright spec under `tests/visual/`.

### FEAT-2 — `GameRenderState` audit + split

**Acceptance criteria (Given-When-Then):**

- **Given** the current `GameRenderState` interface (32 fields), **when** audited, **then** the audit produces a 1-paragraph rationale identifying which fields are: (a) genuine state owned by the render loop, (b) computed-on-demand and shouldn't be stored, (c) belong to a different concern (UI, simulation, scoring) and should move to a new state object.
- **Given** the audit's recommendation, **when** acted on, **then** the resulting state shapes total fewer than 32 fields across all of them, and `GameRenderState` (or its successor) has ≤ 15 fields.
- **Given** the existing render loop, **when** post-split, **then** all rendered output is unchanged (Phase 1 visual specs pass without snapshot updates).
- **Given** any consumer of `GameRenderState`, **when** post-split, **then** consumers either reference the new shape directly or use a compatibility alias that is removed in the same PR (no permanent compatibility shim).

**Files in scope:** wherever `GameRenderState` is defined (likely `src/game/GameRenderer.ts` or a sibling), all consumers.

### FEAT-3 — Delete `SimulationTimeScale` deprecated methods

**Acceptance criteria (Given-When-Then):**

- **Given** `SimulationTimeScale` (likely under `src/traffic/` or `src/scoring/`), **when** inspected, **then** the deprecated methods (kept previously because tests used them) are identified.
- **Given** the rewritten test suite from Phase 1, **when** searched, **then** no test references the deprecated methods.
- **Given** the deprecated methods, **when** deleted, **then** `npm run build` and `npm test` both pass.
- **Given** the post-deletion `SimulationTimeScale` file, **when** counted, **then** it is at least 30% smaller than before.

**Files in scope:** wherever `SimulationTimeScale` is defined, plus any of its callers that need updating.

## Out of scope

- Adding new render concerns or rendering features. The split is structural, not feature-bearing.
- Re-deriving the render pipeline from scratch (e.g., introducing a layer compositor, ECS, or scene graph). Brain's "don't introduce parallel modules" rule.
- Changes to `SimulationTimeScale`'s active (non-deprecated) API.

## Reviewer focus

1. **FEAT-1 specifically**: confirm the bug actually doesn't reproduce — open a menu, hover ≥5 times, watch screen. Brain documented this as the canonical test.
2. **FEAT-2**: read the audit rationale before reviewing the diff. The split should match the rationale.
3. **FEAT-3**: confirm no tests broke (deprecation removal should be a non-event).

## Successor initiatives unblocked

- `INIT-2026-05-10-intersection-backpressure` — runs against the post-extraction `CarFollowing.ts`.
- `INIT-2026-05-10-world-graph-foundation` — clean campaign / scoring / state model after Phase 2 + 3.
- `INIT-2026-05-10-world-graph-ux` — clean `CanvasScreen` family after FEAT-1.
