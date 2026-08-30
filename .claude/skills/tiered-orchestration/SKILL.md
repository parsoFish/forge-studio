---
name: tiered-orchestration
description: Use when driving a roadmap-scale body of work autonomously across many context windows — several initiatives or lanes, each with its own gates, running unattended between operator rulings — or when one agent's context cannot hold a whole campaign and its reported status keeps drifting from what git and gh say.
---

# Tiered Orchestration

One orchestrator (T1) runs a campaign through lanes it launches as real Claude sessions; each lane (T2) runs its own gates and fans out workers (T3). State lives in files, every question reaches the operator through T1's one session, and nothing is trusted that was not re-derived from git/gh. Every rule here was bought by an incident; the incidents are in [reference/measured-lessons.md](reference/measured-lessons.md) — read that when a rule looks excessive, not before starting.

## The three tiers

| Tier | Model | Owns | Never does |
|---|---|---|---|
| **T1 — campaign orchestrator** | light | sequencing, briefs, rulings, exit gates, lane launch and retirement, the campaign lines of the ledger (launches, rulings, exit tables) | implements · reads a pane to learn state · holds initiative detail |
| **T2 — one per lane/initiative** | strong | decompose → pin tests → spawn T3 → run every gate itself → PR → merge → ledger | trusts a worker's pass/fail · carries another lane's state · asks a human in its own window |
| **T3 — workers** | mid | tests, implementation, adversarial review — fresh context, spec-only briefs | reads the campaign · reports to anyone but its spawner |

T2 is per initiative: it retains 25–50k tokens, and a five-initiative batch degrades long before it dies. Lanes are real sessions because in-process subagents cannot nest — a T2-as-subagent loses its T3 fan-out and does everything in one context.

## File-durable state

- `<campaign>/ledger.md` — write-ahead: INTENT before every irreversible action, OUTCOME after. Status is re-derived from `gh pr view --json state,mergeCommit` and git before it is trusted, never attributed from a report.
- `<campaign>/briefs/<lane>.md` — goal, exact gate commands, exit table (each row names the lane, the producer and the grep proving it exists; an empty row = refuse to launch), park points, budget.
- `<campaign>/gate-manifests/<lane>.*` — the pinned test world (`immutable-gates`).
- beads (`bd`) — the dependency DAG; a park is a bead before the lane that parked it returns.
- `<campaign>/heartbeat/` — `ACTIVE` (T1-owned), `<lane>.log` real state, `<lane>.liveness` declared job logs, `<lane>.session` id, `STALL-<lane>` flags.

Successor test: a fresh T1 with no chat history resumes from these files alone. Campaign dirs are gitignored; a permanent artifact never cites a path inside one.

## Lanes: launch · route · watch · retire

`scripts/lanes.sh` (run with no args for help). One lane = one **named** Claude session `forge-<lane>` in a detached tmux session, cwd the main checkout, its own worktree `~/forge-<lane>`.

| | T1 does | what happens |
|---|---|---|
| **launch** | `lanes.sh render …` then `lanes.sh launch <campaign> <lane> <prompt> [--open] [--attended]` (an attended session is normally also `--open`) | names the session; appends [`lane-protocol.md`](lane-protocol.md) to its system prompt; blocks `AskUserQuestion` with [`lane-settings.json`](lane-settings.json) unless `--attended`; confirms by the session appearing in `claude agents --json`; adds it to `ACTIVE` |
| **route** | record the ruling in the ledger, then `SendMessage(to: "forge-<lane>", notify_when_idle: true)` | the lane sends `PARK` / `STOP` / `OUTCOME` messages to T1's session name and ends its turn; a T3 cannot ask at all, so its question bubbles the same way; the operator is asked only by T1, with `AskUserQuestion`, in T1's session |
| **watch** | one persistent `Monitor` on `lanes.sh events <campaign>`; cron `*/5 * * * * watch-heartbeats.sh <campaign>/heartbeat` | events: `STALL` · `LANE_GONE` · `LANE_EXITED` · `LANE_BLOCKED` (a dialog only a terminal can answer) · `LANE_IDLE` (turn finished, heartbeat > 10 min — the relay hole). `notify_when_idle: true` on every message adds a one-shot notice that arrives when T1 is next idle (measured: three notices delivered together at the turn boundary, ~30 min after the lanes went idle, because T1 had not stopped working) — it wakes a waiting T1 and never interrupts a busy one; the Monitor covers the busy case |
| **retire** | `lanes.sh kill <campaign> <lane>` after re-deriving its exit rows; `lanes.sh reap <campaign>` for stragglers | ends the tmux session, drops `ACTIVE` and stall stamps, removes a clean worktree (keeps a dirty one), prunes |

