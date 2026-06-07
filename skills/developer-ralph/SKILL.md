---
name: developer-ralph
description: Launch the Ralph loop runner for a single work item; iterate until quality gates pass, iteration budget is exhausted, or the loop is detected as wedged.
phase: developer-loop
surface: unattended
model: claude-sonnet-4-6
---

# Developer — Ralph

## Single responsibility

Drive a single work item to completion via the Ralph loop pattern ([ADR 002](../../docs/decisions/002-ralph-loop-pattern.md)). The skill is a thin wrapper that prepares the loop's input artifacts (`PROMPT.md`, `AGENT.md`, `fix_plan.md`) and invokes [`loops/ralph/runner.ts`](../../loops/ralph/runner.ts).

## Brain-read policy

**The dev-loop does NOT query the forge brain** (Brains 1+2; see
[ADR 010](../../docs/decisions/010-brain-first.md) — brain-read policy). The
planner already consulted the brain and encoded every relevant
pattern/antipattern/convention into this WI's spec + acceptance criteria. The
work item is the **single source of intent**; a forge-brain read here is wasted
cost and a source-of-truth split.

The dev agent **may** consult the cycle's project brain (Brain 3 — the
project's own `brain/profile.md` + `brain/themes/`, available in the worktree)
for supplemental project context when the WI is thin on a project convention
(file layout, testing norms). This is advisory, not mandatory — the WI remains
the single source of *intent*; Brain 3 is supplemental *context* ([ADR 010
amendment 2026-05-26](../../docs/decisions/010-brain-first.md)).

## Inputs

- `<worktree>/.forge/work-items/WI-<n>.md` — the work-item spec.
- `loops/ralph/PROMPT.md.tmpl` — template for the per-iteration prompt.
- `loops/ralph/AGENT.md.tmpl` — template for institutional memory.
- The worktree itself (the developer loop runs in the worktree).

## Outputs

- Commits in the worktree (one per acceptance criterion where possible).
- `<worktree>/AGENT.md` — final institutional memory (loop bookkeeping; the agent updates this each iteration).
- `<worktree>/fix_plan.md` — checklist showing remaining work if the loop didn't complete (loop bookkeeping; the agent ticks items each iteration).
- Iteration events to the event log.

> **Status frontmatter is owned by the orchestrator, not the agent.** Do not edit `<worktree>/.forge/work-items/WI-<n>.md` — the orchestrator writes `status: complete | failed` after `run()` returns. The agent's job is the code change, not the bookkeeping.

## Event-log entries to emit

- `ralph.start` — `event_type: 'log'`, loop initiated for a work item.
- per-iteration `event_type: 'iteration'` — iteration number, cost, duration, files touched.
- `ralph.end` — `event_type: 'end'`, loop complete; carries `status`, `iterations`, `stop_reason`, `tool_use`.

## Process

