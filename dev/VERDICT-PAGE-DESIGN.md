# Verdict gate page design

The design for `/artifact?type=verdict&mode=gate`, the page where the
operator approves a change (which merges it) or sends it back. It must fit
the gate budget in [UI-CONSTRAINTS.md](./UI-CONSTRAINTS.md) (D-46). The plan
and reflection gates reuse the same shell afterwards. Static mock:
[verdict-page-mock.html](./verdict-page-mock.html), generated from the
gitweave I1 verdict (open it in a browser at 1600×1000).

## 1. What is wrong today

Measured on main `0a5c5eff` at 1600×1000, on the I1 verdict at its gate. The
fixture ran on a dry-bridge Studio on ports outside 4123/4124.

| measure | today | budget |
|---|---|---|
| page height | 16,788 px | ≤ 2,000 px |
| document width | 4,462 px (the page scrolls sideways) | 1,600 px |
| first decision control (top) | y = 12,827 | inside the first 1,000 px |
| `[data-demo-region]` boxes that overflow | 18 of 34, widest scrollWidth 4,173 | 0 |
| before/after images | 640×320, no way to enlarge | large, zoomable |
| top-level blocks | ~8 stacked | ≤ 5 |

The operator's reading of the same page (R47): large blocks of text that are
hard to take in; slice images too small to see; videos dead (fixed since by
forge-mfv5.1.29: all 30 now load); AC boxes broken out of their bounds.

Three causes sit under those symptoms:

- **Everything renders twice.** `DemoComparison` lists every checkpoint
  (15 cards with two videos each), then `DemoReviewSurface` lists the
  criteria and the checkpoints again as comment regions. The decision
  control comes after both.
- **Reviewer prose is one paragraph per field.** `review-findings.json`
  joins one chunk per work item into `summary` and each of `why`, `what`
  and `how`, prefixed `[WI-1] … [WI-2] …`. The panel prints each field as
  one 2,700–3,200 character paragraph.
- **Nothing wraps inside a region header.** A criterion with a long
  inline-code span is laid out on one line (`white-space: nowrap`, no
  `min-width: 0` on its flex parent), so the header widens the page.

The frames are a capture problem as well as a layout problem. Each
`beforeImage`/`afterImage` is a 640×320 composite of two 320-pixel stills
(`packages/factory/demo-capture.ts`), and at 750 px wide the terminal text
is still unreadable. For a `cli-before-after` checkpoint the readable
evidence is the captured stdout (`beforeOutput`/`afterOutput`), so the
design shows that by default. The capture resolution is bead forge-nk1y.30.

## 2. The layout

The column is 1,600 px wide with 32 px (`--space-6`) gutters. There are four
top-level blocks under the identity line:

```text
┌ nav ────────────────────────────────────────────────────────────────────────┐
│ crumb · h1 "I1 — An honest baseline" [AWAITING YOUR VERDICT]  artifact trail │  identity
├─────────────────────────────────────────────────────┬───────────────────────┤
│ WHAT THIS ENABLES  [agent narrative — not evidence] │ YOUR VERDICT          │  1 decision
│ one paragraph, display face                          │ Ready to approve…     │    (viewport 1)
│ Gates │ Checkpoints │ Criteria │ Findings │ Diff │ $ │ [Approve and merge]  │
│ 2/2   │ 12 changed  │ 10 met   │ 4 major  │ 169  │   │ [Send back with WIs] │
├──────────────────────────────────┬──────────────────┴───────────────────────┤
│ Acceptance criteria (19)         │ Adversarial review · reviewed e0a0a56 ≠  │  2 review
│ MET  WI-1 GIVEN … (1 line)       │ head 0162a36   [Findings|Why·what·how]   │    --pane-md
│ … scrolls inside                 │ WI-1 title · 2-line summary · findings   │
├──────────────┬───────────────────┴──────────────────────────────────────────┤
│ WI-1 ⬡ track │ [CHANGED] caption  $ command                      [Comment]  │  3 demo
│   ⬢ changed  │ BEFORE (output|frame|video)   AFTER (output|frame|video)    │    --pane-xl
│   ⬡ unchgd   │ ≥ 600 px each, click → <dialog> lightbox                     │
│ WI-2 …       │ what differs (diff excerpt, --pane-xs)                       │
├──────────────┴──────────────────────────────────────────────────────────────┤
│ ▸ Work items, test runs and changed files                                    │  4 details
└──────────────────────────────────────────────────────────────────────────────┘
```

