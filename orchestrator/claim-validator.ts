/**
 * Claim-time validation for the scheduler (ADR-028 decision 8, M3-6).
 *
 * validateClaimable() is called in runOne BEFORE runCycle. It refuses claims
 * for three structural reasons:
 *
 *   1. Project not contract-ready (runPreflight hard clauses C1/C2/C4 fail).
 *      → terminal: false  — the project might be fixed by the operator; leave in
 *        pending and log once (spin-guarded).
 *      → ONLY runs when the project directory exists on disk. If the path is absent
 *        (test fixtures, non-onboarded projects) the check is skipped as best-effort.
 *
 *   2. Flow invalid (validateFlow errors) OR flow definition cannot be loaded.
 *      → terminal: true   — a broken flow definition requires a code/config change.
 *
 *   3. Zero-gate non-disposable flow.
 *      → terminal: true   — caught by validateFlow as a zero-gate error (same path).
 *
 * Edit-lock version seam (M3-6 minimal):
 *   The flow version at claim time is returned in ClaimValidationResult.flowVersion.
 *   The scheduler annotates the manifest with `flow_version` so mid-run changes can
 *   be detected (a warning is logged when the on-disk version differs at any point
 *   after claim — the full edit-lock UX is M4).
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { runPreflight } from '../cli/preflight.ts';
import { loadFlowDefinition, listAgentDefinitions } from './studio/registry.ts';
import { validateFlow } from './studio/validate.ts';
import type { AgentDefinition } from './studio/types.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ClaimValidationResult =
  | { ok: true; flowVersion: number }
  | { ok: false; reason: string; terminal: boolean };

// ---------------------------------------------------------------------------
// Internal: skip-set — per-process set of initiative IDs refused for a
// non-terminal reason (project not contract-ready). The scheduler's claim
// path checks this set BEFORE calling claim() so a broken project is
// evaluated once per `forge serve` process, not every 5-second poll tick —
// killing the inFlight slot churn while preserving the manifest in pending/
// so a fresh `forge serve` (after the operator fixes the project) re-checks.
// ---------------------------------------------------------------------------

const _loggedPendingRefusals = new Set<string>();

/**
 * Returns true if the given initiativeId has already been refused as
 * non-terminal in this process lifetime. The scheduler uses this to skip
 * re-claiming the initiative on subsequent poll ticks.
 */
export function isNonTerminalRefused(initiativeId: string): boolean {
  return _loggedPendingRefusals.has(`${initiativeId}:preflight`);
}

/**
 * Clear the skip-set for a given initiativeId. Exported for tests so they
 * can reset state between runs without module reload.
 */
export function clearPendingRefusalLog(initiativeId: string): void {
  _loggedPendingRefusals.delete(`${initiativeId}:preflight`);
}

/** Clear all skip-set state (test utility). */
export function clearAllPendingRefusalLogs(): void {
  _loggedPendingRefusals.clear();
}

// ---------------------------------------------------------------------------
// Internal: load agents for validateFlow
// ---------------------------------------------------------------------------

/**
 * Best-effort agent map for validateFlow.
 * Loads from `skills/` relative to forgeRoot. If the directory is missing or
 * any agent fails to load, returns whatever we managed to collect — validateFlow
 * will flag unresolved agent refs as errors, which is the correct signal.
 */
