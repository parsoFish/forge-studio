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

import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

import { seedProjectBrain, checkProjectBrainSeedContainment } from './project-brain-seed.ts';
import { runPreflight, type ClauseResult } from '../cli/preflight.ts';
import { skillsDir, isReservedId } from './skill-path.ts';

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

/** Provenance marker `scaffoldGreenfieldProject` stages into `.forge/` before
 *  the atomic rename, so a completed create is identifiable as
 *  greenfield-made. W7-B6 (projects-35): this marker is NO LONGER a sweep
 *  signal — the old reconcile inferred "crashed-create orphan" from the
 *  marker's ABSENCE and `rmSync`'d the directory, which deleted every real
 *  onboarded / hand-added project (none of which carry it) on a name
 *  collision. The only dirs the pre-create sweep may touch are the ones that
 *  positively carry the STAGING name marker (`.staging-<id>-*`). */
const CREATE_COMPLETE_MARKER = join('.forge', '.create-complete');

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
  // W7-A4 (projects-30): `new` is the /projects/new onboarding segment — never a project id.
  if (isReservedId(id)) throw new Error(`project id "${id}" is reserved (the /projects/new onboarding form lives at that path) — choose another name`);

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

  // REFUSAL, not reconcile (W7-B6, projects-35 — the DATA-LOSS fix). The old
  // pre-create reconcile inferred "crashed-create orphan" from the completion
  // marker's ABSENCE and rmSync'd `projects/<id>` + `brain/projects/<id>` —
  // but every onboarded / hand-added project lacks that marker, so a name
  // collision silently DELETED a real project and its brain (live-reproduced
  // against projects/mdtoc). The new contract is fail-safe:
  //   - ANY existing entry at `projects/<id>` (dir, file, or symlink) → refuse.
  //     The transactional staging design below never leaves a half-built
  //     final-path dir (all failures unwind `.staging-*`), so an existing
  //     entry is either a real project or something a human must remove
  //     deliberately. Create never deletes it.
  //   - A REAL `brain/projects/<id>` with no project dir → refuse too: Brain-3
  //     dirs are REPO-TRACKED, so on a fresh clone a brain legitimately exists
  //     for a project whose gitignored checkout is absent — sweeping it would
  //     destroy accumulated project knowledge. (A SYMLINK there is left for
  //     `checkProjectBrainSeedContainment` below to REJECT — a security event,
  //     not an existence collision.)
  //   - The ONLY dirs swept are the ones positively carrying the STAGING name
  //     marker (`.staging-<id>-*`) — hard-kill leftovers, identifiable by
  //     construction, never confusable with operator data.
  sweepStagingLeftovers(projectsRoot, id);
  sweepStagingLeftovers(brainProjectsRoot, id);
  let projectEntry = null;
  try { projectEntry = lstatSync(projectDir); } catch { /* absent — the create path */ }
  if (projectEntry !== null) {
    throw new Error(
      `project "${id}" already exists at ${projectDir} — create never overwrites an existing directory ` +
        `(onboarded and hand-added projects carry no create marker; remove the directory deliberately if it is truly stale)`,
    );
  }
  let brainEntry = null;
  try { brainEntry = lstatSync(finalBrainDir); } catch { /* absent — the create path */ }
  if (brainEntry !== null && !brainEntry.isSymbolicLink()) {
    throw new Error(
      `a project brain already exists at ${finalBrainDir} — refusing to replace it. Brain-3 dirs are repo-tracked ` +
        `and may belong to a real project not checked out on this disk; remove it deliberately if it is truly stale, ` +
        `or choose another name`,
    );
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
    // W7-B6 (projects-11): the project is its OWN git repository from birth —
    // `git init` + a first commit of the scaffold, run INSIDE the staging dir
    // (a git repo is position-independent, so the rename below carries it).
    // Done explicitly rather than probed: staging sits inside the forge work
    // tree, where an is-inside-work-tree probe lies (the projects-11 defect on
    // the onboard path). Identity flags are passed per-invocation so an
    // unattended host with no global git identity still commits. A git
    // failure THROWS into the unwind below — a repo-less "green" scaffold
    // would silently inherit forge's own repo, the exact defect this closes.
    execFileSync('git', ['init', '-q'], { cwd: stagingProjectDir, stdio: 'ignore' });
    execFileSync('git', ['add', '-A'], { cwd: stagingProjectDir, stdio: 'ignore' });
    execFileSync(
      'git',
      ['-c', 'user.name=forge', '-c', 'user.email=forge@localhost', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', `chore: scaffold ${id} from ${manifest.appType} template`],
      { cwd: stagingProjectDir, stdio: 'ignore' },
    );
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
    // before a project-rename throw becomes a brain-without-project — the
    // disclosed two-root residual below.)
    rmSync(stagingProjectDir, { recursive: true, force: true });
    rmSync(stagingBrainDir, { recursive: true, force: true });
    throw err;
  }

  // DISCLOSED RESIDUAL (accepted, not silently swallowed): `projectsRoot` and
  // `brain/projects/` are SEPARATE filesystem roots, so the two `renameSync`
  // calls are NOT one transaction. A crash AFTER the brain rename but BEFORE
  // the project rename leaves a `brain/projects/<id>` with no matching project.
  // W7-B6 (projects-35): that leftover is now REFUSED on retry (never swept —
  // a repo-tracked Brain-3 for a not-checked-out project is byte-identical in
  // shape, and deleting it destroys real knowledge); the refusal message names
  // the brain path so the operator can remove a genuinely stale one
  // deliberately. Fail-safe-and-manual beats automatic-and-occasionally-
  // catastrophic here — this narrow between-renames window is the residual
  // this design accepts in exchange for closing the data-loss class.

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
