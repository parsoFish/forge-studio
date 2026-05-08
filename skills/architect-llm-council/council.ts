/**
 * LLM Council critic-chain runner.
 *
 * The architect skill delegates to architect-llm-council to run a draft
 * initiative through CEO/eng/design/DX critics. Each critic is invoked as an
 * SDK subagent; mechanical issues (`flags`) are auto-applied; taste decisions
 * (`escalations`) are aggregated and surfaced to the user.
 *
 * Per ADR 003 (skills-as-agents) and the architect-llm-council SKILL.md.
 *
 * The SDK's `query` is dependency-injectable (`queryFn`) so unit tests verify
 * the critic-chain plumbing without hitting the network.
 */

import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';

export type Critic = {
  /** Stable identifier — `ceo`, `eng`, etc. Used for de-duplicating escalations. */
  name: string;
  /** The system prompt for this critic perspective. */
  prompt: string;
  /** Model to use. `sonnet` is the default. */
  model: 'sonnet' | 'opus' | 'haiku';
};

export type Flag = {
  /** Stable identifier for the flag (e.g. `missing-rollback`). */
  id: string;
  description: string;
  /** Description of the auto-applied fix; the orchestrator/architect persists it. */
  appliedFix: string;
};

export type EscalationOption = {
  label: string;
  rationale: string;
};

export type Escalation = {
  /** Which critic raised this. */
  critic: string;
  question: string;
  options: EscalationOption[];
};

export type CriticVerdict = {
  flags: Flag[];
  escalations: Escalation[];
};

export type CouncilQueryFn = (params: {
  prompt: string;
  options?: Record<string, unknown>;
}) => AsyncIterable<unknown>;

export type CouncilInput = {
  /** The draft initiative spec (markdown body — frontmatter handled separately). */
  draft: string;
  /** Critics to run, in order. */
  critics: Critic[];
  /** Project context to pass into every critic prompt. Optional but recommended. */
  projectContext?: string;
  /** Inject a fake `query` for testing. */
  queryFn?: CouncilQueryFn;
};

export type CouncilResult = {
  flags: Flag[];
  escalations: Escalation[];
  totalCostUsd: number;
  /** Per-critic verdicts kept for audit / event log. */
  perCritic: { critic: string; verdict: CriticVerdict; costUsd: number }[];
};

const STRUCTURED_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    flags: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          description: { type: 'string' },
          appliedFix: { type: 'string' },
        },
        required: ['id', 'description', 'appliedFix'],
      },
    },
    escalations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          critic: { type: 'string' },
          question: { type: 'string' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                rationale: { type: 'string' },
              },
              required: ['label', 'rationale'],
            },
          },
        },
        required: ['critic', 'question', 'options'],
      },
    },
  },
  required: ['flags', 'escalations'],
};

export async function runCouncil(input: CouncilInput): Promise<CouncilResult> {
  const queryFn: CouncilQueryFn = input.queryFn ?? (sdkQuery as unknown as CouncilQueryFn);
  const flags: Flag[] = [];
  const escalations: Escalation[] = [];
  const perCritic: CouncilResult['perCritic'] = [];
  let totalCostUsd = 0;
  const seen = new Set<string>(); // critic:question keys for de-duplication

  for (const critic of input.critics) {
    const prompt = renderCriticPrompt(critic, input.draft, input.projectContext);
    const options: Record<string, unknown> = {
      systemPrompt: critic.prompt,
      model: critic.model,
      maxTurns: 5,
      permissionMode: 'plan',                         // critics never modify files
      allowedTools: [],                                // structured-only
      outputFormat: { type: 'json_schema', schema: STRUCTURED_OUTPUT_SCHEMA },
      _criticName: critic.name,                        // for test introspection only
    };

    let verdict: CriticVerdict | null = null;
    let costUsd = 0;
    for await (const msg of queryFn({ prompt, options })) {
      const m = msg as { type?: string; subtype?: string; structured_output?: unknown; total_cost_usd?: number };
      if (m.type !== 'result') continue;
      if (typeof m.total_cost_usd === 'number') costUsd = m.total_cost_usd;
      if (!m.structured_output) {
        throw new Error(`council critic ${critic.name}: result message had no structured_output (verdict)`);
      }
      verdict = m.structured_output as CriticVerdict;
      break;
    }
    if (!verdict) {
      throw new Error(`council critic ${critic.name}: no result message received (no verdict)`);
    }

    totalCostUsd += costUsd;
    perCritic.push({ critic: critic.name, verdict, costUsd });
    flags.push(...verdict.flags);
    for (const e of verdict.escalations) {
      const key = `${e.critic}:${e.question}`;
      if (seen.has(key)) continue;
      seen.add(key);
      escalations.push(e);
    }
  }

  return { flags, escalations, totalCostUsd, perCritic };
}

function renderCriticPrompt(critic: Critic, draft: string, projectContext?: string): string {
  return [
    `You are the **${critic.name}** critic on the architect's LLM Council.`,
    '',
    'Your job: review the draft initiative below and emit a structured verdict.',
    '',
    '- `flags`: mechanical issues you can auto-resolve. For each, supply an `id`, a short `description`, and the `appliedFix` (a one-line description of the fix you would apply).',
    '- `escalations`: taste decisions only the user can make. For each, supply `critic` (your name), the `question`, and 2-4 `options` each with a `label` and `rationale`.',
    '',
    'Do not invent new requirements. Improve what is there; do not expand scope.',
    '',
    projectContext ? `## Project context\n\n${projectContext}\n` : '',
    '## Draft initiative',
    '',
    draft,
  ].filter((s) => s !== '').join('\n');
}

export function defaultCritics(): Critic[] {
  return [
    {
      name: 'ceo',
      model: 'sonnet',
      prompt: [
        'You are the CEO critic. Evaluate strategic alignment.',
        '- Does this initiative align with the project\'s stated direction?',
        '- Is the value proposition clear?',
        '- Is it the most leveraged thing right now, or should something else come first?',
        '- Is the scope releasable as a coherent unit, or is it really two initiatives?',
      ].join('\n'),
    },
    {
      name: 'eng',
      model: 'sonnet',
      prompt: [
        'You are the engineering critic. Evaluate technical clarity.',
        '- Are dependencies between features explicit (depends_on) and acyclic?',
        '- Are acceptance criteria verifiable (Given-When-Then) by the orchestrator (npm test, gh pr checks), not just claimed by the agent?',
        '- Is each work item atomic enough for the developer loop (≤3 files where possible)?',
        '- Is the rollback path stated for changes that touch persistent state?',
      ].join('\n'),
    },
    {
      name: 'design',
      model: 'sonnet',
      prompt: [
        'You are the design critic. Evaluate user experience.',
        '- For user-facing initiatives: is the experience considered (states, edge cases, accessibility)?',
        '- For non-UI initiatives: skip with no flags or escalations.',
        '- Is there an information-architecture impact downstream of this initiative?',
      ].join('\n'),
    },
    {
      name: 'dx',
      model: 'sonnet',
      prompt: [
        'You are the developer-experience critic. Evaluate maintainability.',
        '- Does this make the project easier or harder to work on next month?',
        '- Are migrations / deprecations handled? (e.g. removing an API: is there a deprecation window?)',
        '- Does this introduce a new dependency, framework, or build step? If so, is the cost justified vs the alternative?',
        '- Is there a runbook / documentation update implied that has not been called out?',
      ].join('\n'),
    },
  ];
}
