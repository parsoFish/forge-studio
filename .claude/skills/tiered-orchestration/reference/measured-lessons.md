# Measured lessons behind the tiered-orchestration rules

The incidents and measurements that bought every rule in `SKILL.md`. Read this when a rule looks excessive, when a stop rule fires, or when you are about to retire a guard. Nothing here is a rule by itself — the rules are in `SKILL.md`; this is why they exist. Sections are in the order the campaigns ran.

## Forge wave 5 (2026-08): batches A+B, 18 PRs, ~77 h wall, zero red merges

Measured twice against its own efficiency baseline. Every rule below is one the measurement supported; the ones that failed are named under "What did NOT work".

**T2 is per-initiative, not per-batch.** An initiative retains 25–50k tokens in T2; a five-initiative batch exceeds a context window and degrades long before it dies. Batch identity lives in the goal pack and ledger, not in a long-lived agent.

**File-durable state.** Two context deaths occurred mid-campaign (an environment failure, a usage limit). Both cost nothing because state lived in files: the write-ahead ledger, the goal packs with exact gate commands, the pinned test world, the issue graph. Prose chat-summary handoffs are attributed status and are forbidden.

**Goals as validated outcomes.** A goal pack states gate *commands*, not prose intentions. The orchestrator runs them; the worker never self-certifies. When the evidence is agent-produced, forensic checking of that evidence is an arms race the verifier loses — move execution into the orchestrator instead.

**Park-points cost almost nothing when sequenced late in an initiative,** and they are where the orchestrator earns its keep: a T2 refuted a proposed architectural merger using the proposing artifact's own contents, which no amount of implementation effort would have produced.

### Rules the measurement supported

1. **File-scoped red→green; full suite once, at the gate.** Full-suite runs fell 214 → 23 (−89%) with no loss of signal. Biggest token win available.
2. **Gate-run waivers require a recorded `git diff` proof.** Pre/post-merge journey runs 14 → 0, ~3.2 h saved, 20 waivers each carrying its proof. A waiver without a proof is a skipped gate.
3. **Suite-runners never overlap file-editors in one tree** — serialize, or give the editor a worktree. Phantom-failure diagnosis is pure waste.
4. **Gates run in a clean worktree** with the test world restored from the pin.
5. **Split decisions are made before decomposition or not at all.** Retrofitting a PR split onto an N-commit branch is history surgery and doubles shared-file test work. A mid-flight split proposal should lose absent a correctness reason.
6. **Commit worker output on arrival** — not stage. A journey runner or an errant checkout can reset a tree; "pending a green run" is not a reason to leave hundreds of uncommitted lines exposed.
7. **`git checkout` never shares a command line with anything else and never takes `.`**

### What did NOT work (measured failures — do not reintroduce)

- **"Spawn all workers synchronously" failed and got 4× worse** (worker-poll commands 11 → 48). It contradicts the resume-for-tokens optimisation the same pack rewards, because resumed chains return as background. Fix the contradiction, don't restate the rule: either accept background workers and build a relay path, or forbid resumption — not both.
- **"No bald sleep" half-failed** — condition-polled sleep fell 55%, but unconditional `sleep > 30` *rose* 119%, one agent alone burning 4,010 s. **A rule declared and enforced nowhere is decoration.** Enforce mechanically (a wrapper, a lint, a hook) or expect it ignored.
- **No liveness check on long-running agents.** One T2 stalled undetected for 298 minutes — 12% of a batch's wall clock. Any tier running unattended needs a heartbeat and a stall ceiling.
- **Zero inter-initiative parallelism, both batches.** The largest single saving identified (10–14 h) was never piloted because everything ran serially by default.

### Review economics

31 review rounds in the measured batch; **29 found a live reproduced defect.** Rounds are not the cost centre — *fix quality* is. "The fix ships its own instance of the defect it closed" occurred seven times, four consecutively on one initiative. So: give fix-implementers the reviewer's class heuristics up front, not just the finding; and **two reopenings of the same defect class means the problem is misdiagnosed** — when each fix reopens the issue one layer down, the class is wrong (orphan-consistency is not containment and cannot be fixed by reordering). Split it out as its own initiative rather than patching a sixth time.

### Interrupting the plan for real findings

Three unplanned security initiatives were authorised mid-campaign on reproduced findings. Measured: 27% of wall bought 20 live-reproduced defects, three P0s, a closed audit and a CI ratchet — at 3.7 h per WI versus 5.0 h for planned work. Interrupting the plan for a reproduced P0 was cheaper per unit of value than the plan itself. Scope each interruption explicitly and decide its split before decomposition.

## Forge waves 6–8 (batches C–G): mechanics earned in long campaigns

Every rule here was measured 2+ times.

