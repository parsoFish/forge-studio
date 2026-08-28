---
name: tiered-orchestration
description: Run a multi-batch engineering campaign through a three-tier agent hierarchy (wave orchestrator / per-initiative orchestrator / workers) with file-durable state, validated goals, and park-points. Use when driving a roadmap-scale body of work autonomously across many context windows, or when a single agent's context cannot hold the whole campaign.
---

# Tiered Orchestration

Derived from the forge wave-5 campaign (2026-08): batches A+B, 18 PRs merged, ~77h wall, zero red merges, measured twice against its own efficiency baseline. **Every rule here is one the measurement supported. Rules that failed are named in "What did not work" — do not reintroduce them.**

## The three tiers

| Tier | Model | Owns | Never does |
|---|---|---|---|
| **T1 — wave orchestrator** | light/fast | Batch sequencing, goal packs, rulings, batch exit gates, re-planning around blockers, lane launch + relay (`scripts/lanes.sh`) | Implements. Reads gate stdout. Holds initiative detail. |
| **T2 — one per INITIATIVE** (not per batch) | strong | Decompose → pin tests → spawn workers → **execute all gates itself** → PR → merge → ledger | Trusts a worker's pass/fail claim. Carries batch state in context. |
| **T3 — workers** | mid | Test-writing, implementing, adversarial review — fresh context each, spec-only briefs | Reads the wider campaign. Reports to anyone but its spawner. |

**T2 is per-initiative, not per-batch.** Measured: an initiative retains 25–50k tokens in T2; a five-initiative batch exceeds a context window and degrades long before it dies. Batch identity lives in the goal pack and ledger, not in a long-lived agent.

## File-durable state (the part that matters most)

Two context deaths occurred mid-campaign (an environment failure, a usage limit). Both cost nothing because state lived in files:

- `<campaign>/ledger.md` — **write-ahead**: record intent *before* every irreversible action, outcome after. Status must be **re-derived** from `gh pr view --json state,mergeCommit` + git before being trusted, never attributed from a report.
- `<campaign>/goal-packs/batch-<X>.md` — per initiative: goal, **exact gate commands**, acceptance-test placement, deletion duties, park-points, size budget, max attempts.
- `<campaign>/gate-manifests/<ID>.txt` — the pinned test world (see `immutable-gates`).
- An issue graph (beads/`bd` or equivalent) for the dependency DAG.

**Success test for the substrate: a successor with zero conversation history can resume correctly from files alone.** Prose chat-summary handoffs are forbidden — they are attributed status.

**Campaign dirs are usually gitignored.** A permanent artifact (ADR, roadmap, `docs/`) may never cite a path inside one — that is a dangling citation, a stale claim minted in the act of recording a decision.

## Goals as validated outcomes

A goal pack states gate **commands**, not prose intentions. The orchestrator runs them; the worker never self-certifies. Corollary from ADR-036-style reasoning: when the *evidence* is agent-produced, forensic checking of that evidence is an arms race the verifier loses — move execution into the orchestrator instead.

## Park-points

Pre-authorise the known ones at kickoff (ADR amendments, content requiring judgement, dependency additions). For each: the T2 produces the artifact, signals the orchestrator, and **stops**. Unforeseen ask-first items park with a notification and the T2 continues non-dependent work.

Park-points cost almost nothing when sequenced late in an initiative, and they are where the orchestrator earns its keep: a T2 refuted a proposed architectural merger *using the proposing artifact's own contents*, which no amount of implementation effort would have produced.

## Rules the measurement supported

1. **File-scoped red→green; full suite once, at the gate.** Full-suite runs fell 214 → 23 (−89%) with no loss of signal. Biggest token win available.
2. **Gate-run waivers require a recorded `git diff` proof.** Pre/post-merge journey runs 14 → 0, ~3.2h saved, 20 waivers each carrying its proof. A waiver without a proof is a skipped gate.
3. **Suite-runners never overlap file-editors in one tree** — serialize, or give the editor a worktree. Phantom-failure diagnosis is pure waste.
4. **Gates run in a clean worktree** with the test world restored from the pin.
5. **Split decisions are made before decomposition or not at all.** Retrofitting a PR split onto an N-commit branch is history surgery and doubles shared-file test work. A mid-flight split proposal should lose absent a correctness reason.
6. **Commit worker output on arrival** — not stage. A journey runner or an errant checkout can reset a tree; "pending a green run" is not a reason to leave hundreds of uncommitted lines exposed.
7. **`git checkout` never shares a command line with anything else and never takes `.`**

## What did NOT work (measured failures — do not reintroduce)

