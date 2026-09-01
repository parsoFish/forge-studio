/**
 * Skill install — the mutate surface (install / approve / re-pin).
 *
 * Split out of `skill-library.ts` in M4-library PR 4b: `installSkillPackage`
 * (D4 — permanent quarantine of `runtime`/`allowed-tools`/`library` out of
 * top-level frontmatter), `approveSkillDraft` (never restores quarantined
 * keys — turning a vendored skill into a runnable agent stays a separate,
 * explicit Agent Builder act), and `repinSkillPackage`. Imports package
 * read/hash primitives back from `./skill-package.ts`. See
 * `./skill-trust.ts`'s header for the full trust-vocabulary design record.
 */

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import matter from 'gray-matter';

// Every matter() parse call below passes a (possibly empty) options object.
// gray-matter caches parse results keyed by raw string content ONLY when
// called with no options at all — and it seeds that cache before parsing, so
// a caller who swallows a YAML error (registry.ts's isStudioAgent does,
// deliberately) poisons the cache for every later no-options call on the
// same content, silently turning a genuinely malformed SKILL.md into an
// empty-data success. Passing {} opts out of the cache entirely.

import { skillPath, skillsDir } from '../skill-path.ts';
import { readInstallLedger, writeInstallLedgerEntry, type InstalledSkillLedgerEntry } from './skill-install-ledger.ts';
import { assertSkillSlug, guardedFile } from '@forge/kernel';
import {
  extractProvenance,
  readSkillPackage,
  hashSkillPackage,
  QUARANTINED_FRONTMATTER_KEYS,
  MAX_PACKAGE_FILES,
  MAX_PACKAGE_BYTES,
  type PackageFile,
  type SkillProvenance,
} from './skill-package.ts';

// ---------------------------------------------------------------------------
// Types (WI-1 pinned shapes — orchestrator/studio/skill-library.test.ts)
// ---------------------------------------------------------------------------

export interface InstallInput {
  forgeRoot: string;
  id: string;
  packageDir: string;
  upstream: { source: string; ref?: string };
}

export interface InstallResult {
  alreadyInstalled: boolean;
}

/** W7-B3 (library-31) — thrown by `installSkillPackage` when `skills/<id>`
 *  is occupied by a local skill with NO community-install provenance
 *  (present-unmanaged): the package was never installed, so an
 *  `alreadyInstalled` answer would be a laundered false success, and an
 *  overwrite would destroy an unrelated file. A NAMED class so route
 *  callers can map it to 409 (id collision) without string-matching the
 *  message — the same explicit-error-contract shape ADR-042 blesses. */
export class SkillIdOccupiedError extends Error {}

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

// ---------------------------------------------------------------------------
// installSkillPackage — validate the WHOLE package, then write (AT-21)
// ---------------------------------------------------------------------------

type RawPackageEntry = { relPath: string; absPath: string };

/** Walk a package directory, resolving every entry through realpath so a
 *  symlink (or, in principle, a literal `../` component) that escapes the
 *  package root is caught before anything is read. Mirrors the traversal
 *  pattern at cli/bridge-studio-writes.ts:917, applied to the SOURCE side. */
function walkPackageDir(packageDir: string): RawPackageEntry[] {
  const rootAbs = resolve(packageDir);
  const boundary = rootAbs + sep;
  const out: RawPackageEntry[] = [];
  const walk = (absDir: string, relDir: string): void => {
    let names: string[];
    try {
      names = readdirSync(absDir);
    } catch (e) {
      throw new Error(`installSkillPackage: cannot read package directory "${absDir}" — ${(e as Error).message}`);
    }
    for (const name of names) {
      const absPath = join(absDir, name);
      const relPath = relDir ? `${relDir}/${name}` : name;
      let real: string;
      try {
        real = realpathSync(absPath);
      } catch (e) {
        throw new Error(`installSkillPackage: cannot resolve package entry "${relPath}" — ${(e as Error).message}`);
      }
      if (real !== rootAbs && !real.startsWith(boundary)) {
        throw new Error(
          `installSkillPackage: package entry "${relPath}" escapes the package directory (traversal or symlink) — refusing to install`,
        );
      }
      const st = statSync(absPath); // follows the symlink to the real target's kind
      if (st.isDirectory()) {
        walk(absPath, relPath);
      } else if (st.isFile()) {
        out.push({ relPath, absPath });
      } else {
        throw new Error(`installSkillPackage: package entry "${relPath}" is neither a file nor a directory`);
      }
    }
  };
  walk(rootAbs, '');
  return out;
}

