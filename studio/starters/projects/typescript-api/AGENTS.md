# {{TITLE}} — agent instructions

{{NORTH_STAR}}

## Quality gate

Run `npm test` every iteration — a fast `node --test` unit suite over the pure
routing/handler logic. The change is not done until it passes.

- **Build:** `npm run build` (tsc → `dist/`).
- **Run:** `npm start` (serves on `PORT`, default 3000).
- **Demo/verify:** GET a real endpoint (e.g. `/health`) and assert the JSON — a
  read-back against the actually-running server, not the source.

## Conventions

- **Dependency-light.** Prefer node builtins (`node:http`); justify any dependency.
- **Logic in pure functions.** Keep the socket/plumbing thin; test `route`-style
  functions directly so the gate is fast and deterministic.
- **Immutability.** Return new values; never mutate inputs.
- **The human owns git history and this file.**