- **The relay hole is the most-measured orchestration defect (hit 4+ times).** A T2 that parks waiting on a *detached* long job — a ui:journey run, a CI checks-watch, a background `until` loop — does not reliably self-resume when the job finishes. Resumed rounds return to the spawner's main loop, not to the parked T2. T1 is the only reliable relay: watch the terminal condition yourself and then wake the lane, or — for a merge-ready parked lane — finish it yourself with git/gh (push → PR → CI-gate → merge → close bead). A merge-ready branch needs no model budget to land.
- **A holder PID is not a liveness check. Reclaim a lock only on a 3-signal verdict:** heartbeat recency **and** a live lane-owned subprocess (the journey's `next dev` / `e2e-journey`) **and** port binding (4123/4124). The same check fired twice on one lock with opposite, both-correct verdicts — LIVE (a rotated `mkdir` PID over a running journey; breaking it would have corrupted the run) then, days later, genuinely STALE (dead subagent + free port + 3-day-old heartbeat). Holder-PID-alone gets both wrong.
- **A heartbeat must carry real state, not an optimistic label.** A lane that logs `RUNNING` while its journey is wedged is worse than silence — it defeats the stall ceiling. Write the actual fail/timeout counts and the frame/beat progress. Trust the heartbeat *log*, not the agent's self-reported progress tick (they diverged — the tick said "0 fails" while the log honestly showed 3).
- **`free -h` before any `ui:journey` / `ui:deadpaths` run.** A memory-starved host (a foreign leaked process at 10 GB on a 13 GB box) OOM-kills the browser and produces a trailing cluster of `Target crashed` failures that read exactly like code defects. Diagnosing it via `deadpaths` costs 3 minutes; chasing it as a code defect cost a 45-minute blind re-run.
- **`git checkout` and `pkill -f` are footguns in an orchestrator's own shell.** `pkill -f PATTERN` matches the orchestrator's *own* command line if PATTERN appears in it — silently killing the command mid-run. Kill by PID or by a pattern that cannot match self. Foreground `sleep` is blocked in this harness (exit 144) — use a `Monitor` or a condition-poll with the long job launched detached.
- **File-durable substrate is the resilience that matters — proven by 3 context deaths** (an environment failure, and a usage-limit kill twice). A 71-hour weekly-limit kill mid gallery-regen recovered in 46 minutes with zero work lost, because state lived in the ledger + goal packs + committed lane branches, never in chat.
- **The stall watcher must live out-of-process (cron/systemd), or it dies with what it watches.** A 384-minute host shutdown was invisible because the watcher was a process on the host it watched.
- **Intra-initiative concurrency is the cheapest measured parallelism — cheaper than a second lane.** Running WI-N's implementer concurrently with the WI-(N-1)/(N-2) reviewer, with isolation written into both briefs, produced the batch's shortest initiative (2 h 39 m) with no global lock and no cross-lane risk. Prefer it over a second lane when the WIs are file-disjoint.
- **An exit criterion is admissible only if it names (a) the WI that delivers it, (b) the producing route/agent/beat, and (c) the grep proving that producer exists today.** Exit criteria without a named producer failed twice in one campaign (six parity stories at 0 ported beats; a criterion with zero ledger trace across 7,635 lines). Refuse to launch a lane whose exit rows are empty.
- **Drain write-only backlogs (brain-ingest, ratification queues) at batch OPEN, as a blocking gate** — exit duties demonstrably do not happen. One ingest duty was committed twice and run never.
- **The dominant defect class is not closed by detecting it — only a constructive design closes it.** `declared-data-fails-open` (a field parsed/surfaced/enforced-nowhere) recurred 25+ times, including *inside the primitive built to fix it* and *inside the honesty instrument meant to catch it*. Adversarial review per WI detected it every time (the only layer that did), but the cure that holds is structural: derive the value from its source of truth and give the object no field to store a stale copy in. Detection is a tax you keep paying.

## Forge 1.0, M0–M1 (2026-08-28 → 30): the lane mechanism, 19 sessions

Lanes became real `claude` sessions in tmux, launched by T1 (operator ruling 2026-08-28: operator-pasted sessions put parallelism on the human; in-process subagents cannot nest). Two T1 sessions and 17 lanes ran. The record (`_1.0/ledger.md`, the transcripts) measured the mechanism itself:

- **The pane-paste relay was the single largest failure.** `lanes.sh send` and `launch` printed success over a payload the TUI had staged as `[Pasted text #1]` and never submitted — three instances in one afternoon; a ruling already made sat undelivered and a lane stayed parked **99 minutes**; a launched lane sat at $0.00. The fix (declared-boundary paste + watch the input line drain) shipped green on 9 unit tests and was still wrong in both paths, because the real TUI pads an empty line with U+00A0 — found only by a live check. Six sessions were spent probing delivery. Retired 2026-08-30: T1 and lanes now use Claude Code's cross-session `SendMessage` (a named session is an address; delivery is a tool result; an idle lane wakes on receipt — measured ~20 s), and there is no `send` subcommand to trust.
- **The pane is not state.** LANE_IDLE was inferred from a `· done H:MM` marker; liveness was once the pane log (an idle TUI redraws its status bar, so a 2 h 12 m idle lane on a finished, passing run never flagged). Retired: `claude agents --json` reports each session `busy` / `idle` / `waiting … blocked`, which `lanes.sh events` reads. (`SendMessage`'s `notify_when_idle` was tried three times the same day and its notice never reached T1's context — it is not relied on.)
- **T1 polled by hand for ~39 hours before arming its events Monitor** and twice learned a lane had finished because the operator said so; it called raw `tmux` 12 times against 15 `peek`s and 4 Monitor arms. The events monitor was then reading the ledger T1 itself writes (self-echo), and a well-behaved lane that de-registered was the silent one ("a perverse contract for a relay"). Retired: events no longer grep the ledger; they read the roster, tmux and STALL flags; OUTCOME arrives as a message from the lane.
- **Questions asked in lane windows.** 15 `AskUserQuestion` calls across 9 lanes were answered by the operator inside the lanes' own tmux windows (0.2–58 min each); H2 spend approvals routed through T1's relay were the slow, fragile path, while an operator sitting in an attended (H6) lane was fast. Retired for unattended lanes: a launch-time PreToolUse hook blocks `AskUserQuestion` and points the lane at T1's session name; the operator answers only in T1's session. Attended lanes (`--attended`) keep the tool.
- **5 of 5 lanes failed to de-register from `ACTIVE`; one corrupted the file.** Three T1 rewrites of the watcher chased the same class (a global arm stamp re-armed by an unrelated lane's clean exit → 79 minutes blind; T1 registering itself → three false self-stalls). Retired: `ACTIVE` is written by `lanes.sh launch/kill` only, arm stamps are per lane, and T1 is never in it.
- **Consolidating hand-written lane addenda silently dropped the heartbeat duty**, which caused the next lane's false STALL — the same "silent loss on merge" shape the campaign kept finding in product code. Retired: the lane protocol rides with the launcher (`lane-protocol.md`, appended to every lane's system prompt), not with the prompts T1 writes.
- **Cleanup.** Four idle M0 sessions were left attached post-close (≈0.45 GB each on a 13 GB host); 12 of 17 lanes removed their own worktree, 1 of 17 ended its own tmux session; a `pgrep -f '<lane-id>'` at close-out matched the lane's own claude and the operator's `tmux attach`. Retired: the tmux session ends when the claude session ends; `lanes.sh kill` removes a clean worktree and keeps a dirty one; `lanes.sh reap` retires exited sessions; kill by PID via `readlink /proc/<pid>/cwd`.
- **What worked and stays:** the write-ahead ledger and re-deriving every merge from `gh` (caught a by-design-red CI gate before a wrong merge and a running-LOC total two lanes had computed wrong); declared `.liveness` paths (every later STALL was correctly judged FALSE with no destructive action); per-lane arm stamps verified live; `git merge-base --is-ancestor` before any branch deletion (zero incidents across ~15 close-outs); batching several stories into one lane and one operator review sitting (zero relay round-trips).

### Superseded mechanisms (do not reintroduce)

| retired | replaced by |
|---|---|
| `lanes.sh send` (tmux `paste-buffer` + input-line drain heuristics, ~70 lines) | `SendMessage(to: "forge-<lane>")` |
| launch confirmed by pane text / empty input line | launch confirmed by the session appearing in `claude agents --json` |
| LANE_IDLE from a `· done` pane marker; LANE_SHELL from a shell-prompt regex | roster `idle` + heartbeat age; `#{pane_current_command} != claude` |
| events grepping the ledger for OUTCOME/PARK prose | the lane's `OUTCOME` / `PARK` messages; the ledger stays the durable record |
| lanes de-registering themselves from `ACTIVE` | `lanes.sh launch/kill` own `ACTIVE` |
| a T1-authored per-campaign watcher (`watch-lanes.sh`) and hand-written lane addenda | `lanes.sh events` + `lane-protocol.md` |
| questions asked in a lane's window | PreToolUse hook → `PARK` message → `AskUserQuestion` in T1's session only |
| `claude --bg` background sessions (considered 2026-08-30) | not adopted: identical blocked-on-dialog behaviour, no operator terminal tab, `claude logs` is raw ANSI; tmux keeps the operator's window and pane log |
