---
title: Unifier correctly recovers non-fast-forward branch-push-failed from dev-loop
description: When ralph emits dev-loop.branch-push-failed (remote branch ahead), the unifier is invoked as the recovery mechanism, rebases the branch, and pushes successfully in 1 iteration — the designed recovery path works.
category: pattern
created_at: '2026-06-07'
updated_at: '2026-06-07'
---

# Unifier non-fast-forward recovery — designed path confirmed

## Observation

Compact-flag cycle: ralph completed (gate.pass, iter=1) and immediately emitted `dev-loop.branch-push-failed`:

```
To https://github.com/parsoFish/claude-harness.git
 ! [rejected] forge/INIT-2026-05-30-claude-trail-compact-flag (non-fast-forward)
hint: use 'git pull' before pushing again.
```

The orchestrator invoked the unifier. The unifier read the branch state, ran `npm test` (all green), authored demo artefacts, committed, and pushed via `git add -f` + force-push. `unifier.branch-pushed` fired. `dev-loop.delivered` followed with `files=9`.

## Trigger condition

Remote branch was ahead of the worktree because a previous push (from an earlier aborted cycle) had landed partial commits. The worktree's local commits were not in the remote's ancestry, making the push non-fast-forward.

## Cost implication

Unifier cost $1.00 ≈ ralph cost $1.03. This parity is a warning signal: when the unifier's integration task is trivial (no merge conflicts, gate already green) but cost equals the dev-loop, the overhead is demo artifact authoring. Demo work is legitimate but should not dominate a recovery-path invocation.

## Sources

- `_logs/2026-06-07T22-31-02_INIT-2026-05-30-claude-trail-compact-flag/events.jsonl` — `dev-loop.branch-push-failed`, `unifier.branch-pushed`, `dev-loop.delivered`
- `brain/cycles/_raw/2026-06-07T22-31-02_INIT-2026-05-30-claude-trail-compact-flag.md`
