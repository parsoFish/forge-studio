---
project: trafficGame
created_at: 2026-05-04T19:30:00Z
updated_at: 2026-05-04T19:30:00Z
status: active
domain: browser-game (traffic-flow simulation, campaign mode)
stack: [typescript, vite, vitest, playwright]
taste_decay: 0.05
---

# trafficGame

A traffic simulation game with campaign mode. Players design road networks to move vehicles efficiently across maps — earn grades, unlock levels, master complex intersections. TypeScript + Vite frontend, BPR-based flow prediction, unified scoring model.

## Taste signals

- **Per-map calibrated star thresholds** — every map has hand-tuned, "realistically achievable" score targets documented in [`docs/LEARNINGS.md`](https://github.com/.../docs/LEARNINGS.md). Don't auto-generate thresholds without playtesting.
- **Visual + behavioural correctness matters** — Playwright `test:visual` exists for a reason. Regressions in the canvas / vehicle physics show up here, not in unit tests.
- **MVP-first architecture** — lives in `docs/MVP_ARCHITECTURE.md`. Treat as the canonical doc; new systems should fit the existing core (road placement, vehicle physics, BPR flow, scoring) rather than introduce parallel ones.

## Hard constraints

- **Algorithm-heavy items are the leading cause of failure** (Steiner topology, graph colouring) when scoped as single work units in v1 Cycle 3. Decompose multi-file restructuring before queueing.
- **Single-language stack** — TypeScript only. No Python, no Bash. Tests are Vitest/Playwright.
- **No headless game loop in CI** — visual tests run in Playwright; do not require real browsers in unit-test paths.

## Active focus (v1 roadmap, carried forward)

- **Phase 1**: simplification first — archive the MCP server, reduce codebase weight.
- **Phase 2+**: foundational algorithm work (re-attack Steiner / graph-colouring with proper decomposition).