- **"Spawn all workers synchronously" failed and got 4× worse** (worker-poll commands 11 → 48). It contradicts the resume-for-tokens optimisation the same pack rewards, because resumed chains return as background. **Fix the contradiction, don't restate the rule**: either accept background workers and build a relay path, or forbid resumption — not both.
- **"No bald sleep" half-failed** — condition-polled sleep fell 55%, but unconditional `sleep > 30` *rose 119%*, one agent alone burning 4,010s. **A rule declared and enforced nowhere is decoration.** Enforce mechanically (a wrapper, a lint, a hook) or expect it ignored.
- **No liveness check on long-running agents.** One T2 stalled undetected for 298 minutes — 12% of a batch's wall clock. Any tier running unattended needs a heartbeat and a stall ceiling.
- **Zero inter-initiative parallelism, both batches.** The largest single saving identified (10–14h) was never piloted because everything ran serially by default.

## Review economics

31 review rounds in the measured batch; **29 found a live reproduced defect.** Rounds are not the cost centre — *fix quality* is. "The fix ships its own instance of the defect it closed" occurred **seven times**, four consecutively on one initiative.

Two consequences:
- Give fix-implementers the reviewer's class heuristics up front, not just the finding.
- **Stop-signal: two reopenings of the same defect class means the problem is misdiagnosed.** When each fix reopens the issue one layer down, the class is wrong (in the campaign: orphan-consistency is not containment and cannot be fixed by reordering). Split it out as its own initiative rather than patching a sixth time.

## Interrupting the plan for real findings

Three unplanned security initiatives were authorised mid-campaign on reproduced findings. Measured: 27% of wall bought 20 live-reproduced defects, three P0s, a closed audit and a CI ratchet — at **3.7h per WI versus 5.0h for planned work**. Interrupting the plan for a reproduced P0 was cheaper per unit of value than the plan itself. Scope each interruption explicitly and decide its split *before* decomposition.

## Orchestration mechanics earned in long campaigns (measured across batches C–G)

The A/B notes above were frozen before the campaign ran long enough to hit these. Every rule here was measured 2+ times.

