/**
 * The reflector's brain-writing internals, split out of `reflector.ts` (its
 * 800-line ratchet) at the SAME seam `runReflector` wraps in the brain-write
 * lease: `runReflectorBrainWrites` is every brain write a reflect pass makes
 * (the SDK spawn, the retention patch, per-KB health) and the retention/
 * fresh-theme helpers it alone depends on. See `design.md`'s "Reflector
 * brain-write extraction (forge-ler4)" for the full rationale and
 * `brain-write-lease.ts`'s own doc for the race the lease closes.
 *
 * `ReflectorDeps` stays defined in `reflector.ts` (its public surface); the
 * `import type` back to it below is erased at compile time, so this is not a
 * runtime circular dependency — `reflector.ts` is the only file that imports
 * a VALUE from here.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import type { EventLogger, EventLogEntry } from '@forge/kernel';
import { runAgent } from '@forge/agents/run-agent.ts';
import type { AgentDefinition } from '@forge/contracts/studio/types.ts';
import { classifyCrash } from '@forge/agents/failure-classifier.ts';
import {
  tallyToolUse as tallyReflectorToolUse,
  type ReflectorToolUseSummary,
} from './reflector-binding.ts';
import {
  recordBrainGateResult,
  REFLECTION_LOST_EVENT,
  type CycleInput,
} from '@forge/flows/cycle-context.ts';
import {
  assignRetention,
  collectCitedBy,
  patchArchiveFrontmatter,
  type ThemeMeta,
  type RetentionTag,
} from '@forge/knowledge/cycle-retention.ts';
import { runPostReflectionKbHealth } from '@forge/knowledge/kb-health.ts';
import type { ReflectorDeps } from './reflector.ts';

/**
 * 2.10 reflector pipeline honesty — record the loss of a cycle's reflection
 * in events.jsonl AT THE MOMENT it happens. Every catch/early-return in
 * `runReflector`/`runReflectorBrainWrites` that abandons reflection calls
 * this (a deliberate disposable skip does NOT — that is not a loss).
 */
export function emitReflectionLost(
  logger: EventLogger,
  opts: {
    initiativeId: string;
    parentEventId?: string;
    cause: string;
    detail: string;
    extraMetadata?: Record<string, unknown>;
    /** Seam F4: the executing node's own agent slug (`def.slug`). */
    skill: string;
  },
): void {
  logger.emit({
    initiative_id: opts.initiativeId,
    ...(opts.parentEventId !== undefined ? { parent_event_id: opts.parentEventId } : {}),
    phase: 'reflection',
    skill: opts.skill,
    event_type: 'error',
    input_refs: [],
    output_refs: [],
    message: REFLECTION_LOST_EVENT,
    metadata: { cause: opts.cause, detail: opts.detail, ...(opts.extraMetadata ?? {}) },
  });
}

/** forge-ler4 — every brain write `runReflector` makes, extracted so the
 *  caller can wrap exactly this span in the brain-write lease. */
