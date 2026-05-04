# Loop Adapters

> Placeholder for alternative loop runtimes that can be A/B-tested against `loops/ralph/`.

## Intent

The Ralph loop is the default and currently the only runtime, but the underlying agent (Claude Agent SDK) is one of several plausible choices. When a real need arises to evaluate an alternative, drop a new adapter here implementing the `LoopInput` / `LoopResult` interface in [`loops/README.md`](../README.md).

## Candidates (in research-priority order)

1. **Aider** — atomic-commit ethos, model portability. Adapter would shell out to `aider --message`. Strongest runner-up to Ralph for forge.
2. **Hermes Agent** — persistent-memory model. Worth evaluating only if its memory complements (rather than competes with) the brain.
3. **OpenHands** — heavyweight; adopt only if forge needs its k8s/parallel-1000s scale, which it doesn't today.
4. **OpenClaw** — opinionated app, conflicts with `skills/` directory. Lowest priority.

## Adding an adapter

1. Create `loops/<name>/` with `runner.ts`, a README, and any templates.
2. Implement the `LoopInput` / `LoopResult` interface in `loops/README.md`.
3. Add an ADR documenting the why (alternative considered, decision, consequences).
4. Add cases under `benchmarks/developer-loop/` for head-to-head A/B against Ralph.
5. Wire as a config option (`forge.config.json` → `loop.runtime: 'ralph' | '<name>'`).
