/**
 * Demo-agent invocation contract — system + user prompt builders (R4-07).
 *
 * ADR 024/039: skills/demo-agent/SKILL.md is the single source of the demo
 * agent's intent; this is the binding layer emitting only DYNAMIC run context.
 * The system prompt = the demo-agent SKILL.md + the skills/demo contract text
 * (the `composition.skills: [demo]` made real at the binding, the
 * buildPmSystemPrompt pattern). The user prompt = per-cycle briefing: the
 * initiative's ACs, WI list, the ORCHESTRATOR-DERIVED diffStat/headSha (the
 * agent never re-derives or trusts an inherited demo.json — stale-after-fanin),
 * the artifactRoot-resolved demo dir, the typed demoProcess steps, and the
 * demo-element composition block.
 *
 * Deliberately mirrors (never imports) unifier-invocation.ts's demo blocks —
 * that file is legacy-path machinery retired with R4-01-F4 and is NOT covered
 * by the parity test (it dies with the unifier). What
 * demo-descriptor-parity.test.ts pins is the descriptor's three LIVE
 * consumers: the preflight DEMO clause, the demo-builder composition, and
 * this binding.
 *
 * Caching intent (S8/C23): the system prompt carries no per-run data, so the
 * server-side prompt cache hits naturally; all dynamic data lives in the user
 * prompt.
 */

import { readFileSync } from 'node:fs';

import { skillPath } from '@forge/agents/skill-path.ts';
import type { DemoElementDefinition, DemoStep } from '@forge/contracts/studio/types.ts';

const AGENT_SKILL_PATH = skillPath('demo-agent');
const DEMO_CONTRACT_SKILL_PATH = skillPath('demo');

/** The agent-authored judgment file, sibling to demo.json in the demo dir. */
export const FIX_PROPOSALS_FILENAME = 'fix-proposals.json';

/**
 * Worktree-relative path of the PR body the demo agent authors (relocated from
 * the retired unifier, R4-10-F1). `openPrInline` HARD-requires this exact path
 * via `--body-file` — get the relocation wrong and no PR opens. Lives in the
 * gitignored `.forge/` scratch dir (read at PR-open time, not committed).
 */
export const PR_DESCRIPTION_REL = '.forge/pr-description.md';

let cachedSystemPrompt: string | null = null;

/** Demo-agent system prompt: own SKILL.md + the skills/demo contract, verbatim. */
export function buildDemoAgentSystemPrompt(): string {
  if (cachedSystemPrompt !== null) return cachedSystemPrompt;
  cachedSystemPrompt = [
    '# demo-agent skill contract',
    '',
    readFileSync(AGENT_SKILL_PATH, 'utf8'),
    '',
    '---',
    '',
    '# demo contract (skills/demo — the demo.json SSOT this agent composes)',
    '',
    readFileSync(DEMO_CONTRACT_SKILL_PATH, 'utf8'),
  ].join('\n');
  return cachedSystemPrompt;
}

export type DemoAgentUserPromptInput = {
  initiativeId: string;
  /** The initiative's acceptance criteria, verbatim — one acEvaluations entry each. */
  acceptanceCriteria: string[];
  workItems: Array<{ id: string; title: string; status: string }>;
  /** The dev quality-gate command — context for test-evidence checkpoints. */
  qualityGateCmd: string[];
  /** Orchestrator-derived `git diff --stat main...HEAD` — injected, authoritative. */
  diffStat: string;
  /** Orchestrator-derived branch head SHA at derivation time. */
  headSha: string;
  /**
   * Orchestrator-derived `git diff --name-only main...HEAD` — the exact files in
   * the branch's net diff. The PR description's What/How must reference ONLY
   * these (never re-derive; never list a file absent from the diff).
   */
  changedFiles?: string[];
  /** Worktree-relative, artifactRoot-resolved demo dir (demo-paths.ts SSOT). */
  demoDir: string;
  /** The project's typed demoProcess steps (project.json), when declared. */
  demoProcess?: DemoStep[];
  /**
   * Demo-element definitions the pipeline resolved: when the steps reference
   * element ids, exactly those elements in step order; otherwise the full
   * library (rendered as an index, not inlined generators).
   */
  elements?: DemoElementDefinition[];
};

/** Render the composed-elements block (steps carry element ids) — generator bodies inlined. */
function renderComposedElementsBlock(
  steps: Array<DemoStep & { element: string }>,
  byId: Map<string, DemoElementDefinition>,
): string[] {
  const order = steps
    .map((s, i) => `${i + 1}. [${s.kind.toUpperCase()}] ${s.element}${s.text ? ` — ${s.text}` : ''}`)
    .join('\n');
  const out = [
    '## Demo composition (the typed demoProcess — composed of demo elements, in this order)',
    '',
    order,
    '',
    'Each element below is authoring GUIDANCE for demo.json content — capture elements become',
    'checkpoints (declare the `command` whose stdout is the evidence), verify elements become',
    '`acEvaluations`/`testEvidence` entries, present elements shape `essence`/`summary`.',
  ];
  const seen = new Set<string>();
  for (const s of steps) {
    if (seen.has(s.element)) continue;
    seen.add(s.element);
    const e = byId.get(s.element);
    if (!e) {
      // Never degrade silently: the composition names an element the library
      // does not resolve — say so where the agent (and a prompt audit) sees it.
      out.push('', `### ${s.element} — UNRESOLVED element id (not in the demo-element library); fall back to the step's kind (${s.kind}) guidance`);
      continue;
    }
    out.push('', `### ${e.id} (${e.name}, phase: ${e.phase})`, '', e.body.trim());
  }
  return out;
}

