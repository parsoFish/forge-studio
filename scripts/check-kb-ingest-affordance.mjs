#!/usr/bin/env node
/**
 * check-kb-ingest-affordance.mjs — no-ingest-affordance RATCHET (operator
 * decision 3, 2026-08-03 — docs/decisions/010-brain-first.md line 22,
 * docs/roadmaps/R1-contract-componentry.md lines ~213-227: "Explicit
 * negative AC (decision 3): no ingest affordance anywhere in creation or
 * maintenance ... grep-level assert no UI route/action triggers ingest").
 *
 * Ingest stays reflection-only. This script enforces that at grep level
 * across the real repository:
 *
 *   1. No forge-ui `data-action="..."` value names ingest.
 *   2. No bridge KB route (cli/*.ts, excluding *.test.ts) has an
 *      `op === 'ingest'` / `case 'ingest'` dispatch arm.
 *   3. The literal strings `reflector-ingest` / `DEFAULT_KB_INGEST` appear
 *      ONLY in the descriptor-default definition/re-export
 *      (packages/knowledge/studio/kb-descriptor.ts, orchestrator/studio/
 *      registry.ts) and the reflection-path builtin invocation
 *      (packages/knowledge/kb-health.ts) — never in a dispatch arm or a UI
 *      action.
 *   4. No `skills/*\/SKILL.md`'s `composition.skills` names `brain-ingest`,
 *      EXCEPT `skills/reflector/SKILL.md` — the ONE place ingest is
 *      legitimately invoked (ingest stays reflection-only).
 *      `composition.skills` is normalized before the check: a flow-list is
 *      used as-is, and a bare YAML scalar (`skills: brain-ingest` — a single
 *      string, not a list) is treated as a one-element list rather than
 *      silently skipped, since that shape is an easy authoring typo.
 *
 * This is a pure structural ratchet (same "prove-or-warn, one actionable
 * line per failure" model as check-request-path-sinks.mjs) — no baseline
 * file, since the invariant is "zero, forever", not a count that only ever
 * shrinks. The check function is injectable-root so a test can point it at
 * a synthetic fixture tree instead of the real repo (see the companion
 * scripts/check-kb-ingest-affordance.test.ts, which keeps its own inline
 * copy of this logic to prove the contract from first principles before
 * trusting this script's copy against the real tree).
 *
 * LIMITATIONS, DISCLOSED (this ratchet does NOT cover these — a future pass
 * would need to extend it, not assume it already catches them):
 *   - Rule 4 only inspects `composition.skills`. It does not look at
 *     `composition.tools`, `composition.mcps`, or `materials`, nor at any
 *     prose-body instruction telling an agent to compose/invoke ingest.
 *   - Rule 4 only walks one level of `skills/<slug>/SKILL.md`; a nested
 *     `skills/<a>/<b>/SKILL.md` is not discovered.
 *   - Rule 4 does not follow symlinked skill directories.
 *   The last two mirror production's own skill-discovery walk (one-level,
 *   non-symlink-following), so they are a symmetric blind spot shared with
 *   the real runtime, not a unique hole in the ratchet.
 *
 * Usage:
 *   node scripts/check-kb-ingest-affordance.mjs
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Directories walked for forge-ui UI-action affordances.
// M2: repointed with the `git mv forge-ui -> apps/studio`. Keyed to the old
// path this lint scanned three directories that no longer existed and still
// reported PASS — the same silent-disarm the containment ratchets hit.
const UI_SCAN_DIRS = ['apps/studio/app', 'apps/studio/components', 'apps/studio/lib'];
// Directories walked for bridge KB-route dispatch code.
// M4 PR 4b: `['cli']` alone had gone BLIND. M3-A moved the bridge route
// modules out of `cli/` into their owning packages, and this scan did not
// follow — proven, not assumed: an `op === 'ingest'` probe planted in
// `packages/knowledge/bridge-studio-kb-routes-maintenance.ts` is caught with
// these dirs and INVISIBLE with `['cli']` alone (the same control shape the
// raw-fs `EXPLICIT_MODULES` remedy needed in this PR). The real tree passes
// either way, which is exactly why the blindness was silent.
// Bead forge-8vfn.5.32 (with 5.34's shape): the list above was still a HAND
// LIST of eight packages — it had already gone blind once when M3-A moved the
// bridge modules out of `cli/`, and it would go blind again the day a ninth
// package appears or the host moves to `apps/forge/`. Derived now, so neither
// event needs an edit here. The host trees are named because they are trees,
// not packages; `packages/` is enumerated.
export const BRIDGE_SCAN_DIRS = [
  'cli',
  'apps/forge',
  ...(existsSync(join(FORGE_ROOT, 'packages'))
    ? readdirSync(join(FORGE_ROOT, 'packages'), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => `packages/${e.name}`)
        .sort()
    : []),
];
// Files where DEFAULT_KB_INGEST / 'reflector-ingest' legitimately appear —
// the descriptor default (+ its re-export) and the reflection builtin.
export const ALLOWED_INGEST_FILES = new Set([
  'packages/knowledge/studio/kb-descriptor.ts',
  'orchestrator/studio/registry.ts',
  'packages/knowledge/kb-health.ts',
]);
// Top-level dir of runtime-agent SKILL.md files (rule 4 below).
const SKILLS_DIR = 'skills';
// skills/reflector/SKILL.md is the ONE legitimate composer of `brain-ingest`
// (`composition.skills: [brain-query, brain-ingest]`) — it is precisely the
// place ingest is invoked, which is what "ingest stays reflection-only"
// means. Every other agent's composition.skills must never name it.
export const ALLOWED_INGEST_SKILL_COMPOSERS = new Set([
  'skills/reflector/SKILL.md',
]);

function isTestFile(p) {
  return /\.test\.(ts|tsx|mjs|js)$/.test(p);
}

function walk(dirAbs, exts, skip) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return out; // dir doesn't exist in this tree — not an error, just nothing to scan
  }
  for (const e of entries) {
    const full = join(dirAbs, e.name);
    if (skip(full)) continue;
    if (e.isDirectory()) {
      out.push(...walk(full, exts, skip));
    } else if (exts.some((ext) => e.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * W7-D1: a file the walk enumerated can vanish before it is read — a SIBLING
 * ratchet test (`scripts/check-disabled-reason.test.ts`) plants and deletes a
 * real probe file inside `apps/studio/components/` to prove its own gate bites,
 * and `node --test` runs the two files concurrently. A file that no longer
 * exists is not a violation; it is a file that no longer exists.
 */
