# gitpulse — agent instructions (forge↔project contract C5 + C8)

> A dependency-free TypeScript CLI + (later) local dashboard that turns a git
> repo's history into engineering analytics. This file is human-authored —
> **forge must never create or overwrite it.**

## Build / test / lint (exact invocations)

```bash
npm install            # install tsx + typescript (dev-only)
npm run build          # tsc → dist/ (the CLI binary)
npm test               # the quality gate — fast PURE unit suite (node:test), < 1s
npm run acceptance     # builds if needed, runs the BUILT artifact vs a fixture repo, asserts
npm run demo           # acceptance + writes captured demo evidence into forge/history/
```

- **Quality gate (per dev-loop iteration):** `npm test`. One command, deterministic,
  creds-free, sub-second, PURE (no git spawning — parse/aggregate functions tested
  against fixtures). Must fail before the work exists and pass only when correct.
- **Acceptance gate (once per cycle):** `npm run acceptance`. Builds a deterministic
  temp git repo (fixed commit dates/authors/files) and reads back the BUILT
  artifact's analytics against it — a real read-back, non-default sentinels.

## Constraints — what forge may NOT change (locked core)

- **Never edit a test to make it pass.** If a test is wrong, fix the code or raise
  it; do not weaken the assertion.
- **The user owns git history.** Do not `git reset`/force-push; leave history intact.
- **Read-only on analysed repos.** gitpulse must never mutate the repo it analyses.
- **Keep it dependency-free.** Runtime deps must stay at ZERO — node builtins only
  (incl. the dashboard: `node:http`, inline SVG, no external assets). `tsx`/
  `typescript` are the only permitted dev dependencies. Justify any new dep first.
- **One git-truth seam.** All history access goes through `src/git.ts`; analytics
  aggregation stays pure + unit-tested.
- **Fixtures use non-default values (C9).** Every acceptance fixture metric under
  test carries a distinctive sentinel (named author, known churn count, specific
  file) so analytics that drop/miscount real data are caught.
- **Small, focused files.** Aim < 400 LOC per source file; organise by feature.

## Development-history convention

Record each initiative's plan + demo under `forge/history/<initiative-id>/`
(`plan.md`, `demo/`, `verdict.json`) so the repo carries a browsable build record.
Project-specific skills live under `.forge/skills/`.
