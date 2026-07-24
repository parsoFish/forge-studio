/**
 * Reflection phase runner. Extracted from cycle.ts (Phase 3.4c step 2).
 *
 * Runs after a successful merge to extract patterns from the cycle's event
 * log + merged tree into brain themes. Behaviour is identical to the prior
 * in-cycle implementation — this module only relocates the code so the
 * orchestration spine stays thin.
 *
 * S6A — after the agent exits successfully, this module additionally:
 *   1. runs `brain-lint --scope cycle-touched-themes --cycle <id>` and
 *      surfaces the outcome on a new sibling `lint_status` field of
 *      `CycleResult` (per CONTRACTS.md C8 — NOT a new `reflection_status`
 *      enum value);
 *   2. tags the cycle archive (`brain/cycles/_raw/<id>.md`) with a
 *      `retention` tier + `cited_by` list so plan 01's cleanup pass has
 *      a load-bearing signal for which archives to keep vs. summarise;
 *   3. derives `user-questions.json` from the agent-written
 *      `user-questions.md` so the in-UI /reflect screen can render the
 *      structured questions without the agent needing to write two files
 *      (REF-1 fix: the agent only ever wrote the .md; the .json is
 *      derived here post-exit);
 *   4. calls `regenerateBrainIndex` after theme writes so the brain index
 *      stays current without a separate operator step.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseRetroMd } from '../../cli/reflection-doc.ts';

import type { EventLogger, EventLogEntry } from '../logging.ts';
import { parseManifest } from '../manifest.ts';
import { runAgent } from '../run-agent.ts';
import type { StreamQueryFn } from '../pinned-sdk-query.ts';
import { loadAgentDefinition } from '../studio/registry.ts';
import { skillPath } from '../skill-path.ts';
import {
  buildReflectorSystemPrompt,
  renderReflectorUserPrompt,
  tallyToolUse as tallyReflectorToolUse,
  type ReflectorToolUseSummary,
} from './reflector-binding.ts';
import {
  recordBrainGateResult,
  REFLECTION_LOST_EVENT,
  type CycleInput,
  type LintStatus,
  type ReflectionStatus,
  type ReflectorPhaseResult,
} from '../cycle-context.ts';
import { classifyCrash } from '../failure-classifier.ts';
import { runBrainLint, type RunBrainLintResult } from '../../cli/brain-lint.ts';
import {
  assignRetention,
  collectCitedBy,
  patchArchiveFrontmatter,
  type ThemeMeta,
  type RetentionTag,
} from '../../cli/cycle-retention.ts';
import { writeCycleRecap } from '../../cli/cycle-recap.ts';
import { cyclesThemesDir, projectThemesDir } from '../brain-paths.ts';
import { regenerateBrainIndex } from '../../cli/brain-index.ts';

// The live turn/budget caps (60 turns / $1.50 — bench 5-fixture median was
// ~$0.74, the cap gives 2x headroom) are DECLARED DATA now: `budgets.maxTurns`
// / `budgets.maxBudgetUsd` in skills/reflector/SKILL.md, resolved by
// `runAgent`'s one-shot path (R4-01-F2, ADR-039).

/**
 * Optional injectables for testing. The brain-lint runner is the only one
 * that needs DI in the wild — tests want to stub clean / flagged / missing
 * outcomes without touching disk. The SDK query is reused as-is from the
 * production codepath; tests that need a stub agent call into the
 * orchestrator via the bench's existing SDK harness (benchmarks/reflection/sdk.ts).
 */
/**
 * SDK-query shape we depend on. Loosened from the SDK's full `Query` type
 * (which the SDK exports as a complex class with `interrupt`, `setModel`,
 * etc.) so test stubs can supply a simple async generator. The real
 * production path passes `sdkQuery` directly via `as unknown` cast.
 */
export type ReflectorSdkQuery = (input: {
  prompt: string;
  options: Record<string, unknown>;
}) => AsyncIterable<unknown>;

export type ReflectorDeps = {
  brainLint?: (opts: { cwd: string; cycleId: string }) => RunBrainLintResult;
  sdkQuery?: ReflectorSdkQuery;
};

