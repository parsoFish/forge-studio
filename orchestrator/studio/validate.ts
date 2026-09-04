/**
 * Forge Studio definition validation (ADR 027, §6).
 * Pure semantic checks — no I/O, no mutation of inputs.
 * Consumed by: bridge PUT routes (M2) and `forge studio lint` (Task 5).
 *
 * validateKb intentionally checks only the slug and backend; the binding shape is enforced at load time in registry.ts.
 */


import { DEMO_STEP_KINDS } from '@forge/contracts/studio/types.ts';
import { FANOUT_ISOLATION_KINDS } from '@forge/contracts/studio/types.ts';
import { FLOW_KICKOFF_KINDS } from '@forge/contracts/studio/types.ts';
import { KB_BACKENDS } from '@forge/contracts/studio/types.ts';
import { SLUG_RE, EXACT_ID_RE, PROJECT_ID_RE, KB_ID_RE, MAX_EXACT_ID_LENGTH, RESERVED_OBJECT_IDS, isReservedId } from '@forge/agents/skill-path.ts';
import { isSafeProjectName } from '@forge/flows/manifest-path-guard.ts';
// G6's fan-out predicate now lives with the flow semantics it states
// (packages/flows/flow-fanout.ts), so the lint and the runner still share ONE
// copy without the runner importing orchestrator/. No re-export: measured, the
// only consumers were this file and the runner.
import { findFanOutViolations } from '@forge/flows/flow-fanout.ts';
import { SURFACE_KINDS, PHASE_EXECUTOR_KINDS } from './registry.ts';
import { MATERIAL_KINDS } from '@forge/agents/studio/materials.ts';
import { agentCapabilityDescriptor } from '@forge/agents/studio/derive.ts';
import { checkFlowTriggers, type TriggerCheckOpts } from '@forge/flows/studio/validate-triggers.ts';
import { BAND_CANONICAL_SLUG } from '@forge/agents/agent-bands.ts';
import type {
  AgentDefinition,
  FlowDefinition,
  KbDescriptor,
  ProjectDefinition,
} from '@forge/contracts/studio/types.ts';
import { type Finding, err, flag } from '@forge/kernel/findings.ts';
// The library-owned validators (Catalog/Community/Template/Skill kinds, spec
// §3.1) moved to `packages/library/studio/library-validate.ts` (M4
// library-by-kind carve, Part 1); re-exported below so this file's existing
// importers — chiefly `apps/forge/studio-lint.ts` — stay untouched.
import {
  validateArtifactTemplate,
  validateCatalog,
  validateCommunityRegistry,
  validateInstructionSeed,
  validateLibraryFlag,
} from '@forge/library/studio/library-validate.ts';

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

// Definition moved to `@forge/kernel/findings.ts` (M4 library-by-kind carve,
// Part 1), along with its `err`/`flag` constructors; re-exported so this
// file's 20+ existing importers stay untouched. Deliberate — stays until
// another milestone retires this file.
export type { Finding };

// The five library-owned validators (see the import above) moved to
// `packages/library/studio/library-validate.ts`; re-exported for
// `apps/forge/studio-lint.ts` and this file's own test suite.
export { validateArtifactTemplate, validateCatalog, validateCommunityRegistry, validateInstructionSeed, validateLibraryFlag };

// Definition moved to skill-path.ts (a leaf module) to break the
// skill-path→validate→registry→skill-path cycle; re-exported so this file's
// 20+ existing call sites stay untouched.
export { SLUG_RE };

/**
 * W7-A4 — the ONE id rule for projects and knowledge bases (findings
 * knowledge-03, crosscut-11, projects-02, projects-34; bead forge-9bd).
 *
 * A project id IS its on-disk directory name and a KB id IS its kb.yaml
 * `id` (which equals its directory name): case-preserving, matched exactly
 * end to end — discovery, the roster, every `:id` route, every validator.
 * Real installs carry `trafficGame` and `terraform-provider-betterado`, so the
 * charset is wider than `SLUG_RE` (which stays the rule for skills, agents,
 * flows, templates and hooks — the studio-authored, slug-minted objects) but
 * still one path-safe segment: no `.`/`/`/`\` (traversal), no leading `-`
 * (flag shape), no whitespace. A directory whose name fails this predicate
 * is not a project/KB and is never listed — a listed id must be routable.
 *
 * Defined in `orchestrator/skill-path.ts` (the leaf module, next to SLUG_RE,
 * for the same registry↔validate cycle reason) and re-exported here.
 */
