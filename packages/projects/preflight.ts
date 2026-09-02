/**
 * forge↔project contract preflight (US-4.1 / ADR-017).
 *
 * Checks a project directory against the contract clauses derived empirically
 * from the trafficGame arc (brain theme `forge-project-onboarding-contract`;
 * retro §3 C1–C6) plus betterado-era additions (C7 conditional, C8 advisory).
 * A project either passes or forge declines, naming the failing clause.
 *
 * Pure: `runPreflight()` does filesystem reads + git inspection and returns a
 * structured report. No mutation, no network, no SDK. The CLI wrapper
 * (`orchestrator/cli.ts`) renders + sets exit code + writes the
 * `preflight.verdict` JSONL event.
 *
 * Hard clauses (C1/C2/C4) fail the preflight (non-zero exit). C5/C6/C8 +
 * DEMO are advisory — surfaced as warnings, not blockers — because (C5)
 * constraint-doc presence can't prove the harness honours them, (C6) is
 * structurally satisfied by forge post-Phase-6 (no auto-merge; the operator
 * merges the PR), (C8) absence of an agent-instruction file is a gap but not a
 * blocker, and (DEMO) demoProcess step presence can't prove the demo evidence
 * is correct (hand-verified at onboarding).
 * DEMO is the project half of the demo contract family; the forge half is
 * skills/demo/SKILL.md.
 *
 * This file is the BARREL of a clause-family split (it grew past the
 * 800-line baseline cap): `runPreflight` (the composer), `buildVerdictEvent`,
 * `formatPreflightReport`, C4 and BRAIN live here; every other clause check
 * lives in a sibling and is imported below. Every symbol this file exported
 * before the split is still exported (directly or re-exported) from this
 * same path, so no external importer needs to change. Siblings:
 * `preflight-gate.ts` (C1/C1b/C7), `preflight-instructions.ts` (C5/C8),
 * `preflight-demo.ts` (DEMO family), `preflight-release.ts` (C10),
 * `preflight-build.ts` (BUILD/ARTIFACTS), `preflight-repo.ts` (C2/C6).
 * C4 and BRAIN stay here rather than moving to `preflight-repo.ts` with the
 * rest of the "repo" family — they were the two clauses that carried this
 * file's one baselined cross-package edge into `@forge/knowledge`, so the
 * split kept them together rather than trading the edge for a same-count
 * rename. That edge is now GONE: M4's layout PR moved `projectBrainDir` and
 * `projectThemesDir` into `@forge/kernel` (ruling 18 — a symbol two rank-2
 * siblings need goes to kernel, it never travels sideways) and deleted the
 * row from `scripts/baselines/boundaries.json`. The grouping stays because
 * it is the right grouping, not because a boundary row forces it. See
 * `preflight-repo.ts`'s header for the rest of the reasoning.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadProjectConfig, type ProjectConfig } from './project-config.ts';

export type { ClauseId, ClauseResult, PreflightReport, PreflightOptions } from '@forge/kernel';
import {
  type ClauseId,
  type ClauseResult,
  type PreflightReport,
  type PreflightOptions,
  projectBrainDir,
  projectThemesDir,
  FORGE_ROOT,
} from '@forge/kernel';

import { checkC1, checkC1b, checkC7 } from './preflight-gate.ts';
import { checkC5, checkC8 } from './preflight-instructions.ts';
import { checkC2, checkC6 } from './preflight-repo.ts';
import { checkC10 } from './preflight-release.ts';
import { checkDemo, checkDemoSkill, checkDemoAlignment } from './preflight-demo.ts';
import { checkBuild, checkBuildArtifacts } from './preflight-build.ts';
import { checkSkills } from './preflight-skills.ts';
import { checkDeps } from './preflight-deps.ts';

// Re-export every symbol the pre-split file exported from these siblings, so
// `from '@forge/projects/preflight.ts'` / `from './preflight.ts'` keeps
// resolving unchanged for every external + same-package importer.
export { SCRATCH_PATHS } from './preflight-repo.ts';
export { BUILD_ARTIFACT_HINTS, SCAFFOLD_BUILD_OUTPUT_IGNORES } from './preflight-build.ts';
export { checkDemo } from './preflight-demo.ts';

export function runPreflight(
  projectDir: string,
  opts: PreflightOptions = {},
): PreflightReport {
  const dir = resolve(projectDir);
  const projectName = dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;
  const forgeRoot = opts.forgeRoot ?? FORGE_ROOT;

  // R1-03-F1: load the typed config ONCE for the testProcess-sourced clauses
  // (C1/C1b/C7). A load failure (e.g. an un-migrated flat-key config) is
  // surfaced through C1's detail — preflight reports, it never crashes.
  let cfg: ProjectConfig | null = null;
  let cfgError: string | null = null;
  try {
    cfg = loadProjectConfig(dir);
  } catch (err) {
    cfgError = err instanceof Error ? err.message : String(err);
  }

  const clauses: ClauseResult[] = [
    checkC1(dir, cfg, cfgError),
    checkC1b(cfg, cfgError),
    checkC2(dir),
    checkC4(dir, projectName, forgeRoot),
    checkC5(dir),
    checkC6(dir),
    checkC7(cfg),
    checkC8(dir, cfg),
    checkC10(dir, cfg),
    checkDemo(dir),
    checkDemoSkill(dir),
    checkDemoAlignment(cfg),
    checkBuild(dir, cfg),
    checkBuildArtifacts(dir),
    checkSkills(dir, cfg, forgeRoot),
    // DEPS (bead 5.21): the declared gate must be RUNNABLE in this ground, not
    // merely declared. `linkProjectDeps` used to skip an unprovisioned ground
    // silently (`if (!existsSync(src)) continue`), so the run died three
    // minutes and $1.61 later as `dev-loop.baseline-red` "Cannot find package
    // tsx". `claim-validator.ts` already runs this preflight against the
    // ground at claim time, so refusing here is what makes the failure loud
    // and early rather than expensive and late.
    ...(opts.requireRunnableGate ? [checkDeps(dir, cfg)] : []),
    checkBrainStaleness(dir, projectName, forgeRoot),
  ];

  const ok = clauses.filter((c) => c.hard).every((c) => c.pass);
  return { projectDir: dir, projectName, clauses, ok };
}

// --- C4: machine-consumable architecture context (HARD) ---

function checkC4(dir: string, projectName: string, forgeRoot: string): ClauseResult {
  const base = { clause: 'C4' as const, title: 'Machine-readable architecture context', hard: true };
  const roadmap = join(dir, 'roadmap.md');
  // roadmap.md is the project's own architecture context (stays in the project
  // repo). Brain 3 is forge-owned + CENTRAL (ADR 035): brain/projects/<name>/profile.md.
  const brainRel = `brain/projects/${projectName}/profile.md`;
  const brainProfile = join(projectBrainDir(forgeRoot, projectName), 'profile.md');
  const hasRoadmap = existsSync(roadmap);
  const hasBrain = existsSync(brainProfile);
  if (hasRoadmap && hasBrain) {
    return { ...base, pass: true, detail: `roadmap.md + central brain sub-wiki present (${brainRel})` };
  }
  const missing: string[] = [];
  if (!hasRoadmap) missing.push('roadmap.md (in project root)');
  if (!hasBrain) missing.push(`${brainRel} (forge-owned central project brain — Brain 3, ADR 035)`);
  return {
    ...base,
    pass: false,
    detail: `missing ${missing.join(' and ')} — the architect/PM have no queryable structure and will hallucinate paths`,
  };
}

/**
 * Advisory (never blocks): scan the project's brain themes for cited
 * `src/…` / `tests/…` source paths that no longer exist in the project
 * repo. A theme citing deleted/renamed files is the failure mode that
 * silently thrashed the PM (2026-05-18): the PM reads the brain first,
 * ingests a model that contradicts the actual tree, and burns its whole
 * budget unable to reconcile. This surfaces the contradiction BEFORE a
 * cycle, so the operator can reconcile the theme (the reflection phase
 * normally does this, but by-hand project changes skip it).
 *
 * WARN only — themes legitimately reference history; the operator judges.
 */
