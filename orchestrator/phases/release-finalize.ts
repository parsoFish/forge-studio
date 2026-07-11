/**
 * Release-finalize phase runner (WS-A · final-loop / release).
 *
 * Runs AFTER the operator approves a merged-ready cycle and BEFORE forge
 * merges. Opt-in: a project that does NOT declare `releaseProcess` skips this
 * entirely (the phase no-ops and returns `release_status: 'skipped'`). When the
 * project DOES opt in, a one-shot SDK agent (the release-finalizer) promotes the
 * in-cycle DRAFT changelog into a finalised, versioned release commit on the PR
 * branch (semver bump + declared pre-merge steps + optional version-file bump),
 * commits + pushes, and the EXISTING merge then runs.
 *
 * Failure mode: **log-and-continue**. A thrown finaliser returns
 * `release_status: 'failed'` but does NOT propagate — the merge still proceeds
 * (the in-cycle DRAFT changelog is the fallback). The status is surfaced as
 * telemetry + a `notify`, never a merge gate.
 *
 * Mirrors orchestrator/phases/reflector.ts: shared invocation contract
 * (release-finalize-invocation.ts), SDK injected via `ReleaseFinalizeDeps`, the
 * SDK loop reads `total_cost_usd`/`duration_ms` off the result message.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pinnedSdkQuery as sdkQuery } from '../pinned-sdk-query.ts';

import type { EventLogger } from '../logging.ts';
import { loadProjectConfig } from '../project-config.ts';
import { releaseFinalizeSteps, hasReleaseProcess } from '../release-process.ts';
import {
  RELEASE_FINALIZE_ALLOWED_TOOLS,
  RELEASE_FINALIZE_DISALLOWED_TOOLS,
  RELEASE_FINALIZE_MODEL,
  buildReleaseFinalizeSystemPrompt,
  renderReleaseFinalizeUserPrompt,
  tallyToolUse,
  type ReleaseFinalizeToolUseSummary,
} from '../release-finalize-invocation.ts';
import { writeReleaseJson } from '../flow-artifacts.ts';
import type { ReleaseFinalizePhaseResult } from '../cycle-context.ts';

/** Default changelog path when the project declares a release but omits the path. */
const DEFAULT_CHANGELOG_PATH = 'CHANGELOG.md';

/**
 * Caps for the live release-finalize invocation. The finaliser is a one-shot
 * SDK call (not a Ralph loop) with a bounded job — promote one changelog entry,
 * run a handful of declared steps, commit, push. The reflector's caps are a
 * reasonable analogue (similar shape of work).
 */
const RELEASE_FINALIZE_LIVE_MAX_TURNS = 50;
const RELEASE_FINALIZE_LIVE_MAX_BUDGET_USD = 1.0;

/**
 * The self-contained input the approve handler passes. Unlike the reflector
 * (which gets a full `CycleInput`), the finaliser runs from the verdict handler
 * which only has the parsed manifest — so this carries exactly what the phase
 * needs, derived there.
 */
export type RunReleaseFinalizeInput = {
  initiativeId: string;
  cycleId: string;
  projectName: string;
  /** Absolute path to the worktree the PR branch is checked out in. */
  worktreePath: string;
  /** Absolute path to the project repo (where `.forge/project.json` lives). */
  projectRepoPath: string;
  /** Forge `_logs/` root, for writing `release.json`. */
  logsRoot: string;
};

/**
 * SDK-query shape we depend on. Loosened from the SDK's full `Query` type so
 * test stubs can supply a simple async generator. The production path passes
 * `sdkQuery` directly via `as unknown` cast.
 */
export type ReleaseFinalizeSdkQuery = (input: {
  prompt: string;
  options: Record<string, unknown>;
}) => AsyncIterable<unknown>;

export type ReleaseFinalizeDeps = {
  sdkQuery?: ReleaseFinalizeSdkQuery;
  /** Resolve the current branch name in the worktree. Injectable for tests. */
  currentBranch?: (worktreePath: string) => string;
  /** Operator notification sink (log-and-continue surfaces a failure here). */
  notify?: (msg: string) => void;
};

function defaultCurrentBranch(worktreePath: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: worktreePath,
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Run the post-approval, pre-merge release finalisation. Opt-in on the
 * project's `releaseProcess`. Log-and-continue on failure (the merge still
 * proceeds). Returns the phase result for telemetry.
 */