/**
 * 2.10 reflector pipeline honesty — record the loss of a cycle's reflection
 * in events.jsonl AT THE MOMENT it happens. Every catch/early-return in
 * `runReflector` that abandons reflection calls this (a deliberate disposable
 * skip does NOT — that is not a loss). Emitted with phase `reflection` so the
 * run-model maps it onto the reflect node, and consumed by
 * `run-model-derive.findReflectionLoss` + the reflect-reconcile boot log.
 */
export function emitReflectionLost(
  logger: EventLogger,
  opts: {
    initiativeId: string;
    parentEventId?: string;
    cause: string;
    detail: string;
    extraMetadata?: Record<string, unknown>;
  },
): void {
  logger.emit({
    initiative_id: opts.initiativeId,
    ...(opts.parentEventId !== undefined ? { parent_event_id: opts.parentEventId } : {}),
    phase: 'reflection',
    skill: 'reflector',
    event_type: 'error',
    input_refs: [],
    output_refs: [],
    message: REFLECTION_LOST_EVENT,
    metadata: { cause: opts.cause, detail: opts.detail, ...(opts.extraMetadata ?? {}) },
  });
}

/**
 * Reflection phase. Runs after a successful merge to extract patterns from the
 * cycle's event log + merged tree into brain themes. Closes the learning loop.
 *
 * Failure mode: log-and-continue. A thrown reflector returns
 * `reflection_status: 'failed'` but does not propagate — the merge already
 * happened in `runReviewer`, and reflection cannot un-merge.
 *
 * Every abandonment path additionally emits `cycle.reflection-lost` (2.10) so
 * the loss is visible in events.jsonl + Studio when it happens — ten July
 * cycles closed as done with reflection silently missing.
 *
 * Live invocation contract (prompt builders + tool tally) lives in
 * orchestrator/phases/reflector-binding.ts (single source of truth).
 */
