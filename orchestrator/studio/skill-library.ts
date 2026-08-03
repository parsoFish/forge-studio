/**
 * Skill library — trust pipeline + registry model (R3-01-F3/F4).
 *
 * Single source for the skill-library object model: the union of local plain
 * skills (`skills/<id>/SKILL.md`, no `runtime:` block) and `studio/catalog.yaml`
 * community entries, the trust vocabulary that gates palette visibility, and the
 * install → quarantine → approve → re-review pipeline for vendored packages.
 * See `_wave5/specs/R3-01-F3F4.md` for the full design (D1-D8, trust vocabulary).
 *
 * Trust vocabulary (single source of truth — do not re-derive elsewhere):
 *   ready        — no `status:`, or a `provenance.contentHash` that matches the
 *                  recomputed package hash. Palette-visible.
 *   draft        — `status: draft` (freshly installed, unreviewed). NOT
 *                  palette-visible; an agent composing it is a lint error.
 *   needs-review — has `provenance.contentHash` and the recomputed hash differs
 *                  (someone edited the package after approval). NOT
 *                  palette-visible; lint error regardless of composition.
 * A skill with no `provenance` block (every hand-authored forge skill) is
 * always `ready` — it is never hashed (AT-37).
 *
 * D4 (permanent quarantine): install moves `runtime` / `allowed-tools` /
 * `library` out of top-level frontmatter into a `quarantined:` block.
 * `approveSkillDraft` never restores them — an installed community skill is a
 * plain composable skill forever; turning it into a runnable agent is a
 * separate, explicit authoring act in the Agent Builder.
 *
 * D5 (scan reports facts, not verdicts): `scanSkillPackage` never judges — no
 * clean/pass/severity field, ever.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import matter from 'gray-matter';

// Every matter() parse call below passes a (possibly empty) options object.
// gray-matter caches parse results keyed by raw string content ONLY when
// called with no options at all — and it seeds that cache before parsing, so
// a caller who swallows a YAML error (registry.ts's isStudioAgent does,
// deliberately) poisons the cache for every later no-options call on the
// same content, silently turning a genuinely malformed SKILL.md into an
// empty-data success. Passing {} opts out of the cache entirely.

import { skillDir, skillPath, skillsDir, listSkillDirs, listSkillMdDirs } from '../skill-path.ts';
import { isStudioAgent, loadAgentDefinition, loadCatalog } from './registry.ts';
import type { AgentDefinition, CommunitySkill } from './types.ts';
import type { Finding } from './validate.ts';

// ---------------------------------------------------------------------------
// Types (WI-1 pinned shapes — orchestrator/studio/skill-library.test.ts)
// ---------------------------------------------------------------------------

export type SkillSource = 'local' | 'community';
export type SkillTrust = 'ready' | 'draft' | 'needs-review';

export interface SkillProvenance {
  source: string;
  upstreamRef?: string;
  contentHash: string;
  installedAt: string;
  catalogId?: string;
}

export interface SkillLibraryEntry {
  id: string;
  name: string;
  description?: string;
  source: SkillSource;
  installed: boolean;
  trust: SkillTrust;
  paletteVisible: boolean;
  usedBy: string[]; // DERIVED agent slugs — never from catalog data (D3)
  provenance: SkillProvenance | null;
  category?: string;
  tier?: string;
  stars?: string;
  hub?: string; // catalog metadata — unpopulated until a hub source exists
  error?: string; // malformed on-disk skill — surfaced, never swallowed (AT-7)
  path?: string;
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

export interface InstallInput {
  forgeRoot: string;
  id: string;
  packageDir: string;
  upstream: { source: string; ref?: string };
}

export interface InstallResult {
  alreadyInstalled: boolean;
}

/** Lint finding shape shared with `orchestrator/studio/validate.ts` — reused,
 *  not re-invented, so `forge studio lint` renders every finding uniformly. */
export type LintFinding = Finding;

// ---------------------------------------------------------------------------
// Named constants (rule: no hardcoded caps/thresholds — tests assert these)
// ---------------------------------------------------------------------------

