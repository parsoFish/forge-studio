# UI walkthrough — drive Studio like an operator and collect defects

> Landed with the wave-7 plan (2026-08-19). It is the instrument that produced
> the wave-7 walkthrough findings record (retired 2026-08-29 in M1-A; in git history)
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
   that legitimately may not exist), `transport-failure` (a first-party
   request that never got a response — bridge refused/dropped the connection;
   client aborts are not failures), `page-error` (uncaught exception),
   `console-error` (a `console.error`; the browser's own "Failed to load
   resource" line is dropped only when a recorded request on that page
   explains it), `eval-error` (the harness could not read the page) or
   `nav-error`; writes `<out>/assert.json`; see `assert.mjs` for the pure
   function, `capture.mjs` for the browser listeners + in-page read, and
   `crawl.test.ts` / `capture.test.ts` for the contract. **First-party** is
   decided by ORIGIN against the crawl's bridge/UI URLs (a LAN ip or container
   name in `FORGE_UI_URL`/`FORGE_BRIDGE_URL` is first-party too), with a
   loopback-port alias fallback (`localhost` vs `127.0.0.1`).
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
| `--baseline <file>` | known failures that do **not** fail the gate — `baseline.json`, the wave-7 known-defect set. Ids are normalized (`2026-…T…_INIT-…` → `<id>`, `INIT-…` → `INIT-<id>`) so run/session churn does not move entries. **Lanes shrink it, never grow it**: delete the entries your PR fixes; a stale entry is reported as a warning, a NEW failure fails, and `check-baseline-shrinks.mjs --against origin/main` (CI) fails any PR that adds an entry. The file also carries the **coverage floor** `expectedRoutes.{ci,host}` (+ `expectedRoutesSource` provenance): a full crawl in that environment must visit ≥ 90% of it (see coverage below). Regenerate only from main: `--write-baseline scripts/ui-walkthrough/baseline.json` on a `main` checkout / against the running main Studio (`--source "main@<sha> …"` if the harness checkout is not main) — the resulting `source: "main@<sha>"` stamp (new sha, newer `generatedAt`, `expectedRoutes` present) is the ONE shape of change under which the shrink check accepts growth; anything else that adds an entry fails. |
| `--only <route-prefix>` | crawl/assert only routes under that prefix (repeatable) — e.g. `--only /flows` while iterating on one pillar |
| `--from <crawl.json>` | no browser: re-assert an existing crawl output (T1 re-checks a lane's claim offline) |
| `--boot` | CI / idle host: spawn `forge studio --no-open` (dry-bridge + no-spawn seams), crawl, tear down. **Refuses** if a healthy bridge already answers on :4123 — never takes over the operator's Studio |
| `--write-baseline <file>` | write the run's full failure set as a baseline (refuses `--only` — a baseline is the FULL set; a `--from` replay is stamped `crawl.json <path>` unless `--source` names where the capture was measured, marked `(replayed from …)`) |
| `--min-routes <n>` | harness sanity floor (default 40 for a live full crawl, 1 under `--only` or `--from` — an empty capture is never green): fewer crawled routes is a **harness error** (exit 2 — no verdict, and no baseline written) — together with the bridge `/api/health` precheck it stops "the bridge was down, every page rendered its empty state" from reading as green or being baselined |
| coverage (W7-A0-3) | beyond the absolute floor, a full crawl (no `--only`) must visit ≥ 90% of the baseline's `expectedRoutes[<env>]` — `env` = `ci` when `CI` is set, else `host` (CI's Studio is a clean checkout, a strict subset of the operator's host, so each records its own count; a baseline with no expectation for the environment fails closed) — and must not leave an **unvisited** BFS remainder behind (it hit `--max`; raise it — an explicit `--max` makes the truncation by-design and merely reported). Both are harness errors (exit 2) and `assert.json` is still written with `ok:false` + `harnessError`. `--allow-coverage-drop` is the explicit override for a Studio that legitimately has fewer routes; a `--write-baseline` that would lower the previous file's expectation is refused without it — but an environment the previous file has NO expectation for is a *first introduction* on the write path (recorded, no override needed). A capture must name its environment (`env` in crawl.json); a `--from` capture without one is refused, never judged as `host` |
| `--max <n>` | BFS cap (default 1000). Hitting it with routes left over is a coverage failure unless the flag was passed explicitly |
| `--source <label>` | provenance stamp written into `baseline.json` (`source`, `expectedRoutesSource.<env>`); default `<branch>@<sha>` of the harness checkout (under `--from`: the replayed file's path) |
| regeneration scope | a regeneration proves only what it SAW: `--write-baseline` over the existing file carries forward the previous entries whose route this crawl never visited (a CI-environment regeneration cannot discard the host-only known defects) as well as the other environment's `expectedRoutes`; a regeneration that loses an environment key the previous file had FAILS the shrink check |
| transport failures + mid-crawl bridge loss (W7-A0-2) | `requestfailed` is captured per page (`transportFailed`); on the first first-party non-abort transport failure the crawl re-probes `/api/health` — a bridge that died mid-crawl is a harness error (the PARTIAL `crawl.json` + an `assert.json` with `ok:false`, `partial:true`, `harnessError` are still written — the trace it stopped on survives), a bridge that is up but dropped a request is a `transport-failure` failure. The main document's own transport failure is the row's `nav-error`, not a second key |
| `known-optional-404s.txt` | 404-only allowlist of artifact URLs that legitimately may not exist (`*` one segment, `**` any depth). Each entry is reviewed against the findings register; known defects (review-findings.json, `/api/events/`, `/projects/new` preflight …) are NOT allowed here — they stay in the baseline until their lane fixes them |
| `live-only-routes.txt` | route prefixes whose readiness is defined by a live stream — the never-ready check skips them (empty on introduction: every never-ready page the wave-7 crawl found was a defect) |
| CI job `ui-walkthrough` (`.github/workflows/ci.yml`) | shrink-only check first (PRs), then `--boot --assert --baseline` on every PR + push to main, then (PRs) `check-baseline-shrinks.mjs --crawled _walkthrough/ci/crawl.json`; crawl output uploaded as an artifact. CI's Studio is a clean checkout (mdtoc only, no runs/sessions), a strict subset of the operator's host: the host-only baseline entries show up there as *stale* warnings, never as failures (first honest CI run: 136 routes, 30 known, 22 stale, 0 new). **Removed entries are cross-checked** (W7-A0-4): a removal whose route the CI crawl never visited is `UNPROVEN` — a workflow warning, not a failure, because CI structurally cannot reach the host-only routes; the operator-host wave gate runs `check-baseline-shrinks.mjs --against parsoFish/main --crawled <host crawl.json> --fail-unproven`, where every route is reachable and an unproven removal FAILS |

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
  assertion (`assertCrawl`, `coverageVerdict`, `toBaseline`, `baselineGrowth`,
  `isRegeneration`, `unprovenShrinks`, id normalization); `capture.mjs` — the
  per-page browser listeners (`attachCapture`) + the in-page read
  (`readPageInfo`, readiness anchored strictly to the `[data-page]` root);
  `../lib/boot-studio.mjs` — the `--boot` launcher, SHARED with
  `e2e-deadpaths.mjs` and `verify-cycle.mjs` since W7-C3 (`bootStudio` is this
  harness's policy wrapper — refuses to boot over a healthy bridge — around the
  common `spawnStudioReady` core); `check-baseline-shrinks.mjs` — the
  shrink-only CI check (+ `--crawled` cross-check, stamped-regeneration
  acceptance); `crawl.test.ts` + `capture.test.ts` + `fixtures/crawl.sample.json`
  — the pinned contract over a slice of the real wave-7 crawl.
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
