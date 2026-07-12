---
title: ralph brainReads=0 — 7th consecutive cycle on betterado
description: All 6 ralph sessions in this cycle had brainReads=0; the live-acc auth error (WI-6, 173 bash calls) and per-type CaptureLiveEvidence requirement were re-derived from scratch despite being documented in profile.md and prior themes.
category: antipattern
keywords: [brainreads, ralph-sessions, zero-brain-reads, re-derived, profile-md, dev-loop]
related_themes: [ralph-brain-reads-index]
created_at: 2026-07-10T12:31:01.000Z
updated_at: 2026-07-10T12:31:01.000Z
---

## Observation

INIT-2026-07-01-new-api-test: all 6 ralph sessions had `brainReads: 0`.

| WI | iters | reads | brainReads | bashCalls |
|---|---|---|---|---|
| WI-1 | 1 | 7 | 0 | 21 |
| WI-2 | 1 | 6 | 0 | — |
| WI-3 | 1 | 3 | 0 | — |
| WI-4 | 1 | 10 | 0 | — |
| WI-5 | 1 | 19 | 0 | — |
| WI-6 | 2 | 28 | 0 | 173 |

WI-6 required 2 iterations and 173 bash calls to resolve a live-acc auth error (`Error creating test plan — You are not authorized to access this API`). This is consistent with the PAT scope / area-path permission pattern documented in profile.md under `Gotchas`.

The per-type `CaptureLiveEvidence` requirement (profile.md `Hollow acceptance gate` section) was also not in the WI-6 spec and was re-caught only by the unifier gate.

## Recurrence count

This is at least the 7th consecutive cycle on betterado with `brainReads: 0` for all ralph sessions. Prior occurrences documented in:
- `2026-06-08-dev-loop-zero-brain-reads-persistent` (forge antipattern)
- `2026-06-20-ralph-zero-brain-reads-on-documented-gotchas` (betterado project)
- `2026-07-01-ralph-zero-brain-reads-framework-migration-gotchas` (forge antipattern — 6 sessions)

## Structural note

Per `brain-read-policy`: dev-loop MUST NOT read the brain. Fix lever is PM embedding relevant gotcha excerpts directly in WI acceptance criteria. For live-acc WIs on betterado specifically:
- Embed the per-type CaptureLiveEvidence label format in the AC
- Note that the standing demo project uses specific area paths requiring PAT scope validation

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-test/events.jsonl` — all `ralph.end` events with `brainReads:0`
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-new-api-test.md`
