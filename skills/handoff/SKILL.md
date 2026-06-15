---
name: handoff
description: Compress the current session into a markdown transfer document — open threads, decisions made, and context consumed — so another agent or a human can resume without re-deriving state.
---

# Handoff

> Forge-adapted from Matt Pocock's "Handoff" skill (superpowers ecosystem, ~228k★).
> An Encoded-Preference skill: it shifts behaviour (durable state capture), not capability.

## When to use

- Approaching a context-budget limit mid-work-item (before a strategic compaction).
- Handing a partially-complete unit to the unifier, a resume, or the operator.
- Any point where losing the in-flight reasoning would force expensive re-derivation.

## What it does

Write a single, greppable transfer document capturing **only** what cannot be recovered from the
code and git history:

- **Goal + current status** — what this unit is delivering and where it stands.
- **Decisions made** — the non-obvious choices and *why* (so they are not re-litigated).
- **Open threads** — what is unresolved, with the next concrete action for each.
- **Landmines** — anything tried that failed, so the next agent does not repeat it.
- **Context consumed** — which files/artifacts have been read, so the resume is targeted.

Omit anything inferable from reading the code. Keep it tight — brevity is the signal.

## Output

`HANDOFF.md` (or the cycle's scratch state file) at the worktree root. Preserve code, error
strings, and paths byte-faithfully.

## Sources

Matt Pocock — "Handoff" / obra/superpowers. Adapted to forge's worktree + resume model
(complements `superpowers:strategic-compact`).
