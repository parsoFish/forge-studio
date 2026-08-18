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
   `_walkthrough/explore` (gitignored). **Assertion mode** (W7-A0) —
   `npm run ui:walkthrough:gate` (= `crawl.mjs --assert --baseline
   scripts/ui-walkthrough/baseline.json`) — fails (exit 1) on any **new**
   `never-ready` page (`[data-page]` root without `data-page-ready="true"`),
   `first-party-4xx` (any bridge/UI-host request ≥400 — the
   `known-optional-404s.txt` allowlist may suppress a *404* on an artifact
   that legitimately may not exist), `page-error` (uncaught exception),
   `console-error` (a `console.error` that is not the browser's own
   resource-load line) or `nav-error`; writes `<out>/assert.json`; see
   `assert.mjs` for the pure function and `crawl.test.ts` for the contract.
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

## The gate (crawl assertion) — flags and files

| Flag / file | Meaning |
|---|---|
| `--assert` | run the assertion after the crawl; exit 1 on new failures |
| `--baseline <file>` | known failures that do **not** fail the gate — `baseline.json`, the wave-7 known-defect set. Ids are normalized (`2026-…T…_INIT-…` → `<id>`, `INIT-…` → `INIT-<id>`) so run/session churn does not move entries. **Lanes shrink it, never grow it**: delete the entries your PR fixes; a stale entry is reported as a warning, a NEW failure fails, and `check-baseline-shrinks.mjs --against origin/main` (CI) fails any PR that adds an entry. Regenerate only from main: `--write-baseline scripts/ui-walkthrough/baseline.json`. |
| `--only <route-prefix>` | crawl/assert only routes under that prefix (repeatable) — e.g. `--only /flows` while iterating on one pillar |
| `--from <crawl.json>` | no browser: re-assert an existing crawl output (T1 re-checks a lane's claim offline) |
| `--boot` | CI / idle host: spawn `forge studio --no-open` (dry-bridge + no-spawn seams), crawl, tear down. **Refuses** if a healthy bridge already answers on :4123 — never takes over the operator's Studio |
| `--write-baseline <file>` | write the run's full failure set as a baseline |
| `--min-routes <n>` | harness sanity floor (default 40 for a live crawl, 0 under `--from`): fewer crawled routes is a **harness error** (exit 2, no verdict) — together with the bridge `/api/health` precheck it stops "the bridge was down, every page rendered its empty state" from reading as green |
| `known-optional-404s.txt` | 404-only allowlist of artifact URLs that legitimately may not exist (`*` one segment, `**` any depth). Each entry is reviewed against the findings register; known defects (review-findings.json, `/api/events/`, `/projects/new` preflight …) are NOT allowed here — they stay in the baseline until their lane fixes them |
| `live-only-routes.txt` | route prefixes whose readiness is defined by a live stream — the never-ready check skips them (empty on introduction: every never-ready page the wave-7 crawl found was a defect) |
| CI job `ui-walkthrough` (`.github/workflows/ci.yml`) | `--boot --assert --baseline` on every PR + push to main, crawl output uploaded as an artifact, then the shrink-only check |

The explorer fan-out is **not** in CI (token-spending, judgement-based); it stays the manual wave gate.

## Ground rules baked into the brief

Studio must already be running; the agents never restart it, never run
`ui:journey`/`ui:deadpaths`/`--force-takeover`, write only under `<out>/`, never
approve/merge/push against a real repo, name throwaway objects
`w7-throwaway-*`-style so the orchestrator can tear them down (until W7-B4/B6
land, the UI cannot delete flows / agents / hooks / installed-skills residue —
see the teardown list at the bottom of the wave-7 ledger).

## Files

- `crawl.mjs` — tier 1 (crawl + `--assert` gate); `assert.mjs` — the pure
  assertion (`assertCrawl`, `toBaseline`, `baselineGrowth`, id normalization);
  `boot-studio.mjs` — the `--boot` launcher; `check-baseline-shrinks.mjs` — the
  shrink-only CI check; `crawl.test.ts` + `fixtures/crawl.sample.json` — the
  pinned contract over a slice of the real wave-7 crawl.
- `baseline.json`, `known-optional-404s.txt`, `live-only-routes.txt` — see the
  gate table above.
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
