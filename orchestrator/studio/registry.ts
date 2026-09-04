/**
 * Forge Studio filesystem registry (ADR 027) — now a RE-EXPORT HUB only.
 *
 * Every kind has moved to the package that owns it: Agent to
 * `@forge/agents/studio/agent-registry.ts`, KB to
 * `@forge/knowledge/studio/kb-descriptor.ts`, Skill/Template/Catalog/Community
 * to `@forge/library/studio/*-registry.ts`, project discovery to
 * `@forge/kernel`, and — Task 13, the last one — the Flow kind to
 * `@forge/flows/studio/flow-registry.ts`. Validation still lives in
 * `./validate.ts`.
 *
 * Nothing is DEFINED here any more. The file exists only so the importers
 * inside `cli/` and `orchestrator/` keep resolving these names from
 * './registry.ts'; it is deleted with the host carve, which is what retires
 * the last of those importers.
 */

// The KB descriptor's load / serialize / process-resolution live in
// `@forge/knowledge/studio/kb-descriptor.ts`. Re-exported here so the legacy
// importers inside `orchestrator/` and `cli/` keep resolving them from
// './registry.ts' — repointing those at the package specifier would trade this
// one row for one per importer.
//
// Culled 2026-09-03 (M4-knowledge s5, ruling 54): `deriveKbUsageDefaults`,
// `DEFAULT_KB_LINT`, `DEFAULT_KB_INGEST` and `DEFAULT_KB_CONSOLIDATE` were
// re-exported here with ZERO importers taking them by this path — checked
// against all 73 files that import this module, not inferred. The one live
// consumer of `deriveKbUsageDefaults` already imports it from the package
// directly. The residual row for the three names below closes with the
// registry split (M4-agents), not here.
export {
  loadKbDescriptor,
  serializeKbDescriptor,
  resolveKbProcesses,
} from '@forge/knowledge/studio/kb-descriptor.ts';

// The Skill / Template / Catalog / Community kinds moved to
// `packages/library/studio/{skill,artifact,catalog,community}-registry.ts`
// (M4 library-by-kind carve, PR 3 / Part 2) — library's own object kinds
// (spec §3.1). Re-exported here so the small set of remaining importers
// INSIDE this legacy tree (orchestrator/'s own test suites, which use a
// short relative path rather than the package specifier and so were not
// individually repointed — see the carve spec's §C) keep resolving them from
// './registry.ts'; every other importer was repointed directly to the new
// files and does not go through this re-export.
export { listPlainSkills } from '@forge/library/studio/skill-registry.ts';
export {
  loadArtifactTemplate,
  listArtifactTemplates,
  loadDemoElement,
  listDemoElements,
  loadInstructionSeed,
  listInstructionSeeds,
} from '@forge/library/studio/artifact-registry.ts';
export { loadCatalog } from '@forge/library/studio/catalog-registry.ts';
export {
  communityRegistryPath,
  loadCommunityRegistry,
  serializeCommunityRegistry,
  resolveCommunitySource,
  communitySkillsFromRegistry,
  COMMUNITY_REGISTRY_SCHEMA_VERSION,
} from '@forge/library/studio/community-registry.ts';

// ---------------------------------------------------------------------------
// The Agent kind — MOVED to `packages/agents/studio/agent-registry.ts`
// (M4-agents, §4 M4 "registry loaders split from the registry module").
//
// The package that owns agents now owns loading them, and the generic half —
// reading a frontmatter document at all — went to
// `@forge/kernel/studio-object.ts` with a caller-passed validator, so kernel
// names no field of any kind. That closed the thirteen `package-to-legacy`
// rows this file used to mint, and removed a round trip: this module already
// imported `@forge/agents/skill-path.ts` + `studio/materials.ts` and
// re-exported `studio/skill-md-fidelity.ts`, so the graph ran
// agents -> orchestrator -> agents.
//
// Re-exported here, unchanged, for the ~17 host and sibling importers that
// still resolve the Agent kind through this file. Transitional and disclosed
// (ruling 48/58): they die with the host carve, not with this PR.
// ---------------------------------------------------------------------------
export {
  SURFACE_KINDS,
  PHASE_EXECUTOR_KINDS,
  isStudioAgent,
  isUnfilteredStudioAgent,
  loadAgentDefinition,
  listAgentDefinitions,
  listStarterAgents,
  serializeAgentDefinition,
} from '@forge/agents/studio/agent-registry.ts';


// ---------------------------------------------------------------------------
// The Flow kind — MOVED to `packages/flows/studio/flow-registry.ts`
// (Task 13, M4-flows; ADR 028 §1 puts the flow engine in the package, and the
// package that owns the engine owns loading its definitions — the same split
// the Agent kind took to `@forge/agents/studio/agent-registry.ts` and the KB
// kind to `@forge/knowledge/studio/kb-descriptor.ts`).
//
// Re-exported here, unchanged, for the importers inside `cli/` and
// `orchestrator/` that still resolve the Flow kind through this file.
// Transitional and disclosed (rulings 48/58): this re-export is ONE
// `legacy-to-package` row and it dies with the host carve, which is also when
// this whole module is deleted.
// ---------------------------------------------------------------------------
export {
  loadStarterFlow,
  loadFlowDefinition,
  serializeFlowDefinition,
  listFlowIds,
} from '@forge/flows/studio/flow-registry.ts';

// Artifact templates / demo elements / instruction seeds moved to
// `packages/library/studio/artifact-registry.ts`; Catalog moved to
// `packages/library/studio/catalog-registry.ts`; the whole Community block
// moved to `packages/library/studio/community-registry.ts` (M4
// library-by-kind carve, PR 3 / Part 2) — all three are library's own kinds.

// Project discovery (id normalisation + disk scan) — kernel owns these now
// (M4 ruling 18); this re-export keeps the ~30 legacy call sites unchanged
// until their own lanes repoint directly to @forge/kernel.
export { normalizeProjectId, discoverProjects, type DiscoveredProject } from '@forge/kernel';
