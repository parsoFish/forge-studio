/**
 * Template library — union registry over the three template sources (R3-06).
 *
 * Mirrors skill-library.ts's pattern (load → derive → union → lint) applied to
 * a DIFFERENT set of sources: three structurally-distinct on-disk collections
 * that were never before presented as one library —
 *
 *   planning         studio/artifact-templates/*.md   (ArtifactTemplate)
 *   demo-output      studio/demo-elements/*.md         (DemoElementDefinition)
 *   project-scaffold studio/starters/projects/<id>/    (a whole file tree)
 *
 * D1 — category is STRUCTURAL (which directory a definition lives in), never
 * sniffed from its content. A `kind`/`phase` field varies WITHIN a category; it
 * never decides the category itself.
 *
 * D2 — studio/starters/ also holds `agents/` and `flows/` — agent/flow
 * DEFINITIONS already first-class in their own pillars (the Agent Builder's
 * StarterPicker / the flow builder's loadStarterFlow), deliberately excluded
 * from this library. `STARTERS_NON_TEMPLATE_DIRS` names the exclusion with a
 * reason; `lintTemplateLibrary` errors on any OTHER unmapped starters/
 * subdirectory, so a future addition must be triaged by a human, not silently
 * swept in or silently dropped.
 *
 * D3 — `usedBy` is DERIVED from a real on-disk source, and that source is
 * NAMED on every entry (`usedByDerivation`), so an empty `usedBy` reads as
 * "scanned N sources, found none" rather than "unknown". Planning usage comes
 * from the real flow graph (edges); demo-output usage comes from projects'
 * `.forge/project.json` `demoProcess[].element`; project-scaffold usage is
 * HONESTLY EMPTY — `appType` is validated at creation (project-create.ts) but
 * persisted nowhere, so attributing a scaffold to a project would require a
 * file-shape heuristic, which is exactly the anti-pattern this module refuses
 * to reintroduce (a prior initiative's fabricated `usedBy` was caught in
 * review; see AT-23's regression guard).
 *
 * D4 — declared `producer:`/`consumer:` frontmatter (unlike a deleted, wholly
 * fabricated `composedBy`) are mostly true, so the fix is cross-validation, not
 * deletion: surfaced verbatim as `declaredProducer`/`declaredConsumer`, checked
 * against the resolved flow-edge endpoints. Edge-backed + agreeing ⇒
 * `endpointsVerified: true`; edge-backed + contradicting ⇒ a lint ERROR;
 * zero-edge (today: verdict/work-items/demo-fix-spec travel by orchestrator-band
 * re-entry, not a DAG edge) ⇒ `endpointsVerified: false` + a lint FLAG (the
 * claim is unverifiable, not wrong). A gate node (no `agent`) matches a
 * declared value equal to either its bare node id or the resolved `gate:<id>`
 * form — the frontmatter is never "fixed" to invent an agent that isn't there.
 *
 * D5/D6 — `format`/`provenance`/`previewKind` are DERIVED from existing fields,
 * never new frontmatter. `previewKind` is a total function over the source's
 * validated enum (`ArtifactKind` / `DemoStepKind`) with a throwing default arm —
 * belt-and-braces, since `loadArtifactTemplate`/`loadDemoElement` already
 * reject an invalid enum value before previewKind ever sees it.
 *
 * D7 — a malformed definition surfaces as an entry carrying `error`, never
 * dropped (the skill-library.ts precedent: a silently dropped entry is an
 * invisible failure, not a fixed one). This means `listArtifactTemplates` /
 * `listDemoElements` (registry.ts) — which throw on the FIRST malformed file in
 * a directory, failing the whole batch — are NOT reused here; this module reads
 * the directory itself and calls the single-file loaders
 * (`loadArtifactTemplate` / `loadDemoElement`) per file, catching per-file so
 * one bad sibling never hides the rest.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { listProjectStarters } from '@forge/kernel';
import {
  discoverProjects,
  listFlowIds,
  loadArtifactTemplate,
  loadDemoElement,
  loadFlowDefinition,
  type DiscoveredProject,
} from '../../../orchestrator/studio/registry.ts';
import type { PackageFile } from './skill-package.ts';
import type { ArtifactKind, DemoStepKind, FlowDefinition, FlowNode } from '@forge/contracts/studio/types.ts';
import type { Finding } from '../../../orchestrator/studio/validate.ts';

// ---------------------------------------------------------------------------
// Public types (BINDING shapes — orchestrator/studio/template-library.test.ts)
// ---------------------------------------------------------------------------

export type TemplateCategory = 'demo-output' | 'planning' | 'project-scaffold';
export type TemplatePreviewKind = 'html' | 'video' | 'shots' | 'mock' | 'doc' | 'scaffold';

/** Names the real on-disk source a `usedBy` array was scanned from, and how
 *  many of that source were scanned — the anti-fabrication device (D3): an
 *  empty `usedBy` always reads as "scanned N, found none", never "unknown". */