A lane's messages arrive in T1's context on their own; T1 never polls. `lanes.sh peek` and `tmux attach` are for diagnosis and for attended sessions (an operator narrating in the lane's own window), never for learning whether a lane is done. A lane that has sent `OUTCOME` but whose merge T1 cannot re-derive is not done.

## Guard rails — each enforced somewhere, each bought by an incident

| rule | enforced by |
|---|---|
| A lane never asks a human in its own window | PreToolUse hook in `lane-settings.json` |
| T1 learns lane state from messages, the roster and the watcher — never from a pane | `lanes.sh events`; there is no `send` |
| A launch or a relay is confirmed by its effect, never by text being visible | `launch` polls `claude agents --json`; `SendMessage` returns delivery |
| `ACTIVE` is written by `lanes.sh launch/kill` only; T1 is never in it | `lane-protocol.md` §2; per-lane arm stamps in the watcher |
| Liveness = heartbeat log + declared job logs, never the pane; ceiling 30 min; watcher out of process | `watch-heartbeats.sh` under cron |
| Every detached job gets a background waiter so its completion wakes the lane | `lane-protocol.md` §2 |
| A worktree is removed only when clean (`lanes.sh kill`); a branch is deleted only when `git merge-base --is-ancestor` says merged (the lane's close-out — `kill` never touches branches) | `lanes.sh kill`; the lane |
| T2 runs the gates itself, in a clean worktree from the pin; file-scoped red→green, full suite once at the gate | `immutable-gates` |
| Waiving a gate run needs a recorded `git diff` proof | the ledger |
| Reclaim a lock only on three signals: heartbeat recency + a live lane-owned subprocess + the port binding | T1's judgement — a holder PID alone was wrong both ways |
| Kill by PID found via `readlink /proc/<pid>/cwd`, never `pkill -f <lane-id>` (it matches the lane's own argv); `git checkout` shares no command line and never takes `.` | — |
| Split decisions before decomposition or not at all; commit worker output on arrival | — |
| The same defect class reopened twice → the lane sends `STOP` and T1 re-plans the class | ledger `STOP` line |

## Park protocol

Pre-authorise the known park points at kickoff (ADR amendments, judgement content, new dependencies, spend ceilings). A park is: the artifact → a bead → `SendMessage` to T1 with first line `PARK <lane>: <question, artifact path, default if unanswered>` → end the turn. The default is what the lane will do if it runs out of non-dependent work before a ruling arrives: a pre-authorised park may proceed on its default, anything else waits. An unforeseen ask parks the same way while non-dependent work continues. Batch rulings: one operator sitting per lane beat every relay round-trip measured.

## Red flags — STOP

- "I'll peek the pane to see if it finished" → the events Monitor is armed; a finished lane sends `OUTCOME`, an idle one shows up as `LANE_IDLE`.
- "I'll type the ruling into the lane's terminal" → `SendMessage`.
- "The lane will de-register / clean up its own session" → `lanes.sh kill`.
- "The pane log is fresh, so it's alive" → an idle TUI redraws; only the heartbeat counts.
- "STALL flag → reclaim the lock" → the 3-signal check first.
- A coordination rule that lives only in prose → it is decoration; put it in a script, a hook or a file, or delete it.

## See also

- `immutable-gates` — the pinning and verification contract T2 executes.
- `adversarial-containment-review` — the review brief T3 reviewers receive.
- [reference/measured-lessons.md](reference/measured-lessons.md) — the incidents and measurements behind every rule, wave 5 → forge 1.0 M1, and the mechanisms they retired.
