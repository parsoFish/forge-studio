# Extending Forge

Forge has three pluggable seams. Each seam has a typed interface, a conformance/contract test suite as the admission gate, a registration step, and a `catalog.yaml` entry. The pattern is the same across all three: implement the interface, prove it with the test suite, register it, gate it on dep+creds.

The RuntimeAdapter worked examples are the second implementations that shipped in M8 (ADR-032): Gemini and Aider. Every RuntimeAdapter, Flow, and Skill instruction below has a corresponding file you can diff against. The KbBackend seam is **filesystem-only today** — `FilesystemKbBackend` is the sole implementation; the interface is present for a future backend.

---

## 1. RuntimeAdapter — plug in a new LLM SDK or agentic coder

**Interface:** `loops/_adapters/types.ts`
**Conformance suite:** `loops/_adapters/conformance.ts`
**Registry:** `loops/_adapters/registry.ts`
**Catalog:** `studio/catalog.yaml` (`sdks:` list)
**Worked examples:** `loops/_adapters/gemini/index.ts`, `loops/_adapters/aider/index.ts`

### The interface

```typescript
// loops/_adapters/types.ts
export type RuntimeAdapter = {
  id: string;           // sdk id registered in catalog.yaml
  available: boolean;   // dep + creds gate; false = registered but not selectable
  createAgent(opts: AdapterAgentOptions): AgentInvocation;
  query: QueryFn;
};
```

`createAgent` returns an `AgentInvocation` — one Ralph loop iteration. It reads `PROMPT.md` from the worktree, drives the SDK, and returns `AgentIterationInfo` (filesChanged, costUsd, toolsUsed, token counts). `query` is the raw SDK-call boundary used by direct-stream phases (architect, PM, reflector).

### Step 1 — implement

Create `loops/_adapters/<sdk>/index.ts`. The minimal shape:

```typescript
import type { RuntimeAdapter, AdapterAgentOptions, QueryFn } from '../types.ts';
import type { AgentInvocation } from '../../ralph/runner.ts';

const myQuery: QueryFn = (params) => {
  async function* stream() {
    // call your SDK, re-shape chunks into:
    //   { type: 'assistant', message: { content: [{type:'text'|'tool_use',...}], usage } }
    // then terminate with:
    //   { type: 'result', subtype: 'success', total_cost_usd, num_turns, usage }
    yield { type: 'result', subtype: 'success', total_cost_usd: 0, num_turns: 0,
            usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0,
                     cache_creation_input_tokens: 0 } };
  }
  return stream();
};

function createMyAgent(opts: AdapterAgentOptions): AgentInvocation {
  return async ({ promptPath, worktreePath }) => {
    // read PROMPT.md, call myQuery (or opts.queryFn if injected for tests),
    // return AgentIterationInfo
    return { filesChanged: [], costUsd: 0 };
  };
}

export const myAdapter: RuntimeAdapter = {
  id: 'my-sdk',
  available: true,   // gate on dep + creds as shown below
  createAgent: createMyAgent,
  query: myQuery,
};
```

**Dep + creds gating** is mandatory. Import the dep through a string variable so `tsc` never resolves an absent module, then set `available` at module load:

```typescript
const PKG = 'my-sdk-package';               // string variable — tsc skips resolution
let depPresent = false;
try {
  await import(PKG);
  depPresent = true;
} catch { /* absent dep is expected */ }
const credsPresent = !!process.env.MY_SDK_API_KEY;
export const myAdapter: RuntimeAdapter = { ..., available: depPresent && credsPresent };
```

See `gemini/index.ts` (`GENAI_PACKAGE`, `loadGenAiModule`, `isAvailable`) for the full pattern including the `cachedModule` optimisation. See `aider/index.ts` for a CLI-subprocess adapter where `query` is a thin shim (aider is loop-driven, not a token stream — the shim yields a single terminal `result` message).

**Inject a test seam.** The conformance suite injects a mock `QueryFn` via `opts.queryFn`. Wire it in `createAgent`:

```typescript
const queryFn: QueryFn = opts.queryFn ?? myQuery;
```

