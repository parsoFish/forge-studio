# UI walkthrough — drive Studio like an operator and collect defects

> Landed with the wave-7 plan (2026-08-19). It is the instrument that produced
> [`docs/roadmaps/wave-7-walkthrough-findings.md`](../../docs/roadmaps/wave-7-walkthrough-findings.md)
> — 336 verified findings from one afternoon. `ui:journey` proves the paths we
> *scripted* still work; this proves the paths an operator can *reach* behave.

## Two tiers

1. **Crawl (deterministic, cheap, CI-able)** — `npm run ui:walkthrough` runs
   `crawl.mjs` against the already-running Studio (bridge `:4123`, UI `:4124`):
   seeds every static route plus one representative of every dynamic kind (from
   the bridge's own list APIs), BFS-follows every internal link, and records per
   route: `data-page` / `data-page-ready`, console errors, failed requests
   (≥400), the interactive inventory (buttons/links/inputs/data-state), an
   error-copy scan, and a full-page screenshot. Output: `<out>/crawl.json`,
   `<out>/crawl-summary.txt`, `<out>/shots/`. Default `<out>` is
   `_walkthrough/explore` (gitignored). W7-A0 adds the assertion mode (fail on
   any never-ready page / 4xx from a first-party route / console error) so it
   can gate.
2. **Explorer fan-out (token-spending, the wave gate)** — `fanout.workflow.js`
   is a Claude Code `Workflow` script: ten clusters (home+sessions · projects ·
   flows · agents · library · community · knowledge · session kinds ·
   artifact/plan · cross-cutting), one **explorer** agent each (playwright via
   `lib.mjs` + source reading; clicks every control, submits every form, may
   start sessions/agent runs/drains where that is the only way to validate a
   path), then one **adversarial verifier** per cluster. Findings land as JSONL
   in `<out>/findings/<cluster>.jsonl` (+ `.verify.jsonl`) using the schema in
   `EXPLORER-BRIEF.md`. Run it from a Claude Code session with the Workflow tool:
   `Workflow({ scriptPath: 'scripts/ui-walkthrough/fanout.workflow.js', args: { outDir: '_wave8', only: ['knowledge'] } })`
   (`args`: `outDir`, `brief`, `exploreModel`, `verifyModel`, `only`).

## Ground rules baked into the brief

Studio must already be running; the agents never restart it, never run
`ui:journey`/`ui:deadpaths`/`--force-takeover`, write only under `<out>/`, never
approve/merge/push against a real repo, name throwaway objects
`w7-throwaway-*`-style so the orchestrator can tear them down (until W7-B4/B6
land, the UI cannot delete flows / agents / hooks / installed-skills residue —
see the teardown list at the bottom of the wave-7 ledger).

## Files

- `crawl.mjs` — tier 1.
- `lib.mjs` — playwright helpers explorers import (`openStudio`, `goto`,
  `inventory`, `clickAndCapture`, `note`, `bridge`).
- `EXPLORER-BRIEF.md` — the shared explorer contract (ground rules, what counts
  as a finding, finding schema, return shape). The "operator notes" section is
  per-run input.
- `fanout.workflow.js` — the explore→verify pipeline (see above).

## Cost reference (wave 7, 2026-08-18)

20 agents (10 opus explorers + 10 sonnet verifiers), 4.4M subagent tokens,
1,888 tool uses, 56 minutes wall; plus the real sessions/agent runs/drains the
explorers started (order of $10). 336 findings, 276 S1/S2 verified.
