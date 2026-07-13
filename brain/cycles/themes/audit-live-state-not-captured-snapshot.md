---
title: Audit against live state, never a captured snapshot
description: Forge's own artifacts (local clones, reflection archives, retro cost figures) are point-in-time snapshots that silently go stale; any audit must re-derive facts from the live source of truth (origin, current _queue/done, raw events.jsonl).
category: operation
keywords: [ground-truth, stale-snapshot, local-clone, origin-vs-local, audit-methodology, retro-drift, re-derivation, events.jsonl]
created_at: 2026-07-13
updated_at: 2026-07-13
related_themes: [jsonl-event-log, reflector-completion-requires-artifact-diff]
---

# Audit against live state, never a captured snapshot

- **Evidence**: betterado 2026-07 holistic review (git history). The endstate audit corrected an outcomes-ledger "v2.0.0 tag missing" finding — the tag + signed Release existed on origin; the audit's local clone was simply behind. Prior-retro dollar figures drifted 2–4× from a fresh `events.jsonl` re-derivation.

Forge never automatically revalidates its own snapshots. The moment a later merge,
fix, or event lands, a captured document (local git clone, reflection archive,
retro cost estimate) lies quietly rather than loudly. Any audit, investigation, or
reflection that asserts a fact about "current state" — a tag exists, an initiative
merged, a cost figure — must **re-derive it from the live source** (origin remote,
current `_queue/`/`done/`, raw `events.jsonl`), not trust a previously-captured
write-up, even a recent one authored in good faith.

This is sharpest for cost/waste narratives: wall-clock or cycle-total figures get
casually conflated with the dollar cost of a specific sub-event (e.g. attributing a
crash-loop's whole cycle cost to the crash-loop burst, when the burst was free).
When in doubt, recompute from the mechanical log.

## See also

- [[jsonl-event-log]] — the re-derivation source of truth.
- [[reflector-completion-requires-artifact-diff]] — the done/-vs-archive reconciliation this motivates.
