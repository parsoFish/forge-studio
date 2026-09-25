/**
 * verify-cycle-preflight — refuse BEFORE the architect spends money on a
 * project that will fail `claim-validator.ts`'s OWN contract-readiness check
 * anyway (bead: the $2.18 G2/G3 architect spend that was then correctly
 * refused at claim, hard clause C2 — the refusal was right, it should have
 * cost $0).
 *
 * WHY THIS EXISTS. `scripts/verify-cycle.mjs`'s claim-time contract check
 * (`serveContractEnv` in `scripts/lib/verify-outcomes.mjs`) is correct, but it
 * only runs at `forge serve --once` CLAIM time — AFTER stage 1 (the real
 * architect interview + plan) has already run. `contractPreflightVerdict` lets
 * the harness run the SAME judgement `packages/flows/claim-validator.ts`
 * applies (every HARD clause from `runPreflight` — `@forge/projects` — must
 * pass; advisory failures never block) BEFORE stage 1, so a not-contract-ready
 * project is refused before anything is spawned.
 *
 * `contractPreflightVerdict` and `shouldRunContractPreflight` are PURE, like
 * `verify-cycle-stage-outcome.mjs`'s `classifyServeStageOutcome`: a judgement
 * only a live `runPreflight()` call could exercise is a judgement nobody
 * exercises in a test. `refuseUnlessContractReady` is the thin ORCHESTRATION
 * around them — it does call the injected `runPreflight`, `log` and
 * `process.exit` — kept here (not in `verify-cycle.mjs`) so the call site
 * in that 1200-line file stays a single line, and so THIS function stays
 * testable: every impure dependency arrives as a parameter, never imported
 * directly, so a test can drive it with fakes and assert on what they
 * recorded instead of shelling out to a real project dir.
 */

/**
 * @typedef {{ clause: string, title: string, hard: boolean, pass: boolean, detail: string }} ClauseResult
 * @typedef {{ projectDir: string, projectName: string, clauses: ClauseResult[], ok: boolean }} PreflightReport
 * @typedef {{ ok: boolean, failingHard: { clause: string, detail: string }[], message: string }} ContractPreflightVerdict
 */

/**
 * Judge a `PreflightReport` (the exact shape `runPreflight` from
 * `@forge/projects` returns) the same way `claim-validator.ts` does: refuse
 * when ANY hard clause fails; advisory-only failures never block. Every
 * failing hard clause is named in `failingHard` (id + detail) — the call site
 * logs each one before printing `message` and exiting, so an operator sees
 * exactly which clause(s) refused the run, not just that something did.
 *
 * @param {PreflightReport} preflightResult
 * @returns {ContractPreflightVerdict}
 */
export function contractPreflightVerdict(preflightResult) {
  const failingHard = (preflightResult.clauses ?? [])
    .filter((c) => c.hard && !c.pass)
    .map((c) => ({ clause: c.clause, detail: c.detail }));
  if (failingHard.length === 0) {
    return { ok: true, failingHard: [], message: `project ${preflightResult.projectName} is contract-ready` };
  }
  const ids = failingHard.map((c) => c.clause).join(', ');
  return {
    ok: false,
    failingHard,
    message: `REFUSING before the architect — project ${preflightResult.projectName} is not contract-ready (hard: ${ids})`,
  };
}

/**
 * Whether the pre-stage-1 contract preflight should run at all: never on the
 * routine tier (`--base-sha`), whose frozen corpus deliberately fails C2 —
 * the SAME opt-out `serveContractEnv` applies to the claim-time check, so the
 * pre-architect check and the claim-time check never disagree about which
 * tier they cover.
 *
 * @param {string | null | undefined} baseSha
 * @returns {boolean}
 */
export function shouldRunContractPreflight(baseSha) {
  return !baseSha;
}

/**
 * Refuse before ANY spend (architect/studio) when the project fails a hard
 * contract clause. This is `verify-cycle.mjs`'s ENTIRE pre-stage-1 call site,
 * moved here so that file gains only an import and a single call line: decide
 * whether to run at all (`shouldRunContractPreflight`), run the INJECTED
 * `runPreflight` (never imported directly — that is what keeps this testable
 * without `@forge/projects` or a real project dir), judge it
 * (`contractPreflightVerdict`), and on refusal log every failing hard clause
 * (id + detail) plus the summary message before exiting non-zero. Called
 * BEFORE any studio/architect spawn, so a refusal here has nothing to tear
 * down.
 *
 * Returns normally (no exit) when skipped (routine tier) or contract-ready.
 *
 * @param {object} params
 * @param {string} params.repoPath absolute path to the managed project repo
 * @param {string | null | undefined} params.baseSha `--base-sha`, if given —
 *   the routine tier; when set, `runPreflight` is never called at all
 * @param {string} params.forgeRoot forge install root, passed through to `runPreflight`
 * @param {(msg: string) => void} params.log
 * @param {(projectDir: string, opts?: object) => PreflightReport} params.runPreflight
 *   injected (e.g. `runPreflight` from `@forge/projects`) so this stays
 *   testable with a fake report instead of a real project on disk
 * @returns {void}
 */
export function refuseUnlessContractReady({ repoPath, baseSha, forgeRoot, log, runPreflight }) {
  if (!shouldRunContractPreflight(baseSha)) return;
  const verdict = contractPreflightVerdict(runPreflight(repoPath, { forgeRoot, requireRunnableGate: true }));
  if (verdict.ok) return;
  for (const c of verdict.failingHard) log(`  ✗ ${c.clause} — ${c.detail}`);
  log(verdict.message);
  process.exit(1);
}
