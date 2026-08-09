/**
 * Project creation agent — greenfield (R4-03).
 *
 * "Like onboarding, but without the existing repo": take a typed creation
 * manifest (F1), scaffold a new repo from a curated framework template (F2,
 * `studio/starters/projects/<app-type>/`), then hand off to the R4-02 onboarding
 * loop — here, seed the central brain + run preflight — so a freshly created
 * project is contract-green and ready for its first architect run (F3).
 *
 * The templates carry the code skeleton + `.forge/project.json` (the C1 gate) +
 * AGENTS.md (C8) + a gitignore (C2/ARTIFACTS) + roadmap.md (C4 project side).
 * The only forge-owned piece not in a template is the CENTRAL Brain-3 stub
 * (ADR-035), which `seedProjectBrain` lays down — so a scaffold reaches hard-green
 * with no manual repo surgery.
 */

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

import { seedProjectBrain, checkProjectBrainSeedContainment } from './project-brain-seed.ts';
import { runPreflight, type ClauseResult } from '../cli/preflight.ts';
import { skillsDir } from './skill-path.ts';

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
// {{NAME}} = the slug id (npm-safe: package.json name/bin, the kb binding, the
// project dir). {{TITLE}} = the human name (display: headings, project.json name).
const NAME_TOKEN = /\{\{NAME\}\}/g;
const TITLE_TOKEN = /\{\{TITLE\}\}/g;
const NORTH_STAR_TOKEN = /\{\{NORTH_STAR\}\}/g;

export type CreationManifest = {
  /** Human name; the slug id is derived from it. */
  name: string;
  /** A curated app-type template id (see {@link listProjectStarters}). */
  appType: string;
  /** Language (informational; the template encodes the toolchain). */
  language: string;
  /** One-sentence north star. */
  northStar: string;
  /** Optional free-text architecture notes surfaced into roadmap/README. */
  architecture?: string;
};

export type ScaffoldResult = {
  id: string;
  projectDir: string;
  appType: string;
  hardGreen: boolean;
  failingClauses: ClauseResult[];
  filesWritten: string[];
};

/** The `studio/starters/projects/` dir — the F2 template library root. */
export function projectStartersDir(forgeRoot: string): string {
  // Starters live beside the skills tree, under studio/.
  return join(skillsDir(forgeRoot), '..', 'studio', 'starters', 'projects');
}

/** The curated app-type templates available for creation. */
export function listProjectStarters(forgeRoot: string): string[] {
  const dir = projectStartersDir(forgeRoot);
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Validate + normalize an untyped creation manifest (R4-03-F1). Throws on any
 *  missing/invalid field so a bad manifest fails fast at the boundary. */
export function validateCreationManifest(raw: unknown): CreationManifest {
  if (raw === null || typeof raw !== 'object') throw new Error('creation manifest must be an object');
  const m = raw as Record<string, unknown>;
  const str = (k: string): string => {
    const v = m[k];
    if (typeof v !== 'string' || v.trim() === '') throw new Error(`creation manifest: "${k}" is required (non-empty string)`);
    // Single-line fields — a newline/control char would break scaffolded markdown
    // structure (quotes/backslashes are fine; they're JSON-escaped when written).
    if (/[\u0000-\u001f]/.test(v)) throw new Error(`creation manifest: "${k}" must be a single line (no control characters)`);
    // Defense-in-depth boundary refusal (SEC-05 / forge-hwo): a comment
    // terminator bigram (`*/` or `/*`) in a human-authored value can break out
    // of a scaffolded code file's JSDoc header. `commentSafe` neutralizes it at
    // the copyTemplate sink; here the boundary refuses it outright so no path
    // that validates a manifest can carry the break-out payload downstream.
    if (v.includes('*/') || v.includes('/*')) throw new Error(`creation manifest: "${k}" must not contain a comment terminator`);
    return v.trim();
  };
  const manifest: CreationManifest = {
    name: str('name'),
    appType: str('appType'),
    language: str('language'),
    northStar: str('northStar'),
    ...(typeof m['architecture'] === 'string' && m['architecture'].trim() ? { architecture: (m['architecture'] as string).trim() } : {}),
  };
  if (manifest.northStar.length > 140) throw new Error('creation manifest: northStar must be ≤140 chars');
  return manifest;
}

/** Derive the slug id from a human name (mirrors the onboard create route). */
export function slugifyProjectName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '');
}

/** JSON-escape a value for insertion into a JSON string position — the inner of
 *  its quoted form (so `A "smart" tool` → `A \"smart\" tool`). */