export { EXACT_ID_RE, PROJECT_ID_RE, KB_ID_RE, MAX_EXACT_ID_LENGTH };

/**
 * Ids the UI reserves as static route segments (`/projects/new`,
 * `/agents/new`, `/flows/new`, `/skills/new`, `/hooks/new`, `/knowledge/new`).
 * An object literally named `new` would be permanently shadowed by the
 * builder that lives at that path (projects-30, crosscut-20), so every
 * create route refuses it — case-insensitively, since project/skill slugs
 * are lowercased at creation and a case-preserving KB id `New` would still
 * be unreachable next to the static segment.
 */
export { RESERVED_OBJECT_IDS, isReservedId };

/** `null` when `id` is a routable project id, else the operator-facing reason. */
export function invalidProjectIdReason(id: string): string | null {
  if (id.length === 0) return 'invalid project "" — an id is required';
  if (id.length > MAX_EXACT_ID_LENGTH) {
    return `invalid project "${id.slice(0, 40)}…" — ${id.length} characters exceeds the ${MAX_EXACT_ID_LENGTH}-character length limit`;
  }
  if (!PROJECT_ID_RE.test(id)) {
    return `invalid project "${id}" — must match ${PROJECT_ID_RE} (the project's directory name: one path segment; no "/", "\\", ".", "..", or a leading "-")`;
  }
  return null;
}

