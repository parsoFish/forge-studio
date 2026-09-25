/**
 * Skill package primitives — read, hash, scan.
 *
 * Split out of `skill-library.ts` in M4-library PR 4b: package file
 * enumeration (`readSkillPackage`), the deterministic content hash
 * (`hashSkillPackage`), and the fact-only frontmatter/executable scan
 * (`scanSkillPackage`, D5 — never a verdict). A true leaf: imports nothing
 * from `./skill-trust.ts` or `./skill-install.ts`, which import back from
 * here one-directionally. See `./skill-trust.ts`'s header for the full
 * trust-vocabulary design record and `_wave5/specs/R3-01-F3F4.md`.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import matter from 'gray-matter';

// Every matter() parse call below passes a (possibly empty) options object.
// gray-matter caches parse results keyed by raw string content ONLY when
// called with no options at all — and it seeds that cache before parsing, so
// a caller who swallows a YAML error (registry.ts's isStudioAgent does,
// deliberately) poisons the cache for every later no-options call on the
// same content, silently turning a genuinely malformed SKILL.md into an
// empty-data success. Passing {} opts out of the cache entirely.
// (skill-install.ts and skill-trust.ts point here rather than repeat it.)

import { guardedFile } from '@forge/kernel';
import { skillRoots, resolveIdAcrossRoots } from '@forge/kernel';

// ---------------------------------------------------------------------------
// Types (WI-1 pinned shapes — packages/library/tests/integration/skill-library.test.ts)
// ---------------------------------------------------------------------------

export interface SkillProvenance {
  source: string;
  upstreamRef?: string;
  contentHash: string;
  installedAt: string;
  catalogId?: string;
}

export interface PackageFile {
  path: string; // relative, POSIX-separated
  body: string;
}

export interface SkillScanReport {
  quarantinedKeys: string[];
  executableFiles: string[];
  fileCount: number;
  totalBytes: number;
  body: string;
}

// ---------------------------------------------------------------------------
// Named constants (rule: no hardcoded caps/thresholds — tests assert these)
// ---------------------------------------------------------------------------

export const MAX_PACKAGE_FILES = 500;
export const MAX_PACKAGE_BYTES = 5 * 1024 * 1024; // 5 MiB
export const EXECUTABLE_EXTENSIONS = ['.sh', '.bash', '.js', '.mjs', '.cjs', '.py', '.rb', '.pl'] as const;

/** Frontmatter keys quarantined on install (D4) — the ONLY keys that can turn
 *  a vendored SKILL.md into a runnable, self-tool-granting agent. */
export const QUARANTINED_FRONTMATTER_KEYS = ['runtime', 'allowed-tools', 'library'] as const;

// ---------------------------------------------------------------------------
// Shared internals
// ---------------------------------------------------------------------------

export function extractProvenance(data: Record<string, unknown>): SkillProvenance | null {
  const raw = data['provenance'];
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p['source'] !== 'string' || typeof p['contentHash'] !== 'string' || typeof p['installedAt'] !== 'string') {
    return null; // malformed provenance block ⇒ treat as absent, never crash the reader
  }
  const out: SkillProvenance = { source: p['source'], contentHash: p['contentHash'], installedAt: p['installedAt'] };
  if (typeof p['upstreamRef'] === 'string') out.upstreamRef = p['upstreamRef'];
  if (typeof p['catalogId'] === 'string') out.catalogId = p['catalogId'];
  return out;
}

// ---------------------------------------------------------------------------
// Package read + hash
// ---------------------------------------------------------------------------

/** Read every file under an installed skill's directory — SKILL.md first,
 *  then the rest sorted lexicographically by relative POSIX path (AT-11). */
