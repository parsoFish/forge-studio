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

<!-- Which areas does this touch? Layout: ARCHITECTURE.md -->

- [ ] Platform packages (`packages/*`)
- [ ] Apps (`apps/forge`, `apps/studio`)
- [ ] Definitions and knowledge (`skills/`, `studio/`, `brain/`)
- [ ] A managed project (`projects/`, `brain/projects/`)
- [ ] Repo tooling (`scripts/`, `.github/`, `.claude/`)

## Docs impact

<!-- Pick one. A user-facing change updates the page that covers it.
     Generated pages (story how-tos) are never hand-edited: re-run the story. -->

Docs impact: [ ] none — <reason>  [ ] updated: <pages>  [ ] generated (story re-run)

## Gate checklist

- [ ] `npm run build` — zero errors
- [ ] `npm test` — full suite green
- [ ] `forge studio lint` — zero errors
- [ ] `forge brain lint` — zero errors
- [ ] `npm run stories` — run if this PR touches `apps/studio/` or any
      Studio-surfaced behaviour a story drives (a story beat is the referent;
      the legacy journey harness was retired in 7.6.131)
- [ ] Commit messages are conventional commits throughout (`feat:`, `fix:`,
      `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`)
- [ ] No AI-attribution lines (`Co-authored-by: Claude`, etc.) in any commit
      message

## Notes for reviewers

<!-- Risk areas, deliberately deferred follow-ups, anything a reviewer needs
     to know before approving. -->
