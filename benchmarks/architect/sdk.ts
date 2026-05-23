/**
 * SDK invocation helper for the architect benchmark.
 *
 * One call ≈ one architect session against one fixture. Reads the architect
 * SKILL.md as system prompt at runtime so SKILL changes flow through. Each run
 * gets its own tempdir with read-only symlinks to `brain/`, `skills/`,
 * `docs/`, `orchestrator/` plus an empty `_queue/pending/` (safety net) and
 * an optional pre-populated `projects/<name>/roadmap.md`.
 *
 * Post-S2A/S2B contract: the architect writes its draft manifest(s) into
 * `projects/<name>/_architect/<session-id>/manifests/INIT-*.md` and its
 * PLAN.md + PLAN.html into `projects/<name>/_architect/<session-id>/`
 * (per C12 + cwc Amendment 2). The bench reads from there. The legacy
 * `_queue/pending/` path is still scanned as a fallback for cycles run
 * against pre-amendment SKILLs; new SKILLs land there only on the CLI's
 * `architect commit --approve` step which the bench does not execute.
 *
 * Interview step (cwc Amendment 1): the bench is non-interactive. The
 * user prompt explicitly tells the agent to skip `AskUserQuestion` and
 * render an empty interview section in PLAN.md. The criterion
 * `interview_section_present` checks for the section's *presence*, not
 * for ≥1 round.
 *
 * Why isolated tempdirs (vs running against the live repo): concurrent
 * fixtures must not collide on `_queue/pending/`, and benchmark runs must
 * not pollute the real queue. Symlinks make the brain/ directory read-only
 * for the agent's purposes (it's not a real fs-level read-only — but the
 * permissionMode + tool allowlist prevent edits anyway).
 *
 * `permissionMode: 'acceptEdits'` (not `'plan'`): mirrors brain/sdk.ts. Plan
 * mode blocks tool execution per the SDK type docs, and we need Read/Grep/
 * Glob for brain access plus Write for manifest emission. Read-only
 * behaviour against brain/ comes from the disallowedTools list and the
 * agent's directives, not the permission mode.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';

import { loadBrainIndex } from '../../cli/brain-index.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..', '..');
const SKILL_PATH = resolve(FORGE_ROOT, 'skills', 'architect', 'SKILL.md');

export type ArchitectQueryFn = (params: {
  prompt: string;
  options?: Record<string, unknown>;
}) => AsyncIterable<unknown>;

export type RunArchitectInput = {
  fixtureId: string;
  userPrompt: string;
  projectName: string;
  /** Optional pre-populated `projects/<name>/roadmap.md` content. */
  projectContext?: string;
  expected: { min_features: number; max_features: number };
  /** Inject a fake `query` for testing. */
  queryFn?: ArchitectQueryFn;
};

export type RunnerErrorKind =
  | 'error_max_turns'
  | 'error_max_budget_usd'
  | 'error_max_structured_output_retries'
  | 'error_during_execution'
  | 'no_result'
  | 'no_manifest_written'
  | 'multiple_manifests_written';

export type ToolUseSummary = {
  brainReads: number;
  writes: number;
  bashCalls: number;
};

export type RunArchitectResult = {
  manifestText: string | null;
  /** Path to the manifest, relative to `tempdir`. */
  manifestPath: string | null;
  /**
   * Other manifests the architect wrote in the same session (B2 multi-initiative
   * sessions). Empty for single-manifest fixtures (A1..A8 + B1).
   */
  siblingManifestTexts: string[];
  /** PLAN.md content if the architect wrote one under projects/<project>/_architect/<session-id>/. */
  planDoc: string;
  /** Council transcript content if the architect wrote one alongside PLAN.md. */
  councilTranscript: string;
  tempdir: string;
  durationMs: number;
  costUsd: number;
  runnerError?: { kind: RunnerErrorKind; message: string };
  toolUseSummary: ToolUseSummary;
};

const ALLOWED_TOOLS = ['Read', 'Grep', 'Glob', 'Write', 'Edit'];
const DISALLOWED_TOOLS = ['Bash', 'NotebookEdit', 'WebFetch', 'WebSearch'];

let cachedSkillText: string | null = null;

function loadSkillSystemPrompt(): string {
  if (cachedSkillText !== null) return cachedSkillText;
  cachedSkillText = readFileSync(SKILL_PATH, 'utf8');
  return cachedSkillText;
}

let cachedBrainIndex: string | null = null;

