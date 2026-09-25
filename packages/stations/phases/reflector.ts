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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseRetroMd } from '../reflection-doc.ts';

import type { EventLogger } from '@forge/kernel';
import { parseManifest } from '@forge/flows/manifest.ts';
import type { StreamQueryFn } from '@forge/agents/pinned-sdk-query.ts';
import type { AgentDefinition } from '@forge/contracts/studio/types.ts';
import { buildReflectorSystemPrompt, renderReflectorUserPrompt } from './reflector-binding.ts';
import {
  REFLECT_MODE_FILE,
  type CycleInput,
  type LintStatus,
  type ReflectMode,
  type ReflectionStatus,
  type ReflectorPhaseResult,
} from '@forge/flows/cycle-context.ts';
import { runBrainLint, type RunBrainLintResult } from '@forge/knowledge/brain-lint.ts';
import { writeCycleRecap } from '../cycle-recap.ts';
import { cyclesThemesDir, projectThemesDir } from '@forge/knowledge/brain-paths.ts';
import { runPostReflectionKbHealth } from '@forge/knowledge/kb-health.ts';
import { acquireBrainWriteLease, BrainWriteLeaseContentionError } from '@forge/knowledge/brain-write-lease.ts';
import { getPaths, type QueuePaths } from '@forge/flows/queue.ts';
import { emitReflectionLost, runReflectorBrainWrites, listFreshThemes } from './reflector-brain-writes.ts';

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
 * SDK-query shape we depend on — an alias of the one shared stream-call
 * shape (R4-01 review — no structural twin types); test stubs supply a
 * simple async generator.
 */
export type ReflectorSdkQuery = StreamQueryFn;

