/**
 * Agent definition validation (ADR 027, §6) — the `agent` half of what was
 * `orchestrator/studio/validate.ts`'s five-kind pile, moved here by T1 ruling
 * 159 so the rule lives with the vocabulary it checks: every enum this file
 * reads (`SURFACE_KINDS`, `PHASE_EXECUTOR_KINDS`, `MATERIAL_KINDS`,
 * `BAND_CANONICAL_SLUG`, the capability descriptor) is already owned by
 * `packages/agents`, and the id rule it applies is `@forge/kernel`'s.
 *
 * Pure semantic checks — no I/O, no mutation of inputs. Consumed by the
 * bridge's agent PUT route and `forge studio lint`, both in `apps/forge`.
 */

import type { AgentDefinition } from '@forge/contracts/studio/types.ts';
import { FANOUT_ISOLATION_KINDS } from '@forge/contracts/studio/types.ts';
import { type Finding, err, flag } from '@forge/kernel/findings.ts';
import { SLUG_RE } from '@forge/kernel/ids.ts';
import { SURFACE_KINDS, PHASE_EXECUTOR_KINDS } from './agent-registry.ts';
import { MATERIAL_KINDS } from './materials.ts';
import { BAND_CANONICAL_SLUG } from '../agent-bands.ts';

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
