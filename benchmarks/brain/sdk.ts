/**
 * SDK invocation helper for the brain benchmark.
 *
 * One call ≈ one brain-query against one benchmark question. Reads the
 * brain-query SKILL.md as system prompt at runtime so SKILL changes flow
 * through. Constrained to read tools (Read/Grep/Glob); writes are explicitly
 * disallowed. Output is structured-JSON via the SDK's `outputFormat` option.
 *
 * Mirrors the structured-output pattern in
 * `skills/architect-llm-council/council.ts` — same DI-friendly `queryFn`
 * override for unit tests.
 *
 * `permissionMode: 'acceptEdits'` (not `'plan'`): `'plan'` blocks tool
 * execution per the SDK type docs, which would force brain-query to fabricate
 * source citations. Read-only behaviour comes from the allowedTools/disallowedTools
 * pair, not the permission mode.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';

import { loadBrainIndex, type BrainCategory } from '../../orchestrator/brain-index.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..', '..');
const SKILL_PATH = resolve(FORGE_ROOT, 'skills', 'brain-query', 'SKILL.md');

export type BrainQueryFn = (params: {
  prompt: string;
  options?: Record<string, unknown>;
}) => AsyncIterable<unknown>;

export type BrainAnswer = {
  question: string;
  answer: string;
  confidence: 'high' | 'medium' | 'low';
  sources: string[];
  gap?: boolean;
};

export type BrainQueryStructured = {
  answers: BrainAnswer[];
};

export type RunBrainQueryInput = {
  question: string;
  scope?: string | null;
  category?: string | null;
  /** Inject a fake `query` for testing. */
  queryFn?: BrainQueryFn;
};

export type RunnerErrorKind =
  | 'error_max_turns'
  | 'error_max_budget_usd'
  | 'error_max_structured_output_retries'
  | 'error_during_execution'
  | 'no_result'
  | 'no_structured_output'
  | 'invalid_structured_output';

export type RunBrainQueryResult = {
  structured: BrainQueryStructured | null;
  durationMs: number;
  costUsd: number;
  runnerError?: { kind: RunnerErrorKind; message: string };
};

const ANSWERS_SCHEMA = {
  type: 'object',
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          answer: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          sources: {
            type: 'array',
            items: { type: 'string' },
          },
          gap: { type: 'boolean' },
        },
        required: ['question', 'answer', 'confidence', 'sources'],
      },
    },
  },
  required: ['answers'],
};

const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob'];
const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash'];

let cachedSkillText: string | null = null;

function loadSkillSystemPrompt(): string {
  if (cachedSkillText !== null) return cachedSkillText;
  cachedSkillText = readFileSync(SKILL_PATH, 'utf8');
  return cachedSkillText;
}

const cachedIndexByKey: Map<string, string> = new Map();

function loadIndexPrefix(scope: string | null | undefined, category: BrainCategory | null | undefined): string {
  const key = `${scope ?? '_'}:${category ?? '_'}`;
  const cached = cachedIndexByKey.get(key);
  if (cached !== undefined) return cached;
  const index = loadBrainIndex({ cwd: FORGE_ROOT, scope, category });
  cachedIndexByKey.set(key, index);
  return index;
}

function buildSystemPrompt(scope: string | null | undefined, category: BrainCategory | null | undefined): string {
  const skill = loadSkillSystemPrompt();
  const index = loadIndexPrefix(scope, category);
  return [
    '# Brain navigation index',
    '',
    'Below are the brain\'s category indexes — every theme in scope, with a one-line description. Use these descriptions to identify candidate theme pages, then read those files in full to verify and extract precise terminology / numbers / project names. The indexes ARE the retrieval index; you should rarely need grep.',
    '',
    index,
    '',
    '---',
    '',
    '# brain-query skill contract',
    '',
    skill,
  ].join('\n');
}

