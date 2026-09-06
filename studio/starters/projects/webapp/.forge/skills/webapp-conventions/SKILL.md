# Web Conventions Skill

## Purpose

Encode this project's page-rendering contract so a dev-loop agent extends the
site without binding a socket in the quality gate. This is the project-scoped
skill the forge↔project contract expects every project to bind at least one
of (`skills[]` in `.forge/project.json`) — replace or extend it as the
project's real behaviour grows past the starter's single `/` page.

## When to use

- Adding a new page or route.
- Changing rendered HTML.
- Reviewing whether a change belongs in `page()` or in `handler()`.

## The rule

Real behaviour lives in the **pure `page(method, path): PageResult`**
function (`src/server.ts`) — replace/extend it, never grow the logic inside
`handler()`, which stays a thin adapter binding `page()`'s result to the
socket. `createApp()` wires the socket; tests never call it directly.

## Verification workflow

1. Extend `page()` for the new route; write its `node:test` case FIRST,
   asserting the exact status + a distinctive fragment of the rendered HTML.
2. `npm test` — fast, deterministic, no socket bound.
3. `npm run build` then `npm start` (serves on `PORT`, default 3000) for the
   demo/verify step: GET the real page and assert the HTML — a read-back
   against the actually-running server, never the source.
