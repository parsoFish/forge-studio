# User feedback — send-back-loop-bash

## Answers

- The two-round send-back was avoidable. Round 1 was a missing assertion in
  the demo (no-side-effects check); round 2 was the agent's failure to
  regenerate the recording after editing cmd_apply.sh. The pattern: editing
  the implementation but not the demo bundle in the same iteration.
- The reviewer's iteration cap held — 3 iterations, approved on round 3.
  This is the maximum send-back loop without breaching the cap.

## Free-form

The bash project's BATS test runner integrates cleanly. Worth noting that
non-TS projects survive the same review rubric without project-type-specific
adjustments.