export interface TemplateUsedByDerivation {
  readonly source: string;
  readonly scanned: number;
}

export interface TemplateLibraryEntry {
  id: string;
  name: string;
  category: TemplateCategory;
  /** Derived (D5) — absent only when the definition failed to parse (`error` set). */
  format?: string;
  provenance: string;
  definitionRef: string;
  /** Derived (D6), total-function output — absent only when the definition failed to parse. */
  previewKind?: TemplatePreviewKind;
  usedBy: string[];
  usedByDerivation: TemplateUsedByDerivation;
  /** Planning only — whether declaredProducer/declaredConsumer agree with the
   *  resolved flow-edge endpoints. Absent when nothing is declared. */
  endpointsVerified?: boolean;
  /** Verbatim frontmatter values (D4) — never normalized to a resolved form. */
  declaredProducer?: string;
  declaredConsumer?: string;
  description?: string;
  /** A malformed definition surfaces here (D7) — never dropped from the listing. */
  error?: string;
}

export type TemplateDetail = TemplateLibraryEntry & { files: PackageFile[] };

/** D2 — the exhaustive exclusion list for `studio/starters/` subdirectories
 *  that are NOT a template-library source. Git-tracked, not inferred, so a new
 *  starters/ subdirectory must be triaged by a human (mapped, or added here
 *  with a reason) before `lintTemplateLibrary` goes clean again. */
export const STARTERS_NON_TEMPLATE_DIRS: readonly { dir: string; reason: string }[] = [
  {
    dir: 'agents',
    reason:
      'Agent starters are agent DEFINITIONS already first-class in the Agent Builder pillar (listStarterAgents feeds StarterPicker) — not a template-library category.',
  },
  {
    dir: 'flows',
    reason:
      'Flow starters are flow DEFINITIONS already first-class in the flow builder (loadStarterFlow seeds it) — not a template-library category.',
  },
];

// ---------------------------------------------------------------------------
// Named constants — no hardcoded strings scattered through the derivation logic
// ---------------------------------------------------------------------------

const PLANNING_PROVENANCE = 'studio/artifact-templates';
const DEMO_OUTPUT_PROVENANCE = 'studio/demo-elements';
const SCAFFOLD_PROVENANCE = 'studio/starters/projects';

const PLANNING_USAGE_SOURCE = 'studio/flows/*/flow.yaml';
const DEMO_OUTPUT_USAGE_SOURCE = 'projects/*/.forge/project.json (demoProcess)';
/** D3 — the honest reason project-scaffold usage can never be derived: appType
 *  is validated at creation time but recorded nowhere afterward. */
const SCAFFOLD_USAGE_SOURCE =
  'appType is validated against listProjectStarters at project-create time (orchestrator/project-create.ts) but is never persisted in .forge/project.json — no on-disk source records which scaffold produced a given project, so usage cannot be derived (a file-shape comparison would be a fabrication, not a derivation)';

const SCAFFOLD_FORMAT = 'directory tree';
const EDGE_ARROW = '→';

const CHECK_STARTERS_GAP = 'template-library/starters-gap';
const CHECK_DUPLICATE_ID = 'template-library/duplicate-id';
const CHECK_ENDPOINT_MISMATCH = 'template-library/endpoint-mismatch';
const CHECK_UNVERIFIABLE_ENDPOINTS = 'template-library/unverifiable-endpoints';

// ---------------------------------------------------------------------------
// Finding helpers — Finding itself is shared with validate.ts, but its `err`/
// `flag` constructors are module-private there (skill-library.ts mirrors the
// same local pair rather than importing private helpers; this module follows
// that established precedent).
// ---------------------------------------------------------------------------

function err(object: string, check: string, message: string): Finding {
  return { level: 'error', object, check, message };
}

