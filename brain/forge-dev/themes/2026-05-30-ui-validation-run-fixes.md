---
title: 'First real end-to-end UI cycle (W5) — seven defects the validation surfaced + fixed'
description: >-
  The 2026-05-30 claude-harness validation run was the FIRST time the
  consolidated UI-driven pipeline (architect → PM → dev-loop → review → closure)
  ran end-to-end against the real SDK with real operator judgment. Unit tests
  inject fake queryFns and the e2e harness runs FORGE_ARCHITECT_NO_SPAWN=1, so
  several live paths had never executed. It surfaced seven defects; six were
  fixed and the cycle reached a real merged PR. Load-bearing contracts future
  planners must preserve.
category: decision
created_at: '2026-05-30'
updated_at: '2026-05-30'
keywords:
  - architect
  - structured-output
  - council
  - dev-loop
  - cwd-hallucination
  - worktree
  - closure
  - validation
---

# W5 validation run (2026-05-30) — what the first real UI cycle taught us

A real cycle was driven against **claude-harness** entirely through the UI
bridge (architect idea → interview → plan-gate → approve; review verdict;
operator PR-merge). It reached a **real merged PR** (`parsoFish/claude-harness`
PR #2, feature `claude-trail --compact`), dev-loop 3/3, `npm test` green on the
merged main. Getting there exposed seven defects — most in paths no test or
emulation had ever exercised:

1. **F-W5-1 — architect produced no structured output (fixed `cef1cc9`).** The
   in-UI architect's `runStructured` passed the bare JSON schema to the SDK's
   `outputFormat` (it expects `{type:'json_schema', schema}`) AND ran in
   `permissionMode:'plan'` (so the agent `ExitPlanMode`d instead of emitting
   output). Result: every interview/draft returned null — the architect could
   never produce a PLAN from a live LLM. Contract: `outputFormat` must be
   wrapped; structured steps must NOT run in plan mode.
2. **F-W5-2 — council was serial + re-ran on finalize (fixed `1973a20`).** The
   4 critics ran sequentially (~20 min) and `runFinalizeStep` re-ran the whole
   council. Intended flow (operator-confirmed): council runs ONCE on the first
   draft, critics in PARALLEL; after the operator's selections the architect
   just generates the final manifest (no second council). (The intended flow is
   also recorded in operator memory: project_architect_flow_intended.)
3. **F-W5-4 — PM hard-fails on the undocumented `creates:` rule (fixed `a9b7b5c`).**
   `creates:` entries must be a subset of the WI's `files_in_scope`; the PM skill
   never documented it, so the PM put a later WI's test file in an earlier WI's
   `creates:` and the cycle died at PM validation.
4. **F-W5-5 — auto-retry left a registered worktree (fixed `f431748`).**
   `selfHealWorktreeState` only removed ORPHAN dirs; a registered leftover from a
   failed cycle made the retry's `worktree add` fail "already exists". It now
   removes a registered leftover too. (`forge requeue --reset-retries` already
   removed it — the auto-retry path did not.)
5. **F-W5-6 — dev-loop cwd-hallucination (fixed `08cb5da`).** The agent read
   `AGENT.md`/sources from `/workspaces/`, `/repo/`, `/` (training-prior
   container prefixes) and burned its iteration budget. The SDK call already set
   `cwd: worktreePath`, but the prompt never stated the absolute directory. The
   Ralph PROMPT now opens with the absolute worktree path + "use relative paths,
   don't guess these prefixes". This was THE cycle blocker; with it fixed the
   dev-loop completed 3/3 (WI-1 in one iteration). A long-standing antipattern
   (claude-harness Brain 3: `2026-05-25-ralph-cwd-hallucination-per-iteration`,
   `2026-05-26-cwd-hallucination-zero-writes`).
6. **F-W5-7 — closure does not re-confirm a late operator-merge (OPEN).** With
   `serve --once` (which exits at ready-for-review) rather than the daemon,
   closure runs ONCE while the PR is still open (`pr-open-awaiting-operator`) and
   the cycle ends. When the operator merges the PR *after* that, nothing re-runs
   closure → the manifest stays in `ready-for-review/` (never `done/`) and the
   reflector never fires, even though the PR is genuinely merged. Fix direction
   (needs operator decision): either keep the daemon polling the verdict during
   review, or add a scheduler sweep that re-confirms ready-for-review cycles
   whose PRs are now MERGED → re-run closure (confirm → `done/` + reflection).
7. **F-W5-8 — `rerunReflector` cycleId mismatch (OPEN, minor).** It looks the
   manifest up by initiative-id but the bridge `/api/reflect/<cycleId>` keys on
   the timestamped log-dir id, so a manual reflector re-run writes
   `user-questions.json` to the wrong dir and the UI never shows it.

**Meta-lesson:** these are the bugs that only appear when the *real* pipeline
runs end-to-end. The unit-test fakes + `FORGE_ARCHITECT_NO_SPAWN` emulation hid
all of F-W5-1/2/6. A periodic real-cycle run (ADR 022's `verify-cycle`, but
WITHOUT auto-approve / WITH the real architect) is the only thing that catches
this class. Also: during a real cycle, **never run `npm run build` (next build)
against the live `forge watch` dev server** — it corrupts `.next` and 500s the UI.