- **The relay hole is the most-measured orchestration defect (hit 4+ times).** A T2 that parks waiting on a *detached* long job — a ui:journey run, a CI checks-watch, a background `until` loop — **does not reliably self-resume when the job finishes.** Resumed rounds return to T1 (the spawner's main loop), not to the parked T2. Do not assume a self-monitor will wake the lane to do its finish work (commit gallery, merge, close bead). **T1 is the only reliable relay:** watch the terminal condition yourself (a `Monitor`, or verify state directly) and then either `SendMessage` the lane to resume or — for a merge-ready parked lane — **finish it yourself with git/gh** (push → PR → CI-gate → merge → close bead). The campaign's final PR merged this way. A merge-ready branch needs no model budget to land. With tmux lanes (below), `scripts/lanes.sh send` is that relay.
- **A holder PID is not a liveness check. Reclaim a lock only on a 3-signal verdict:** heartbeat recency **and** a live lane-owned subprocess (the journey's `next dev` / `e2e-journey`) **and** port binding (4123/4124). The same 3-signal check fired twice on one lock with opposite, both-correct verdicts — LIVE (a rotated `mkdir` PID over a running journey; breaking it would have corrupted the run) then, days later, genuinely STALE (dead subagent + free port + 3-day-old heartbeat). Holder-PID-alone gets both wrong.
- **A heartbeat must carry real state, not an optimistic label.** A lane that logs `RUNNING` while its journey is wedged and failing is worse than silence — it defeats the stall ceiling. Write the actual fail/timeout counts and the frame/beat progress; and **a lane that does not heartbeat at all manufactures a false STALL** that nearly triggers a wrongful lock reclaim. Trust the heartbeat *log*, not the agent's self-reported progress tick (they diverged — the tick said "0 fails" while the log honestly showed 3).
- **`free -h` before any `ui:journey` / `ui:deadpaths` run.** A memory-starved host (a foreign leaked process at 10 GB on a 13 GB box) OOM-kills the browser and produces a trailing cluster of `Target crashed` check failures that read exactly like code defects. Diagnosing it via `deadpaths` costs 3 minutes; chasing it as a code defect costs a 45-minute blind re-run and risks re-scoping a healthy beat. Confirm the crash with the cheap tool; don't infer the cause from which checks are red.
- **`git checkout` and `pkill -f` are footguns in an orchestrator's own shell.** `pkill -f PATTERN` matches the orchestrator's *own* command line if PATTERN appears in it — silently killing the command mid-run (no output). Kill by PID or use a pattern that can't match self. And foreground/background `sleep` is blocked in this harness (exit 144) — use a `Monitor` or a condition-poll with the long job launched detached, never a bald wait.
- **File-durable substrate is the resilience that matters — proven by 3 context deaths** (an environment failure, and a usage-limit kill twice). A 71-hour weekly-limit kill mid gallery-regen recovered in 46 minutes with zero work lost, because state lived in the ledger + goal packs + committed lane branches, never in chat. The successor test (a fresh orchestrator resumes from files alone) is not ceremony — it is what makes an interrupt a pause instead of a restart.
- **The stall watcher must live out-of-process (cron/systemd), or it dies with what it watches.** A 384-minute host shutdown was invisible because the watcher was a process on the host it watched. A `crontab` entry re-arming every few minutes survives the host cycling and is the only watcher that can report the gap it was built to catch.
- **Intra-initiative concurrency is the cheapest measured parallelism — cheaper than a second lane.** Running WI-N's implementer concurrently with the WI-(N-1)/(N-2) reviewer, with isolation written into both briefs, produced the batch's shortest initiative (2h39m) with no global lock and no cross-lane risk. Prefer it over opening a second lane when the WIs are file-disjoint; it composes with the serial gate.
- **An exit criterion is admissible only if it names (a) the WI that delivers it, (b) the producing route/agent/beat, and (c) the grep proving that producer exists today.** Exit criteria without a named producer failed twice in one campaign (six parity stories at 0 ported beats; a criterion with zero ledger trace across 7,635 lines). The pack's exit section is a table filled before spawn; refuse to spawn a lane whose exit rows are empty.
- **Drain write-only backlogs (brain-ingest, ratification queues) at batch OPEN, as a blocking gate — exit duties demonstrably do not happen.** One ingest duty was committed twice and run never; the campaign's #1 defect class lived only in campaign state for three batches.
- **The dominant defect class is not closed by detecting it — only a constructive design closes it.** `declared-data-fails-open` (a field parsed/surfaced/enforced-nowhere) recurred 25+ times across the campaign, including *inside the primitive built to fix it* and *inside the honesty instrument meant to catch it*. Adversarial-review-per-WI detected it every time (the only layer that did), but the cure that finally holds is structural: **derive the value from its source of truth and give the object no field to store a stale copy in** (`derive-status-dont-store-it`). Detection is a tax you keep paying; the constructive pattern stops the bleed.

## Lanes are real sessions, launched by T1 in tmux (adopted 2026-08-28)

Two facts fix the mechanism. In-process subagents **cannot nest**: a T2 spawned with the Agent tool cannot spawn its own T3s, so it would write tests, implement and review inline in one context — the pattern measured to blow context. And operator-pasted sessions put lane parallelism on the human. So T1 launches each lane itself as a **fresh `claude` session inside a detached tmux session**, and the operator attaches when they want to interact.

- `scripts/lanes.sh render <kickoffs.md> '<heading-regex>' <campaign>/prompts/<lane>.md [PARAM=VALUE]` — the prompt a lane receives is a file a successor can read, never chat.
- `scripts/lanes.sh launch <campaign> <lane> <prompt-file> [--model opus] [--permission-mode auto] [--open]` — tmux session `forge-<lane>`, cwd = the main checkout (the lane cuts its own worktree per its prompt), pane piped to `<campaign>/heartbeat/<lane>.tmux.log`, lane id added to `heartbeat/ACTIVE`; `--open` pops a Windows Terminal tab attached to it. Refuses an existing session.
- `scripts/lanes.sh peek <lane>` · `send <lane> '<text>'` · `list <campaign>` · `kill <campaign> <lane>` · `events <campaign>` (one line per actionable event, forever — feed it to a persistent Monitor) — T1's eyes, relay and retirement. A park-point ruling ("approved: H2 run 1, ceiling $20") is typed into the parked lane, which resumes on its own model budget. A merge-ready lane whose session has ended is still finished by T1 with git/gh.
- The operator interacts with `tmux attach -t forge-<lane>` (detach `C-b d`); the lane's own `/session-report` still measures its tokens.
- `scripts/watch-heartbeats.sh <campaign>/heartbeat` is the cron watcher (`*/5 * * * *`): liveness = max(mtime of `<lane>.log` and every path the lane declares in `<lane>.liveness`, e.g. its cycle's `events.jsonl`); ceiling 30 min; `STALL-<lane>` flag for T1 to poll and clear. **The tmux pane log is not liveness** — an idle Claude TUI redraws its status bar, so the pane never goes quiet (a 2-hour idle lane never flagged, 2026-08-28).
- **Detached jobs need a waiter.** A lane that launches a long job detached (`setsid nohup … &`) and ends its turn does not wake when the job finishes — measured: 2 h idle on a finished, passing run. Rule: pair every detached launch with a background waiter (`until ! kill -0 $PID; do sleep 30; done`, run in the background) so its completion notification wakes the lane, and heartbeat from the job's own log meanwhile. On the T1 side `lanes.sh events` emits `LANE_IDLE` when a pane shows a finished turn and the heartbeat is > 10 min old; the relay is `lanes.sh send`.

T1 launches only what the land order allows now, re-derives a finished lane's exit rows from git/gh before launching a dependent lane, and never launches a lane whose brief has an empty exit row.

## See also

- `immutable-gates` — the test-pinning and verification contract T2 executes.
- `adversarial-containment-review` — the review brief T3 reviewers receive.
