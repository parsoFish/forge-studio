# Forge Studio M0 — Definitions as Data: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The four Studio object schemas (Agent/Flow/KB/Catalog + projects registry) exist as validated filesystem definitions describing today's forge exactly; a no-drift derivation test locks SKILL.md frontmatter to the hardcoded `PhaseAgentSpec`s; `forge studio lint` joins the gate set. Zero hot-path behaviour change.

**Architecture:** New `orchestrator/studio/` module (types → registry → validate → derive), seed data under `studio/` + SKILL.md frontmatter + `brain/*/kb.yaml`, CLI subcommand in the existing hand-rolled switch. gray-matter for markdown frontmatter (existing dep), js-yaml for pure-YAML files (new explicit dep, sanctioned by ADR-027).

**Tech Stack:** TypeScript ESM (`--experimental-strip-types`), `node:test`, gray-matter ^4, js-yaml ^4. No build step for tests; `npm run build` is `tsc --noEmit` typecheck.

**Ground-truth facts the implementer must NOT re-derive (verified 2026-06-13):**

- `PhaseAgentSpec` = `{ phase, skill, tier, allowedTools, disallowedTools }` at `orchestrator/phase-agent.ts:33-47`; `MODEL_BY_TIER` = haiku→`claude-haiku-4-5-20251001`, sonnet→`claude-sonnet-4-6`, opus→`claude-opus-4-8` (`phase-agent.ts:21-31`).
- Hardcoded specs: `pmAgentSpec` (`pm-invocation.ts:35`), `devAgentSpec` (`dev-invocation.ts:56`), `unifierAgentSpec` (`unifier-invocation.ts:61`), `reflectorAgentSpec` (`reflector-invocation.ts:51`). All tier `sonnet`. Tool lists: PM allowed `[Read, Grep, Glob, Write, Edit]` / disallowed `[Bash, NotebookEdit, WebFetch, WebSearch]`; dev+unifier allowed `[Read, Write, Edit, MultiEdit, Bash, Grep, Glob]` / disallowed `[NotebookEdit, WebFetch, WebSearch]`; reflector allowed `[Read, Grep, Glob, Write, Edit, Bash]` / disallowed `[NotebookEdit, WebFetch, WebSearch]`.
- Spec `phase` values: `project-manager`, `developer-loop`, `unifier`, `reflector`. SKILL.md frontmatter today: pm has `phase: project-manager` ✓, developer-ralph `phase: developer-loop` ✓, **unifier has no `phase` field** (add `phase: unifier`), **reflector has `phase: reflection`** (change to `phase: reflector`). Nothing parses SKILL.md frontmatter at runtime today (verified: zero gray-matter usage on SKILL.md), so these edits are safe; SKILL.md raw text IS injected into system prompts, so frontmatter additions slightly change prompt text — accepted deviation, noted in work-items.md.
- Only 5 agent skills exist: `skills/architect`, `skills/project-manager`, `skills/developer-ralph`, `skills/developer-unifier`, `skills/reflector`. No reviewer skill — review is a human gate. **Flow schema must allow gate-only nodes.**
- `UNIFIER_DEFAULT_ITERATION_CAP = 15` (`unifier-invocation.ts:85`). Dev iteration/cost budgets are per-manifest runtime inputs — no fixed default; leave `budgets: {}` for dev.
- Serializer precedent: `serializeManifest` (`orchestrator/manifest.ts:210`) uses `matter.stringify(body, data)`. Follow it.
- Tests: `npm test` = `node --test --experimental-strip-types <globs>`; ESM imports with `.ts` extension (`import { x } from './manifest.ts'`). **`orchestrator/studio/*.test.ts` must be added to the npm test glob.**
- CLI: hand-rolled switch in `orchestrator/cli.ts` (top-level `case 'brain':` at ~line 65, `cmdBrain` at ~line 939). Mirror that pattern for `studio`. Lint handler lives in `cli/` (`cli/brain-lint.ts` precedent), exits non-zero on errors.
- Mock readiness checks (agent-builder.html `renderReadiness`): `purpose`, `skill` (≥1 composed skill), `hook` (≥1 hook), `process` (non-empty body), `interactivity`, `runtime` (sdk + model-or-range). 6 total.

