---
plan: 07-general-logging-ids
councilled_at: 2026-05-21
critics: ceo, eng, design, dx
---

# Council review — 07-general-logging-ids

## Headline

Two cohesive but **distinct** refinements bundled in one doc — both grounded in real artifacts, both reasonably scoped — but the logging plan is materially larger (new event types, two new deps, a TUI) than the IDs plan (one JSON file + a resolver). Recommend splitting into 07a (logging-UX) and 07b (init-IDs) so they can land independently; the IDs plan is small enough to ship in a day, while the TUI deserves its own iteration arc. Biggest substantive concern: `agent_heartbeat` and `cost_tick` change the **shape of the log writer** (synthetic + throttled events) and need a clean place to live that doesn't violate ADR-008's single-writer / refs-not-contents discipline.

## Mechanical flags

### `ceo:01-bundled-scope`
**Issue:** Doc title is "Logging UX + Init IDs" — those are two refinements with disjoint surfaces (logging touches `logging.ts`, scheduler, monitor, new CLI verb; IDs touch CLI mint sites, a new registry, slash-command argument hints). They share zero code paths. Bundling forces an all-or-nothing review.
**Proposed fix:** Split into `07a-logging-ux.md` and `07b-init-ids.md`. IDs is ~1 day of work and zero new deps; logging is multi-day with two new deps and a benchmark suite — different risk profiles, different reviewers.

### `eng:01-event-writer-contract-drift`
**Issue:** `cost_tick` is described as "derived; emitted by logger as a rolling sum on each costed event" — this makes the **logger** stateful (it must hold a running cost sum keyed by `cycle_id` and `work_item_id`). ADR-008 / `brain/forge/themes/jsonl-event-log.md` describe the writer as "append-only, line-buffered, single writer" — stateful aggregation in the logger is a meaningful shift that should be called out and decided.
**Proposed fix:** Emit `cost_tick` from a **derived** consumer (e.g. a small in-process aggregator that subscribes to the existing `tee` hook), not from `logging.ts` itself. Keeps the writer dumb. Same path metrics.ts already uses.

### `eng:02-pino-pretty-schema-mismatch`
**Issue:** `pino-pretty` expects pino's field shape (`level`, `time`, `msg`, `pid`, `hostname`). Forge's `EventLogEntry` has `event_type`, `phase`, `skill`, `event_id` (ULID), `cycle_id`, etc. The plan says "a thin adapter that maps event_type → pino level" — that's underspecified. The adapter either rewrites every line into pino shape (extra IO if used in a tail pipeline) or configures `pino-pretty` with a `customLevels` + `messageFormat` template aggressive enough to render arbitrary keys. Both work; pick one.
**Proposed fix:** Sketch the actual `pino-pretty` invocation in the plan — exact `messageFormat` string and `customLevels` map. Otherwise this is the "innocent adapter" that quietly becomes 200 lines.

### `eng:03-file-change-tap-source`
**Issue:** Open question #5 (Edit/Write tool-use hook vs `chokidar`) is correctly framed but **must be answered before the bench is meaningful** — `events-coverage.test.ts` will assert ≥1 `file_change` event, and that test's fixture differs depending on tap source. This is decision-blocking, not deferrable.
**Proposed fix:** Recommend tool-use stream as the primary (deterministic, attributable to a work item, agent-driven only); add `chokidar` only if a future need surfaces. State this in the plan rather than leaving it open.

### `eng:04-heartbeat-emit-site`
**Issue:** "Throttled emitter inside Ralph runner" — Ralph runner is `loops/ralph/runner.ts`, which is **agent-loop logic**, not logging infra. Placing the heartbeat ticker there couples liveness to the runner's internal scheduling. If the runner is awaiting an SDK call (the common silent stretch), in-runner setInterval may not get a tick.
**Proposed fix:** Emit heartbeats from the **SDK call site** (the Claude Agent wrapper in `loops/ralph/claude-agent.ts`) where the in-flight query is visible — or from a sidecar timer in the orchestrator. Verify with a smoke test that 15s silence produces an event.

### `design:01-watch-no-cycle-yet`
**Issue:** Plan covers "no events yet" implicitly (`forge watch <id>` after enqueue but before scheduler claims it). What does the pane show? Empty event tail + heartbeat age = ∞ is a confusing first impression.
**Proposed fix:** Show a "waiting for scheduler to claim — queue position N" header pane state when `_logs/<ts>_<canonical>/` doesn't exist yet; transition automatically when it does.

### `design:02-watch-after-cycle-done`
**Issue:** `forge watch <id>` on a completed initiative — does it show the final state and exit, or scroll the historical tail? Replay mode (`--replay`) is mentioned for the demo script but not the default behaviour for finished initiatives.
**Proposed fix:** Default: if cycle is finished, render final state + last 50 events and exit on `q`; same TUI, just no live tail. Cheap.