1. Read the work item spec — the single source of intent (no forge-brain query).
2. Stamp `loops/ralph/PROMPT.md.tmpl` with the work-item content + acceptance criteria → `<worktree>/PROMPT.md`.
3. Stamp `loops/ralph/AGENT.md.tmpl` → `<worktree>/AGENT.md` (empty institutional memory; the loop fills it across iterations).
4. Initialise `<worktree>/fix_plan.md` with the acceptance criteria as a checklist.
6. Invoke `loops/ralph/runner.ts` with the worktree path and stop-condition config (from initiative manifest's `iteration_budget` — no $ cap per CONTRACTS.md C19).
7. The runner returns: `{ status: 'complete' | 'failed' | 'wedged', iterations: n, cost: usd }`. The orchestrator writes `status` back to the WI spec — the skill does not.

## Constraints

- **Quality gates verified by the orchestrator, not the agent.** The runner runs `npm test` / `npm run lint` / etc. itself; the agent's claim of "tests pass" is not trusted (carried-over v1 lesson).
- **Iteration budget is hard.** The runner stops at `iteration_budget` regardless of progress.
- **Wedged-detector** — see [`loops/ralph/stop-conditions.ts`](../../loops/ralph/stop-conditions.ts).

---

# Ralph loop discipline

You are inside a Ralph loop. Each call to you is **one iteration** of that loop. The loop carries state across iterations via three worktree files you must read at the start of every iteration:

- **`PROMPT.md`** — the per-iteration brief (work item spec, acceptance criteria, files in scope, iteration counter).
- **`AGENT.md`** — institutional memory across iterations. Read first, update last. Record what you tried, what worked, what didn't — so the next iteration does not re-tread dead ends.
- **`fix_plan.md`** — checklist of acceptance criteria + sub-tasks. Tick items as you complete them; add items as you discover sub-problems.

After your work this iteration, **commit** with a conventional-commits message (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`). Atomic commits — one concern per commit. You may use `Bash` for `git`, `npm test`, `pytest`, `bats`, or any test runner.

**The orchestrator decides when to stop, not you.** It runs the project's quality gates between your iterations. Your job is to make incremental progress every iteration; the orchestrator exits the loop when gates pass or when the iteration budget is exhausted.

Hard rules:
- **You are CONTINUING, not restarting.** Every prior iteration's work is committed on this branch. Your FIRST move each iteration: `git log --oneline main..HEAD` + `git diff --stat main..HEAD` to see what is already built, and read `AGENT.md` for what has already been tried. Build on it — never re-research a question `AGENT.md` already answered, never re-investigate code a prior iteration already wrote. If you catch yourself reading SDK/docs/source to "understand" rather than to make a concrete edit, you are burning the iteration: stop reading and write.
- **Write code EARLY.** Make a concrete, committed change every iteration. If an acceptance criterion needs a new file, write a compiling skeleton of it in your first one or two tool calls, then flesh it out across iterations — do NOT spend a whole iteration researching. Progress is measured in committed diffs, not in understanding.
- **Anchor on the WI's acceptance criteria.** Your job is to make each AC's `then` clause observable. (The project's own `brain/` — profile + themes, Brain 3 — is available as supplemental context per ADR 010 if the WI is genuinely thin on a project convention; the forge brain is off-limits.)
- **`files_in_scope` is advisory orientation, NOT a fence.** It is the planner's best guess at which files this WI touches — a starting point. You are FREE to edit any file needed to make the gate pass, including **sweeping or mechanical changes across many files** (e.g. running a formatter over the whole tree, fixing a lint rule everywhere it fires) when that is what the acceptance criterion requires. Don't gratuitously rewrite unrelated features — but never let the scope list stop you from applying the actual fix.
- **Read what the gate is telling you, then use the project's own fixers.** When the gate runs the project's CI / format / lint checks and reports a failure, it names exactly what is wrong — fix THAT, the cheap way. If a formatter or linter has an auto-fix target (`make fmt`, `make terrafmt`, `gofmt -w`, `prettier --write`, `ruff --fix`, `cargo fmt`), RUN IT over the whole tree in one command instead of hand-editing files one by one. A whole-tree formatter run is one Bash call; hand-fixing 100 files is a wasted budget. Re-run the gate to confirm.
- **No shortcuts.** Don't skip tests, don't `--no-verify`, don't disable lint rules to pass.
- **No hallucinated test passes.** If you claim tests pass, prove it by running them via `Bash`. The orchestrator re-runs them anyway and will exit `failed` if your claim was wrong.
- **`creates:` / `verification_artifact:` paths are MANDATORY outputs.** If the work item lists either, the orchestrator runs `git diff --name-only main...HEAD` and rejects the iteration if NONE of those paths are in the diff. Action: before you exit each iteration, ensure at least one of those paths exists in the worktree (a compiling stub is enough to satisfy the path check; substantive content comes second). If the gate emits "[forge gate-tightening] REJECTED: …", the rejection message lists the exact paths — create one of them in the next iteration.
