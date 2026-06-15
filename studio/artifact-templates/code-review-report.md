---
id: code-review-report
name: Code Review Report
kind: file
producer: code-reviewer
consumer: review
schema:
  requiredFiles:
    - code-review-report.md
  requiredFields:
    - findings
---

# Code-review-report artifact contract

The code-reviewer agent's structured pre-human review of the PR branch:
`findings[]` (`severity` ∈ critical|high|medium|low, `category` ∈
security|architecture|coverage|style, `file`, `line`, `message`, `fix`) plus a
`## Verdict` line (`clean` | `findings`). Consumed at the verdict gate so the human
handles exceptions rather than reading every line.

- **Producer:** code-reviewer (the automated review node).
- **Consumer:** the `review` verdict gate.
