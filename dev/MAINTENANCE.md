# Keeping the docs and the instruction layer true

What runs when, and what the operator does by hand. Budgets are ceilings, never targets (D-37).

| When | What | How |
|---|---|---|
| Every edit to a published page | Word ceiling for the page's type | Hook `scripts/hooks/docs-budget.mjs` (PostToolUse) blocks with the overage |
| Every edit to `CLAUDE.md` | 150-line cap | Hook `scripts/hooks/line-cap.mjs` (PostToolUse) |
| Every edit | No hand edits to generated or retired paths | Hook `scripts/hooks/guard-paths.mjs` (PreToolUse) |
| Every session end | A code change some page `covers:` gets a page update or `Docs impact: none — <reason>` | Hook `scripts/hooks/docs-impact.mjs` (Stop) |
| Every PR | Build, budget, links, Vale, identity, stale paths, decisions | `.github/workflows/ci.yml`, job `docs` and the checks job |
| Weekly | External links | `.github/workflows/links.yml` (lychee) |
| Weekly, by hand | Stale `last_verified` (120 d guides, 180 d reference), orphaned `covers:`, pages above 70 % of their ceiling → verify, edit or delete | `node scripts/check-docs-budget.mjs --report` plus the stale banner the site renders; no agent runs in GitHub Actions (R33) |
| Monthly, by hand | Instruction-layer audit: `CLAUDE.md`, `.claude/rules/`, skills, agents — stale or conflicting lines | `/doctor prompt-audit`, then the `claude-md-improver` skill (`claude-md-management` plugin). Prefer deleting lines; `/revise-claude-md` only adds them |
| Each milestone close | ROADMAP.md refresh; ceilings reviewed, ratchet down only | Operator |

## Freshness windows

Guides and how-tos: 120 days. Reference and explanation: 180 days (`apps/docs/src/freshness.mjs`). A generated page is refreshed by re-running its story or generator, never by hand.