**File map:**

| File | Responsibility |
|---|---|
| Create `orchestrator/studio/types.ts` | All definition types, no logic |
| Create `orchestrator/studio/registry.ts` | Load/serialize every definition kind (the one canonical writer) |
| Create `orchestrator/studio/validate.ts` | Readiness/structural/integrity checks → `Finding[]` |
| Create `orchestrator/studio/derive.ts` | SKILL.md frontmatter → `PhaseAgentSpec` |
| Create `orchestrator/studio/{registry,validate,derive}.test.ts` | TDD suites |
| Create `cli/studio-lint.ts` + modify `orchestrator/cli.ts` | `forge studio lint` |
| Modify 5 `skills/*/SKILL.md` | Studio frontmatter (exact blocks below) |
| Create `studio/flows/forge-cycle/flow.yaml`, `studio/catalog.yaml`, `studio/projects.yaml`, `brain/forge-dev/kb.yaml`, `brain/cycles/kb.yaml` | Seed data |
| Modify `package.json` | js-yaml dep + test glob |

---

### Task 1: Types + registry (loaders/serializers)

**Files:**
- Create: `orchestrator/studio/types.ts`
- Create: `orchestrator/studio/registry.ts`
- Test: `orchestrator/studio/registry.test.ts`
- Modify: `package.json` (deps + test glob)

- [ ] **Step 1: Install dep + extend test glob**

```bash
npm install js-yaml && npm install -D @types/js-yaml
```

In `package.json`, append ` orchestrator/studio/*.test.ts` to the `test` script's file list (keep existing globs untouched).

- [ ] **Step 2: Write `orchestrator/studio/types.ts`** (types only — write first, both test and impl import it)

```typescript
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
```

- [ ] **Step 3: Write failing tests** `orchestrator/studio/registry.test.ts`

Use `node:test` + `node:assert/strict`, tmp dirs via `fs.mkdtempSync(path.join(os.tmpdir(), 'studio-'))`. Cover:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadAgentDefinition, serializeAgentDefinition, isStudioAgent,
  loadFlowDefinition, serializeFlowDefinition,
  loadKbDescriptor, loadCatalog, loadProjectsRegistry, listAgentDefinitions,
} from './registry.ts';

const AGENT_MD = `---
name: tester
description: A test agent.
phase: tester
purpose: Test things.
composition:
  skills: [demo]
  tools: []
  mcps: []
  hooks: [event-log]
runtime:
  sdk: claude
  strategy: fixed
  model: claude-sonnet-4-6
brainAccess: none
interactivity: Fully autonomous.
allowed-tools: [Read, Grep]
disallowed-tools: [Bash]
budgets:
  iterationCap: 15
---

Process body here.
`;

test('loadAgentDefinition parses studio frontmatter', () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-'));
  mkdirSync(join(dir, 'tester'));
  writeFileSync(join(dir, 'tester', 'SKILL.md'), AGENT_MD);
  const def = loadAgentDefinition(join(dir, 'tester', 'SKILL.md'));
  assert.equal(def.slug, 'tester');
  assert.equal(def.phase, 'tester');
  assert.deepEqual(def.allowedTools, ['Read', 'Grep']);
  assert.deepEqual(def.composition.hooks, ['event-log']);
  assert.equal(def.runtime.model, 'claude-sonnet-4-6');
  assert.equal(def.budgets.iterationCap, 15);
  assert.match(def.body, /Process body/);
});

