/**
 * Skill library — trust pipeline + registry model (R3-01-F3/F4).
 *
 * Single source for the skill-library object model: the union of local plain
 * skills (`skills/<id>/SKILL.md`, no `runtime:` block) and
 * `studio/community/registry.yaml` community entries (W6-CR-1), the trust
 * vocabulary that gates palette visibility, and the install → quarantine →
 * approve → re-review pipeline for vendored packages.
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
 *
 * Every id-taking export below is slug-validated before it touches a path —
 * see `orchestrator/skill-path.ts` (the guard lives there so it covers every
 * current and future caller of `skillPath`/`skillDir`, not just this module).
 *
 * The install ledger (`studio/installed-skills.yaml`, see
 * `./skill-install-ledger.ts`) is a SECOND source of truth `skillTrustState`
 * cross-checks the on-disk `provenance` block against, closing the blind spot
 * where the pin lived only inside the file it protected. HONESTY CONSTRAINT:
 * this is NOT tamper-proof — an attacker who edits both the SKILL.md and the
 * ledger in the same change defeats it exactly as before. It only detects a
 * mismatch between the two; it never guarantees the content is genuine.
 *
 * Split three ways in M4-library PR 4b: this file (`skill-trust.ts`) keeps
 * the trust/listing/lint surface; package read/hash/scan primitives moved to
 * `./skill-package.ts`; the install/approve/re-pin mutate surface moved to
 * `./skill-install.ts`.
 */

import { basename, join } from 'node:path';
import { readFileSync } from 'node:fs';
import matter from 'gray-matter';

// Every matter() parse call below passes a (possibly empty) options object.
// gray-matter caches parse results keyed by raw string content ONLY when
// called with no options at all — and it seeds that cache before parsing, so
// a caller who swallows a YAML error (registry.ts's isStudioAgent does,
// deliberately) poisons the cache for every later no-options call on the
// same content, silently turning a genuinely malformed SKILL.md into an
// empty-data success. Passing {} opts out of the cache entirely.

import { guardedSkillMdPath, skillsDir, listSkillDirs, listSkillMdDirs } from '../skill-path.ts';
import { isStudioAgent, loadAgentDefinition } from '../../../orchestrator/studio/registry.ts';
import { communitySkillsFromRegistry } from './community-registry.ts';
import { readInstallLedger } from './skill-install-ledger.ts';
import type { AgentDefinition, CommunitySkill } from '@forge/contracts/studio/types.ts';
import type { Finding } from '@forge/kernel';
import { extractProvenance, readSkillPackage, hashSkillPackage, type SkillProvenance } from './skill-package.ts';

// ---------------------------------------------------------------------------
// Types (WI-1 pinned shapes — orchestrator/studio/skill-library.test.ts)
// ---------------------------------------------------------------------------

export type SkillSource = 'local' | 'community';
export type SkillTrust = 'ready' | 'draft' | 'needs-review';

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
  /** W7-B3 (community-25): true for a registry-only community row with NO
   *  local bytes — a browse-only catalog REFERENCE. Nothing exists to trust,
   *  compose, or bind, so a reference is never palette-visible and every
   *  surface renders it as "browse upstream", never as a ready local skill.
   *  Absent (never false) for anything that exists on disk. */
  reference?: boolean;
}

/** Lint finding shape shared with `orchestrator/studio/validate.ts` — reused,
 *  not re-invented, so `forge studio lint` renders every finding uniformly. */
export type LintFinding = Finding;

// ---------------------------------------------------------------------------
// Shared internals
// ---------------------------------------------------------------------------

/** Tolerant community-skill load — an absent studio/community/registry.yaml
 *  means "no community skills yet", not an error (mirrors registry.ts's other
 *  list* tolerances; `communitySkillsFromRegistry` already returns [] for a
 *  missing file). A registry that FAILS to load (malformed YAML, bad kind
 *  vocab, ...) is likewise tolerated here: `runStudioLint`'s own
 *  community-registry section (apps/forge/studio-lint.ts) already loads the same
 *  file and surfaces the real error as a `studio:community-registry`/`load`
 *  finding; this function's job is only to extract communitySkills for the
 *  skill-trust pipeline, so re-throwing the SAME load error a second time
 *  here would crash the whole lint run instead of reporting it once.
 *  W6-CR-1: source moved from studio/catalog.yaml's `community-skills:`
 *  section to studio/community/registry.yaml — the declared-list source of
 *  truth for community items. */
function loadCommunitySkillsSafely(forgeRoot: string): { communitySkills: CommunitySkill[] } {
  try {
    return { communitySkills: communitySkillsFromRegistry(forgeRoot) };
  } catch {
    return { communitySkills: [] };
  }
}

/** Every id `lintSkillRefs` accepts as "resolvable": ANY skill dir on disk
 *  (plain or agent-shaped — an agent legitimately composes another agent by
 *  slug, e.g. reflector composes brain-ingest) union the catalog's community
 *  ids. Shares its two data sources with listSkillLibrary's own enumeration —
 *  the union is computed once, not re-derived divergently. */
