# ADR 021 — Local in-UI review + a unified structured demo

- **Status:** accepted
- **Date:** 2026-05-30
- **Supersedes / amends:** amends the "PR-as-feedback-surface" position of the
  brain decision themes [`review-phase-target-design`](../../brain/forge-dev/themes/review-phase-target-design.md)
  and the review row of [`human-interaction-via-own-session`](../../brain/forge-dev/themes/human-interaction-via-own-session.md);
  builds on [ADR 020](./020-architect-in-ui.md) (the in-UI architect + dedicated
  screens) and the existing demo model (`cli/demo-model.ts:DemoModel`).
- **Update 2026-06-20 (F4 / DEC-4):** the demo OUTPUT is consolidated to a
  **single** PR-facing `DEMO.md` plus the `demo.json` sidecar the UI renders.
  The parallel self-contained `DEMO.html` renderer (`cli/demo-html.ts`) is
  **retired**; the shared schema types moved to `cli/demo-types.ts`. References
  to `DEMO.html` below are historical.
- **Update 2026-06-14 ([ADR 031](./031-studio-consolidation.md)):** the dedicated
  `/review/[cycleId]` + `/reflect/[cycleId]` screens fully fold into the unified
  Studio `/artifact` viewer (the wrappers redirect; Studio "Open gate →" links
  repoint to `/artifact?…&mode=review`). The verdict/demo model + bridge
  `POST /api/verdict` are unchanged.

## Context

ADR 020 moved the architect into the forge UI and added a standalone review
screen. Two problems surfaced:

1. **The review screen had no demo to show.** The bridge serves artifacts from
   `_logs/<cycleId>/artifacts/`, but nothing populated that dir — the cycle's
   `snapshotCycleArtefacts` copied from a stale `.forge/demos/` path and never
   mirrored `PLAN.html`/`DEMO`. So review had to send the operator to the PR.
2. **Demo quality is inconsistent.** The unifier free-forms `DEMO.md` per
   `demo.shape` with no structural contract, so the artifact varies cycle to
   cycle. A rich *structured* model (`DemoComparisonModel` + `renderComparisonHtml`)
   already exists, but only the standalone `forge demo` CLI ever produced it.

The `review-phase-target-design` theme made **the GitHub PR the human
feedback/merge surface** ("PR-as-feedback-surface, user-triggered"). With the
in-UI architect now proving out local human moments on dedicated screens, the
operator chose to bring review local too, to tighten and simplify iteration.

## Decision

**1. Review happens locally in the forge UI.** The operator's review
*interaction* (read the demo, approve / send-back) happens on the dedicated
review screen (`/review/[cycleId]`), not by engaging the GitHub PR.

- **Preserved intent:** the PR is **still created** by the review phase and
  **merged by the in-UI approve** (`POST /api/verdict 'approve'` calls
  `mergePullRequest` + fires `finalizeMergedReadyForReview`; see ADR-021 update
  below); there is **still no auto-approve** — the operator's explicit verdict
  gates the merge. What changes is *where the operator reviews* (local UI, not
  the PR thread) and that the approve IS the merge gate — the operator never
  needs to leave the forge UI to merge on GitHub.

**2. The demo author is unified around one structured artifact.** The unifier
produces a single schema-validated **`demo.json`** (an authorable subset of
`DemoComparisonModel`: `title`, `essence`, `checkpoints[]` with before/after
notes + optional metrics/media, `diffStat`, `acceptanceCriteria`). The review
screen renders it natively in React — so **the screen + schema are the template**
the unifier fills. forge **derives** `DEMO.md` (+ `DEMO.html`) from the same
JSON, so the unifier authors once and the PR stays self-contained.

- The `pr_self_contained` demo check shifts from "`DEMO.md` exists" to
  "`demo.json` exists and validates" (`demo_structured`). DEMO.md is derived,
  not hand-written — the structural contract is what fixes the inconsistency.

**3. Media is an optional, explicitly-triggered skill.** Before/after
screenshots/video are NOT required every cycle. A dedicated **demo-capture
skill** (wrapping the existing two-worktree + Playwright `generateComparisonDemo`)
is invoked by the unifier **only when relevant** (visual `demo.shape`) to
back-fill checkpoint media into `demo.json`. Absent it, checkpoints are
notes-only and still valid. Best-effort — never blocks the gate.

**4. Artifacts are mirrored for the UI.** `snapshotCycleArtefacts` copies
`demo.json` + derived `DEMO.html` (+ any media) and the architect `PLAN.html`
into `_logs/<cycleId>/artifacts/`, so the bridge can serve them to the review
screen (and the `/plan` `/demo` routes).

## Consequences

- **Tighter iteration.** The operator reviews the structured demo + approves in
  one local screen, mirroring the architect plan screen — no context switch to
  GitHub mid-loop.
- **Consistent demos.** A validated schema is a hard contract; the renderer is
  shared, so every cycle's demo has the same shape and the review screen always
  has something rich to show.
- **Author once.** The unifier writes `demo.json`; DEMO.md/DEMO.html are
  derived deterministically (no drift between the PR artifact and the UI view).
- **Bounded risk to the cycle.** `demo_structured` validates the same
  information the unifier already had to produce; DEMO.md stays available
  (derived) for the PR; the gate change is verified against a real cycle before
  being relied on.
- **UI approve IS the merge.** The in-UI approve (`POST /api/verdict 'approve'`)
  calls `mergePullRequest(worktreePath)` (from `orchestrator/pr.ts`) then fires
  `finalizeMergedReadyForReview` immediately — the operator's approve click
  performs the merge without leaving the UI. The "no-auto-approve" invariant
  is preserved: the operator must still click approve; only the *mechanism*
  changed (forge calls `gh pr merge` rather than the operator doing it manually
  on GitHub). This supersedes the G9 policy ("forge never auto-merges") which was
  inconsistent with the sole-operator-surface principle ("operator never leaves
  the forge UI", now [ADR 031](./031-studio-consolidation.md)). `forge review
  --approve` (CLI fallback) was updated in the same pass to also call
  `mergePullRequest` so the remote PR is closed there too.

## Alternatives considered

- **Unifier renders `comparison.html`; review screen iframes it.** Rejected: the
  screen would be a passive viewer, not a template — it wouldn't constrain the
  unifier's structure (the actual cause of inconsistency), and a meaningful
  comparison would force the heavy screenshot capture every cycle.
- **Keep review on the PR (status quo).** Rejected by the operator for now:
  leaves the loop split between the local UI and GitHub and keeps the
  inconsistent free-form demo.
- **Require captured media every cycle.** Rejected: heavy + the current source
  of flakiness; made optional via the explicitly-triggered capture skill.