test('serializeAgentDefinition round-trips losslessly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-'));
  mkdirSync(join(dir, 'tester'));
  const p = join(dir, 'tester', 'SKILL.md');
  writeFileSync(p, AGENT_MD);
  const def = loadAgentDefinition(p);
  writeFileSync(p, serializeAgentDefinition(def));
  const again = loadAgentDefinition(p);
  assert.deepEqual({ ...again, path: '' }, { ...def, path: '' });
});

test('isStudioAgent false for legacy frontmatter (no runtime block)', () => { /* write SKILL.md without runtime; assert false */ });
test('loadFlowDefinition parses nodes/edges/triggers; gate-only node allowed', () => { /* FLOW_YAML fixture mirroring forge-cycle shape incl. { id: review, gate: verdict } */ });
test('serializeFlowDefinition round-trips', () => { /* load → serialize → load → deepEqual sans path */ });
test('loadKbDescriptor parses scope enum', () => { /* kb.yaml fixture */ });
test('loadCatalog parses all five sections', () => { /* catalog fixture */ });
test('loadProjectsRegistry parses id→path list', () => { /* projects.yaml fixture */ });
test('loaders throw with file path in message on malformed YAML', () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-'));
  const p = join(dir, 'flow.yaml');
  writeFileSync(p, '{ not yaml: [');
  assert.throws(() => loadFlowDefinition(p), (e: Error) => e.message.includes(p));
});
```

Write the elided fixtures/tests in full (no placeholders in the actual file): flow fixture = the forge-cycle shape from Task 4 Step 2; kb/catalog/projects fixtures = the seed shapes from Task 4.

- [ ] **Step 4: Run tests, verify they fail** — `npm test 2>&1 | grep -A2 studio` → expect `Cannot find module './registry.ts'`.

- [ ] **Step 5: Implement `orchestrator/studio/registry.ts`**

Skeleton (implement fully; every loader validates required fields exist and throws `new Error(\`<file>: <what is wrong>\`)` — fail fast at the boundary, never return partials):

```typescript
import matter from 'gray-matter';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type {
  AgentDefinition, Catalog, FlowDefinition, KbDescriptor, ProjectsRegistry,
} from './types.ts';

/* helpers: str(data, key, file, required), strArr(...), num(...) — typed
   extraction with explicit errors, modelled on manifest.ts field readers. */

export function isStudioAgent(skillMdPath: string): boolean {
  // gray-matter parse; true iff frontmatter has a `runtime` object
}

export function loadAgentDefinition(skillMdPath: string): AgentDefinition {
  // matter(readFileSync(...)); slug = basename(dirname(skillMdPath));
  // map frontmatter keys: brainAccess, interactivity, purpose, composition.{skills,tools,mcps,hooks}
  // (each defaulting to [] when composition present but key absent — but composition itself required),
  // runtime.{sdk,strategy,model?,range?,subagentModel?}, budgets (default {}),
  // 'allowed-tools' → allowedTools (default []), 'disallowed-tools' → disallowedTools (default []),
  // body = parsed.content
}

export function serializeAgentDefinition(def: AgentDefinition): string {
  // build data record in FIXED key order: name, description, phase?, surface?,
  // purpose, composition, runtime, brainAccess, interactivity,
  // 'allowed-tools', 'disallowed-tools', budgets — omit undefined; then
  // matter.stringify('\n' + def.body.replace(/^\n+/, ''), data)  // serializeManifest pattern
}

export function listAgentDefinitions(skillsDir: string): AgentDefinition[] {
  // readdirSync; for each <dir>/SKILL.md where isStudioAgent → loadAgentDefinition; sorted by slug
}

export function loadFlowDefinition(flowYamlPath: string): FlowDefinition { /* yamlLoad with try/catch rethrow incl. path; required: id,name,version,goal,costCeilingUsd,origin,nodes,edges; project/kb default null; triggers default [] */ }
export function serializeFlowDefinition(def: FlowDefinition): string { /* yamlDump of fixed-order plain object (strip path); lineWidth: 100 */ }
export function loadKbDescriptor(kbYamlPath: string): KbDescriptor { /* id,name,scope,desc required */ }
export function loadCatalog(catalogYamlPath: string): Catalog { /* five sections, each defaulting [] */ }
export function loadProjectsRegistry(projectsYamlPath: string): ProjectsRegistry { /* projects: [{id,path}] */ }
```

