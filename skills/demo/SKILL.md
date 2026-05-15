---
name: demo
description: Author ONE Playwright spec + demo-manifest that captures the behavioural delta of an initiative. The orchestrator runs the identical spec against the baseline tree and the changed tree; the two captures become a before/after comparison. The spec must surface the essence of the change, not exhaustively walk the app, and must treat the baseline as a valid prior behaviour (never a failure hunt).
phase: review-loop
surface: unattended
model: claude-sonnet-4-6
---

# Demo author

## Single responsibility

Write exactly two files into the demo working directory:

1. **`demo.spec.ts`** — a single Playwright spec (one `test()` per
   checkpoint, test title = checkpoint label) that drives the running app
   and captures each checkpoint as a screenshot (static UI) or a video
   (dynamic behaviour) — whichever actually demonstrates the change.
2. **`demo-manifest.json`** — metadata the orchestrator uses to compose the
   before/after HTML.

You do **not** run anything, build anything, or modify project source. The
orchestrator runs your spec twice (once per tree) and composes the report.

## Required first action

Invoke `brain-query` before writing anything:

- "What does this project's UI/interaction look like — entry point, key
  screens, how state is reached?"
- "Are there demo/recording conventions or gotchas for this project?"

Then read, in this order:

1. The **manifest body + acceptance criteria** — the *intent*: what the
   initiative is supposed to change, behaviourally.
2. The **technical diff** (`git diff <base>..<changed>`) — what *actually*
   changed in code. Reconcile intent vs implementation: the demo shows what
   was actually built, framed by what was intended.
3. An **existing Playwright spec** in the project (if any) + the Playwright
   config — match selectors, setup, and waiting conventions. Do not invent a
   UI that isn't there; read the real components the diff touches.

## The behavioural-delta discipline (load-bearing)

- The demo's job is to make **one clear behavioural difference** visible:
  *what the behaviour was before* vs *what it is now*. Pick the single
  delta that is the essence of the initiative. Refine scope ruthlessly —
  a tight 3–5 checkpoint scenario beats an exhaustive tour.
- The **baseline is a valid working state**, not broken. Frame every
  checkpoint as "prior behaviour → new behaviour", never "error → fixed".
  If the new feature's UI does not exist in the baseline, the baseline
  screenshot legitimately shows the *prior* screen — capture it
  gracefully (see tolerance below) and describe it in `beforeNote` as
  prior behaviour, not as a missing/error state.
- Ground every checkpoint in an acceptance criterion or a concrete code
  change from the diff. No speculative "might be nice to show" steps.

## Screenshot vs video — choose per checkpoint (load-bearing)

A single still **cannot** demonstrate parity of anything time-dependent: a
running simulation, an animation, vehicle flow, a physics loop. Two stills
of a moving system differ even between two runs of the *same* build, so a
screenshot "before vs after" of dynamic behaviour proves nothing.

- `kind: "screenshot"` — a **static** UI state that has settled (title
  screen, a loaded map at rest, a panel that just opened). The before/after
  pair is a meaningful visual diff.
- `kind: "video"` — **dynamic/temporal** behaviour. Record the action over
  time (e.g. start the simulation, let vehicles flow for a few seconds).
  The before/after pair is two clips the reviewer can watch.

**Never fabricate a visual checkpoint for a non-visual change.** An internal
API removal, a refactor with no rendered difference, a type change — these
are NOT screenshots or videos. Do not invent an on-screen "API overlay" or
re-shoot an unrelated screen to manufacture a checkpoint. State the
non-visual delta in `essence` (and a checkpoint `afterNote` if it rides
along a visible one); do not create a checkpoint whose two captures would be
identical or meaningless.

## `demo.spec.ts` contract

- One spec file, Playwright `@playwright/test`.
- Base URL comes from `process.env.DEMO_BASE_URL` (the orchestrator starts a
  server per tree and sets this). Never hard-code a port.
- **One `test()` per checkpoint, and the test title MUST equal the
  checkpoint `label`.** (The orchestrator harvests each video by matching
  the test title; screenshot checkpoints rely on the path you write.)
- **Screenshot checkpoint**: in its `test('<label>', …)`, after the UI has
  settled, write exactly `${process.env.DEMO_SCREENSHOT_DIR}/<label>.png`
  via `page.screenshot(...)`.
- **Video checkpoint**: in its `test('<label>', …)`, perform the timed
  action (navigate, start the behaviour, `waitForTimeout` long enough to
  show it — typically 4–8 s). Do **NOT** call `page.screenshot` for a video
  checkpoint; Playwright records the whole test as the clip automatically
  and the orchestrator harvests it as `<label>.webm`.
- **Tolerance**: wrap interactions so a control that exists only in the
  changed tree being absent in the baseline does not throw — e.g.
  `try { await page.click(sel, { timeout: 4000 }); } catch {}` then proceed.
  A checkpoint test must never hard-fail the run; it captures whatever IS
  on screen (the prior behaviour).
- Deterministic: prefer role/text selectors and explicit waits over blind
  sleeps where a state is observable. No randomness, no third-party network.
- Keep it tight: 3–5 checkpoints total.

## `demo-manifest.json` contract

```json
{
  "title": "<one-line headline — the essence>",
  "essence": "<2–3 sentences: what behaviour changed and why it matters, framed prior→new. State any non-visual delta here, not as a fake checkpoint.>",
  "checkpoints": [
    { "label": "<= the test() title and the capture filename stem>",
      "kind": "screenshot | video",
      "caption": "<what behaviour this checkpoint shows>",
      "beforeNote": "<optional: clarify the prior-behaviour state>",
      "afterNote": "<optional: clarify the new-behaviour state>" }
  ],
  "acceptanceCriteria": ["<the ACs this demo is grounded in>"]
}
```

- `checkpoints` order = the narrative order in the report.
- Every `label` MUST equal a `test()` title; screenshot labels map to
  `<label>.png`, video labels to a harvested `<label>.webm`.
- `kind` defaults to `screenshot` if omitted — but set it explicitly.
- Captions describe **behaviour shown**, not "before/after" (the report
  supplies the before/after framing) and never "broken/fixed".

## Done when

Both files exist in the demo working directory, the spec references only
real selectors/components from the diff + existing specs, every manifest
`label` maps to a screenshot the spec writes, and the scenario is the
tightest one that makes the initiative's behavioural delta unmistakable.
