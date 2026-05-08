---
source_type: docs
source_url: docs/phases/review-loop.md
source_title: Forge v2 — Phase: Review Loop
ingested_at: 2026-05-04T17:55:00Z
ingested_by: brain-ingest (Pass A, batch 3)
cycle_id: pass-a-bootstrap
---

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

- A GitHub PR opened via `gh pr create` against project's `main` branch.
- Demo script in `<project>/.forge/demos/<initiative-id>.md` (or shell script if interactive).
- Manifest moves to `_queue/ready-for-review/`.
- Notification fires.
- After human approval: PR merged via `gh pr merge`, manifest moves to `_queue/done/`.
- After send-back: manifest stays in `ready-for-review/`, agent picks up feedback, runs another developer-loop pass, returns for re-review.

## Success signals

- **Demo runs first try:** user runs demo script and it works without intervention.
- **First-pass approval rate:** ≥70% of initiatives approved on first human review.
- **Send-back resolution iterations:** when sent back, ≤2 further developer-loop passes resolve.
- **PR description quality:** PR explains why (initiative goal, key decisions), not just what.

## Known failure modes

- **Demo doesn't actually work** — pre-review checklist must include running demo script in worktree.
- **PR description is what-not-why** — explicit prompt rule + benchmark check.
- **Squash-merge stacked PRs** — explicitly forbidden (v1 lesson). Use layered merge order.
