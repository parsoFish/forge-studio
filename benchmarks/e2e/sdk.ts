/**
 * Bench harness for the end-to-end review-loop bench. One call ≈ one full
 * cycle (PM → developer-loop → review-Ralph → merge) against one fixture.
 *
 * Tempdir layout (mirrors the live forge root the orchestrator expects):
 *   <tempdir>/
 *     brain/, skills/, docs/, orchestrator/, loops/  (read-only symlinks)
 *     projects/<name>/  ← real git repo:
 *                            main branch = seed tree (committed)
 *                            initiative-<id> branch = where the cycle runs
 *     _queue/in-flight/<initiative-id>.md  ← copied from fixture
 *     _queue/done/                          ← orchestrator moves here on merge
 *     bin/{gh, vhs, npx}                    ← PATH shims
 *     _pr-metadata.json                     ← gh shim records PR state here
 *
 * The `gh` shim is smarter than the reject-everything shim from
 * recorder-shims.ts — it handles `pr create` (records metadata + outputs a
 * fake URL) and `pr merge` (fast-forwards the initiative branch into main
 * locally + marks metadata as merged). This lets the orchestrator's
 * gh-pr-merge call succeed in bench mode without touching real GitHub.
 *
 * After the cycle completes, bench scoring runs target-spec checks against
 * the merged worktree (i.e., main branch with the initiative's commits).
 */

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runCycle, type CycleInput, type CycleResult } from '../../orchestrator/cycle.ts';
import {
  VHS_SHIM_SCRIPT,
  NPX_PLAYWRIGHT_SHIM_SCRIPT,
} from '../_lib/recorder-shims.ts';
import {
  buildGhShimScript,
  reconstructGateStateFromEventLog,
  readGhMetadata,
  writeShim,
  type GhMetadata,
} from '../_lib/gh-shim.ts';
import { simulatorVerdict, runSpecChecks, type TargetSpec } from './simulator.ts';
import type { ReviewerGateState } from '../../orchestrator/reviewer-stage2.ts';

// Re-export the shared gh-shim metadata reader/type so existing importers
// (benchmarks/e2e/sdk.test.ts, score.ts) keep importing them from `./sdk.ts`.
export { readGhMetadata, type GhMetadata };

const FORGE_ROOT = resolve(import.meta.dirname, '..', '..');

export type RunE2eInput = {
  fixtureId: string;
  initiativeId: string;
  /** Absolute path to the fixture's seed worktree (initial state of `main`). */
  seedTreePath: string;
  /** Absolute path to the fixture's manifest.md. */
  manifestPath: string;
  projectName: string;
  /** Target spec — used by the simulator to decide approve vs send-back. */
  spec: TargetSpec;
  /** Iteration cap for the review-Ralph loop. Default 3 (1 prep + 2 send-backs). */
  reviewIterationCap?: number;
  /** Per-iteration USD budget for the review-Ralph. Default 1.0. */
  reviewIterationBudgetUsd?: number;
  /** Argv for the project's quality-gate command. Default inferred from package.json presence. */
  qualityGateCmd?: string[];
};

export type RunE2eResult = {
  tempdir: string;
  worktreePath: string;
  cycleResult: CycleResult | null;
  /** Did the cycle throw? */
  cycleThrew: { kind: string; message: string } | null;
  /** Round telemetry from the verdict-gate. */
  reviewerGateState: ReviewerGateState;
  /** Spec-check results re-run after the cycle (orchestrator-verified ground truth). */
  postMergeSpecResults: ReturnType<typeof runSpecChecks> | null;
  /** Did the gh shim record a successful merge? */
  merged: boolean;
};

export function setupTempdir(input: RunE2eInput): string {
  const dir = mkdtempSync(join(tmpdir(), 'forge-bench-e2e-'));

  // Symlink the forge core directories the orchestrator depends on.
  for (const sub of ['brain', 'skills', 'docs', 'orchestrator', 'loops']) {
    symlinkSync(resolve(FORGE_ROOT, sub), resolve(dir, sub));
  }

  // Copy the seed tree into projects/<name>/ and turn it into a git repo.
  if (!existsSync(input.seedTreePath)) {
    throw new Error(`seed tree path does not exist: ${input.seedTreePath}`);
  }
  const projDir = resolve(dir, 'projects', input.projectName);
  mkdirSync(projDir, { recursive: true });
  cpSync(input.seedTreePath, projDir, { recursive: true });

  // Initialise as a git repo with main + initiative branch.
  initGitRepo(projDir, input.initiativeId);

  // Copy manifest into _queue/in-flight/.
  if (!existsSync(input.manifestPath)) {
    throw new Error(`manifest path does not exist: ${input.manifestPath}`);
  }
  const queueDir = resolve(dir, '_queue', 'in-flight');
  mkdirSync(queueDir, { recursive: true });
  cpSync(input.manifestPath, resolve(queueDir, `${input.initiativeId}.md`));

  // Pre-create the queue destination dirs so moveTo() doesn't fail.
  mkdirSync(resolve(dir, '_queue', 'pending'), { recursive: true });
  mkdirSync(resolve(dir, '_queue', 'ready-for-review'), { recursive: true });
  mkdirSync(resolve(dir, '_queue', 'done'), { recursive: true });
  mkdirSync(resolve(dir, '_queue', 'failed'), { recursive: true });

  // PATH shims: gh (smart — records PR state locally), vhs, npx.
  const binDir = resolve(dir, 'bin');
  mkdirSync(binDir, { recursive: true });
  writeShim(resolve(binDir, 'gh'), buildGhShimScript(projDir, dir));
  writeShim(resolve(binDir, 'vhs'), VHS_SHIM_SCRIPT);
  writeShim(resolve(binDir, 'npx'), NPX_PLAYWRIGHT_SHIM_SCRIPT);

  return dir;
}

