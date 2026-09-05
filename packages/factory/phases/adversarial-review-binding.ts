/**
 * Adversarial-review invocation contract — system + user prompt builders
 * (R4-08-F1).
 *
 * ADR 024/039: skills/adversarial-review/SKILL.md is the single source of the
 * agent's intent; this binding emits only DYNAMIC run context. The system
 * prompt = the SKILL.md verbatim (composition is empty — the agent needs no
 * contract skill; its output contract lives in its own SKILL.md + the
 * review-findings schema). The user prompt = per-cycle briefing: run identity
 * (initiative/cycle/baseRef/headSha — echoed verbatim into the findings
 * record), the orchestrator-assembled review-input file paths, the
 * initiative's ACs + WI list, the demo's acEvaluations (the AC-proof this
 * pass critiques, never trusts), and ADVISORY project-brain context for the
 * convention-drift lens.
 *
 * Caching intent (S8/C23): no per-run data in the system prompt; everything
 * dynamic lives in the user prompt.
 */

import { readFileSync } from 'node:fs';

import { skillPath } from '@forge/agents/skill-path.ts';

const AGENT_SKILL_PATH = skillPath('adversarial-review');

/** Orchestrator-assembled inputs the agent Reads (worktree-relative). */
export const REVIEW_INPUT_REL_DIR = '.forge/review-input';

/** The one file the agent authors (worktree-relative, under .forge/). */
export const REVIEW_FINDINGS_FILENAME = 'review-findings.json';

let cachedSystemPrompt: string | null = null;

export function buildAdversarialReviewSystemPrompt(): string {
  if (cachedSystemPrompt !== null) return cachedSystemPrompt;
  cachedSystemPrompt = [
    '# adversarial-review skill contract',
    '',
    readFileSync(AGENT_SKILL_PATH, 'utf8'),
  ].join('\n');
  return cachedSystemPrompt;
}

export type AdversarialReviewUserPromptInput = {
  initiativeId: string;
  cycleId: string;
  baseRef: string;
  headSha: string;
  /** Aggregated from the initiative's WI specs, WI-id-prefixed. */
  acceptanceCriteria: string[];
  workItems: Array<{ id: string; title: string; status: string }>;
  /** From the orchestrator's changed-files derivation (the diff's file list). */
  changedFiles: string[];
  /**
   * The lenses this class is reviewed under (the class profile's `reviewLenses`).
   * The prompt names them and the validator holds the agent to them, from the
   * SAME array — a prompt that offered one vocabulary while the check enforced
   * another would reject correct work for a reason the agent was never told.
   */
  lenses: ReadonlyArray<string>;
  /** ADVISORY project-brain context for the convention-drift lens only. */
  brainContext: ReadonlyArray<{ path: string; content: string }>;
};

export function renderAdversarialReviewUserPrompt(input: AdversarialReviewUserPromptInput): string {
  const acList =
    input.acceptanceCriteria.length > 0
      ? input.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
      : '_(no acceptance criteria recorded — review the diff on its own merits)_';
  const wiList =
    input.workItems.length > 0
      ? input.workItems.map((w) => `- ${w.id} [${w.status}] ${w.title}`).join('\n')
      : '- _(no work items recorded)_';
  const changed =
    input.changedFiles.length > 0
      ? input.changedFiles.map((f) => `- \`${f}\``).join('\n')
      : '- _(empty diff — say so in the summary)_';
  const lensList = input.lenses.map((l) => `- \`${l}\``).join('\n');

  const brainBlock =
    input.brainContext.length > 0
      ? [
          '',
          '## Project-brain context (ADVISORY — convention-drift lens only)',
          '',
          'Departures from these conventions are at most minor/info findings; never a blocker on style.',
          ...input.brainContext.flatMap(({ path, content }) => ['', `### ${path}`, '', '```markdown', content.trim(), '```']),
        ]
      : [];

  return [
    '# Adversarial-review invocation',
    '',
    'Follow the adversarial-review skill contract in your system prompt. Critique this',
    "initiative's developed diff; author the findings file and stop.",
    '',
    `## Run identity (echo these verbatim into the findings record)`,
    '',
    `- initiative_id: \`${input.initiativeId}\``,
    `- cycleId: \`${input.cycleId}\``,
    `- baseRef: \`${input.baseRef}\``,
    `- headSha: \`${input.headSha}\``,
    '',
    '## Orchestrator-assembled inputs (read these first)',
    '',
    `- \`${REVIEW_INPUT_REL_DIR}/diff.patch\` — the full diff vs ${input.baseRef} (WHERE things changed).`,
    `- \`${REVIEW_INPUT_REL_DIR}/diffstat.txt\` and \`${REVIEW_INPUT_REL_DIR}/changed-files.txt\`.`,
    '- The live worktree — Read/Grep/Glob for full-file context (WHY the change is right or wrong).',
    '',
    '## Changed files',
    '',
    changed,
    '',
    '## Acceptance criteria — you judge EVERY one of these, verbatim',
    '',
    acList,
    '',
    '## Work items delivered',
    '',
    wiList,
    '',
    '## Review lenses for this initiative\'s change class',
    '',
    lensList,
    '',
    'These are the ONLY categories a finding may carry. They are the class\'s, not a',
    'fixed set: a docs change is not critiqued for regression risk, and an infra change',
    'is not critiqued the way code is.',
    ...brainBlock,
    '',
    '## What you author (exactly one file, then stop)',
    '',
    `\`.forge/${REVIEW_FINDINGS_FILENAME}\` — a JSON object:`,
    '`{ initiative_id, cycleId, baseRef, headSha, reviewedAt, summary, lenses, findings: [...],`',
    '` acEvaluations: [...], whyWhatHow: { why, what, how } }`.',
    `- \`lenses\`: exactly the list above — ${input.lenses.join(', ')}.`,
    '- Each finding: `{ id: "RF-<n>", severity: blocker | major | minor | info, category:',
    '  one of the lenses above, title, detail, evidence: [{file, line?, excerpt?}] (≥1 —',
    '  pointer-less findings are discarded), acRef? }`.',
    '- `acEvaluations`: ONE entry per acceptance criterion above, `{ criterion, verdict:',
    '  met | partial | missed, evidence }`. The `criterion` string is copied VERBATIM from',
    '  the list above — it is matched exactly, not approximately. Judging a criterion that is',
    '  not on the list, or leaving one off, is rejected.',
    '- `whyWhatHow`: your narrative of the change — why it was made, what it does, how it works.',
    'Severity reflects CONSEQUENCE, not confidence. An all-clean review still writes the file',
    'with `findings: []` and an honest summary — a missing file is a pipeline failure, never a',
    'clean pass. You still judge every criterion on a clean review.',
  ].join('\n');
}
