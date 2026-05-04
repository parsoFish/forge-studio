---
name: architect-llm-council
description: Multi-perspective critic chain (CEO/eng/design/DX) that auto-resolves mechanical questions about an initiative and surfaces only taste decisions for the user.
phase: architect
surface: interactive
model: claude-sonnet-4-6
---

# Architect — LLM Council

## Single responsibility

Take a draft initiative spec from the architect and run it through a chain of perspective-specific critics. Resolve mechanical issues automatically. Escalate only the *taste* decisions to the user. Inspired by gstack's `/autoplan`.

## Required first action

Invoke `brain-query` with:

- "What council critique patterns are in the brain — what do CEO/eng/design/DX critics typically catch?"
- "What antipatterns has the brain captured for the type of initiative being drafted?"

## Inputs

- A draft initiative spec (markdown + frontmatter, in-memory or path).
- Project context: `brain/projects/<name>/profile.md`, `projects/<name>/roadmap.md`.

## Outputs

- A revised initiative spec with mechanical issues fixed.
- A list of *taste decisions* surfaced to the user (each: question + 2-4 options + rationale per option).
- A chain-of-critique log appended to the architect's event-log entries.

## Event-log entries to emit

- `council.start` — chain begun.
- `council.critic` — one event per critic invocation (which critic, what it flagged).
- `council.auto-resolve` — one event per mechanical fix applied.
- `council.escalate` — one event per taste decision surfaced to the user.
- `council.end` — chain complete.

## Benchmark suite

[`benchmarks/architect/`](../../benchmarks/architect/) — shared with the architect skill.

## The critics

Each critic is invoked as a sub-agent via the Claude Agent SDK. Order matters:

1. **CEO critic** — does this initiative align with the project's stated direction? Is the value proposition clear? Is it the most leveraged thing right now?
2. **Eng critic** — are dependencies explicit? Are acceptance criteria verifiable? Is the scope atomic enough for the developer loop?
3. **Design critic** — for user-facing initiatives: is the experience considered? For non-UI: skip.
4. **DX critic** — does this make the project easier or harder to work on? Are migrations / deprecations handled?

## Decision rules

- **Mechanical** (auto-resolve): missing acceptance criteria, ambiguous scope, undeclared dependency, missing rollback note. The council fills these in and notes the change.
- **Taste** (escalate): which of two valid framings to pick, scope cuts vs deferring, naming, prioritisation. The user decides.

## Process

1. Brain query first.
2. Run critics in order. Each critic emits `flags: []` (mechanical issues to auto-resolve) and `escalations: []` (taste decisions for the user).
3. Apply auto-resolutions. Re-run the affected critic to confirm the fix.
4. Aggregate escalations. De-dup. Order by severity (CEO > Eng > DX > Design by default; adjust per project).
5. Return revised spec + escalation list to the calling architect skill.

## Constraints

- **Don't ask the user about anything mechanical.** The point is to free up their attention for the decisions only they can make.
- **Don't invent new requirements.** Critics improve what's there; they don't expand scope. Scope expansion goes back to the user as an escalation.
