/**
 * Artifact templates, demo elements and instruction seeds — three of
 * library's own kinds, split out of `orchestrator/studio/registry.ts` (M4
 * library-by-kind carve, PR 3 / Part 2).
 *
 * MOVED VERBATIM — `loadArtifactTemplate` / `listArtifactTemplates` /
 * `loadDemoElement` / `listDemoElements` / `loadInstructionSeed` /
 * `listInstructionSeeds` (registry.ts:593-717 on the pre-carve head).
 * `studio/template-library.ts` used to import the first two of these FROM
 * `registry.ts` (an orchestrator→package back-edge); this move closes it —
 * both modules now sit in the same package.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

import { ARTIFACT_KINDS, DEMO_STEP_KINDS, INSTRUCTION_SEED_KINDS, INSTRUCTION_SEED_SCOPES } from '@forge/contracts/studio/types.ts';
import { reqString, optString, stringArray, oneOf } from '@forge/kernel/studio/yaml-fields.ts';
import type { ArtifactTemplate, DemoElementDefinition, InstructionSeed } from '@forge/contracts/studio/types.ts';

// ---------------------------------------------------------------------------
// Artifact templates — studio/artifact-templates/<id>.md (gray-matter, ADR-027 amendment).
// ---------------------------------------------------------------------------

export function loadArtifactTemplate(mdPath: string): ArtifactTemplate {
  let raw: string;
  try {
    raw = readFileSync(mdPath, 'utf8');
  } catch (err) {
    throw new Error(`${mdPath}: cannot read file — ${(err as Error).message}`);
  }
  const { data, content } = matter(raw);
  const d = data as Record<string, unknown>;
  const schemaRaw =
    d['schema'] && typeof d['schema'] === 'object' && !Array.isArray(d['schema'])
      ? (d['schema'] as Record<string, unknown>)
      : {};
  return {
    id: reqString(d, 'id', mdPath),
    name: reqString(d, 'name', mdPath),
    kind: oneOf(reqString(d, 'kind', mdPath), ARTIFACT_KINDS, mdPath, 'kind'),
    producer: optString(d, 'producer'),
    consumer: optString(d, 'consumer'),
    schema: {
      requiredFiles: stringArray(schemaRaw, 'requiredFiles', mdPath),
      requiredFields: stringArray(schemaRaw, 'requiredFields', mdPath),
      gitInvariants: stringArray(schemaRaw, 'gitInvariants', mdPath),
    },
    body: content.trim(),
    path: mdPath,
  };
}

export function listArtifactTemplates(studioRoot: string): ArtifactTemplate[] {
  const dir = join(studioRoot, 'studio', 'artifact-templates');
  let files: string[];
  try {
    // README.md documents the directory (R3-06) — it is not a template
    // definition and carries no gray-matter frontmatter, so it is excluded
    // by name rather than treated as a malformed entry. Matched
    // case-insensitively (a readme.md/Readme.md variant would otherwise slip
    // this check and, if it ever carried valid frontmatter, become a
    // phantom template) — mirrors the identical exclusion in
    // template-library.ts's listPlanningEntries; the two must stay identical.
    files = readdirSync(dir).filter((f) => f.endsWith('.md') && !/^readme\.md$/i.test(f));
  } catch {
    return []; // absent dir → no templates (tolerated)
  }
  return files.map((f) => loadArtifactTemplate(join(dir, f)));
}

/**
 * Load one demo-element definition (`studio/demo-elements/<id>.md`) — a member of
 * the forge demo-element library (a skill-creating skill). Throws on a malformed
 * file so `forge studio lint` surfaces it.
 */
export function loadDemoElement(mdPath: string): DemoElementDefinition {
  let raw: string;
  try {
    raw = readFileSync(mdPath, 'utf8');
  } catch (err) {
    throw new Error(`${mdPath}: cannot read file — ${(err as Error).message}`);
  }
  const { data, content } = matter(raw);
  const d = data as Record<string, unknown>;
  return {
    id: reqString(d, 'id', mdPath),
    name: reqString(d, 'name', mdPath),
    phase: oneOf(reqString(d, 'phase', mdPath), DEMO_STEP_KINDS, mdPath, 'phase'),
    description: reqString(d, 'description', mdPath),
    configHint: optString(d, 'configHint') ?? '',
    body: content.trim(),
    path: mdPath,
  };
}

/** List the forge demo-element library (`studio/demo-elements/*.md`). Absent ⇒ []. */
export function listDemoElements(studioRoot: string): DemoElementDefinition[] {
  const dir = join(studioRoot, 'studio', 'demo-elements');
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
  return files.map((f) => loadDemoElement(join(dir, f))).sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Instruction seeds (R3-05) — studio/instruction-seeds/<id>.md (gray-matter).
// A vetted, composable AGENTS.md building block. Lenient-parse-then-lint: a
// malformed seed throws here so `forge studio lint` surfaces it, and the enum
// fields are checked at load (kind/scope) mirroring artifact-template `kind`.
// ---------------------------------------------------------------------------

/** Load one instruction seed (`studio/instruction-seeds/<id>.md`). Throws on a malformed file. */
export function loadInstructionSeed(mdPath: string): InstructionSeed {
  let raw: string;
  try {
    raw = readFileSync(mdPath, 'utf8');
  } catch (err) {
    throw new Error(`${mdPath}: cannot read file — ${(err as Error).message}`);
  }
  const { data, content } = matter(raw);
  const d = data as Record<string, unknown>;
  return {
    id: reqString(d, 'id', mdPath),
    title: reqString(d, 'title', mdPath),
    kind: oneOf(reqString(d, 'kind', mdPath), INSTRUCTION_SEED_KINDS, mdPath, 'kind'),
    appliesTo: stringArray(d, 'appliesTo', mdPath),
    scope: oneOf(reqString(d, 'scope', mdPath), INSTRUCTION_SEED_SCOPES, mdPath, 'scope'),
    provenance: reqString(d, 'provenance', mdPath),
    body: content.trim(),
    path: mdPath,
  };
}

/** List the forge instruction-seed library (`studio/instruction-seeds/*.md`). Absent ⇒ []. */
export function listInstructionSeeds(studioRoot: string): InstructionSeed[] {
  const dir = join(studioRoot, 'studio', 'instruction-seeds');
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return []; // absent dir → no seeds (tolerated)
  }
  return files.map((f) => loadInstructionSeed(join(dir, f))).sort((a, b) => a.id.localeCompare(b.id));
}
