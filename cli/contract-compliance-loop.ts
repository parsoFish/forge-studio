/**
 * runContractComplianceLoop (R4-02-F2) — the deterministic, bounded contract
 * compliance convergence loop the onboarding agent drives a project through:
 * runPreflight → apply the deterministic auto-fixers for failing AUTO-tier
 * clauses → re-check → repeat, until every HARD clause passes (contract-green)
 * or a bounded terminal condition trips.
 *
 * Why orchestrator-band + deterministic (not the agent's own tool-use loop):
 * the authoritative "reached contract-green" signal is `runPreflight().ok`
 * (hard clauses all pass), computed HERE — never an agent's self-report. That
 * closes the recurring wave-4 "declared-data-fails-open" trap: a status the
 * agent merely claims is worthless; a status the orchestrator computes and a
 * ledger that names every clause's outcome is authoritative and never silent.
 *
 * The agent (R4-02-F1) supplies JUDGMENT around this loop — deriving the test
 * command, composing AGENTS.md, authoring constraints, accepting advisory
 * clauses with a rationale (`acceptAdvisory`). The loop itself does only the
 * deterministic auto-fixes + the authoritative re-check + the report.
 *
 * ADR-036 preserved: the loop runs no gate/CI/merge — it reads preflight and
 * applies idempotent local fixes, nothing more.
 */

import { runPreflight as realRunPreflight, type ClauseId, type ClauseResult, type PreflightReport } from './preflight.ts';
import {
  applyPreflightAutoFixes as realApplyAutoFixes,
  AUTO_ORDER,
  type PreflightAutoFixResult,
} from './preflight-fix-auto.ts';

const DEFAULT_MAX_ITERATIONS = 6;
const AUTO_FIXABLE = new Set<ClauseId>(AUTO_ORDER);

export type ComplianceStopReason =
  | 'converged'
  | 'advisory-undispositioned' // hard-green reached, but an advisory clause was left neither fixed nor accepted
  | 'no-progress'
  | 'max-iterations'
  | 'unfixable-hard-clause';

/** Per-clause final outcome. `fixed` = failing at the start, passing at the end
 *  via the loop; `accepted` = an advisory clause the caller explicitly waived
 *  with a rationale; `failed` = still failing and neither fixed nor accepted. */
export type ClauseOutcome = 'passed' | 'fixed' | 'accepted' | 'failed';

export type ClauseDisposition = {
  clause: ClauseId;
  hard: boolean;
  outcome: ClauseOutcome;
  detail: string;
};

export type ComplianceIteration = {
  iteration: number;
  hardGreen: boolean;
  failingBefore: ClauseId[];
  autoFixed: ClauseId[];
};

export type ContractComplianceReport = {
  project: string;
  /** Hard-green AND every advisory clause dispositioned (fixed or accepted). */
  converged: boolean;
  /** AUTHORITATIVE: `runPreflight().ok` on the final pass — all HARD clauses pass. */
  finalHardGreen: boolean;
  stopReason: ComplianceStopReason;
  iterations: ComplianceIteration[];
  dispositions: ClauseDisposition[];
};

type Deps = {
  runPreflight?: (dir: string, opts: { forgeRoot: string }) => PreflightReport;
  applyPreflightAutoFixes?: (input: { projectDir: string; forgeRoot: string; clauses: ClauseResult[] }) => PreflightAutoFixResult;
};

export type RunComplianceLoopInput = {
  projectDir: string;
  forgeRoot: string;
  /** Hard round cap (default 6) — a project that can't converge parks, never spins. */
  maxIterations?: number;
  /** Advisory clauses the caller explicitly accepts, keyed by clause id → rationale. */
  acceptAdvisory?: Partial<Record<ClauseId, string>>;
  /** Test-injection only. */
  deps?: Deps;
};

