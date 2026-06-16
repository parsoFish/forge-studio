/** Forge Studio object model (ADR 027). Pure types — no logic. */

export type BrainAccess = 'mandatory' | 'advisory' | 'none';
export type ModelStrategy = 'fixed' | 'range';
export type KbScope = 'project' | 'flow' | 'agent-integration';

export type AgentComposition = {
  skills: string[];
  tools: string[];
  mcps: string[];
  hooks: string[];
};

export type AgentRuntime = {
  sdk: string;
  strategy: ModelStrategy;
  model?: string;
  range?: string[];
  // NOTE: a `subagentModel` lever was removed (ADR-027) — it had no spawn-site
  // consumer (forge does not yet spawn SDK subagents). Reintroduce it together
  // with the first flow whose agent actually sub-spawns.
};

export type AgentBudgets = {
  iterationFloor?: number;
  iterationCap?: number;
  maxTurnsPerIteration?: number;
  wedgeKillMs?: number;
};

/** An agent IS a skill directory; this is the parsed view of its SKILL.md. */
export type AgentDefinition = {
  slug: string; // skill directory name
  name: string;
  description: string;
  phase?: string;
  surface?: string;
  purpose: string;
  composition: AgentComposition;
  runtime: AgentRuntime;
  brainAccess: BrainAccess;
  interactivity: string;
  budgets: AgentBudgets;
  allowedTools: string[]; // frontmatter `allowed-tools`
  disallowedTools: string[]; // frontmatter `disallowed-tools`
  body: string; // markdown process intent
  path: string; // absolute SKILL.md path
};

export type FlowNode = {
  id: string;
  agent?: string; // agent slug; optional iff gate present (gate-only node)
  gate?: string; // human gate id
  fanOut?: string; // upstream artifact name driving runtime multiplicity
  resumable?: boolean;
  // Canvas layout (ADR-033 / J3). Persisted so a hand-arranged flow survives a
  // reload; absent ⇒ the builder autolayouts (Kahn). Pure presentation — the
  // flow engine ignores them.
  x?: number;
  y?: number;
};

export type FlowEdge = { from: string; to: string; artifact: string };
export type FlowTrigger = { on: string; flow: string };

export type FlowDefinition = {
  id: string;
  name: string;
  version: number;
  goal: string;
  project: string | null;
  kb: string | null;
  costCeilingUsd: number;
  origin: string;
  disposable?: boolean;
  nodes: FlowNode[];
  edges: FlowEdge[];
  triggers: FlowTrigger[];
  path: string;
};

/** Artifact template kinds (ADR-027 amendment 2026-06-15). */
export const ARTIFACT_KINDS = ['file', 'git-state'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** The contract an inter-node artifact must satisfy. All fields optional. */
export type ArtifactTemplateSchema = {
  requiredFiles?: string[]; // files the producing node must write
  requiredFields?: string[]; // frontmatter fields each item must carry
  gitInvariants?: string[]; // for kind: git-state (e.g. commitsAhead>0)
};

/**
 * A typed contract for an inter-node artifact (the label on FlowEdge.artifact),
 * stored as studio/artifact-templates/<id>.md. Reference data — the flow engine
 * may assert it at a node boundary; lint checks every edge label resolves to one.
 */
export type ArtifactTemplate = {
  id: string; // matches the edge artifact label
  name: string;
  kind: ArtifactKind;
  producer?: string; // agent/node slug that produces it
  consumer?: string; // agent/node slug that consumes it
  schema: ArtifactTemplateSchema;
  body: string; // prose contract
  path: string;
};

/** Valid KB storage backends (ADR-018 amendment — backend-selection seam). */
export const KB_BACKENDS = ['filesystem', 'zep'] as const;
export type KbBackendId = (typeof KB_BACKENDS)[number];

export type KbDescriptor = {
  id: string;
  name: string;
  scope: KbScope;
  desc: string;
  /** Storage backend; absent ⇒ filesystem (the historical default). */
  backend?: string;
  path: string;
};

export type CatalogSdk = { id: string; name: string; available: boolean };
export type CatalogModel = { id: string; name: string; sdk: string; tier: string; costIn?: number; costOut?: number };
export type CatalogEntry = { id: string; name: string; desc?: string };

/**
 * A curated, proven community skill forge showcases in its OOTB library (like the
 * community skill-directory sites). Reference metadata only — `source` points at the
 * upstream; `composedBy` names the forge agent slugs that compose it; `tier` is the
 * recommended model tier. Hand-edited in studio/catalog.yaml (ADR-027 §5).
 */
export type CommunitySkill = {
  id: string; // slug
  name: string;
  provenance: string; // upstream owner/repo, e.g. "obra/superpowers"
  source: string; // upstream URL
  category: string; // coding | review | testing | research | planning | memory | docs | git
  tier?: string; // recommended model tier (haiku | sonnet | opus)
  composedBy?: string[]; // forge agent slugs that compose this skill
  stars?: string; // adoption signal, free-form (e.g. "228k")
  desc?: string;
};

export const DEMO_STEP_KINDS = ['capture', 'verify', 'present'] as const;
export type DemoStepKind = (typeof DEMO_STEP_KINDS)[number];
export type DemoStep = { kind: DemoStepKind; text: string };

export type ProjectDefinition = {
  id: string;
  name: string;
  northStar: string;
  instructions: string;
  demoProcess: DemoStep[];
  skills: string[];
  kb: string | null;
};

export type Catalog = {
  sdks: CatalogSdk[];
  models: CatalogModel[];
  tools: CatalogEntry[];
  mcps: CatalogEntry[];
  hooks: CatalogEntry[];
  communitySkills?: CommunitySkill[];
  path: string;
};

export type ProjectRef = { id: string; path: string };
export type ProjectsRegistry = { projects: ProjectRef[]; path: string };
