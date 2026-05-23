---
source_type: arc
cycle_id: rebuild-review-2026-05-24
initiative_id: rebuild-review
project: forge
ingested_at: 2026-05-24T03:30:00Z
ingested_by: operator+claude
outcome: in-progress
---

# Rebuild-review execution arc — Move 1 + Move 2 landed, Move 3 closed

Two-day session (2026-05-23 evening → 2026-05-24 morning) executing the
rebuild-review recommendations from `docs/planning/2026-05-24-rebuild-review/REVIEW.md`.
Direct execution, NOT a forge cycle (operator instruction:
"forge does not operate on itself").

## Move-by-move outcome

| Move | Status | Notes |
|---|---|---|
| 1 — slim orchestrator | landed | 16 files relocated to `cli/`, `orchestrator/*.ts` 24975 → 13387 LOC (-11588) |
| 2 — forge-ui (Next.js, ws bridge, intervention forms) | landed | 3 stages M2-A/B/C all closed; operator confirmed UI working live |
| 3 — Claude Code subprocess crash investigation | closed-no-action | operator deferred; cycle archive retained |

## Move 1 — orchestrator slim

3 commits, behaviour-neutral verified by `npm test` (766/0fail/1skip):

- **962a303** relocate 16 CLI utilities to `cli/`
- **6459501** simplify hot-path files (failure-classifier 14-mode → transient|terminal; cycle-report 736 → 29 LOC + 726 LOC renderer in cli/forge-metrics; quality-gate `creates`-in-diff → single seam via `requiredVerificationPaths(wi)`)
- **f6163ec** drop graphify mandate from CLAUDE.md

## Move 2 — forge-ui

11 commits across 3 stages:

- **M2-A**: Next.js workspace, `cli/ui-bridge.ts` (WebSocket + HTTP), `cli/forge-watch.ts` subcommand. State machine + cycles tab + live event tail.
- **M2-B**: per-phase activity sidebar (Sidebar.tsx), state-transition toasts (Toasts.tsx), WI dependency graph (parsed mermaid client-side, no mermaid lib), cycle-id mapping fix (use `_logs/` dirs as source of truth, not queue filenames).
- **M2-C**: structured verdict form (approve / send-back + GIVEN/WHEN/THEN editor); POST `/api/verdict` with `proper-lockfile` guard on the in-flight manifest; scheduler-stopped banner with `Start it` button (POST spawns `forge start` detached).

## Patterns extracted (brain themes added this session)

- [[dom-as-metrics-for-headless-driven-uis]] — every UI state mirrored
  to `data-*` so playwright/headless probes/LLM agents can drive the
  page by reading structured DOM. Pattern from
  anthropics/cwc-workshops `how-we-claude-code`. Operator surfaced this
  mid-session; refactored throughout forge-ui.
- [[fixed-port-takeover-for-pinned-browser-tabs]] — fixed defaults
  (bridge=4123, ui=4124) + `lsof` + SIGTERM/SIGKILL takeover on re-run
  so the operator keeps one tab pinned across iterations. WebSocket
  backoff reconnects transparently.
- [[windows-browser-to-wsl-via-window-location]] — for browser↔WSL
  connectivity, return the **port** and let the client build the URL
  from `window.location.hostname`. Returning `127.0.0.1:<port>` from a
  WSL process is meaningless to a Windows browser.

## Operator-surfaced corrections worth keeping

1. **"forge does not operate on itself"** — initial misread had me
   creating a PLAN.md framed as `/forge-architect forge` input; deleted
   and executed directly.
2. **"ensure you have accurate metrics, not relying on my input"** —
   moved from curl-based smoke tests to playwright-driven real-browser
   probes that read DOM data attributes. Surfaced two bugs the curl
   tests missed: subscribe() leaked WS connections under React Strict
   Mode mount→cleanup race; toasts seeded against the initial empty
   snapshot and spammed every cycle when real data arrived.
3. **"have we overcomplicated the port stuff"** — replaced the
   port-probe walk + OS-assigned ports with fixed defaults + takeover.
4. **"give the URL first, then kick off the demo"** — split the
   showcase into two scripts: `scripts/forge-ui-demo.mjs` (playwright
   captures screenshots) for offline review, and
   `scripts/forge-ui-live-demo.mjs` (server-side state mutations) for
   the operator to watch their pinned browser tab react in real time.

## Methodology improvements adopted

- Verification standard: `npm run build` (full chain: tsc + next build)
  + `npm test` + playwright-driven page drive. Curl-only tests are now
  insufficient because they can't see browser-side issues.
- Process-tree management: `spawn(..., { detached: true })` +
  `process.kill(-pid, …)` for grandchild cleanup. Hung the demo for 7
  minutes before fix.
- Bridge URL discovery: runtime via `/api/forge-config` route, not
  build-time `next.config.mjs` `env` block — that bakes values into the
  client bundle at startup and goes stale across `forge watch` restarts.

## Open items

- The release-def-substrate-gates initiative (the original betterado
  dogfood that failed 3 retries) is being re-run as this session
  closes — operator wants the e2e working before the branch lands.
  See [[2026-05-23-dogfood-cycle-false-pass-gate]] for the prior
  forensics.

## See also

- [[2026-05-23-dogfood-cycle-false-pass-gate]] (prior cycle's forensics
  that motivated this whole arc)
- [[pr-as-sole-review-window]] (earlier reliability-pass theme)
- `docs/planning/2026-05-24-rebuild-review/{REVIEW,MOVE2-PLAN}.md`