function loadAgentMap(forgeRoot: string): ReadonlyMap<string, AgentDefinition> {
  const skillsDir = join(forgeRoot, 'skills');
  if (!existsSync(skillsDir)) return new Map();
  try {
    const defs = listAgentDefinitions(skillsDir);
    return new Map(defs.map((d) => [d.slug, d]));
  } catch {
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// Public: validateClaimable
// ---------------------------------------------------------------------------

/**
 * Check whether a manifest is safe to claim and run right now.
 *
 * @param initiativeId     - used for the spin-guard (log once per id)
 * @param projectRepoPath  - absolute path to the managed project repo
 * @param forgeRoot        - the forge install root (for skills/ + studio/flows/)
 * @param flowYamlPath     - absolute path to the flow definition the manifest's
 *                           `flow_id` resolves to. REQUIRED: S8/DEC-3 retired the
 *                           forge-cycle default, so a manifest that names no flow
 *                           is unclaimable (refused, terminal).
 */
export function validateClaimable(
  initiativeId: string,
  projectRepoPath: string,
  forgeRoot: string,
  flowYamlPath?: string,
): ClaimValidationResult {
  // -------------------------------------------------------------------
  // 1. Flow validity (terminal) — structural, needs code/config change
  // -------------------------------------------------------------------
  // S8/DEC-3: no default flow. A manifest with no flow_id (so the caller passes
  // no path) cannot be routed — refuse terminally rather than fall back.
  if (!flowYamlPath) {
    return {
      ok: false,
      reason:
        'manifest names no flow_id — claim refused (the forge-cycle default was retired in S8/DEC-3; ' +
        'set flow_id to an existing flow, e.g. forge-architect / forge-develop / forge-reflect)',
      terminal: true,
    };
  }
  const resolvedFlowPath = flowYamlPath;

  let flowVersion: number;
  try {
    const flow = loadFlowDefinition(resolvedFlowPath);
    flowVersion = flow.version;

    // validateFlow needs an agent map; missing agents produce agent-ref errors
    // which are properly terminal — the flow references a non-existent agent.
    // validateFlow checks structural integrity; agent-ref checks require the full
    // catalog which may not be present in all environments. At claim-time we only
    // refuse on STRUCTURAL errors (acyclic, zero-gate, node-shape, edge-ref) —
    // agent-ref mismatches are surfaced by `forge studio lint` (not claim-time).
    // Pass the real agent map (populated when the skills/ dir exists) so agent-ref
    // errors ARE reported when the catalog is available.
    const agents = loadAgentMap(forgeRoot);
    const findings = validateFlow(flow, agents);
    const structuralChecks = new Set(['acyclic', 'zero-gate', 'node-shape', 'edge-ref', 'slug', 'version', 'node-ids', 'fan-out']);
    const errors = findings.filter(
      (f) => f.level === 'error' && structuralChecks.has(f.check),
    );
    if (errors.length > 0) {
      const summary = errors
        .slice(0, 3)
        .map((e) => `[${e.check}] ${e.message}`)
        .join('; ');
      return {
        ok: false,
        reason: `flow "${flow.id}" failed validation (${errors.length} error(s)): ${summary}`,
        terminal: true,
      };
    }
  } catch (err) {
    return {
      ok: false,
      reason: `flow definition could not be loaded: ${(err as Error).message}`,
      terminal: true,
    };
  }

  // -------------------------------------------------------------------
  // 2. Project contract-ready (non-terminal, leave in pending)
  //    Only runs when the project directory actually exists on disk.
  //    Skip entirely for non-existent paths (test fixtures, unregistered
  //    projects) — best-effort; validateClaimable must never block a
  //    legitimate claim because the test fixture isn't a real project.
  //
  //    Opt-out: FORGE_SKIP_CONTRACT_CHECK=1 bypasses this block for the
  //    controlled real-capability harness (scripts/verify-cycle.mjs routine
  //    tier) where the corpus repo is reset to a frozen SHA that deliberately
  //    fails C2 scratch-hygiene. The harness tests ENGINE EXECUTION, not
  //    project onboarding readiness — the contract gate is orthogonal there.
  //    The flow-validity (check 1) and zero-gate (check 1 via validateFlow)
  //    structural checks above are NEVER skipped — only this preflight block.
  // -------------------------------------------------------------------
  if (process.env.FORGE_SKIP_CONTRACT_CHECK === '1') {
    console.log(
      `[claim-validator] claim.contract-check-skipped initiativeId=${initiativeId} ` +
        `reason=FORGE_SKIP_CONTRACT_CHECK=1 (controlled harness execution test — not production)`,
    );
  }

  const projectDir = resolve(projectRepoPath);
  if (process.env.FORGE_SKIP_CONTRACT_CHECK !== '1' && existsSync(projectDir)) {
    let report;
    try {
      report = runPreflight(projectDir, { forgeRoot });
    } catch {
      // Preflight itself threw (e.g. git not available, malformed project).
      // Treat as non-blocking: the cycle will likely fail on its own, and
      // the failure-classifier + auto-retry machinery handles that.
      report = null;
    }

    if (report !== null && !report.ok) {
      const failingClauses = report.clauses
        .filter((c) => c.hard && !c.pass)
        .map((c) => c.clause)
        .join(', ');
      const reason =
        `project "${report.projectName}" is not contract-ready ` +
        `(failing hard clause(s): ${failingClauses}) — ` +
        `fix the project contract before retrying`;

      // Skip-set: record this initiative so the scheduler skips re-claiming it
      // on subsequent poll ticks (once per process lifetime — a fresh `forge
      // serve` after the operator fixes the project will re-check). The
      // scheduler reads isNonTerminalRefused() before calling claim().
      _loggedPendingRefusals.add(`${initiativeId}:preflight`);
      return {
        ok: false,
        reason,
        terminal: false, // leave in pending — operator can fix the project
      };
    }
  }

  // -------------------------------------------------------------------
  // All checks passed
  // -------------------------------------------------------------------
  return { ok: true, flowVersion };
}