export function readSkillPackage(forgeRoot: string, id: string): PackageFile[] {
  // COMMON §15.19, the same fix as `skill-install.ts`'s `guardedSkillMd`: this
  // walk's root used to be `skillDir(id, forgeRoot)` — a bare `join()` — so a
  // symlink planted at `skills/<id>` sent the whole read, and the hash computed
  // from it, somewhere outside the library. Every caller today sits behind a
  // route-level guard, which is exactly why it was easy to miss; a read that is
  // safe only because of what its callers happen to do is a landmine, and this
  // one feeds `repinSkillPackage`'s `contentHash`.
  //
  // forge-8vfn.5.35 (fixed): this used to guard only the walk's ROOT — entries
  // INSIDE the package were classified with `Dirent`, which does not follow
  // symlinks, so a symlinked leaf was neither file nor directory and was
  // silently SKIPPED. It could not redirect a read, but it dropped out of
  // `contentHash`, a TRUST GATE (`skill-trust.ts`'s `needs-review` fires only
  // on a hash difference) — so a symlink added to an approved package evaded
  // the one mechanism built to catch post-approval tampering. `walk()` below
  // now realpaths every entry and REFUSES on escape, mirroring
  // `installSkillPackage`'s `walkPackageDir`. This changes what the hash
  // means for a package that DOES contain an escaping symlink (refused,
  // where it used to be silently omitted) but leaves every ordinary
  // package's hash unchanged.
  //
  // The SKILL.md probe rides the guard too, LEAF INCLUDED. The first version of
  // this fix kept `existsSync(join(dir, 'SKILL.md'))` on the guarded dir, and
  // `check-raw-fs-guarded` caught it in the same commit — appending a leaf below
  // a guarded value re-opens the class one segment lower, which is the whole
  // lesson. The guard found the residual inside the containment fix itself.
  // SEAM F1: search every skill root — `skills/` AND every
  // `packages/<pkg>/skills/` — for whichever one actually carries `id`, then
  // guard THAT root's own `readdir` (never a second, unguarded join off it).
  const match = resolveIdAcrossRoots(skillRoots(forgeRoot), id, ['SKILL.md']);
  const dir = match === null ? null : guardedFile(match.root, [id], 'readdir');
  if (match === null || dir === null) {
    throw new Error(`readSkillPackage: no SKILL.md found for skill "${id}" inside the library (missing, or the path escapes every skill root)`);
  }
  const files: PackageFile[] = [];
  const rootAbs = resolve(dir);
  const boundary = rootAbs + sep;
  const walk = (absDir: string, relDir: string): void => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const absPath = join(absDir, entry.name);
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      let real: string;
      try {
        real = realpathSync(absPath);
      } catch (e) {
        throw new Error(`readSkillPackage: cannot resolve package entry "${relPath}" in skill "${id}" — ${(e as Error).message}`);
      }
      if (real !== rootAbs && !real.startsWith(boundary)) {
        throw new Error(`readSkillPackage: package entry "${relPath}" in skill "${id}" escapes the package directory (traversal or symlink) — refusing to read`);
      }
      // TOCTOU: read only the validated `real` path below — re-touching `absPath`
      // would follow a symlink a race could swap after the check above.
      const st = statSync(real);
      if (st.isDirectory()) {
        walk(real, relPath);
      } else if (st.isFile()) {
        files.push({ path: relPath, body: readFileSync(real, 'utf8') });
      } else {
        throw new Error(`readSkillPackage: package entry "${relPath}" in skill "${id}" is neither a file nor a directory`);
      }
    }
  };
  walk(dir, '');
  files.sort((a, b) => {
    if (a.path === 'SKILL.md') return -1;
    if (b.path === 'SKILL.md') return 1;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  return files;
}

/**
 * Frontmatter keys hashSkillPackage excludes from SKILL.md when hashing —
 * forge's OWN trust-lifecycle bookkeeping, never the vendored package's real
 * content. This is what makes contentHash self-consistent: install writes
 * `provenance.contentHash` INTO the very file whose hash it records, and
 * approve/repin flip `status`/`library` without that alone counting as drift.
 * Excluding them means the hash never depends on its own stored value.
 */
const HASH_CANONICALIZATION_EXCLUDED_KEYS = ['status', 'library', 'provenance'] as const;

/** A deterministic hash input for one file — for SKILL.md, the frontmatter
 *  has the bookkeeping keys above stripped first (see the const above). */
function hashInputFor(file: PackageFile): string {
  if (file.path !== 'SKILL.md') return file.body;
  const { data, content } = matter(file.body, {});
  const d = { ...((data ?? {}) as Record<string, unknown>) };
  for (const key of HASH_CANONICALIZATION_EXCLUDED_KEYS) delete d[key];
  // Never re-serialized as YAML or written anywhere — purely a hash input, so
  // plain JSON (stable for a single parse's key order) is sufficient.
  return JSON.stringify(d) + ' ' + content;
}

/** Deterministic, order-independent content hash over a package's files. */
export function hashSkillPackage(files: readonly PackageFile[]): string {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const hash = createHash('sha256');
  for (const f of sorted) {
    hash.update(f.path, 'utf8');
    hash.update(' ', 'utf8');
    hash.update(hashInputFor(f), 'utf8');
    hash.update(' ', 'utf8');
  }
  return `sha256:${hash.digest('hex')}`;
}

// ---------------------------------------------------------------------------
// scanSkillPackage — facts only, never a verdict (D5)
// ---------------------------------------------------------------------------

export function scanSkillPackage(files: readonly PackageFile[]): SkillScanReport {
  const skillMd = files.find((f) => f.path === 'SKILL.md');
  if (!skillMd) {
    throw new Error('scanSkillPackage: package has no SKILL.md');
  }
  const { data, content } = matter(skillMd.body, {});
  const d = (data ?? {}) as Record<string, unknown>;
  // A key is reported whether it still sits at TOP LEVEL (a fresh/never-quarantined
  // package) or has already been moved under the nested `quarantined:` block by
  // installSkillPackage (D4) — the only production caller (GET /api/studio/skills/<id>
  // for a draft) always hands this the ALREADY-INSTALLED package, so without the
  // nested check `runtime`/`allowed-tools` could never appear in the report (the
  // ui:journey-found defect, R3-01-F4). Deduped + ordered by
  // QUARANTINED_FRONTMATTER_KEYS's own declared order, never a sorted array (AT-92).
  const nestedQuarantine =
    d['quarantined'] != null && typeof d['quarantined'] === 'object' && !Array.isArray(d['quarantined'])
      ? (d['quarantined'] as Record<string, unknown>)
      : {};
  const quarantinedKeys = QUARANTINED_FRONTMATTER_KEYS.filter((k) => k in d || k in nestedQuarantine);
  const executableFiles = files
    .filter((f) => f.path !== 'SKILL.md' && (EXECUTABLE_EXTENSIONS as readonly string[]).some((ext) => f.path.endsWith(ext)))
    .map((f) => f.path);
  const totalBytes = files.reduce((sum, f) => sum + Buffer.byteLength(f.body, 'utf8'), 0);
  return {
    quarantinedKeys,
    executableFiles,
    fileCount: files.length,
    totalBytes,
    body: content.trim(),
  };
}