The Claude adapter does this; the Gemini and Aider adapters follow the same pattern.

### Step 2 — run the conformance suite

The conformance suite in `loops/_adapters/conformance.ts` is the admission gate. Create `loops/_adapters/<sdk>/<sdk>.test.ts`:

```typescript
import { describe } from 'node:test';
import { runAdapterConformance } from '../conformance.ts';
import { myAdapter } from './index.ts';

// For adapters that need a real dep/creds: inject a mock QueryFn.
// For dep-free adapters: omit the second arg.
describe('my-sdk adapter conformance', () => {
  runAdapterConformance(myAdapter, { queryFn: myMockQueryFn });
});
```

The suite checks: `id` is a non-empty string, `available` is a boolean, `createAgent` returns a callable, and `query` returns an AsyncIterable that yields at least one message with a `result`-type terminal. All four must pass before registration.

See `loops/_adapters/gemini/gemini.test.ts` and `aider/aider.test.ts` for complete examples including mock construction.

### Step 3 — register

Add to `loops/_adapters/registry.ts`:

```typescript
import { myAdapter } from './my-sdk/index.ts';

const ADAPTERS: Record<string, RuntimeAdapter> = {
  claude: claudeAdapter,
  example: exampleAdapter,
  gemini: geminiAdapter,
  aider: aiderAdapter,
  'my-sdk': myAdapter,   // add here
};
```

`getAdapter(id)` is what the dev-loop calls: `getAdapter(sdkId).createAgent(opts)`. An unavailable adapter is harmless — `isSdkAvailable(id)` stays false and the UI picker greys it out.

### Step 4 — add to catalog

In `studio/catalog.yaml` under `sdks:`:

```yaml
sdks:
  - { id: my-sdk, name: My SDK, available: false }
```

Set `available: false` until the dep is provisioned in production. The catalog entry is what the Studio agent-builder UI surfaces to the operator.

### Step 5 — install the dep (ask-first)

New external dependencies are a maintenance liability — per `PRINCIPLES.md`, raise the new dep in an issue before installing. Once agreed, `npm install my-sdk-package`.

---

## 2. KbBackend — swap the brain's storage layer

**Interface:** `orchestrator/kb-backend.ts`
**Reference impl:** `FilesystemKbBackend` (in the same file)
**Contract test:** `orchestrator/kb-backend.test.ts`

This seam is **filesystem-only today.** `FilesystemKbBackend` is the only implementation — it reads `brain/<kbId>/` from disk by delegating to `kb-graph.ts`. The interface, the contract test, and the `getKbBackend` / `getKbBackendAsync` resolvers are all present so a future graph-memory backend (Mem0/…) can be added without touching call sites — but no second backend ships today.

### The interface

```typescript
// orchestrator/kb-backend.ts
export interface KbBackend {
  readonly kbId: string;
  buildGraph(): KbGraph;
  getNodeArticle(nodeId: string): KbNodeArticle | null;
  listPendingGuidance(): PendingGuidance[];
  deleteGuidanceFile(filePath: string): boolean;
  search(query: string, limit?: number): KbSearchHit[];
}
```

The interface is **synchronous**. `FilesystemKbBackend.search` does cheap title-substring ranking over the graph; a semantic backend would override it with embedding/graph search. If a future backend's underlying store is **async**, bridge with a primed snapshot: add an `async prime()` method (not part of the interface) that pulls data into memory, then let the synchronous interface read that snapshot, and call `await backend.prime()` once at resolve time (`getKbBackendAsync` is the async resolver kept for exactly this).

### Implementing a new backend (the seam, for reference)

