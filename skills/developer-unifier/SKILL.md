---
name: developer-unifier
description: Treat the initiative as one PR. Prove every acceptance criterion against branch tip. Author the demo. Author the PR body. Refactor incidentally if it unifies the change. NEVER add scope beyond what the work-item ACs require.
allowed-tools: [Read, Write, Edit, MultiEdit, Bash, Grep, Glob]
disallowed-tools: [NotebookEdit, WebFetch, WebSearch]
---

# developer-unifier skill

> Final Ralph in the dev-loop. Runs once per initiative on the same worktree the per-WI Ralphs used. Owns the PR-as-sole-review-window invariant: tracked demo + PR description + branches-in-sync.

## Mission (initial-prep mode)

Once all per-WI Ralphs have run, take the **whole initiative branch** and prove it cohesive:

1. **Read** the initiative manifest (`.forge/manifest.md` or `.forge/manifest.yml`) for cross-WI ACs; read each WI under `.forge/work-items/` (their `acceptance_criteria` arrays are your checklist).
2. **Run** the project's `quality_gate_cmd` (from PROMPT.md). If red, fix within the union of all WIs' `files_in_scope`. Do NOT add new files outside that union.
3. **Author the structured demo** at `demo/<initiative-id>/demo.json` (ADR 021):
   - This directory must be **tracked** (committed on the branch). The unifier is the only sub-phase that writes to a tracked path.
   - `demo.json` is the **single source of truth** — schema-validated by the `pr_self_contained` gate (`validateDemoModel`). Required core: `title`, `essence`, `project`, `diffStat`, and ≥1 `checkpoints[]` entry (`label` + `caption`, plus `beforeNote`/`afterNote` describing before-vs-after **behaviour**, never "what is broken").
   - Run `forge demo render <initiative-id>` to derive `DEMO.md` + `DEMO.html` from `demo.json`, then commit all three. **Never hand-write DEMO.md** — derived, so PR artifact and in-UI render never drift.
   - **Check for a `demo.skill` in `.forge/project.json`** before authoring `demo.json`. If present, `Read` that skill file — it specifies the project-specific evidence hierarchy (e.g. betterado's `ado-demo` skill: `terraform apply` → API GET → portal screenshot → `terraform destroy`). For new/changed resources, **attempt live-capability evidence first**; fall back to harness-only if credentials absent, documenting the fallback in `essence`.
   - The project's `demo.shape` in `.forge/project.json` decides HOW you fill checkpoints:
     - **browser** — fill checkpoints + invoke `forge demo capture <initiative-id>` for before/after images.
     - **harness** — `kind: 'harness'` checkpoint with `metrics[]` (before/after + parity). Parity vocabulary: `match | within | diverged | incomplete`. Author `testEvidence[]` table. Do NOT author screenshots — no UI. For new-capability initiatives, also author `usage_example` (fenced HCL/CLI/API block) and `impact` (string[] bullets).
     - **cli-diff** / **artifact** — before/after notes (no media required).
     - **none** — single rationale checkpoint (caption + afterNote).
4. **Write the PR body** at `.forge/pr-description.md`:
   - Sections: `## Why` (non-empty), `## What`, `## How`.
   - **Do NOT add a `## Demo` section.** The orchestrator appends the canonical demo block at PR-open. A hand-authored `## Demo` heading will be stripped.
   - Anchor on `git diff --name-only main...HEAD` — list ONLY files that ACTUALLY appear in the diff.
5. **Commit** as `feat(<initiative-id>): unify and demo`. Skip commit if no changes (demo exists, PR body present) — gates run against per-WI tip.
6. **Push** so `origin/<branch>` == local HEAD before the review phase opens the PR.

## Review work-items (ADR 026)

The unifier owns its OWN work-item queue at `.forge/unifier-items/UWI-<n>.md`
(same `WorkItem` shape as `.forge/work-items/`). You run them ONE at a time,
in dependency order. `UWI-1` is the static "unify & prep the PR" mission above.
When the operator reviews the open PR and **adds work items**, each concern is
appended as a `UWI-2+` and the cycle drains them **in place** — same branch,
same PR, same cycle (no requeue, no send-back to a dev phase). The brief you
read in `PROMPT.md` is for the ONE UWI you are running now; address only that.

A UWI carries a `kind`:

- **`packaging`** (UWI-1, the terminal re-prep, demo/doc tweaks) — the mission
  above: unify, author the demo + PR body, prove the composed unifier gate. Do
  NOT re-implement code.
- **`code-fix`** (a review concern that needs real code) — you run with the
  **dev role**: write a FAILING test that encodes the UWI's acceptance criteria
  first, then the minimal code to make it pass; keep the rest of the suite
  green. A terminal `packaging` re-prep UWI re-authors the demo/PR after you.

## Hard rules

- **Scope discipline.** Files you may modify: union of all WIs' `files_in_scope` + `demo/<initiative-id>/**` + `.forge/pr-description.md`. Anything else is a violation; flag in `AGENT.md`.
- **No `gh pr create`, no `gh pr merge`.** The review phase opens the PR from your output.
- **No queue mutation.** `_queue/` is read-only. The orchestrator writes UWIs to `.forge/unifier-items/` and tracks their status; you only run the one in `PROMPT.md`.
- **No web tools.** `WebFetch` and `WebSearch` are disabled.
- **No shortcuts.** Don't skip tests, don't `--no-verify`, don't disable lint rules.
- **No hallucinated test passes.** If you claim tests pass, prove it via `Bash`. The orchestrator re-runs them and exits `failed` if wrong.

## Outputs (per iteration)

- `<worktree>/demo/<initiative-id>/demo.json` (tracked) — structured source; `DEMO.md` + `DEMO.html` derived via `forge demo render`.
- `<worktree>/.forge/pr-description.md` — read by review phase for `gh pr create --body-file`.
- One conventional-commits commit on the initiative branch (if changes were made).
- `AGENT.md` updated with what was tried this iteration.

Composed gates checked by the orchestrator after each iteration:
- `initiative_gate` — project quality-gate against branch tip.
- `demo_runs_clean` — `demo.command` exits 0; excused when `demo.shape: "none"`.
- `pr_self_contained` — `demo/<initiative-id>/demo.json` exists + validates (ADR 021); `.forge/pr-description.md` has substantive `## Why` / `## What` / `## How` sections (NO `## Demo`).
- `branches_in_sync` — `origin/<branch>` == local HEAD; `main` == merge-base.
- `incomplete_delivery` — every WI's declared `creates[]` paths appear in the branch diff.

All gates must pass for a `packaging` UWI to exit clean (a `code-fix` UWI exits on its own sharp gate instead). Runaway-bound on iterations (no $ cap per C19) — treat as a backstop, not a target.

---

# Ralph loop discipline (unifier sub-phase)

You are inside a **Ralph loop** on the initiative branch AFTER all per-WI Ralphs have completed. Each call is **one iteration**. Loop state via three worktree files read at iteration start:

- **`PROMPT.md`** — per-iteration brief (initiative ID, manifest path, demo shape, iteration counter) for the ONE UWI you are running now.
- **`AGENT.md`** — institutional memory. Read first, update last.
- **`fix_plan.md`** — checklist of initiative-level ACs. Tick items as you prove each against branch tip.

After your work, **commit** as `feat(<initiative-id>): unify and demo` (a `packaging` UWI) or `fix(<initiative-id>): <concern>` (a `code-fix` UWI). Use `Bash` for `git`, quality gate, demo runner.

**The orchestrator decides when to stop.** It runs the composed gates between iterations (listed in Outputs above).

## Write the demo + PR description first (draft within 2 tool calls)

**Iteration 1, tool call #1 or #2: `Write` a SKELETON of `demo/<initiative-id>/demo.json` AND `.forge/pr-description.md`.** A minimal valid demo.json is fine. Placeholder prose is fine. The point is to have something on disk for the gate; refine in subsequent iterations (then re-run `forge demo render`).

Minimal valid iter-1 skeleton:

```json
{
  "title": "<one-line essence>",
  "essence": "<what behaviour changed and why it matters>",
  "project": "<project name from the manifest>",
  "initiativeId": "<initiative-id>",
  "diffStat": "<git diff --stat main...HEAD>",
  "checkpoints": [
    { "label": "main", "caption": "<what this demonstrates>",
      "beforeNote": "<prior behaviour>", "afterNote": "<new behaviour>" }
  ]
}
```

and

```
## Why
<placeholder, fills in iter 2+>
## What
<placeholder>
## How
<placeholder>
```

Then `Bash git add . && git commit -m "wip: unifier skeleton"` and continue in iter 2+. **DO NOT spend iteration 1 reading files. The skeleton goes in FIRST.** This is the consistent failure mode (observed 5+ cycles): 10+ iters of `ls` + `git log` + `cat` with zero writes, terminal-fail at iteration-budget.

Your role is **integrate, not develop**. Every per-WI dev-loop has ALREADY COMPLETED — code written, tests run, committed. Verify with `git log --oneline main...HEAD`. Your job:
1. Confirm the initiative was met (run the gate to verify per-WI commits still pass together).
2. Author the structured demo at `demo/<initiative-id>/demo.json`, then run `forge demo render <initiative-id>`.
3. Write the PR description at `.forge/pr-description.md` (substantive `## Why` / `## What` / `## How`; do NOT add `## Demo`).
4. Commit + push.

If you find yourself reading WI specs to "figure out what to implement", STOP — that work is done. Read them only to understand SCOPE so your demo + description cover it.

Hard rules (same as Mission above):
- **Scope discipline.** Files: union of all WIs' `files_in_scope` + `demo/<initiative-id>/**` + `.forge/pr-description.md`. Violations go in `AGENT.md`.
- **No `gh pr create`, no `gh pr merge`.**
- **No queue mutation.**
- **No shortcuts.** No `--no-verify`, no disabled lint rules.
- **No hallucinated test passes.** Prove it via `Bash`.
