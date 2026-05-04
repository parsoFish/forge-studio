# Phase: Review Loop

> *Human-in-the-loop.* Closes out an initiative back to main with a working demo and human approval.

## Purpose

Two stages:
1. **Review-prep (unattended)** — agent verifies the post-developer-loop initiative branch is functional, fixes any outstanding issues, prepares a demo script.
2. **Human review (interactive)** — user runs the demo, reviews the PR, either approves (merge to main) or sends back (triggers further agentic loops).

## Inputs

- `_queue/in-flight/<initiative-id>.md` (manifest with all work items marked complete).
- The initiative branch in the project repo.
- Brain knowledge (lessons on demos, common review pitfalls).

## Outputs

- A GitHub PR opened via `gh pr create` against the project's `main` branch.
- A demo script in `<project>/.forge/demos/<initiative-id>.md` (or shell script if interactive).
- The manifest moves to `_queue/ready-for-review/`.
- Notification fires (see [ADR 013](../decisions/013-notifications.md)).
- After human approval: PR merged via `gh pr merge`, manifest moves to `_queue/done/`.
- After human send-back: manifest stays in `ready-for-review/`, agent picks up the feedback, runs another developer-loop pass, returns for re-review.

## Skills

- [`skills/reviewer/SKILL.md`](../../skills/reviewer/SKILL.md) — review-prep + human-facing reviewer skill.

## Success signals

- **Demo runs first try:** the user runs the demo script and it works without intervention.
- **First-pass approval rate:** ≥70% of initiatives are approved on first human review.
- **Send-back resolution iterations:** when sent back, ≤2 further developer-loop passes resolve.
- **PR description quality:** PR explains the why (initiative goal, key decisions), not just the what.

## Benchmark suite

[`benchmarks/review-loop/`](../../benchmarks/review-loop/)
- `prs/` — initiative branch fixtures → expected demo + verdict.
- `score.ts` — invokes the reviewer skill, scores demo-correctness and PR-description quality.

## Known failure modes (to defend against)

- **Demo doesn't actually work** — pre-review checklist must include running the demo script in the worktree.
- **PR description is what-not-why** — explicit prompt rule + benchmark check.
- **Squash-merge stacked PRs** — explicitly forbidden (v1 lesson, will be in brain after Pass B). Use layered merge order.

## TODO (post-scaffold)

- [ ] Decide demo-script format (markdown checklist vs executable shell vs both).
- [ ] Implement the agentic send-back loop (feedback → developer-loop pass → re-review).
- [ ] Populate `benchmarks/review-loop/prs/`.