function flag(object: string, check: string, message: string): Finding {
  return { level: 'flag', object, check, message };
}

// ---------------------------------------------------------------------------
// D6 — previewKind: total functions over an already-enum-validated field.
// The default arm can only fire if a caller bypasses loadArtifactTemplate /
// loadDemoElement's own oneOf() validation — defensive, never a silent fallback.
// ---------------------------------------------------------------------------

function planningPreviewKind(kind: ArtifactKind): TemplatePreviewKind {
  switch (kind) {
    case 'file':
      return 'doc';
    case 'git-state':
      return 'mock';
    default: {
      const exhaustive: never = kind;
      throw new Error(`template-library: unrecognised artifact-template kind "${String(exhaustive)}" — no previewKind mapping`);
    }
  }
}

function demoOutputPreviewKind(phase: DemoStepKind): TemplatePreviewKind {
  switch (phase) {
    case 'capture':
      return 'shots';
    case 'verify':
      return 'html';
    case 'present':
      return 'doc';
    default: {
      const exhaustive: never = phase;
      throw new Error(`template-library: unrecognised demo-element phase "${String(exhaustive)}" — no previewKind mapping`);
    }
  }
}

// ---------------------------------------------------------------------------
// D4 — flow-edge index + endpoint verification
// ---------------------------------------------------------------------------

type ResolvedEdge = { flowId: string; fromNode: FlowNode; toNode: FlowNode };

/** `resolved = node.agent ?? 'gate:' + node.id` (pinned by the ATs) — a gate
 *  node's OWN gate label (`node.gate`) never enters the resolved form; only
 *  its node id does. */
function resolveNodeLabel(node: FlowNode): string {
  return node.agent ?? `gate:${node.id}`;
}

/** A declared producer/consumer value matches a node if it equals the node's
 *  resolved label, OR — gate-endpoint tolerance — the node's bare id when the
 *  node carries no agent (a gate). Never "fixes" the frontmatter to invent an
 *  agent that does not exist. */
function nodeMatchesDeclared(node: FlowNode, declared: string): boolean {
  if (declared === resolveNodeLabel(node)) return true;
  return !node.agent && declared === node.id;
}

function buildFlowEdgeIndex(root: string): { scanned: number; byArtifact: Map<string, ResolvedEdge[]> } {
  const flowIds = listFlowIds(root);
  const byArtifact = new Map<string, ResolvedEdge[]>();
  for (const flowId of flowIds) {
    const flowYamlPath = join(root, 'studio', 'flows', flowId, 'flow.yaml');
    let flow: FlowDefinition;
    try {
      flow = loadFlowDefinition(flowYamlPath);
    } catch {
      continue; // malformed flow — already surfaced by the flow's own lint
    }
    const nodesById = new Map(flow.nodes.map((n) => [n.id, n] as const));
    for (const edge of flow.edges) {
      const fromNode = nodesById.get(edge.from);
      const toNode = nodesById.get(edge.to);
      if (!fromNode || !toNode) continue; // dangling edge — the flow's own lint concern
      if (!byArtifact.has(edge.artifact)) byArtifact.set(edge.artifact, []);
      byArtifact.get(edge.artifact)!.push({ flowId: flow.id, fromNode, toNode });
    }
  }
  return { scanned: flowIds.length, byArtifact };
}

function usedByLabelsFor(edges: readonly ResolvedEdge[]): string[] {
  const labels = edges.map((e) => `${e.flowId}:${resolveNodeLabel(e.fromNode)}${EDGE_ARROW}${resolveNodeLabel(e.toNode)}`);
  return [...new Set(labels)].sort((a, b) => a.localeCompare(b));
}

type EndpointVerification = { endpointsVerified: boolean; findings: Finding[] };

/** Returns `undefined` when nothing is declared (nothing to verify). Zero
 *  edges + a declaration ⇒ unverifiable (flag, not error) — the relationship
 *  travels by orchestrator-band re-entry, not a DAG edge.
 *
 *  One or more edges ⇒ the declaration must be grounded in AT LEAST ONE real
 *  edge. Deliberately `some`, not `every`: flows are user-authorable data, and
 *  a template's `producer:`/`consumer:` documents its CANONICAL contract in the
 *  OOTB flow — not a claim that no other flow may ever carry that artifact.
 *  An operator wiring `plan` between two agents of their own in a hand-authored
 *  flow is legitimate and must not fail lint. (Found by the `flows-author`
 *  ui:journey gate, which authors exactly such flows: `every` made
 *  `forge studio lint` error on every UI-authored flow that reused a stock
 *  artifact label.) The real defect this still catches is a declaration
 *  grounded in NO real edge at all — a producer/consumer naming something the
 *  flow graph never does. */