/** `null` when `id` is a routable KB id, else the operator-facing reason. */
export function invalidKbIdReason(id: string): string | null {
  if (id.length === 0) return 'invalid kb id "" — an id is required';
  if (id.length > MAX_EXACT_ID_LENGTH) {
    return `invalid kb id "${id.slice(0, 40)}…" — ${id.length} characters exceeds the ${MAX_EXACT_ID_LENGTH}-character length limit`;
  }
  if (!KB_ID_RE.test(id)) {
    return `invalid kb id "${id}" — must match ${KB_ID_RE} (the KB's directory name: one path segment; no "/", "\\", ".", "..", or a leading "-")`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
// err/flag moved to `@forge/kernel/findings.ts` (imported above).

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
// validateAgent
// ---------------------------------------------------------------------------

export function validateAgent(
  def: AgentDefinition,
  validModelIds?: ReadonlySet<string>,
  validGuardIds?: ReadonlySet<string>,
): Finding[] {
  const findings: Finding[] = [];
  const obj = `agent:${def.slug}`;

  // slug
  if (!SLUG_RE.test(def.slug)) {
    findings.push(err(obj, 'slug', `Slug "${def.slug}" does not match ${SLUG_RE}`));
  }

  // readiness/purpose — error
  if (!def.purpose.trim()) {
    findings.push(err(obj, 'readiness/purpose', 'Agent purpose is missing or blank'));
  }

  // readiness/skill — flag (empty skills is valid for agents like pm that delegate via sub-agents)
  if (def.composition.skills.length === 0) {
    findings.push(flag(obj, 'readiness/skill', 'No composed skills — at least one skill is recommended'));
  }

  // readiness/guard — flag (same reasoning; mock renders this progressively, not a hard blocker)
  if (def.composition.guards.length === 0) {
    findings.push(flag(obj, 'readiness/guard', 'No observability guards — at least event-log is recommended'));
  }

  // readiness/process — error
  if (!def.body.trim()) {
    findings.push(err(obj, 'readiness/process', 'Agent process body is missing or blank'));
  }

  // readiness/interactivity — error
  if (!def.interactivity.trim()) {
    findings.push(err(obj, 'readiness/interactivity', 'Agent interactivity description is missing or blank'));
  }

  // surface/enum — error (R2-01-F5). `surface` is optional — absent is legal
  // (e.g. architect has no surface field at all). Parsed leniently at load
  // (registry.ts), so a bad value is a lint error here, not a load crash
  // (kb.backend / flow.kickoff.kind precedent).
  if (def.surface !== undefined && def.surface.trim() !== '' && !(SURFACE_KINDS as readonly string[]).includes(def.surface)) {
    findings.push(
      err(obj, 'surface/enum', `unknown surface "${def.surface}" — must be one of ${SURFACE_KINDS.join('|')}`),
    );
  }

  // executor/enum — error (R2-01-F2 review finding). `executor` is optional —
  // absent is legal (most roster agents have none; they run via the generic
  // F1 execAgent path). Parsed leniently at load (registry.ts), so a bad
  // value is a lint error here, not a load crash — otherwise a typo'd
  // executor silently resolves to NodeKind 'unknown' at runtime (the node
  // is never executed, only an error-severity log) with no lint signal.
  if (
    def.executor !== undefined &&
    def.executor.trim() !== '' &&
    !(PHASE_EXECUTOR_KINDS as readonly string[]).includes(def.executor)
  ) {
    const valid = (PHASE_EXECUTOR_KINDS as readonly string[]).length > 0
      ? `must be one of ${PHASE_EXECUTOR_KINDS.join('|')}`
      : 'no phase executors remain (R4-01-F4) — every phase is a generic agent or a band guard, so drop the `executor` field';
    findings.push(err(obj, 'executor/enum', `unknown executor "${def.executor}" — ${valid}`));
  }

  // runtime/loop-strategy — error (R4-01-F2 review finding). Mirrors the
  // executor enum check: parsed leniently at load, so a bad value must be a
  // lint error here (runAgent also rejects unknown values at spawn, but that
  // is a runtime crash, not an authoring-time signal). And 'ralph' is
  // restricted to the canonical developer-ralph slug: execAgent routes a
  // declared ralph loop to the dev-loop pipeline, which is per-WI machinery
  // that ignores the declaring def's own prompt/tools — any other agent
  // declaring it would mis-run. Lifts when declared fanout generalises the
  // loop machinery (R2-03 / R4-06-F2).
  const loopStrategy = def.runtime.loopStrategy;
  if (loopStrategy !== undefined && loopStrategy !== 'ralph' && loopStrategy !== 'one-shot') {
    findings.push(
      err(obj, 'runtime/loop-strategy', `unknown loopStrategy "${loopStrategy}" — must be ralph|one-shot`),
    );
  }
  if (loopStrategy === 'ralph' && def.slug !== 'developer-ralph') {
    findings.push(
      err(
        obj,
        'runtime/loop-strategy',
        `loopStrategy "ralph" is restricted to developer-ralph — the ralph loop is the dev-loop pipeline, which ignores this agent's own def (lifts with R2-03/R4-06 declared fanout)`,
      ),
    );
  }

  // fanout/isolation — flag (R2-03). Soft, not an error: `isolation` is an open
  // provider ref (a future/custom provider is legal), so an unknown value only
  // WARNS — enough to catch a typo (`worktre`) that would otherwise silently run
  // items with no isolation, without rejecting a legitimately-new provider name.
  if (
    def.fanout !== undefined &&
    def.fanout.isolation.trim() !== '' &&
    !(FANOUT_ISOLATION_KINDS as readonly string[]).includes(def.fanout.isolation)
  ) {
    findings.push(
      flag(
        obj,
        'fanout/isolation',
        `fanout.isolation "${def.fanout.isolation}" is not a shipped provider (${FANOUT_ISOLATION_KINDS.join('|')}) — allowed as a future/custom provider ref, but check for a typo`,
      ),
    );
  }

  // materials/enum — error (R2-09 D1). `materials` is optional — absent is
  // legal (not declared) and `materials: []` is also legal (declared-empty;
  // D2). Parsed leniently at load (registry.ts/materials.ts), so an unknown
  // VALUE is a lint error here, not a load crash — and an ERROR, not a flag
  // (unlike fanout/isolation above), because materials has no runtime
  // enforcement point yet (R6-04-F2): a silently-tolerated bad value here
  // would be declared data nobody ever checks. One finding per DISTINCT
  // offending value (not one per array element — a repeated unknown value
  // used to emit a duplicate finding per repeat), and the message names BOTH
  // the value and the full allowed set.
  //
  // 2026-08-05 adversarial-review round 2, finding B/4: `def.materials` is
  // reachable as a non-array (e.g. a bare string) from any hand-built
  // AgentDefinition — `for (const value of def.materials)` over a STRING
  // iterates it character by character, so `'images'` produced six nonsense
  // per-character `materials/enum` findings. The shape is checked FIRST and
  // reported as exactly ONE finding naming the shape problem, under a
  // distinct check name — it never falls through to the per-value loop.
  if (def.materials !== undefined) {
    if (!Array.isArray(def.materials)) {
      findings.push(
        err(obj, 'materials/shape', 'materials must be an array of strings'),
      );
    } else {
      const unknownValues = new Set<string>();
      for (const value of def.materials) {
        if (!(MATERIAL_KINDS as readonly string[]).includes(value)) {
          unknownValues.add(value);
        }
      }
      for (const value of unknownValues) {
        findings.push(
          err(
            obj,
            'materials/enum',
            `unknown materials value "${value}" — must be one of ${MATERIAL_KINDS.join('|')}`,
          ),
        );
      }
    }
  }

  // composition/band-guard — error (R4-01 whole-branch review). Band guards
  // are declared DISPATCH (execAgent routes them to the canonical PM/reflector
  // pipelines, which load their own SKILL.md and ignore the declaring def) —
  // the exact wrong-identity hazard the ralph restriction above closes, so
  // they get the same treatment: each guard is restricted to its canonical
  // slug until the bands generalise (R4-06+); at most one band guard per def;
  // a band-guard def must declare the one-shot loop the band spawns with.
  // The INVERSE also lints: the canonical phase agents must CARRY their band
  // guard — deleting it would silently degrade the phase node to the bare
  // generic spawn (no WI validation, no brain gate) with lint green.
  // Single source shared with execAgent's runtime backstop (agent-bands.ts) —
  // the "lint must mirror the dispatch it backstops" rule made structural.
  const CANONICAL_BAND_SLUGS: Record<string, string> = BAND_CANONICAL_SLUG;
  const declaredBands = def.composition.guards.filter((h) => h in CANONICAL_BAND_SLUGS);
  for (const band of declaredBands) {
    if (CANONICAL_BAND_SLUGS[band] !== def.slug) {
      findings.push(
        err(
          obj,
          'composition/band-guard',
          `band guard "${band}" is restricted to ${CANONICAL_BAND_SLUGS[band]} — it routes this node to that agent's canonical pipeline, ignoring this def (lifts when the bands generalise)`,
        ),
      );
    }
  }
  if (declaredBands.length > 1) {
    findings.push(
      err(obj, 'composition/band-guard', `at most one band guard per agent (got: ${declaredBands.join(', ')})`),
    );
  }
  if (declaredBands.length === 1 && loopStrategy !== 'one-shot') {
    findings.push(
      err(
        obj,
        'composition/band-guard',
        `a band-guard agent must declare runtime.loopStrategy: one-shot (the band spawns through the one-shot primitive)`,
      ),
    );
  }
  if (declaredBands.length === 1 && def.budgets.maxTurns === undefined) {
    findings.push(
      err(
        obj,
        'composition/band-guard',
        `a band-guard agent must declare budgets.maxTurns — the caps are frontmatter data now; an uncapped unattended phase agent re-opens the F-42/F-43 silent-spend vector`,
      ),
    );
  }
  if (
    declaredBands.length === 1 &&
    def.budgets.maxBudgetUsd === undefined &&
    def.budgets.maxBudgetUsdShare === undefined
  ) {
    findings.push(
      err(obj, 'composition/band-guard', `a band-guard agent must declare a budget cap (maxBudgetUsd and/or maxBudgetUsdShare)`),
    );
  }

  // budgets/range — error: nonsense cap values would silently weaken or
  // invert the spend guards (a negative cap, a share > 1 spending more than
  // the whole initiative budget).
  const rangeChecks: Array<[string, number | undefined, (v: number) => boolean, string]> = [
    ['maxTurns', def.budgets.maxTurns, (v) => Number.isInteger(v) && v > 0, 'a positive integer'],
    ['maxBudgetUsd', def.budgets.maxBudgetUsd, (v) => v >= 0, '≥ 0'],
    ['maxBudgetUsdShare', def.budgets.maxBudgetUsdShare, (v) => v > 0 && v <= 1, 'in (0, 1]'],
  ];
  for (const [field, value, ok, want] of rangeChecks) {
    if (value !== undefined && !ok(value)) {
      findings.push(err(obj, 'budgets/range', `budgets.${field} must be ${want} (got ${value})`));
    }
  }
  const owedBand = Object.entries(CANONICAL_BAND_SLUGS).find(([, slug]) => slug === def.slug)?.[0];
  if (owedBand !== undefined && !def.composition.guards.includes(owedBand)) {
    findings.push(
      err(
        obj,
        'composition/band-guard',
        `${def.slug} must declare its "${owedBand}" band guard — without it the phase node silently degrades to the bare generic spawn`,
      ),
    );
  }

  // readiness/runtime — error
  const rt = def.runtime;
  const runtimeOk =
    rt.strategy === 'fixed'
      ? Boolean(rt.model && rt.model.trim())
      : rt.strategy === 'range'
        ? Array.isArray(rt.range) && rt.range.length > 0
        : false;

  if (!runtimeOk) {
    const detail =
      rt.strategy === 'fixed'
        ? 'strategy:fixed requires a non-empty model'
        : rt.strategy === 'range'
          ? 'strategy:range requires a non-empty range array'
          : `unknown strategy "${rt.strategy}"`;
    findings.push(err(obj, 'readiness/runtime', `Runtime not fully configured — ${detail}`));
  }

  // runtime model-catalog — error (only when the caller supplies the catalog
  // model-id set). Every referenced model id (fixed model, range entries) must
  // exist in catalog.models, so a mistyped tier is caught at lint time rather
  // than at spawn.
  if (validModelIds) {
    if (rt.strategy === 'fixed' && rt.model && !validModelIds.has(rt.model)) {
      findings.push(err(obj, 'runtime/model-catalog', `Runtime model "${rt.model}" is not in catalog.models`));
    }
    if (rt.strategy === 'range' && Array.isArray(rt.range)) {
      for (const id of rt.range) {
        if (!validModelIds.has(id)) {
          findings.push(err(obj, 'runtime/range-catalog', `Range model "${id}" is not in catalog.models`));
        }
      }
    }
  }

  // composition array entries: each must match a safe identifier regex
  const COMP_ENTRY_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
  const compArrays: [string, string[]][] = [
    ['composition/skills', def.composition.skills],
    ['composition/tools', def.composition.tools],
    ['composition/mcps', def.composition.mcps],
    ['composition/guards', def.composition.guards],
    ['composition/hooks', def.composition.hooks],
  ];
  for (const [field, entries] of compArrays) {
    for (const entry of entries) {
      if (typeof entry !== 'string' || !COMP_ENTRY_RE.test(entry)) {
        findings.push(err(obj, field, `Entry "${entry}" in ${field} must match ${COMP_ENTRY_RE}`));
      }
    }
  }

  // composition/guard-unknown — error (ADR-027 R3-03 amendment). Only fires
  // when the caller supplies the catalog guard-id set (mirrors the
  // runtime/model-catalog check's validModelIds convention above) — a typo'd
  // guard id would otherwise silently resolve to no dispatch/observability
  // effect with lint green.
  if (validGuardIds) {
    for (const guardId of def.composition.guards) {
      if (!validGuardIds.has(guardId)) {
        findings.push(err(obj, 'composition/guard-unknown', `Guard "${guardId}" is not in catalog.guards`));
      }
    }
  }

  return findings;
}

// validateLibraryFlag moved to `packages/library/studio/library-validate.ts`
// (M4 library-by-kind carve, Part 1; re-exported above).

// ---------------------------------------------------------------------------
// validateFlow
// ---------------------------------------------------------------------------

/**
 * `opts` (R2-04, see {@link TriggerCheckOpts}): `flowIds` is the full
 * registered flow-id set (enables the trigger-target existence check);
 * `flowProjectOf` resolves a flow's project (enables the external-trigger
 * project requirement to be checked on the TARGET flow the mint uses).
 * Omitted callers (a single-flow PUT that hasn't consulted the registry) still
 * get the self-loop / shape checks; studio-lint supplies both.
 */
export function validateFlow(
  flow: FlowDefinition,
  agents: ReadonlyMap<string, AgentDefinition>,
  opts?: TriggerCheckOpts,
): Finding[] {
  const findings: Finding[] = [];
  const obj = `flow:${flow.id}`;

  // slug
  if (!SLUG_RE.test(flow.id)) {
    findings.push(err(obj, 'slug', `Flow id "${flow.id}" does not match ${SLUG_RE}`));
  }

  // project/shape (SEC-03 Defect 3, defence in depth). The REAL enforcement is
  // `writeManifest`'s `assertManifestPathFields` at the manifest-write choke
  // point (orchestrator/mint-triggered-initiative.ts routes through it) — this
  // is layer 2, a charset check catching a poisoned `flow.project` at the
  // PUT/lint boundary, BEFORE it ever reaches a mint. Mirrors the exact
  // predicate the choke point itself uses (`isSafeProjectName`,
  // packages/flows/manifest-path-guard.ts) so the two layers can never drift apart. Error
  // level, not a flag: a warning here would be the "declared data fails open"
  // shape this campaign has repeatedly found and closed. `null`/absent/`''`
  // are all legal (no project binding) — checkFlowTriggers separately requires
  // a non-null project on flows targeted by external triggers.
  if (flow.project !== null && flow.project !== undefined && flow.project !== '' && !isSafeProjectName(flow.project)) {
    findings.push(
      err(
        obj,
        'project/shape',
        `Flow project "${flow.project}" must be a safe single path segment (no separators, no "." or "..")`,
      ),
    );
  }

  // version: must be an integer >= 1
  if (!Number.isInteger(flow.version) || flow.version < 1) {
    findings.push(
      err(obj, 'version', `Flow version must be an integer >= 1, got ${flow.version}`),
    );
  }

  // duplicate node ids
  const nodeIds = flow.nodes.map((n) => n.id);
  for (const dup of findDuplicates(nodeIds)) {
    findings.push(err(obj, 'node-ids', `Duplicate node id "${dup}"`));
  }

  const nodeIdSet = new Set(nodeIds);

  // node shape: must have at least agent or gate
  for (const node of flow.nodes) {
    if (!node.agent && !node.gate) {
      findings.push(
        err(obj, 'node-shape', `Node "${node.id}" has neither "agent" nor "gate" — one is required`),
      );
    }
  }

  // agent-ref: node.agent must exist in agents map
  for (const node of flow.nodes) {
    if (node.agent && !agents.has(node.agent)) {
      findings.push(
        err(obj, 'agent-ref', `Node "${node.id}" references unknown agent "${node.agent}"`),
      );
    }
  }

  // node-executor (R2-01-F2, AC #2; sourced from the R2-02-F1 capability
  // descriptor as of R2-02-F3): a node whose agent resolves to a real def
  // but that def is INTERACTIVE (agentCapabilityDescriptor(def).interactive)
  // and carries no declared `executor` (i.e. not the sole remaining legacy
  // phase executor, 'unifier' — R4-01-F2/ADR-039 retired 'pm'/'dev'/'reflect'
  // onto declared dispatch) can never be executed by the flow engine — interactive
  // agents run through the interactive-session runner, not a flow node.
  // Sourced from the same descriptor the BUILD-tab palette/drop gate reads
  // client-side, so lint and the UI never disagree. The `!def` case is
  // already covered by agent-ref above.
  for (const node of flow.nodes) {
    if (!node.agent) continue;
    const def = agents.get(node.agent);
    if (!def) continue;
    if (agentCapabilityDescriptor(def).interactive && def.executor === undefined) {
      findings.push(
        err(
          obj,
          'node-executor',
          `Node "${node.id}" references interactive agent "${node.agent}" — interactive agents run through the interactive-session runner, not a flow node`,
        ),
      );
    }
  }

  // edge-ref: from/to must be known node ids
  for (const edge of flow.edges) {
    if (!nodeIdSet.has(edge.from)) {
      findings.push(
        err(
          obj,
          'edge-ref',
          `Edge references unknown source node "${edge.from}" (→ "${edge.to}")`,
        ),
      );
    }
    if (!nodeIdSet.has(edge.to)) {
      findings.push(
        err(
          obj,
          'edge-ref',
          `Edge references unknown target node "${edge.to}" (from "${edge.from}")`,
        ),
      );
    }
  }

  // acyclic: Kahn's algorithm over node ids
  {
    // Build adjacency and in-degree from edges (only over known nodes to avoid noise from
    // edge-ref errors above)
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const id of nodeIds) {
      inDegree.set(id, 0);
      adj.set(id, []);
    }
    for (const edge of flow.edges) {
      if (nodeIdSet.has(edge.from) && nodeIdSet.has(edge.to)) {
        adj.get(edge.from)!.push(edge.to);
        inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
      }
    }
    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }
    let processed = 0;
    let head = 0;
    while (head < queue.length) {
      const current = queue[head];
      head += 1;
      processed++;
      for (const neighbor of adj.get(current) ?? []) {
        const newDeg = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) queue.push(neighbor);
      }
    }
    if (processed < nodeIds.length) {
      findings.push(
        err(obj, 'acyclic', `Flow "${flow.id}" contains a cycle — not a valid DAG`),
      );
    }
  }

  // fan-out: node.fanOut must match artifact of ≥1 inbound edge (G6 — the
  // runtime enforces this SAME predicate at flow start; see
  // orchestrator/flow-runner.ts and findFanOutViolations above)
  for (const violation of findFanOutViolations(flow)) {
    findings.push(
      err(
        obj,
        'fan-out',
        `Node "${violation.nodeId}" declares fanOut:"${violation.fanOut}" but no inbound edge carries artifact "${violation.fanOut}"`,
      ),
    );
  }

  // fanout-capability (R2-03-F2): a node that declares `fanOut` must target a
  // FANOUT-CAPABLE agent (one whose definition declares a `fanout:` block).
  // Sourced from the SAME capability descriptor the BUILD-tab fanout toggle
  // reads client-side (agentCapabilityDescriptor(def).fanoutCapable), so lint
  // and the UI never disagree. The unknown-agent case is `agent-ref`; the
  // no-inbound-edge topology case is `fan-out` above.
  for (const node of flow.nodes) {
    if (!node.fanOut || !node.agent) continue;
    const def = agents.get(node.agent);
    if (!def) continue;
    if (!agentCapabilityDescriptor(def).fanoutCapable) {
      findings.push(
        err(
          obj,
          'fanout-capability',
          `Node "${node.id}" declares fanOut but agent "${node.agent}" is not fanout-capable (its definition declares no \`fanout:\` block)`,
        ),
      );
    }
  }

  // kickoff (Stage C, optional): kind must be in the enum. Loader parses it
  // leniently so a typo is a lint error here, not a load crash (kb.backend precedent).
  if (flow.kickoff !== undefined && !(FLOW_KICKOFF_KINDS as readonly string[]).includes(flow.kickoff.kind)) {
    findings.push(
      err(obj, 'kickoff/kind', `Flow kickoff.kind "${flow.kickoff.kind}" must be one of ${FLOW_KICKOFF_KINDS.join('|')}`),
    );
  }

  // zero-gate: at least one node must carry a gate, unless disposable:true
  const hasGate = flow.nodes.some((n) => Boolean(n.gate));
  if (!hasGate && !flow.disposable) {
    findings.push(
      err(
        obj,
        'zero-gate',
        `Flow "${flow.id}" has no human gate nodes and is not marked disposable:true — ` +
          'zero-gate flows are rejected to prevent unbounded unattended spending (brain: v1 review-spin incident)',
      ),
    );
  }

  // triggers (R2-04, ADR-041) — see checkFlowTriggers above.
  findings.push(...checkFlowTriggers(flow, agents, opts));

  return findings;
}