function jsonInner(s: string): string {
  return JSON.stringify(s).slice(1, -1);
}

/** Neutralize the two comment-terminator bigrams so a human-authored value
 *  can't break out of a scaffolded CODE file's comment (SEC-05 / forge-hwo).
 *  A space is inserted between the star and slash of each bigram (the close
 *  bigram becomes "star space slash", the open bigram "slash space star") — an
 *  auditable, no-op-to-humans transform that leaves every other character
 *  untouched: the marker text a break-out payload targets still lands, but the
 *  bigram that would close/open the JSDoc header no longer does. */
function commentSafe(s: string): string {
  return s.replace(/\*\//g, '* /').replace(/\/\*/g, '/ *');
}

/** Recursively copy a template dir into dest, substituting the tokens in every
 *  file. Two hardening rules the raw approach missed: (1) FUNCTION replacers so
 *  a `$&`/`$$` in a value is inserted literally, not as a regex replacement
 *  pattern; (2) for `.json` files, JSON-escape the human-authored values so a
 *  quote/backslash/newline can't produce invalid JSON — a corrupt scaffold that
 *  would fail preflight (C1) and break `npm test`/`build`. Each written `.json`
 *  is JSON.parse-validated so a scaffold can only ship well-formed config.
 *  (3) for NON-`.json` (code/markdown) files, `commentSafe` breaks the two
 *  comment-terminator bigrams (the close and open comment markers) so a value
 *  can't escape a code file's JSDoc header and execute at module load
 *  (SEC-05 / forge-hwo). The boundary validator refuses those bigrams too; this
 *  sink escaping is the defense-in-depth backstop for any path that builds a
 *  manifest without it. */
function copyTemplate(srcDir: string, destDir: string, subs: { id: string; title: string; northStar: string }, written: string[], relBase = ''): void {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const src = join(srcDir, entry.name);
    const dest = join(destDir, entry.name);
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      copyTemplate(src, dest, subs, written, rel);
      continue;
    }
    const isJson = entry.name.endsWith('.json');
    // id is slug-safe (SLUG_RE) either way; title/northStar are human text.
    // .json → JSON-escape; code/markdown → commentSafe (SEC-05 / forge-hwo).
    const title = isJson ? jsonInner(subs.title) : commentSafe(subs.title);
    const northStar = isJson ? jsonInner(subs.northStar) : commentSafe(subs.northStar);
    const text = readFileSync(src, 'utf8')
      .replace(NAME_TOKEN, () => subs.id)
      .replace(TITLE_TOKEN, () => title)
      .replace(NORTH_STAR_TOKEN, () => northStar);
    if (isJson) {
      try { JSON.parse(text); }
      catch (err) { throw new Error(`create: scaffold produced invalid JSON at ${rel} — ${(err as Error).message}`); }
    }
    writeFileSync(dest, text, 'utf8');
    written.push(rel);
  }
}

/** The marker `scaffoldGreenfieldProject` writes LAST — inside the final
 *  `<projectDir>/.forge/`, only AFTER both atomic renames have landed. Its
 *  presence is the SOLE signal that a project directory is COMPLETE (not a
 *  crashed-create orphan): the pre-create reconcile treats any `projects/<id>`
 *  lacking it as a stale orphan to sweep, and only a project carrying it earns
 *  the "already exists" refusal. */
const CREATE_COMPLETE_MARKER = join('.forge', '.create-complete');

/** Sweep a stale brain-seed directory left by a crashed create — but ONLY when
 *  it is a REAL directory. A SYMLINK at `brain/projects/<id>` is a containment
 *  attack surface (SEC-03), never a crash artifact: leave it untouched so the
 *  `checkProjectBrainSeedContainment` guard downstream still REJECTS it (removing
 *  it here would silently launder the attack into a success — the exact
 *  "reorder reopens it one layer down" trap this campaign keeps closing). Absent
 *  / unreadable → no-op. */
function sweepBrainOrphan(brainDir: string): void {
  let st;
  try {
    st = lstatSync(brainDir);
  } catch {
    return; // ENOENT (absent) or unreadable — nothing to sweep
  }
  if (st.isSymbolicLink()) return; // leave for the containment guard to reject
  rmSync(brainDir, { recursive: true, force: true });
}

/** Sweep this id's stale STAGING leftovers — `.staging-<id>-*` dirs a hard kill
 *  left behind when a create's own unwind catch never ran (reopen-1). Prefix-
 *  scoped to THIS id so a concurrent create for another id is never touched. */