export function runContractComplianceLoop(input: RunComplianceLoopInput): ContractComplianceReport {
  const runPreflight = input.deps?.runPreflight ?? realRunPreflight;
  const applyAutoFixes = input.deps?.applyPreflightAutoFixes ?? realApplyAutoFixes;
  const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const accept = input.acceptAdvisory ?? {};
  const { projectDir, forgeRoot } = input;

  const iterations: ComplianceIteration[] = [];
  let report = runPreflight(projectDir, { forgeRoot });
  const initiallyFailing = new Set(report.clauses.filter((c) => !c.pass).map((c) => c.clause));

  for (let i = 1; i <= maxIterations; i++) {
    const failingBefore = report.clauses.filter((c) => !c.pass).map((c) => c.clause);
    const hasFailingAuto = report.clauses.some((c) => !c.pass && AUTO_FIXABLE.has(c.clause));

    let autoFixed: ClauseId[] = [];
    if (hasFailingAuto) {
      const fx = applyAutoFixes({ projectDir, forgeRoot, clauses: report.clauses });
      autoFixed = fx.applied.filter((a) => a.cleared).map((a) => a.clause);
    }

    report = runPreflight(projectDir, { forgeRoot });
    iterations.push({ iteration: i, hardGreen: report.ok, failingBefore, autoFixed });

    if (report.ok) break;              // hard-green reached — advisory handled in the ledger below
    if (autoFixed.length === 0) break; // no deterministic progress this round — stop, don't spin
  }

  const finalHardGreen = report.ok;
  const dispositions: ClauseDisposition[] = report.clauses.map((c) => {
    if (c.pass) {
      return { clause: c.clause, hard: c.hard, outcome: initiallyFailing.has(c.clause) ? 'fixed' : 'passed', detail: c.detail };
    }
    if (!c.hard && accept[c.clause]) {
      return { clause: c.clause, hard: false, outcome: 'accepted', detail: accept[c.clause] as string };
    }
    return { clause: c.clause, hard: c.hard, outcome: 'failed', detail: c.detail };
  });

  const advisoryUndispositioned = dispositions.some((d) => !d.hard && d.outcome === 'failed');
  const converged = finalHardGreen && !advisoryUndispositioned;

  const stopReason = resolveStopReason({ converged, finalHardGreen, dispositions, iterations, maxIterations });

  return { project: report.projectName, converged, finalHardGreen, stopReason, iterations, dispositions };
}

/** Operator-readable rendering of a compliance report — the "never silent"
 *  half of the F2 AC. Names every clause's outcome + the terminal reason. */
export function formatComplianceReport(r: ContractComplianceReport): string {
  const mark: Record<ClauseOutcome, string> = { passed: '✓', fixed: '✓ fixed', accepted: '~ accepted', failed: '✗' };
  const lines = [
    `Contract compliance — ${r.project}`,
    `  result: ${r.converged ? 'CONVERGED' : r.finalHardGreen ? 'HARD-GREEN (advisory gaps remain)' : 'NOT contract-green'}  ·  stop: ${r.stopReason}  ·  ${r.iterations.length} iteration(s)`,
    '  clauses:',
  ];
  for (const d of r.dispositions) {
    lines.push(`    ${d.hard ? 'HARD' : 'adv '} ${d.clause.padEnd(10)} ${mark[d.outcome].padEnd(11)} ${d.detail}`);
  }
  return lines.join('\n');
}

function resolveStopReason(args: {
  converged: boolean;
  finalHardGreen: boolean;
  dispositions: ClauseDisposition[];
  iterations: ComplianceIteration[];
  maxIterations: number;
}): ComplianceStopReason {
  if (args.converged) return 'converged';
  // Hard-green reached, but the caller left an advisory clause un-accepted —
  // real progress, not a stall; must not read as 'no-progress'.
  if (args.finalHardGreen) return 'advisory-undispositioned';
  // A HARD clause with no deterministic fixer is unfixable by this loop.
  const unfixableHard = args.dispositions.some(
    (d) => d.hard && d.outcome === 'failed' && !AUTO_FIXABLE.has(d.clause),
  );
  if (unfixableHard) return 'unfixable-hard-clause';
  if (args.iterations.length >= args.maxIterations) return 'max-iterations';
  return 'no-progress';
}
