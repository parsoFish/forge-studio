---
description: Review human moment — engage the open PR for an initiative (own session).
argument-hint: <initiative-id>
---

# /forge-review &lt;initiative-id&gt;

> **This is a human interaction moment, run in YOUR OWN Claude session.**
> Forge NEVER auto-supplies a verdict or merges in production. The review
> phase produced a demo-embedded PR and STOPPED (Phase 6 / G9). The
> GitHub PR is the operator's merge + feedback surface. Design of record:
> `brain/forge/themes/human-interaction-via-own-session.md` +
> `brain/forge/themes/review-phase-target-design.md`; US-3.1 / US-3.2 in
> `docs/forge-user-stories.md`.

## Single purpose

Let the operator engage the open PR for initiative `<initiative-id>`:
inspect the demo-embedded PR, then EITHER give feedback for the review
agent to process on its next round, OR record that they merged it in
GitHub (closure then aligns local↔remote).

## Reads

- The initiative's verdict prompt + artefacts:
  - `_queue/in-flight/<initiative-id>.verdict-prompt.md` (round, paths).
  - `<worktree>/.forge/pr-description.md` (the demo-embedded PR draft).
  - `<worktree>/.forge/demos/<initiative-id>/` (the demo bundle).
- The GitHub PR itself (`gh pr view` / the PR page) and the initiative
  branch.

## Writes (file handoff) — choose ONE

- **Send feedback (another review round):** write
  `_queue/in-flight/<initiative-id>.verdict-response.md` with
  `verdict: send-back`, a rationale, and `- GIVEN … WHEN … THEN …`
  acceptance criteria. The review-Ralph reads these from `fix_plan.md`
  next iteration. (Send-back cap: 2 rounds.) Format contract:
  `orchestrator/file-verdict.ts` (`parseVerdictResponse`).
- **Approve (review gate only — does NOT merge):** write the same file
  with `verdict: approve` + rationale. Per Phase 6 an approve verdict
  does **not** merge anything; it only releases the review gate.
- **You merged it in GitHub:** record nothing here — just merge the PR
  on GitHub. Closure confirms via `gh pr view --json state == MERGED`
  (`orchestrator/pr.ts:confirmPrMerged`), then aligns local↔remote
  (ff `main`, prune the initiative branch) and moves the manifest
  `in-flight/ → done/`. Reflection fires only on that confirmed merge.

## How to run it

1. Read `_queue/in-flight/<initiative-id>.verdict-prompt.md` to locate
   the PR draft, demo bundle, and worktree.
2. Inspect the demo-embedded PR and the diff against `main`.
3. Decide: merge on GitHub, or write a `send-back` / `approve`
   verdict-response file. Do not run a cycle and do not merge from here
   programmatically — the operator merges in GitHub.

Initiative: **$ARGUMENTS**
