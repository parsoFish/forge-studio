# User feedback — wedge-recovery

## Answers

- The wedge happened because the AC list had two **independent** edge-case
  guards (zero-sum-weights AND non-finite-weights) and the agent kept
  rewriting one in ways that broke the other. Three iterations spent
  oscillating between the two branches.
- The recovery attempt with fresh context succeeded in one iteration. The
  signal: when an agent wedges on an oscillation pattern, the cheapest
  recovery is fresh context, not more iterations.
- Total cost of the wedge: $1.38 ($1.38 + $0.32 recovery vs ~$0.42 if
  resolved on first attempt). 3.3x cost overhead.

## Free-form

Worth a brain theme on "fresh-context recovery beats more iterations when
the symptom is oscillation." Possible mitigation in PM phase: detect ACs
that introduce independent edge-case guards and split them into separate
WIs.