export const MAX_PACKAGE_FILES = 500;
export const MAX_PACKAGE_BYTES = 5 * 1024 * 1024; // 5 MiB
export const EXECUTABLE_EXTENSIONS = ['.sh', '.bash', '.js', '.mjs', '.cjs', '.py', '.rb', '.pl'] as const;

/** Frontmatter keys quarantined on install (D4) — the ONLY keys that can turn
 *  a vendored SKILL.md into a runnable, self-tool-granting agent. */
export const QUARANTINED_FRONTMATTER_KEYS = ['runtime', 'allowed-tools', 'library'] as const;

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

// ---------------------------------------------------------------------------
// Shared internals
// ---------------------------------------------------------------------------

/** Tolerant catalog load — an absent studio/catalog.yaml means "no community
 *  skills yet", not an error (mirrors registry.ts's other list* tolerances). */
function loadCatalogSafely(forgeRoot: string): { communitySkills: CommunitySkill[] } {
  const catalogPath = join(forgeRoot, 'studio', 'catalog.yaml');
  if (!existsSync(catalogPath)) return { communitySkills: [] };
  const catalog = loadCatalog(catalogPath);
  return { communitySkills: catalog.communitySkills ?? [] };
}

/** Every id `lintSkillRefs` accepts as "resolvable": ANY skill dir on disk
 *  (plain or agent-shaped — an agent legitimately composes another agent by
 *  slug, e.g. reflector composes brain-ingest) union the catalog's community
 *  ids. Shares its two data sources with listSkillLibrary's own enumeration —
 *  the union is computed once, not re-derived divergently. */
function allKnownSkillIds(forgeRoot: string): Set<string> {
  const localIds = listSkillDirs(forgeRoot).map((dir) => basename(dir));
  const catalog = loadCatalogSafely(forgeRoot);
  return new Set([...localIds, ...catalog.communitySkills.map((c) => c.id)]);
}