export type ReflectorDeps = {
  brainLint?: (opts: { cwd: string; cycleId: string }) => RunBrainLintResult;
  sdkQuery?: ReflectorSdkQuery;
  /** R4-09-F5 — injectable per-KB post-cycle health dispatcher (for tests). */
  kbHealth?: typeof runPostReflectionKbHealth;
  /**
   * forge-ler4 — injectable brain-write-lease acquirer (tests only).
   * `forgeRoot` is deliberately NOT injectable (always `import.meta.dirname`
   * — see reflector-spawn-capture.test.ts's header), so every test that
   * reaches the real lease resolves the SAME real repo `brain/`. A test file
   * can supply `(forgeRoot) => acquireBrainWriteLease(forgeRoot, { lockfilePath:
   * <private path> })` so it never contends with another reflector test file
   * running in a DIFFERENT `node --test` worker. Production default:
   * unset ⇒ the real `acquireBrainWriteLease` against the real forgeRoot,
   * unchanged.
   */
  acquireBrainWriteLease?: typeof acquireBrainWriteLease;
  /** Seam F4: the executing node's own agent def. REQUIRED — no fallback. */
  agentDef: AgentDefinition;
};

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
  deps: ReflectorDeps,
): Promise<ReflectorPhaseResult> {
  const def = deps.agentDef;
  const start = logger.emit({
    initiative_id: input.initiativeId,
    phase: 'reflection',
    skill: def.slug,
    event_type: 'start',
    input_refs: [input.manifestPath, logger.logFilePath],
    output_refs: [],
    message: 'reflector.start',
  });
  const startedAtMs = Date.now();

  const forgeRoot = resolve(import.meta.dirname, '..', '..', '..');
  const cycleId = logger.cycleId;
  const cycleLogDir = resolve(forgeRoot, '_logs', cycleId);

  // Reflection runs after the reviewer merged the initiative, which moves the
  // manifest from `_queue/in-flight/` to `_queue/done/`. The cycle was kicked
  // off with the in-flight path, so we look up the current location before
  // reading. Fall back to the original path so this stays compatible with
  // bench harnesses that point directly at a stable manifest.
  const manifestPath = resolveCurrentManifestPath(input.manifestPath, forgeRoot);

  // R4-09-F3: reflect mode (absent ⇒ interactive). Drives the Stage-2/3 prompt
  // branch and the post-exit `inferred: true` provenance stamping.
  const reflectMode = input.mode ?? 'interactive';

  let projectName: string;
  let origin: 'architect' | 'human-directed' | 'triggered' = 'architect';
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
      skill: def.slug,
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
      skill: def.slug,
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
      skill: def.slug,
      event_type: 'end',
      input_refs: [manifestPath],
      output_refs: [],
      message: 'reflector.skipped-disposable',
      metadata: { project: projectName, reason: 'manifest disposable: true — throwaway/verification cycle, not reflected into the durable brain' },
    });
    return { reflection_status: 'skipped', lint_status: 'skipped' };
  }

  const systemPrompt = buildReflectorSystemPrompt(forgeRoot, def);
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
  // R4-09-F3: persist the resolved mode durably (survives the transient
  // FlowTrigger dispatch) so the UI + a rerun read the truth, not a per-question
  // heuristic. Written before the spawn so it's present even on a crash.
  try {
    mkdirSync(cycleLogDir, { recursive: true });
    writeFileSync(resolve(cycleLogDir, REFLECT_MODE_FILE), JSON.stringify({ mode: reflectMode }));
  } catch {
    /* best-effort — the UI falls back to the per-question inferred heuristic */
  }
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
    // R4-09-F2: the unifier-authored PR description in the worktree (stated
    // intent), so the reflector grounds the questionnaire in the actual PR.
    prDescriptionRelPath: resolve(input.worktreePath, '.forge', 'pr-description.md'),
    projectName,
    userQuestionsRelPath: resolve(cycleLogDir, 'user-questions.md'),
    userFeedbackRelPath: resolve(cycleLogDir, 'user-feedback.md'),
    retroRelPath: resolve(cycleLogDir, 'retro.md'),
    cycleArchiveRelPath: cycleArchivePath,
    themesDirRelPath: themesDir,
    forgeThemesDirRelPath: forgeThemesDir,
    mode: reflectMode,
  });

  // forge-ler4 — one brain-writing turn at a time (design.md "Brain-write
  // lease"). Covers the SDK spawn plus its post-exit brain writes.
  const acquireLease = deps.acquireBrainWriteLease ?? acquireBrainWriteLease;
  let releaseLease: (() => Promise<void>) | undefined;
  try {
    releaseLease = await acquireLease(forgeRoot);
  } catch (err) {
    if (!(err instanceof BrainWriteLeaseContentionError)) throw err;
    emitReflectionLost(logger, {
      initiativeId: input.initiativeId,
      parentEventId: start.event_id,
      cause: 'brain-write-lease-contention',
      detail: err.message,
      skill: def.slug,
    });
    return { reflection_status: 'failed', lint_status: 'skipped' };
  }
  let brainWrites: Awaited<ReturnType<typeof runReflectorBrainWrites>>;
  try {
    brainWrites = await runReflectorBrainWrites({
      input, logger, deps, startEventId: start.event_id, forgeRoot, cycleId,
      projectName, systemPrompt, prompt, cycleArchivePath, themesDir, startedAtMs,
      agentDef: def,
    });
  } finally {
    await releaseLease();
  }
  if (!brainWrites.ok) return { reflection_status: 'failed', lint_status: 'skipped' };
  const { costUsd, durationMs, resultSubtype, retention, toolUseSummary } = brainWrites;

  // S6A — brain-lint trigger. Run AFTER themes + archive are written (and after
  // the KB-health consolidate above) so the cycle-touched-themes scope sees the
  // full, fixed delta. Informational only — a flagged result does NOT change
  // reflection_status (C8 + plan 06).
  const lintStatus = runPostReflectionLint({
    forgeRoot,
    cycleId,
    cycleLogDir,
    logger,
    initiativeId: input.initiativeId,
    parentEventId: start.event_id,
    brainLint: deps.brainLint,
    skill: def.slug,
  });

  // REF-1: derive user-questions.json from the agent-written user-questions.md.
  // The agent only writes the .md; we synthesise the structured .json here
  // post-exit so the in-UI /reflect screen has an AskUserQuestion-shaped array
  // to render. Best-effort: a missing or unparse-able .md results in an empty
  // array (no questions shown), which is acceptable (the .md is still readable).
  const userQuestionsPath = resolve(cycleLogDir, 'user-questions.md');
  const userQuestionsJsonPath = resolve(cycleLogDir, 'user-questions.json');
  deriveUserQuestionsJson(userQuestionsPath, userQuestionsJsonPath, reflectMode);

  // REF-4: the brain index is regenerated as the KB-health `ingest` builtin
  // above (R4-09-F5), which emits reflector.brain-index-regenerated.

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
      skill: def.slug,
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
    skill: def.slug,
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
  /** Seam F4: the executing node's own agent slug (`def.slug`). */
  skill: string;
}): LintStatus {
  const { forgeRoot, cycleId, cycleLogDir, logger, initiativeId, parentEventId, brainLint, skill } = opts;
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
        skill,
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
      skill,
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
      skill,
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
    skill,
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
 * Resolve the current location of an initiative's manifest.
 *
 * Reflection is dispatched with the `_queue/in-flight/` claim path, but by
 * the time it runs the reviewer/finalize pipeline has typically already
 * moved the manifest file elsewhere — most commonly `_queue/merged/`, since
 * `finalize-merged.ts` promotes `merged/ → done/` *after* dispatching
 * reflection (M0-A round-2 defect A: a hand-written candidate list that
 * omitted `merged/` made every merged cycle ENOENT here). Rather than
 * hand-listing a subset of queue states again, this derives its candidates
 * from `getPaths()` (`orchestrator/queue.ts`'s own `QueuePaths`), covering
 * every current state — `pending` included, even though reflection realistically
 * never fires there — so a state added to the queue later can't silently slip
 * through the same way `merged/` did.
 *
 * Returns `originalPath` unchanged when the manifest is genuinely not
 * sitting in any queue state. This never fabricates a location: the caller's
 * `reflector.manifest-unreadable` → `cycle.reflection-lost` path depends on
 * a real loss staying loud, not going silent.
 */
export function resolveCurrentManifestPath(originalPath: string, forgeRoot: string): string {
  if (existsSync(originalPath)) return originalPath;
  const filename = basename(originalPath);
  const paths: QueuePaths = getPaths(resolve(forgeRoot, '_queue'));
  const stateKeys = (Object.keys(paths) as Array<keyof QueuePaths>).filter((k) => k !== 'root');
  for (const key of stateKeys) {
    const candidate = resolve(paths[key], filename);
    if (existsSync(candidate)) return candidate;
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
function deriveUserQuestionsJson(mdPath: string, jsonPath: string, mode: ReflectMode = 'interactive'): void {
  try {
    if (!existsSync(mdPath)) {
      writeFileSync(jsonPath, '[]');
      return;
    }
    const raw = readFileSync(mdPath, 'utf8');
    const questions = parseUserQuestionsMd(raw, mode);
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
  /** R4-09-F3 (automated mode): the reflector-inferred answer for this question. */
  answer?: string;
  /** R4-09-F3: true when `answer` was inferred (no human), for UI provenance. */
  inferred?: boolean;
};

/** R4-09-F3: the self-describing marker the automated prompt writes per question. */
const INFERRED_ANSWER_RE = /^\s*\*\*Inferred answer:\*\*\s*(.+)$/i;

/**
 * Parse the numbered heading format written by the agent:
 *   ## 1. <heading text>
 *   <body paragraphs>
 *
 * Returns one entry per heading found. If no headings match the pattern,
 * falls back to treating the entire file body as a single question.
 */
function parseUserQuestionsMd(raw: string, mode: ReflectMode = 'interactive'): UserQuestion[] {
  const out: UserQuestion[] = [];
  // Split on lines that start a numbered or unnumbered ## heading.
  const sections = raw.split(/^(?=## )/m).filter((s) => s.trim());
  for (const section of sections) {
    const lines = section.split(/\r?\n/);
    const heading = lines[0].replace(/^##\s+\d+\.\s*/, '').replace(/^##\s+/, '').trim();
    if (!heading) continue;
    const bodyLines = lines.slice(1);
    const options = parseSectionOptions(bodyLines);
    // R4-09-F3: in automated mode, lift the self-describing `**Inferred
    // answer:**` line into `answer` + `inferred: true`, and strip it from the
    // question text so it isn't duplicated into the prompt. Interactive runs
    // ignore any such line — the JSON shape is byte-identical to pre-F3.
    let answer: string | undefined;
    let inferred: boolean | undefined;
    let contentLines = bodyLines;
    if (mode === 'automated') {
      const idx = bodyLines.findIndex((l) => INFERRED_ANSWER_RE.test(l));
      if (idx >= 0) {
        const m = bodyLines[idx].match(INFERRED_ANSWER_RE);
        answer = m?.[1]?.trim();
        inferred = true;
        contentLines = bodyLines.filter((_, i) => i !== idx);
      }
    }
    const body = contentLines.join('\n').trim();
    // The question text is the body with any parsed option lines stripped, so
    // the freeform/options content isn't duplicated into the prompt.
    const question = stripOptionLines(body) || heading;
    // header must be ≤12 chars (AskUserQuestion constraint).
    const header = heading.slice(0, 12);
    const entry: UserQuestion = { question, header, options };
    if (answer !== undefined) entry.answer = answer;
    if (inferred) entry.inferred = true;
    out.push(entry);
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
