/**
 * Row 157 (bead forge-8vfn.8.1.45, ruling 1873) — the acceptance-gate
 * requirement told to the PM up front (D-34, ONE source shared
 * with the post-hoc gate), and the ONE bounded revise turn a violation earns
 * before quarantine. `runPmAcceptanceRevise` only runs the bounded spawn
 * itself; `project-manager.ts` (the caller) re-reads the revised set and puts
 * it back through the SAME `appendStandingAcs` + `compileWorkItemSpecs` +
 * `validateWorkItemSet` stage the first pass used — both of those are
 * idempotent on already-processed items (see `runCompileStage`'s own doc
 * comment there), so a revise-added acceptance WI gets its standing ACs,
 * constraint clauses and hidden-coupling / creates-mandatory enforcement,
 * not a second-class pass-through.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EventLogger } from '@forge/kernel';
import { runAgent, resolveOneShotBudgetUsd, type StreamQueryFn } from '@forge/agents';
import type { AgentDefinition, InitiativeManifest } from '@forge/contracts';
import type { AcceptanceGateConfig } from '@forge/projects';
import {
  compileWorkItemSpecs,
  serializeWorkItem,
  type CouplingPair,
  type CycleInput,
  type WorkItem,
} from '@forge/flows';
import { requireCycleId } from './cycle-id.ts';

/** Human text for the requirement, shared VERBATIM by the brief
 *  (`pm-binding.ts`) and the violation message (`project-manager.ts`) — one
 *  source, not a second copy. Null when acceptance is advisory. */
export function describeAcceptanceRequirement(
  acceptance: 'required' | 'advisory',
  accGate: AcceptanceGateConfig,
): string | null {
  if (acceptance === 'advisory') return null;
  const requiresEnv = (accGate.requires_env ?? []).length > 0;
  // Derive the wording from the project's own gate config: a gate that
  // requires env vars proves the change against a real external system (so
  // call it the "live acceptance suite"); a creds-free gate is just "the
  // acceptance suite". No project-flavoured language is hardcoded here.
  const suiteName = requiresEnv
    ? `the live acceptance suite (proving the change against the real external system; ` +
      `requires ${accGate.requires_env!.join(', ')})`
    : 'the acceptance suite';
  return (
    `this class requires ≥ 1 work item whose quality_gate_cmd targets ` +
    `"${accGate.match}" — ${suiteName}.`
  );
}

/** The gate's own violation, or null — shared by the first pass and the
 *  post-revise re-check (`project-manager.ts`, both call sites). */
export function acceptanceGateViolation(
  items: readonly WorkItem[],
  acceptance: 'required' | 'advisory',
  accGate: AcceptanceGateConfig,
): string | null {
  const requirement = describeAcceptanceRequirement(acceptance, accGate);
  const hasWi = items.some((it) => (it.quality_gate_cmd ?? []).some((tok) => tok.includes(accGate.match)));
  if (!requirement || hasWi) {
    return null;
  }
  return `no acceptance work item: ${requirement} Add an acceptance WI whose gate runs that suite.`;
}

/** Heading for the project-contract standing-AC section injected per WI. */
const STANDING_ACS_HEADER = '## Standing acceptance criteria (project contract)';

/**
 * PURE MOVE from project-manager.ts (row 157, closing the disclosed scope cut
 * — see `runCompileStage`'s own doc comment below): unchanged logic, moved
 * here so it can sit beside the compile step that calls it, and so
 * `project-manager.ts` stays under its own 800-line file cap.
 *
 * A2b (2026-06-06) — append the project's `standing_work_item_acs` to every WI
 * body as a fixed contract section, then re-serialise the file. Body-only
 * (frontmatter byte-stable via `serializeWorkItem`), idempotent (a WI already
 * carrying the header is left untouched — safe on resume). Best-effort per
 * file: a write error leaves that WI unchanged rather than failing the PM pass.
 * Returns the items with their in-memory bodies updated to match disk.
 */
