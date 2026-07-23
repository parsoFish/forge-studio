/**
 * Architect completeness critic — a one-shot, advisory structured-output SDK
 * turn run at architect FINALIZE (after the operator approves the PLAN,
 * before manifests promote to `_queue/pending/`).
 *
 * Grounding: `brain/forge-dev/themes/2026-07-01-architect-coverage-scope-fidelity.md`
 * — a betterado migration roadmap review caught coverage gaps (dropped scope,
 * orphan/double-owned initiatives, invariants stated once in prose but never
 * propagated into every constrained initiative's ACs) that a human judge pass
 * found but no automated gate did. This module is that judge pass, wired into
 * the pipeline instead of run by hand after the fact.
 *
 * Unlike `brain-fix-runner.ts` / `preflight-fix-runner.ts` this module owns no
 * logger, log dir, or heartbeat file — it is a pure `context in → findings out`
 * call. `architect-runner.ts`'s `runFinalizeStep` already owns the session's
 * event logger and emits the `architect.completeness-critic` start/end/finding
 * events around this call, matching how the rest of that function's own
 * `logger.emit` calls work (no sub-module owns logging there either).
 *
 * Advisory-only: ANY failure (a thrown queryFn, a stream error, a malformed or
 * missing structured_output) resolves to `{ findings: [], crashed: <bool> }`
 * rather than throwing — this pass must never brick finalize. The caller is
 * responsible for logging a crash loudly.
 *
 * Note: a crash still CONSUMES the session's one-shot gate — the caller
 * persists `status.completenessCritic` with `crashed: true` and finalize never
 * re-runs the critic for that session. Intentional: the pass is advisory
 * infrastructure and promotion proceeds on crash anyway, so re-arming it would
 * only add a second failure mode to the retry path.
 */

import { existsSync, readFileSync } from 'node:fs';

import { pinnedSdkQuery as sdkQuery } from './pinned-sdk-query.ts';
import { runStructuredTurn, type QueryFn } from './interactive-session.ts';
import { modelForSpec } from './phase-agent.ts';
import { deriveAgentSpec } from './studio/derive.ts';
import { skillPath, skillPathRelative } from './skill-path.ts';
import type { ToolUseLiveDetail } from '../loops/ralph/claude-agent.ts';

export type { QueryFn };

// ---------------------------------------------------------------------------
// ADR-024: spec derived from skills/architect-completeness-critic/SKILL.md
// ---------------------------------------------------------------------------

export const completenessCriticAgentSpec = deriveAgentSpec(
  skillPathRelative('architect-completeness-critic'),
);
export const COMPLETENESS_CRITIC_MODEL = modelForSpec(completenessCriticAgentSpec);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CompletenessCriticSeverity = 'high' | 'medium' | 'low';

export type CompletenessCriticFinding = {
  severity: CompletenessCriticSeverity;
  /** Omitted for a finding that spans the whole plan (no single owner). */
  initiativeId?: string;
  gap: string;
};

export type RunCompletenessCriticInput = {
  /** The operator's raw idea (also persisted to `idea.md`). */
  idea: string;
  /** Rendered interview Q/A transcript; pass a placeholder when empty. */
  interviewSummary: string;
  /** The rendered PLAN.md content, or null when absent. */
  planMarkdown: string | null;
  /** One block per manifest about to be promoted (id + depends_on + body). */
  manifestsSummary: string;
  /** Inject a fake queryFn for tests; defaults to the pinned SDK. */
  queryFn?: QueryFn;
  /** Absolute path to the critic skill prompt (ADR 003); tests override. */
  skillPromptPath?: string;
  onToolUse?: (d: ToolUseLiveDetail) => void;
  onHeartbeat?: () => void;
  onText?: (text: string) => void;
};

export type RunCompletenessCriticResult = {
  findings: CompletenessCriticFinding[];
  /** True when the turn threw (SDK stream error, etc). `findings` is always
   *  `[]` in this case — advisory infra never blocks finalize. */
  crashed: boolean;
  /** Bounded (first `CRITIC_MAX_CRASH_ERROR_CHARS` chars) message from the
   *  thrown error; present only when `crashed` is true. */
  error?: string;
};

// ---------------------------------------------------------------------------
// Bounds — roadmap-scale sessions (20+ manifests) are the DESIGN target, so
// every LLM-facing input and output is explicitly bounded.
// ---------------------------------------------------------------------------

/** Per-manifest body budget inside the critic prompt (used by the caller when
 *  assembling `manifestsSummary`); a body past this carries an explicit
 *  `[truncated N chars]` marker. */
export const CRITIC_MAX_MANIFEST_BODY_CHARS = 8_000;
/** Whole-prompt budget (skill prompt + idea + interview + PLAN + manifests).
 *  ~40k tokens — comfortable headroom inside sonnet's context window. */
export const CRITIC_MAX_TOTAL_PROMPT_CHARS = 160_000;
/** Max findings kept from one critic run; the model is asked for the highest-
 *  severity gaps first, so the tail is dropped. */
export const CRITIC_MAX_FINDINGS = 20;
/** Max length of a single finding's `gap` text. */
export const CRITIC_MAX_GAP_CHARS = 2_000;
/** Max length of the crash `error` detail captured on the result. */
export const CRITIC_MAX_CRASH_ERROR_CHARS = 500;