```typescript
import { FilesystemKbBackend } from './kb-backend.ts';
import type { KbBackend, KbSearchHit } from './kb-backend.ts';
import type { KbGraph, KbNodeArticle, PendingGuidance } from './kb-graph.ts';

export class MyKbBackend implements KbBackend {
  readonly kbId: string;
  private readonly fsBackend: FilesystemKbBackend;  // delegate guidance ops

  constructor(opts: { kbId: string; forgeRoot: string; /* your client */ }) {
    this.kbId = opts.kbId;
    this.fsBackend = new FilesystemKbBackend(opts.forgeRoot, opts.kbId);
  }

  // async escape hatch — NOT on the interface; called by getKbBackendAsync
  async prime(): Promise<void> { /* fetch from your store, cache in memory */ }

  buildGraph(): KbGraph         { /* return cached snapshot */ return { nodes: [], edges: [] }; }
  getNodeArticle(id: string): KbNodeArticle | null { return null; }
  listPendingGuidance(): PendingGuidance[]  { return this.fsBackend.listPendingGuidance(); }
  deleteGuidanceFile(path: string): boolean { return this.fsBackend.deleteGuidanceFile(path); }
  search(query: string, limit = 20): KbSearchHit[] { /* query cached results */ return []; }
}
```

Delegating guidance ops (`listPendingGuidance` / `deleteGuidanceFile`) to a composed `FilesystemKbBackend` is the expected pattern — `_guidance` is a filesystem concept a remote store has no equivalent for.

**Dep + creds gating** follows the same string-variable import pattern as RuntimeAdapter (§1): import the package through a string variable so `tsc` never resolves an absent module, then set an `available`-style flag at module load.

**Contract test** — write a test that constructs your backend with an injected fake client (no live dep, no network) and asserts each interface method returns the right shape. Mirror `orchestrator/kb-backend.test.ts`.

**Routing** — `getKbBackend(forgeRoot, kbId)` / `getKbBackendAsync(...)` in `orchestrator/kb-backend.ts` are the resolution entry points. Both always return `FilesystemKbBackend` today. To route to a new backend, add a `backend:` field to the KB's `kb.yaml` descriptor and add a dispatch branch in the resolver:

```typescript
// orchestrator/kb-backend.ts: getKbBackend()
const kbYamlPath = join(resolve(forgeRoot, 'brain', kbId), 'kb.yaml');
if (!existsSync(kbYamlPath)) throw new Error(`Unknown kbId: "${kbId}" …`);
// future hook: read kb.yaml `backend:` here and dispatch to a non-FS impl.
return new FilesystemKbBackend(forgeRoot, kbId);
```

---

## 3. Flow — add a new agent workflow

**Schema:** `orchestrator/studio/types.ts` (`FlowDefinition`)
**Validator:** `orchestrator/studio/validate.ts` (run via `forge studio lint`)
**Seed flows:** `studio/flows/forge-cycle/flow.yaml`, `studio/flows/knowledge-ingest/flow.yaml`

A flow is a `flow.yaml` file under `studio/flows/<flow-id>/`:

```yaml
id: my-flow
name: My Flow
version: 1
goal: One sentence: what this flow achieves.
project: null          # null = operator-scoped; "my-project" = project-scoped
kb: cycles             # which KB the flow's agents read (brain/<kb-id>/)
costCeilingUsd: 10
origin: seed           # or 'operator'

nodes:
  - { id: ingest, agent: brain-ingest }
  - { id: review, gate: verdict }          # gate-only node (human moment; no agent)
  - { id: dev, agent: developer-ralph, fanOut: work-items }   # fan-out over artifact
  - { id: unifier, agent: developer-unifier, resumable: true }

edges:
  - { from: ingest, to: review, artifact: report }
  - { from: review, to: dev,    artifact: work-items }
  - { from: dev,    to: unifier, artifact: wi-branches }

triggers: []
```

**Node fields:**

| Field | Required | Meaning |
|-------|----------|---------|
| `id` | yes | unique within the flow |
| `agent` | if no `gate` | slug of an agent in `skills/` |
| `gate` | if no `agent` | human gate id (`plan`, `verdict`) |
| `fanOut` | no | artifact name — the flow engine spawns one node per item in the artifact |
| `resumable` | no | node can be re-entered after partial failure (unifier pattern) |

**Edge `artifact`** names the markdown artifact written by the `from` node and read by the `to` node. Every artifact must be greppable (ADR-007).