function renderUserPrompt(input: RunBrainQueryInput): string {
  const lines = [
    'Answer one benchmark question against the brain. Return a structured response with one entry in `answers`.',
    '',
    `Question: ${input.question}`,
  ];
  if (input.scope) lines.push(`Scope: brain/projects/${input.scope}/`);
  if (input.category) lines.push(`Category: ${input.category}`);
  lines.push('');
  lines.push('Citation: cite every theme whose content materially answered the question (each adds a distinct claim). Forge concepts often span 2–4 themes — pattern + antipattern + operation triads, or profile + theme pairs. Cite all members of such a cluster.');
  lines.push('');
  lines.push('Anti-noise rule: if a theme contributed only a single passing reference (one sentence aside, one terminology mention), that\'s not enough to cite. A cited theme must be the source of multiple distinct concepts or claims in your answer. When in doubt, drop it.');
  lines.push('');
  lines.push('Hard limits: cite at most 4 themes per question (most questions span 2–3). Use brain-relative paths only — never cite `brain/_raw/*`, `brain/INDEX.md`, or category index files.');
  lines.push('');
  lines.push('Synthesis: preserve exact terminology from the cited themes — terms like `forge serve`, `atomic mv`, `_queue`, `gw:plan`, `triage`, `control repo`, `agent stage`, `layered merge`, `Steiner`, `graph colouring`; numbers like `48%`, `92%`, `109 items`, `90 test failures`, `Cycle 2`; project names like `trafficGame`, `GitWeave`, `simplarr`, `healarr`, `env-optimiser`. Mark `gap: true` only when no on-topic theme exists.');
  return lines.join('\n');
}

function isStructured(value: unknown): value is BrainQueryStructured {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { answers?: unknown };
  return Array.isArray(v.answers);
}

export async function runBrainQuery(input: RunBrainQueryInput): Promise<RunBrainQueryResult> {
  const queryFn: BrainQueryFn = input.queryFn ?? (sdkQuery as unknown as BrainQueryFn);
  const systemPrompt = buildSystemPrompt(input.scope ?? null, (input.category ?? null) as BrainCategory | null);
  const prompt = renderUserPrompt(input);

  const options: Record<string, unknown> = {
    cwd: FORGE_ROOT,
    systemPrompt,
    model: 'claude-haiku-4-5',
    permissionMode: 'acceptEdits',
    allowedTools: READ_ONLY_TOOLS,
    disallowedTools: WRITE_TOOLS,
    maxTurns: 15,
    maxBudgetUsd: 0.2,
    outputFormat: { type: 'json_schema', schema: ANSWERS_SCHEMA },
  };

  let durationMs = 0;
  let costUsd = 0;
  let structured: BrainQueryStructured | null = null;
  let runnerError: RunBrainQueryResult['runnerError'];
  let sawResult = false;

  for await (const msg of queryFn({ prompt, options })) {
    const m = msg as {
      type?: string;
      subtype?: string;
      total_cost_usd?: number;
      duration_ms?: number;
      structured_output?: unknown;
    };
    if (m.type !== 'result') continue;
    sawResult = true;
    if (typeof m.duration_ms === 'number') durationMs = m.duration_ms;
    if (typeof m.total_cost_usd === 'number') costUsd = m.total_cost_usd;

    const subtype = m.subtype ?? 'success';
    if (subtype !== 'success') {
      runnerError = {
        kind: subtype as RunnerErrorKind,
        message: `SDK result subtype: ${subtype}`,
      };
      break;
    }

    if (m.structured_output === undefined || m.structured_output === null) {
      runnerError = { kind: 'no_structured_output', message: 'result message had no structured_output' };
      break;
    }
    if (!isStructured(m.structured_output)) {
      runnerError = {
        kind: 'invalid_structured_output',
        message: 'structured_output did not match { answers: [...] } shape',
      };
      break;
    }
    structured = m.structured_output;
    break;
  }

  if (!sawResult && !runnerError) {
    runnerError = { kind: 'no_result', message: 'query iterator ended without a result message' };
  }

  return { structured, durationMs, costUsd, runnerError };
}
