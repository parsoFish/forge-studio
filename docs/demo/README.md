# Demo — one full forge cycle

This is a real cycle recorded against the operator UI shipped under
[`forge-ui/`](../../forge-ui). The cycle is **cycle 10** of the
`claude-harness` dogfood sequence, completed 2026-05-25.

## What's in the cycle

- **Initiative:** `INIT-2026-05-25-claude-trail-verdict-summary` — add
  `Verdict:` and `Outcome:` lines to the `claude-trail` summary section
  so the operator can see at a glance how a cycle ended.
- **Shape:** one feature → one work item (the proven shape after the
  multi-WI sequencing pitfalls surfaced in cycles 2–9).
- **Acceptance:** `## Summary` includes two new lines; CLI stdout matches
  the updated golden byte-for-byte.

## What you're watching

The video captures the operator UI from the moment the cycle is claimed
through to PR-open. Every load-bearing state is driven by `data-*`
attributes on the DOM (the cwc-workshops pattern) so playwright can
wait on real transitions instead of timing-based sleeps.

`cycle.mp4` (15 MB, 17 min, 1280×1920, h264):

[Watch the cycle](./cycle.mp4)

(GitHub will inline-play the mp4 when you visit this page in the web
UI.)

## Phase-by-phase frames

Each frame is captured the instant the corresponding phase row in the
state machine flips status. The numeric prefix is capture order.

| # | Frame | Moment |
|---|---|---|
| 01 | [initial-load](./frames/01-initial-load.png) | UI booted, no live cycles yet |
| 02 | [cycle-focused](./frames/02-cycle-focused.png) | Cycle claimed; operator clicks into it |
| 03 | [architect-pending](./frames/03-architect-pending.png) | Architect row pending (architect ran out-of-cycle) |
| 04 | [project-manager-active](./frames/04-project-manager-active.png) | PM brain-queries + emits work item |
| 05 | [developer-loop-pending](./frames/05-developer-loop-pending.png) | Dev-loop queued |
| 06 | [review-loop-pending](./frames/06-review-loop-pending.png) | Review-loop queued |
| 07 | [closure-pending](./frames/07-closure-pending.png) | Closure queued |
| 08 | [reflection-pending](./frames/08-reflection-pending.png) | Reflection queued |
| 09 | [project-manager-complete](./frames/09-project-manager-complete.png) | PM done — graph + WI on disk |
| 10 | [developer-loop-failed](./frames/10-developer-loop-failed.png) | **Sharp gate fired (iter-0 must-fail)** — the test file doesn't exist yet, so the gate fails *before* the agent runs. This is the L2 quality-gate check from CLAUDE.md doing its job. The dev-loop then runs as normal. |
| 11 | [review-loop-complete](./frames/11-review-loop-complete.png) | Unifier opened the PR locally |
| 12 | [closure-complete](./frames/12-closure-complete.png) | Manifest moved to `ready-for-review/` |
| 13 | [final-state](./frames/13-final-state.png) | After operator approval — PR merged, manifest in `done/` |

## How it was recorded

[`scripts/verify-cycle.mjs`](../../scripts/verify-cycle.mjs) — the
real-capability harness (ADR 022), which consolidated the old
`record-cycle-ui.mjs` recorder:

```bash
node scripts/verify-cycle.mjs INIT-<your-initiative-id> [--base-sha <sha>] [--cost-ceiling <usd>]
```

Spawns `forge watch --no-open` (UI on 4124, bridge on 4123), opens
playwright with video recording, spawns `forge serve --once` to claim and
run the pending manifest, polls the page's `data-*` attributes for phase
transitions, auto-approves at `ready-for-review`, and saves frames + video.
It also asserts the real-cycle **outcomes** (reached merge, dev-loop N/N,
project tests green, cost under ceiling) and writes a pass/fail
`summary.json`.
