---
name: demo
description: The canonical forge demo capability — how forge runs a demo, what every demo must contain, and how the demo maps to the forge UI review page. A demo makes ONE behavioural delta (prior → new) visible, grounded in the initiative's acceptance criteria. The phase agent (the developer-unifier, ADR 024) composes this skill to author the structured demo.json and derive DEMO.md. The unifier reads the project's generated demo skill (from skills/demo-design) to know what evidence to produce; this skill defines the contract that evidence must satisfy. Scale demo effort to the size of the change.
phase: developer-loop
surface: unattended
model: claude-sonnet-4-6
---

# Demo — the forge demo capability (the consumer contract)

## What this skill is

This is the **single source of truth** for the demo contract between forge and a
managed project. The review phase's job is to show the operator *what changed*
so they can make the merge decision; the demo is that artefact. This skill owns:

1. **What a demo must contain** (the contract below).
2. **How forge runs a demo** — read the project's generated demo skill, author
   `demo.json`, derive `DEMO.md`.
3. **How the demo maps to the forge UI** — the same `demo.json` the review
   screen renders (`DemoComparison`), so the PR artefact and the UI never drift.

The project-side demo machinery is **generated** by `skills/demo-design` when
the operator configures `demoProcess` in Studio. The generated skill (at
`<artifactRoot>/skills/<slug>/SKILL.md` in the project repo) tells the unifier
what evidence to produce. This skill defines the contract that evidence satisfies.

It supersedes the split that used to exist across `skills/demo` (a Playwright-spec
author), `skills/demo-capture` (media back-fill), the inline unifier prompt, and
[ADR 016](../../docs/decisions/016-demo-recording-tooling.md). The structured
artefact is the contract from [ADR 021](../../docs/decisions/021-local-review-and-unified-demo.md).

## Required first action

1. **Load the project's generated demo skill** — it is listed in the project's
   `skills` array in `.forge/project.json`. Read it; it names the evidence form
   and the exact commands to run.
2. **Invoke `brain-query`** against the **project's** brain before authoring:
   - "How does this project demonstrate a change — test harness, UI, live API?"
   - "Are there demo/recording conventions or gotchas for this project?"

## The demo contract (what EVERY demo must contain)