Run `forge studio lint` after adding or editing a flow. It validates: required fields present, all `agent` slugs resolve to a `skills/<slug>/SKILL.md`, all `gate` ids are known, all edge endpoints are declared nodes, no dangling edges.

The flow engine dispatches nodes via a data-table + node-executor registry (ADR-028). To wire a new gate type, add a gate handler in `orchestrator/studio/` — consult ADR-028 before doing this.

---

## 4. Skill/agent — define a new phase agent

**Directory:** `skills/<slug>/`
**Required file:** `skills/<slug>/SKILL.md`
**Types:** `orchestrator/studio/types.ts` (`AgentDefinition`)
**Loader:** `orchestrator/studio/registry.ts` (`loadAgentDefinition`)
**Spec derivation:** `orchestrator/studio/derive.ts` (`deriveAgentSpec`)

### SKILL.md structure

A `SKILL.md` has a YAML frontmatter block followed by a markdown body. The frontmatter is the machine-readable contract; the body is the process intent loaded into the agent's context at spawn time.

```markdown
---
name: my-agent
description: One sentence describing what this agent does.
phase: my-phase              # must match a known phase; omit for utility skills
surface: unattended          # or 'operator-driven'
purpose: Longer description of the agent's single responsibility.
composition:
  skills: [brain-query]      # sub-skills this agent loads
  tools: [git, node]         # tool ids from catalog.yaml tools:
  mcps: []                   # MCP server ids from catalog.yaml mcps:
  hooks: [event-log]         # hook ids from catalog.yaml hooks:
runtime:
  sdk: claude                # sdk id from catalog.yaml sdks:
  strategy: fixed            # 'fixed' (one model) or 'range' (escalation ladder)
  model: claude-sonnet-4-6   # required when strategy:fixed
brainAccess: advisory        # 'mandatory' | 'advisory' | 'none'
interactivity: Fully autonomous; never blocks on the operator.
allowed-tools: [Read, Write, Edit, MultiEdit, Bash, Grep, Glob]
disallowed-tools: [WebFetch, WebSearch]
budgets: {}
---

# My Agent

## Single responsibility

...
```

**`runtime.sdk`** must be a registered id in `studio/catalog.yaml` and `loops/_adapters/registry.ts`.

**`strategy: fixed`** requires `model:` to be a model id in `catalog.yaml`. `strategy: range` requires `range: [haiku, sonnet, opus]` — the flow engine picks the cheapest available tier and escalates on failure.

**`allowed-tools` / `disallowed-tools`** become the `allowedTools` / `disallowedTools` fields on the derived `PhaseAgentSpec` that the orchestrator passes to the SDK at spawn time.

**`brainAccess: mandatory`** is enforced by convention (and by the brain-read policy in `CLAUDE.md`): planners and the reflector must read the brain before acting; the dev-loop must not.

### Deriving the PhaseAgentSpec

The orchestrator uses `deriveAgentSpec` to turn a SKILL.md into the runtime spec:

```typescript
// orchestrator/studio/derive.ts
import { deriveAgentSpec } from './orchestrator/studio/derive.ts';

const spec = deriveAgentSpec('skills/my-agent/SKILL.md');
// returns PhaseAgentSpec: { phase, skill, tier, allowedTools, disallowedTools }
```

The `skill` field on the returned spec is the root-relative path passed in — the orchestrator loads the SKILL.md body from that path and injects it as the agent's system prompt at spawn time.

### Registering a new agent in a flow

Add the agent slug to a flow's `nodes:` list. `forge studio lint` will validate that `skills/<slug>/SKILL.md` exists and parses cleanly. No separate registration step is needed — the flow engine resolves slugs to SKILL.md paths at runtime via `loadAgentDefinition`.

---

## Conventions that apply to all extension work

- Errors must be explicit and fail-fast at the boundary (no silent swallowing).
- No hardcoded secrets — use env vars; document which vars are required.
- New external deps require a justification comment in the PR and an ask-first event per `PRINCIPLES.md`.
- Add or update the relevant ADR if your change affects a load-bearing architectural decision.
- Run all four gates (`npm run build`, `npm test`, `forge studio lint`, `forge brain lint`) before opening a PR.
