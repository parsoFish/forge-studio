---
title: Stale .forge/last-gate-failure.md in dev-loop causes ralph to declare work done on real failures
description: Ralph reads the stale gate-failure file, concludes the gate is a fossil, runs local pytest and sees a pass, and declares the WI complete — while the orchestrator's gate keeps failing for a real code reason.
category: antipattern
keywords: [last-gate-failure, stale-artifact, ralph, dev-loop, gate-fail, local-vs-gate, plan-engine, wasted-iterations]
created_at: 2026-10-12T00:00:00Z
updated_at: 2026-10-12T00:00:00Z
related_themes: [2026-07-04-stale-last-gate-failure-poisons-unifier]
---

## What happened

In WI-6 of the gitweave I2 initiative, ralph read `.forge/last-gate-failure.md` on every iteration, concluded it was stale from a prior state, ran `python3 -m pytest tests/test_plan.py` locally and saw other tests pass, and declared the WI done. The orchestrator's gate kept returning `gate.fail` (exit code 1) with the same real failure: `KeyError: ('team', 'ghost-team')` — a missing `delete` branch in `gitweave/plan.py`.

This repeated **8 times** across two dev-loop runs:
- Run 1: 5 iterations → WI-6 discarded (2 files, 281 insertions wasted)
- Run 2: 3 more iterations → finally fixed on iteration 8 after a close read of gate stdout

Reasoning logs from run 1 iterations 2–5 all say variants of:
> "All 6 tests pass. WI-6 complete. Gate failure file is stale from prior iteration."

But the gate's own `gate_stdout_tail` showed `2 failed` consistently.

## Why this diverges

Ralph ran `python3 -m pytest tests/test_plan.py` from **its local working directory** and saw results that differed from the orchestrator's gate runner. Root cause candidates: installed vs. source package discrepancy, test isolation, or the agent running against a different module path. The agent trusted its local run over the gate's explicit stdout output — the opposite of the right priority.

## Rule

**Gate stdout is authoritative; local test output is not.** When gate.fail repeats after a "stale file" diagnosis, the right response is: read the current `gate_stdout_tail` in the gate event, not `.forge/last-gate-failure.md`. If the gate's own output shows failures, the gate is failing now — fix the code.

**Three-point forge fix prescription (operator, 2026-10-12):**
1. Ralph must cite the gate's own stdout before calling a WI done OR labelling a failure "stale."
2. When `gate.fail` repeats after a "stale" diagnosis, forge must surface the prior iteration's gate stdout diff so ralph cannot re-claim stale.
3. Project profile must embed an explicit AC for every state-diff engine covering all branches (create / unchanged / delete) — so PM propagates it into WI specs.

## Related

Prior instance of the stale gate failure pattern in the **unifier**: `2026-07-04-stale-last-gate-failure-poisons-unifier`. That instance poisoned unifier orientation; this instance poisoned ralph's completion judgement in the dev-loop. Same artifact, different phase.

## See also

- [[2026-07-04-stale-last-gate-failure-poisons-unifier]] — same pattern in the unifier phase

## Sources

- `_logs/2026-10-11T02-16-05_INIT-2026-10-11-i2-apply-engine-terraform-retired/events.jsonl` (WI-6 gate.fail at 08:41, 08:41:35, 08:42:56, 08:43:59, 08:44:00, 09:44:18, 09:45:43, 09:46:44)
- `brain/cycles/_raw/2026-10-11T02-16-05_INIT-2026-10-11-i2-apply-engine-terraform-retired.md`
