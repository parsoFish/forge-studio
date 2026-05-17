# Coverage matrix — US/G → objective check

> `closure-check.ts` parses the table below. One row per acceptance
> obligation. `kind` ∈ `cmd | grep-absent | grep-present | file-absent |
> file-present | loc-max | pending`. `tier` ∈ `fast | full`. A row
> passes per its kind:
> - `cmd`     — `arg` is a shell command; exit 0 = pass.
> - `grep-absent`  — `arg` = `PATTERN :: GLOB`; pass iff 0 matches.
> - `grep-present` — `arg` = `PATTERN :: GLOB`; pass iff ≥1 match.
> - `file-absent` / `file-present` — `arg` = path.
> - `loc-max`  — `arg` = `N :: GLOB`; pass iff no matched file > N lines.
> - `pending`  — always unmet (work not yet done); convert when landed.
>
> The loop is "done" only when every row at the running tier passes.

| id | obligation | kind | arg | tier |
|----|------------|------|-----|------|
| BUILD | tsc strict clean | cmd | `npm run build` | fast |
| TEST | unit suite green | cmd | `npm test` | fast |
| G3-a | dead validator removed | grep-absent | `validateFilesInScopeAgainstWorktree :: orchestrator` | fast |
| G3-b | dead classifier mode removed | grep-absent | `pm-hallucinated-paths :: orchestrator` | fast |
| G3-c | dead event type removed | grep-absent | `'cost' :: orchestrator/logging.ts` | fast |
| G3-d | adapters placeholder removed | file-absent | `loops/_adapters` | fast |
| G3-e | unread config field removed | grep-absent | `models?: :: orchestrator/config.ts` | fast |
| G3-f | no stale assertBrainConsulted refs | grep-absent | `assertBrainConsulted :: orchestrator loops skills` | fast |
| G3-g | no brain-gate threat in templates | grep-absent | `brain-first gate :: loops/ralph` | fast |
| G12-a | no bespoke e2e rubric | file-absent | `benchmarks/e2e/scoring.ts` | fast |
| G4 | single coupling authority (detectHiddenCoupling only) | grep-present | `detectHiddenCoupling( :: orchestrator/phases/project-manager.ts` | fast |
| G9 | no auto-merge: no mergePullRequest() call reachable from scheduler/cycle/reviewer | grep-absent | `mergePullRequest( :: orchestrator/cycle.ts orchestrator/scheduler.ts orchestrator/scheduler-dispatch.ts orchestrator/phases` | fast |
| SIMPL-LOC | no source file > 800 LOC | loc-max | `800 :: orchestrator loops` | fast |
| CLI-1 | brain-query stub verb removed | grep-absent | `(skeleton) brain-query :: orchestrator/cli.ts` | fast |
| CLI-2 | bench stub verb removed | grep-absent | `Run via: npm run bench :: orchestrator/cli.ts` | fast |
| US-2.3 | brain index cache staleness documented | grep-present | `Brain-index staleness window (documented :: orchestrator/pm-invocation.ts` | fast |
| G7 | doc/code parity (ARCHITECTURE reconciled to as-built) | grep-present | `Reconciled 2026-05-16 :: ARCHITECTURE.md` | fast |
| US-7.1-notify | one notify sink (no hardcoded literal) | grep-absent | `desktop: true, webhook_url: null :: orchestrator/cycle.ts` | fast |
| US-1.3-pr | PR/merge extracted to orchestrator/pr.ts | file-present | `orchestrator/pr.ts` | fast |
| G11 | per-phase benches, no false-colour (Phase-4 drift fixes in code + real chained run scored solely via existing per-phase rubrics) | cmd | bash -c "grep -q 2.5 benchmarks/project-manager/sdk.ts && grep -q runReviewer benchmarks/review-loop/sdk.ts && ls benchmarks/chained/results/*.json >/dev/null 2>&1 && grep -q 'SOLELY the six existing per-phase' benchmarks/chained/score.ts" | full |
| G12-b | chained bench owns no rubric (scores via existing per-phase caseScore only) | file-absent | `benchmarks/chained/scoring.ts` | full |
| G1 | done/ ⇒ MERGED: reviewer never moves a manifest to done/ (only closure, gated on a confirmed merge, does) | grep-absent | `, 'done') :: orchestrator/phases/reviewer.ts` | fast |
| G1-rt | closure moves to done/ ONLY on a confirmed merge; pr-open + unmerged stays ready-for-review | cmd | `npx tsx --test orchestrator/phases/closure.test.ts` | full |
| G8 | dev-loop close: local↔remote invariant asserted (origin==local HEAD, main==merge-base) | grep-present | `assertLocalRemoteSynced( :: orchestrator/cycle.ts` | fast |
| G8-rt | local↔remote invariant catches divergence at runtime (push + assert primitives) | cmd | `npx tsx --test orchestrator/pr.test.ts` | full |
| G10 | reflection gated on a gh-pr-view==MERGED confirmation (runReflector nested under closure.merged ⟸ confirmPrMerged ⟸ gh pr view --json state ⟸ MERGED) | cmd | `perl -0777 -ne 'exit(($_ =~ /if \(closure\.merged\) \{\s*reflectionStatus = await runReflector\(/) ? 0 : 1)' orchestrator/cycle.ts && grep -q "gh pr view --json state" orchestrator/pr.ts && grep -q confirmPrMerged orchestrator/phases/closure.ts && grep -q MERGED orchestrator/pr.ts` | fast |
| US-3.1 | three operator slash commands exist (.claude/commands/) | cmd | `test -f .claude/commands/forge-architect.md && test -f .claude/commands/forge-review.md && test -f .claude/commands/forge-reflect.md` | fast |
| US-4.1 | C1–C6 preflight implemented + wired as a CLI verb (contract logic proven by its unit suite) | cmd | `npx tsx --test orchestrator/preflight.test.ts && grep -q "case 'preflight':" orchestrator/cli.ts && grep -q "runPreflight" orchestrator/cli.ts` | fast |
| G6 | manifest origin tag parsed + validated + serialised + reaches metrics/reflector cohort split | cmd | `node -e "const fs=require('fs');const m=fs.readFileSync('orchestrator/manifest.ts','utf8');const ok=m.includes('export type InitiativeOrigin')&&m.includes('origin: InitiativeOrigin;')&&m.includes('const origin = (rawOrigin')&&m.includes('origin: m.origin ?? DEFAULT_ORIGIN')&&m.includes('origin must be one of')&&m.includes('export function readManifestOrigin');const c=fs.readFileSync('orchestrator/cycle.ts','utf8').includes('metadata: { origin }');const x=fs.readFileSync('orchestrator/metrics.ts','utf8').includes('m.origin = o');const r=fs.readFileSync('orchestrator/phases/reflector.ts','utf8').includes('origin,');process.exit(ok&&c&&x&&r?0:1)" && npx tsx --test orchestrator/manifest.test.ts` | fast |
| ARCH-FRESH | as-built snapshot regenerated & ARCHITECTURE.md links it | cmd | `test -f docs/architecture/as-built-snapshot-2026-05-17.md && grep -q as-built-snapshot-2026-05-17.md ARCHITECTURE.md` | full |
| COVERAGE | matrix self-consistent — every obligation a well-formed check, no pending rows | cmd | `node --experimental-strip-types _meta/iteration/coverage-selfcheck.ts` | full |