type ReflectorBrainWriteOk = {
  ok: true;
  costUsd: number;
  durationMs: number;
  resultSubtype: string | undefined;
  retention: ReturnType<typeof computeAndApplyRetention>;
  toolUseSummary: ReflectorToolUseSummary;
};
type ReflectorBrainWriteParams = {
  input: CycleInput; logger: EventLogger; deps: ReflectorDeps;
  startEventId: string | undefined; forgeRoot: string; cycleId: string; projectName: string;
  systemPrompt: string; prompt: string; cycleArchivePath: string; themesDir: string; startedAtMs: number;
  /** Seam F4 — the executing node's own agent def; see `ReflectorDeps.agentDef`. */
  agentDef: AgentDefinition;
};
export async function runReflectorBrainWrites(
  opts: ReflectorBrainWriteParams,
): Promise<ReflectorBrainWriteOk | { ok: false }> {
  const {
    input, logger, deps, startEventId, forgeRoot, cycleId, projectName,
    systemPrompt, prompt, cycleArchivePath, themesDir, startedAtMs, agentDef,
  } = opts;
  // Seam F4: this pass's own def (`reflector.ts` threads it) — used for the
  // spawn AND every emitted event's `skill`, never a hardcoded canonical one.
  const def = agentDef;

  const toolUseSummary: ReflectorToolUseSummary = {
    brainReads: 0,
    themeWrites: 0,
    retroWrites: 0,
    bashCalls: 0,
  };
  let costUsd = 0;
  let durationMs = 0;
  let resultSubtype: string | undefined;

  try {
    // R4-01-F2: the spawn goes through the generic one-shot primitive.
    // `lifecycle: 'caller'` — this pipeline owns the event lifecycle; runAgent
    // emits nothing and returns the totals. Options (model/tools/caps) come
    // from THIS def (seam F4), never a hardcoded canonical path.
    // R4-01 review: the caps moved from undeletable code constants to
    // frontmatter data — fail loud if an edit removes them (mirrors the PM
    // pipeline's maxTurns guard; an uncapped unattended reflector re-opens
    // the silent-spend vector the old constants closed).
    if (def.budgets.maxTurns === undefined || def.budgets.maxBudgetUsd === undefined) {
      throw new Error(
        'reflector SKILL.md must declare budgets.maxTurns and budgets.maxBudgetUsd (R4-01-F2 — the live caps are frontmatter data)',
      );
    }
    const spawn = await runAgent(def, {
      runId: cycleId,
      workdir: forgeRoot,
      cwd: forgeRoot,
      prompt,
      systemPrompt,
      lifecycle: 'caller',
      onMessage: (msg) => {
        if (typeof msg !== 'object' || msg === null) return;
        const m = msg as {
          type?: string;
          message?: { content?: Array<{ type?: string; name?: string; input?: unknown }> };
        };
        if (m.type === 'assistant') tallyReflectorToolUse(m.message, toolUseSummary);
      },
      queryFn: deps.sdkQuery,
    });
    costUsd = spawn.costUsd;
    durationMs = spawn.durationMs ?? 0;
    resultSubtype = spawn.resultSubtype;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: startEventId,
      phase: 'reflection',
      skill: def.slug,
      event_type: 'error',
      input_refs: [logger.logFilePath],
      output_refs: [],
      message: 'reflector.crashed',
      metadata: { error: errMsg },
    });
    // 2.10: classify the crash (G3 classifier) so the loss carries whether a
    // rerun could succeed (transient environment pressure vs deterministic).
    const crash = classifyCrash(errMsg, null);
    emitReflectionLost(logger, {
      initiativeId: input.initiativeId,
      parentEventId: startEventId,
      cause: 'crash',
      detail: errMsg,
      extraMetadata: { crash_kind: crash.kind, crash_reason: crash.reason },
      skill: def.slug,
    });
    return { ok: false };
  }

  // 2.10: a non-success SDK result means the reflector died mid-run
  // (budget/turn exhaustion, execution error) — its outputs are incomplete
  // and the reflection is LOST, not closed. Previously this fell through: a
  // budget-exhausted reflector that had already read the brain cleared the
  // F-13 gate and closed silently (the July silent-loss pattern). Same
  // precedent as release-finalize's non-success handling.
  if (resultSubtype !== undefined && resultSubtype !== 'success') {
    const cause =
      resultSubtype === 'error_max_budget_usd'
        ? 'budget-exhausted'
        : resultSubtype === 'error_max_turns'
          ? 'max-turns'
          : 'error';
    emitReflectionLost(logger, {
      initiativeId: input.initiativeId,
      parentEventId: startEventId,
      cause,
      detail: `reflector SDK run ended with result subtype "${resultSubtype}" — reflection outputs are incomplete`,
      extraMetadata: { result_subtype: resultSubtype, cost_usd: costUsd, duration_ms: durationMs },
      skill: def.slug,
    });
    return { ok: false };
  }

  // F-13: brain-first gate for reflector. Log-and-continue style — reflector
  // failures don't propagate (the merge already happened). The
  // reflection_status field surfaces the failure to telemetry.
  if (
    !recordBrainGateResult('reflection', 'reflector', toolUseSummary.brainReads, {
      initiativeId: input.initiativeId,
      logger,
      parentEventId: startEventId,
    })
  ) {
    emitReflectionLost(logger, {
      initiativeId: input.initiativeId,
      parentEventId: startEventId,
      cause: 'brain-gate-failed',
      detail: 'F-13 brain-first gate failed (zero brain reads) — reflection abandoned before retention/lint/recap',
      skill: def.slug,
    });
    return { ok: false };
  }

  // S6A — retention tagging. Compute retention tier from the cycle's events
  // + the themes the reflector just wrote, then patch the archive's
  // frontmatter (overwriting the agent's placeholder).
  const retention = computeAndApplyRetention({
    forgeRoot,
    projectName,
    cycleId,
    cycleArchivePath,
    themesDir,
    logFilePath: logger.logFilePath,
    sinceMs: startedAtMs,
  });
  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: startEventId,
    phase: 'reflection',
    skill: def.slug,
    event_type: 'log',
    input_refs: [cycleArchivePath],
    output_refs: [cycleArchivePath],
    message: 'reflector.retention-assigned',
    metadata: {
      retention: retention.retention,
      cited_by_count: retention.citedBy.length,
      archive_patched: retention.patched,
    },
  });

  // R4-09-F5 — per-KB post-cycle health. Run each TOUCHED KB's declared
  // processes (ingest = regenerate the index so fresh themes are discoverable;
  // consolidate = deterministic auto-fix of index/route/date gaps) BEFORE the
  // authoritative lint below, so `lint_status` reflects the consolidate fixes.
  // The candidate KBs a reflect run may write: its project KB, the flow/cycles
  // KB (always touched — the cycle archive lands there), and forge-dev.
  const kbHealthFn = deps.kbHealth ?? runPostReflectionKbHealth;
  try {
    kbHealthFn({
      forgeRoot,
      cycleId,
      candidateKbIds: ['cycles', 'forge-dev', projectName],
      sinceMs: startedAtMs,
      logger,
      initiativeId: input.initiativeId,
      parentEventId: startEventId,
    });
  } catch (kbErr) {
    // Best-effort like the rest of the post-agent pipeline — a KB-health crash
    // must never abort the cycle close (the index regen also lives here, so a
    // failure loses the regen; runPostReflectionLint below still runs).
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: startEventId,
      phase: 'reflection',
      skill: def.slug,
      event_type: 'error',
      input_refs: [],
      output_refs: [],
      message: 'reflector.kb-health-failed',
      metadata: { error: kbErr instanceof Error ? kbErr.message : String(kbErr) },
    });
  }

  return { ok: true, costUsd, durationMs, resultSubtype, retention, toolUseSummary };
}

