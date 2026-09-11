/**
 * The architect kind's COMPLETENESS CRITIC — a composition detail, not a
 * session kind (M4 ruling 62): no `run<X>Turn`, no registry row, no operator
 * surface. One structured sub-turn the architect runs over a drafted plan.
 *
 * WHEN IT RUNS (ruling 380, 2026-09-07): at the END of the DRAFTING turn,
 * before the operator is ever asked. Findings send the architect another draft
 * round; only a clean pass (or the round ceiling) promotes the session to
 * `awaiting-verdict`. It used to run at FINALIZE, after the approve press —
 * which showed the operator a plan, took their approval, then told them the
 * plan was incomplete and re-armed the gate. `runDraftRounds`
 * (`architect-steps.ts`) is the caller and owns every phase decision.
 *
 * Grounding: `brain/forge-dev/themes/2026-07-01-architect-coverage-scope-fidelity.md`
 * — a betterado migration roadmap review caught coverage gaps (dropped scope,
 * orphan/double-owned initiatives, invariants stated once in prose but never
 * propagated into every constrained initiative's ACs) that a human judge pass
 * found but no automated gate did. This module is that judge pass, wired into
 * the pipeline instead of run by hand after the fact.
 *
 * Unlike `brain-fix-runner.ts` / `preflight-fix-runner.ts` it owns no logger,
 * log dir or heartbeat file — a pure `context in → findings out` call. The
 * caller owns the session's event logger and emits the
 * `architect.completeness-critic` start/end/finding events around it.
 *
 * Advisory-only: ANY failure (a thrown queryFn, a stream error, a malformed or
 * missing structured_output) resolves to `{ findings: [], crashed: <bool> }`
 * rather than throwing — this pass must never brick a session. The caller logs
 * a crash loudly and proceeds to the ask: a critic that fell over must not
 * strand a session waiting for a verdict nobody can give.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { pinnedSdkQuery as sdkQuery } from '@forge/agents/pinned-sdk-query.ts';
import { runStructuredTurn, type QueryFn } from '../interactive-session.ts';
import type { EventLogger } from '@forge/kernel';
import { hooksSpreadForAgent } from './kind-turn.ts';
import { modelForSpec } from '@forge/agents/phase-agent.ts';
import { deriveAgentSpec } from '@forge/agents/studio/derive.ts';
import { skillPath, skillPathRelative } from '@forge/agents/skill-path.ts';
import type { ToolUseLiveDetail } from '@forge/agents/ralph/claude-agent.ts';
import { requirePorts, type ArchitectManifestPorts } from './architect-ports.ts';
import { readInterview, type ArchitectStatus, type CompletenessCriticStatus, type RunArchitectTurnInput } from './architect-session.ts';
import type { InterviewRound, sessionPaths } from './architect-plan.ts';

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
  /** W8-B6 — the caller's run logger + initiative id. REQUIRED (not additive-
   *  optional) so a call site cannot silently spawn hook-blind; the sole
   *  production caller is `architect-runner.ts`, which holds both. */
  logger: EventLogger;
  initiativeId: string;
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
      disallowedTools: completenessCriticAgentSpec.disallowedTools,
      ...hooksSpreadForAgent({ skill: completenessCriticAgentSpec.skill, logger: input.logger, initiativeId: input.initiativeId }),
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

// ---------------------------------------------------------------------------
// The architect's critic STEP — the turn-side wrapper (ruling 380)
// ---------------------------------------------------------------------------

/** The ONE renderer for a session's flattened interview Q/A — the draft prompt
 *  and the critic prompt had a copy each, which is where two renderings of one
 *  thing start to disagree. `empty` is each caller's own placeholder. */
export function renderInterviewSummary(rounds: InterviewRound[], empty: string): string {
  if (rounds.length === 0) return empty;
  return rounds.map((r, i) => `${i + 1}. Q: ${r.question}\n   A: ${r.answer}`).join('\n');
}

/** Render every manifest about to be promoted (id, dependencies, full body)
 *  into one block per initiative for the critic prompt. Reads fresh from disk
 *  so the critic reviews EXACTLY what `promoteManifests` is about to move. */
