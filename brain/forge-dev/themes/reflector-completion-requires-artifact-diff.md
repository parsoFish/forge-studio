---
title: A completion event is not proof of persistence — diff should-exist vs does-exist
description: An end event's status/output_refs can be wrong; forge needs a mechanical diff between what should have produced an artifact (e.g. done/ initiatives) and what actually did (archived reflections) to catch silent loss.
category: decision
keywords: [reflector-pipeline, output_refs, phantom-metadata, silent-loss, done-vs-archive-diff, self-reported-completion]
created_at: 2026-07-13
updated_at: 2026-07-13
related_themes: [quality-gates-orchestrator-verified, orchestrator-owned-execution-beats-heuristic-verification]
---

# A completion event is not proof of persistence

- **Evidence**: betterado 2026-07 reflection-triage (git history). Across the sample: `done/` initiatives with no reflection archive (some never invoked, some crashed/budget-exhausted yet still emitting success-implying metadata), phantom `output_refs`, and feedback-not-consumed reruns — "nothing diffs `done/` against the archive set." Fixes landed 2026-07-11 (done-vs-archive lint diff, reflector re-emission clause).

Trusting a phase's own `end` event — status=complete, `output_refs` pointing at an
artifact — as proof that work was persisted is the **same self-report trust gap**
that [[quality-gates-orchestrator-verified]] rejects for pass/fail, applied to
*output* claims. Initiatives reached `done/` with no corresponding archive,
sometimes with metadata implying success anyway.

The durable fix is a mechanical reconciliation: **diff the set that should have
produced a downstream artifact (every `done/` initiative) against the set that
actually did (every archived reflection)**, at lint time or periodically, rather
than trusting any single event's self-reported completion. This generalizes to any
phase whose "I persisted X" claim isn't independently checked against X existing.

## See also

- [[quality-gates-orchestrator-verified]] — the pass/fail version of the self-report gap.
- [[orchestrator-owned-execution-beats-heuristic-verification]] — the same principle for evidence execution.
