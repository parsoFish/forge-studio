---
description: Review human moment — engage the open PR for an initiative (own session).
argument-hint: <initiative-id-or-handle> [--note "context"] [--abandon]
---

# /forge-review <initiative-id>

> Human interaction moment — run in YOUR OWN Claude session. Forge never
> auto-supplies a verdict or merges in production (Phase 6 / G9).

## How it works (post-S4 — router-driven)

Forge's review surface is the GitHub PR. The dev-loop unifier authored the
demo + PR description and opened the PR. The operator reviews on GitHub:
leaves comments, requests changes, approves, or merges directly.

Running `/forge-review <id>` invokes the **review-router**
([`orchestrator/review-router.ts`](../../orchestrator/review-router.ts)) — a
non-LLM, deterministic poller that:

1. Resolves `<id>` (canonical `INIT-…` or handle `proj#N`).
2. Fetches new PR comments + reviews via the existing `pr-verdict.ts` `gh
   api` seam since the persisted `_queue/in-flight/<id>.review-cursor.json`
   cursor (atomic `tmp + rename` write per C16b).
3. Applies the C16a decision table to decide: approve / send-back /
   refuse-operator-push / noop.
4. On send-back: writes `_queue/in-flight/<id>.pr-feedback.md` (C3a schema)
   + drops `_queue/triggered/<id>.unifier-feedback.json` marker for the
   daemon to pick up. The dev-loop unifier is reactivated with
   `--feedback-ref <path>`.
5. On approve: surfaces "merge confirmed; closure will sweep" (closure poll
   handles the terminal move).

## Flags

- `--note "<text>"` — appends an `### operator-note` section to
  `pr-feedback.md` ("ignore the nitpicks, focus on the perf comment").
- `--abandon` — moves the manifest to `_queue/failed/` and tears down the
  worktree.

## What you DON'T do here

You don't fix code, write a demo, draft the PR body — that's the unifier's
job (plan 04). You don't paste verdict prose — the router scrapes from
your GitHub comments. You don't pick send-back-vs-approve — the decision
table picks for you. The slash command is a **one-line confirmation** that
the PR's current state should be ingested.

Target: **$ARGUMENTS**