function appendStandingAcs(
  workItemsDir: string,
  items: ReadonlyArray<WorkItem>,
  standingAcs: ReadonlyArray<string>,
): WorkItem[] {
  const section = [
    STANDING_ACS_HEADER,
    '',
    'These project-wide testing invariants apply to **every** work item in this initiative, ' +
      'in addition to the work-specific acceptance criteria above. The dev-loop must satisfy ' +
      'them and the reviewer must confirm them:',
    '',
    ...standingAcs.map((ac) => `- ${ac}`),
  ].join('\n');
  return items.map((item) => {
    if (item.body.includes(STANDING_ACS_HEADER)) {
      return item; // idempotent
    }
    const updated: WorkItem = { ...item, body: `${item.body.replace(/\s+$/, '')}\n\n${section}\n` };
    try {
      writeFileSync(join(workItemsDir, `${item.work_item_id}.md`), serializeWorkItem(updated));
      return updated;
    } catch {
      return item; // best-effort — never fail the PM pass on a write error
    }
  });
}

export type RunCompileStageOptions = {
  workItemsDir: string;
  standingAcs: readonly string[];
  /** `p.constraintSourcesRoot ?? forgeRoot` — resolved once by the caller. */
  constraintSourcesRoot: string;
  manifest: InitiativeManifest;
  /** The worktree — ralph-spec-lint searches the PROJECT tree for
   *  existing/created test files, not `constraintSourcesRoot` (which has no
   *  project source at all). */
  projectRoot: string;
  logger: EventLogger;
  initiativeId: string;
  parentEventId: string;
  items: WorkItem[];
};

export type CompileStageResult = {
  items: WorkItem[];
  compileErrors: string[];
  couplingViolations: CouplingPair[];
};

/**
 * D-17 (wi-spec-compiler, deterministic core) + A2b's `appendStandingAcs`,
 * composed into ONE step so it can run TWICE on the SAME terms: once over the
 * PM's own decomposition (`project-manager.ts`'s first pass), and again over
 * the revised set a row-157 acceptance-gate turn produces. Both steps are
 * idempotent by construction, so re-running them over unchanged items is a
 * no-op: `appendStandingAcs` skips a WI that already carries the standing-ACs
 * header, and `compileWorkItemSpecs`'s three passes are each keyed off
 * durable state rather than "did this run before" — constraint injection
 * anchors on the clause's own stable id and no-ops on identical content
 * (wi-spec-compile.ts's own doc comment), hidden-coupling detection skips any
 * pair already connected by a `depends_on` edge in EITHER direction
 * (`detectHiddenCoupling`'s `reachable` check, work-item.ts), and the
 * creates-mandatory / sizing invariants are pure re-reads with no state to
 * duplicate. A WI the revise turn ADDS therefore gets the exact same standing
 * ACs, constraint clauses, hidden-coupling resolution and creates-mandatory
 * enforcement the first pass's WIs already got — never a second-class work
 * item that reaches the dev loop uncompiled.
 *
 * A compiler THROW (malformed constraint source, unreadable file) is a
 * loud-but-controlled failure: it funnels into `compileErrors` → the caller's
 * `setErrors` → the same failure outcome + final error event every other
 * validation failure uses — `runOnePmPass`'s no-throw contract holds.
 */
export function runCompileStage(opts: RunCompileStageOptions): CompileStageResult {
  const staged =
    opts.standingAcs.length > 0
      ? appendStandingAcs(opts.workItemsDir, opts.items, opts.standingAcs)
      : opts.items;
  if (staged.length === 0) {
    return { items: staged, compileErrors: [], couplingViolations: [] };
  }
  try {
    const compiled = compileWorkItemSpecs({
      forgeRoot: opts.constraintSourcesRoot,
      projectName: opts.manifest.project,
      manifest: opts.manifest,
      workItemsDir: opts.workItemsDir,
      projectRoot: opts.projectRoot,
      items: staged,
      logger: opts.logger,
      initiativeId: opts.initiativeId,
      parentEventId: opts.parentEventId,
    });
    return {
      items: compiled.items,
      compileErrors: compiled.compileErrors,
      couplingViolations: compiled.unresolvedCoupling,
    };
  } catch (err) {
    return {
      items: staged,
      compileErrors: [`wi-spec-compile: ${(err as Error).message}`],
      couplingViolations: [],
    };
  }
}

