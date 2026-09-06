# API Conventions Skill

## Purpose

Encode this project's routing contract so a dev-loop agent extends the API
without binding a socket in the quality gate. This is the project-scoped
skill the forge↔project contract expects every project to bind at least one
of (`skills[]` in `.forge/project.json`) — replace or extend it as the
project's real behaviour grows past the starter's single `/health` route.

## When to use

- Adding a new route or method.
- Changing a response shape or status code.
- Reviewing whether a change belongs in `route()` or in `handler()`.

## The rule

Real behaviour lives in the **pure `route(method, path): RouteResult`**
function (`src/server.ts`) — replace/extend it, never grow the logic inside
`handler()`, which stays a thin adapter binding `route()`'s result to the
socket. `createApp()` wires the socket; tests never call it directly.

## Verification workflow

1. Extend `route()` for the new method/path; write its `node:test` case
   FIRST, asserting the exact `{ status, body }` shape.
2. `npm test` — fast, deterministic, no socket bound.
3. `npm run build` then `npm start` (serves on `PORT`, default 3000) for the
   demo/verify step: GET the real endpoint and assert the JSON — a read-back
   against the actually-running server, never the source.
