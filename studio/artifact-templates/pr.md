---
id: pr
name: Pull Request
kind: file
producer: demo-agent
consumer: adversarial-review
schema:
  requiredFiles:
    - .forge/pr-description.md
    - demo/<initiative-id>/demo.json
    - demo/<initiative-id>/DEMO.md
  requiredFields:
    - title
    - acEvaluations
---

# PR artifact contract

The self-contained, demo-embedded pull request: a PR description plus the demo artifact
(`demo.json` → `DEMO.md`, ADR 021 schema; DEMO.html retired in F4), validated by `validateDemoModel` in the
`pr_self_contained` gate. `acEvaluations[]` (criterion → met/partial/missed + evidence) is the
intent-vs-outcome surface a human reviewer approves against — evidence, not a test-name table.

R4-10-F1 relocated the whole bundle onto the demo node: the demo agent authors `demo.json` AND
`.forge/pr-description.md` (the unifier's former job), and the pipeline renders `DEMO.md`. Requiring
all three on the `demo → adversarial-review` edge is the runtime guard that the PR-body relocation
actually happened — `openPrInline` hard-requires `.forge/pr-description.md` via `--body-file`, so a
missing one at demo close is caught here, before the review even runs. The `review` verdict gate
opens the PR from this bundle after the adversarial critique.

- **Producer:** demo-agent (authors the PR body + demo.json; R4-10-F1 — was developer-unifier).
- **Consumer:** adversarial-review (reads the bundle before critiquing), then the `review` verdict
  gate (which opens the PR) and the operator merging in GitHub.
