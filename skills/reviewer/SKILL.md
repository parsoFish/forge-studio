---
name: reviewer
description: Verify the post-developer-loop initiative branch is functional, prepare a demo, open a PR, and shepherd it through human review (including send-back loops).
phase: review-loop
surface: both
model: claude-sonnet-4-6
---

# Reviewer

## Single responsibility

Two stages, both run by this skill:

1. **Review-prep (unattended):** verify the initiative branch is functional. Resolve any errors. Prepare a demo. Open a PR.
2. **Human review (interactive):** the user runs the demo, reviews the PR. On approval, merge. On feedback, dispatch another developer-loop pass and re-review.

## Required first action

Invoke `brain-query` with:

- "What patterns / antipatterns apply to PR descriptions and demo scripts?"
- "Have past reviews of similar initiatives surfaced common gotchas?"
- "What's the project's preferred merge style (merge / squash / rebase)?"

## Inputs

- `_queue/in-flight/<initiative-id>.md` — manifest with all work items marked complete.
- The initiative branch in the project repo.
- `_logs/<cycle-id>/events.jsonl` — to extract notable decisions made during the cycle.

## Outputs

- `<project>/.forge/demos/<initiative-id>.md` (or `.sh`) — demo script.
- A GitHub PR opened via `gh pr create`.
- Manifest moved to `_queue/ready-for-review/`.
- Notification fired (per [ADR 013](../../docs/decisions/013-notifications.md)).
- On approval: `gh pr merge`, manifest moved to `_queue/done/`.
- On send-back: `developer-ralph` invoked for the failing acceptance criteria; manifest stays in `ready-for-review/` until re-approved.

## Event-log entries to emit

- `reviewer.prep-start`
- `reviewer.brain-query`
- `reviewer.demo-emitted`
- `reviewer.pr-opened`
- `reviewer.notify-sent`
- `reviewer.user-verdict` (approved | sent-back)
- `reviewer.send-back-dispatched` (with feedback summary)
- `reviewer.merge-complete`

## Benchmark suite

[`benchmarks/review-loop/`](../../benchmarks/review-loop/) — `prs/` fixtures + `score.ts`.

## Process — review-prep stage (unattended)

1. **Brain query first.**
2. Pull the initiative branch. Run quality gates locally; resolve outstanding issues.
3. Run the demo locally first; if it fails, fix it. Don't ask the human to debug a broken demo.
4. Compose the PR description: why (initiative goal), what (one-line per feature), how (key decisions), demo (link).
5. Compose the demo script: clear steps, expected output, pre-requisites.
6. `gh pr create` against `main`.
7. Move manifest to `_queue/ready-for-review/`. Fire notification.

## Process — human review stage (interactive)

1. User runs `forge review <initiative-id>` (or invokes this skill directly in Claude Code).
2. Skill summarises: what changed, key decisions, demo link.
3. User runs the demo, examines the diff.
4. User verdict: approve or send back.
   - **Approve:** `gh pr merge`, move manifest to `_queue/done/`, trigger `reflector` skill.
   - **Send back:** capture feedback as text. Translate into one or more "fix-up" acceptance criteria. Append to the work-item spec. Dispatch `developer-ralph`. On completion, return to step 1 of this stage.

## Constraints

- **Demo must work first try.** This is the human's first signal of trust.
- **PR description is why-not-what.** The diff shows what.
- **Merge style respects the project.** Don't squash stacked PRs (v1 lesson, will be in brain after Pass B).
- **Send-back feedback becomes new acceptance criteria.** Don't translate to imperative instructions — translate to verifiable criteria, same shape as PM-emitted criteria.