- [ ] **Step 6: Run tests, verify pass** — `npm test` → studio suite green, full suite still green.
- [ ] **Step 7: Typecheck** — `npm run build` → clean.
- [ ] **Step 8: Commit**

```bash
git add orchestrator/studio/ package.json package-lock.json
git commit -m "feat(studio): object-model types + filesystem registry (ADR-027 M0)"
```

---

### Task 2: Validation

**Files:**
- Create: `orchestrator/studio/validate.ts`
- Test: `orchestrator/studio/validate.test.ts`

- [ ] **Step 1: Write failing tests** covering, one test each (build fixtures inline as plain objects of the Task 1 types):
  - agent: missing `purpose` → error `readiness/purpose`; empty `composition.skills` → **flag** `readiness/skill`; empty hooks → flag `readiness/hook`; empty body → error `readiness/process`; empty interactivity → error `readiness/interactivity`; `strategy: fixed` without model → error `readiness/runtime`; `strategy: range` with non-empty range → no runtime finding; bad slug (`My_Agent`) → error `slug`.
  - flow: duplicate node ids → error; node with neither `agent` nor `gate` → error; gate-only node → **no** error; `agent` slug not in provided agent map → error; edge referencing unknown node → error; cycle (a→b→a) → error `acyclic`; `fanOut: work-items` with no inbound edge carrying artifact `work-items` → error; matching inbound edge → pass; zero nodes with `gate` and `disposable` absent → error `zero-gate`; same flow with `disposable: true` → no zero-gate error; `version: 0` → error.
  - kb: bad scope → error; good → none.
  - catalog: model with `sdk: nope` not among sdks → error; duplicate ids within a section → error.
  - projects registry: duplicate id → error; bad slug → error.

API shape the tests assert:

```typescript
export type Finding = {
  level: 'error' | 'flag';
  object: string; // e.g. 'agent:developer-ralph', 'flow:forge-cycle'
  check: string;  // e.g. 'readiness/purpose', 'acyclic', 'zero-gate'
  message: string;
};
export const SLUG_RE = /^[a-z][a-z0-9-]*$/;
export function validateAgent(def: AgentDefinition): Finding[];
export function validateFlow(flow: FlowDefinition, agents: ReadonlyMap<string, AgentDefinition>): Finding[];
export function validateKb(kb: KbDescriptor): Finding[];
export function validateCatalog(c: Catalog): Finding[];
export function validateProjectsRegistry(r: ProjectsRegistry): Finding[];
```

- [ ] **Step 2: Run tests, verify fail** (module not found).
- [ ] **Step 3: Implement `validate.ts`.** Readiness mapping (mock parity, 6 checks): `purpose`/`process`(body)/`interactivity`/`runtime` empty → **error**; `skill`/`hook` empty → **flag** (seed agents like pm legitimately compose few sub-skills; mock renders readiness progressively, it is not a save-blocker for those two). Acyclicity via Kahn's algorithm over node ids. fanOut rule: `node.fanOut` must equal `artifact` of ≥1 edge whose `to` is that node.
- [ ] **Step 4: Run tests, verify pass.** `npm run build` clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(studio): definition validation (readiness, flow structure, kb scope, catalog integrity)"`

---

### Task 3: Seed agent frontmatter + spec derivation (the no-drift lock)