export async function runReleaseFinalize(
  input: RunReleaseFinalizeInput,
  logger: EventLogger,
  deps: ReleaseFinalizeDeps = {},
): Promise<ReleaseFinalizePhaseResult> {
  // Opt-in gate: load the project's forge config; absent/malformed/no-release →
  // skip cleanly (the non-opted-in path must be byte-for-byte unchanged).
  let releaseCfg;
  try {
    releaseCfg = loadProjectConfig(input.projectRepoPath)?.releaseProcess;
  } catch {
    releaseCfg = undefined;
  }
  if (!hasReleaseProcess(releaseCfg)) {
    return { release_status: 'skipped' };
  }

  const start = logger.emit({
    initiative_id: input.initiativeId,
    phase: 'release-finalize',
    skill: 'release-finalizer',
    event_type: 'start',
    input_refs: [input.worktreePath],
    output_refs: [],
    message: 'release-finalize.start',
    metadata: { project: input.projectName },
  });

  const changelogPath = releaseCfg.changelogPath ?? DEFAULT_CHANGELOG_PATH;
  const steps = releaseFinalizeSteps(releaseCfg);
  const branch = (deps.currentBranch ?? defaultCurrentBranch)(input.worktreePath);

  const systemPrompt = buildReleaseFinalizeSystemPrompt();
  const prompt = renderReleaseFinalizeUserPrompt({
    initiativeId: input.initiativeId,
    cycleId: input.cycleId,
    projectName: input.projectName,
    branch,
    changelogPath,
    versionFile: releaseCfg.versionFile,
    docsDir: releaseCfg.docsDir,
    steps,
  });

  const options: Record<string, unknown> = {
    cwd: input.worktreePath,
    systemPrompt,
    model: RELEASE_FINALIZE_MODEL,
    permissionMode: 'acceptEdits',
    allowedTools: [...RELEASE_FINALIZE_ALLOWED_TOOLS],
    disallowedTools: [...RELEASE_FINALIZE_DISALLOWED_TOOLS],
    maxTurns: RELEASE_FINALIZE_LIVE_MAX_TURNS,
    maxBudgetUsd: RELEASE_FINALIZE_LIVE_MAX_BUDGET_USD,
  };

  const toolUseSummary: ReleaseFinalizeToolUseSummary = { editWrites: 0, bashCalls: 0 };
  let costUsd = 0;
  let durationMs = 0;
  let resultSubtype: string | undefined;
  let version: string | undefined;

  const queryImpl: ReleaseFinalizeSdkQuery =
    deps.sdkQuery ?? (sdkQuery as unknown as ReleaseFinalizeSdkQuery);
  try {
    for await (const msg of queryImpl({ prompt, options })) {
      if (typeof msg !== 'object' || msg === null) continue;
      const m = msg as {
        type?: string;
        message?: { content?: Array<{ type?: string; name?: string; input?: unknown }> };
        subtype?: string;
        total_cost_usd?: number;
        duration_ms?: number;
      };
      if (m.type === 'assistant') {
        tallyToolUse(m.message, toolUseSummary);
        continue;
      }
      if (m.type !== 'result') continue;
      if (typeof m.duration_ms === 'number') durationMs = m.duration_ms;
      if (typeof m.total_cost_usd === 'number') costUsd = m.total_cost_usd;
      resultSubtype = m.subtype ?? 'success';
      break;
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'release-finalize',
      skill: 'release-finalizer',
      event_type: 'error',
      input_refs: [input.worktreePath],
      output_refs: [],
      message: 'release-finalize.crashed',
      metadata: { error: reason },
    });
    deps.notify?.(
      `${input.initiativeId} · release finalisation failed (${reason}) — merging with the in-cycle DRAFT changelog as fallback`,
    );
    return { release_status: 'failed' };
  }

  // A non-success terminal subtype (error, budget/turn exhaustion) is a failure
  // — log-and-continue: surface it, notify, but let the merge proceed.
  if (resultSubtype && resultSubtype !== 'success') {
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'release-finalize',
      skill: 'release-finalizer',
      event_type: 'error',
      input_refs: [input.worktreePath],
      output_refs: [],
      message: 'release-finalize.non-success',
      metadata: { result_subtype: resultSubtype, cost_usd: costUsd, duration_ms: durationMs },
    });
    deps.notify?.(
      `${input.initiativeId} · release finalisation did not complete (${resultSubtype}) — merging with the DRAFT changelog as fallback`,
    );
    return { release_status: 'failed' };
  }

  // A4: the agent records the computed version inside the finalised changelog;
  // best-effort scrape it for the terminal record + telemetry.
  version = scrapeFinalisedVersion(resolve(input.worktreePath, changelogPath));

  // A4: persist the terminal release record (overwrite:false — a re-approve must
  // not clobber the first finalisation). Best-effort; never blocks the merge.
  const releaseJsonPath = writeReleaseJson(
    input.logsRoot,
    {
      initiative_id: input.initiativeId,
      cycleId: input.cycleId,
      project: input.projectName,
      version: version ?? null,
      changelogPath,
      branch,
      finalizedAt: new Date().toISOString(),
    },
    { overwrite: false },
  );

  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: start.event_id,
    phase: 'release-finalize',
    skill: 'release-finalizer',
    event_type: 'end',
    input_refs: [input.worktreePath],
    output_refs: releaseJsonPath ? [releaseJsonPath] : [],
    cost_usd: costUsd,
    duration_ms: durationMs,
    message: 'release.finalized',
    metadata: {
      project: input.projectName,
      version: version ?? null,
      branch,
      changelog_path: changelogPath,
      steps_count: steps.length,
      result_subtype: resultSubtype,
      tool_use: toolUseSummary,
    },
  });

  return { release_status: 'finalized', ...(version ? { version } : {}) };
}

/**
 * Best-effort scrape of the finalised version from the changelog. The agent
 * rewrites the draft `## [Unreleased]` heading to `## [<version>] - <date>`;
 * the first such versioned heading is the just-finalised release. Returns
 * `undefined` when the file is absent or carries no versioned heading.
 */
function scrapeFinalisedVersion(changelogAbsPath: string): string | undefined {
  if (!existsSync(changelogAbsPath)) return undefined;
  let raw: string;
  try {
    raw = readFileSync(changelogAbsPath, 'utf8');
  } catch {
    return undefined;
  }
  for (const line of raw.split('\n')) {
    // Match `## [1.2.3] - 2026-06-19` but NOT `## [Unreleased]`.
    const m = line.match(/^##\s*\[(\d+\.\d+\.\d+[^\]]*)\]/);
    if (m) return m[1];
  }
  return undefined;
}
