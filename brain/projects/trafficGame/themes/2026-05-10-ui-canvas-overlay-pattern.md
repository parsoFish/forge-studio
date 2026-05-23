---
title: >-
  trafficGame — overlays on the shared paused canvas need a frame snapshot, not
  just clearRect
description: >-
  GameMenu and every CanvasScreen subclass share a single canvas with the game.
  Opening the menu calls game.stop() (rAF cancelled), so nothing repaints the
  game behind the overlay. A bare `fillRect` per re-render stacks dims
  (cumulative darken); a bare `clearRect` erases the paused game frame (overlay
  on blank). The landed fix (PR
category: pattern
keywords:
  - trafficgame
  - ui
  - canvas
  - overlay
  - fillrect
  - clearrect
  - hover
  - darken
  - gamemenu
  - levelcompleteoverlay
  - alpha-stacking
  - snapshot
  - getImageData
  - putImageData
  - paused-canvas
  - redraw
created_at: 2026-05-10T15:30:00.000Z
updated_at: 2026-05-20T00:00:00.000Z
related_themes:
  - episodic-not-cumulative-learnings
---

# trafficGame — overlays on the shared paused canvas

## The architecture (load-bearing)

There is **one** `<canvas id="canvas">` (`index.html`). Game renders to it
via `canvas.getContext('2d')`. Every `src/ui/` overlay (GameMenu,
CampaignHub, LevelCompleteOverlay, TitleScreen, SandboxSettingsPanel,
plus non-CanvasScreen helpers ConnectionFeedback, SimulationWarning,
LevelMetadataHeader, RunSimulationButton) draws on the **same canvas**.
Opening an overlay calls `currentGame.stop()` which cancels the rAF →
**nothing repaints the game** while the overlay is up. Whatever was
last rendered stays on the canvas.

This shared-paused-canvas property is the constraint every overlay fix
must respect, and it rules out the two naive approaches:

- **Naive 1 — `fillRect` without `clearRect` (the original bug).** Each
  re-render on hover stacks another translucent black layer on the
  canvas: 70% → 91% → 97% → visually black ("the cumulative-darken
  bug").
- **Naive 2 — route re-renders through `clearRect` then `draw()`.** Fixes
  the stacking, but `clearRect` erases the paused game frame and
  nothing repaints it → menu sits on blank/black. Different bug, looks
  equally broken.

## The landed fix (PR #56, commit `01630c7`)

`CanvasScreen` owns a frame backdrop:

```typescript
private backdrop: ImageData | null = null;

start(): void {
  this.canvas.addEventListener('click', this.clickHandler);
  this.canvas.addEventListener('mousemove', this.moveHandler);
  this.canvas.style.cursor = 'default';
  // Capture the frame underneath BEFORE the first dim is applied.
  try {
    this.backdrop = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
  } catch { this.backdrop = null; }
  this.draw();
}

protected redraw(): void {
  this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  if (this.backdrop) {
    try { this.ctx.putImageData(this.backdrop, 0, 0); } catch { /* dims changed */ }
  }
  this.draw();
}
```

Every CanvasScreen subclass routes interaction re-renders through
`this.redraw()` (`GameMenu.onMouseMove:150`, `CampaignHub:157`,
`LevelCompleteOverlay:127`, `TitleScreen:37`, `SandboxSettingsPanel`).
SandboxSettingsPanel was refactored to extend CanvasScreen in this PR
so the fix applies uniformly.

## Why a bare `clearRect+draw` is insufficient (recorded so the next attempt doesn't regress)

- Single canvas + paused game loop ⇒ `clearRect` erases the last game
  frame for good. The snapshot is what makes the dim stable AND keeps
  the dimmed game visible.
- Degrades gracefully: if `getImageData` throws (tainted canvas),
  `backdrop` stays null and `redraw` falls back to plain `clearRect+draw`
  — still no stacking, just no preserved frame.

## Verification

- Unit (jsdom): `tests/ui/CanvasScreen.test.ts` covers the snapshot contract —
  start() captures via getImageData once; redraw() restores the same
  ImageData N times (no stacking); graceful fallback when getImageData
  throws.
- Empirical (real browser, Playwright + measured pixels): on the
  Crossroads map, opening the menu drops canvas luminance 43.9 → 17.4
  (the single dim applied); 12 hover cycles hold luminance at 17.43
  **exactly** (net 0 darkening). Screenshot shows the panel with the
  game map visibly dimmed behind it.

## Reusable lesson (forge-level)

The whole detour — three iterations of "stops stacking but introduces a
worse regression" — came from code-only analysis without empirical
verification. The unit tests (jsdom) passed for the broken-but-doesn't-
stack version because jsdom's `getImageData` throws → graceful-degrade
hides the regression. Real-browser luminance measurement is the only
honest test for "does this overlay still show the dimmed game?".

## Sources

- [`src/ui/CanvasScreen.ts`](../../../../projects/trafficGame/src/ui/CanvasScreen.ts) — backdrop snapshot/restore (lines 29–47, 100–145).
- [`src/ui/GameMenu.ts`](../../../../projects/trafficGame/src/ui/GameMenu.ts) — `onMouseMove:150 → this.redraw()`.
- [`src/Game.ts`](../../../../projects/trafficGame/src/Game.ts) — `Game.stop()` cancels rAF; does NOT clear canvas.
- [`src/main.ts`](../../../../projects/trafficGame/src/main.ts) — `showGameMenu()` stop→new GameMenu(same canvas)→start.
- PR #56 (merged 2026-05-19, main `59d1713`), commit `01630c7`.

## See also

- [[episodic-not-cumulative-learnings]] — episodic-not-cumulative learnings antipattern.
