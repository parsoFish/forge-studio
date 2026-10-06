# Keeping the docs and the instruction layer true

What runs when, and what the operator does by hand. Budgets are ceilings, never targets (D-37).

| When | What | How |
|---|---|---|
| Every edit to a published page | Word ceiling for the page's type | Hook `scripts/hooks/docs-budget.mjs` (PostToolUse) blocks with the overage |
| Every edit to `CLAUDE.md` | 150-line cap | Hook `scripts/hooks/line-cap.mjs` (PostToolUse) |
| Every edit | No hand edits to generated or retired paths | Hook `scripts/hooks/guard-paths.mjs` (PreToolUse) |
| Every session end | A code change some page `covers:` gets a page update or `Docs impact: none — <reason>` | Hook `scripts/hooks/docs-impact.mjs` (Stop) |
| Every PR | Build, budget, links, Vale, identity, stale paths, decisions | `.github/workflows/ci.yml`, job `docs` and the checks job |
| Every PR touching code (when enabled) | Claims the code now contradicts, as one PR comment | `.github/workflows/docs-drift.yml` running the `docs-drift` skill |
| Weekly | External links | `.github/workflows/links.yml` (lychee) |
| Weekly (when enabled) | Stale `last_verified`, orphaned `covers:` and cited paths, broken links, pages above 70 % of their ceiling → ONE PR proposing verify, edit or delete | `.github/workflows/docs-gardening.yml`; dry run `node scripts/docs-gardening.mjs` |
| Monthly, by hand | Instruction-layer audit: `CLAUDE.md`, `.claude/rules/`, skills, agents — stale or conflicting lines | `/doctor prompt-audit`, then the `claude-md-improver` skill (`claude-md-management` plugin). Prefer deleting lines; `/revise-claude-md` only adds them |
| Each milestone close | ROADMAP.md refresh; ceilings reviewed, ratchet down only | Operator |

## Enabling the gated workflows (operator)

Both workflows need an Anthropic API key and are off by default; they show SKIPPED until enabled.

1. Add the repository secret `ANTHROPIC_API_KEY`.
2. Docs drift: set the repository variable `DOCS_DRIFT_ENABLED=true`. Record its hit rate (comments that named a real contradiction ÷ comments posted) for one month before relying on it (R23).
3. Gardening: set `DOCS_GARDENING=true`. Its first scheduled run opens one PR or reports "nothing stale".

Turn either off by deleting the variable.

## Freshness windows

Guides and how-tos: 120 days. Reference and explanation: 180 days (`apps/docs/src/freshness.mjs`). A generated page is refreshed by re-running its story or generator, never by hand.
