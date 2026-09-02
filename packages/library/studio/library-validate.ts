/**
 * Forge Studio validators for library's own object kinds — Catalog,
 * Community registry, Artifact template and Skill (spec §3.1 gives these
 * kinds to `library`; the `library` frontmatter flag on a Skill's SKILL.md
 * is `validateLibraryFlag`).
 *
 * MOVED VERBATIM from `orchestrator/studio/validate.ts` (M4 library-by-kind
 * carve, Part 1) — `validateLibraryFlag`, `validateArtifactTemplate`,
 * `validateInstructionSeed`, `validateCatalog`, `validateCommunityRegistry`.
 * `validate.ts` re-exports all five so its existing importers (chiefly
 * `cli/studio-lint.ts`) stay untouched. `validateArtifactRef` — flow-edge
 * validation, `object: 'flow:<id>'` — is NOT one of library's kinds and
 * stays in `validate.ts`.
 *
 * `findDuplicates` is duplicated here (not imported back from `validate.ts`)
 * because both movers and stayers call it and importing it back across the
 * package boundary would re-add the exact `package-to-legacy` edge this
 * carve exists to remove — the same choice `template-library.ts` and
 * `connection-validate.ts` already made for `err`/`flag` before those moved
 * to `@forge/kernel`.
 */

import type { ArtifactTemplate, Catalog, CommunityRegistry, InstructionSeed } from '@forge/contracts/studio/types.ts';
import { SLUG_RE } from '@forge/kernel/ids.ts';
import { type Finding, err, flag } from '@forge/kernel';
import { communitySourceKey } from './community-source-url.ts';

// Duplicated from `orchestrator/studio/validate.ts` — see header.
function findDuplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}

// ---------------------------------------------------------------------------
// validateLibraryFlag (R3-01-F2)
// `library` must be an explicit boolean in every skill's SKILL.md
// frontmatter — never left unset. Deliberately takes raw frontmatter data
// rather than a loaded AgentDefinition: unlike validateAgent, this must run
// against every skill dir the scan reaches, including ones that never pass
// isStudioAgent/loadAgentDefinition at all (no `runtime` block, or an
// explicit `library: false`) — a `library: false` skill must still be
// reachable to prove it's explicit.
// ---------------------------------------------------------------------------

export function validateLibraryFlag(entryName: string, data: unknown): Finding[] {
  const value =
    data != null && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)['library']
      : undefined;

  if (typeof value !== 'boolean') {
    return [
      err(
        `agent:${entryName}`,
        'library',
        `"library" must be an explicit boolean (true/false) in SKILL.md frontmatter — found ${
          value === undefined ? 'unset' : JSON.stringify(value)
        }`,
      ),
    ];
  }
  return [];
}