| block | `data-section` | height | contents |
|---|---|---|---|
| identity | (none) | 48 | crumb, h1, status pill, artifact trail as one row of chips |
| 1 decision | `gate-decision` | 330 | narrative (labelled), six measured facts, the decision card |
| 2 review | `review` → `ac-verdicts`, `review-findings` | 282 | criteria and findings side by side, each `--pane-md` and scrolling inside |
| 3 demo | `demo-comparison` | 522 | checkpoint rail plus one checkpoint at a time, `--pane-xl` |
| 4 details | `demo-details` | 44 closed | work items, gate runs, changed files (collapsed: secondary) |

The mock measures **1,426 px** tall and 1,600 px wide. The approve button
sits at y = 358–412, and 0 of 20 regions overflow. A 1,000 px viewport shows
blocks 1 and 2 whole and the top of the demo.

### Block 1: the decision

- **Narrative.** The demo planner's "what this enables" sentence, in the
  display face at `--text-lg`, labelled *agent narrative — not evidence*
  (D-45). It is the only prose above the fold.
- **Facts.** Six measured values, each read from an artifact: gate runs
  (`testEvidence`, local and CI), checkpoint deltas (`checkpoints[].delta`),
  the reviewer's criterion verdicts (`acEvaluations`), findings by severity,
  the diff stat, and run cost (`run.costUsd`) with the head sha. None is
  narrative.
- **Decision card.** The verdict is still derived from the operator's
  comments: no open blocking comment means approve, any open blocker means
  send back. The card states what was derived, the primary action (ember;
  `approve-and-merge` or `send-back`) and the typed send-back
  (`compose-send-back`, which opens the forge-mfv5.1.28 form inside the
  card). One line warns that approving merges. Because the derived verdict
  counts comments only, an amber line under it names the reviewer's open
  claims (criteria missed, major findings, and the head they were judged
  at) so that "ready to approve" is never read as "the review is clean". The
  claims inform the decision but do not gate it. After a merge the card turns
  into the payoff: "Merged — reflect on this cycle →" (`open-reflect`),
  which also renders when the page is reopened on a merged run
  (forge-nk1y.25).

### Block 2: the review

- **Criteria pane.** One row per criterion: the reviewer's verdict word
  (met / partial / missed), the work item, and the criterion on one line,
  ellipsised but complete in the DOM. Long code spans wrap
  (`overflow-wrap: anywhere`), so a row can never widen the page. Clicking a
  row expands it to the full criterion, the reviewer's evidence and the
  comment thread, with each comment's open/resolved and blocking state by
  name. "Comment on this criterion" anchors a comment there. These rows are
  the AC `[data-demo-region]`s, first in document order.
- **Findings pane.** The header names the head the review judged and flags
  it in amber when that is not the branch head (`reviewed e0a0a56 ≠ head
  0162a36`, after forge-mfv5.1.30). Findings are grouped by work item: a
  title, two lines of that work item's summary, then one row per finding
  (severity word, title, category). The *Why · what · how* tab splits the
  reviewer's fields at their `[WI-n]` markers into three short titled
  columns per work item, the first three sentences each. No field is ever
  shown as one unbroken paragraph. The findings data has no resolved state,
  so the pane does not invent one. Resolution lives on the operator's
  comments.

### Block 3: the demo

- **Rail (the signature).** The checkpoints are grouped by work item on a
  station track. Each stop is a hex node: filled ember for *changed*, hollow
  for *unchanged*, amber for *unknown*. Each stop also carries the delta
  word and the caption. The track is forge's flow vocabulary (stations on a
  line) applied to evidence.