A demo is **one structured artefact**: `<demo-dir>/demo.json`
(schema = `DemoModel` in [`cli/demo-model.ts`](../../cli/demo-model.ts),
validated by the `pr_self_contained` gate). The demo dir is resolved against the
project's `artifactRoot`: it is `demo/<initiative-id>/` for a default-layout
project (`artifactRoot: "."`), or `<artifactRoot>/history/<initiative-id>/demo/`
when the project gathers its committed artifacts under a sub-root (e.g.
betterado's `forge/`, giving `forge/history/<initiative-id>/demo/`). **The
iteration brief (PROMPT.md) names the exact dir — write there**; `forge demo
render <initiative-id>` resolves the same path from `artifactRoot`, so you never
pass `--dir`. It must carry:

### Required core fields

- **`title`** — the one-line essence of the change.
- **`essence`** — 2–3 sentences: what behaviour changed and why it matters, framed
  **prior → new**. State any non-visual delta here.
- **`project`**, **`initiativeId`**, **`diffStat`** (`git diff --stat main...HEAD`).
- **`checkpoints[]`** — ≥1, each `{ label, caption, kind?, beforeNote?, afterNote?,
  command?, beforeOutput?, afterOutput?, metrics?, beforeImage?, afterImage? }`. Each
  checkpoint shows ONE before→after pair, grounded in an acceptance criterion or a
  concrete diff change.
- **Prefer REAL captured output over a prose note.** For a CLI tool, set `command` to
  the exact argv whose stdout IS the evidence (e.g. `node dist/cli.js churn .`); leave
  `beforeOutput`/`afterOutput` empty — `forge demo capture` runs the command on `main`
  (before) AND the branch HEAD (after) and back-fills the REAL terminal output,
  rendered side-by-side. The operator wants to SEE the actual output, not a description
  of it. Use `beforeNote`/`afterNote` only as a one-line caption, or when no command
  can show the change (a pure type/internal refactor).

### Rich structured sections (strongly recommended — prevents wall-of-text)

The operator's #1 complaint is demos that are walls of text or bare diffs.
**Always author these sections when the diff warrants them.** The renderer
collapses them gracefully when absent, but their absence means a less useful demo.

- **`summary`** — `{ bullets: string[], prUrl?, commitSha?, branch? }`.
  3–5 concise bullets: what changed, why it matters, what the operator should
  look for. Include the PR URL, branch, and commit SHA when available — these
  appear in the header band of the rendered DEMO.md.

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
    { "name": "All existing tests", "result": "pass", "delta": "42/42 green" }
  ]
  ```

- **`filesChanged[]`** — Array of `{ path, note? }`. Optional annotated list; when
  absent the renderer falls back to `diffStat`. When present, each entry gets a
  human-readable annotation like `"core logic"`, `"new file"`, `"test"`.

- **`usage_example`** (string, required for new-or-changed-capability initiatives) —
  a fenced code block showing HOW to use the new capability: the HCL resource block,
  the CLI invocation, or the API request that exercises it. This is the first thing
  the operator looks for when reviewing a new feature.

- **`impact`** (string[], required for new-or-changed-capability initiatives) —
  bullets describing what the new capability unlocks for the operator. Distinct from
  `essence` (which is the technical delta) — `impact` is the "so what".

- **`acceptanceCriteria[]`** (optional) — the raw AC strings, kept for back-compat.
  Prefer `acEvaluations` (below) which supersedes this for the review screen.

- **`acEvaluations[]`** (required when ≥1 AC was proved) — **the primary AC surface**.
  One entry per acceptance criterion with a concrete verdict and evidence. The review
  screen foregrounds this as an "Intent & Outcome" table at the TOP of the demo,
  before checkpoints. Schema (mirrors `AcEvaluation` in `cli/demo-model.ts`):

  ```json
  "acEvaluations": [
    {
      "criterion": "GIVEN a release definition WHEN applied THEN ADO returns 200",
      "verdict": "met",
      "evidence": "terraform apply exited 0; GET /api/release/{id} returned the resource."
    }
  ]
  ```

  **Verdict vocabulary:**
  - `"met"` — the AC is fully proved by the evidence.
  - `"partial"` — the AC is mostly met; document the gap in `evidence`.
  - `"missed"` — the AC was not reached; document why in `evidence`.

  **Evidence discipline:** state a concrete, observable fact — a test name + result,
  an API response, a measured value. Never write "see code" or "tests pass" without
  naming the test. One entry per AC; do not merge or split.

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

1. **Read the project's generated demo skill** (from `<artifactRoot>/skills/<slug>/SKILL.md`
   in the project repo). Follow its evidence instructions — it names what commands
   to run, what to capture, and what the evidence floor is.
2. **Author the demo.json** at the dir named in PROMPT.md to the contract above.
   Populate ALL applicable rich sections — `summary`, `apiDiff`, `testEvidence`,
   `filesChanged` — so the rendered DEMO.md is genuinely informative.
3. **Derive the artefact:** `Bash forge demo render <initiative-id>` → writes
   `DEMO.md` from the JSON. **Never hand-write `DEMO.md`** — it is derived, so
   the PR artefact and the UI render stay identical.
4. **Capture real before/after evidence:** `Bash forge demo capture <initiative-id>`
   — for checkpoints with a `command`, captures the REAL stdout on `main` vs the branch
   HEAD into `beforeOutput`/`afterOutput`; for browser checkpoints, captures screenshots.
   Then re-renders DEMO.md. Best-effort (a capture failure leaves the checkpoint as-is).
5. **Commit** `demo.json` + `DEMO.md` (the bundle is born tracked — no `.forge/demos/`
   shadow).

## Effort tiers — scale the demo to the change (load-bearing)

A trivial change must not trigger a heavyweight demo. This is a real cost sink
(observed: ~$11 / 15 unifier iterations packaging a one-file test change). Match
the effort to the diff:

| Diff shape | Demo effort |
|------------|-------------|
| **Trivial** (≤~2 files, no behavioural surface — a test add, a constant, a doc) | **Notes-only.** One checkpoint, `essence` + `beforeNote`/`afterNote`. **No media capture.** Do not invoke `forge demo capture`. |
| **Standard** (a feature or fix with a clear behavioural delta) | Full checkpoints grounded in ACs; `summary` + `apiDiff` + `testEvidence` when applicable; metrics if measurable; media only if the generated skill specifies screenshots. |
| **Large / multi-feature** | A checkpoint per distinct delta (still tight per checkpoint); `summary` bullets for each sub-change; `apiDiff` for each changed surface; a metrics table for harness evidence. |

When in doubt, prefer notes-only and let the operator ask for more. Media is an
enhancement, never a gate. **Do author `summary` + `apiDiff` + `testEvidence` even
for notes-only demos when the diff touches a visible API or adds tests** — these
sections make the rendered DEMO.md genuinely useful without requiring media capture.

## Evidence forms (what the generated demo skill specifies)

The generated project demo skill (from `skills/demo-design`) specifies one of
these evidence forms based on what the project's code actually exposes:

- **Portal/browser screenshot** — a rendered UI. Author checkpoints, then
  `forge demo capture` to back-fill before/after screenshots. `kind: "screenshot"`
  for a settled UI state; `kind: "video"` for time-dependent behaviour.
- **Harness metrics** — behaviour measurable at the test layer. Run the project's
  measurement command against baseline AND HEAD, scrape stable result lines,
  encode them as a `kind: "harness"` checkpoint with
  `metrics: [{ label, before, after, deltaPct, parity }]`. **Reuse the project's
  test — never re-derive the measurement.** Pair with `testEvidence` rows.
  **Parity vocabulary:** `match` (exact same result), `within` (within tolerance),
  `diverged` (regression), `incomplete` (no baseline available).
- **Live external API round-trip** — the change stands up a REAL resource in a
  live external system. The evidence floor is a **real REST round-trip, not a
  test-name table**: provision the resource, read it back via the system's API,
  and persist that GET under `.forge/live-evidence/<label>.json`; `forge demo render`
  back-fills it into a checkpoint carrying `liveEvidence.url`. The demo MUST end
  with such a checkpoint. Pair with `testEvidence` (the live acceptance result)
  and, for a new capability, `usage_example` + `impact`. When credentials are
  absent, fall back to notes-only and **document the fallback in `essence`** —
  never fabricate the live read-back.
- **JSON-diff / notes-only** — no UI surface, no measurement command, no live
  external calls. A single checkpoint whose caption + `afterNote` is a rationale
  block ("what changed and why it's correct"). Use `summary` bullets for the
  rationale. `apiDiff` to show any changed API/config surface.

## Media capture (the optional, best-effort step)

For projects with a renderable UI, after `demo.json` checkpoints are authored:

```
forge demo capture <initiative-id>
```

It materialises two git worktrees (baseline `main` vs changed `HEAD`), builds +
serves each, takes ONE screenshot per checkpoint label →
`before/<label>.png` + `after/<label>.png` (the capture engine calls
`playwright screenshot` per label — no agent-authored spec, no full test run),
then merges the captured images into `demo.json` checkpoints as inline `data:`
URIs (size-capped to 1.5 MB each) and re-renders `DEMO.md`.

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
and the UI artefact: the review screen renders the same `DemoModel` natively via
`DemoComparison.tsx`. **The schema is the template** — what you put in `demo.json`
is exactly what the operator sees, so:

- The header band shows: title, cycle id, branch, commit SHA, PR link.
- `summary` bullets appear in a dedicated Summary section above the checkpoints.
- Each checkpoint becomes a `CheckpointCard` (caption + before/after media or
  notes + a metrics table for harness evidence).
- `apiDiff` renders as syntax-highlighted before/after code blocks.
- `testEvidence` renders as a pass/fail table with coverage deltas.
- `filesChanged` renders as an annotated file list with the diffstat collapsible.
- The screen mirrors structured state to `data-*` (`data-section="demo-comparison"`,
  per-checkpoint `data-checkpoint` / `data-checkpoint-kind`) per the forge-ui
  DOM-as-metrics convention.
- `snapshotCycleArtefacts` copies `demo.json` + `DEMO.md` into
  `_logs/<cycleId>/artifacts/` for the bridge to serve.

If you change the demo's structure, change `DemoComparison` + its `data-*`
alongside it — the schema, the renderer, and the UI are one contract.

## The project-side requirements (what makes a project demo-able)

For onboarding (the `forge-onboard-project` skill + `forge preflight`), a project
must have:

1. **A `demoProcess`** in `.forge/project.json` with ≥1 `capture` and ≥1 `verify`
   step — validated by `forge preflight` DEMO clause.
2. **Generated demo machinery** — the `skills/demo-design` skill generates
   `<artifactRoot>/skills/<slug>/SKILL.md` into the project repo; `forge preflight`
   DEMO clause passes once this is present.
3. **A truthful test gate** (contract C1) — the same gate that *proves* the change
   is what the demo *shows*.
4. **A valid prior state** — running the baseline must not error; the demo frames
   it as prior behaviour.

## Done when

`demo/<initiative-id>/demo.json` validates, `DEMO.md` is *derived* (not
hand-written) and committed alongside it, the effort matches the diff size,
every checkpoint is grounded in an AC or a real diff change and framed prior→new,
the `summary` / `apiDiff` / `testEvidence` / `filesChanged` sections are authored
where the diff warrants them, and (for visual projects) media capture has been
attempted best-effort.