export function installSkillPackage(input: InstallInput): InstallResult {
  const { forgeRoot, id, packageDir, upstream } = input;

  if (!upstream || typeof upstream.source !== 'string' || upstream.source.trim() === '') {
    throw new Error(`installSkillPackage: upstream.source is required and must be a non-empty string (installing "${id}")`);
  }

  // `id` no longer reaches skillPath()/skillDir() before the containment guard
  // below — those slug-validate via assertSkillSlug, but skillsDir() (the guard
  // root) does not. Validate it explicitly here so an over-long or malformed id
  // is refused with an actionable message BEFORE any path work, never as a raw
  // ENAMETOOLONG from a late writeFileSync (AT-84).
  assertSkillSlug(id);

  // Reinstall is idempotent — leave the existing directory byte-identical (AT-24).
  // The idempotency probe goes through the SEC-04 containment guard, NOT a bare
  // existsSync: existsSync FOLLOWS a symlink, so a pre-planted skills/<id>
  // symlink aliasing an outside region (or a DIFFERENT real skill) would be
  // blessed as { alreadyInstalled: true } — a false "installed" that turns
  // GET /api/studio/skills/<id> into an exfil oracle (SEC-05 q80). guardedFile
  // returns null for a symlinked/aliased id (per-segment realpath identity
  // mismatch), so control falls through to the write-phase guard, which refuses
  // (throws) rather than reporting a false 'already installed'.
  //
  // W7-B3 (library-31): `alreadyInstalled` is only honest when THIS package
  // was actually installed before — i.e. the occupying SKILL.md carries a
  // community-install provenance block. An UNRELATED local skill that merely
  // shares the id refuses loudly (the same fact routeCommunityInstall's own
  // collision pre-check names), never a laundered false success. The victim
  // file is read-only here — byte-identical either way.
  const occupied = guardedFile(skillsDir(forgeRoot), [id, 'SKILL.md'], 'read');
  if (occupied !== null) {
    const { data } = matter(readFileSync(occupied, 'utf8'), {});
    if (extractProvenance((data ?? {}) as Record<string, unknown>) === null) {
      throw new SkillIdOccupiedError(
        `installSkillPackage: skills/${id} is occupied by a local skill with no community-install provenance (present-unmanaged) — refusing to claim alreadyInstalled for a package that was never installed`,
      );
    }
    return { alreadyInstalled: true };
  }

  const rawEntries = walkPackageDir(packageDir);
  if (!rawEntries.some((e) => e.relPath === 'SKILL.md')) {
    throw new Error(`installSkillPackage: package at "${packageDir}" has no SKILL.md at its root`);
  }
  if (rawEntries.length > MAX_PACKAGE_FILES) {
    throw new Error(`installSkillPackage: package "${id}" has ${rawEntries.length} files, exceeding the ${MAX_PACKAGE_FILES}-file cap`);
  }

  const files: PackageFile[] = [];
  let totalBytes = 0;
  for (const entry of rawEntries) {
    const buf = readFileSync(entry.absPath);
    totalBytes += buf.length;
    if (totalBytes > MAX_PACKAGE_BYTES) {
      throw new Error(`installSkillPackage: package "${id}" exceeds the ${MAX_PACKAGE_BYTES}-byte cap`);
    }
    let body: string;
    try {
      body = UTF8_DECODER.decode(buf);
    } catch {
      throw new Error(`installSkillPackage: file "${entry.relPath}" in package "${id}" is not valid UTF-8 — binary package files are not supported`);
    }
    files.push({ path: entry.relPath, body });
  }

  const skillMdFile = files.find((f) => f.path === 'SKILL.md')!;
  const { data, content } = matter(skillMdFile.body, {});
  const sourceData = (data ?? {}) as Record<string, unknown>;
  const cleanContent = content.replace(/^\n+/, '');

  // D4 — quarantine runtime/allowed-tools/library permanently.
  const quarantined: Record<string, unknown> = {};
  for (const key of QUARANTINED_FRONTMATTER_KEYS) {
    if (key in sourceData) quarantined[key] = sourceData[key];
  }
  const newData: Record<string, unknown> = { ...sourceData };
  for (const key of QUARANTINED_FRONTMATTER_KEYS) delete newData[key];
  if (Object.keys(quarantined).length > 0) newData['quarantined'] = quarantined;
  newData['status'] = 'draft';
  newData['library'] = false;

  // contentHash is computed over the FINAL (quarantine-transformed) shape that
  // will actually be written — not the untransformed source — so a later
  // recompute of the installed file (skillTrustState/repin/lint) reflects the
  // SAME shape. hashSkillPackage itself excludes status/library/provenance, so
  // the placeholder provenance below is never itself part of the hash.
  newData['provenance'] = { source: upstream.source, contentHash: '', installedAt: '1970-01-01T00:00:00.000Z' };
  const filesForHashing = files.map((f) =>
    f.path === 'SKILL.md' ? { path: f.path, body: matter.stringify('\n' + cleanContent, newData) } : f,
  );
  const contentHash = hashSkillPackage(filesForHashing);

  const provenance: SkillProvenance = {
    source: upstream.source,
    contentHash,
    installedAt: new Date().toISOString(),
  };
  if (upstream.ref) provenance.upstreamRef = upstream.ref;
  newData['provenance'] = provenance;

  // The containment ROOT (skills/) is TRUSTED + config-derived — creating it is
  // safe and is required so the per-entry write guard below can realpath it.
  // `id` is NEVER folded into this root; it always arrives as a guarded segment.
  mkdirSync(skillsDir(forgeRoot), { recursive: true });

  // PHASE 1 — pre-validate EVERY destination through the SEC-04 containment
  // guard BEFORE any write (AT-21: a failure here must leave skills/<id>/ absent
  // entirely). guardedFile routes the WHOLE path — the `id` segment, every
  // nested tail segment, AND the leaf filename — through resolveGuardedPath's
  // per-segment realpath identity walk, so a symlinked skills/<id>, a symlinked
  // NESTED subdir, a symlinked LEAF, and a cross-object same-root alias are all
  // refused; a lexical resolve().startsWith(skillsDir + sep) could not tell any
  // of them apart (SEC-05 q80). `id` is a SEGMENT to the fixed
  // skillsDir(forgeRoot) root, never concatenated into it.
  const dests = files.map((f) => {
    const realPath = guardedFile(skillsDir(forgeRoot), [id, ...f.path.split('/')], 'write');
    if (realPath === null) {
      throw new Error(`installSkillPackage: destination for "${f.path}" escapes skills/ — refusing`);
    }
    return { realPath, file: f };
  });
  // Two entries must never resolve to the same real inode (a last-write-wins
  // collision). Distinct readdir relpaths won't, but pinning uniqueness keeps
  // the write phase's one-entry-one-file invariant explicit.
  const seenRealPaths = new Set<string>();
  for (const { realPath } of dests) {
    if (seenRealPaths.has(realPath)) {
      throw new Error(`installSkillPackage: duplicate destination path "${realPath}" — refusing to write`);
    }
    seenRealPaths.add(realPath);
  }

  // PHASE 2 — every destination passed PHASE 1's guard, so no partial write can
  // land on a mid-loop throw. No standalone mkdirSync(skillDir(id)): `id` is a
  // guarded segment, so each entry mkdir's its OWN already-blessed parent.
  for (const { realPath, file } of dests) {
    mkdirSync(dirname(realPath), { recursive: true });
    if (file.path === 'SKILL.md') {
      writeFileSync(realPath, matter.stringify('\n' + cleanContent, newData), 'utf8');
    } else {
      writeFileSync(realPath, file.body, 'utf8');
    }
  }

  // Blocker 2 fix — register the install in the central ledger, the second
  // source of truth skillTrustState cross-checks the on-disk pin against.
  // Written LAST, after every file is on disk, so a throw anywhere above
  // (traversal, caps, binary, bad id) never leaves a ledger entry for a
  // package that was never actually written.
  const ledgerEntry: InstalledSkillLedgerEntry = { id, source: upstream.source, contentHash, installedAt: provenance.installedAt };
  if (provenance.upstreamRef) ledgerEntry.upstreamRef = provenance.upstreamRef;
  writeInstallLedgerEntry(forgeRoot, ledgerEntry);

  return { alreadyInstalled: false };
}

