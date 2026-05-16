/**
 * SDK invocation helper for the project-manager benchmark.
 *
 * One call ≈ one PM session against one fixture. Sets up an isolated tempdir
 * with read-only symlinks to brain/, skills/, docs/, orchestrator/ plus a
 * `_queue/in-flight/<id>.md` containing the fixture's initiative manifest and
 * a `projects/<name>/` worktree scaffolded from the fixture's project_tree.
 *
 * The PM writes work items to `<tempdir>/projects/<name>/.forge/work-items/`;
 * the bench reads them back from there, scores, and cleans up.
 *
 * Why isolated tempdirs (vs running against the live repo): concurrent
 * fixtures must not collide on the queue or worktrees, and bench runs must
 * not pollute real `_queue/` state. Symlinks make the brain/ tree read-only
 * for the agent's purposes (the permissionMode + tool allowlist enforce it).
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';

import {
  PM_ALLOWED_TOOLS,
  PM_DISALLOWED_TOOLS,
  PM_MODEL,
  buildPmSystemPrompt,
  renderPmUserPrompt,
  tallyToolUse,
  type PmToolUseSummary,
} from '../../orchestrator/pm-invocation.ts';
import { readWorkItemsFromDir, type WorkItem } from '../../orchestrator/work-item.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..', '..');

export type PmQueryFn = (params: {
  prompt: string;
  options?: Record<string, unknown>;
}) => AsyncIterable<unknown>;

export type RunPmInput = {
  fixtureId: string;
  initiativeId: string;
  /** Initiative manifest content to seed `_queue/in-flight/<id>.md`. */
  initiativeManifest: string;
  /**
   * Absolute path to the fixture project tree (a directory under
   * benchmarks/project-manager/fixtures/projects/<name>/). Copied recursively
   * into <tempdir>/projects/<projectName>/. If undefined, only a README.md is
   * scaffolded.
   */
  projectTreePath?: string;
  projectName: string;
  expected: {
    min_work_items: number;
    max_work_items: number;
    parallel_fraction_at_least: number;
  };
  /** Inject a fake `query` for testing. */
  queryFn?: PmQueryFn;
};

export type PmRunnerErrorKind =
  | 'error_max_turns'
  | 'error_max_budget_usd'
  | 'error_max_structured_output_retries'
  | 'error_during_execution'
  | 'no_result'
  | 'no_work_items_written'
  | 'work_item_parse_error';

export type RunPmResult = {
  workItems: WorkItem[];
  graphText: string | null;
  workItemsDirRel: string;
  parseErrors: Record<string, string>;
  tempdir: string;
  durationMs: number;
  costUsd: number;
  runnerError?: { kind: PmRunnerErrorKind; message: string };
  toolUseSummary: PmToolUseSummary;
};

export function setupTempdir(input: RunPmInput): string {
  const dir = mkdtempSync(join(tmpdir(), 'forge-bench-pm-'));

  for (const sub of ['brain', 'skills', 'docs', 'orchestrator']) {
    symlinkSync(resolve(FORGE_ROOT, sub), resolve(dir, sub));
  }

  mkdirSync(resolve(dir, '_queue', 'in-flight'), { recursive: true });
  writeFileSync(
    resolve(dir, '_queue', 'in-flight', `${input.initiativeId}.md`),
    input.initiativeManifest,
  );

  const projDir = resolve(dir, 'projects', input.projectName);
  mkdirSync(projDir, { recursive: true });

  if (input.projectTreePath && existsSync(input.projectTreePath)) {
    cpSync(input.projectTreePath, projDir, { recursive: true });
  } else {
    writeFileSync(
      resolve(projDir, 'README.md'),
      `# ${input.projectName}\n\n(Fixture scaffold — no project tree supplied.)\n`,
    );
  }

  return dir;
}

