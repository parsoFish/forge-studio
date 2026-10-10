---
title: Adversarial review reports stale findings in rounds 2+ after send-back
description: After a send-back the adversarial reviewer re-derives its view of HEAD each round — reporting already-delivered work as MISSED and repeating prior-round majors that are no longer true, giving operators false signals in every round beyond the first.
category: antipattern
keywords: [adversarial-review, send-back, stale-findings, false-positive, review-round, forge, gate, honest-baseline]
created_at: 2026-10-10T09:30:00Z
updated_at: 2026-10-10T09:30:00Z
related_themes: [2026-10-10-all-wis-rerun-on-send-back, 2026-08-22-verifier-without-a-repro-produces-agreement]
---

# Adversarial review reports stale findings in rounds 2+ after send-back

## What happened

gitweave I1 adversarial review ran 3 rounds:
- Round 1 (after dev-loop 1): flagged 3 of 242 actual failures. Most real failures NOT surfaced.
- Round 2 (after dev-loop 2 / WI-6+7): reported WI-7's already-delivered work as MISSED; also repeated round-1 blocking comments that were false at the current HEAD.
- Round 3 (after dev-loop 3 / WI-7+8): same pattern — reported WI-8's delivered work as MISSED.

The operator validated state independently via a fresh-clone `python3 -m pytest tests/` run. The forge adversarial review's per-round report was unreliable as a correctness signal by round 2.

## Why it matters

An operator relying on the adversarial review's round 2/3 output would:
- Block merge on already-fixed issues (false positives).
- Miss real problems the review failed to surface even in round 1 (false negatives from round 1).
- Have no reliable signal of when the tree is actually clean.

The adversarial reviewer's brief does not instruct it to diff its current findings against prior rounds. Each round is a fresh assessment that includes the new commits but also appears to re-raise stale items.

## What would fix it

Two independent mitigations:
1. **Per-round diff:** the adversarial reviewer's brief should include the prior round's blocking comments and explicitly require: "mark each prior comment as resolved/unresolved based on HEAD — do not re-raise resolved ones."
2. **Operator-side:** treat the adversarial review as a sampler, not an oracle. Use the honest-baseline gate (full suite on a fresh clone) as the correctness signal; the review is a reasoning supplement.

Reference: forge bead forge-mfv5.1.30 tracks this fix.

## See also

- [[2026-10-10-all-wis-rerun-on-send-back]] — companion forge-machinery gap triggered by the same send-back flow
- [[2026-08-22-verifier-without-a-repro-produces-agreement]] — broader class: verifiers that return agreement, not verification

## Sources

- `_logs/2026-10-10T01-55-59_INIT-2026-10-10-i1-honest-baseline/events.jsonl` (3 adversarial-review events; review-comments rounds 1-3)
- `_logs/2026-10-10T01-55-59_INIT-2026-10-10-i1-honest-baseline/user-feedback.md` (operator Q2 clarification)
- `brain/cycles/_raw/2026-10-10T01-55-59_INIT-2026-10-10-i1-honest-baseline.md`
