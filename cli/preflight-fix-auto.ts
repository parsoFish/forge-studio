/**
 * Stage D — deterministic preflight auto-fixers.
 *
 * Mirrors `cli/brain-fix-auto.ts`: surgical, idempotent project edits that clear
 * an AUTO-tier preflight clause. Three fixers (the only clauses with a safe
 * deterministic fix):
 *
 *   - C2        → append the forge scratch paths to `.gitignore`.
 *   - ARTIFACTS → append the language build-output globs to `.gitignore`.
 *   - C4        → scaffold the missing `roadmap.md` + central
 *                 `brain/projects/<name>/profile.md` stubs.
 *
 * After applying, re-runs `runPreflight` once and stamps each applied fix with
 * whether its clause actually cleared, so a fix that didn't help (e.g. C2 scratch
 * still git-TRACKED, which `.gitignore` cannot fix) is surfaced, never reported
 * as a false success.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';

import { detectProjectLanguage } from '../orchestrator/gate-recipes.ts';
import { projectBrainDir } from '../orchestrator/brain-paths.ts';
import { runPreflight, SCRATCH_PATHS, BUILD_ARTIFACT_HINTS, type ClauseId, type ClauseResult } from './preflight.ts';

export type PreflightAutoFixResult = {
  applied: Array<{ clause: ClauseId; detail: string; cleared: boolean }>;
  skipped: Array<{ clause: ClauseId; reason: string }>;
};

type FixContext = { projectDir: string; forgeRoot: string; projectName: string };
type FixOutcome = { ok: boolean; detail: string };

// Stable apply order — C2 ensures `.gitignore` exists before ARTIFACTS appends to it.
const AUTO_ORDER: ClauseId[] = ['C2', 'ARTIFACTS', 'C4'];

const FIXERS: Partial<Record<ClauseId, (ctx: FixContext) => FixOutcome>> = {
  C2: fixScratchHygiene,
  ARTIFACTS: fixBuildArtifacts,
  C4: fixArchContext,
};

/**
 * Apply every deterministic fixer for the failing AUTO-tier clauses in `clauses`.
 * Idempotent: re-running on an already-fixed project is a no-op. Returns what
 * changed + what was skipped, with `cleared` reflecting the post-fix re-run.
 */
export function applyPreflightAutoFixes(input: {
  projectDir: string;
  forgeRoot: string;
  clauses: ClauseResult[];
}): PreflightAutoFixResult {
  const projectName = basename(input.projectDir.replace(/[\\/]+$/, ''));
  const ctx: FixContext = { projectDir: input.projectDir, forgeRoot: input.forgeRoot, projectName };
  const failing = new Set(input.clauses.filter((c) => !c.pass).map((c) => c.clause));

  const applied: PreflightAutoFixResult['applied'] = [];
  const skipped: PreflightAutoFixResult['skipped'] = [];

  for (const id of AUTO_ORDER) {
    if (!failing.has(id)) continue;
    const fixer = FIXERS[id];
    if (!fixer) {
      skipped.push({ clause: id, reason: 'no auto-fixer' });
      continue;
    }
    const r = fixer(ctx);
    if (r.ok) applied.push({ clause: id, detail: r.detail, cleared: false });
    else skipped.push({ clause: id, reason: r.detail });
  }

  // Re-run preflight once to confirm each applied clause actually cleared.
  if (applied.length > 0) {
    const report = runPreflight(input.projectDir, { forgeRoot: input.forgeRoot });
    const passById = new Map(report.clauses.map((c) => [c.clause, c.pass]));
    for (const a of applied) a.cleared = passById.get(a.clause) ?? false;
  }

  return { applied, skipped };
}

// --- fixers ---------------------------------------------------------------

function fixScratchHygiene({ projectDir }: FixContext): FixOutcome {
  return appendGitignore(projectDir, SCRATCH_PATHS, 'forge scratch');
}

function fixBuildArtifacts({ projectDir }: FixContext): FixOutcome {
  const lang = detectProjectLanguage(projectDir);
  const hints = BUILD_ARTIFACT_HINTS[lang];
  if (lang === 'unknown' || hints.length === 0) {
    return { ok: false, detail: 'unknown project language — no build-output globs to ignore' };
  }
  return appendGitignore(projectDir, [...hints], `${lang} build outputs`);
}

function fixArchContext({ projectDir, forgeRoot, projectName }: FixContext): FixOutcome {
  const created: string[] = [];

  const roadmap = join(projectDir, 'roadmap.md');
  if (!existsSync(roadmap)) {
    writeFileSync(roadmap, roadmapStub(projectName));
    created.push('roadmap.md');
  }

  const brainDir = projectBrainDir(forgeRoot, projectName);
  const profile = join(brainDir, 'profile.md');
  if (!existsSync(profile)) {
    mkdirSync(brainDir, { recursive: true });
    writeFileSync(profile, profileStub(projectName));
    created.push(`brain/projects/${projectName}/profile.md`);
  }

  if (created.length === 0) return { ok: true, detail: 'roadmap.md + project brain profile already present' };
  return { ok: true, detail: `scaffolded ${created.join(' + ')} (stub — fill with real architecture context)` };
}

// --- helpers --------------------------------------------------------------

/** Append any of `entries` not already present in `<dir>/.gitignore` (idempotent). */
function appendGitignore(dir: string, entries: readonly string[], label: string): FixOutcome {
  const giPath = join(dir, '.gitignore');
  const existing = existsSync(giPath) ? readFileSync(giPath, 'utf8') : '';
  const present = new Set(
    existing.split('\n').map((l) => l.trim()).filter(Boolean),
  );
  const missing = entries.filter((e) => !present.has(e));
  if (missing.length === 0) return { ok: true, detail: `${label}: already covered in .gitignore` };

  const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
  const block = `${prefix}# ${label} (forge preflight auto-fix)\n${missing.join('\n')}\n`;
  writeFileSync(giPath, existing + block);
  return { ok: true, detail: `${label}: added ${missing.join(', ')} to .gitignore` };
}

function roadmapStub(projectName: string): string {
  return [
    `# ${projectName} — roadmap`,
    '',
    '> Stub scaffolded by forge preflight auto-fix. Replace with the real',
    '> architecture context: the goals, the major components, and the ordered',
    '> initiatives the architect/PM should decompose. Without real content here',
    '> the planners have no queryable structure and will guess paths.',
    '',
    '## Goals',
    '',
    '- _TODO_',
    '',
    '## Initiatives',
    '',
    '- _TODO_',
    '',
  ].join('\n');
}

function profileStub(projectName: string): string {
  return [
    '---',
    `name: ${projectName}-profile`,
    `description: Architecture profile for ${projectName} (stub — fill in).`,
    '---',
    '',
    `# ${projectName} — project profile`,
    '',
    '> Stub scaffolded by forge preflight auto-fix (Brain 3 — forge-owned central',
    '> project brain, ADR 035). Replace with the real structure: languages, build',
    '> + test commands, module layout, and the conventions the dev-loop must honour.',
    '',
  ].join('\n');
}
