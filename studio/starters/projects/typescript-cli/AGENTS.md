# {{TITLE}} — agent instructions

{{NORTH_STAR}}

## Quality gate

Run `npm test` every iteration — a fast `node --test` unit suite. The change is
not done until it passes; it must fail before the behaviour exists and pass only
when the behaviour is correct.

- **Build:** `npm run build` (tsc → `dist/`) compiles the CLI the acceptance gate runs.
- **Acceptance (once per cycle):** `npm run acceptance` builds then runs the CLI
  against a checked-in fixture and asserts the exact output — a read-back against
  the actually-running binary, not the source.

## Conventions

- **Dependency-light.** Prefer node builtins; justify any runtime dependency.
- **Small, pure, testable functions.** Keep argv/stdout plumbing thin; put logic
  in functions the unit gate exercises directly.
- **Immutability.** Return new values; never mutate inputs.
- **The human owns git history and this file.** forge never `git reset`/force-pushes
  and never overwrites human-authored instructions.
