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
 * Pure, like `verify-cycle-stage-outcome.mjs`'s `classifyServeStageOutcome`:
 * a judgement only a live `runPreflight()` call could exercise is a judgement
 * nobody exercises in a test. This module does no fs / child_process /
 * process.exit — `verify-cycle.mjs`'s thin call site owns the impure
 * `runPreflight(...)` call and the log-and-exit; this module only judges an
 * already-computed report and decides whether to run it at all.
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