// The bounded revise pass's caps — a fraction of the PM's own, never a second full pass.
const REVISE_TURN_FRACTION = 0.15;
const REVISE_MIN_TURNS = 5;
const REVISE_BUDGET_FRACTION = 0.2;

export type PmAcceptanceReviseInput = {
  input: CycleInput;
  logger: EventLogger;
  parentEventId: string;
  /** Seam F4 — the executing node's own def; also the revise spawn's def. */
  def: AgentDefinition;
  queryFn: StreamQueryFn;
  systemPrompt: string;
  /** The gate's own message (`accGateViolation`), fed to the PM verbatim. */
  violation: string;
  /** Parity with the main spawn's `maxBudgetUsdShare` input — the SAME
   *  initiative budget the first pass resolved its own cap against. */
  costBudgetUsd?: number;
  signal?: AbortSignal;
};

/** One bounded extra `runAgent` pass. Never a loop — one call, one outcome;
 *  the caller re-reads `.forge/work-items/` and re-checks the gate after. */
export async function runPmAcceptanceRevise(
  p: PmAcceptanceReviseInput,
): Promise<{ costUsd: number; durationMs: number }> {
  const { input, logger, parentEventId, def, queryFn, systemPrompt, violation, costBudgetUsd, signal } = p;
  const emit = (message: string, metadata: Record<string, unknown>): void => {
    logger.emit({
      initiative_id: input.initiativeId, parent_event_id: parentEventId, phase: 'project-manager',
      skill: def.slug, event_type: 'log', input_refs: [], output_refs: [], message, metadata,
    });
  };
  emit('pm.acceptance-revise.start', { violation });
  const reviseDef: AgentDefinition = {
    ...def,
    budgets: {
      ...def.budgets,
      maxTurns: Math.max(REVISE_MIN_TURNS, Math.ceil((def.budgets.maxTurns ?? 0) * REVISE_TURN_FRACTION)),
    },
  };
  const budget = resolveOneShotBudgetUsd(def.budgets, { id: input.initiativeId, costBudgetUsd });
  const prompt = [
    '# Acceptance-gate revise (one bounded turn)',
    '',
    `Your work-item set at \`.forge/work-items/\` does not satisfy the project's ` +
      `acceptance-gate requirement: ${violation}`,
    '',
    'Revise the EXISTING set — add or edit a work item — so at least one ' +
      'quality_gate_cmd targets that suite. Do not remove valid unrelated work. Then stop.',
  ].join('\n');
  const spawn = await runAgent(reviseDef, {
    runId: `${requireCycleId(input, 'runPmAcceptanceRevise')}-pm-acc-revise`,
    workdir: input.worktreePath,
    cwd: input.worktreePath,
    prompt,
    systemPrompt,
    lifecycle: 'caller',
    logger,
    streamGuard: { label: 'project-manager-acceptance-revise', signal },
    kickoffCeilingUsd: budget !== undefined ? budget * REVISE_BUDGET_FRACTION : undefined,
    bindings: { initiative: { id: input.initiativeId, manifestPath: input.manifestPath, costBudgetUsd } },
    queryFn,
  });
  emit('pm.acceptance-revise.end', { cost_usd: spawn.costUsd, result_subtype: spawn.resultSubtype });
  return { costUsd: spawn.costUsd, durationMs: spawn.durationMs ?? 0 };
}