function initGitRepo(projDir: string, initiativeId: string): void {
  // Idempotent: skip if already a git repo (shouldn't happen, but defensive).
  if (existsSync(resolve(projDir, '.git'))) return;
  const sh = (cmd: string, args: string[]): void => {
    execFileSync(cmd, args, { cwd: projDir, stdio: 'pipe' });
  };
  sh('git', ['init', '-q', '-b', 'main']);
  sh('git', ['config', 'user.email', 'bench@forge.local']);
  sh('git', ['config', 'user.name', 'forge bench']);
  sh('git', ['add', '-A']);
  sh('git', ['commit', '-q', '-m', 'initial commit (bench seed)']);
  sh('git', ['checkout', '-q', '-b', `initiative-${initiativeId}`]);
}

export function cleanupTempdir(tempdir: string): void {
  try {
    rmSync(tempdir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

/**
 * Run a single end-to-end fixture. Sets up the tempdir, invokes runCycle
 * with the simulator-driven verdict-provider, runs post-merge spec checks
 * against the merged worktree, and returns structured telemetry.
 *
 * The bench harness (score.ts) calls this once per fixture and feeds the
 * result into scoring.ts. Tempdir cleanup is the caller's responsibility
 * (so failed runs can be inspected).
 */
export async function runE2e(input: RunE2eInput): Promise<RunE2eResult> {
  const tempdir = setupTempdir(input);
  const projDir = resolve(tempdir, 'projects', input.projectName);
  const queueManifestPath = resolve(tempdir, '_queue', 'in-flight', `${input.initiativeId}.md`);
  const qualityGateCmd =
    input.qualityGateCmd ??
    (existsSync(resolve(projDir, 'package.json'))
      ? ['npm', 'test', '--silent']
      : ['true']);

  const reviewerGateState: ReviewerGateState = {
    invocations: 0,
    verdicts: [],
    qualityGateResults: [],
  };

  // Set PATH so the orchestrator's gh / vhs / npx calls hit our shims.
  const originalPath = process.env.PATH ?? '';
  process.env.PATH = `${resolve(tempdir, 'bin')}:${originalPath}`;
  process.env.GH_TOKEN = 'invalid';

  const cycleInput: CycleInput = {
    initiativeId: input.initiativeId,
    manifestPath: queueManifestPath,
    projectRepoPath: projDir,
    worktreePath: projDir,
    qualityGateCmd,
    reviewIterationCap: input.reviewIterationCap ?? 3,
    reviewIterationBudgetUsd: input.reviewIterationBudgetUsd ?? 1.0,
    getVerdict: async (ctx) => {
      const preComputedSpecResults = runSpecChecks(ctx.worktreePath, input.spec);
      const verdict = await simulatorVerdict({
        ctx,
        spec: input.spec,
        preComputedSpecResults,
      });
      return verdict;
    },
  };

  let cycleResult: CycleResult | null = null;
  let cycleThrew: RunE2eResult['cycleThrew'] = null;
  try {
    cycleResult = await runCycle(cycleInput);
    // Surface gate-state telemetry via the event log (durable across the
    // gh-shim's post-merge `git clean`). The orchestrator's runReviewer
    // emits a final 'reviewer.end' event with metadata.gate_invocations
    // and metadata.verdicts_summary — read those.
    Object.assign(
      reviewerGateState,
      reconstructGateStateFromEventLog(cycleResult.log_path),
    );
  } catch (err) {
    cycleThrew = {
      kind: 'cycle_threw',
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    process.env.PATH = originalPath;
  }

  const postMergeSpecResults = runSpecChecks(projDir, input.spec);
  const ghMetadata = readGhMetadata(tempdir);
  const merged = ghMetadata?.merged === true;

  return {
    tempdir,
    worktreePath: projDir,
    cycleResult,
    cycleThrew,
    reviewerGateState,
    postMergeSpecResults,
    merged,
  };
}