// ---------------------------------------------------------------------------
// validateKb
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// validateArtifactTemplate / validateArtifactRef (ADR-027 amendment)
// ---------------------------------------------------------------------------

// validateArtifactTemplate moved to
// `packages/library/studio/library-validate.ts` (M4 library-by-kind carve,
// Part 1; re-exported above). validateArtifactRef, below, STAYS here — it is
// flow-edge validation (`object: 'flow:<id>'`), not one of library's kinds;
// it keeps this divider comment, which the two functions used to share.

// validateInstructionSeed moved to
// `packages/library/studio/library-validate.ts` (M4 library-by-kind carve,
// Part 1; re-exported above).

/**
 * Every FlowEdge.artifact label MUST resolve to a registered artifact template.
 * Promoted from advisory (flag) to error (R3-06/R2-05-F1): ADR-027's own
 * amendment text pre-authorised this once all seed flows ship templates — that
 * condition is now met (all real flow edges resolve to on-disk templates;
 * `forge studio lint` on the pre-promotion base reported 0 `artifact/no-template`
 * findings), so an edge naming an unregistered artifact is now a hard error.
 */
export function validateArtifactRef(flow: FlowDefinition, templateIds: ReadonlySet<string>): Finding[] {
  const findings: Finding[] = [];
  for (const edge of flow.edges) {
    if (!templateIds.has(edge.artifact)) {
      findings.push(
        err(
          `flow:${flow.id}`,
          'artifact/no-template',
          `Edge ${edge.from}→${edge.to} artifact "${edge.artifact}" has no registered template in studio/artifact-templates/`,
        ),
      );
    }
  }
  return findings;
}