**Files:**
- Modify: `skills/architect/SKILL.md`, `skills/project-manager/SKILL.md`, `skills/developer-ralph/SKILL.md`, `skills/developer-unifier/SKILL.md`, `skills/reflector/SKILL.md` (frontmatter only — bodies untouched)
- Create: `orchestrator/studio/derive.ts`
- Test: `orchestrator/studio/derive.test.ts`

- [ ] **Step 1: Write failing derivation test**

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveAgentSpec } from './derive.ts';
import { pmAgentSpec } from '../pm-invocation.ts';
import { devAgentSpec } from '../dev-invocation.ts';
import { unifierAgentSpec } from '../unifier-invocation.ts';
import { reflectorAgentSpec } from '../reflector-invocation.ts';

const CASES = [
  ['skills/project-manager/SKILL.md', pmAgentSpec],
  ['skills/developer-ralph/SKILL.md', devAgentSpec],
  ['skills/developer-unifier/SKILL.md', unifierAgentSpec],
  ['skills/reflector/SKILL.md', reflectorAgentSpec],
] as const;

for (const [skill, hardcoded] of CASES) {
  test(`derived spec deep-equals hardcoded: ${hardcoded.phase}`, () => {
    // No-drift lock (roadmap M0 ws-4): until M2 flips invocation files to
    // single-source, any change to either side must update both.
    assert.deepEqual(deriveAgentSpec(skill), { ...hardcoded, allowedTools: [...hardcoded.allowedTools], disallowedTools: [...hardcoded.disallowedTools] });
  });
}
```

(Imports of invocation modules must not spawn anything — they export const specs; verify by reading the module tops. Resolve `skill` paths relative to the forge root: `new URL('../../', import.meta.url)` or `process.cwd()` — match how other orchestrator tests resolve repo paths; check `orchestrator/manifest.test.ts` for the precedent and copy it.)

- [ ] **Step 2: Run, verify fail** (derive.ts missing).
- [ ] **Step 3: Implement `orchestrator/studio/derive.ts`**

```typescript
import { MODEL_BY_TIER, type ModelTier, type PhaseAgentSpec } from '../phase-agent.ts';
import { loadAgentDefinition } from './registry.ts';
import { resolve } from 'node:path';

const TIER_BY_MODEL: Record<string, ModelTier> = Object.fromEntries(
  (Object.entries(MODEL_BY_TIER) as [ModelTier, string][]).map(([t, m]) => [m, t]),
);

/** Derive the PhaseAgentSpec view from a studio SKILL.md (ADR-027). */
export function deriveAgentSpec(skillPathFromRoot: string, root = process.cwd()): PhaseAgentSpec {
  const def = loadAgentDefinition(resolve(root, skillPathFromRoot));
  if (!def.phase) throw new Error(`${def.path}: cannot derive spec — no phase field`);
  if (def.runtime.strategy !== 'fixed' || !def.runtime.model) {
    throw new Error(`${def.path}: cannot derive spec — runtime must be strategy:fixed with a model (range routing lands M6)`);
  }
  const tier = TIER_BY_MODEL[def.runtime.model];
  if (!tier) throw new Error(`${def.path}: unknown model ${def.runtime.model} — not in MODEL_BY_TIER`);
  return {
    phase: def.phase,
    skill: skillPathFromRoot,
    tier,
    allowedTools: def.allowedTools,
    disallowedTools: def.disallowedTools,
  };
}
```

- [ ] **Step 4: Add frontmatter to the 5 SKILL.md files.** Keep every existing key and the entire body byte-identical; only add/adjust keys shown. Exact target frontmatter:

`skills/project-manager/SKILL.md` (keep existing name/description/phase/surface):

```yaml
purpose: Decompose an approved initiative into atomic, dependency-ordered work items with verifiable acceptance criteria.
composition:
  skills: [brain-query]
  tools: []
  mcps: []
  hooks: [event-log]
runtime:
  sdk: claude
  strategy: fixed
  model: claude-sonnet-4-6