function checkBrainStaleness(
  dir: string,
  projectName: string,
  forgeRoot: string,
): ClauseResult {
  const base = {
    clause: 'BRAIN' as const,
    title: 'Brain freshness (themes cite live source paths)',
    hard: false,
  };
  // Brain 3 is forge-owned + CENTRAL (ADR 035): brain/projects/<name>/themes/.
  const themesDir = projectThemesDir(forgeRoot, projectName);
  if (!existsSync(themesDir)) {
    return { ...base, pass: true, detail: 'no project brain themes to check' };
  }
  // Match worktree-relative source tokens in markdown links or inline code,
  // including the `…/projects/<name>/src/…` link form themes use — we only
  // flag the high-signal `src/` and `tests/` code paths with a file ext.
  const pathRe = /(?:^|[("`\s/])((?:src|tests)\/[A-Za-z0-9._/-]+\.[A-Za-z0-9]+)/g;
  const missing = new Map<string, string>(); // citedPath -> first theme file
  let themeFiles: string[] = [];
  try {
    themeFiles = readdirSync(themesDir).filter((f) => f.endsWith('.md'));
  } catch {
    return { ...base, pass: true, detail: 'project themes unreadable — skipped' };
  }
  for (const f of themeFiles) {
    let content: string;
    try {
      content = readFileSync(join(themesDir, f), 'utf8');
    } catch {
      continue;
    }
    for (const m of content.matchAll(pathRe)) {
      const cited = m[1];
      if (missing.has(cited)) continue;
      if (!existsSync(join(dir, cited))) missing.set(cited, f);
    }
  }
  if (missing.size === 0) {
    return {
      ...base,
      pass: true,
      detail: `all src/tests paths cited by ${themeFiles.length} theme(s) exist in the project`,
    };
  }
  const sample = [...missing.entries()]
    .slice(0, 6)
    .map(([p, f]) => `${p} (${f})`)
    .join('; ');
  return {
    ...base,
    pass: false,
    detail:
      `${missing.size} brain-cited source path(s) no longer exist — theme(s) may be stale and ` +
      `will mislead the planner (PM/architect read the brain first). Reconcile against the code ` +
      `(or run a reflection pass). Sample: ${sample}`,
  };
}

/**
 * Structured event emitted by `orchestrator/cli.ts` cmdPreflight after every
 * run (CON-5). The CLI owns the write so preflight.ts stays pure (no IO side
 * effects). Export the type + builder here so the CLI can import them.
 */
export type PreflightVerdictEvent = {
  event_type: 'preflight.verdict';
  project_dir: string;
  project_name: string;
  ok: boolean;
  failing_clause_ids: ClauseId[];
  warning_clause_ids: ClauseId[];
  timestamp: string;
};

/** Build a `PreflightVerdictEvent` from a completed report. */
export function buildVerdictEvent(r: PreflightReport): PreflightVerdictEvent {
  return {
    event_type: 'preflight.verdict',
    project_dir: r.projectDir,
    project_name: r.projectName,
    ok: r.ok,
    failing_clause_ids: r.clauses
      .filter((c) => c.hard && !c.pass)
      .map((c) => c.clause),
    warning_clause_ids: r.clauses
      .filter((c) => !c.hard && !c.pass)
      .map((c) => c.clause),
    timestamp: new Date().toISOString(),
  };
}

/** Render a human-facing per-clause report. Returned, not printed (the CLI prints). */
export function formatPreflightReport(r: PreflightReport): string {
  const lines: string[] = [];
  lines.push(`forge preflight — ${r.projectName}  (${r.projectDir})`);
  lines.push('');
  for (const c of r.clauses) {
    const mark = c.pass ? 'PASS' : c.hard ? 'FAIL' : 'WARN';
    lines.push(`  ${mark}  ${c.clause} ${c.title}`);
    lines.push(`        ${c.detail}`);
  }
  lines.push('');
  if (r.ok) {
    const warns = r.clauses.filter((c) => !c.pass && !c.hard).length;
    lines.push(
      warns > 0
        ? `CONTRACT MET (hard clauses pass; ${warns} advisory warning(s) — review before unattended runs).`
        : 'CONTRACT MET — forge can progress this project unattended.',
    );
  } else {
    const failed = r.clauses.filter((c) => c.hard && !c.pass).map((c) => c.clause);
    lines.push(`CONTRACT NOT MET — forge declines. Failing hard clause(s): ${failed.join(', ')}.`);
  }
  return lines.join('\n');
}
