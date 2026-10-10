# UI height and density constraints

The bounds every Studio surface and every generated docs page is designed
inside (D-46). A design that breaks one changes this page first, with the
operator's approval.

**Viewport** means the story viewport, 1600×1000, for Studio, and 1280×1000
for the docs site. Heights are measured at the story's own data: the page a
story run captures.

## 1. Surface types and height budgets

| type | examples | budget |
|---|---|---|
| fixed shell | flow builder, Knowledge | exactly 1 viewport; panes scroll inside, the page never does |
| scrolling page | Home, Monitor, agent, project, session | ≤ 3 viewports; viewport 1 holds identity, status and the primary action |
| gate | verdict, plan gate, reflection | the decision control inside viewport 1 (a sticky gate bar counts); whole page ≤ 2 viewports |
| generated how-to | story pages | ≤ 8 viewports |

## 2. Density tokens

Studio uses these tokens from `apps/studio/app/globals.css`, never a bare
number:

| scale | tokens |
|---|---|
| space | `--space-1`…`--space-6` = 4 · 8 · 12 · 16 · 24 · 32 px |
| text | `--text-xs`…`--text-xl` = 11 · 12 · 13 · 14 · 17 · 22 px (14 is body; 17 and 22 are h2 and h1) |
| pane | `--pane-xs`…`--pane-xl` = 80 · 160 · 240 · 320 · 480 px |

A contained pane takes the nearest `--pane-*` height and scrolls inside. A value off
the scale is a change to this table, not an inline exception.

## 3. Stacking

Sections may stack while the page stays inside its budget. Past it, pick the
first that fits:

1. **Paginate** any list that can grow without bound: a page size plus "show
   more". A list never sets the page height.
2. **Tab** parallel views of one object (findings beside the demo, the
   transcript beside the artifact). A tab keeps its `data-section` mounted or
   the stories lose it.
3. **Contain** raw text, logs and diffs in a `--pane-*` box.
4. **Collapse** into `<details>` only what is secondary and rarely opened.
   Never collapse the primary action, the gate decision or a failure.

Group, don't scatter: related fields form one titled section, and a page
carries at most five top-level sections.

## 4. Media on generated pages

- One hero frame per act, inline. Every other beat shows as a captioned
  thumbnail in a gallery under its act, linking the full frame. Every beat's
  step text stays.
- Story frames capture the viewport, not the full page. A beat that needs
  the whole page declares `frame: 'fullPage'`.
- No other image budget applies; the 8-viewport cap is the bound.

## 5. Every design states its budget

A PR that adds or reshapes a Studio surface or a generated page carries one
line in its body:

> Height/density budget: `<type>`, `<n>` viewports measured at `<route or page>`; tokens only.

## Appendix: measurements behind the numbers

Measured on main `94fd0b39`, 2026-10-10.

- **Generated how-tos.** The S10 page is 1280×43,436 px: 61 full-page frames
  of about 712 px, 43 viewports. Next: 39, 26, 20 and 16 frames. The
  condensed rendering cuts words, never images. Budget 8 = 1/5 of S10.
- **Frames.** `captureFrame` in `scripts/stories/red-evidence.mjs` takes
  `fullPage: true` for every beat, so a frame is as tall as the page.
- **Studio routes.** Only the flow builder and Knowledge are fixed shells;
  every other route grows with its data. `/agents/[id]` stacks about 15
  sections, `/artifact` about 8, `/monitor` 6. Tallest committed story
  frame per route (`demos/stories/*/frames`, 1600 wide, px):

  | route | tallest | budget | at |
  |---|---|---|---|
  | `/artifact` verdict | 8,655 | 2,000 | S10 beat 24 |
  | `/projects/[id]` | 8,318 | 3,000 | S3 beat 5 |
  | `/community` | 7,521 | 3,000 | S8 beat 6 |
  | `/flows/[id]/run/[runId]` | 3,899 | 3,000 | S10 beat 23 |
  | `/knowledge` (fixed shell) | 2,002 | 1,000 | S6 beat 14 |
  | `/agents/[id]` | 1,174 | 3,000 | S5 beat 13 |
  | `/monitor` | 1,105 | 3,000 | S9 beat 14 |
- **Tokens.** `globals.css` defines two radii and colours, no spacing or
  type scale. Inline values: gaps 8/16/24/28; fonts 10.5–13 px; contained
  heights 80, 160, 220, 260, 320, 340, 420 (Monitor run rail), 460, 480.
  They round onto the pane scale: 220 and 260 → 240, 340 → 320, 420 and
  460 → 480.
- **Collapse and paging.** `<details>` appears in five places; the history
  ledger is the one paged list; no tab component exists.
