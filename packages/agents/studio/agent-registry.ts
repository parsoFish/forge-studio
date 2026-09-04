/**
 * The Agent kind of the studio object model — its predicates, its loader and
 * its roster listing.
 *
 * WHY IT LIVES HERE NOW. §4 M4 gives this lane "registry loaders split from
 * the registry module". `orchestrator/studio/registry.ts` held every kind at
 * once, so thirteen files in THIS package had to reach up into `orchestrator/`
 * to load an agent — a `package-to-legacy` edge per file, and a round trip:
 * `registry.ts` already imported `@forge/agents/skill-path.ts` and
 * `./materials.ts` and re-exported `./skill-md-fidelity.ts`, so the graph ran
 * agents -> orchestrator -> agents. Moving the Agent kind to the package that
 * owns agents removes the hop rather than relocating it.
 *
 * WHAT IS GENERIC AND WHAT IS NOT. Reading a frontmatter document is generic
 * and lives in `@forge/kernel/studio-object.ts`; deciding what a valid one
 * MEANS is this kind's, so every field name below stays here —
 * `runtime`, `library`, `provenance`, `quarantined`, `brainAccess`,
 * `composition`, `budgets`, `fanout`, `materials`. Kernel names none of them,
 * and its own test asserts that against its source.
 *
 * `orchestrator/studio/registry.ts` re-exports everything here for the ~17
 * host and sibling importers that still resolve the Agent kind through it —
 * transitional rows, disclosed, that die with the host carve (ruling 48/58).
 */
import { join, dirname, basename, resolve } from 'node:path';

import { readFrontmatter, loadStudioObject, type FrontmatterDoc } from '@forge/kernel/studio-object.ts';
import { reqString, optString, optNumber, optBool, stringArray, reqObject, oneOf } from '@forge/kernel/studio/yaml-fields.ts';
import { listSkillMdDirs } from '../skill-path.ts';
import { parseMaterials } from './materials.ts';
import type {
  AgentBudgets,
  AgentComposition,
  AgentDefinition,
  AgentFanout,
  AgentRuntime,
} from '@forge/contracts/studio/types.ts';


const BRAIN_ACCESS = ['mandatory', 'advisory', 'none'] as const;
const MODEL_STRATEGIES = ['fixed', 'range'] as const;
// R2-01-F5: the ONLY four `surface` values seen across the real roster
// (verified 2026-07-18). Checked at LINT time (validateAgent), not load time —
// unlike BRAIN_ACCESS/MODEL_STRATEGIES above, a bad value here should report
// with full lint context (agent:<slug>) instead of crashing the loader,
// mirroring the kb.backend / flow.kickoff.kind precedent. Exported so
// validate.ts (the enum check) and derive.ts (the execution-path mapping)
// share this one source instead of duplicating the literal list.
export const SURFACE_KINDS = ['unattended', 'interactive', 'operator-triggered', 'both'] as const;

// R2-01-F2: the declared phase-executor allowlist. These are the ONLY
// `AgentDefinition.executor` values the flow engine recognises as a
// phase-specific NodeKind — the DECLARED replacement for the old hardcoded
// AGENT_KIND object literal. Set via `executor:` frontmatter on the phase
// SKILL.md files; an agent def with no `executor` resolves to the generic
// 'agent' kind instead. Lives here (not flow-runner.ts) so validate.ts can
// import it for the executor/enum lint check without creating a circular
// import (flow-runner.ts already imports FROM validate.ts for
// findFanOutViolations).
//
// R4-01-F2 (ADR-039) retired the enum row by row as each phase moved to
// declared dispatch (loopStrategy + band guards): 'reflect' with the reflector
// migration, 'pm' with the plan agent, 'dev' with the ralph loopStrategy
// routing. 'unifier' was the LAST row — retired in R4-01-F4 (the develop flow's
// successor demo + adversarial-review nodes replace it). No phase executors
// remain: every phase is now a generic agent or a band guard, so any `executor:`
// declaration on an agent def is invalid (validate.ts rejects it).
export const PHASE_EXECUTOR_KINDS = [] as const;

/** Shared frontmatter read for `isStudioAgent`/`isUnfilteredStudioAgent` —
 *  one read for both predicates, not two independently-maintained copies.
 *  `null` for an unreadable file or non-object frontmatter, which both callers
 *  treat as "not a studio agent". The read itself is kernel's now; what is
 *  left here is the only part that was ever agent-specific — nothing. */
function readAgentFrontmatter(skillMdPath: string): Record<string, unknown> | null {
  return readFrontmatter(skillMdPath)?.data ?? null;
}

