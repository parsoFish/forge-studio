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

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { seedProjectBrain } from './project-brain-seed.ts';
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

/** Recursively copy a template dir into dest, substituting the tokens in every
 *  file. Two hardening rules the raw approach missed: (1) FUNCTION replacers so
 *  a `$&`/`$$` in a value is inserted literally, not as a regex replacement
 *  pattern; (2) for `.json` files, JSON-escape the human-authored values so a
 *  quote/backslash/newline can't produce invalid JSON — a corrupt scaffold that
 *  would fail preflight (C1) and break `npm test`/`build`. Each written `.json`
 *  is JSON.parse-validated so a scaffold can only ship well-formed config. */
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
    const title = isJson ? jsonInner(subs.title) : subs.title;
    const northStar = isJson ? jsonInner(subs.northStar) : subs.northStar;
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

/**
 * Scaffold a greenfield project from its template + seed the central brain, then
 * preflight. `hardGreen` is the authoritative "ready for the first architect run"
 * signal (all HARD contract clauses pass) — computed by `runPreflight`, never
 * asserted. Throws on an unknown appType or a name that doesn't slugify.
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
  if (existsSync(projectDir)) throw new Error(`project "${id}" already exists at ${projectDir}`);

  const filesWritten: string[] = [];
  copyTemplate(templateDir, projectDir, { id, title: manifest.name, northStar: manifest.northStar }, filesWritten);

  // Hand off to the onboarding side: the CENTRAL Brain-3 stub (kb.yaml + profile.md)
  // is the only forge-owned artifact not in the template — seed it so C4's central
  // profile + the KB binding resolve. Idempotent per file.
  seedProjectBrain(input.forgeRoot, id, manifest.name);

  const report = runPreflight(projectDir, { forgeRoot: input.forgeRoot });
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