/** Truncate `text` to `max` chars, appending an explicit marker naming how
 *  many chars were dropped. Under-budget text passes through untouched. */
export function truncateWithMarker(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[truncated ${text.length - max} chars]`;
}

// ---------------------------------------------------------------------------
// Structured-output schema + sanitization
// ---------------------------------------------------------------------------

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          initiativeId: { type: 'string' },
          gap: { type: 'string' },
        },
        required: ['severity', 'gap'],
      },
    },
  },
  required: ['findings'],
};

const SEVERITIES: readonly CompletenessCriticSeverity[] = ['high', 'medium', 'low'];

function isSeverity(v: unknown): v is CompletenessCriticSeverity {
  return typeof v === 'string' && (SEVERITIES as readonly string[]).includes(v);
}

/**
 * Sanitize the model's raw structured output into a safe, well-typed findings
 * array. Never throws — a malformed or missing shape degrades to `[]`:
 *   - entries with an empty/whitespace-only `gap` are dropped (nothing
 *     actionable to show the operator);
 *   - an invalid or missing `severity` defaults to `'medium'` rather than
 *     dropping the finding;
 *   - a blank/whitespace-only `initiativeId` is treated as absent;
 *   - LLM output is bounded: at most `CRITIC_MAX_FINDINGS` entries are kept
 *     (excess dropped) and each `gap` is truncated to `CRITIC_MAX_GAP_CHARS`.
 */
function sanitizeFindings(raw: unknown): CompletenessCriticFinding[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const findings = (raw as { findings?: unknown }).findings;
  if (!Array.isArray(findings)) return [];

  const out: CompletenessCriticFinding[] = [];
  for (const item of findings) {
    if (out.length >= CRITIC_MAX_FINDINGS) break;
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const gap = typeof rec.gap === 'string' ? rec.gap.trim().slice(0, CRITIC_MAX_GAP_CHARS) : '';
    if (!gap) continue;
    const severity: CompletenessCriticSeverity = isSeverity(rec.severity) ? rec.severity : 'medium';
    const initiativeId =
      typeof rec.initiativeId === 'string' && rec.initiativeId.trim() ? rec.initiativeId.trim() : undefined;
    out.push({ severity, gap, ...(initiativeId ? { initiativeId } : {}) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

const CLOSING_INSTRUCTION = 'Return ONLY the structured findings JSON.';

function buildPrompt(skillPrompt: string, input: RunCompletenessCriticInput): string {
  const prompt = [
    skillPrompt,
    '',
    '## Session context to review',
    '',
    '### Operator idea',
    input.idea || '_(none recorded)_',
    '',
    '### Interview transcript',
    input.interviewSummary || '_(no interview)_',
    '',
    '### Rendered PLAN',
    input.planMarkdown ?? '_(no PLAN.md on disk)_',
    '',
    '### Final manifests about to be promoted to the queue',
    input.manifestsSummary || '_(no manifests found)_',
    '',
    CLOSING_INSTRUCTION,
  ].join('\n');
  if (prompt.length <= CRITIC_MAX_TOTAL_PROMPT_CHARS) return prompt;
  // Over budget even after per-manifest truncation (roadmap-scale session with
  // a huge PLAN, or dozens of manifests): hard-cap the whole prompt, but keep
  // the closing output instruction so the structured turn still lands.
  return [
    truncateWithMarker(prompt, CRITIC_MAX_TOTAL_PROMPT_CHARS),
    '',
    CLOSING_INSTRUCTION,
  ].join('\n');
}

let cachedSkill: string | null = null;
function loadSkillPrompt(skillPromptPath?: string): string {
  if (skillPromptPath) {
    try {
      return readFileSync(skillPromptPath, 'utf8');
    } catch {
      /* fall through to the default lookup below */
    }
  }
  if (cachedSkill !== null) return cachedSkill;
  const def = skillPath('architect-completeness-critic');
  cachedSkill = existsSync(def)
    ? readFileSync(def, 'utf8')
    : 'You are the forge architect completeness critic.';
  return cachedSkill;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Run the completeness critic's one-shot structured turn. See module doc for
 * the advisory-only crash contract.
 */
export async function runCompletenessCritic(
  input: RunCompletenessCriticInput,
): Promise<RunCompletenessCriticResult> {
  const queryFn: QueryFn = input.queryFn ?? (sdkQuery as unknown as QueryFn);
  const skillPrompt = loadSkillPrompt(input.skillPromptPath);
  const prompt = buildPrompt(skillPrompt, input);

  try {
    const { output } = await runStructuredTurn<{ findings?: unknown }>({
      queryFn,
      prompt,
      schema: FINDINGS_SCHEMA,
      model: COMPLETENESS_CRITIC_MODEL,
      allowedTools: completenessCriticAgentSpec.allowedTools,
      onToolUse: input.onToolUse,
      onHeartbeat: input.onHeartbeat,
      onText: input.onText,
      label: 'architect-completeness-critic',
    });
    return { findings: sanitizeFindings(output), crashed: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      findings: [],
      crashed: true,
      error: message.slice(0, CRITIC_MAX_CRASH_ERROR_CHARS),
    };
  }
}