export function isStudioAgent(skillMdPath: string): boolean {
  const d = readAgentFrontmatter(skillMdPath);
  if (!d) return false;
  // D4: a `provenance:`/`quarantined:` block ⇒ this went through the install
  // pipeline and can never be a studio agent again, whatever its `runtime:` looks like.
  if ('provenance' in d || 'quarantined' in d) return false;
  // A studio (library) agent has a `runtime` block — UNLESS it opts out with
  // `library: false`. Internal/system agents (e.g. brain-fix, dispatched by
  // the bridge, never composed into a flow) set that flag so they keep a
  // runtime spec for deriveAgentSpec but stay out of the composable roster.
  return 'runtime' in d && d.library !== false;
}

/**
 * Same "is this a real, non-quarantined studio agent" check as
 * `isStudioAgent`, WITHOUT the `library:false` roster gate.
 *
 * `library:false` keeps an agent OUT of the composable-roster listing
 * (`listAgentDefinitions`) — it says nothing about whether the SKILL.md
 * itself is a valid studio agent with a real capability envelope to read.
 * Every kickoff-only system agent (demo-builder, instructions-creator,
 * brain-maintenance, creation-agent, project-brain-builder) sets
 * `library:false` for exactly that roster reason, yet still declares a real
 * `runtime:` block the session-kickoff page's model-tier picker needs (W6-B6
 * fix). Used by the capability-only route (`GET
 * /api/studio/agents/:slug/capability`, packages/sessions/bridge-studio-agent-capability.ts)
 * that resolves ONE named slug directly, never the filtered roster.
 */
export function isUnfilteredStudioAgent(skillMdPath: string): boolean {
  const d = readAgentFrontmatter(skillMdPath);
  if (!d) return false;
  if ('provenance' in d || 'quarantined' in d) return false;
  return 'runtime' in d;
}

export function loadAgentDefinition(skillMdPath: string): AgentDefinition {
  return loadStudioObject(skillMdPath, validateAgentDocument);
}

/**
 * The Agent kind's validator: what makes a frontmatter document an agent.
 *
 * This is the half kernel deliberately does not have. Every field name below
 * is agent vocabulary, and the error messages carry `doc.path` so a bad
 * SKILL.md names itself rather than making the caller guess which of a hundred
 * it was.
 */
function validateAgentDocument(doc: FrontmatterDoc): AgentDefinition {
  const skillMdPath = doc.path;
  const d = doc.data;
  const content = doc.content;

  if (!('runtime' in d)) {
    throw new Error(`${skillMdPath}: not a studio SKILL.md — frontmatter has no "runtime" block`);
  }

  const name = reqString(d, 'name', skillMdPath);
  const description = reqString(d, 'description', skillMdPath);
  const phase = optString(d, 'phase');
  const surface = optString(d, 'surface');
  const executor = optString(d, 'executor');
  const purpose = reqString(d, 'purpose', skillMdPath);
  const brainAccess = oneOf(reqString(d, 'brainAccess', skillMdPath), BRAIN_ACCESS, skillMdPath, 'brainAccess');
  const interactivity = reqString(d, 'interactivity', skillMdPath);

  const rawComposition = d['composition'];
  const comp: Record<string, unknown> =
    rawComposition != null && typeof rawComposition === 'object' && !Array.isArray(rawComposition)
      ? (rawComposition as Record<string, unknown>)
      : {};
  // ADR-027 R3-03 amendment ("R3-03, 2026-08-04"): composition.hooks is
  // REINTRODUCED with a narrowed meaning — library lifecycle-hook ids only,
  // resolved against the hooks registry (orchestrator/studio/hook-library.ts),
  // never a platform guard id. Symmetric enforcement of the split
  // (guard-in-hooks / hook-in-guards / unknown-hook-ref) is a lint concern
  // (lintHookComposition), not a load-time throw — a load-time throw here
  // would make it impossible to even SURFACE the wrong-field lint finding for
  // an otherwise well-formed agent def.
  const composition: AgentComposition = {
    skills: stringArray(comp, 'skills', skillMdPath),
    tools: stringArray(comp, 'tools', skillMdPath),
    mcps: stringArray(comp, 'mcps', skillMdPath),
    guards: stringArray(comp, 'guards', skillMdPath),
    hooks: stringArray(comp, 'hooks', skillMdPath),
  };

  const rawRuntime = reqObject(d, 'runtime', skillMdPath);
  const runtime: AgentRuntime = {
    sdk: reqString(rawRuntime, 'sdk', skillMdPath),
    strategy: oneOf(reqString(rawRuntime, 'strategy', skillMdPath), MODEL_STRATEGIES, skillMdPath, 'strategy'),
    model: optString(rawRuntime, 'model'),
    range: rawRuntime['range'] !== undefined ? stringArray(rawRuntime, 'range', skillMdPath) : undefined,
    loopStrategy: optString(rawRuntime, 'loopStrategy'),
  };

  const rawBudgets = d['budgets'];
  const budgetsRaw: Record<string, unknown> =
    rawBudgets != null && typeof rawBudgets === 'object' && !Array.isArray(rawBudgets)
      ? (rawBudgets as Record<string, unknown>)
      : {};
  const budgets: AgentBudgets = {
    iterationFloor: optNumber(budgetsRaw, 'iterationFloor'),
    iterationCap: optNumber(budgetsRaw, 'iterationCap'),
    maxTurnsPerIteration: optNumber(budgetsRaw, 'maxTurnsPerIteration'),
    wedgeKillMs: optNumber(budgetsRaw, 'wedgeKillMs'),
    maxTurns: optNumber(budgetsRaw, 'maxTurns'),
    maxBudgetUsd: optNumber(budgetsRaw, 'maxBudgetUsd'),
    maxBudgetUsdShare: optNumber(budgetsRaw, 'maxBudgetUsdShare'),
  };

  // R2-03-F2 — optional fanout capability block. Absent ⇒ not fanout-capable.
  const rawFanout = d['fanout'];
  const fanout: AgentFanout | undefined =
    rawFanout != null && typeof rawFanout === 'object' && !Array.isArray(rawFanout)
      ? {
          drivingArtifact: reqString(rawFanout as Record<string, unknown>, 'drivingArtifact', skillMdPath),
          isolation: reqString(rawFanout as Record<string, unknown>, 'isolation', skillMdPath),
          concurrencyCap: optNumber(rawFanout as Record<string, unknown>, 'concurrencyCap'),
          perItemGate: optString(rawFanout as Record<string, unknown>, 'perItemGate'),
        }
      : undefined;

  const allowedTools = stringArray(d, 'allowed-tools', skillMdPath);
  const disallowedTools = stringArray(d, 'disallowed-tools', skillMdPath);
  const library = optBool(d, 'library');

  // R2-09 D1 — lenient on VALUES (an unknown material string survives; lint's
  // job, not the loader's), strict on SHAPE (parseMaterials throws on a
  // non-array/non-string entry). Rethrown with the file path so this loader's
  // error messages stay consistent with every other field in this function.
  let materials: string[] | undefined;
  try {
    materials = parseMaterials(d['materials']);
  } catch (err) {
    throw new Error(`${skillMdPath}: ${(err as Error).message}`);
  }

  const slug = basename(dirname(skillMdPath));

  return {
    slug,
    name,
    description,
    library,
    phase,
    surface,
    executor,
    purpose,
    composition,
    runtime,
    ...(fanout ? { fanout } : {}),
    ...(materials !== undefined ? { materials } : {}),
    brainAccess,
    interactivity,
    budgets,
    allowedTools,
    disallowedTools,
    body: content,
    path: skillMdPath,
  };
}