function allKnownSkillIds(forgeRoot: string): Set<string> {
  const localIds = listSkillDirs(forgeRoot).map((dir) => basename(dir));
  const catalog = loadCommunitySkillsSafely(forgeRoot);
  return new Set([...localIds, ...catalog.communitySkills.map((c) => c.id)]);
}

function paletteVisibleFor(trust: SkillTrust, hasError: boolean): boolean {
  return trust === 'ready' && !hasError;
}

/**
 * Studio agents, tolerating a malformed one — mirrors listSkillLibrary's own
 * AT-7 resilience (a single bad sibling must not crash the whole scan).
 * registry.ts's `listAgentDefinitions` is NOT resilient (by design — its own
 * callers, e.g. apps/forge/studio-lint.ts's section 1, catch per-entry to produce a
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
//
// Cross-checks on-disk provenance against the install ledger
// (skill-install-ledger.ts, Blocker 2 fix):
//   - ledger entry exists, on-disk provenance missing OR its contentHash
//     disagrees with the LEDGER's contentHash  → needs-review, tampered
//   - ledger entry exists, hashes agree with the ledger, but the actual
//     recomputed package hash differs         → needs-review, hash-drift
//   - on-disk provenance exists, NO ledger entry                → needs-review, unregistered
//     (whether or not its contentHash matches the actual package: a
//     self-consistent-but-unregistered pin is exactly as suspect as a
//     drifted one, since nothing vouches for either)
//   - neither provenance nor ledger entry                       → ready (hand-authored, AT-37)
// ---------------------------------------------------------------------------

export type SkillTrustReason = 'provenance-tampered' | 'unregistered-install' | 'hash-drift';

export interface SkillTrustDetail {
  trust: SkillTrust;
  reason?: SkillTrustReason;
}

/** The full trust computation, including WHY a needs-review verdict was
 *  reached — `skillTrustState` below is the thin `.trust`-only wrapper most
 *  callers use; `lintSkillTrust` needs the reason to pick the right finding. */
export function skillTrustDetail(forgeRoot: string, id: string): SkillTrustDetail {
  // COMMON §15.19 — through the containment guard, not `skillPath`'s bare
  // layout join. This is a READ whose result feeds a TRUST verdict, so a
  // redirected read is a trust verdict computed from someone else's file.
  const mdPath = guardedSkillMdPath(id, forgeRoot);
  if (mdPath === null) {
    throw new Error(`skillTrustDetail: skill "${id}" has no readable SKILL.md inside the library (missing, or the path escapes skills/)`);
  }
  const { data } = matter(readFileSync(mdPath, 'utf8'), {});
  const d = (data ?? {}) as Record<string, unknown>;
  if (d['status'] === 'draft') return { trust: 'draft' };

  const provenance = extractProvenance(d);
  const ledgerEntry = readInstallLedger(forgeRoot).get(id);

  if (ledgerEntry) {
    if (!provenance || provenance.contentHash !== ledgerEntry.contentHash) {
      return { trust: 'needs-review', reason: 'provenance-tampered' };
    }
    const actualHash = hashSkillPackage(readSkillPackage(forgeRoot, id));
    return actualHash === provenance.contentHash
      ? { trust: 'ready' }
      : { trust: 'needs-review', reason: 'hash-drift' };
  }

  if (!provenance) return { trust: 'ready' }; // no provenance, no ledger ⇒ hand-authored (AT-37)

  // Provenance present but nothing in the ledger vouches for it. A plain
  // byte-level mismatch is still reported as hash-drift (the original,
  // ledger-agnostic check this codebase already asserted before the ledger
  // existed); a provenance block that IS internally self-consistent with the
  // real package bytes is reported as unregistered — the only way to still
  // catch it, since a hash comparison alone finds nothing wrong.
  const actualHash = hashSkillPackage(readSkillPackage(forgeRoot, id));
  return actualHash === provenance.contentHash
    ? { trust: 'needs-review', reason: 'unregistered-install' }
    : { trust: 'needs-review', reason: 'hash-drift' };
}

export function skillTrustState(forgeRoot: string, id: string): SkillTrust {
  return skillTrustDetail(forgeRoot, id).trust;
}

// ---------------------------------------------------------------------------
// listSkillLibrary — the union view (local plain skills ∪ catalog community)
// ---------------------------------------------------------------------------

