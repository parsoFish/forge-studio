# Phase: Reflection

> *Human-in-the-loop, then unattended ingest.* Closes the learning loop by feeding cycle outcomes back into the brain.

## Purpose

After an initiative is merged, run a structured retrospective with three scopes:
1. **Agentic self-reflection** — the agent reviews its own performance from the JSONL event log.
2. **Agent-prompted user questions** — the agent asks the user only what it can't resolve.
3. **Pure user feedback** — the user's free-form observations.

All three feed the brain via `brain-ingest`, which is what makes forge improve cycle-over-cycle.

## Inputs

- `_logs/<cycle-id>/events.jsonl` (the full cycle log).
- `_logs/<cycle-id>/brain-gaps.jsonl` (questions the brain couldn't answer during the cycle).
- The merged initiative branch + PR + demo script.
- Brain knowledge (prior retros, established patterns).

## Outputs

- `_logs/<cycle-id>/retro.md` — structured retro doc.
- New / updated theme pages in `brain/forge/themes/` and `brain/projects/<name>/themes/`.
- New raw sources in `brain/_raw/cycles/<cycle-id>.md` (the cycle log archived).
- Append to `brain/log.md`.
- The initiative manifest moves to `_queue/done/`.

## Skills

- [`skills/reflector/SKILL.md`](../../skills/reflector/SKILL.md) — runs the retro.
- [`skills/brain-ingest/SKILL.md`](../../skills/brain-ingest/SKILL.md) — invoked by the reflector to write findings into the brain.

## Success signals

- **Brain-gap closure:** `brain-gaps.jsonl` items from the cycle are addressed (filled or escalated) in the retro.
- **Theme deltas:** retros result in concrete theme-page additions/updates (not just text "we should improve X").
- **Iteration trend:** median iterations / cost / wedge-rate trend down across consecutive cycles.
- **Antipattern capture:** any new antipattern discovered in the cycle becomes a `brain/forge/antipatterns.md`-indexed theme page.

## Benchmark suite

[`benchmarks/reflection/`](../../benchmarks/reflection/)
- `cycles/` — event-log fixtures → expected wiki ingest deltas (theme page list, antipattern list).
- `score.ts` — invokes the reflector skill, scores delta correctness.

## Known failure modes (to defend against)

- **Vague retros** — "we could do better at X." Reflector prompt requires concrete actions or theme-page deltas.
- **Reflection bypassed** — initiative marked done without retro. Orchestrator gates `done/` move on retro.md existence.
- **Brain growth without curation** — `brain-lint` runs at the end of every retro to catch new orphans / conflicts.

## TODO (post-scaffold)

- [ ] Define the retro.md template.
- [ ] Implement orchestrator gate: `done/` requires `retro.md` and `brain-lint` clean.
- [ ] Populate `benchmarks/reflection/cycles/` with 2-3 fixture cycles + expected deltas.
