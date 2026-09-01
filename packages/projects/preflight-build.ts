/**
 * forge↔project contract preflight — BUILD + ARTIFACTS (US-4.1 / ADR-017).
 * ARTIFACTS: build outputs must be gitignored (advisory, betterado #4a).
 * BUILD: the project's build process is declared, distinct from the test
 * gate (advisory, R1-04-F3). Split out of `preflight.ts` (the barrel) when
 * that file grew past the 800-line baseline cap; see
 * `scripts/baselines/file-size.json` / `scripts/check-file-size.mjs`.
 * Siblings: `preflight-gate.ts` (C1/C1b/C7), `preflight-instructions.ts`
 * (C5/C8), `preflight-demo.ts` (DEMO family), `preflight-release.ts` (C10),
 * `preflight-repo.ts` (C2/C6).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { detectProjectLanguage, type ProjectLanguage } from './gate-recipes.ts';
import type { ProjectConfig } from './project-config.ts';
import type { ClauseResult } from '@forge/kernel';

// ARTIFACTS (advisory): build outputs & generated files must be gitignored,
// else `git add -A` (the dev-loop autocommit safety-net + PR assembly) sweeps
// them into the PR — the betterado run committed a 35 MB renamed provider
// binary this way (#4). preflight cannot run a build, so the check is
// structural: for the detected language, does .gitignore mention ANY of the
// characteristic build-output patterns? Zero coverage ⇒ warn. Conservative:
// presence of any one hint clears it (we only flag the "no coverage at all" case).
export const BUILD_ARTIFACT_HINTS: Record<ProjectLanguage, readonly string[]> = {
  typescript: ['dist', 'build', '.tsbuildinfo', 'coverage', 'out', '.next', 'lib/'],
  javascript: ['dist', 'build', 'coverage', 'out', '.next'],
  go: ['*.exe', '*.test', '*.out', 'bin/', '/bin', 'dist'], // Go binaries vary; any binary-ish ignore counts
  python: ['__pycache__', '.pyc', 'dist', 'build', '.egg-info', '.coverage', '.pytest_cache'],
  rust: ['target'],
  unknown: [],
};

// W7-FIX-B-PROJ (review F4): the generic, language-agnostic build-output
// globs the onboarding scaffold writes into a freshly-created repo's
// .gitignore (`scaffoldContractArtifacts`, cli/bridge-studio-writes.ts). At
// birth the project dir may be empty, so no language is detectable — this is
// the deps + common-build-output cover set, kept HERE, beside
// BUILD_ARTIFACT_HINTS, so the scaffold and the ARTIFACTS advisory (+ its
// `fixBuildArtifacts` auto-fix) evolve in one file and never drift apart: a
// scaffolded project must not warn on ARTIFACTS for a shape this list was
// meant to cover. Each entry is a dir glob; 'dist'/'build'/'out'/'coverage'
// substring-match the typescript/javascript/python hint rows above
// (node_modules/ is dependency hygiene, not a build-output hint).
export const SCAFFOLD_BUILD_OUTPUT_IGNORES: readonly string[] = [
  'node_modules/',
  'dist/',
  'build/',
  'out/',
  'coverage/',
];

// --- ARTIFACTS: build-output ignore coverage (ADVISORY, betterado #4a) ---

function checkBuildArtifacts(dir: string): ClauseResult {
  const base = {
    clause: 'ARTIFACTS' as const,
    title: 'Build artifacts gitignored (no stray outputs in the PR)',
    hard: false,
  };
  const lang = detectProjectLanguage(dir);
  const hints = BUILD_ARTIFACT_HINTS[lang];
  if (lang === 'unknown' || hints.length === 0) {
    return { ...base, pass: true, detail: 'no language-specific build-output check (unknown project shape)' };
  }
  const giPath = join(dir, '.gitignore');
  if (!existsSync(giPath)) {
    // C2 already hard-fails on a missing .gitignore; don't double-report.
    return { ...base, pass: true, detail: 'no .gitignore (already flagged by C2)' };
  }
  const gi = readFileSync(giPath, 'utf8').toLowerCase();
  const covered = hints.some((h) => gi.includes(h.toLowerCase()));
  if (covered) {
    return { ...base, pass: true, detail: `.gitignore covers ${lang} build outputs` };
  }
  return {
    ...base,
    pass: false,
    detail:
      `.gitignore has NONE of the characteristic ${lang} build-output patterns (${hints.join(', ')}). ` +
      `A compiled binary / dist / coverage left un-ignored will be swept into the PR by \`git add -A\` ` +
      `(betterado committed a 35 MB binary this way). Advisory — add the build-output ignores for this project.`,
  };
}

// --- BUILD: the project's build process is declared (ADVISORY, R1-04-F3) ---

/**
 * R1-04-F3 — the build process, distinct from the test gate (C1/testProcess).
 * A project can gate on tests while its *build* breaks, so the compile/package
 * step is a first-class obligation. Opt-in like C10: inert unless a
 * `buildProcess` is declared. A DECLARED `remote` CI-workflow path that doesn't
 * exist is the one real fail (a broken pointer). An inferable-but-undeclared
 * build (a package.json `build` script) is surfaced as a passing INFO note, not
 * a failure — forge already knows the command, `buildProcess.local` has no
 * runtime consumer yet (R1-05-F2), and a fail would nag every Node project while
 * staying silent on the Go project that motivates the clause.
 *
 * Build-OUTPUT hygiene (compiled artifacts gitignored) is the companion
 * ARTIFACTS clause (kept separate so its `.gitignore`-append auto-fix survives);
 * the contract doc groups BUILD + ARTIFACTS under "build process".
 */
function checkBuild(dir: string, cfg: ProjectConfig | null): ClauseResult {
  const base = { clause: 'BUILD' as const, title: 'Build process declared (local + remote/CI, distinct from test)', hard: false };
  const bp = cfg?.buildProcess;
  if (bp && (bp.local || bp.remote)) {
    if (bp.remote && !existsSync(join(dir, bp.remote))) {
      return { ...base, pass: false, detail: `buildProcess declared but buildProcess.remote "${bp.remote}" (the CI workflow) does not exist. Advisory — add the workflow or correct the path.` };
    }
    const parts = [
      bp.local ? `local \`${bp.local.join(' ')}\`` : null,
      bp.remote ? `remote ${bp.remote}` : null,
    ].filter(Boolean);
    return { ...base, pass: true, detail: `buildProcess declared (${parts.join(', ')})` };
  }
  // Not declared — pass, but note the opportunity when a build is inferable.
  const inferred = inferredBuildCommand(dir);
  return {
    ...base,
    pass: true,
    detail: inferred
      ? `no buildProcess declared (a build is inferable — ${inferred}). Optional: declare buildProcess.local (+ remote CI workflow) so a broken build is a first-class obligation, not conflated with the test gate.`
      : 'no buildProcess declared and none inferable (pure-script project) — build clause inert',
  };
}

/** The inferable build command for the advisory nudge — today just a package.json `build` script. `null` if none. */
function inferredBuildCommand(dir: string): string | null {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
    const b = pkg.scripts?.build;
    return b && b.trim() ? 'package.json "build" script' : null;
  } catch {
    return null;
  }
}

export { checkBuildArtifacts, checkBuild };
