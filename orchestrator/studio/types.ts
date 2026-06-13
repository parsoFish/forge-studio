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
  subagentModel?: string;
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

export type KbDescriptor = {
  id: string;
  name: string;
  scope: KbScope;
  desc: string;
  path: string;
};

export type CatalogSdk = { id: string; name: string; available: boolean };
export type CatalogModel = { id: string; name: string; sdk: string; tier: string };
export type CatalogEntry = { id: string; name: string; desc?: string };

export type Catalog = {
  sdks: CatalogSdk[];
  models: CatalogModel[];
  tools: CatalogEntry[];
  mcps: CatalogEntry[];
  hooks: CatalogEntry[];
  path: string;
};

export type ProjectRef = { id: string; path: string };
export type ProjectsRegistry = { projects: ProjectRef[]; path: string };
