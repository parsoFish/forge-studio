---
id: pr
name: Pull Request
kind: file
producer: developer-unifier
consumer: review
schema:
  requiredFiles:
    - .forge/pr-description.md
    - demo/<initiative-id>/demo.json
    - demo/<initiative-id>/DEMO.html
  requiredFields:
    - title
    - acEvaluations
---

# PR artifact contract

The unifier's self-contained, demo-embedded pull request: a PR description plus the demo artifact
(`demo.json` → `DEMO.md`/`DEMO.html`, ADR 021 schema), validated by `validateDemoModel` in the
`pr_self_contained` gate. `acEvaluations[]` (criterion → met/partial/missed + evidence) is the
intent-vs-outcome surface a human reviewer approves against — evidence, not a test-name table.

- **Producer:** developer-unifier (commits + pushes, opens the PR).
- **Consumer:** the `review` verdict gate (and the operator merging in GitHub).