- **Viewer.** One checkpoint at a time. It shows the delta stamp
  (`CHANGED` / `UNCHANGED` / `UNKNOWN` by name), the caption, the exact
  command, a Comment button (the checkpoint's `[data-demo-region]`), then
  before and after side by side at ≥ 600 px each. Each side switches between
  output (default when stdout was captured), frame and video (inline
  `<video>` from the artifact route, present when recorded). Below them is
  the delta excerpt with added and removed lines coloured, contained at
  `--pane-xs`.
- **Lightbox.** Clicking either side opens a plain `<dialog>` with both
  sides at about 750 px each, in the same mode. Arrow keys step through the
  checkpoints and Esc closes it.

## 3. The story contract stays

S10 (`tests/stories/S10.review.mjs`) drives this page by `data-*` only. The
build keeps each key on an element with the same meaning:

| key | today | after |
|---|---|---|
| `data-page`, `data-page-ready`, `data-gate-state`, `data-mode` | `<main>` | `<main>`, unchanged; `routeReady` timing untouched |
| `data-demo-region="ac-N"` + `data-region-collapsed` + `toggle-region` | AC region cards (first in DOM) | criteria rows (still first in DOM) |
| `data-demo-region="checkpoint-N"` | checkpoint region cards | the viewer header of the selected checkpoint |
| `comment-region`, `comment-body`, `comment-blocking`, `add-comment` | inside a region | inside a criteria row / the viewer |
| `resolve-comment`, `edit-comment`, `delete-comment`, `data-comment-resolved` | region comment rows | criteria-row and viewer comment rows |
| `data-component="verdict-form"`, `data-form-kind`, `data-form-state`, `approve-and-merge`, `send-back`, `compose-send-back` | sticky bar at the bottom | the decision card |
| `open-reflect` | payoff box after approve | the decision card after a merge |
| `data-section="review-findings"`, `ac-verdicts`, `why-what-how`, `data-ac-verdict`, `data-finding*` | findings panel | the two review panes |
| `data-section="demo-comparison"`, `data-checkpoint*`, `data-side`, `data-media-kind` | evidence column | the demo block |

S10 beats 13 and 16 use `pressWithin` with `fallback: 'first'`, which picks
the first matching region in document order. The criteria block therefore
stays above the demo, and no story beat changes meaning. Moved attributes are
regenerated into [studio-dom-contract.md](./studio-dom-contract.md) in the
build PR.

## 4. Approaches considered

- **Chosen: stacked, contained blocks.** Decision first, then review, then
  demo, each in a fixed `--pane-*` that scrolls inside. Everything the stories
  read stays mounted and visible.
- **Tabs for review and demo** (D-46 §3 step 2). Rejected: a hidden tab panel
  holds the first AC region, so the S10 beats would press a hidden control.
  The page fits the budget without tabs.
- **One chapter per work item** (criteria, checkpoints and findings
  together). Rejected for now: it scatters the criteria the decision rests on
  across eight cards. The grouping survives inside each pane (WI labels on
  criteria, WI groups in findings and on the rail).
- **Demo in viewport 1, review below it.** Rejected: the first region in
  document order would become a checkpoint, which changes S10's beat
  meaning.

## 5. Reader test

A reader agent saw only the 1600×1000 screenshot of viewport 1. It
answered "what is the decision?" (approve and merge, which cannot be
undone from the page, or send back with work items) and "what changed?"
(the narrative) without scrolling. It also named the narrative as the
non-evidence text. Its two findings went into the mock: the decision card
now names the reviewer's open claims, and fact sub-labels wrap instead of
truncating.

## 6. Build notes

- Tokens only. The mock copies the `globals.css` token block; every size is
  `--space-*`, `--text-*`, `--pane-*` or a `calc()` of them. The surviving
  hex literals in `DemoComparison` and `DemoReviewSurface` go with them.
- No dependency: `<dialog>`, CSS line-clamp, a small pure helper module for
  splitting reviewer text and joining criteria with their evaluations.
- Shared shell: block 1 and the identity row become the gate shell that the
  plan gate (`ArchitectPlanGate` in the card) and the reflection gate
  (`ReflectionGate` in the card) take on in the next PR.

> Height/density budget: `gate`, 1.43 viewports measured at the static mock
> of `/artifact?type=verdict&mode=gate` (gitweave I1 fixture); tokens only.