brainAccess: mandatory
interactivity: Fully autonomous; never blocks on the operator.
allowed-tools: [Read, Grep, Glob, Write, Edit]
disallowed-tools: [Bash, NotebookEdit, WebFetch, WebSearch]
budgets: {}
```

`skills/developer-ralph/SKILL.md` (keep name/description/phase/surface; **delete** the legacy top-level `model:` key — superseded by runtime.model, nothing parses it):

```yaml
purpose: Implement one work item to green gates inside its worktree, iterating until the budget is exhausted or the loop wedges.
composition:
  skills: []
  tools: [git, node]
  mcps: []
  hooks: [event-log, cost-guard, stall-watchdog, scratch-strip]
runtime:
  sdk: claude
  strategy: fixed
  model: claude-sonnet-4-6
brainAccess: advisory
interactivity: Fully autonomous; never blocks on the operator.
allowed-tools: [Read, Write, Edit, MultiEdit, Bash, Grep, Glob]
disallowed-tools: [NotebookEdit, WebFetch, WebSearch]
budgets: {}
```

(`budgets: {}` is honest: iteration + cost budgets are per-manifest runtime inputs, not agent constants.)

`skills/developer-unifier/SKILL.md` (keep name/description and existing allowed-tools/disallowed-tools — already spec-exact; **add** `phase: unifier`, `surface: unattended`):

```yaml
phase: unifier
surface: unattended
purpose: Treat the initiative as one PR — prove every AC against branch tip, author the demo and PR body, never add scope.
composition:
  skills: [demo]
  tools: [git, gh, node]
  mcps: []
  hooks: [event-log, scratch-strip]
runtime:
  sdk: claude
  strategy: fixed
  model: claude-sonnet-4-6
brainAccess: advisory
interactivity: Fully autonomous; never blocks on the operator.
budgets:
  iterationCap: 15
```

`skills/reflector/SKILL.md` (keep name/description/surface; **change** `phase: reflection` → `phase: reflector` to match `reflectorAgentSpec.phase` — nothing reads the old value; **delete** legacy top-level `model:`):

```yaml
phase: reflector
purpose: Run the end-of-cycle retrospective and write durable findings into the brain.
composition:
  skills: [brain-query, brain-ingest]
  tools: []
  mcps: []
  hooks: [event-log]
runtime:
  sdk: claude
  strategy: fixed
  model: claude-sonnet-4-6
brainAccess: mandatory
interactivity: Autonomous self-reflection with an optional operator feedback round.
allowed-tools: [Read, Grep, Glob, Write, Edit, Bash]
disallowed-tools: [NotebookEdit, WebFetch, WebSearch]
budgets: {}
```

`skills/architect/SKILL.md` (keep name/description/phase; not in the derivation test — architect has no PhaseAgentSpec until M2-4; `runtime.model` records the tier M2 adopts, as-built tools mirror `architect-runner.ts:862`):

```yaml
purpose: Turn an operator idea into a PLAN.md and queued manifest through an interactive interview and the human PLAN gate.
composition:
  skills: [brain-query]
  tools: []
  mcps: []
  hooks: [event-log]
runtime:
  sdk: claude
  strategy: fixed
  model: claude-sonnet-4-6
