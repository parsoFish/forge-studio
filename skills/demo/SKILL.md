---
name: demo
description: The canonical forge demo capability — how forge runs a demo, what every demo must contain, and how the demo maps to the forge UI review page. A demo makes ONE behavioural delta (prior → new) visible, grounded in the initiative's acceptance criteria. The phase agent (today the developer-unifier; tomorrow a review agent, ADR 024) composes this skill to author the structured demo.json, derive DEMO.md/DEMO.html, and — for visual changes — optionally back-fill before/after media. Scale demo effort to the size of the change. This skill is the forge half of the demo contract family (docs/forge-project-contract.md); the project half is the project's demo.shape + how it exposes a before/after.
phase: developer-loop
surface: unattended
model: claude-sonnet-4-6
---

# Demo — the forge demo capability (the demo contract)

## What this skill is

This is the **single source of truth** for the demo seam between forge and a
managed project. The review phase's job is to show the operator *what changed*
so they can make the merge decision; the demo is that artefact. This skill owns:

1. **What a demo must contain** (the contract below).
2. **How forge runs a demo** — author `demo.json`, derive `DEMO.md`/`DEMO.html`,
   optionally capture media.
3. **How the demo maps to the forge UI** — the same `demo.json` the review
   screen renders (`DemoComparison`), so the PR artefact and the UI never drift.
4. **The project-side requirements** a project must meet to be demo-able.

It supersedes the split that used to exist across `skills/demo` (a Playwright-spec
author), `skills/demo-capture` (media back-fill), the inline unifier prompt, and
[ADR 016](../../docs/decisions/016-demo-recording-tooling.md). The structured
artefact is the contract from [ADR 021](../../docs/decisions/021-local-review-and-unified-demo.md).

## Required first action

Invoke `brain-query` against the **project's** brain before authoring anything:

