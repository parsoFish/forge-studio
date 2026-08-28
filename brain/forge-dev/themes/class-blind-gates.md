---
title: One gate profile for every change class fails docs work on code criteria and passes config work on none
description: >-
  A single gate profile applied to code, docs, config and infra alike judges each
  by criteria meant for another. The four standing acceptance criteria were
  class-blind for exactly this reason. The fix is a typed class field on the
  manifest, confirmed at the plan gate and inherited by every work item, with ONE
  data table mapping class to gate profile — not per-flow special cases.
category: decision
keywords:
  - change-class
  - gate-profile
  - class-blind
  - standing-acceptance-criteria
  - docs-class
  - manifest
  - plan-gate
  - gate-recipes
  - data-table
created_at: 2026-08-28
updated_at: 2026-08-28
related_themes:
  - agent-authored-gates-are-self-grading
  - merge-gate-fail-open
  - exploration-vs-implementation-initiatives
---

# Class-blind gates judge every change by the wrong criteria

Forge ran one gate profile over every initiative, whatever it changed. A docs initiative got judged on code criteria it could not satisfy; a config initiative got judged on criteria that did not apply to it at all, and so passed on nothing. The **four standing acceptance criteria** were class-blind in exactly this way — attached to every initiative regardless of what it touched, which makes them ceremony on three classes out of four.

The symptom looks like flakiness ("the gate is wrong for this one, override it"), and the override is what actually rots: once a gate is routinely overridden it has stopped being a gate.

## The rule

1. **`class: code | docs | config | infra` is a typed field on the manifest.** The architect sets it; the operator **confirms it at the plan gate**; every work item inherits it. It is data, not an inference — a heuristic that sniffs the diff gets it wrong on the initiative that matters.
2. **ONE data table maps class → gate profile.** The profile decides: iter-0 fail-first, the required-paths source, which `testProcess.*` runs at the merge boundary, whether to capture, which review lenses apply, whether to reflect, and whether a single work item is allowed. One table, not per-flow special cases — the moment two places encode the mapping they drift.
3. **A flow declares which classes it accepts**, and the plan gate checks the pair. That is what makes architect → flow one-to-many without a routing heuristic.
4. **Language detection is not class detection.** `gate-recipes.ts`-style language sniffing answers "what is this written in", never "what kind of change is this" — the two are independent, and conflating them is how a Go repo's docs initiative ends up running the Go test suite as its acceptance gate.

## Why a table and not a rule per flow

The pressure is to special-case: this flow needs capture, that one does not. Each special case is locally correct and collectively unreadable, and nothing can then answer "what does a docs change have to pass?" without reading every flow. One table makes the answer greppable and makes adding a class a data edit.

## Sources

- `docs/superpowers/specs/2026-08-28-forge-1-0-blueprint-design.md` §5.1 — the typed `class` field and the class → gate-profile table; §5.8 — a flow registers the manifest classes it accepts; §5 "Rebuild or cut" — the four class-blind standing ACs and `gate-recipes.ts` language detection.
- `docs/roadmaps/1.0.md` §4 M5 Lane A — the class → gate-profile table is authored by the operator (park point H7).

## See also

- [[agent-authored-gates-are-self-grading]] — a gate nobody independently runs.
- [[merge-gate-fail-open]] — a gate that reports pass on its own error.