function verifyTemplateEndpoints(
  templateId: string,
  declaredProducer: string | undefined,
  declaredConsumer: string | undefined,
  edges: readonly ResolvedEdge[],
): EndpointVerification | undefined {
  if (declaredProducer === undefined && declaredConsumer === undefined) return undefined;

  if (edges.length === 0) {
    return {
      endpointsVerified: false,
      findings: [
        flag(
          `template:${templateId}`,
          CHECK_UNVERIFIABLE_ENDPOINTS,
          `Template "${templateId}" declares producer/consumer but carries zero flow edges — the relationship travels by orchestrator-band re-entry, not a DAG edge, so it cannot be cross-validated against the flow graph`,
        ),
      ],
    };
  }

  const groundedInSomeEdge = edges.some(
    (e) =>
      (declaredProducer === undefined || nodeMatchesDeclared(e.fromNode, declaredProducer)) &&
      (declaredConsumer === undefined || nodeMatchesDeclared(e.toNode, declaredConsumer)),
  );
  if (groundedInSomeEdge) return { endpointsVerified: true, findings: [] };
  return {
    endpointsVerified: false,
    findings: [
      err(
        `template:${templateId}`,
        CHECK_ENDPOINT_MISMATCH,
        `Template "${templateId}" declares a producer/consumer that no flow edge carrying it actually matches — every edge for this artifact contradicts the declaration; fix the frontmatter or the flow, and never invent an agent that does not exist`,
      ),
    ],
  };
}

// ---------------------------------------------------------------------------
// D3 — demo-output usage: real project `.forge/project.json` demoProcess scan
// ---------------------------------------------------------------------------

function discoverProjectsIn(root: string): DiscoveredProject[] {
  return discoverProjects(join(root, 'projects'), root);
}

/** Reads each discovered project's `.forge/project.json` (plain JSON, not
 *  gray-matter) tolerantly — a missing/unreadable/malformed file simply
 *  contributes no usage evidence; it is optional per-project data, not a
 *  defect in this module's own definitions. */
function buildDemoElementUsageMap(discovered: readonly DiscoveredProject[]): Map<string, Set<string>> {
  const usage = new Map<string, Set<string>>();
  for (const proj of discovered) {
    if (!proj.hasConfig) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(proj.absPath, '.forge', 'project.json'), 'utf8'));
    } catch {
      continue;
    }
    if (parsed === null || typeof parsed !== 'object') continue;
    const demoProcess = (parsed as Record<string, unknown>)['demoProcess'];
    if (!Array.isArray(demoProcess)) continue;
    for (const step of demoProcess) {
      if (step === null || typeof step !== 'object') continue;
      const elementId = (step as Record<string, unknown>)['element'];
      if (typeof elementId !== 'string' || elementId === '') continue;
      if (!usage.has(elementId)) usage.set(elementId, new Set());
      usage.get(elementId)!.add(proj.id);
    }
  }
  return usage;
}

function sortedUsageMap(usage: Map<string, Set<string>>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [id, ids] of usage) out.set(id, [...ids].sort((a, b) => a.localeCompare(b)));
  return out;
}

export function deriveArtifactTemplateUsage(forgeRoot: string): Map<string, string[]> {
  const { byArtifact } = buildFlowEdgeIndex(resolve(forgeRoot));
  const out = new Map<string, string[]>();
  for (const [id, edges] of byArtifact) out.set(id, usedByLabelsFor(edges));
  return out;
}

export function deriveDemoElementUsage(forgeRoot: string): Map<string, string[]> {
  const root = resolve(forgeRoot);
  return sortedUsageMap(buildDemoElementUsageMap(discoverProjectsIn(root)));
}

// ---------------------------------------------------------------------------
// Per-category entry builders — each reads its own directory and tolerates a
// per-file parse failure (D7): the malformed file surfaces with `error`, its
// well-formed siblings are unaffected.
// ---------------------------------------------------------------------------