function sweepStagingLeftovers(root: string, id: string): void {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return; // root absent — nothing to sweep
  }
  const prefix = `.staging-${id}-`;
  for (const e of entries) {
    if (e.isDirectory() && e.name.startsWith(prefix)) {
      rmSync(resolve(root, e.name), { recursive: true, force: true });
    }
  }
}

/**
 * Scaffold a greenfield project from its template + seed the central brain, then
 * preflight. `hardGreen` is the authoritative "ready for the first architect run"
 * signal (all HARD contract clauses pass) — computed by `runPreflight`, never
 * asserted. Throws on an unknown appType or a name that doesn't slugify.
 *
 * TRANSACTIONAL (SEC-05 / forge-4on): every filesystem write is staged into
 * `.staging-<id>-<rand>` dirs on the same fs as their destinations and moved
 * into place with `renameSync` only on FULL success; any staged failure unwinds
 * both staging dirs and rethrows. A failed create therefore leaves NO orphan
 * project dir and NO phantom brain, and an identical retry always succeeds. A
 * pre-create reconcile sweeps a marker-less `projects/<id>` (and any real orphan
 * `brain/projects/<id>`) left by an earlier crash. This is NOT a reordering of
 * the two writes — three prior SEC-03 reorders each reopened the orphan one
 * layer down; transactionalization is the different axis that actually closes it.
 */
