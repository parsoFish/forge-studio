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
import type { AcEvaluation } from '../demo-model.ts';

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
  /** The demo's agent-authored AC-proof — critiqued, never trusted. */
  acEvaluations: AcEvaluation[];
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
  const evals =
    input.acEvaluations.length > 0
      ? input.acEvaluations
          .map((e) => `- [${e.verdict}] ${e.criterion} — ${e.evidence}`)
          .join('\n')
      : '_(no demo acEvaluations available for this cycle)_';

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
    '## Acceptance criteria (contract-fit lens judges against these)',
    '',
    acList,
    '',
    '## Work items delivered',
    '',
    wiList,
    '',
    "## The demo's AC-proof (agent-authored claims — critique what it does NOT cover, never trust it)",
    '',
    evals,
    ...brainBlock,
    '',
    '## What you author (exactly one file, then stop)',
    '',
    `\`.forge/${REVIEW_FINDINGS_FILENAME}\` — a JSON object:`,
    '`{ initiative_id, cycleId, baseRef, headSha, reviewedAt, summary, findings: [...] }`.',
    'Each finding: `{ id: "RF-<n>", severity: blocker | major | minor | info, category:',
    'correctness | regression-risk | contract-fit | convention-drift, title, detail,',
    'evidence: [{file, line?, excerpt?}] (≥1 — pointer-less findings are discarded), acRef? }`.',
    'Severity reflects CONSEQUENCE, not confidence. An all-clean review still writes the file',
    'with `findings: []` and an honest summary — a missing file is a pipeline failure, never a',
    'clean pass.',
  ].join('\n');
}