export function validateKb(kb: KbDescriptor): Finding[] {
  const findings: Finding[] = [];
  const obj = `kb:${kb.id}`;

  if (!KB_ID_RE.test(kb.id)) {
    findings.push(err(obj, 'slug', `KB id "${kb.id}" does not match ${KB_ID_RE}`));
  }

  // backend (optional) must be a known storage backend. Loader parses it leniently
  // so a typo is a lint error here, not a load crash.
  if (kb.backend !== undefined && !(KB_BACKENDS as readonly string[]).includes(kb.backend)) {
    findings.push(
      err(obj, 'backend', `KB backend "${kb.backend}" must be one of ${KB_BACKENDS.join('|')}`),
    );
  }

  // Note: the `binding` shape (kind enum + ref presence) is already
  // load-guarded in registry (parseKbBinding); we do not duplicate it here.
  // Binding *cross-reference* checks (dangling ref, exactly-one-unique) live
  // in apps/forge/studio-lint.ts, which has the full KB roster + discovered
  // flows/projects needed to check them.

  return findings;
}

// validateCatalog moved to `packages/library/studio/library-validate.ts` (M4
// library-by-kind carve, Part 1; re-exported above).

// validateCommunityRegistry moved to
// `packages/library/studio/library-validate.ts` (M4 library-by-kind carve,
// Part 1; re-exported above).