export function validateArtifactTemplate(t: ArtifactTemplate): Finding[] {
  const findings: Finding[] = [];
  const obj = `artifact-template:${t.id}`;
  if (!SLUG_RE.test(t.id)) {
    findings.push(err(obj, 'slug', `Artifact template id "${t.id}" does not match ${SLUG_RE}`));
  }
  for (const [field, slug] of [
    ['producer', t.producer],
    ['consumer', t.consumer],
  ] as const) {
    if (slug !== undefined && !SLUG_RE.test(slug)) {
      findings.push(err(obj, `${field}/slug`, `${field} "${slug}" does not match ${SLUG_RE}`));
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// validateInstructionSeed (R3-05-F1)
// ---------------------------------------------------------------------------

/**
 * An instruction seed (`studio/instruction-seeds/<id>.md`) is a vetted,
 * composable AGENTS.md building block. The loader (`loadInstructionSeed`)
 * already enforces the presence of `id/title/kind/appliesTo/scope/provenance`
 * and the `kind`/`scope` enums (a malformed file throws at load, surfaced by
 * `forge studio lint`). This validator adds the SEMANTIC rules the loader can't:
 * a slug-shaped id, non-blank title, ≥1 `appliesTo` tag, slug-shaped tags, and
 * — the corpus-grounding rule (no hand-invented best practices) — a non-blank
 * `provenance` citation and a non-trivial body.
 */
export function validateInstructionSeed(s: InstructionSeed): Finding[] {
  const findings: Finding[] = [];
  const obj = `instruction-seed:${s.id}`;
  if (!SLUG_RE.test(s.id)) {
    findings.push(err(obj, 'slug', `Instruction-seed id "${s.id}" does not match ${SLUG_RE}`));
  }
  if (!s.title.trim()) {
    findings.push(err(obj, 'title', 'Instruction-seed title is missing or blank'));
  }
  if (s.appliesTo.length === 0) {
    findings.push(err(obj, 'applies-to', 'Instruction-seed must declare ≥1 appliesTo tag (else it can never match a project)'));
  }
  for (const tag of s.appliesTo) {
    if (!SLUG_RE.test(tag)) {
      findings.push(err(obj, 'applies-to/slug', `appliesTo tag "${tag}" does not match ${SLUG_RE}`));
    }
  }
  // Corpus-grounding — provenance is mandatory (loader) AND must be non-blank
  // (the loader's reqString tolerates a whitespace-only value); every shipped
  // seed cites where the practice was proven.
  if (!s.provenance.trim()) {
    findings.push(err(obj, 'provenance', 'Instruction-seed provenance is blank — every seed must cite a real artifact (repo path, cycle archive, or upstream URL); no hand-invented best practices'));
  }
  if (!s.body.trim()) {
    findings.push(err(obj, 'body', 'Instruction-seed body is empty — a seed must carry a composable AGENTS.md block'));
  }
  return findings;
}

// ---------------------------------------------------------------------------
// validateCatalog
// ---------------------------------------------------------------------------

export function validateCatalog(c: Catalog): Finding[] {
  const findings: Finding[] = [];
  const obj = 'catalog';

  // unique-ids within each section
  // Note: catalog entry ids are free-form display ids (model ids contain dots/uppercase —
  // e.g. "claude-sonnet-4-6"), deliberately not slug-checked.
  const sections: [string, { id: string }[]][] = [
    ['sdks', c.sdks],
    ['models', c.models],
    ['tools', c.tools],
    ['mcps', c.mcps],
    ['guards', c.guards],
  ];

  for (const [section, entries] of sections) {
    for (const dup of findDuplicates(entries.map((e) => e.id))) {
      findings.push(
        err(obj, 'unique-ids', `Duplicate id "${dup}" in catalog.${section}`),
      );
    }
  }

  // model-sdk: every model's sdk must be among declared sdk ids
  const sdkIds = new Set(c.sdks.map((s) => s.id));
  for (const model of c.models) {
    if (!sdkIds.has(model.sdk)) {
      findings.push(
        err(
          obj,
          'model-sdk',
          `Model "${model.id}" references unknown sdk "${model.sdk}" — not in catalog.sdks`,
        ),
      );
    }
  }

  // community-skills validation REMOVED (W6-CR-1 reviewer fix): catalog.yaml's
  // `community-skills:` section is gone (moved to
  // studio/community/registry.yaml — see validateCommunityRegistry below) and
  // `loadCatalog` never populates `Catalog.communitySkills` from anything —
  // this block tested a shape no caller can produce. Keeping it would be dead
  // validation for a field nothing on the load path sets.

  return findings;
}

// ---------------------------------------------------------------------------
// validateCommunityRegistry (W6-CR-1)
// ---------------------------------------------------------------------------

/**
 * studio/community/registry.yaml (W6-CR-1) — the declared-list source of
 * truth for community items (skill/hook/mcp/tool), superseding catalog.yaml's
 * former `community-skills:` section. Schema shape, the kind vocabulary, and
 * `fetchedBy` presence are all enforced at LOAD time — `loadCommunityRegistry`
 * (registry.ts) throws on any of those violations, and the caller
 * (cli/studio-lint.ts) surfaces the throw as a `load` finding naming the real
 * underlying error. This function covers the semantic checks that need the
 * full item roster instead: (kind, id) uniqueness across the registry, and
 * the recommended-tier vocabulary (mirrors validateCatalog's now-retired
 * community-skill/tier check, same TIERS set).
 */
export function validateCommunityRegistry(registry: CommunityRegistry): Finding[] {
  const findings: Finding[] = [];
  const obj = 'studio:community-registry';

  const keys = registry.items.map((item) => `${item.kind}:${item.id}`);
  for (const dup of findDuplicates(keys)) {
    const [kind, id] = dup.split(':');
    findings.push(
      err(obj, 'unique-ids', `Duplicate (kind, id) pair "${kind}, ${id}" in studio/community/registry.yaml`),
    );
  }

  // W8-B5 (exit row E4, community-28) — CLOSE THE COMMENT-LOSS CLASS.
  // `serializeCommunityRegistry` re-emits the file's LEADING comment block
  // verbatim, so the 22 header lines of curation rationale survive every
  // write. It provably cannot preserve a comment written INSIDE `items:` —
  // js-yaml has no comment round-trip and the serializer dumps a freshly
  // built object. Rather than leave that residual to be discovered by the
  // next operator whose annotation silently vanished, lint REFUSES it: what
  // the linter will not accept cannot later be lost. Every offending line is
  // named (a first-hit-only report trains a first-hit-only fix).
  for (const line of registry.itemsCommentLines) {
    findings.push(
      err(
        obj,
        'community-registry/lossy-comment',
        `studio/community/registry.yaml:${line} — a comment inside the "items:" block cannot survive a programmatic write (js-yaml has no comment round-trip, and Studio CRUD / the community refresh both re-serialize the whole file). Move this rationale into the file's leading comment header, which IS preserved verbatim.`,
      ),
    );
  }

  // W8-B5 (exit row E5) — a `sources` row nothing refers to is dead weight
  // that will drift: nothing reads it, so nothing keeps it honest.
  const referenced = new Set(
    registry.items.map((item) => communitySourceKey(item.sourceUrl)).filter((k): k is string => k !== null),
  );
  for (const key of Object.keys(registry.sources)) {
    if (!referenced.has(key)) {
      findings.push(
        flag(
          obj,
          'community-registry/orphan-source',
          `studio/community/registry.yaml: sources "${key}" is referenced by no item's sourceUrl — a repo fact nothing reads. Delete it, or add the item that needs it.`,
        ),
      );
    }
  }

  const TIERS = new Set(['haiku', 'sonnet', 'opus']);
  for (const item of registry.items) {
    if (item.tier !== undefined && !TIERS.has(item.tier)) {
      findings.push(
        err(
          obj,
          'community-registry/tier',
          `Community registry item "${item.id}" tier "${item.tier}" must be one of haiku|sonnet|opus`,
        ),
      );
    }
  }

  return findings;
}
