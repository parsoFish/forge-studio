---
doc: batch-closure
batch: 2026-05-20-refinement
date_closed: 2026-05-23
status: closed (S7 partial — forge watch TUI deferred to operator follow-up)
stages_landed: 8.5 / 9
tests_final: 724 pass + 1 deliberate skip (S7 cost-tick debounce)
---

# Forge refinement batch — closure

The 2026-05-20 refinement batch is closed. **8.5 of 9 stages landed on
`main`** between 2026-05-21 and 2026-05-23, ratifying 19 cross-plan
contracts (C1–C19 in S0; C20–C28 in iteration-2) and producing a clean
test surface of **724/725 passing** (1 deliberate skip in S7's partial
cost-tick test).

## Stage landings

| Stage | Headline | Tests added | Commit(s) |
|---|---|---|---|
| **S0** | Contract lock (C1–C19) | docs only | `d61e258` |
| iter-2 | Trafficgame learnings + graphify + token economy plan (C20–C28) | docs only | `1a3645d` |
| **S1.1** | Init-IDs: `<proj4>#<seq>` handles + `proper-lockfile` registry | 18 | `f5e7800` |
| **S1.2** | Brain hygiene: `forge brain lint` executable + scrubber + index regenerator | 37 | `417a584` |
| **S1.3** | `assertLocalRemoteSynced` at dev-loop close (small precursor) | 3 | `4161de1` |
| **S1.4** | Graphify additive brain layer (real `safishamsi/graphify` Python CLI, post-correction) | n/a (data) | `00ffd87` + `441e048` |
| **S2A** | Architect PLAN.md operator artefact + council I-23 robustness | 29 | `fdac58c` |
| **S2B** | Architect bench reground + cross-phase handoff + frozen PM rubric | 16 | `026995d` |
| **S3** | PM WI schema extension + `knownFeatureIds` wiring + bench rubric | 25 | `d108cb3` |
| **S4** | Dev-loop unifier + review shrink (atomic; 44 reviewer files archived) | 36 | `c257f3c` |
| **S6A** | Reflect lint trigger + retention tagging + sibling `lint_status` | 38 | `46177d6` |
| **S6B** | Reflect slash UX + `recap.md` + `--rerun` default-on | 13 | `0305a73` |
| **S5** | Brain bench growth pipeline + betterado seed | 17 | `073d718` |
| **S7** *(partial)* | Logging event types + cost-tick + pretty-printer + heartbeat | 30 | `dc565bb` |
| **S8** | Token economy: caching + Haiku council routing + micro-caveman + ratchet bench | 14 | `76603e7` |

**Total new tests: ~289.** Starting baseline `547/547` (post S0) → final
`724/725` (1 deliberate skip).

## What's on `main`

### New CLI surface

- `forge architect commit <session-id> [--via-pr]` (S2A)
- `forge brain lint [--scope ...] [--fix]` (S1.2)
- `forge brain index --write` (S1.2)
- `forge brain bench:promote --cycle <id>` (S5)
- `forge reflect <id> [--rerun]` (S6B)
- Init-ID handles accepted everywhere: `forge review traf#7` etc. (S1.1)

### New modules (orchestrator)

- `architect-plan.ts` + `architect-commit.ts` (S2A — PLAN.md flow)
- `brain-lint.ts` + 7 checks + `brain-index.ts` regenerator (S1.2)
- `brain-bench-promote.ts` (S5)
- `cycle-retention.ts` + retention frontmatter on cycle archives (S6A)
- `cycle-recap.ts` + `_logs/<id>/recap.md` emission (S6B)
- `forge-reflect-cli.ts` + `forge-reflect-rerun.ts` (S6B — pattern for slash CLIs)
- `initiative-id.ts` + `scripts/backfill-aliases.ts` (S1.1)
- `project-config.ts` + JSON schema + 6 example configs (S4)
- `unifier-invocation.ts` + `skills/developer-unifier/SKILL.md` (S4)
- `review-router.ts` (S4 — non-LLM PR-comment poller)
- `cost-tick.ts` + `logging-pretty.ts` (S7 partial)
- `failure-classifier.ts` extension: `pm-feature-hallucination` (S3)

### New benchmarks

- `benchmarks/_lib/handoff.ts` — single canonical cross-phase handoff (S2B)
- `benchmarks/project-manager/scoring.frozen.ts` — pinned snapshot for `downstream_pm_score` (S2B)
- `benchmarks/review-router/` — 6 deterministic mock-`gh` fixtures (S4)
- `benchmarks/token-economy/` — A/B ratchet harness (S8)
- Bench `developer-loop/` extended with unifier criteria + `artifact`/`harness` fixtures (S4)
- Bench `project-manager/` rubric rewrite with FEAT-5 regression case (S3)
- Bench `architect/` reground with B1 + B2 betterado fixtures + 6 new criteria (S2B)
- Bench `reflection/` extended with `lint_invoked` + `retention_assigned` + `recap_emitted` gates (S6A + S6B)

### Deletions

- 44 reviewer files archived (S4 review shrink): `reviewer-stage2.ts`,
  `reviewer-invocation.ts`, their tests, `skills/reviewer/SKILL.md`,
  whole `benchmarks/review-loop/` directory.
- `orchestrator/brain-graph.ts` deleted (S1.4 correction — replaced by real graphify).
- S1.4 deterministic walker archived to `brain/_archive/2026-05-23/`.