brainAccess: mandatory
interactivity: Operator-driven; blocks on interview answers and the PLAN-gate verdict.
allowed-tools: [Read, Grep, Glob, Bash]
disallowed-tools: []
budgets: {}
```

- [ ] **Step 5: Run derivation test, verify pass.** Also run the FULL suite — the frontmatter edits must not break any existing test (`skills/*/*.test.ts` glob exists).
- [ ] **Step 6: Sanity-check zero behaviour change** — `git diff skills/ | grep -v '^[+-]' | head`; confirm diffs are frontmatter-only (no body lines touched): `git diff -U0 skills/ | grep '^[-+][^-+]' | grep -v ':' | head` should show nothing outside YAML keys.
- [ ] **Step 7: Commit** — `git commit -m "feat(studio): agent frontmatter seeds + PhaseAgentSpec derivation with no-drift test"`

---

### Task 4: Seed studio data files

**Files:**
- Create: `studio/flows/forge-cycle/flow.yaml`, `studio/catalog.yaml`, `studio/projects.yaml`, `brain/forge-dev/kb.yaml`, `brain/cycles/kb.yaml`
- Test: extend `orchestrator/studio/validate.test.ts` with a `seed data lints clean` suite

- [ ] **Step 1: Write failing test** — load each real seed file via registry, run its validator, assert zero `error`-level findings (flags allowed); plus `deriveAgentSpec` succeeds for the 4 phase agents loaded via `listAgentDefinitions('skills')`.

- [ ] **Step 2: Write `studio/flows/forge-cycle/flow.yaml`** — must describe today's cycle truthfully (gate-only review node; architect's PLAN gate; unifier resumable per ADR-019):

```yaml
id: forge-cycle
name: Forge Cycle
version: 1
goal: Take an approved initiative to a merged PR with reflection captured.
project: null
kb: cycles
costCeilingUsd: 25
origin: seed
nodes:
  - { id: architect, agent: architect, gate: plan }
  - { id: pm, agent: project-manager }
  - { id: dev, agent: developer-ralph, fanOut: work-items }
  - { id: unifier, agent: developer-unifier, resumable: true }
  - { id: review, gate: verdict }
  - { id: reflect, agent: reflector }
edges:
  - { from: architect, to: pm, artifact: plan }
  - { from: pm, to: dev, artifact: work-items }
  - { from: dev, to: unifier, artifact: wi-branches }
  - { from: unifier, to: review, artifact: pr }
  - { from: review, to: reflect, artifact: verdict }
triggers: []
```

- [ ] **Step 3: Write `studio/catalog.yaml`**

```yaml
sdks:
  - { id: claude, name: Claude Agent SDK, available: true }
  - { id: codex, name: OpenAI Codex, available: false }
  - { id: gemini, name: Gemini, available: false }
models:
  - { id: claude-haiku-4-5-20251001, name: Claude Haiku 4.5, sdk: claude, tier: haiku }
  - { id: claude-sonnet-4-6, name: Claude Sonnet 4.6, sdk: claude, tier: sonnet }
  - { id: claude-opus-4-8, name: Claude Opus 4.8, sdk: claude, tier: opus }
tools:
  - { id: git, name: git, desc: Worktrees, branches, commits. }
  - { id: node, name: Node.js, desc: Build + test runner. }
  - { id: gh, name: gh CLI, desc: GitHub PRs, reviews, merges, checks. }
mcps: []
hooks:
  - { id: event-log, name: JSONL event log, desc: Structured events on every invocation. }
  - { id: cost-guard, name: Cost guard, desc: Per-cycle USD budget enforcement. }
  - { id: stall-watchdog, name: Stall watchdog, desc: Heartbeat liveness monitoring. }
  - { id: merge-gate, name: Merge gate, desc: Dependent WIs wait on prerequisite merge. }
  - { id: scratch-strip, name: Scratch strip, desc: Base-guard strips scratch files pre-PR. }
```

(Model ids must stay in lockstep with `MODEL_BY_TIER` — add a test assertion: every `MODEL_BY_TIER` value appears in catalog models.)

- [ ] **Step 4: Write `studio/projects.yaml`** — run `ls projects/` first; include one entry per actually-present managed project (expected: betterado, claude-harness — verify):

```yaml
projects:
  - { id: betterado, path: projects/betterado }
  - { id: claude-harness, path: projects/claude-harness }
```

- [ ] **Step 5: Write kb.yaml descriptors**

`brain/forge-dev/kb.yaml`:
```yaml
id: forge-dev
name: Forge Engineering
scope: agent-integration
desc: What forge knows about building forge — engineering patterns, ADR context, antipatterns.
```

`brain/cycles/kb.yaml`:
```yaml
id: cycles
name: Cycle Patterns
scope: flow
desc: Cross-cycle patterns and archives — what forge has learned about running cycles.
```

- [ ] **Step 6: Check gitignore/lint interactions** — `studio/` must be tracked (confirm no `.gitignore` rule swallows it); run `forge brain lint` to confirm the kb.yaml files don't trip the 8 brain checks (they are YAML, not orphan markdown — if lint flags them, exclude `kb.yaml` in the lint walker as a structural file, and say so in the commit).
- [ ] **Step 7: Run tests → pass. Commit** — `git commit -m "feat(studio): seed definitions — forge-cycle flow, catalog, projects registry, kb descriptors"`

---

### Task 5: `forge studio lint` CLI + full spine

**Files:**
- Create: `cli/studio-lint.ts`
- Modify: `orchestrator/cli.ts` (new `case 'studio':` + `cmdStudio` + import)
- Test: `cli/studio-lint.test.ts` (covered by existing `cli/*.test.ts` glob)

- [ ] **Step 1: Write failing test** — `runStudioLint(forgeRoot)` returns `{ findings: Finding[]; errorCount: number }`; on the real repo seed data: `errorCount === 0`; on a tmp fixture with a broken flow (unknown agent ref): `errorCount > 0` and finding's `object` names the flow.
- [ ] **Step 2: Implement `cli/studio-lint.ts`** — walk: `listAgentDefinitions('skills/')` → validateAgent each; every `studio/flows/*/flow.yaml` → validateFlow against the agent map; `studio/catalog.yaml`; `studio/projects.yaml`; every `brain/*/kb.yaml` (glob, tolerate absence). Missing seed files = error (`studio/` is part of the standing gate once M0 lands). Print grouped findings + `Summary: N error(s), M flag(s).` — mirror `cmdBrainLint`'s output/exit pattern exactly.
- [ ] **Step 3: Wire CLI** — in `orchestrator/cli.ts`: add `case 'studio': return cmdStudio(rest);` beside `case 'brain':`; `cmdStudio` dispatches `lint` → handler, else prints `forge studio: subcommands: lint` + exit 2. Update the CLI help text where `brain` is documented.
- [ ] **Step 4: Verify by hand**

```bash
forge studio lint            # expect: findings (flags ok), Summary: 0 error(s), exit 0
echo $?
```

- [ ] **Step 5: Full regression spine**

```bash
npm test && npm run build && forge brain lint && forge studio lint
```

All green. (ui:journey not required — no UI touched; verify:cycle not required — hot path untouched, per roadmap M0 exit criteria.)

- [ ] **Step 6: Update docs** — `CLAUDE.md` Build & test block gains `forge studio lint`; `docs/forge-studio/roadmap.md` M0 checklist unchanged (exit criteria met); tick M0 rows in `docs/forge-studio/work-items.md`.
- [ ] **Step 7: Commit** — `git commit -m "feat(studio): forge studio lint joins the standing gate set (M0 complete)"`

---

## Self-review notes (spec coverage)

- Roadmap M0 ws-1 (ADR-027) — already Accepted on disk; no code task. ✓
- ws-2 registry+validate → Tasks 1–2. ✓ (flow rules incl. zero-gate/fanOut/acyclic; kb scope enum; catalog model→sdk.)
- ws-3 seed data → Tasks 3 (frontmatter) + 4 (flow/catalog/kb/projects). "Six SKILL.md" in roadmap is actually five — reviewer is a human gate; recorded in work-items.md reality deltas. ✓
- ws-4 derivation test → Task 3. ✓
- ws-5 CLI lint → Task 5. ✓
- Exit criteria: lint clean (T5), derivation green (T3), zero behaviour change (T3 step 6 guard; frontmatter-in-prompt delta accepted + documented). ✓
