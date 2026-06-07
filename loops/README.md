# Loops

> Agentic loop runtimes. Default: `ralph/` (Ralph loop pattern over Claude Agent SDK).

## Why a loop abstraction at all

The developer phase needs an **iterative agent runtime**: write code, run gates, fix what's broken, repeat. Rather than hand-roll this, we adopt the Ralph loop pattern (a community pattern, not a library) over the Claude Agent SDK.

We keep it behind a thin abstraction so we can A/B-test alternative loop runtimes when they look promising — see [ADR 002](../docs/decisions/002-ralph-loop-pattern.md).

## The loop interface

Every loop runtime under `loops/<name>/` exposes the same shape:

```ts
type LoopInput = {
  workItemSpecPath: string;           // path to the work item markdown
  worktreePath: string;               // git worktree to operate in
  initiativeBudget: { iterations: number; usd: number };
  brainQueryResults: string;          // initial institutional memory
  cycleId: string;                    // for event-log correlation
  initiativeId: string;
};

type LoopResult = {
  status: 'complete' | 'failed';
  iterations: number;
  cost_usd: number;
  duration_ms: number;
  artifacts: { agentMdPath: string; fixPlanPath: string };
};

export async function run(input: LoopInput): Promise<LoopResult>;
```

`developer-ralph` skill calls into the configured runtime (Ralph by default) via this interface.

## Runtimes

### `ralph/` — Default

Ralph loop over Claude Agent SDK. See [`ralph/README.md`](./ralph/README.md).