- "How does this project demonstrate a change — test harness, UI, CLI output?"
- "Are there demo/recording conventions or gotchas for this project?" (e.g.
  trafficGame's *serve the built `dist/`, never reuse a stray dev server* lesson;
  betterado's *Go test-harness, no web UI* lesson).

## The demo contract (what EVERY demo must contain)

A demo is **one structured artefact**: `demo/<initiative-id>/demo.json`
(schema = `DemoModel` in [`cli/demo-model.ts`](../../cli/demo-model.ts),
validated by the `pr_self_contained` gate). It must carry:

### Required core fields

- **`title`** — the one-line essence of the change.
- **`essence`** — 2–3 sentences: what behaviour changed and why it matters, framed
  **prior → new**. State any non-visual delta here.
- **`project`**, **`initiativeId`**, **`diffStat`** (`git diff --stat main...HEAD`).
- **`checkpoints[]`** — ≥1, each `{ label, caption, kind?, beforeNote?, afterNote?,
  metrics?, beforeImage?, afterImage? }`. Each checkpoint shows ONE before→after
  pair, grounded in an acceptance criterion or a concrete diff change.

### Rich structured sections (strongly recommended — prevents wall-of-text)

The operator's #1 complaint is demos that are walls of text or bare diffs.
**Always author these sections when the diff warrants them.** The renderer
collapses them gracefully when absent, but their absence means a less useful demo.

- **`summary`** — `{ bullets: string[], prUrl?, commitSha?, branch? }`.
  3–5 concise bullets: what changed, why it matters, what the operator should
  look for. Include the PR URL, branch, and commit SHA when available — these
  appear in the header band of the HTML.

  ```json
  "summary": {
    "bullets": [
      "Adds a dark-mode toggle that follows the OS preference by default.",
      "Persists the choice in localStorage so it survives page reload.",
      "No behaviour change when OS preference is light."
    ],
    "prUrl": "https://github.com/org/repo/pull/42",
    "branch": "forge/INIT-2026-05-30-dark-mode",
    "commitSha": "a1b2c3d"
  }
  ```

- **`apiDiff[]`** — Array of `{ name, change: "added"|"changed"|"removed", before?, after? }`.
  Each entry is one changed endpoint, function signature, config key, CLI flag, or
  protocol message. `before`/`after` are the exact JSON shape or text — the renderer
  syntax-highlights them. Include this section whenever the diff touches a public
  API surface, a function signature, or an observable output format.

  ```json
  "apiDiff": [
    {
      "name": "GET /api/nodes/:id",
      "change": "changed",
      "before": "{ \"id\": \"n1\", \"label\": \"A\" }",
      "after": "{ \"id\": \"n1\", \"label\": \"A\", \"grade\": 0.87 }"
    },
    {
      "name": "computeGrade(node: Node): void",
      "change": "changed",
      "before": "computeGrade(node: Node): void",
      "after": "computeGrade(node: Node): number"
    }
  ]
  ```

- **`testEvidence[]`** — Array of `{ name, result: "pass"|"fail"|"skip", delta? }`.
  Include whenever the diff adds or changes tests, or when you can report a
  coverage delta. `delta` is a short annotation like `"+3 new tests"` or
  `"coverage: 82% → 87%"`.

  ```json
  "testEvidence": [
    { "name": "computeGrade — returns float in [0,1]", "result": "pass", "delta": "+1 new test" },
    { "name": "Inspector panel renders grade", "result": "pass" },
    { "name": "All existing tests", "result": "pass", "delta": "42/42 green" }
  ]
  ```

- **`filesChanged[]`** — Array of `{ path, note? }`. Optional annotated list; when
  absent the renderer falls back to `diffStat`. When present, each entry gets a
  human-readable annotation like `"core logic"`, `"new file"`, `"test"`.

  ```json
  "filesChanged": [
    { "path": "src/grade.ts", "note": "new — grade computation" },
    { "path": "src/Inspector.tsx", "note": "renders grade badge" },
    { "path": "src/grade.test.ts", "note": "new tests" }
  ]
  ```

- **`acceptanceCriteria[]`** (optional but recommended) — the ACs the demo proves.

### Three load-bearing disciplines

- **One behavioural delta, not a tour.** Pick the single delta that is the essence
  of the initiative. A tight 3–5 checkpoint scenario beats an exhaustive walk.
- **Baseline is a valid prior state, never "broken".** Frame every checkpoint as
  "prior behaviour → new behaviour", never "error → fixed". If the new feature did
  not exist before, the baseline legitimately shows the *prior* screen/output —
  describe it as prior behaviour in `beforeNote`.
- **Never fabricate a visual for a non-visual change.** An internal refactor, an
  API change, a type change has no screenshot. State the delta in `essence`; do
  not invent an on-screen overlay or re-shoot an unrelated screen. Use `apiDiff`
  to show the before/after of the API surface instead.

## How forge runs a demo

1. **Author `demo/<initiative-id>/demo.json`** to the contract above. Populate
   ALL applicable rich sections — `summary`, `apiDiff`, `testEvidence`,
   `filesChanged` — so the rendered HTML is genuinely informative.
2. **Derive the artefacts:** `Bash forge demo render <initiative-id>` →
   writes `DEMO.md` + `DEMO.html` from the JSON. **Never hand-write `DEMO.md`** —
   it is derived, so the PR artefact and the UI render stay identical.
3. **(Visual only) Capture media:** for `demo.shape: "browser"`,
   `Bash forge demo capture <initiative-id>` (best-effort; see *Media capture*).
4. **Commit** `demo.json` + `DEMO.md` + `DEMO.html` (the bundle is born tracked —
   no `.forge/demos/` shadow).

## Effort tiers — scale the demo to the change (load-bearing)

A trivial change must not trigger a heavyweight demo. This is a real cost sink
(observed: ~$11 / 15 unifier iterations packaging a one-file test change). Match
the effort to the diff:

| Diff shape | Demo effort |
|------------|-------------|
| **Trivial** (≤~2 files, no behavioural surface — a test add, a constant, a doc) | **Notes-only.** One checkpoint, `essence` + `beforeNote`/`afterNote`. **No media capture.** Do not invoke `forge demo capture`. |
| **Standard** (a feature or fix with a clear behavioural delta) | Full checkpoints grounded in ACs; `summary` + `apiDiff` + `testEvidence` when applicable; metrics if measurable; media only if `demo.shape: "browser"`. |
| **Large / multi-feature** | A checkpoint per distinct delta (still tight per checkpoint); `summary` bullets for each sub-change; `apiDiff` for each changed surface; media for the visual ones; a metrics table for harness shapes. |

When in doubt, prefer notes-only and let the operator ask for more. Media is an
enhancement, never a gate. **Do author `summary` + `apiDiff` + `testEvidence` even
for notes-only demos when the diff touches a visible API or adds tests** — these
sections make the HTML genuinely useful without requiring media capture.

## Per-shape mapping (how each project form satisfies "demonstrable")

The project declares its shape in `.forge/project.json` `demo.shape`:

- **`browser`** — a rendered UI. Author checkpoints, then `forge demo capture` to
  back-fill before/after screenshots. `kind: "screenshot"` for a settled UI
  state; `kind: "video"` for time-dependent behaviour. Requires `preview_command`
  in project.json.
- **`harness`** — behaviour measurable only at the test layer. Run the project's
  own measurement command against baseline AND HEAD, scrape stable result lines,
  encode them as a `kind: "harness"` checkpoint with
  `metrics: [{ label, before, after, deltaPct, parity }]`. **Reuse the project's
  test — never re-derive the measurement.** Pair with `testEvidence` rows.
- **`cli-diff`** — run the project's demo command twice (baseline + HEAD), capture
  stdout, encode the before/after in `beforeNote`/`afterNote`. Use `apiDiff` to
  show the CLI flag / output format change.
- **`artifact`** — a generated file/output; describe the before/after artefact in
  notes (and diffStat). No media. `filesChanged` shows which artefacts changed.
- **`none`** — infra-only / no observable surface. A single checkpoint that is a
  rationale block: what changed and why it's correct. Use `summary` bullets for
  the rationale.

## Media capture (the optional, best-effort step)

For `demo.shape: "browser"` only, after `demo.json` checkpoints are authored:

```
forge demo capture <initiative-id>
```

It materialises two git worktrees (baseline `main` vs changed `HEAD`), builds +
serves each, takes ONE screenshot per checkpoint label →
`before/<label>.png` + `after/<label>.png` (the capture engine calls
`playwright screenshot` per label — no agent-authored spec, no full test run),
then merges the captured images into `demo.json` checkpoints as inline `data:`
URIs (size-capped to 1.5 MB each) and re-renders `DEMO.md`/`DEMO.html`.

Discipline:
- **Best-effort, never fatal.** No buildable app / missing Playwright / capture
  error → logs and exits 0; the demo stays notes-only. Never blocks the gate.
- **No remote media.** Only inline `data:` URIs are merged (`validateDemoModel`
  rejects scheme-bearing refs). Video refs are relative sibling paths only.
- **Does not re-author content.** It fills only `beforeImage`/`afterImage` —
  never captions, notes, metrics, or the diffstat.
- **Serve the built tree, not a stray dev server.** A reused dev server latches
  onto the *main* repo's build and captures stale screenshots (trafficGame
  lesson). The capture engine builds + serves each worktree on its own port.