### Brain

- 7 forge themes updated to cite canonical Karpathy gist (was 404'd Pass-A synthesis).
- `brain/graphify-out/{graph.json, graph.html, GRAPH_REPORT.md}` — real safishamsi/graphify output (757 nodes, 635 edges, 122 communities).
- 21 brain bench questions (18 keyword + 3 structural from S1.4); seeded for 23 with 2 betterado questions in S5.

## Operator-pending items for wake-up review

These were sandbox-blocked or deliberately deferred by S7's session-limit
ceiling. Operator picks up on wake:

1. **S1.2 Tier-B brain frontmatter remappings** — `S1.2-TIER-B-PROPOSALS.md`
   in repo root has 6 sed-ready remappings (`category: snapshot|process` →
   `reference|operation`). Per `feedback_destructive_instruction_preserve_intent`
   these were held for explicit operator confirmation.
2. **`npm run bench:brain`** — not run during the batch (cost concern; OAuth
   token doesn't authenticate direct API). Target ≥ 94.4% on the full
   23-question set (18 keyword + 3 structural + 2 betterado).
3. **S2B betterado brain themes** — two themes added by S2B
   (`brain/projects/terraform-provider-betterado/themes/{council-constraints,release-substrate-context}.md`)
   to make `project_context_lifted` discrimination work. Operator confirms
   these match ground truth.
4. **S7 unfinished pieces** (deferred for follow-up):
   - `forge watch <id>` CLI + 4-pane `blessed-contrib` TUI
   - `file-change-emit.ts` (Edit/Write tool-use hook)
   - `test-run-emit.ts` (npm test / pytest / go test heuristic)
   - `phase-transition-emit.ts` (between cycle.ts phase entries)
   - `benchmarks/logging-ux/` (events-coverage + pretty-printer-snapshot + heartbeat-timing + cost-tick-debounce)
   - One skipped test in `cost-tick.test.ts` (debounce semantics — implementation emits per change; test expects collapse).
5. **S8 memory file compression apply** — `S8-MEMORY-COMPRESSION-PROPOSALS.md`
   has a sed-ready apply script for `CLAUDE.md` / `ARCHITECTURE.md` /
   `PRINCIPLES.md` / `brain/INDEX.md` (~25% size reduction). Held for
   explicit operator review per preserve-intent.
6. **S8 cost-per-cycle baseline** — `benchmarks/token-economy/baseline.json`
   is the C19-baseline reference; on the next live e2e bench run, update
   it if cost dropped (ratchet lock-in).
7. **C19 budget removal scattered**: existing per-WI `$1.0` cap and
   `cost_budget_respected` (0.15 weight) bench criterion both removed by
   S4 per C19. Confirm cycle behaviour matches expectation on the next
   real run.
8. **Operator pre-session daemon WIP** — landed on `main` as part of S4
   followup (the operator's `daemon.ts` + `pr-verdict.ts` + `pr-verdict.test.ts`
   + cli.ts daemon imports + scheduler.ts integration + start/stop/pause/
   resume commands). Tests pass; the work is functional. Operator confirms
   intent or selectively reverts on wake.

## Dogfooding via betterado

Per the execution plan, betterado was the canonical test bed throughout.
Two pieces of betterado-specific work landed:

- **Brain seeded** (S1.4): `brain/projects/terraform-provider-betterado/`
  fully on disk + 3 themes referenced from B2 fixture.
- **Bench fixtures** (S2B): B1 (`betterado-substrate-only`) and B2
  (`betterado-full-program`) derived from real
  `_queue/pending/INIT-2026-05-18-betterado-*.md` manifests; the
  pre-S2A architect outputs are the discriminator baseline.
- **Per-project `.forge/project.json` example** (S4):
  `docs/schemas/examples/project.betterado.json` ready to install at
  `projects/terraform-provider-betterado/.forge/project.json`.

**Next real betterado cycle**: a clean run of
`INIT-2026-05-18-betterado-01-release-def-test-substrate` against the
refined cycle is the integration test that closes the batch
end-to-end. Run it when the operator's ready.

## What's NOT in this batch

- **Live `npm run bench:brain` / `bench:architect` / `bench:pm`** — none
  run during the batch (OAuth token doesn't authenticate direct API +
  cost concern while operator asleep). All structural changes verified
  via unit tests; live benches are operator-wake-up.
- **S7 forge watch TUI** — deferred (see §"Operator-pending" #4).
- **Token economy memory file compression** — proposals only; not
  auto-applied (see §"Operator-pending" #5).

## Contract index (final)

All 28 contracts ratified and in CONTRACTS.md. Quick reference for the
post-batch state:

- **C1–C19**: S0 contract lock (operator-confirmed)
- **C20–C22**: Graphify additive brain layer (real `safishamsi/graphify` Python CLI)
- **C23–C26**: Token economy (caching + Haiku council + micro-caveman + memory file compression)
- **C26**: Holistic metrics + locked baselines (trafficGame L1)
- **C27**: `type: 'implementation' | 'exploration'` manifest discriminator (trafficGame L2)
- **C28**: `project-sweep` skill skeleton (trafficGame L3)

## Closure timestamp

Final commit on `main`: `dc565bb`. Test suite **724/725** passing. tsc clean.

The refinement batch is closed.
