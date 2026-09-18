# mdtoc — agent instructions (forge↔project contract C5 + C8)

> A dependency-light TypeScript CLI that generates a GitHub-style Markdown
> table of contents from a document's headings. This file is human-authored —
> **forge must never create or overwrite it.**

## Build / test / lint (exact invocations)

```bash
npm install            # install tsx + typescript (dev-only)
npm run build          # tsc → dist/ (the CLI binary)
npm test               # the quality gate — fast unit suite (node:test), < 1s
npm run acceptance     # builds if needed, runs the BUILT CLI vs a fixture, asserts the TOC
npm run demo           # acceptance + writes captured demo evidence into forge/history/
```

- **Quality gate (per dev-loop iteration):** `npm test`. One command, deterministic,
  creds-free, sub-second. It must fail before the work exists and pass only when
  the behaviour is correct.
- **Acceptance gate (once per cycle):** `npm run acceptance`. Runs the compiled
  CLI as a real child process against `test/fixtures/release-notes.md` and asserts
  the exact generated TOC — a read-back against the actually-running thing.

## Constraints — what forge may NOT change (locked core)

- **Never edit a test to make it pass.** If a test is wrong, fix the code or
  raise it; do not weaken the assertion.
- **The user owns git history.** Do not `git reset`/force-push; leave history intact.
- **Keep it dependency-light.** Runtime deps must stay at zero — node builtins only.
  `tsx`/`typescript` are the only permitted dev dependencies (they mirror forge's
  own toolchain). Justify any new dependency before adding it.
- **Fixtures use non-default values (C9).** Every acceptance fixture heading that
  is under test must carry a non-default, distinctive value (e.g. the
  `sentinel-7f3a9c` section) so a TOC that ignores the real text is caught.
- **Small, focused files.** Aim < 400 LOC per source file; organise by feature.

## Development-history convention

Record each initiative's plan + demo under `forge/history/<initiative-id>/`
(`plan.md`, `demo/`, `verdict.json`) so the repo carries a browsable build record.
Project-specific skills live under `.forge/skills/`.