function listPlanningEntries(root: string, flowIndex: { scanned: number; byArtifact: Map<string, ResolvedEdge[]> }): TemplateLibraryEntry[] {
  const dir = join(root, 'studio', 'artifact-templates');
  let files: string[];
  try {
    // README.md documents the directory (R3-06) — not a template definition,
    // excluded by name so it never surfaces as a phantom malformed entry.
    // Matched case-insensitively (a readme.md/Readme.md variant would
    // otherwise slip this check and, if it ever carried valid frontmatter,
    // become a phantom template) — mirrors the identical exclusion in
    // registry.ts's listArtifactTemplates; the two must stay identical.
    files = readdirSync(dir).filter((f) => f.endsWith('.md') && !/^readme\.md$/i.test(f));
  } catch {
    return [];
  }
  return files.map((file): TemplateLibraryEntry => {
    const mdPath = join(dir, file);
    const definitionRef = `${PLANNING_PROVENANCE}/${file}`;
    const usedByDerivation: TemplateUsedByDerivation = { source: PLANNING_USAGE_SOURCE, scanned: flowIndex.scanned };
    try {
      const t = loadArtifactTemplate(mdPath);
      const edges = flowIndex.byArtifact.get(t.id) ?? [];
      const verification = verifyTemplateEndpoints(t.id, t.producer, t.consumer, edges);
      return {
        id: t.id,
        name: t.name,
        category: 'planning',
        format: t.kind,
        provenance: PLANNING_PROVENANCE,
        definitionRef,
        previewKind: planningPreviewKind(t.kind),
        usedBy: usedByLabelsFor(edges),
        usedByDerivation,
        ...(verification !== undefined ? { endpointsVerified: verification.endpointsVerified } : {}),
        ...(t.producer !== undefined ? { declaredProducer: t.producer } : {}),
        ...(t.consumer !== undefined ? { declaredConsumer: t.consumer } : {}),
      };
    } catch (e) {
      return {
        id: basename(file, '.md'),
        name: basename(file, '.md'),
        category: 'planning',
        provenance: PLANNING_PROVENANCE,
        definitionRef,
        usedBy: [],
        usedByDerivation,
        error: `cannot parse "${mdPath}" — ${(e as Error).message}`,
      };
    }
  });
}

function listDemoOutputEntries(root: string, demoUsage: Map<string, Set<string>>, scanned: number): TemplateLibraryEntry[] {
  const dir = join(root, 'studio', 'demo-elements');
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
  const usage = sortedUsageMap(demoUsage);
  return files.map((file): TemplateLibraryEntry => {
    const mdPath = join(dir, file);
    const definitionRef = `${DEMO_OUTPUT_PROVENANCE}/${file}`;
    const usedByDerivation: TemplateUsedByDerivation = { source: DEMO_OUTPUT_USAGE_SOURCE, scanned };
    try {
      const t = loadDemoElement(mdPath);
      return {
        id: t.id,
        name: t.name,
        category: 'demo-output',
        format: t.phase,
        provenance: DEMO_OUTPUT_PROVENANCE,
        definitionRef,
        previewKind: demoOutputPreviewKind(t.phase),
        usedBy: usage.get(t.id) ?? [],
        usedByDerivation,
        description: t.description,
      };
    } catch (e) {
      return {
        id: basename(file, '.md'),
        name: basename(file, '.md'),
        category: 'demo-output',
        provenance: DEMO_OUTPUT_PROVENANCE,
        definitionRef,
        usedBy: [],
        usedByDerivation,
        error: `cannot parse "${mdPath}" — ${(e as Error).message}`,
      };
    }
  });
}