export async function runReflector(
  input: CycleInput,
  logger: EventLogger,
  deps: ReflectorDeps = {},
): Promise<ReflectorPhaseResult> {
  const start = logger.emit({
    initiative_id: input.initiativeId,
    phase: 'reflection',
    skill: 'reflector',
    event_type: 'start',
    input_refs: [input.manifestPath, logger.logFilePath],
    output_refs: [],
    message: 'reflector.start',
  });
  const startedAtMs = Date.now();

  const forgeRoot = resolve(import.meta.dirname, '..', '..');
  const cycleId = logger.cycleId;
  const cycleLogDir = resolve(forgeRoot, '_logs', cycleId);

  // Reflection runs after the reviewer merged the initiative, which moves the
  // manifest from `_queue/in-flight/` to `_queue/done/`. The cycle was kicked
  // off with the in-flight path, so we look up the current location before
  // reading. Fall back to the original path so this stays compatible with
  // bench harnesses that point directly at a stable manifest.
  const manifestPath = resolveCurrentManifestPath(input.manifestPath, forgeRoot);

  let projectName: string;
  let origin: 'architect' | 'human-directed' = 'architect';
  let disposable = false;
  try {
    const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
    projectName = manifest.project;
    // G6: carry the cohort tag onto reflector.end so a reflection-cohort
    // reader (autonomous vs hand-directed) can split retros the same way
    // `forge metrics` splits cycles.
    origin = manifest.origin;
    disposable = manifest.disposable ?? false;
  } catch (err) {
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'reflection',
      skill: 'reflector',
      event_type: 'error',
      input_refs: [manifestPath],
      output_refs: [],
      message: 'reflector.manifest-unreadable',
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    emitReflectionLost(logger, {
      initiativeId: input.initiativeId,
      parentEventId: start.event_id,
      cause: 'manifest-unreadable',
      detail: err instanceof Error ? err.message : String(err),
    });
    return { reflection_status: 'failed', lint_status: 'skipped' };
  }

  // cascade-v4 #7: a throwaway / verification cycle must NOT pollute the durable
  // brain. Skip reflection entirely (no themes, no cycle archive) — the cycle
  // still merged + closed; we just don't accrete brain artifacts from a run that
  // exists only to exercise the harness.
  if (disposable) {
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'reflection',
      skill: 'reflector',
      event_type: 'end',
      input_refs: [manifestPath],
      output_refs: [],
      message: 'reflector.skipped-disposable',
      metadata: { project: projectName, reason: 'manifest disposable: true — throwaway/verification cycle, not reflected into the durable brain' },
    });
    return { reflection_status: 'skipped', lint_status: 'skipped' };
  }

  const systemPrompt = buildReflectorSystemPrompt(forgeRoot);
  const cycleArchivePath = resolve(forgeRoot, 'brain', 'cycles', '_raw', `${cycleId}.md`);
  const themesDir = projectThemesDir(forgeRoot, projectName);
  // F-07: ensure brain destination dirs exist before invoking the SDK; the
  // reflector writes here directly. A first-time project (no themes/ yet) or
  // a fresh forge install (no brain/cycles/_raw/) would otherwise see ENOENT
  // inside the agent and silently log-and-continue-fail.
  mkdirSync(resolve(forgeRoot, 'brain', 'cycles', '_raw'), { recursive: true });
  mkdirSync(themesDir, { recursive: true });
  // cascade-v4 #7: the forge-machinery themes dir is a first-class reflector
  // output so forge lessons route here instead of into the project's Brain 3.
  const forgeThemesDir = cyclesThemesDir(forgeRoot);
  mkdirSync(forgeThemesDir, { recursive: true });
  // F-12: touch brain-gaps.jsonl if absent. The reflector's user prompt
  // points it at this file; the bench fixtures pre-populate it. In live
  // cycles, gaps are agent-driven (brain-query SKILL writes to it). For the
  // production path, an empty file is a valid signal of "no gaps recorded
  // this cycle" — better than ENOENT bouncing the agent's Read attempt.
  // A real orchestrator-side gap producer is deferred to pass-3 (would
  // require post-cycle event-log scanning).
  const brainGapsPath = resolve(cycleLogDir, 'brain-gaps.jsonl');
  if (!existsSync(brainGapsPath)) {
    mkdirSync(cycleLogDir, { recursive: true });
    writeFileSync(brainGapsPath, '');
  }
  const prompt = renderReflectorUserPrompt({
    initiativeId: input.initiativeId,
    cycleId,
    manifestRelPath: manifestPath,
    eventLogRelPath: logger.logFilePath,
    brainGapsRelPath: resolve(cycleLogDir, 'brain-gaps.jsonl'),
    mergedTreeRelPath: input.projectRepoPath,
    projectName,
    userQuestionsRelPath: resolve(cycleLogDir, 'user-questions.md'),
    userFeedbackRelPath: resolve(cycleLogDir, 'user-feedback.md'),
    retroRelPath: resolve(cycleLogDir, 'retro.md'),
    cycleArchiveRelPath: cycleArchivePath,
    themesDirRelPath: themesDir,
    forgeThemesDirRelPath: forgeThemesDir,
  });

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
    // `lifecycle: 'caller'` — this pipeline owns the event lifecycle (the
    // reflector.start/end pair around this call); runAgent emits nothing and
    // returns the totals. Options (model/tools from the derived spec, caps
    // from the SKILL.md `budgets`) are pinned byte-identical to the previous
    // inline build by the golden spawn-capture suite. Per-message telemetry
    // stays here via the onMessage observer (ADR-036: judgments never move
    // into the primitive).
    const def = loadAgentDefinition(skillPath('reflector'));
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
      queryFn: deps.sdkQuery as StreamQueryFn | undefined,
    });
    costUsd = spawn.costUsd;
    durationMs = spawn.durationMs ?? 0;
    resultSubtype = spawn.resultSubtype;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'reflection',
      skill: 'reflector',
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
      parentEventId: start.event_id,
      cause: 'crash',
      detail: errMsg,
      extraMetadata: { crash_kind: crash.kind, crash_reason: crash.reason },
    });
    return { reflection_status: 'failed', lint_status: 'skipped' };
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
      parentEventId: start.event_id,
      cause,
      detail: `reflector SDK run ended with result subtype "${resultSubtype}" — reflection outputs are incomplete`,
      extraMetadata: { result_subtype: resultSubtype, cost_usd: costUsd, duration_ms: durationMs },
    });
    return { reflection_status: 'failed', lint_status: 'skipped' };
  }

  // F-13: brain-first gate for reflector. Log-and-continue style — reflector
  // failures don't propagate (the merge already happened). The
  // reflection_status field surfaces the failure to telemetry.
  if (
    !recordBrainGateResult('reflection', 'reflector', toolUseSummary.brainReads, {
      initiativeId: input.initiativeId,
      logger,
      parentEventId: start.event_id,
    })
  ) {
    emitReflectionLost(logger, {
      initiativeId: input.initiativeId,
      parentEventId: start.event_id,
      cause: 'brain-gate-failed',
      detail: 'F-13 brain-first gate failed (zero brain reads) — reflection abandoned before retention/lint/recap',
    });
    return { reflection_status: 'failed', lint_status: 'skipped' };
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
    parent_event_id: start.event_id,
    phase: 'reflection',
    skill: 'reflector',
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

  // S6A — brain-lint trigger. Run AFTER themes + archive are written so the
  // cycle-touched-themes scope sees the full delta. Informational only —
  // a flagged result does NOT change reflection_status (C8 + plan 06).
  const lintStatus = runPostReflectionLint({
    forgeRoot,
    cycleId,
    cycleLogDir,
    logger,
    initiativeId: input.initiativeId,
    parentEventId: start.event_id,
    brainLint: deps.brainLint,
  });

  // REF-1: derive user-questions.json from the agent-written user-questions.md.
  // The agent only writes the .md; we synthesise the structured .json here
  // post-exit so the in-UI /reflect screen has an AskUserQuestion-shaped array
  // to render. Best-effort: a missing or unparse-able .md results in an empty
  // array (no questions shown), which is acceptable (the .md is still readable).
  const userQuestionsPath = resolve(cycleLogDir, 'user-questions.md');
  const userQuestionsJsonPath = resolve(cycleLogDir, 'user-questions.json');
  deriveUserQuestionsJson(userQuestionsPath, userQuestionsJsonPath);

  // REF-4: regenerate the brain index now that the agent has written new themes.
  // Best-effort: a failure here is logged but does not block close.
  try {
    regenerateBrainIndex({ cwd: forgeRoot });
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'reflection',
      skill: 'reflector',
      event_type: 'log',
      input_refs: [],
      output_refs: [resolve(forgeRoot, 'brain', 'INDEX.md')],
      message: 'reflector.brain-index-regenerated',
    });
  } catch (indexErr) {
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'reflection',
      skill: 'reflector',
      event_type: 'log',
      input_refs: [],
      output_refs: [],
      message: 'reflector.brain-index-failed',
      metadata: { error: indexErr instanceof Error ? indexErr.message : String(indexErr) },
    });
  }

  // S6B — write `_logs/<cycle-id>/recap.md`. Orchestrator-side, NOT agent.
  // Always written on a successful reflector close (additive — does NOT
  // gate reflection_status; per CONTRACTS.md C15a the PR-comment surface
  // belongs to plan 04).
  const freshThemes = listFreshThemes(themesDir, startedAtMs);
  const themesWritten = freshThemes.map((t) => t.path);
  // M5-5: write structured reflection.json with KB-node targets so the
  // artifact viewer's /artifact?type=reflection path can render lesson → KB
  // badges. Best-effort — a failure here must NOT break the cycle close.
  writeReflectionDocBestEffort({
    cycleLogDir,
    retroPath: resolve(cycleLogDir, 'retro.md'),
    freshThemeSlugs: freshThemes.map((t) => basename(t.path, '.md')),
  });
  const recapResult = writeCycleRecap({
    forgeRoot,
    cycleId,
    initiativeId: input.initiativeId,
    manifestPath,
    projectName,
    themesWritten,
    cycleArchivePath,
    lintStatus,
    reflectorCostUsd: costUsd,
    reflectorDurationMs: durationMs,
  });
  if (recapResult.written) {
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'reflection',
      skill: 'reflector',
      event_type: 'log',
      input_refs: [logger.logFilePath],
      output_refs: [recapResult.recapPath],
      message: 'reflector.recap-emitted',
      metadata: {
        recap_path: recapResult.recapPath,
        themes_count: themesWritten.length,
        lint_status: lintStatus,
      },
    });
  }

  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: start.event_id,
    phase: 'reflection',
    skill: 'reflector',
    event_type: 'end',
    input_refs: [logger.logFilePath, manifestPath],
    output_refs: [resolve(cycleLogDir, 'retro.md')],
    cost_usd: costUsd,
    duration_ms: durationMs,
    message: 'reflector.end',
    metadata: {
      status: 'closed',
      project: projectName,
      origin,
      result_subtype: resultSubtype,
      tool_use: toolUseSummary,
      lint_status: lintStatus,
      retention: retention.retention,
    },
  });
  return { reflection_status: 'closed', lint_status: lintStatus };
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
 * Returns minimal metadata for the retention heuristic.
 */