function loadBrainNavigation(): string {
  if (cachedBrainIndex !== null) return cachedBrainIndex;
  cachedBrainIndex = loadBrainIndex({ cwd: FORGE_ROOT });
  return cachedBrainIndex;
}

export function setupTempdir(input: RunArchitectInput): string {
  const dir = mkdtempSync(join(tmpdir(), 'forge-bench-architect-'));
  // Symlink read-only views of the repo into the tempdir.
  for (const sub of ['brain', 'skills', 'docs', 'orchestrator']) {
    symlinkSync(resolve(FORGE_ROOT, sub), resolve(dir, sub));
  }
  // Safety net only — post-S2A the agent writes to `_architect/<sid>/`, but
  // a legacy agent may still target `_queue/pending/`. Empty dir is fine.
  mkdirSync(resolve(dir, '_queue', 'pending'), { recursive: true });
  // Post-S2A surface: `projects/<name>/_architect/` exists so the agent can
  // `Write` straight to a session subdir.
  const projDir = resolve(dir, 'projects', input.projectName);
  mkdirSync(resolve(projDir, '_architect'), { recursive: true });
  if (input.projectContext !== undefined) {
    writeFileSync(resolve(projDir, 'roadmap.md'), input.projectContext);
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

function buildSystemPrompt(): string {
  return [
    '# Brain navigation index',
    '',
    'Below are the brain\'s category indexes — every theme in scope, with a one-line description. Use these descriptions to identify candidate theme pages, then read those files in full to verify and extract precise terminology, project names, and patterns. The indexes ARE the retrieval index; you should rarely need grep.',
    '',
    loadBrainNavigation(),
    '',
    '---',
    '',
    '# architect skill contract',
    '',
    loadSkillSystemPrompt(),
  ].join('\n');
}

function renderUserPrompt(input: RunArchitectInput): string {
  const sessionId = '2026-05-24T00-00-00';
  const sessionDir = `projects/${input.projectName}/_architect/${sessionId}`;
  return [
    '# Architect bench run',
    '',
    'You are running non-interactively against a benchmark fixture. The user prompt below contains a fully-specified ideation request — taste decisions have been made by the user upfront. Produce a single, valid initiative manifest. Do not ask clarifying questions; if something is genuinely under-specified, infer the most reasonable choice, note it in the body, and proceed.',
    '',
    `## Project: ${input.projectName}`,
    '',
    '## User prompt',
    '',
    input.userPrompt,
    '',
    '## Output requirements',
    '',
    `- Session id: \`${sessionId}\` (use this exact value).`,
    `- Write the manifest(s) to \`${sessionDir}/manifests/INIT-<YYYY-MM-DD>-<slug>.md\`. Use the date \`2026-05-24\` and a short kebab-case slug. The agent SKILL says drafts go here; the CLI's \`architect commit --approve\` promotes them to \`_queue/pending/\` — that step is **out of bench scope**.`,
    '- Frontmatter must conform exactly to `orchestrator/manifest.ts` — required fields: `initiative_id`, `project`, `project_repo_path`, `created_at` (ISO-8601), `iteration_budget` (>0), `cost_budget_usd` (>0), `phase: pending`, `features` (each `feature_id: FEAT-<n>`, `title`, `depends_on: [FEAT-...]`).',
    `- Aim for ${input.expected.min_features}–${input.expected.max_features} features. Initiatives are small and releasable; reject your own draft if it has more than ${input.expected.max_features}.`,
    '- Body must include **acceptance criteria for every feature** — either Given-When-Then triads or an `## Acceptance criteria` heading per feature. Vague criteria break the downstream developer loop; reject your own draft if you can\'t state the criteria concretely.',
    '- Body must cite at least one `brain/...` path you read while reasoning. The architect skill mandates brain-first; if you didn\'t consult the brain, you skipped step 1.',
    '- Apply the LLM Council critic checklist inline (CEO / Eng / Design / DX) before writing the manifest. Don\'t escalate; pick the most reasonable resolution and proceed.',
    '',
    '## PLAN.md output (cwc Amendment 1 + 2)',
    '',
    `- Also write \`${sessionDir}/PLAN.md\` mirroring \`orchestrator/architect-plan.ts:renderPlanDoc\` shape. Required H2 sections, in order:`,
    '  1. `## Operator brief + interview` — one-paragraph paraphrase of the user prompt, then `### Interview` heading, then the literal notice `_No interview rounds — operator drafted directly._` (this is a bench run; the SKILL\'s `AskUserQuestion` step is **explicitly skipped** in bench mode).',
    '  2. `## Brain context` — list every `brain/...` path you consulted with a one-line summary each.',
    '  3. `## Council transcript` — short prose summary of the CEO / Eng / Design / DX critic chain (no per-critic JSON drawer in bench).',
    '  4. `## Proposed initiatives` — markdown table with one row per manifest you wrote.',
    '  5. `## Aggregate footprint (informational)` — informational only; do **not** use words like `gate`, `threshold`, `auto-escalate`, or `aggregate_budget_declared` (C19).',
    '  6. `## Open escalations` — taste decisions the council surfaced. Each escalation must either carry an inline `<!-- review: ... -->` HTML-comment resolution OR an explicit `Deferred` / `Backlog phase 2` marker. No silent drops.',
    '- Prepend a top-of-file `<!-- verdict: approve | revise | reject -->` placeholder (the CLI parses this on commit; bench runs do not approve).',
    '',
    'Write the manifest file(s) and PLAN.md. Then stop.',
  ].join('\n');
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

function tallyToolUse(msg: AssistantMessage, summary: ToolUseSummary): void {
  const blocks = msg.message?.content ?? [];
  for (const block of blocks) {
    if (block?.type !== 'tool_use') continue;
    const name = block.name ?? '';
    if (name === 'Write' || name === 'Edit') {
      summary.writes += 1;
    } else if (name === 'Bash') {
      summary.bashCalls += 1;
    } else if (name === 'Read' || name === 'Grep' || name === 'Glob') {
      // Was the tool used against brain/? Cheap inspection of the input blob.
      const blob = JSON.stringify(block.input ?? {});
      if (blob.includes('brain/') || blob.includes('"brain"')) summary.brainReads += 1;
    }
  }
}

/**
 * Locate the latest architect session dir under
 * `projects/<projectName>/_architect/` (sorted lexicographically — ISO ids
 * compare correctly). Returns null if no session has been created.
 */
function latestSessionDir(tempdir: string, projectName: string): string | null {
  const archDir = resolve(tempdir, 'projects', projectName, '_architect');
  if (!existsSync(archDir)) return null;
  const sessions = readdirSync(archDir).filter((name) => {
    if (name === '_archived') return false;
    try {
      return statSync(resolve(archDir, name)).isDirectory();
    } catch {
      return false;
    }
  }).sort();
  return sessions.length === 0 ? null : resolve(archDir, sessions[sessions.length - 1]!);
}

/**
 * Find the architect's first manifest. Post-S2A/S2B reads from
 * `_architect/<latest-sid>/manifests/INIT-*.md`. Falls back to
 * `_queue/pending/` for legacy agents that haven't picked up the new SKILL
 * yet — flagged in the result so the caller can surface it.
 */
function findManifest(tempdir: string, projectName: string): { text: string; relPath: string } | null {
  const sessionDir = latestSessionDir(tempdir, projectName);
  if (sessionDir !== null) {
    const manifestsDir = resolve(sessionDir, 'manifests');
    if (existsSync(manifestsDir)) {
      const files = readdirSync(manifestsDir).filter((f) => f.endsWith('.md')).sort();
      if (files.length > 0) {
        const file = files[0]!;
        return {
          text: readFileSync(resolve(manifestsDir, file), 'utf8'),
          relPath: join(sessionDir.slice(tempdir.length + 1), 'manifests', file),
        };
      }
    }
  }
  // Legacy fallback — agents may still write `_queue/pending/`.
  const pendingDir = resolve(tempdir, '_queue', 'pending');
  if (existsSync(pendingDir)) {
    const files = readdirSync(pendingDir).filter((f) => f.endsWith('.md')).sort();
    if (files.length > 0) {
      const file = files[0]!;
      return {
        text: readFileSync(resolve(pendingDir, file), 'utf8'),
        relPath: join('_queue/pending', file),
      };
    }
  }
  return null;
}

function listManifestPaths(tempdir: string, projectName: string): string[] {
  const sessionDir = latestSessionDir(tempdir, projectName);
  if (sessionDir !== null) {
    const manifestsDir = resolve(sessionDir, 'manifests');
    if (existsSync(manifestsDir)) {
      return readdirSync(manifestsDir).filter((f) => f.endsWith('.md')).sort()
        .map((f) => resolve(manifestsDir, f));
    }
  }
  const pendingDir = resolve(tempdir, '_queue', 'pending');
  if (existsSync(pendingDir)) {
    return readdirSync(pendingDir).filter((f) => f.endsWith('.md')).sort()
      .map((f) => resolve(pendingDir, f));
  }
  return [];
}

function collectSiblings(tempdir: string, projectName: string, primaryRelPath: string | null): string[] {
  const primaryFile = primaryRelPath ? primaryRelPath.split('/').pop() : null;
  return listManifestPaths(tempdir, projectName)
    .filter((abs) => !primaryFile || abs.split('/').pop() !== primaryFile)
    .map((abs) => readFileSync(abs, 'utf8'));
}

function findPlanArtifacts(
  tempdir: string,
  projectName: string,
): { planDoc: string; councilTranscript: string } {
  const sessionDir = latestSessionDir(tempdir, projectName);
  if (sessionDir === null) return { planDoc: '', councilTranscript: '' };
  const planPath = resolve(sessionDir, 'PLAN.md');
  const transcriptPath = resolve(sessionDir, 'council-transcript.md');
  return {
    planDoc: existsSync(planPath) ? readFileSync(planPath, 'utf8') : '',
    councilTranscript: existsSync(transcriptPath) ? readFileSync(transcriptPath, 'utf8') : '',
  };
}

export async function runArchitect(input: RunArchitectInput): Promise<RunArchitectResult> {
  const queryFn: ArchitectQueryFn = input.queryFn ?? (sdkQuery as unknown as ArchitectQueryFn);
  const tempdir = setupTempdir(input);
  const systemPrompt = buildSystemPrompt();
  const prompt = renderUserPrompt(input);

  const options: Record<string, unknown> = {
    cwd: tempdir,
    systemPrompt,
    model: 'claude-sonnet-4-6',
    permissionMode: 'acceptEdits',
    allowedTools: ALLOWED_TOOLS,
    disallowedTools: DISALLOWED_TOOLS,
    maxTurns: 30,
    maxBudgetUsd: 0.5,
  };

  let durationMs = 0;
  let costUsd = 0;
  let runnerError: RunArchitectResult['runnerError'];
  let sawResult = false;
  const toolUseSummary: ToolUseSummary = { brainReads: 0, writes: 0, bashCalls: 0 };

  for await (const msg of queryFn({ prompt, options })) {
    if (isAssistant(msg)) {
      tallyToolUse(msg, toolUseSummary);
      continue;
    }
    if (!isResult(msg)) continue;
    sawResult = true;
    if (typeof msg.duration_ms === 'number') durationMs = msg.duration_ms;
    if (typeof msg.total_cost_usd === 'number') costUsd = msg.total_cost_usd;
    const subtype = msg.subtype ?? 'success';
    if (subtype !== 'success') {
      runnerError = { kind: subtype as RunnerErrorKind, message: `SDK result subtype: ${subtype}` };
    }
    break;
  }

  if (!sawResult && !runnerError) {
    runnerError = { kind: 'no_result', message: 'query iterator ended without a result message' };
  }

  const manifest = findManifest(tempdir, input.projectName);

  let manifestText: string | null = null;
  let manifestPath: string | null = null;
  let siblingManifestTexts: string[] = [];
  if (manifest) {
    manifestText = manifest.text;
    manifestPath = manifest.relPath;
    siblingManifestTexts = collectSiblings(tempdir, input.projectName, manifest.relPath);
    // Detect the multi-manifest case. For B1 + A1..A8 fixtures the expected
    // count is 1; B2 explicitly expects 20. The caller decides whether to
    // treat siblings as an error based on the fixture's shape.
    const allManifests = listManifestPaths(tempdir, input.projectName);
    if (allManifests.length > 1 && !runnerError) {
      runnerError = {
        kind: 'multiple_manifests_written',
        message: `Expected 1 manifest in _architect session dir; found ${allManifests.length}`,
      };
    }
  } else if (!runnerError) {
    const sessionDir = latestSessionDir(tempdir, input.projectName);
    const expectedLocation = sessionDir
      ? join(sessionDir, 'manifests')
      : `projects/${input.projectName}/_architect/<sid>/manifests/ (or legacy _queue/pending/)`;
    runnerError = {
      kind: 'no_manifest_written',
      message: `No manifest found under ${expectedLocation} after run`,
    };
  }

  const { planDoc, councilTranscript } = findPlanArtifacts(tempdir, input.projectName);

  return {
    manifestText,
    manifestPath,
    siblingManifestTexts,
    planDoc,
    councilTranscript,
    tempdir,
    durationMs,
    costUsd,
    runnerError,
    toolUseSummary,
  };
}