/** Render the element-library index fallback (steps carry no element ids). */
function renderLibraryIndexBlock(steps: DemoStep[], library: DemoElementDefinition[]): string[] {
  const out = [
    '## Project demo process (typed steps — no element bindings declared)',
    '',
    ...steps.map((s, i) => `${i + 1}. [${s.kind.toUpperCase()}] ${s.text}`),
    '',
    '## Demo-element library (match each step to the element kind that fits)',
    '',
    'Use these as evidence-kind guidance when authoring demo.json — capture → checkpoint with a',
    '`command`, verify → `acEvaluations`/`testEvidence`, present → `essence`/`summary`:',
    '',
    ...library.map((e) => `- \`${e.id}\` (phase: ${e.phase}) — ${e.description}`),
  ];
  return out;
}

/**
 * Render the per-cycle user prompt. Dynamic data only — all static intent
 * lives in the SKILL.md system prompt (ADR 024).
 */
export function renderDemoAgentUserPrompt(input: DemoAgentUserPromptInput): string {
  const acList = input.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n');
  const wiList =
    input.workItems.length > 0
      ? input.workItems.map((w) => `- ${w.id} [${w.status}] ${w.title}`).join('\n')
      : '- _(no work items recorded; judge against the acceptance criteria alone)_';

  const steps = input.demoProcess ?? [];
  const elementSteps = steps.filter((s): s is DemoStep & { element: string } => Boolean(s.element));
  const byId = new Map((input.elements ?? []).map((e) => [e.id, e]));
  let processBlock: string[] = [];
  if (elementSteps.length > 0) {
    processBlock = renderComposedElementsBlock(elementSteps, byId);
  } else if (steps.length > 0) {
    processBlock = renderLibraryIndexBlock(steps, input.elements ?? []);
  }

  return [
    '# Demo-agent invocation',
    '',
    'Follow the demo-agent skill contract in your system prompt. Compose this initiative\'s demo',
    'from the develop output and judge every acceptance criterion.',
    '',
    `## Initiative: ${input.initiativeId}`,
    '',
    '## Acceptance criteria (author one `acEvaluations` entry per criterion, verbatim)',
    '',
    acList,
    '',
    '## Work items delivered by the develop phase',
    '',
    wiList,
    '',
    '## Injected branch state (orchestrator-derived — authoritative, never re-derive)',
    '',
    `- diffStat: \`${input.diffStat}\``,
    `- head SHA: \`${input.headSha}\``,
    `- Quality-gate command the dev loop ran: \`${input.qualityGateCmd.join(' ')}\``,
    ...(input.changedFiles && input.changedFiles.length > 0
      ? ['- Changed files (the branch\'s net diff — reference ONLY these in the PR body):',
         ...input.changedFiles.map((f) => `  - \`${f}\``)]
      : []),
    '',
    '## What to author (under the demo dir + the one PR-body file — write nothing else)',
    '',
    `1. \`${input.demoDir}/demo.json\` — the skills/demo contract. Use the injected diffStat verbatim.`,
    '   Every `acEvaluations` verdict is `met | partial | missed` — `met` only with real evidence.',
    '   `testEvidence` MUST be a JSON ARRAY of `{ name, result: "pass"|"fail"|"skip", delta? }`,',
    '   never an object map. For every behavioural checkpoint declare the exact `command` whose',
    '   stdout IS the evidence and LEAVE `beforeOutput`/`afterOutput` absent — the ORCHESTRATOR',
    '   runs render and capture after you finish (ADR 036); never run `forge demo render` or',
    '   `forge demo capture` yourself, and never hand-write capture output.',
    `2. \`${PR_DESCRIPTION_REL}\` — the pull-request body (Markdown). Treat the whole initiative`,
    '   branch as ONE self-contained PR. Author exactly three sections, in order:',
    '   `## Why` (the initiative\'s intent — what problem this solves), `## What` (the behavioural',
    '   change delivered), `## How` (how the diff achieves it). Anchor What/How ONLY on the changed',
    '   files listed above — never claim a file the diff does not contain. Do NOT add a `## Demo`',
    '   section: the orchestrator appends it from your demo.json after you finish.',
    `3. \`${input.demoDir}/${FIX_PROPOSALS_FILENAME}\` — ONLY when any verdict is \`partial\` or \`missed\`:`,
    '   one proposal per failing criterion: `{ id: "FIX-<n>", criterion (verbatim), verdict,',
    '   evidence (why the demo cannot show it), title, acceptance_criteria: [{given, when, then}],',
    '   files_in_scope: [worktree-relative paths], rationale }`. A miss is a judgment, not a',
    '   failure — never soften a verdict to avoid writing proposals. All-met → do NOT create it.',
    ...(processBlock.length > 0 ? ['', ...processBlock] : []),
    '',
    `When demo.json + \`${PR_DESCRIPTION_REL}\` are complete (plus ${FIX_PROPOSALS_FILENAME} when any AC missed), stop.`,
  ].join('\n');
}