function listFreshThemes(themesDir: string, sinceMs: number): ThemeMeta[] {
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

/**
 * Trigger the post-reflection brain-lint pass over cycle-touched themes.
 *
 * Per C8 + plan 06: `lint_status: 'flagged'` does NOT block
 * `reflection_status: 'closed'`. Errors are surfaced through the
 * `reflector.lint-flagged` event + `_logs/<id>/brain-lint.md` artefact so
 * the next cycle / operator can act on them.
 */
function runPostReflectionLint(opts: {
  forgeRoot: string;
  cycleId: string;
  cycleLogDir: string;
  logger: EventLogger;
  initiativeId: string;
  parentEventId?: string;
  brainLint?: (opts: { cwd: string; cycleId: string }) => RunBrainLintResult;
}): LintStatus {
  const { forgeRoot, cycleId, cycleLogDir, logger, initiativeId, parentEventId, brainLint } = opts;
  const lintImpl =
    brainLint ??
    ((o: { cwd: string; cycleId: string }) =>
      runBrainLint({ cwd: o.cwd, scope: 'cycle-touched-themes', cycle: o.cycleId, fix: false }));

  let result: RunBrainLintResult;
  try {
    result = lintImpl({ cwd: forgeRoot, cycleId });
  } catch (err) {
    // Lint module reachable but threw — per S6A-DECISIONS.md "Failure mode",
    // surface as 'flagged' with a `lint-internal-error` reason.
    const reason = err instanceof Error ? err.message : String(err);
    if (/cannot find module|MODULE_NOT_FOUND|ENOENT.*brain-lint/i.test(reason)) {
      logger.emit({
        initiative_id: initiativeId,
        parent_event_id: parentEventId,
        phase: 'reflection',
        skill: 'reflector',
        event_type: 'log',
        input_refs: [],
        output_refs: [],
        message: 'reflector.lint-skipped',
        metadata: { reason: 'executable-missing', error: reason },
      });
      return 'skipped';
    }
    logger.emit({
      initiative_id: initiativeId,
      parent_event_id: parentEventId,
      phase: 'reflection',
      skill: 'reflector',
      event_type: 'log',
      input_refs: [],
      output_refs: [],
      message: 'reflector.lint-flagged',
      metadata: { reason: 'lint-internal-error', error: reason, findings_count: 0 },
    });
    return 'flagged';
  }

  if (result.exitCode === 0) {
    // Clean — emit an invoked event + a stub report for operator-facing
    // discoverability ("lint ran, nothing to report").
    writeLintReport(cycleLogDir, result.findings, forgeRoot);
    logger.emit({
      initiative_id: initiativeId,
      parent_event_id: parentEventId,
      phase: 'reflection',
      skill: 'reflector',
      event_type: 'log',
      input_refs: [],
      output_refs: [resolve(cycleLogDir, 'brain-lint.md')],
      message: 'reflector.lint-invoked',
      metadata: { result: 'clean', findings_count: result.findings.length },
    });
    return 'clean';
  }

  // exitCode === 1 → errors present
  writeLintReport(cycleLogDir, result.findings, forgeRoot);
  const errorFindings = result.findings.filter((f) => f.category === 'error').length;
  logger.emit({
    initiative_id: initiativeId,
    parent_event_id: parentEventId,
    phase: 'reflection',
    skill: 'reflector',
    event_type: 'log',
    input_refs: [],
    output_refs: [resolve(cycleLogDir, 'brain-lint.md')],
    message: 'reflector.lint-flagged',
    metadata: { findings_count: errorFindings, total_findings: result.findings.length },
  });
  return 'flagged';
}

/**
 * Write a human-readable lint report to `_logs/<cycle-id>/brain-lint.md`.
 * Always writes a file — even a clean run gets `(no findings)` so the
 * presence of the file is a reliable "lint ran" signal in operator-facing
 * tooling (S6B recap, future notification path).
 */
function writeLintReport(
  cycleLogDir: string,
  findings: RunBrainLintResult['findings'],
  forgeRoot: string,
): void {
  try {
    mkdirSync(cycleLogDir, { recursive: true });
    const path = resolve(cycleLogDir, 'brain-lint.md');
    if (findings.length === 0) {
      writeFileSync(path, '# Brain-lint report\n\n(no findings)\n');
      return;
    }
    const errors = findings.filter((f) => f.category === 'error');
    const flags = findings.filter((f) => f.category === 'flag');
    const fixes = findings.filter((f) => f.category === 'auto-fix');
    const lines: string[] = ['# Brain-lint report', ''];
    for (const [label, group] of [
      ['Errors', errors],
      ['Flags', flags],
      ['Auto-fixes', fixes],
    ] as const) {
      if (group.length === 0) continue;
      lines.push(`## ${label} (${group.length})`, '');
      for (const f of group) {
        const rel = f.file.startsWith(forgeRoot + '/') ? f.file.slice(forgeRoot.length + 1) : f.file;
        lines.push(`- [${f.check ?? 'check'}] ${rel}: ${f.message}`);
      }
      lines.push('');
    }
    lines.push(
      `Summary: ${errors.length} error(s), ${flags.length} flag(s), ${fixes.length} auto-fix(es).`,
      '',
    );
    writeFileSync(path, lines.join('\n'));
  } catch {
    /* best-effort */
  }
}

/**
 * Resolve the current location of an initiative's manifest. The reviewer
 * moves the manifest from `_queue/in-flight/` to `_queue/done/` (or
 * `_queue/ready-for-review/`) on completion. Reflection runs *after* the
 * move, so reading the original `input.manifestPath` ENOENTs every real
 * cycle. We look at the queue's terminal states first, then fall back to
 * the original path so bench harnesses (which pass a stable, non-queue path)
 * still work.
 */
function resolveCurrentManifestPath(originalPath: string, forgeRoot: string): string {
  if (existsSync(originalPath)) return originalPath;
  const filename = basename(originalPath);
  const candidates = [
    resolve(forgeRoot, '_queue', 'done', filename),
    resolve(forgeRoot, '_queue', 'ready-for-review', filename),
    resolve(forgeRoot, '_queue', 'failed', filename),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return originalPath;
}

/**
 * REF-1: Derive `user-questions.json` from `user-questions.md`.
 *
 * The agent writes only the .md (numbered headings). This function
 * synthesises the AskUserQuestion-shaped JSON array that the in-UI
 * /reflect screen expects, so the interview works in production without
 * requiring the agent to write two files.
 *
 * Parsing strategy: split on `## ` headings, use the heading text as
 * `header` (truncated to 12 chars per AskUserQuestion constraint) and the
 * body text as `question`. If the section supplies structured options (a
 * markdown bullet/dash list, optionally under an "Options:" marker) those
 * are parsed into `{label, description}`; otherwise `options` is left empty
 * so the /reflect screen renders a freeform textarea rather than a
 * one-size-fits-all generic triad. If the .md is absent or contains no
 * questions, an empty array is written (the UI treats that as "no questions
 * this cycle").
 */
function deriveUserQuestionsJson(mdPath: string, jsonPath: string): void {
  try {
    if (!existsSync(mdPath)) {
      writeFileSync(jsonPath, '[]');
      return;
    }
    const raw = readFileSync(mdPath, 'utf8');
    const questions = parseUserQuestionsMd(raw);
    writeFileSync(jsonPath, JSON.stringify(questions, null, 2));
  } catch {
    // Best-effort: fall back to empty array so the UI shows "no questions".
    try {
      writeFileSync(jsonPath, '[]');
    } catch {
      /* silent */
    }
  }
}

type UserQuestion = {
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
};

/**
 * Parse the numbered heading format written by the agent:
 *   ## 1. <heading text>
 *   <body paragraphs>
 *
 * Returns one entry per heading found. If no headings match the pattern,
 * falls back to treating the entire file body as a single question.
 */
function parseUserQuestionsMd(raw: string): UserQuestion[] {
  const out: UserQuestion[] = [];
  // Split on lines that start a numbered or unnumbered ## heading.
  const sections = raw.split(/^(?=## )/m).filter((s) => s.trim());
  for (const section of sections) {
    const lines = section.split(/\r?\n/);
    const heading = lines[0].replace(/^##\s+\d+\.\s*/, '').replace(/^##\s+/, '').trim();
    if (!heading) continue;
    const body = lines.slice(1).join('\n').trim();
    const options = parseSectionOptions(lines.slice(1));
    // The question text is the body with any parsed option lines stripped, so
    // the freeform/options content isn't duplicated into the prompt.
    const question = stripOptionLines(body) || heading;
    // header must be ≤12 chars (AskUserQuestion constraint).
    const header = heading.slice(0, 12);
    out.push({ question, header, options });
  }
  return out;
}

/**
 * Parse a markdown bullet/dash list of options from a question section body.
 *
 * A "meaningful" option line looks like `- Label` or `* Label — description`
 * (em-dash, en-dash, or " - " as the label/description separator). Lines are
 * only treated as options when there are at least two of them — a single
 * stray bullet inside prose is prose, not a choice set. When no structured
 * options are present we return [] so the UI falls back to a freeform answer
 * rather than synthesizing a generic triad that fits no question.
 */
function parseSectionOptions(bodyLines: string[]): Array<{ label: string; description: string }> {
  const opts: Array<{ label: string; description: string }> = [];
  for (const line of bodyLines) {
    const m = line.match(/^\s*[-*]\s+(.+)$/);
    if (!m) continue;
    const text = m[1].trim();
    if (!text) continue;
    // Split label from description on em/en dash or " - ".
    const sep = text.match(/\s+(?:—|–|-)\s+/);
    if (sep && sep.index !== undefined) {
      const label = text.slice(0, sep.index).trim();
      const description = text.slice(sep.index + sep[0].length).trim();
      opts.push({ label, description });
    } else {
      opts.push({ label: text, description: '' });
    }
  }
  return opts.length >= 2 ? opts : [];
}

/** Drop markdown bullet/dash lines from a body so option text isn't duplicated into the question prompt. */
function stripOptionLines(body: string): string {
  return body
    .split(/\r?\n/)
    .filter((l) => !/^\s*[-*]\s+/.test(l))
    .join('\n')
    .trim();
}

/**
 * M5-5: parse the cycle's retro.md → ReflectionDoc (with KB-node targets on
 * lessons) and write it to `_logs/<cycleId>/artifacts/reflection.json` so the
 * artifact viewer can fetch it via `/api/artifact/<cycleId>/reflection.json`.
 *
 * Best-effort: any error is swallowed. A missing retro.md (the agent didn't
 * write one, or the cycle is a stub) results in an empty doc being written —
 * the viewer degrades gracefully to "None logged." for all sections.
 */
function writeReflectionDocBestEffort(opts: {
  cycleLogDir: string;
  retroPath: string;
  freshThemeSlugs: string[];
}): void {
  const { cycleLogDir, retroPath, freshThemeSlugs } = opts;
  try {
    const raw = existsSync(retroPath) ? readFileSync(retroPath, 'utf8') : '';
    const doc = parseRetroMd(raw, freshThemeSlugs);
    const artifactsDir = resolve(cycleLogDir, 'artifacts');
    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(resolve(artifactsDir, 'reflection.json'), JSON.stringify(doc, null, 2));
  } catch {
    /* best-effort — reflection.json is a non-critical side-output */
  }
}

// Re-export the legacy ReflectionStatus type for ergonomic imports.
export type { ReflectionStatus };
