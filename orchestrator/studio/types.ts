/** Forge Studio object model (ADR 027). Pure types — no logic. */

export type BrainAccess = 'mandatory' | 'advisory' | 'none';
export type ModelStrategy = 'fixed' | 'range';

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
  /**
   * Dev-loop strategy (A7) — how the agent iterates: 'ralph' (the default
   * write→test→review loop) or 'one-shot' (a single pass). Authored here as the
   * single source; the orchestrator honours it at spawn (one-shot caps to a
   * single iteration). Absent ⇒ 'ralph' (unchanged behaviour).
   */
  loopStrategy?: string;
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
  /** Studio-roster / palette visibility (R3-01-F2); explicit on every shipped skill. */
  library?: boolean;
  phase?: string;
  surface?: string;
  /**
   * Declared flow-engine executor kind (R2-01-F2). One of the four legacy
   * phase-executor slugs ('pm' | 'dev' | 'unifier' | 'reflect') — the
   * DECLARED replacement for flow-runner's old hardcoded AGENT_KIND table.
   * Absent ⇒ a generic library agent, resolved through the F1 execAgent
   * path instead of a phase-specific executor.
   */
  executor?: string;
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

// Stage C — per-flow kickoff. Declares which launch surface the UI renders for a
// flow: `idea` (free-text idea → architect), `initiative-select` (pick a planned
// initiative → develop), `trigger-only` (no manual launch — fired by a declared
// FlowTrigger, e.g. reflect on merge). Optional: absent ⇒ the generic launcher.
export const FLOW_KICKOFF_KINDS = ['idea', 'initiative-select', 'trigger-only'] as const;
export type FlowKickoffKind = (typeof FLOW_KICKOFF_KINDS)[number];
export type FlowKickoff = { kind: FlowKickoffKind };

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
  kickoff?: FlowKickoff;
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

/**
 * Valid KB storage backends (ADR-018 amendment — backend-selection seam).
 * Filesystem is the only implementation today; the seam is preserved for a
 * future graph-memory backend (an earlier Zep attempt was removed).
 */
export const KB_BACKENDS = ['filesystem'] as const;
export type KbBackendId = (typeof KB_BACKENDS)[number];

/**
 * KB binding (R1-01 amendment) — replaces the old loose `scope` enum. A KB
 * binds to exactly one owning identity: a specific flow, a specific project,
 * or the single forge-dev "unique" KB (Brain 1). `flow`/`project` bindings
 * carry a `ref` naming the bound flow id / project id; `unique` carries none.
 */
export type KbBindingKind = 'flow' | 'project' | 'unique';
export const KB_BINDING_KINDS: readonly KbBindingKind[] = ['flow', 'project', 'unique'];
export type KbBinding =
  | { kind: 'flow'; ref: string }
  | { kind: 'project'; ref: string }
  | { kind: 'unique' };

/** A KB process obligation is either a named forge builtin or a shell command. */
export type KbProcessImpl = { builtin: string } | { cmd: string };

export const KB_READ_SURFACES = ['navigation-index', 'search'] as const;
export type KbReadSurface = (typeof KB_READ_SURFACES)[number];
export const KB_READER_ROLES = ['planner', 'reflector', 'dev-loop', 'reviewer'] as const;
export type KbReaderRole = (typeof KB_READER_ROLES)[number];
export type KbUsagePolicy = { readSurface: KbReadSurface; readers: KbReaderRole[] };

/**
 * The four-obligation KB process contract (R1-01): how the KB is linted,
 * ingested, consolidated, and who is allowed to read it and how. Optional on
 * `KbDescriptor` as a whole — a lean descriptor resolves every obligation to
 * a repo-wide default via `resolveKbProcesses`.
 */
export type KbProcesses = {
  lint: KbProcessImpl;
  ingest: KbProcessImpl;
  consolidate: KbProcessImpl;
  usage: KbUsagePolicy;
};

export type KbDescriptor = {
  id: string;
  name: string;
  binding: KbBinding;
  desc: string;
  processes?: KbProcesses;
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
/**
 * One step of a project's demo process. `kind` is the coarse phase (capture /
 * verify / present). `element`, when present, names a **demo-element kind** from
 * the forge demo-element library (`studio/demo-elements/<id>.md`): the demo then
 * composes the project-side element-skills in this order. `text` is the operator's
 * per-instance config (e.g. the command to run). A step without `element` is a
 * legacy free-text step.
 */
export type DemoStep = { kind: DemoStepKind; text: string; element?: string };

/**
 * A demo-element definition — one entry in the forge-side library
 * (`studio/demo-elements/<id>.md`). It is a **skill-creating skill**: its `body`
 * instructs the demo-builder how to author a project-specific element-skill (under
 * `.forge/skills/demo/<id>/`) that renders this element's HTML fragment from real
 * project output. The library grows as operators add element kinds over time.
 */
export type DemoElementDefinition = {
  id: string;
  name: string;
  /** The demo phase this element belongs to (drives the preflight DEMO clause). */
  phase: DemoStepKind;
  description: string;
  /** What per-instance config the operator provides (shown in the picker). */
  configHint: string;
  /** The generator prompt — how to author + render this element for a project. */
  body: string;
  path: string;
};

/**
 * Release-process step kinds. Tagging a release (git tag) and publishing
 * (npm/registry push) are CI's job — NOT forge step kinds. Forge's release
 * steps cover the repo-side prep a cycle performs before merge: refreshing
 * docs, writing a changelog entry, bumping a version file.
 */
export const RELEASE_STEP_KINDS = ['docs', 'changelog', 'version'] as const;
export type ReleaseStepKind = (typeof RELEASE_STEP_KINDS)[number];

/**
 * When a release step runs relative to the cycle: `in-cycle` (during the
 * dev-loop, alongside feature work) or `pre-merge` (after the dev-loop, before
 * the unifier opens the PR).
 */
export const RELEASE_STEP_PHASES = ['in-cycle', 'pre-merge'] as const;
export type ReleaseStepPhase = (typeof RELEASE_STEP_PHASES)[number];

export type ReleaseStep = {
  kind: ReleaseStepKind;
  phase: ReleaseStepPhase;
  text: string;
  /** Optional argv-style command forge runs to perform the step. */
  command?: string[];
};

export type ReleaseConfig = {
  steps: ReleaseStep[];
  /** Worktree-relative path to the file holding the project version. */
  versionFile?: string;
  /** Worktree-relative path to the changelog file. */
  changelogPath?: string;
  /** Worktree-relative directory holding the project's docs. */
  docsDir?: string;
};

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

// ProjectRef is the shape shared by disk-discovery (DiscoveredProject extends
// it). Projects are auto-discovered from `<projectsDir>/*` (B1) — there is no
// longer a `studio/projects.yaml` registry file.
export type ProjectRef = { id: string; path: string };