### `dx:01-slash-command-handle-rollout`
**Issue:** Plan correctly notes slash-commands need `argument-hint` updates, but "coordinate with plans 02/05/06" is hand-wave. If 07b ships first (likely — it's small), 02/05/06 keep their canonical-only hints until they ship.
**Proposed fix:** Land the resolver + registry in 07b so handles work **even with old argument hints** — the resolver is consulted regardless of how the command is documented. Doc cleanup in 02/05/06 is then cosmetic.

### `dx:02-aliases-json-concurrency`
**Issue:** "Atomic writes via write-temp + rename" is correct for single-writer. But the daemon and a foreground `forge enqueue` can race (operator queues while daemon is also enqueuing a deferred mint). The plan says "single JSON file, append-only writes" but JSON isn't append-only — every write rewrites the whole file.
**Proposed fix:** Use a lockfile (`_queue/_aliases.json.lock` via `proper-lockfile` — battle-tested) for mints. Reads are unlocked. Or: SQLite. Pick one; don't hand-roll.

## Escalations

### [ceo] Should this ship as one plan or split (07a logging-UX / 07b init-IDs)?
- **Split** — different risk, different blast radius, different dep weight. IDs can land in a day with no new deps; logging is multi-day with two new deps. Splitting lets the IDs win arrive immediately.
- **Bundle** — both target operator UX, both stem from the same trafficGame driving session, the doc reads cohesively. Reviewer fatigue is already a constraint.
- **Recommended:** split. The 07b win is too cheap to gate on 07a.

### [design] Handle format — `traf#7` vs `traf-7` vs `T7` vs `@traf/7`?
- **`traf#7`** — proposed. One Shift key, doesn't collide with branch/path syntax. Slack-channel-like read.
- **`traf-7`** — looks like a Jira ticket; clean copy-paste; no shell-escape concerns; but visually merges with the canonical `INIT-...-trafficgame-...` form (the `-` becomes ambiguous between separator and prefix).
- **`T7`** — terse; tab-completes well; loses project disambiguation when projects share a leading letter (trafficGame + terraform-provider-betterado both start with `t`).
- **`@traf/7`** — npm-scope read; collides with shell path semantics in raw bash (`@` + `/`).
- **Recommended:** `traf#7` as proposed, with a note that 4-char prefixes already collide today (`traf` is fine; `bett`/`betterado` is fine; but a future "tracker" project would clash with "trafficGame" — mint with a digit suffix if so).

### [eng] `cost_tick` cadence — per-event roll-up vs fixed 5s tick?
- **Per-event roll-up** (proposed) — exact, no extra timer, but emits cost-tick lines into the firehose at the rate of costed events (could be 100s/cycle).
- **Fixed 5s tick** — bounded log growth, but lossy on bursty events.
- **Recommended:** per-event roll-up but de-bounced to 1/s max — and only if cost changed since last tick.

### [design] `forge watch` with no `<id>` — auto-attach or require?
- **Auto-attach** when exactly one initiative is in-flight; list + prompt otherwise.
- **Always require** for predictability.
- **Recommended:** auto-attach. Matches `git status` / `npm test` ergonomics where the obvious context wins.

## Per-critic verdict

### CEO
- flags: 1
- escalations: 1
- summary: Plan is strategically right (operator UX is the highest-leverage place to spend cycles right now — confirmed by the trafficGame driving session that surfaced these pains). But it's two plans pretending to be one; split.

### Engineering
- flags: 4
- escalations: 1
- summary: Tool choices (pino-pretty, blessed-contrib) are correct and battle-tested. Schema additions are tractable. Three real technical decisions are deferred to "open questions" but should be made in-plan: heartbeat emit site, file-change tap, cost_tick statefulness. ADR-008's single-writer discipline must be preserved — derived events (cost_tick) belong in a consumer, not the writer.

### Design
- flags: 2
- escalations: 1
- summary: The 4-pane layout is right; the failure modes (no-events-yet, cycle-finished) need spec'ing. Handle format is the one taste decision that benefits from operator vote.

### DX
- flags: 2
- escalations: 0
- summary: Migration story is sound — canonical stays authoritative, registry is additive, existing tests unchanged. Concurrency on `_aliases.json` needs a lock (don't hand-roll); slash-command rollout sequence is wrong-way-round and should be inverted (resolver first, doc cleanup later).

## Recommended next action for the operator

1. **Decide ceo:01** — split into 07a + 07b. (Recommended yes.)
2. **Answer the four open questions in the plan body** rather than deferring: handle format vote (`traf#7`), heartbeat cadence (15s default, configurable), file-change tap (tool-use stream), watch-no-id behaviour (auto-attach). These are taste decisions but they're blocking the bench fixtures.
3. **Ship 07b (init-IDs) first** — small, no deps, immediate ergonomics win, derisks the slash-command-rewrite coordination with plans 02/05/06.
4. **For 07a, address eng:01 + eng:04 before implementation** — decide where `cost_tick` and `agent_heartbeat` are emitted from, then build.
