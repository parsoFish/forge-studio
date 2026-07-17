## Summary

<!-- One or two sentences: what does this PR do and why. -->

## Title

<!-- The PR title itself must be a conventional commit:
     feat|fix|refactor|docs|test|chore|perf|ci: <description> -->

## One concern per PR

<!-- Each PR touches one seam, one fix, or one phase (see CONTRIBUTING.md).
     If this PR is part of a stack, link the base PR here. Stacked PRs are
     fine — never squash-merge a stacked PR. -->

## Scope

<!-- Which of the three scopes does this touch? See docs/repo-map.md -->

- [ ] Scope 1 — framework/orchestration (`orchestrator/`, `cli/`, `loops/`, `forge-ui/`)
- [ ] Scope 2 — cycles/agents/flows (`skills/`, `studio/`, `brain/forge-dev/`, `brain/cycles/`)
- [ ] Scope 3 — a managed project (`projects/`, `brain/projects/`)

## Gate checklist

- [ ] `npm run build` — zero errors
- [ ] `npm test` — full suite green
- [ ] `forge studio lint` — zero errors
- [ ] `forge brain lint` — zero errors
- [ ] `npm run ui:journey` — run if this PR touches `forge-ui/`,
      `scripts/e2e-journey.mjs`, or any Studio-surfaced journey (see the
      `journey-sync` skill for what counts as in scope)
- [ ] Commit messages are conventional commits throughout (`feat:`, `fix:`,
      `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`)
- [ ] No AI-attribution lines (`Co-authored-by: Claude`, etc.) in any commit
      message

## Notes for reviewers

<!-- Risk areas, deliberately deferred follow-ups, anything a reviewer needs
     to know before approving. -->
