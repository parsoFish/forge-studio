---
title: Ralph stop-hook pattern vs bash-loop pattern
description: >-
  Two implementations of Ralph — outer bash loop (ghuntley canonical) vs
  Stop-hook within a single Claude Code session (Anthropic plugin). Different
  operational properties.
category: pattern
keywords:
  - ralph
  - stop-hook
  - bash-loop
  - anthropic-plugin
  - claude-code
  - single-session
  - completion-promise
created_at: 2026-05-04T18:00:00.000Z
updated_at: 2026-05-04T18:00:00.000Z
related_themes:
  - ralph-loop-pattern
  - claude-agent-sdk
---

# Ralph stop-hook pattern vs bash-loop pattern

Ralph has two canonical implementations with meaningfully different operational properties:

## Bash-loop pattern (ghuntley canonical)

```bash
while :; do cat PROMPT.md | claude-code; done
```

Each iteration is a **fresh Claude Code session**. Context is reloaded from PROMPT.md, specs/, fix_plan.md every time. Memory is files. Stop conditions are operator-judged or test-suite-driven outside the loop. Model retains nothing across iterations except what files it reads. The Vercel `ralph-loop-agent` is a TS reification of this — `iterationCountIs`, `tokenCountIs`, `costIs` make budgets first-class; `onIterationStart` / `onIterationEnd` callbacks expose lifecycle.

## Stop-hook pattern (Anthropic plugin)

```bash
/ralph-loop "Your task" --completion-promise "DONE" --max-iterations 50
```

A **Stop hook** intercepts Claude's exit attempts within a single session. The hook blocks exit, feeds the same prompt back, and Claude continues. Persistent context (the SDK's session) is preserved across "iterations." Stop = exact-string match on `--completion-promise` (e.g. `<promise>COMPLETE</promise>`) or `--max-iterations` cap. `/cancel-ralph` is the manual abort.

## Trade-offs

| | Bash-loop | Stop-hook |
|---|---|---|
| Context | reloaded per iteration | preserved across iterations |
| Cost | predictable; clear iteration boundary | session-cumulative; harder to bound |
| Stop conditions | external (test suite, file state) | exact-string completion promise |
| Loops | OS-level; survives Claude Code crashes | bound to one session |
| Best for | long-running unattended (forge) | interactive `/ralph-loop` invocations |

Forge v2 uses the **bash-loop pattern** (ADR 002) so iteration is auditable per-iteration and cycles can survive scheduler restarts.

## Sources

- [`ralph-ghuntley.web.md`](../../_raw/web/ralph-ghuntley.web.md) — bash-loop canonical.
- [`ralph-anthropic-plugin.web.md`](../../_raw/web/ralph-anthropic-plugin.web.md) — stop-hook implementation.
- [`ralph-vercel-agent.web.md`](../../_raw/web/ralph-vercel-agent.web.md) — TS bash-loop reification.

## See also

- [[ralph-loop-pattern]] — the underlying pattern.
- [[claude-agent-sdk]] — what stop-hook hooks into.