export function cleanupTempdir(tempdir: string): void {
  try {
    rmSync(tempdir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

type AssistantMessage = {
  type: 'assistant';
  message?: { content?: Array<{ type?: string; name?: string; input?: unknown }> };
};

type ResultMessage = {
  type: 'result';
  subtype?: string;
  total_cost_usd?: number;
  duration_ms?: number;
};

function isAssistant(m: unknown): m is AssistantMessage {
  return typeof m === 'object' && m !== null && (m as { type?: string }).type === 'assistant';
}

function isResult(m: unknown): m is ResultMessage {
  return typeof m === 'object' && m !== null && (m as { type?: string }).type === 'result';
}

export function readGraphFile(workItemsDir: string): string | null {
  const graphPath = resolve(workItemsDir, '_graph.md');
  if (!existsSync(graphPath)) return null;
  return readFileSync(graphPath, 'utf8');
}

export async function runProjectManager(input: RunPmInput): Promise<RunPmResult> {
  const queryFn: PmQueryFn = input.queryFn ?? (sdkQuery as unknown as PmQueryFn);
  const tempdir = setupTempdir(input);

  const manifestRelPath = `_queue/in-flight/${input.initiativeId}.md`;
  const worktreeRelPath = `projects/${input.projectName}`;

  const systemPrompt = buildPmSystemPrompt(tempdir);
  const prompt = renderPmUserPrompt({
    initiativeId: input.initiativeId,
    manifestRelPath,
    worktreeRelPath,
    projectName: input.projectName,
    minWorkItems: input.expected.min_work_items,
    maxWorkItems: input.expected.max_work_items,
    parallelFractionAtLeast: input.expected.parallel_fraction_at_least,
  });

  const options: Record<string, unknown> = {
    // Phase 4.1 (drift correction): match live forge. The live
    // `runProjectManager` (orchestrator/phases/project-manager.ts, F-37) runs
    // the PM agent with `cwd = the worktree`, NOT the forge root / tempdir
    // root — so the agent's relative-path tool calls (Glob, Read) resolve
    // against the real project tree instead of fabricating plausible paths.
    // The bench must mirror this or it's strictly harder than prod
    // (HIGH false-red): the shared prompt even tells the agent its cwd is the
    // worktree. `worktreeRelPath` = `projects/<name>` = the project tree
    // setupTempdir() copies the fixture into.
    cwd: resolve(tempdir, worktreeRelPath),
    systemPrompt,
    model: PM_MODEL,
    permissionMode: 'acceptEdits',
    allowedTools: PM_ALLOWED_TOOLS,
    disallowedTools: PM_DISALLOWED_TOOLS,
    maxTurns: 40,
    // Phase 4.1 (drift correction): match live `PM_LIVE_MAX_BUDGET_USD = 2.5`
    // (F-42). At 0.75 multi-feature fixtures can budget-fail in the bench but
    // pass in prod (MED false-red).
    maxBudgetUsd: 2.5,
  };

  let durationMs = 0;
  let costUsd = 0;
  let runnerError: RunPmResult['runnerError'];
  let sawResult = false;
  const toolUseSummary: PmToolUseSummary = { brainReads: 0, writes: 0, bashCalls: 0 };

  for await (const msg of queryFn({ prompt, options })) {
    if (isAssistant(msg)) {
      tallyToolUse(msg.message, toolUseSummary);
      continue;
    }
    if (!isResult(msg)) continue;
    sawResult = true;
    if (typeof msg.duration_ms === 'number') durationMs = msg.duration_ms;
    if (typeof msg.total_cost_usd === 'number') costUsd = msg.total_cost_usd;
    const subtype = msg.subtype ?? 'success';
    if (subtype !== 'success') {
      runnerError = {
        kind: subtype as PmRunnerErrorKind,
        message: `SDK result subtype: ${subtype}`,
      };
    }
    break;
  }

  if (!sawResult && !runnerError) {
    runnerError = { kind: 'no_result', message: 'query iterator ended without a result message' };
  }

  const workItemsDirAbs = resolve(tempdir, worktreeRelPath, '.forge', 'work-items');
  const { items: workItems, parseErrors } = readWorkItemsFromDir(workItemsDirAbs);
  const graphText = readGraphFile(workItemsDirAbs);

  if (workItems.length === 0 && !runnerError) {
    runnerError = {
      kind: 'no_work_items_written',
      message: `No work items found in ${workItemsDirAbs} after run`,
    };
  } else if (Object.keys(parseErrors).length > 0 && !runnerError) {
    runnerError = {
      kind: 'work_item_parse_error',
      message: `Parse errors: ${Object.entries(parseErrors).map(([f, e]) => `${f}: ${e}`).join('; ')}`,
    };
  }

  return {
    workItems,
    graphText,
    workItemsDirRel: join(worktreeRelPath, '.forge', 'work-items'),
    parseErrors,
    tempdir,
    durationMs,
    costUsd,
    runnerError,
    toolUseSummary,
  };
}

/** Helper for tests + the score harness: list the WI files written to the tempdir. */
export function listWorkItemFiles(workItemsDirAbs: string): string[] {
  if (!existsSync(workItemsDirAbs)) return [];
  return readdirSync(workItemsDirAbs).filter((f) => f.endsWith('.md') && f !== '_graph.md').sort();
}
