# {{TITLE}} — Roadmap

> {{NORTH_STAR}}

Machine-readable architecture context for the architect/PM (C4).

## Architecture

- **Shape:** a dependency-light TypeScript web UI on `node:http`. Page-rendering
  logic lives in pure functions in `src/`; `dist/` is the compiled server.
- **Gates:** `npm test` (fast unit over pure logic) per iteration; a real page
  GET as the demo/acceptance read-back once per cycle.

## Initiatives

- [ ] INIT-1 — TODO: the first slice of {{NORTH_STAR}}