export function listSkillLibrary(forgeRoot: string): SkillLibraryEntry[] {
  const catalog = loadCommunitySkillsSafely(forgeRoot);
  const agents = listAgentDefinitionsResilient(skillsDir(forgeRoot));
  const usage = deriveSkillUsage(agents);

  const byId = new Map<string, SkillLibraryEntry>();

  for (const dir of listSkillDirs(forgeRoot)) {
    const id = basename(dir);
    // Guarded, LEAF INCLUDED (COMMON §15.19). `GET /api/studio/skills` reaches
    // this loop with ids ENUMERATED from the tree, so no route-level pre-guard
    // is even possible — the check has to be here. `listSkillMdDirs` now
    // refuses a symlinked leaf at discovery too; this is the second half of
    // that pair, and either alone would leave the other's gap open.
    const mdPath = guardedSkillMdPath(id, forgeRoot);
    if (mdPath === null) continue; // not readable inside the library — never read through the link
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
      // W7-B3 (community-25): no local bytes = a browse-only REFERENCE.
      // The old `paletteVisible: true` advertised a composable skill that
      // structurally cannot be composed (there is nothing on disk), the
      // exact opposite of what /community says about the same id.
      byId.set(cs.id, {
        id: cs.id,
        name: cs.name,
        description: cs.desc,
        source: 'community',
        installed: false,
        trust: 'ready',
        paletteVisible: false,
        usedBy: usage.get(cs.id) ?? [],
        provenance: null,
        category: cs.category,
        tier: cs.tier,
        stars: cs.stars,
        reference: true,
      });
    }
  }

  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Lint — consumed by apps/forge/studio-lint.ts (forge studio lint)
// ---------------------------------------------------------------------------

function lintFinding(object: string, check: string, message: string): Finding {
  return { level: 'error', object, check, message };
}

/**
 * D4's roster-level enforcement point (MAJOR 2, third adversarial-review
 * round): `isStudioAgent` now refuses this exact shape structurally, which is
 * precisely what makes it invisible to `listAgentDefinitionsResilient` (and
 * therefore to every check built on top of it, including the rest of this
 * function). Without a dedicated scan, a hand-edited installed skill that
 * restores a top-level `runtime:` alongside its `provenance:`/`quarantined:`
 * block would simply vanish from lint output instead of being flagged — it
 * is excluded from the roster, not reported as the escalation attempt it is.
 */
function findInstalledAgentShapeViolations(forgeRoot: string): Finding[] {
  const findings: Finding[] = [];
  for (const dir of listSkillDirs(forgeRoot)) {
    const id = basename(dir);
    // Guarded (COMMON §15.19). Found while fixing the two sites the security
    // review named — the same shape, one function further down the same file,
    // which is the argument for fixing the CLASS at `guardedSkillMdPath`
    // rather than patching the reported call sites one at a time.
    const mdPath = guardedSkillMdPath(id, forgeRoot);
    if (mdPath === null) continue;
    let data: Record<string, unknown>;
    try {
      data = (matter(readFileSync(mdPath, 'utf8'), {}).data ?? {}) as Record<string, unknown>;
    } catch {
      continue; // malformed — already surfaced elsewhere (listSkillLibrary's AT-7 error field)
    }
    if ('runtime' in data && ('provenance' in data || 'quarantined' in data)) {
      findings.push(
        lintFinding(
          `skill:${id}`,
          'skill-trust/installed-agent-shape',
          `Skill "${id}" carries a top-level "runtime:" block together with a "provenance:"/"quarantined:" block — an installed package can never be loaded as a studio agent (D4); remove "runtime:" or resolve the provenance/quarantine mismatch`,
        ),
      );
    }
  }
  return findings;
}

/** `skill-trust/hash-drift` | `skill-trust/provenance-tampered` |
 *  `skill-trust/unregistered-install` (needs-review present, distinguished by
 *  `skillTrustDetail`'s reason) + `skill-trust/draft-unapproved` (an agent
 *  composes a still-draft skill) + `skill-trust/installed-agent-shape` (D4
 *  roster-level escalation attempt). See the trust vocabulary table. */
export function lintSkillTrust(forgeRoot: string): Finding[] {
  const findings: Finding[] = [...findInstalledAgentShapeViolations(forgeRoot)];
  const entries = listSkillLibrary(forgeRoot);
  const draftIds = new Set(entries.filter((e) => e.trust === 'draft').map((e) => e.id));

  for (const entry of entries) {
    if (entry.trust !== 'needs-review') continue;
    // entries with a parse `error` are hardcoded trust:'draft' above, never
    // 'needs-review', so this never re-reads a malformed SKILL.md.
    const { reason } = skillTrustDetail(forgeRoot, entry.id);
    if (reason === 'provenance-tampered') {
      findings.push(
        lintFinding(
          `skill:${entry.id}`,
          'skill-trust/provenance-tampered',
          `Skill "${entry.id}" on-disk provenance no longer agrees with its studio/installed-skills.yaml ledger entry — the pin may have been tampered with; investigate before it can be palette-visible again`,
        ),
      );
    } else if (reason === 'unregistered-install') {
      findings.push(
        lintFinding(
          `skill:${entry.id}`,
          'skill-trust/unregistered-install',
          `Skill "${entry.id}" carries a provenance block but has no matching entry in studio/installed-skills.yaml — it did not come through installSkillPackage (or its ledger entry was removed); investigate before it can be palette-visible again`,
        ),
      );
    } else {
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
