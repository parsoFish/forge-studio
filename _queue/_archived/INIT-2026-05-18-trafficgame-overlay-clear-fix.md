---
initiative_id: INIT-2026-05-18-trafficgame-overlay-clear-fix
project: trafficGame
project_repo_path: projects/trafficGame
created_at: '2026-05-18T12:26:53.324Z'
iteration_budget: 14
cost_budget_usd: 9
phase: pending
origin: architect
quality_gate_cmd:
  - npm
  - test
features:
  - feature_id: FEAT-1
    title: Route interaction re-renders through redraw()
    depends_on: []
  - feature_id: FEAT-2
    title: Fold SandboxSettingsPanel onto CanvasScreen
    depends_on:
      - FEAT-1
  - feature_id: FEAT-3
    title: Visual-regression lock for overlay stability
    depends_on:
      - FEAT-1
      - FEAT-2
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-18-trafficgame-overlay-clear-fix
---

# trafficGame — overlay cumulative-darkening fix

## Why
`CanvasScreen.redraw()` (src/ui/CanvasScreen.ts:98) correctly does
clearRect then draw(), but interaction handlers call `this.draw()`
directly, bypassing it, so each hover restacks a translucent fillRect and
the screen darkens to black. Confirmed bypass sites: GameMenu.ts:150,
CampaignHub.ts:157, LevelCompleteOverlay.ts:127, TitleScreen.ts:37.
SandboxSettingsPanel is a standalone class with the same bug (owner
decision: refactor it onto CanvasScreen).

## Constraints
Touch only src/ui/ and its tests. TypeScript strict, ~150 LOC/file, TDD.
Keep the intentional single-layer dim. Quality gate: `npm test` AND
`npm run test:visual`.

## Features — exactly these 3, do NOT add or invent any others

### FEAT-1 — route interaction re-renders through redraw()
Files in scope: src/ui/CanvasScreen.ts, src/ui/GameMenu.ts,
src/ui/CampaignHub.ts, src/ui/LevelCompleteOverlay.ts, src/ui/TitleScreen.ts.
Make the base class own the post-start re-render so a subclass cannot
bypass the clear; start()-on-blank stays a direct draw.
AC: GIVEN any overlay open and the game paused WHEN 10 hover-state
transitions occur THEN a Playwright screenshot at the 1st/5th/10th is
pixel-equivalent (toMatchSnapshot) to just-opened, AND `npm test`
asserts an interaction re-render clears before paint for every
CanvasScreen subclass.

### FEAT-2 — fold SandboxSettingsPanel onto CanvasScreen (depends FEAT-1)
Files in scope: src/ui/SandboxSettingsPanel.ts and its test.
Convert it to extend CanvasScreen (inherit ctx/handler wiring/drawButton);
preserve scoring toggle, vehicle-count slider drag, dismiss.
AC: GIVEN the sandbox panel open and paused WHEN 10 hover transitions
occur THEN screenshots are pixel-equivalent to just-opened (inherited
from FEAT-1) AND existing sandbox-panel behaviour tests pass.

### FEAT-3 — visual-regression lock (depends FEAT-1, FEAT-2)
Files in scope: the Playwright visual suite under tests/.
AC: GIVEN a baseline captured after FEAT-1+FEAT-2 WHEN the visual suite
runs GameMenu and LevelCompleteOverlay at just-opened / 1-hover /
5+-hover THEN the three states are pixel-equivalent AND a reintroduced
alpha-stack fails the suite.