// ---------------------------------------------------------------------------
// approveSkillDraft / repinSkillPackage
// ---------------------------------------------------------------------------

export function approveSkillDraft(input: { forgeRoot: string; id: string }): void {
  const { forgeRoot, id } = input;
  const mdPath = skillPath(id, forgeRoot);
  const raw = readFileSync(mdPath, 'utf8');
  const { data, content } = matter(raw, {});
  const d = (data ?? {}) as Record<string, unknown>;
  if (d['status'] !== 'draft') {
    throw new Error(`approveSkillDraft: skill "${id}" is not a draft (status: ${JSON.stringify(d['status'] ?? null)}) — only a draft install can be approved`);
  }
  // D4 — flip library:true, drop status:draft; quarantined + provenance untouched.
  const newData: Record<string, unknown> = { ...d };
  delete newData['status'];
  newData['library'] = true;
  writeFileSync(mdPath, matter.stringify('\n' + content.replace(/^\n+/, ''), newData), 'utf8');
}

export function repinSkillPackage(input: { forgeRoot: string; id: string }): string {
  const { forgeRoot, id } = input;
  const mdPath = skillPath(id, forgeRoot);
  const raw = readFileSync(mdPath, 'utf8');
  const { data, content } = matter(raw, {});
  const d = (data ?? {}) as Record<string, unknown>;
  const rawProvenance = d['provenance'];
  if (rawProvenance == null || typeof rawProvenance !== 'object' || Array.isArray(rawProvenance)) {
    throw new Error(`repinSkillPackage: skill "${id}" has no provenance block to re-pin`);
  }
  const newHash = hashSkillPackage(readSkillPackage(forgeRoot, id));
  const newData: Record<string, unknown> = {
    ...d,
    provenance: { ...(rawProvenance as Record<string, unknown>), contentHash: newHash },
  };
  writeFileSync(mdPath, matter.stringify('\n' + content.replace(/^\n+/, ''), newData), 'utf8');

  // Keep the ledger's pin in step with an intentional re-pin (AT-81). A skill
  // with no ledger entry (never went through installSkillPackage) has
  // nothing to update — repin does not retroactively register it.
  const ledgerEntry = readInstallLedger(forgeRoot).get(id);
  if (ledgerEntry) {
    writeInstallLedgerEntry(forgeRoot, { ...ledgerEntry, contentHash: newHash });
  }

  return newHash;
}