function readIfPresent(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

const GLOBAL_SKIP = (p) =>
  p.includes(`${join('node_modules')}`) || p.includes(`${join('.git')}`) ||
  // W7-D1: transient git worktrees are duplicate checkouts of this same repo
  // (parked lane worktrees), not additional repo state. Scanning them
  // re-reports every allowed reflection file under a path the allowlist
  // cannot match, so a developer tree with any agent worktree in it turned
  // this ratchet red for reasons that have nothing to do with the code. The
  // test-local mirror of this function already skipped them; the SHIPPED
  // checker did not — the mirror had drifted from the thing it backstops.
  p.includes(`${join('.claude', 'worktrees')}`) ||
  p.includes(`${join('brain')}`) ||
  p.includes(`${join('demos')}`) || isTestFile(p);

/**
 * Scan `root` for the no-ingest-affordance invariant. Returns a list of
 * human-readable violation strings; empty = clean.
 */
export function checkNoIngestAffordance(root = FORGE_ROOT) {
  const violations = [];

  // 1. forge-ui: no data-action="...ingest..." (case-insensitive).
  for (const dir of UI_SCAN_DIRS) {
    const files = walk(join(root, dir), ['.ts', '.tsx'], GLOBAL_SKIP);
    for (const file of files) {
      const text = readIfPresent(file);
      if (text === null) continue;
      const re = /data-action=["']([^"']*)["']/g;
      let m;
      while ((m = re.exec(text))) {
        if (m[1].toLowerCase().includes('ingest')) {
          violations.push(`${relative(root, file)}: data-action="${m[1]}" is a UI ingest affordance (forbidden — operator decision 3)`);
        }
      }
    }
  }

  // 2. bridge KB routes: no op-dispatch arm named 'ingest'.
  for (const dir of BRIDGE_SCAN_DIRS) {
    const files = walk(join(root, dir), ['.ts'], GLOBAL_SKIP);
    for (const file of files) {
      const text = readIfPresent(file);
      if (text === null) continue;
      if (/\bop\s*===\s*['"]ingest['"]/.test(text) || /\bcase\s+['"]ingest['"]/.test(text)) {
        violations.push(`${relative(root, file)}: bridge route dispatches op === 'ingest' (forbidden — operator decision 3)`);
      }
    }
  }

  // 3. reflector-ingest / DEFAULT_KB_INGEST literal must only appear in the
  //    allowed descriptor-default / reflection-builtin files.
  const allFiles = walk(root, ['.ts', '.tsx'], GLOBAL_SKIP);
  for (const file of allFiles) {
    const relPath = relative(root, file).split('\\').join('/');
    if (ALLOWED_INGEST_FILES.has(relPath)) continue;
    const text = readIfPresent(file);
    if (text === null) continue;
    if (text.includes('reflector-ingest') || text.includes('DEFAULT_KB_INGEST')) {
      violations.push(`${relPath}: references reflector-ingest/DEFAULT_KB_INGEST outside the allowed descriptor-default/reflection files`);
    }
  }

  // 4. skills/*/SKILL.md: composition.skills must not name `brain-ingest`,
  //    except the one allowed composer (reflector — ingest stays
  //    reflection-only, see ALLOWED_INGEST_SKILL_COMPOSERS above).
  const skillsRootAbs = join(root, SKILLS_DIR);
  let skillDirs;
  try {
    skillDirs = readdirSync(skillsRootAbs, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    skillDirs = []; // no skills/ dir in this tree — nothing to scan
  }
  for (const dirent of skillDirs) {
    const skillMdAbs = join(skillsRootAbs, dirent.name, 'SKILL.md');
    let raw;
    try {
      raw = readFileSync(skillMdAbs, 'utf8');
    } catch {
      continue; // no SKILL.md in this skill dir — nothing to scan
    }
    const relPath = relative(root, skillMdAbs).split('\\').join('/');
    if (ALLOWED_INGEST_SKILL_COMPOSERS.has(relPath)) continue;

    let data;
    try {
      ({ data } = matter(raw, {})); // {} opts out of gray-matter's parse cache
    } catch {
      continue; // unparseable frontmatter is brain-lint's concern, not this ratchet's
    }
    const composition = data && typeof data === 'object' && !Array.isArray(data) ? data.composition : undefined;
    // composition.skills is normally a flow-list (Array), but a bare YAML
    // scalar (`skills: brain-ingest`) is valid frontmatter too — an easy
    // authoring typo. Normalize a bare string to a single-element list
    // before the membership test below, so it isn't silently treated as
    // zero skills.
    const rawSkills = composition && typeof composition === 'object' && !Array.isArray(composition) ? composition.skills : undefined;
    const skillsList = Array.isArray(rawSkills) ? rawSkills : typeof rawSkills === 'string' ? [rawSkills] : [];
    if (skillsList.includes('brain-ingest')) {
      violations.push(
        `${relPath}: composition.skills includes 'brain-ingest' (forbidden — operator decision 3, ingest stays reflection-only. Remove it from composition.skills, or if this is a legitimate reflection-path composer add it to ALLOWED_INGEST_SKILL_COMPOSERS.)`,
      );
    }
  }

  return violations;
}

/**
 * Run the check. Root is injectable so tests can point this at a temp
 * fixture tree instead of the real repo. Returns a process exit code;
 * never calls process.exit itself.
 */
export function runCheck({ root = FORGE_ROOT } = {}) {
  const violations = checkNoIngestAffordance(root);
  if (violations.length) {
    console.error(`check-kb-ingest-affordance: FAIL (${violations.length} ingest affordance${violations.length === 1 ? '' : 's'} found — forbidden, operator decision 3)`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    console.error('');
    console.error('Ingest stays reflection-only (docs/decisions/010-brain-first.md). Remove the UI action / bridge dispatch arm / stray reference, or move it into the allowed descriptor-default files.');
    return 1;
  }
  console.log('check-kb-ingest-affordance: PASS — no ingest affordance in forge-ui, the bridge KB routes, stray reflector-ingest/DEFAULT_KB_INGEST references, or skills/*/SKILL.md composition.skills');
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // `process.exitCode`, never `process.exit()` — see check-raw-fs-guarded.mjs.
  process.exitCode = runCheck();
}