function extractProvenance(data: Record<string, unknown>): SkillProvenance | null {
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

function paletteVisibleFor(trust: SkillTrust, hasError: boolean): boolean {
  return trust === 'ready' && !hasError;
}

/**
 * Studio agents, tolerating a malformed one — mirrors listSkillLibrary's own
 * AT-7 resilience (a single bad sibling must not crash the whole scan).
 * registry.ts's `listAgentDefinitions` is NOT resilient (by design — its own
 * callers, e.g. cli/studio-lint.ts's section 1, catch per-entry to produce a
 * Finding); the trust/usage/ref derivation here only needs the WELL-FORMED
 * agents, so a load failure is skipped rather than propagated — the failing
 * agent's own load error is already surfaced elsewhere as a lint Finding.
 */
function listAgentDefinitionsResilient(skillsDirPath: string): AgentDefinition[] {
  const defs: AgentDefinition[] = [];
  for (const dir of listSkillMdDirs(skillsDirPath)) {
    const mdPath = join(dir, 'SKILL.md');
    if (!isStudioAgent(mdPath)) continue;
    try {
      defs.push(loadAgentDefinition(mdPath));
    } catch {
      /* malformed studio agent — already reported elsewhere; skip here */
    }
  }
  return defs.sort((a, b) => a.slug.localeCompare(b.slug));
}

// ---------------------------------------------------------------------------
// deriveSkillUsage — usedBy is derived from real agent specs ONLY (D3)
// ---------------------------------------------------------------------------

export function deriveSkillUsage(agents: readonly AgentDefinition[]): Map<string, string[]> {
  const bySkill = new Map<string, Set<string>>();
  for (const agent of agents) {
    for (const skillId of new Set(agent.composition.skills)) {
      if (!bySkill.has(skillId)) bySkill.set(skillId, new Set());
      bySkill.get(skillId)!.add(agent.slug);
    }
  }
  const out = new Map<string, string[]>();
  for (const [skillId, slugs] of bySkill) {
    out.set(skillId, [...slugs].sort((a, b) => a.localeCompare(b)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// skillTrustState — the single trust computation, reused by listSkillLibrary,
// registry.ts's listPlainSkills palette filter, and the lint checks below.
// ---------------------------------------------------------------------------

export function skillTrustState(forgeRoot: string, id: string): SkillTrust {
  const mdPath = skillPath(id, forgeRoot);
  const { data } = matter(readFileSync(mdPath, 'utf8'), {});
  const d = (data ?? {}) as Record<string, unknown>;
  if (d['status'] === 'draft') return 'draft';
  const provenance = extractProvenance(d);
  if (!provenance) return 'ready'; // no provenance ⇒ never needs-review (AT-37)
  const actualHash = hashSkillPackage(readSkillPackage(forgeRoot, id));
  return actualHash === provenance.contentHash ? 'ready' : 'needs-review';
}

// ---------------------------------------------------------------------------
// listSkillLibrary — the union view (local plain skills ∪ catalog community)
// ---------------------------------------------------------------------------

export function listSkillLibrary(forgeRoot: string): SkillLibraryEntry[] {
  const catalog = loadCatalogSafely(forgeRoot);
  const agents = listAgentDefinitionsResilient(skillsDir(forgeRoot));
  const usage = deriveSkillUsage(agents);

  const byId = new Map<string, SkillLibraryEntry>();

  for (const dir of listSkillDirs(forgeRoot)) {
    const id = basename(dir);
    const mdPath = skillPath(id, forgeRoot);
    if (isStudioAgent(mdPath)) continue; // studio agents are not skill-library entries (AT-5)

    let data: Record<string, unknown>;
    try {
      data = (matter(readFileSync(mdPath, 'utf8'), {}).data ?? {}) as Record<string, unknown>;
    } catch (e) {
      // Malformed/unreadable SKILL.md — surfaced with an explicit error, never
      // silently dropped from the listing (AT-7).
      byId.set(id, {
        id,
        name: id,
        source: 'local',
        installed: true,
        trust: 'draft',
        paletteVisible: false,
        usedBy: usage.get(id) ?? [],
        provenance: null,
        error: `cannot parse "${mdPath}" — ${(e as Error).message}`,
        path: mdPath,
      });
      continue;
    }

    const trust = skillTrustState(forgeRoot, id);
    byId.set(id, {
      id,
      name: typeof data['name'] === 'string' && data['name'] ? (data['name'] as string) : id,
      description: typeof data['description'] === 'string' ? (data['description'] as string) : undefined,
      source: 'local',
      installed: true,
      trust,
      paletteVisible: paletteVisibleFor(trust, false),
      usedBy: usage.get(id) ?? [],
      provenance: extractProvenance(data),
      path: mdPath,
    });
  }

  for (const cs of catalog.communitySkills) {
    const existing = byId.get(cs.id);
    if (existing) {
      // Filesystem wins on existence/trust; catalog wins on display metadata (AT-3).
      byId.set(cs.id, {
        ...existing,
        category: cs.category,
        tier: cs.tier,
        stars: cs.stars,
        description: existing.description ?? cs.desc,
      });
    } else {
      byId.set(cs.id, {
        id: cs.id,
        name: cs.name,
        description: cs.desc,
        source: 'community',
        installed: false,
        trust: 'ready',
        paletteVisible: true,
        usedBy: usage.get(cs.id) ?? [],
        provenance: null,
        category: cs.category,
        tier: cs.tier,
        stars: cs.stars,
      });
    }
  }

  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Package read + hash
// ---------------------------------------------------------------------------

/** Read every file under an installed skill's directory — SKILL.md first,
 *  then the rest sorted lexicographically by relative POSIX path (AT-11). */
export function readSkillPackage(forgeRoot: string, id: string): PackageFile[] {
  const dir = skillDir(id, forgeRoot);
  if (!existsSync(join(dir, 'SKILL.md'))) {
    throw new Error(`readSkillPackage: no SKILL.md found for skill "${id}" under "${dir}"`);
  }
  const files: PackageFile[] = [];
  const walk = (absDir: string, relDir: string): void => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const absPath = join(absDir, entry.name);
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(absPath, relPath);
      } else if (entry.isFile()) {
        files.push({ path: relPath, body: readFileSync(absPath, 'utf8') });
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
  const quarantinedKeys = QUARANTINED_FRONTMATTER_KEYS.filter((k) => k in d);
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

  // Reinstall is idempotent — leave the existing directory byte-identical (AT-24).
  if (existsSync(skillPath(id, forgeRoot))) {
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

  // Pre-validate every destination path BEFORE any write (AT-21: a failure
  // here must leave skills/<id>/ absent entirely).
  const skillDirPath = skillDir(id, forgeRoot);
  const destBoundary = skillsDir(forgeRoot) + sep;
  const destinations = files.map((f) => {
    const destPath = join(skillDirPath, ...f.path.split('/'));
    if (!resolve(destPath).startsWith(destBoundary)) {
      throw new Error(`installSkillPackage: destination for "${f.path}" escapes "${skillsDir(forgeRoot)}" — refusing to write`);
    }
    return { destPath, file: f };
  });

  mkdirSync(skillDirPath, { recursive: true });
  for (const { destPath, file } of destinations) {
    mkdirSync(dirname(destPath), { recursive: true });
    if (file.path === 'SKILL.md') {
      writeFileSync(destPath, matter.stringify('\n' + cleanContent, newData), 'utf8');
    } else {
      writeFileSync(destPath, file.body, 'utf8');
    }
  }

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
  return newHash;
}

// ---------------------------------------------------------------------------
// Lint — consumed by cli/studio-lint.ts (forge studio lint)
// ---------------------------------------------------------------------------

function lintFinding(object: string, check: string, message: string): Finding {
  return { level: 'error', object, check, message };
}

/** `skill-trust/hash-drift` (needs-review present) + `skill-trust/draft-unapproved`
 *  (an agent composes a still-draft skill). See the trust vocabulary table. */
export function lintSkillTrust(forgeRoot: string): Finding[] {
  const findings: Finding[] = [];
  const entries = listSkillLibrary(forgeRoot);
  const draftIds = new Set(entries.filter((e) => e.trust === 'draft').map((e) => e.id));

  for (const entry of entries) {
    if (entry.trust === 'needs-review') {
      findings.push(
        lintFinding(
          `skill:${entry.id}`,
          'skill-trust/hash-drift',
          `Skill "${entry.id}" content no longer matches its pinned provenance.contentHash — repin or investigate before it can be palette-visible again`,
        ),
      );
    }
  }

  const agents = listAgentDefinitionsResilient(skillsDir(forgeRoot));
  for (const agent of agents) {
    for (const skillId of agent.composition.skills) {
      if (draftIds.has(skillId)) {
        findings.push(
          lintFinding(
            `agent:${agent.slug}`,
            'skill-trust/draft-unapproved',
            `Agent "${agent.slug}" composes skill "${skillId}" which is still status:draft — approve it in the skills library before an agent can compose it`,
          ),
        );
      }
    }
  }

  return findings;
}

/** `agent/skill-ref` — an agent composes a skill id that resolves to neither a
 *  local skill directory (plain or agent-shaped) nor a catalog community entry.
 *  Uses the SAME id union listSkillLibrary is built from (allKnownSkillIds),
 *  not a second divergent copy of "what counts as resolvable". */
export function lintSkillRefs(forgeRoot: string): Finding[] {
  const findings: Finding[] = [];
  const resolvable = allKnownSkillIds(forgeRoot);
  const agents = listAgentDefinitionsResilient(skillsDir(forgeRoot));
  for (const agent of agents) {
    for (const skillId of agent.composition.skills) {
      if (!resolvable.has(skillId)) {
        findings.push(
          lintFinding(
            `agent:${agent.slug}`,
            'agent/skill-ref',
            `Agent "${agent.slug}" composes skill "${skillId}" which resolves to neither a local skill directory nor a catalog community entry`,
          ),
        );
      }
    }
  }
  return findings;
}
