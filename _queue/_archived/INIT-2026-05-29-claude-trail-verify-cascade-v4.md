---
initiative_id: INIT-2026-05-29-claude-trail-verify-cascade-v4
project: claude-harness
project_repo_path: /home/parso/forge/projects/claude-harness
created_at: '2026-05-29T19:00:00.000Z'
iteration_budget: 8
cost_budget_usd: 6
phase: pending
origin: architect
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-29-claude-trail-verify-cascade-v4
resume_from: unifier
previous_failure_modes:
  - requeued-from-in-flight-2026-05-29
  - requeued-from-in-flight-2026-05-29
features:
  - feature_id: FEAT-1
    title: 'Tail parser — read events.jsonl, return last N events'
    depends_on: []
  - feature_id: FEAT-2
    title: 'Tail sinks (compact text + JSON array, kept distinct)'
    depends_on:
      - FEAT-1
  - feature_id: FEAT-3
    title: Tail CLI wiring plus golden tests and edge cases
    depends_on:
      - FEAT-2
---

# INIT-2026-05-29-claude-trail-verify-cascade-v4 — verification cycle v4

> **Verification cycle — explicitly throwaway work.** v4 of the cascade
> verification, run after the 2026-05-29 forge thinning (three-brain
> restructure + brain-paths SSOT + category→brain rule). Purpose: prove
> the prior changes ship cleanly through a real end-to-end cycle.
>
> Specifically this cycle exercises:
>   1. **brain-paths SSOT routing** — reflection must write the project's
>      learned themes to `projects/claude-harness/brain/themes/` (Brain 3)
>      and any cross-cycle theme to `brain/cycles/themes/` (Brain 2),
>      routed through `orchestrator/brain-paths.ts` helpers. No writes to
>      stale `_raw` literals or a `brain/forge/themes` path.
>   2. **category→brain rule** — every theme the reflector emits lands in
>      the correct sub-wiki for its category (pattern/antipattern/operation
>      → cycles; decision/reference → forge-dev). `forge brain lint`
>      should stay error-free afterward.
>   3. **dev-loop / reviewer brain-read policy** — the dev-loop and
>      reviewer may consult the cycle's Brain 3 (the project's own
>      `brain/`) as advisory context but must NOT read the forge brain
>      (Brains 1+2).
>   4. **cost-tick null-sentinel fix** — cost ticks emit cleanly across
>      the cycle (no debounce regression).
>   5. **Cascading UI + status colours** — same as v3; should look the
>      same in the captured frames.

## What this ships

A new `claude-trail tail <cycle-dir>` subcommand that prints the last N
events of a cycle in two formats (compact text + JSON), newest last:

```
$ claude-trail tail _logs/2026-05-25T...
[architect]       start
[architect]       end
[project-manager] start
[developer-loop]  wi.start FEAT-1-WI-1
[developer-loop]  wi.end   FEAT-1-WI-1
... (last 10 by default)

$ claude-trail tail --json _logs/2026-05-25T...
[{"phase":"architect","event_type":"start"}, ... ]
```

Strictly read-only; no I/O outside the supplied cycle dir.

## Constraints

- TypeScript + `node --test --experimental-strip-types`. No new deps.
- New code lives in a NEW `src/tail.ts`; do NOT modify `src/stats.ts`,
  `src/probe.ts`, or `src/filter*.ts`.
- Each WI declares its own sharp `quality_gate_cmd` pointing at a NEW
  test file under `tests/tail-*.test.ts`.
- Existing tests must keep passing.

## Acceptance

- `claude-trail tail <fixture>` prints the last 10 events in the compact
  `[phase] event_type [detail]` format, oldest-to-newest.
- `claude-trail tail --n 3 <fixture>` prints exactly the last 3 events.
- `claude-trail tail --json <fixture>` emits a JSON array of the same
  events.
- Empty or malformed cycle dirs fail with a clear non-zero error (no
  stack trace dump).
- All new tests under `tests/tail-*.test.ts` pass; existing tests still
  pass.

## Decomposition hint (PM)

Same shape as v3 — three features with deliberately different WI counts
so the cascade canvas tier varies:

- **FEAT-1** is a thin parser — one WI for events.jsonl → last-N slice.
- **FEAT-2** has two distinct sinks (compact text formatter + JSON
  formatter). Keep them separate WIs — different acceptance criteria.
- **FEAT-3** spans three concerns: the CLI wiring (with `--n` and
  `--json` flags), the golden test, and an edge-case test for empty or
  malformed cycle dirs. Three WIs.

Use brain-query against `projects/claude-harness/brain/themes/` for
sizing references from past successful cycles.
