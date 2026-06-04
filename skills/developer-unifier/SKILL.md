---
name: developer-unifier
description: Treat the initiative as one PR. Prove every acceptance criterion against branch tip. Author the demo. Author the PR body. Refactor incidentally if it unifies the change. NEVER add scope beyond what the work-item ACs require.
allowed-tools: [Read, Write, Edit, MultiEdit, Bash, Grep, Glob]
disallowed-tools: [NotebookEdit, WebFetch, WebSearch]
---

# developer-unifier skill

> Final Ralph in the dev-loop. Runs once per initiative on the same worktree
> the per-WI Ralphs used. Owns the PR-as-sole-review-window invariant:
> tracked demo + PR description + branches-in-sync.

## Mission (initial-prep mode)

Once all per-WI Ralphs have run, you take the **whole initiative branch**
and prove it cohesive:

1. **Read** the initiative manifest (`.forge/manifest.md` or
   `.forge/manifest.yml`) for the cross-WI acceptance criteria; read each
   WI under `.forge/work-items/` (their `acceptance_criteria` arrays are
   the unifier's checklist).
2. **Run** the project's `quality_gate_cmd` (from PROMPT.md) against the
   tree as it stands. If it's red, fix what's needed — within the existing
   `files_in_scope` of any WI in the initiative. Do NOT add new files
   outside the union of all WIs' `files_in_scope`.
3. **Author the structured demo** at `demo/<initiative-id>/demo.json` (ADR 021):
   - This directory must be **tracked** (committed on the branch). The
     unifier is the only sub-phase that writes to a tracked path.
   - `demo.json` is the **single source of truth** and the contract — it is
     schema-validated by the `pr_self_contained` gate (`validateDemoModel`).
     Required core: `title`, `essence`, `project`, `diffStat`, and ≥1
     `checkpoints[]` entry (`label` + `caption`, plus `beforeNote`/`afterNote`
     describing before-vs-after **behaviour**, never "what is broken").
   - Run `forge demo render <initiative-id>` to derive `DEMO.md` + `DEMO.html`
     from `demo.json`, then commit all three. **Never hand-write DEMO.md** — it
     is derived, so the PR artifact and the in-UI review render never drift.
   - **Check for a `demo.skill` in `.forge/project.json`** before authoring
     demo.json. If the field is present, `Read` that skill file — it specifies
     the project-specific evidence hierarchy (e.g. betterado's `ado-demo` skill:
     `terraform apply` → API GET → portal screenshot → `terraform destroy`). For
     a new or changed resource, **attempt the live-capability evidence first** —
     a real created resource is the best demonstration. Fall back to harness-only
     if credentials are absent, and document the fallback in the demo `essence`.
   - The project's `demo.shape` in `.forge/project.json` decides HOW you fill
     the checkpoints (not a different file format):
     - **browser** — fill checkpoints + invoke the media-capture skill
       (`forge demo capture <initiative-id>`) to back-fill before/after images.
     - **harness** — a `kind: 'harness'` checkpoint carrying `metrics[]`
       (before/after + parity), scraped from the project's measurement command.
       Parity vocabulary: `match | within | diverged | incomplete`. Author a
       `testEvidence[]` table. Do **NOT** author "Visual Changes"/screenshots —
       there is no UI. For new-capability initiatives also author `usage_example`
       (fenced HCL/CLI/API block) and `impact` (string[] bullets).
     - **cli-diff** / **artifact** — before/after notes (no media required).
     - **none** — a single rationale checkpoint (caption + afterNote).
4. **Write the PR body** at `.forge/pr-description.md`:
   - Sections: `## Why` (non-empty), `## What`, `## How`.
   - **Do NOT add a `## Demo` section.** The orchestrator appends the canonical
     demo block automatically when it opens the PR. A hand-authored `## Demo`
     heading will be stripped.
   - Anchor on `git diff --name-only main...HEAD` — list ONLY files that
     ACTUALLY appear in the diff. Do NOT claim a file, test, or doc as added
     unless it appears in `git diff --stat main...HEAD`. Substance, not
     boilerplate; describe what actually landed, not what was planned.
5. **Commit** everything as `feat(<initiative-id>): unify and demo`. If no
   changes are needed (no fixes, demo already exists, PR body present),
   skip the commit — the gates run against the per-WI tip in that case.
6. **Push** the branch so `origin/<branch>` == local HEAD before the
   review phase opens the PR.

## Mission (send-back mode, `--feedback-ref` set)

This is a re-entrant invocation triggered by the review router after the
operator left comments on the open PR.

1. **Read `<feedback-ref>`** — a markdown file at
   `_queue/in-flight/<initiative-id>.pr-feedback.md` (C3a schema). It
   contains line-level and PR-level review comments addressed to specific
   files / lines.
2. **Address each comment** by editing the indicated file/line. If a
   comment is a request for clarification rather than a code change,
   update the PR body or add a `## Notes` section explaining.
3. **Re-run** the quality gate; refresh the demo if the change is
   user-visible.
4. **Commit** as `fix(<initiative-id>): address review round <N>` and
   push.
5. **Post an ack comment** on the PR via `gh pr comment`:
   `<!-- forge:verdict-ack --> addressed: <brief summary>`. The operator
   sees the ack on the PR and re-reviews.

Do NOT exceed the iteration cap. Do NOT add scope beyond what the
comments request — if a comment surfaces a problem outside the
initiative's WIs, flag it in `AGENT.md` for the reflector to capture as
a future initiative.

## Hard rules

- **Scope discipline.** Files you may modify are the union of all WIs'
  `files_in_scope` plus the tracked demo path
  (`demo/<initiative-id>/**`) plus `.forge/pr-description.md`. Anything
  else is a violation; flag it in `AGENT.md` for the reflector.
- **No `gh pr create`, no `gh pr merge`.** The review phase opens the PR
  from your output. The operator merges in GitHub.
- **No queue mutation.** `_queue/` is read-only for you (except in
  send-back mode, where the router has already written `pr-feedback.md`
  — you read it, you don't write it).
- **No web tools.** `WebFetch` and `WebSearch` are disabled.
- **No shortcuts.** Don't skip tests, don't `--no-verify`, don't disable
  lint rules to pass.
- **No hallucinated test passes.** If you claim tests pass, prove it by
  running them via `Bash`. The orchestrator re-runs them and exits
  `failed` if your claim was wrong.

## Outputs (per iteration)

Always:
- `<worktree>/demo/<initiative-id>/demo.json` (tracked) — the structured
  source; `DEMO.md` + `DEMO.html` are derived from it via `forge demo render`.
- `<worktree>/.forge/pr-description.md` (gitignored under `.forge/`, but
  read by the review phase for `gh pr create --body-file`).
- One conventional-commits commit on the initiative branch (if any
  changes were made).
- `AGENT.md` updated with what was tried this iteration.

Composed gates checked by the orchestrator after each iteration:
- `initiative_gate` — project quality-gate against branch tip.
- `demo_runs_clean` — `demo.command` (per `.forge/project.json`) exits 0;
  excused when `demo.shape: "none"`.
- `pr_self_contained` — `demo/<initiative-id>/demo.json` exists + validates
  (ADR 021), `.forge/pr-description.md` has substantive Why/What/How/Demo sections.
- `branches_in_sync` — `origin/<branch>` == local HEAD; `main` ==
  merge-base.

The orchestrator decides when to stop. There is a runaway-bound on
iteration count (CONTRACTS.md C19 — no $ cap), but treat it as a
backstop, not a target.
