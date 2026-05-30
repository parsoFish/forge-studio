---
initiative_id: INIT-2026-05-10-world-graph-ux
project: trafficGame
project_repo_path: projects/trafficGame
created_at: '2026-05-10T16:30:00.000Z'
iteration_budget: 5
cost_budget_usd: 4
phase: pending
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-10-world-graph-ux
quality_gate_cmd:
  - npm
  - test
depends_on_initiatives:
  - INIT-2026-05-10-trafficgame-simplification-arch
  - INIT-2026-05-10-world-graph-foundation
features:
  - feature_id: FEAT-1
    title: 'CampaignHub graph view — nodes, edges, flow indicators'
    depends_on: []
  - feature_id: FEAT-2
    title: Graph-traversal unlock logic (replaces array-index unlocks)
    depends_on:
      - FEAT-1
  - feature_id: FEAT-3
    title: Live demonstrator edge crossroads to straight-highway + visual proof
    depends_on:
      - FEAT-2
---

# World-graph UX — campaign hub renders map-of-maps with non-linear unlocks

## Context

`INIT-2026-05-10-world-graph-foundation` lands the headless data model, simulator, and `WorldScore` aggregator needed for cross-map flow. This initiative surfaces it: the campaign hub renders the map-of-maps; non-linear unlocks traverse the graph; and the demonstrator pair (`crossroads → straight-highway`) is wired into the live campaign as the first real `WorldEdge`. All work touches canvas; Playwright is the primary correctness gate.

**Initiative dependency:** the manifest schema only expresses feature-level deps; this initiative's dependency on the foundation initiative is recorded in `projects/trafficGame/roadmap.md`. Do not start this initiative until the foundation initiative is merged.

## Decomposition rationale

Three features in dependency order:

1. **FEAT-1 (UI surface):** the campaign hub renders graph nodes and edges with flow indicators. Visual gate.
2. **FEAT-2 (game logic):** unlock resolution traverses the graph; legacy linear behaviour preserved when no edges exist. Vitest + visual.
3. **FEAT-3 (live demonstrator):** the actual `crossroads → straight-highway` edge ships in `CampaignLevels.ts`, validated end-to-end via Playwright.

## Features

### FEAT-1 — `CampaignHub` graph view (nodes, edges, flow indicators)

**Acceptance criteria (Given-When-Then):**

- **Given** a `CampaignGraph` with the demonstrator edge loaded into the campaign hub, **when** the hub renders, **then** each level appears as a node positioned per a deterministic layout (e.g. topological / fixed coordinates per level), and each `WorldEdge` is drawn as an arrow from the source level's exit edge to the destination's entry edge, with line thickness or colour proportional to the current measured throughput in `WorldScore`.
- **Given** the player hovers a node, **when** the hover registers, **then** a tooltip surfaces the level's current `UnifiedScore` (from the live `WorldScore` snapshot) and the incoming/outgoing flow rates from the world simulator. The tooltip uses the new `CanvasScreen` clear-before-draw lifecycle (see INIT-2026-05-10-canvas-overlay-clear) — no cumulative-darken regression.
- **Given** Playwright `test:visual`, **when** the campaign hub is rendered with the demonstrator graph and a known reference solution, **then** the screenshot diff against the checked-in reference is within tolerance. Coverage includes: hub-without-hover, hub-with-node-hovered, hub-with-edge-hovered.
- **Given** today's flat 9-level layout (no edges), **when** rendered post-FEAT-1, **then** the hub still renders all 9 levels and remains visually equivalent to today's hub within tolerance — no regression on the existing campaign visuals.

**Files in scope (informational):** `src/ui/CampaignHub.ts`, possibly a new `src/ui/WorldEdgeRenderer.ts`, Playwright specs.

### FEAT-2 — Graph-traversal unlock logic

**Acceptance criteria (Given-When-Then):**

- **Given** a `CampaignGraph` and a player-state of completed levels, **when** the unlock resolver runs, **then** a level has `isUnlocked === true` iff: (a) it has zero incoming `WorldEdge`s (a source), OR (b) every level that points at it via a `WorldEdge` has been completed at the campaign's `targetGrade` for that level.
- **Given** the existing 9 levels with no `WorldEdge` between them yet, **when** unlock resolution runs, **then** the linear progression behaves identically to today's array-index logic — `lvl-01` is pre-unlocked, `lvl-02` unlocks when `lvl-01` meets `targetGrade`, etc. Existing campaign-progression Vitest tests pass unmodified.
- **Given** a Vitest test with a synthetic graph including a branch (one source unlocking two parallel maps), **when** the source meets `targetGrade`, **then** both parallel maps unlock; their unlock states are independent of each other.
- **Given** a graph with a multi-incoming-edge convergence (two source maps both pointing at a third), **when** only one source has been completed, **then** the convergent map is **not** unlocked (all-incoming-completed semantics).

**Files in scope (informational):** `src/campaign/CampaignProgress.ts` (or wherever unlock logic lives today), Vitest specs.

### FEAT-3 — Live demonstrator edge `crossroads → straight-highway` + Playwright visual gate

**Acceptance criteria (Given-When-Then):**

- **Given** the live `CampaignLevels` data post-FEAT-3, **when** loaded, **then** there is exactly one `WorldEdge` whose source is `lvl-03-crossroads`'s designated exit `TrafficLocation` and whose destination is `lvl-01-straight-highway`'s opposing-edge entry `TrafficLocation`. Edge orientation is consistent with the existing `TrafficLocation` `edge` field semantics — i.e. a `right`-edge exit on `crossroads` connects to a `left`-edge entry on `straight-highway` (or whichever pairing the architect-side spec stipulates; PM phase chooses concrete `TrafficLocation` IDs).
- **Given** the player has completed `lvl-03-crossroads` with the campaign's `targetGrade` (B), **when** they re-enter `lvl-01-straight-highway`, **then** the entry flow rate at the linked entry equals the measured exit throughput from the player's stored `crossroads` solution, and the in-level HUD displays the linked entry's actual flow rate (not the default `0.5 v/s`).
- **Given** the player has not yet completed `crossroads` at `targetGrade`, **when** they enter `lvl-01-straight-highway`, **then** the entry flow rate falls back to the default `FlowConfig` value (no broken state pre-completion).
- **Given** Playwright `test:visual` runs on the campaign hub with the demonstrator solution loaded, **when** screenshots are compared against the checked-in reference, **then** the diff is within tolerance and the rendered edge thickness reflects throughput.
- **Given** the existing per-level Playwright `test:visual` suite for the 9 levels, **when** run post-FEAT-3, **then** all per-level snapshots are unchanged within tolerance — wiring the demonstrator must not visually regress unrelated levels.

**Files in scope (informational):** `src/campaign/CampaignLevels.ts` (data extension), `src/campaign/CampaignTypes.ts` (if needed), Playwright specs.

## Quality gate

`sh -c "npm test && npm run test:visual"` — visual gate is mandatory; this initiative is canvas-and-progression heavy.

## Out of scope

- Any new map definitions beyond the demonstrator edge — reuse `crossroads` and `straight-highway` exactly as they are today.
- World-level star thresholds (`WorldScore` letter grade is computed but the campaign does not yet require players to hit a world-level grade for any unlock — that's a future initiative).
- Auto-layout for arbitrary graphs — the hub's layout can be hand-tuned for the current 9-level set; an automated layout algorithm is overkill for this scope.
- Cross-map back-pressure (downstream congestion influencing upstream sim). The world simulator only propagates *forward* (exit throughput → entry flow). Backward-coupled world flow is a future initiative.