function buildManifestsSummary(manifestsDir: string, parseManifest: ArchitectManifestPorts['parseManifest']): string {
  if (!existsSync(manifestsDir)) return '(no manifests found)';
  const files = readdirSync(manifestsDir).filter((f) => f.endsWith('.md'));
  if (files.length === 0) return '(no manifests found)';
  return files
    .map((f) => {
      const m = parseManifest(readFileSync(join(manifestsDir, f), 'utf8'));
      const deps = m.depends_on_initiatives?.length ? m.depends_on_initiatives.join(', ') : '(none)';
      // Roadmap-scale sessions promote 20+ manifests — bound each body so the
      // assembled critic prompt cannot blow the context window.
      const body = truncateWithMarker(m.body, CRITIC_MAX_MANIFEST_BODY_CHARS);
      return `### ${m.initiative_id}\ndepends_on: ${deps}\n\n${body}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Run the critic ONCE over the draft now on disk and return the record to fold
 * onto the session status. Never throws — a crash is advisory infra (zero
 * findings, loudly logged), so a critic that fell over cannot strand a session.
 * It makes NO phase decision: `runDraftRounds` owns that (ruling 380).
 */
export async function runCompletenessCriticStep(args: {
  input: RunArchitectTurnInput;
  paths: ReturnType<typeof sessionPaths>;
  status: ArchitectStatus;
  logger: EventLogger;
  queryFn: QueryFn;
  /** The draft round this record checked — see `CompletenessCriticStatus`. */
  round: number;
}): Promise<CompletenessCriticStatus> {
  const { input, paths, status, logger, queryFn, round } = args;
  const initiativeId = `architect-session-${input.sessionId}`;

  const critStart = logger.emit({
    initiative_id: initiativeId,
    phase: 'architect',
    skill: 'architect-completeness-critic',
    event_type: 'start',
    input_refs: [paths.planPath],
    output_refs: [],
    message: 'architect.completeness-critic.start',
    metadata: { session_id: input.sessionId },
  });

  const interviewSummary = renderInterviewSummary(
    readInterview(input.projectRoot, input.sessionId),
    '(no interview — the operator drafted directly)',
  );
  const planMarkdown = existsSync(paths.planPath) ? readFileSync(paths.planPath, 'utf8') : null;
  const manifestsSummary = buildManifestsSummary(paths.manifestsDir, requirePorts(input).parseManifest);

  const critic = await runCompletenessCritic({
    idea: status.idea,
    interviewSummary,
    planMarkdown,
    manifestsSummary,
    queryFn,
    logger,
    initiativeId,
  });

  // One emit shape for all three outcomes — the three call sites below differed
  // only in type, message and metadata, and a copy each is where the parent id
  // or the plan ref quietly stops being set on one of them.
  const emit = (
    event_type: 'end' | 'error' | 'log',
    message: string,
    metadata: Record<string, unknown>,
    initiativeIdOverride?: string,
  ): void => {
    logger.emit({
      initiative_id: initiativeIdOverride ?? initiativeId,
      parent_event_id: critStart.event_id,
      phase: 'architect',
      skill: 'architect-completeness-critic',
      event_type,
      input_refs: [paths.planPath],
      output_refs: [],
      message,
      metadata: { session_id: input.sessionId, ...metadata },
    });
  };

  if (critic.crashed) {
    // Advisory infra — never strand the session, but log loudly.
    emit('error', 'architect.completeness-critic.crashed — proceeding to the ask (advisory infra, zero findings)',
      { error: critic.error ?? null });
  } else {
    emit('end', `architect.completeness-critic.end (findings=${critic.findings.length})`,
      { findings_count: critic.findings.length });
    // The operator's record of what was faulted — one event per finding.
    for (const f of critic.findings) {
      emit('log', `architect.completeness-critic.finding (${f.severity}): ${f.gap}`,
        { severity: f.severity, initiativeId: f.initiativeId, gap: f.gap }, f.initiativeId ?? undefined);
    }
  }

  return {
    ranAt: new Date().toISOString(),
    round,
    findings: critic.findings,
    ...(critic.crashed ? { crashed: true } : {}),
  };
}