- Events: `demo-capture.start`, `demo-capture.merged`, `demo-capture.skipped`.

## How the demo maps to the forge UI page (the presentation half)

The structured `demo.json` is **both** the PR artefact (via the derived `DEMO.md`)
and the UI artefact: the review screen (`forge-ui/app/review/[cycleId]`) renders
the same `DemoModel` natively via `DemoComparison.tsx`. **The schema is the
template** — what you put in `demo.json` is exactly what the operator sees, so:

- The header band shows: title, cycle id, branch, commit SHA, PR link.
- `summary` bullets appear in a dedicated Summary section above the checkpoints.
- Each checkpoint becomes a `CheckpointCard` (caption + before/after media or
  notes + a metrics table for `harness`).
- `apiDiff` renders as syntax-highlighted before/after code blocks.
- `testEvidence` renders as a pass/fail table with coverage deltas.
- `filesChanged` renders as an annotated file list with the diffstat collapsible.
- The screen mirrors structured state to `data-*` (`data-section="demo-comparison"`,
  per-checkpoint `data-checkpoint` / `data-checkpoint-kind`) per the forge-ui
  DOM-as-metrics convention.
- `snapshotCycleArtefacts` copies `demo.json` + `DEMO.html` into
  `_logs/<cycleId>/artifacts/` for the bridge to serve.

If you change the demo's structure, change `DemoComparison` + its `data-*`
alongside it — the schema, the renderer, and the UI are one contract.

## The project-side requirements (what makes a project demo-able)

For onboarding (the `forge-onboard-project` skill + `forge preflight`), a project
must expose:

1. **A declared `demo.shape`** in `.forge/project.json` (+ `command` for any shape
   ≠ `none`; + `preview_command` for `browser`).
2. **A truthful test gate** (contract C1) — the same gate that *proves* the change
   is what the demo *shows*.
3. **A before/after path appropriate to the shape** — a UI a preview server can
   render (`browser`); a measurement command with scrapable output (`harness`); a
   CLI whose stdout differs (`cli-diff`); a generated artefact (`artifact`).
4. **A valid prior state** — running the baseline must not error; the demo frames
   it as prior behaviour.

`forge preflight` checks the structural part (the `demo` block) as the advisory
**DEMO** clause; the deeper "does the before/after actually capture the delta"
facet is verified during onboarding by hand until machine-checked.

## Done when

`demo/<initiative-id>/demo.json` validates, `DEMO.md`/`DEMO.html` are *derived*
(not hand-written) and committed alongside it, the effort matches the diff size,
every checkpoint is grounded in an AC or a real diff change and framed prior→new,
the `summary` / `apiDiff` / `testEvidence` / `filesChanged` sections are authored
where the diff warrants them, and (for `browser`) media capture has been attempted
best-effort.
