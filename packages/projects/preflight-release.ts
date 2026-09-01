/**
 * forge↔project contract preflight — C10, documentation parity & release
 * substrate (ADVISORY; opt-in), US-4.1 / ADR-017. Split out of `preflight.ts`
 * (the barrel) when that file grew past the 800-line baseline cap; see
 * `scripts/baselines/file-size.json` / `scripts/check-file-size.mjs`.
 * Siblings: `preflight-gate.ts` (C1/C1b/C7), `preflight-instructions.ts`
 * (C5/C8), `preflight-demo.ts` (DEMO family), `preflight-build.ts`
 * (BUILD/ARTIFACTS), `preflight-repo.ts` (C2/C6).
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { ProjectConfig } from './project-config.ts';
import type { ClauseResult } from '@forge/kernel';

// --- C10: documentation parity & release substrate (ADVISORY; opt-in) ---

/**
 * R1-04-F2 — the preflight side of the already-documented C10 clause
 * (docs/forge-project-contract.md). `releaseProcess` is typed + consumed by the
 * release-finalizer, but NOTHING checked at preflight that the substrate each
 * declared step targets actually exists — so a project could declare a
 * `changelog` step whose `changelogPath` file is absent and only discover it
 * when the finalizer runs (log-and-continue, silently). C10 closes that: when
 * (and only when) `releaseProcess` is declared, assert each declared
 * path-substrate (`changelogPath`, `versionFile`, `docsDir`) exists, and that a
 * `changelog`/`version` step has its corresponding path declared. Advisory,
 * opt-in (inert without `releaseProcess`) — mirrors the doc's C10 semantics.
 */
function checkC10(dir: string, cfg: ProjectConfig | null): ClauseResult {
  const base = { clause: 'C10' as const, title: 'Documentation parity & release substrate', hard: false };
  const rel = cfg?.releaseProcess;
  if (!rel || rel.steps.length === 0) {
    return { ...base, pass: true, detail: 'no releaseProcess declared — release clause inert (opt-in)' };
  }
  const problems: string[] = [];
  const kinds = new Set(rel.steps.map((s) => s.kind));
  // Declared path-substrate must exist on disk.
  const pathChecks: [string, string | undefined][] = [
    ['changelogPath', rel.changelogPath],
    ['versionFile', rel.versionFile],
    ['docsDir', rel.docsDir],
  ];
  for (const [field, p] of pathChecks) {
    if (p && !existsSync(join(dir, p))) {
      problems.push(`${field} "${p}" does not exist`);
    }
  }
  // A changelog / version step needs its path declared so the finalizer knows where to write.
  if (kinds.has('changelog') && !rel.changelogPath) {
    problems.push('a `changelog` step is declared but `changelogPath` is not — the finalizer has nowhere to write the entry');
  }
  if (kinds.has('version') && !rel.versionFile) {
    problems.push('a `version` step is declared but `versionFile` is not — the finalizer cannot bump a version file');
  }
  if (problems.length > 0) {
    return {
      ...base,
      pass: false,
      detail:
        `releaseProcess declared (${rel.steps.length} step(s)) but its substrate is incomplete: ${problems.join('; ')}. ` +
        `Advisory: the release-finalizer log-and-continues on a missing target, so the release ships stale. ` +
        `Add the missing file(s)/path(s) or correct the releaseProcess declaration.`,
    };
  }
  return {
    ...base,
    pass: true,
    detail: `releaseProcess substrate present for ${rel.steps.length} step(s) (${[...kinds].join(', ')})`,
  };
}

export { checkC10 };