// ---------------------------------------------------------------------------
// validateConnections MOVED (round-6 FIX-FIRST) to
// `orchestrator/studio/connection-validate.ts` — this file was 997 lines
// against the house 800-line hard cap and this initiative alone added 131 of
// them. Same discipline already applied when `connection-catalog.ts` was
// extracted out of `registry.ts`. `apps/forge/studio-lint.ts` imports
// `validateConnections` from the new module directly (no re-export shim).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// validateProject
// ---------------------------------------------------------------------------

export function validateProject(def: ProjectDefinition): Finding[] {
  const findings: Finding[] = [];
  const obj = `project:${def.id}`;

  // id rule (W7-A4: case-preserving, matched exactly — see PROJECT_ID_RE)
  if (!PROJECT_ID_RE.test(def.id)) {
    findings.push(err(obj, 'slug', `Project id "${def.id}" does not match ${PROJECT_ID_RE}`));
  }

  // northStar: empty → flag; >140 → error
  if (!def.northStar.trim()) {
    findings.push(flag(obj, 'readiness/north-star', 'Project northStar is missing or blank'));
  } else if (def.northStar.length > 140) {
    findings.push(
      err(
        obj,
        'readiness/north-star',
        `Project northStar must be ≤ 140 characters (got ${def.northStar.length})`,
      ),
    );
  }

  // demoProcess: each step's kind must be in the enum
  for (let i = 0; i < def.demoProcess.length; i++) {
    const step = def.demoProcess[i];
    if (!DEMO_STEP_KINDS.includes(step.kind)) {
      findings.push(
        err(
          obj,
          'demoProcess/kind',
          `demoProcess[${i}].kind "${step.kind}" must be one of capture|verify|present`,
        ),
      );
    }
  }

  // skills: all entries must be strings
  for (let i = 0; i < def.skills.length; i++) {
    if (typeof def.skills[i] !== 'string') {
      findings.push(
        err(obj, 'skills/type', `skills[${i}] must be a string (got ${typeof def.skills[i]})`),
      );
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// validateDiscoveredProjects
// ---------------------------------------------------------------------------

/**
 * Validate the disk-discovered project set (B1 — projects are auto-discovered
 * from `<projectsDir>/*` rather than a `studio/projects.yaml` registry). The
 * caller supplies the `discoverProjects` result. Errors: a project id that
 * cannot form a slug (the dir name produced an empty/invalid id) or a duplicate
 * id (two dirs slug to the same id). Flag (warn): a project dir without a
 * `.forge/project.json` — a half-onboarded project forge will skip until its
 * contract file lands.
 */
export function validateDiscoveredProjects(
  projects: ReadonlyArray<{ id: string; path: string; hasConfig: boolean }>,
): Finding[] {
  const findings: Finding[] = [];
  const obj = 'projects';

  // unique-ids
  for (const dup of findDuplicates(projects.map((p) => p.id))) {
    findings.push(err(obj, 'unique-ids', `Duplicate project id "${dup}" (two project dirs carry the same id)`));
  }

  for (const project of projects) {
    // id rule per project id (defensive — discoverProjects only publishes
    // ids that already satisfy PROJECT_ID_RE, W7-A4)
    if (!PROJECT_ID_RE.test(project.id)) {
      findings.push(err(obj, 'slug', `Project id "${project.id}" does not match ${PROJECT_ID_RE}`));
    }
    // half-onboarded: a dir without the contract file is a warn, not an error.
    if (!project.hasConfig) {
      findings.push(
        flag(
          obj,
          'missing-config',
          `Project dir "${project.path}" has no .forge/project.json — forge will skip it until the contract file is added (run \`forge preflight ${project.id}\` / the forge-onboard-project skill).`,
        ),
      );
    }
  }

  return findings;
}