/**
 * Compute retention + cited_by for this cycle and write them into the
 * archive frontmatter. Best-effort: a missing archive (the agent failed to
 * write it) is logged but does not block return — the retention value is
 * still useful telemetry on the reflector.end event.
 */
function computeAndApplyRetention(opts: {
  forgeRoot: string;
  projectName: string;
  cycleId: string;
  cycleArchivePath: string;
  themesDir: string;
  logFilePath: string;
  sinceMs: number;
}): { retention: RetentionTag; citedBy: string[]; patched: boolean } {
  const events = readEventLog(opts.logFilePath);
  const themesWritten = listFreshThemes(opts.themesDir, opts.sinceMs);
  const retention = assignRetention(events, themesWritten);
  const citedBy = collectCitedBy({
    forgeRoot: opts.forgeRoot,
    projectName: opts.projectName,
    cycleId: opts.cycleId,
    sinceMs: opts.sinceMs,
  });
  const patched = patchArchiveFrontmatter(opts.cycleArchivePath, retention, citedBy);
  return { retention, citedBy, patched };
}

/**
 * Read the structured event log and return parsed entries. Best-effort —
 * malformed lines are skipped, a missing file returns []. Same semantics
 * as the failure-classifier's reader (orchestrator/cycle.ts).
 */
function readEventLog(logFilePath: string): EventLogEntry[] {
  const out: EventLogEntry[] = [];
  if (!existsSync(logFilePath)) return out;
  let raw: string;
  try {
    raw = readFileSync(logFilePath, 'utf8');
  } catch {
    return out;
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as EventLogEntry);
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}

/**
 * List theme files the reflector wrote this pass (mtime >= sinceMs).
 * Returns minimal metadata for the retention heuristic. Exported: also used
 * by `reflector.ts`'s own post-write tail (recap + reflection.json) so both
 * files agree on ONE definition of "fresh".
 */
export function listFreshThemes(themesDir: string, sinceMs: number): ThemeMeta[] {
  if (!existsSync(themesDir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(themesDir);
  } catch {
    return [];
  }
  const out: ThemeMeta[] = [];
  for (const file of entries) {
    if (!file.endsWith('.md')) continue;
    const full = resolve(themesDir, file);
    try {
      const st = statSync(full);
      if (st.mtimeMs < sinceMs) continue;
      const raw = readFileSync(full, 'utf8');
      out.push({ path: full, category: extractCategory(raw) });
    } catch {
      /* skip */
    }
  }
  return out;
}

function extractCategory(themeBody: string): string | null {
  // Minimal frontmatter extractor mirroring benchmarks/reflection/scoring.ts.
  if (!themeBody.startsWith('---\n') && !themeBody.startsWith('---\r\n')) return null;
  const end = themeBody.indexOf('\n---', 4);
  if (end === -1) return null;
  const block = themeBody.slice(4, end);
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^category:\s*(.*)$/);
    if (m) {
      let v = m[1].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return v || null;
    }
  }
  return null;
}