function listScaffoldEntries(root: string, discoveredProjectCount: number): TemplateLibraryEntry[] {
  const usedByDerivation: TemplateUsedByDerivation = { source: SCAFFOLD_USAGE_SOURCE, scanned: discoveredProjectCount };
  return listProjectStarters(root).map(
    (id): TemplateLibraryEntry => ({
      id,
      name: id,
      category: 'project-scaffold',
      format: SCAFFOLD_FORMAT,
      provenance: SCAFFOLD_PROVENANCE,
      definitionRef: `${SCAFFOLD_PROVENANCE}/${id}`,
      previewKind: 'scaffold',
      usedBy: [],
      usedByDerivation,
    }),
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function listTemplateLibrary(forgeRoot: string): TemplateLibraryEntry[] {
  const root = resolve(forgeRoot);
  const flowIndex = buildFlowEdgeIndex(root);
  const discovered = discoverProjectsIn(root);
  const demoUsage = buildDemoElementUsageMap(discovered);

  const entries: TemplateLibraryEntry[] = [
    ...listPlanningEntries(root, flowIndex),
    ...listDemoOutputEntries(root, demoUsage, discovered.length),
    ...listScaffoldEntries(root, discovered.length),
  ];

  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

/** Reads the whole file tree under a scaffold dir, sorted lexicographically by
 *  POSIX-separated path (AT-7) — mirrors readSkillPackage's walk (skill-library.ts)
 *  minus its SKILL.md-first ordering, which has no analogue for a scaffold. */
function readScaffoldFiles(absDir: string): PackageFile[] {
  const out: PackageFile[] = [];
  const walk = (dir: string, relDir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, rel);
      else if (entry.isFile()) out.push({ path: rel, body: readFileSync(abs, 'utf8') });
    }
  };
  walk(absDir, '');
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function templateDetail(forgeRoot: string, id: string): TemplateDetail | null {
  const root = resolve(forgeRoot);
  const entry = listTemplateLibrary(root).find((e) => e.id === id);
  if (!entry) return null;

  if (entry.category === 'project-scaffold') {
    const files = readScaffoldFiles(join(root, 'studio', 'starters', 'projects', id));
    return { ...entry, files };
  }

  const absPath = join(root, entry.definitionRef);
  const body = readFileSync(absPath, 'utf8');
  return { ...entry, files: [{ path: basename(entry.definitionRef), body }] };
}

// ---------------------------------------------------------------------------
// Lint — the call site is wired in cli/studio-lint.ts (landed in commit a15f7f23)
// ---------------------------------------------------------------------------

/** D2 — any directory under studio/starters/ that is neither the `projects`
 *  category source nor on the git-tracked exclusion list fails lint. A
 *  non-directory entry (README.md, project.json.example, ...) is not subject
 *  to this rule at all. */
function lintStartersGap(root: string): Finding[] {
  const startersDir = join(root, 'studio', 'starters');
  let entries: string[];
  try {
    entries = readdirSync(startersDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  const excluded = new Set(STARTERS_NON_TEMPLATE_DIRS.map((e) => e.dir));
  return entries
    .filter((name) => name !== 'projects' && !excluded.has(name))
    .map((name) =>
      err(
        `starters:${name}`,
        CHECK_STARTERS_GAP,
        `studio/starters/${name}/ is neither mapped to a template-library category nor listed in STARTERS_NON_TEMPLATE_DIRS — decide where it belongs (a new category, or add it to the exclusion list with a reason) before this can lint clean`,
      ),
    );
}

function lintDuplicateIds(entries: readonly TemplateLibraryEntry[]): Finding[] {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.id, (counts.get(e.id) ?? 0) + 1);
  const findings: Finding[] = [];
  for (const [id, count] of counts) {
    if (count > 1) {
      findings.push(
        err(`template:${id}`, CHECK_DUPLICATE_ID, `Template id "${id}" is used by ${count} entries across categories — ids must be unique across the whole template library`),
      );
    }
  }
  return findings;
}

/** Re-derives the same producer/consumer verification `listTemplateLibrary`
 *  computes per planning entry, but keeps the findings (not just the boolean)
 *  this time — the two call sites intentionally share `verifyTemplateEndpoints`
 *  so the entry's `endpointsVerified` and the lint findings can never drift. */
function lintEndpointVerification(root: string, flowIndex: { byArtifact: Map<string, ResolvedEdge[]> }): Finding[] {
  const dir = join(root, 'studio', 'artifact-templates');
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
  const findings: Finding[] = [];
  for (const file of files) {
    let t: { id: string; producer?: string; consumer?: string };
    try {
      t = loadArtifactTemplate(join(dir, file));
    } catch {
      continue; // malformed — already surfaced on the entry itself (D7)
    }
    const verification = verifyTemplateEndpoints(t.id, t.producer, t.consumer, flowIndex.byArtifact.get(t.id) ?? []);
    if (verification) findings.push(...verification.findings);
  }
  return findings;
}

export function lintTemplateLibrary(forgeRoot: string): Finding[] {
  const root = resolve(forgeRoot);
  const entries = listTemplateLibrary(root);
  const flowIndex = buildFlowEdgeIndex(root);

  return [...lintStartersGap(root), ...lintDuplicateIds(entries), ...lintEndpointVerification(root, flowIndex)];
}
