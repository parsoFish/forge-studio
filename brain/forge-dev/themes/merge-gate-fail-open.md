---
title: A gate that catches its own config error and returns ok is not a gate
description: >-
  The merge-boundary gate wraps its project-config load in a try/catch that logs
  merge-gate-skipped and returns { ok: true } — so a malformed project.json makes
  the gate report success. The catch justifies itself with "the branch's own CI
  still backstops the merge", which is the absence-of-red fallacy: no signal is
  not a pass. A gate fails LOUD and parks the cycle needs-operator with the reason.
category: decision
keywords:
  - merge-gate
  - fail-open
  - fail-loud
  - absence-of-red
  - quality-gate
  - project-config
  - needs-operator
  - config-error
  - silent-skip
created_at: 2026-08-28
updated_at: 2026-08-28
related_themes:
  - orchestrator-owned-execution-beats-heuristic-verification
  - derived-never-stored-run-model
  - 2026-07-11-verify-harness-repo-state-traps
---

# A gate that fails open is worse than no gate

`orchestrator/cycle-helpers.ts:562-585` loads the project config to decide which gates to run at the merge boundary. Its `catch` logs `cycle.merge-gate-skipped` and **returns `{ ok: true }`**. So a malformed or unreadable `project.json` — a flat-keys file, a typo, a missing sidecar — does not fail the merge gate. It *passes* it.

Worse than no gate, because a missing gate is visible and a green one is trusted.

## The two errors, both worth naming

**1. Fail-open on the gate's own configuration error.** The code is asymmetric and says so: "A malformed project.json is fail-closed where it's loaded for real (the dev-loop); here we log-and-skip so a config-read hiccup can't wedge the gate." Not wedging the pipeline is a real concern — but the answer to "this error should not wedge us" is **park needs-operator with the reason**, never *report success*. The operator can clear a park in a minute; they cannot clear a merge that already happened.

**2. "Backstopped by CI" is the absence-of-red fallacy.** The catch justifies itself with "the branch's own CI still backstops the merge". That is only true if CI actually ran and actually reported. A gate that reports no checks is not a green gate — `gh pr checks --watch` exits 0 on "no checks reported", and six PRs merged onto red main behind exactly that reasoning. **Never merge on absence of red; merge on presence of green.**

## The rule

- A gate returns three things, not two: **pass**, **fail**, and **could not evaluate**. The third parks the cycle `needs-operator` and names the config error. It never collapses into pass.
- A gate's own error is a **loud** failure. The class-selected merge-boundary gate must fail loud on a config error (spec §5.4).
- If two call sites load the same config with opposite failure behaviour, that asymmetry is the defect — not a tuning choice.

## Sources

- `orchestrator/cycle-helpers.ts:562-585` — the `catch` that logs `cycle.merge-gate-skipped` and returns `{ ok: true }`.
- `docs/superpowers/specs/2026-08-28-forge-1-0-blueprint-design.md` §5.4 — "class-selected merge-boundary gate that **fails loud** on a config error".
- `docs/roadmaps/1.0.md` §4 M0 Lane A task (2) — the red-first test: a flat-key `project.json` must park the cycle needs-operator, never `ok:true`.

## See also

- [[orchestrator-owned-execution-beats-heuristic-verification]] — why the gate belongs in the orchestrator at all.
- [[agent-authored-gates-are-self-grading]] — the other way a gate stops measuring anything.