// Agent SKILL.md byte-fidelity serialization (projectAgentFrontmatter,
// deepValueEqual, normalizeAbsentOptionalArrays, serializeAgentDefinition)
// lives in ./skill-md-fidelity.ts (extracted to keep this file under the
// 800-line cap — 2026-08-05, finding C/11). Re-exported here so existing
// importers keep resolving `serializeAgentDefinition` from './registry.ts';
// it remains the ONE canonical serializer (ADR-027).

// lives in ./skill-md-fidelity.ts (extracted to keep this file under the
// 800-line cap — 2026-08-05, finding C/11). Re-exported here so existing
// importers keep resolving `serializeAgentDefinition` from './registry.ts';
// it remains the ONE canonical serializer (ADR-027).
export { serializeAgentDefinition } from '@forge/agents/studio/skill-md-fidelity.ts';

export function listAgentDefinitions(skillsDir: string): AgentDefinition[] {
  const defs: AgentDefinition[] = [];
  for (const dir of listSkillMdDirs(skillsDir)) {
    const skillMdPath = join(dir, 'SKILL.md');
    if (!isStudioAgent(skillMdPath)) continue;
    defs.push(loadAgentDefinition(skillMdPath));
  }

  return defs.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * The curated "out of the box" starter agents (ADR-033) under
 * `studio/starters/agents/`. These are templates the New-Agent picker offers,
 * copied into `skills/<name>/` on install rather than run in place — but
 * `forge studio lint` DOES scan this tree directly too (`lintSkillToolFence`
 * of `packages/library/studio-lint-tool-fence.ts`'s `lintStarterAgentToolFence`, added
 * forge-6gv.18): a template that violates the tool-fence rule fails the gate
 * at source, before any operator ever installs it. Returns [] if the dir is
 * absent so a checkout without starters degrades gracefully rather than
 * throwing.
 */
export function listStarterAgents(forgeRoot: string): AgentDefinition[] {
  const dir = join(resolve(forgeRoot), 'studio', 'starters', 'agents');
  try {
    return listAgentDefinitions(dir);
  } catch {
    return [];
  }
}
