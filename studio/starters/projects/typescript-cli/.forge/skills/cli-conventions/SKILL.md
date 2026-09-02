# CLI Conventions Skill

## Purpose

Encode this project's argv/stdout contract so a dev-loop agent extends the CLI
without smuggling untested plumbing past the quality gate. This is the
project-scoped skill the forge↔project contract expects every project to bind
at least one of (`skills[]` in `.forge/project.json`) — replace or extend it
as the project's real behaviour grows past the starter's single `greet`
function.

## When to use

- Adding a new CLI flag, subcommand, or argument.
- Changing how output is formatted or written.
- Reviewing whether a change belongs in `main()` or in a pure function.

## The rule

Real behaviour lives in **small, pure, testable functions** (`greet` in
`src/index.ts` is the template — replace it, keep the shape). `main(argv)`
stays thin: parse argv, call the pure function(s), write to stdout. The
`if (import.meta.url === ...)` guard is what lets `test/*.test.ts` import the
module without executing `main` as a side effect — keep it when the entry
point changes.

## Verification workflow

1. Add or extend a pure function; write its `node:test` case FIRST, with a
   distinctive value (mirroring `greet('sentinel-42')`) so a stub
   implementation that ignores its input is caught.
2. `npm test` — fast, deterministic, must fail before the behaviour exists.
3. `npm run build` (tsc → `dist/`) before `npm run acceptance`, which runs the
   BUILT CLI — a read-back against the actually-running binary, never the
   source.