export function scaffoldGreenfieldProject(input: {
  manifest: CreationManifest;
  forgeRoot: string;
  /** Projects root; defaults to `<forgeRoot>/projects`. */
  projectsRoot?: string;
}): ScaffoldResult {
  const manifest = validateCreationManifest(input.manifest);
  const id = slugifyProjectName(manifest.name);
  if (!SLUG_RE.test(id)) throw new Error(`could not derive a valid slug id from name "${manifest.name}"`);

  // Whitelist appType against the actual template dirs — NOT an existsSync on a
  // joined path, which a traversal value like '../agents' would satisfy.
  const available = listProjectStarters(input.forgeRoot);
  if (!available.includes(manifest.appType)) {
    throw new Error(`unknown appType "${manifest.appType}" — available: ${available.join(', ') || '(none)'}`);
  }
  const templateDir = join(projectStartersDir(input.forgeRoot), manifest.appType);

  const projectsRoot = input.projectsRoot ?? join(input.forgeRoot, 'projects');
  const projectDir = resolve(projectsRoot, id);
  // Fixed, config-derived brain root (forgeRoot-relative, NOT projectsRoot —
  // the central Brain-3 always lives under the forge repo, ADR 035).
  const brainProjectsRoot = resolve(input.forgeRoot, 'brain', 'projects');
  const finalBrainDir = resolve(brainProjectsRoot, id);

  // RECONCILE (pre-create). A `projects/<id>` carrying the completion marker is
  // a genuinely COMPLETE project → refuse (the unchanged "already exists"
  // contract). A marker-less `projects/<id>` is a STALE ORPHAN from a crashed
  // create (a throw between the two renames below, or any pre-fix half-write) →
  // sweep it plus any real brain orphan, then proceed. This replaces the old
  // bare `existsSync(projectDir)` throw, which made every retry-after-crash fail
  // with "already exists".
  //
  // Also sweep this id's stale STAGING leftovers first — `.staging-<id>-*` dirs a
  // hard kill left when a prior create's unwind catch never ran (reopen-1).
  sweepStagingLeftovers(projectsRoot, id);
  sweepStagingLeftovers(brainProjectsRoot, id);
  if (existsSync(projectDir)) {
    if (existsSync(join(projectDir, CREATE_COMPLETE_MARKER))) {
      throw new Error(`project "${id}" already exists at ${projectDir}`);
    }
    rmSync(projectDir, { recursive: true, force: true });
    sweepBrainOrphan(finalBrainDir);
  } else {
    // No project dir, but a brain stub for this id can still be orphaned (a
    // crash BETWEEN the project rename and the brain rename, or before either)
    // — sweep a REAL one. A SYMLINK is left for the containment guard below.
    sweepBrainOrphan(finalBrainDir);
  }

  // Phase 1 (SEC-03 round 4, T1 ruling) — a PURE containment check for every
  // path `seedProjectBrain` will write under the FINAL `brain/projects/<id>/`.
  // Kept BEFORE any staging write so a containment rejection (a pre-planted
  // symlink/hardlink at the final brain target — the SEC-03 vector) throws with
  // NOTHING on disk anywhere. The staged seed below re-verifies its own (fresh,
  // random) staging path independently; this guards the rename DESTINATION.
  checkProjectBrainSeedContainment(input.forgeRoot, id);

  // Phase 2 — STAGE-then-atomic-move. Build the ENTIRE project + brain stub into
  // sibling `.staging-<id>-<rand>` dirs on the SAME filesystem as their
  // destinations (`projectsRoot` and `brain/projects/` respectively — NOT
  // os.tmpdir, whose separate fs would make `renameSync` throw EXDEV), run every
  // write + the read-only preflight there, then `renameSync` each staged tree
  // into place only on FULL success. Both staging dirs share ONE name so
  // preflight's C4 brain-profile lookup (keyed on the project-dir basename)
  // resolves against the staged brain.
  const stagingName = `.staging-${id}-${randomBytes(6).toString('hex')}`;
  const stagingProjectDir = resolve(projectsRoot, stagingName);
  const stagingBrainDir = resolve(brainProjectsRoot, stagingName);

  const filesWritten: string[] = [];
  let report;
  try {
    copyTemplate(templateDir, stagingProjectDir, { id, title: manifest.name, northStar: manifest.northStar }, filesWritten);
    // The CENTRAL Brain-3 stub (kb.yaml + profile.md + themes/README.md) is the
    // only forge-owned artifact not in the template. Seeded into the STAGING
    // dir; its CONTENT is still keyed to `id` (kb id, binding ref) so a rename
    // into `<id>` is byte-identical to seeding there directly.
    seedProjectBrain(input.forgeRoot, id, manifest.name, { dirName: stagingName });
    // Pure, non-throwing reporter — reads the staged tree only, so it can never
    // itself orphan. `hardGreen` computed here is valid for the final dir: the
    // staged trees are byte-identical to their post-rename form.
    report = runPreflight(stagingProjectDir, { forgeRoot: input.forgeRoot });

    // Completion marker written INTO the project STAGING dir, BEFORE the rename,
    // so the renamed `projects/<id>` is ATOMICALLY complete-marked — there is NO
    // marker-less window on the final path for a concurrent same-id reconcile to
    // mis-sweep (the reopen-1 wedge).
    mkdirSync(join(stagingProjectDir, dirname(CREATE_COMPLETE_MARKER)), { recursive: true });
    writeFileSync(join(stagingProjectDir, CREATE_COMPLETE_MARKER), `${new Date().toISOString()}\n`, 'utf8');

    // ATOMIC MOVE — INSIDE the try so a concurrent same-id winner's `renameSync`
    // ENOTEMPTY (or any throw) unwinds THIS create's staging in the catch below.
    // Brain FIRST, then the marker-carrying project LAST: the project rename is
    // the single commit point and lands `projects/<id>` already marked complete.
    renameSync(stagingBrainDir, finalBrainDir);
    renameSync(stagingProjectDir, projectDir);
  } catch (err) {
    // UNWIND: any staged failure — INCLUDING a rename ENOTEMPTY from a losing
    // concurrent same-id create — leaves NOTHING of THIS create's staging behind.
    // `rmSync` recursive+force no-ops on an absent dir. (A brain already renamed
    // before a project-rename throw becomes a brain-without-project, swept by the
    // next create's reconcile — the disclosed two-root residual below.)
    rmSync(stagingProjectDir, { recursive: true, force: true });
    rmSync(stagingBrainDir, { recursive: true, force: true });
    throw err;
  }

  // DISCLOSED RESIDUAL (accepted, not silently swallowed): `projectsRoot` and
  // `brain/projects/` are SEPARATE filesystem roots, so the two `renameSync`
  // calls are NOT one transaction. A crash AFTER the brain rename but BEFORE the
  // project rename leaves a `brain/projects/<id>` with no matching project —
  // RECONCILABLE (the next create for that id sweeps a brain-without-project).
  // Because the marker now rides in the project staging dir, `projects/<id>` is
  // NEVER marker-less on the final path, so a concurrent reconcile can never
  // mis-sweep a live create. This narrow between-renames brain-orphan window is
  // the residual this design accepts in exchange for closing the orphan class.

  return {
    id,
    projectDir,
    appType: manifest.appType,
    hardGreen: report.ok,
    failingClauses: report.clauses.filter((c) => c.hard && !c.pass),
    filesWritten,
  };
}

/** True iff the given text still carries an unsubstituted template token.
 *  A fresh non-global regex — never the module-level `/g` ones, whose stateful
 *  `.test()` lastIndex would make repeated calls flap. */
export function hasUnsubstitutedTokens(text: string): boolean {
  return /\{\{(NAME|TITLE|NORTH_STAR)\}\}/.test(text);
}
