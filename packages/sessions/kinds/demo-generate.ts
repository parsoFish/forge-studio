/**
 * The demo kind's GENERATE step — two passes, write then ground (bead 6.11.49).
 *
 * Split out of `kinds/demo-builder.ts` at the 800-line cap. Why the seam is
 * here, why the DAG is one-way, and why the agent spec arrives as a parameter:
 * `packages/sessions/design.md` §"The demo kind is three modules".
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runAgentTurn } from '../interactive-session.ts';
import type { KindTurnInput, KindTurnPlumbing } from './kind-turn.ts';
import { resolveSessionModel, type PhaseAgentSpec } from '@forge/agents/phase-agent.ts';
import { loadProjectConfig } from '@forge/projects/project-config.ts';
import { listDemoElements } from '@forge/library/studio/artifact-registry.ts';
import type { DemoStep, DemoElementDefinition } from '@forge/contracts/studio/types.ts';
import { loadSkillTurnPrompt } from '@forge/agents/skill-path.ts';
import {
  DEMO_FRAGMENTS_REL_DIR,
  DEMO_KIND_DIR,
  DEMO_HTML_REL_PATH,
  DEMO_SKILL_REL_PATH,
  FORGE_DEMO_CSS_REL_PATH,
  GENERATIONS_DIRNAME,
  GENERATION_DEMO_FILENAME,
  GENERATION_META_FILENAME,
  GENERATION_SKILL_FILENAME,
  guardedGenerationWritePath,
  type DemoBuilderStatus,
  type RunDemoBuilderTurnResult,
} from './demo-session-store.ts';

/** Bead 6.11.49 — the two passes of one generate turn. They sum to the 24 the
 *  single pass had: the split costs no budget, it just makes "wrote nothing"
 *  surface at pass 1's end instead of at turn 24. */
export const DEMO_WRITE_PASS_MAX_TURNS = 8;
/** The read turn's bound. Measured: run 4 spent 9 tool calls orienting and had
 *  not begun writing; 6 turns is enough to orient and cannot become the whole
 *  budget, because the write turn no longer shares it. */
export const DEMO_READ_PASS_MAX_TURNS = 6;
/** Read tools, named once. `Grep` is a read by another name. */
export const DEMO_READ_TOOLS: readonly string[] = ['Read', 'Glob', 'Grep'];
/** What the write turn may NOT do. Every read door, not just Bash (#558) — and
 *  the last three are doors the product never declared anywhere, measured being
 *  used to read on S1 run 5 (`forge-a9o9`). Naming them closes the three that
 *  were caught; only deny-by-default closes the next three. */
export const DEMO_WRITE_PASS_DENIED: readonly string[] = [
  'Bash', 'Read', 'Glob', 'Grep', 'TodoWrite', 'LSP', 'TaskOutput', 'Skill',
];
export const DEMO_GROUND_PASS_MAX_TURNS = 16;

export async function runGenerateStep(args: {
  agentSpec: PhaseAgentSpec;
  input: KindTurnInput;
  status: DemoBuilderStatus;
  plumbing: KindTurnPlumbing;
  writeStatus: (next: DemoBuilderStatus) => void;
}): Promise<RunDemoBuilderTurnResult> {
  const { agentSpec, input, status, plumbing, writeStatus } = args;
  const { forgeRoot, logger, initiativeId } = plumbing;
  const baseCss = readBaseCss(forgeRoot);
  // CONSUME-ONCE: the driver reads feedback.md, runs this step, and deletes the
  // note only once the step RESOLVES. Before the port this runner read it and
  // never cleared it, so one revise kept steering every later generation.
  return await plumbing.withOperatorFeedback(async (feedback) => {

  // Composition: the demoProcess may reference demo-element kinds from the forge
  // library. When it does, the demo is COMPOSED of project-side element-skills the
  // agent authors (per the library's skill-creating-skill generators) + a composer
  // that runs them in order. `targetElement` narrows the turn to ONE element.
  const steps = loadDemoSteps(status.project_repo_path);
  const byId = new Map(listDemoElements(forgeRoot).map((e) => [e.id, e]));
  const elementSteps = steps.filter(
    (s): s is DemoStep & { element: string } => typeof s.element === 'string' && byId.has(s.element),
  );
  const target = status.targetElement && byId.has(status.targetElement) ? status.targetElement : undefined;
  const composed = elementSteps.length > 0;

  // ADR-024 (R4-23): the turn id selects the SAME branch this runner has always
  // taken — `target` ⇒ per-element, `composed` ⇒ multi-element, else the legacy
  // monolithic generator — but the task instructions for that branch now live in
  // skills/demo-builder/SKILL.md as a `<!-- turn: ... -->` section rather than
  // being hand-composed here; this function keeps only the branch selection + data.
  const turnId = target ? 'generate-element' : composed ? 'generate-composed' : 'generate-legacy';
  const skill = loadSkillTurnPrompt({ name: 'demo-builder', turnId, skillPromptPath: input.skillPromptPath, root: forgeRoot });

  const taskLines = demoTaskLines({ status, target, composed, elementSteps, byId });

  const prompt = [
    skill,
    '',
    `Mode: ${status.mode ?? 'create'}`,
    `Project: ${status.project}`,
    `Project repo (your working directory): ${status.project_repo_path}`,
    '',
    status.mode === 'update' ? 'Operator change-notes:' : 'Operator look-and-feel guidance:',
    status.prompt || '_(none — choose a clean, faithful before/after treatment)_',
    ...(feedback ? ['', 'Operator feedback on the previous sample (apply it):', feedback] : []),
    '',
    ...taskLines,
    '',
    '## Forge demo base stylesheet — the demo skill(s) must inline this verbatim into the HTML they emit',
    '```css',
    baseCss,
    '```',
  ].join('\n');

  // Bead 6.11.49 — WRITE, then RUN. Pass 1 has Bash REMOVED and must produce
  // both deliverables; pass 2 runs only once they exist and grounds the sample.
  // Measured: the turn used to spend all 24 turns running the project and write
  // neither file (run 10: 24 Bash; run 11, briefed NOT to run it: 22 Bash + 2
  // Read, ran it six times) — the SKILL's own task talking, so guidance was
  // never the lever (374); the tool set per pass is. Forbidding Bash outright
  // was the other wrong fix: a demo that cannot run the project cannot show
  // REAL output.
  const runPass = (turnPrompt: string, allowedTools: readonly string[], maxTurns: number, denied: readonly string[] = [], onText?: (t: string) => void) => runAgentTurn({
    queryFn: plumbing.queryFn,
    prompt: turnPrompt,
    cwd: status.project_repo_path,
    model: resolveSessionModel(agentSpec, status.modelTier),
    allowedTools,
    disallowedTools: [...(agentSpec.disallowedTools ?? []), ...denied],
    // W8-B6 — hook dispatch comes from the driver already bound to this turn's
    // logger and initiative id, so no kind can spawn hook-blind.
    ...plumbing.hooksForSkill(agentSpec.skill),
    maxTurns,
    onToolUse: plumbing.onToolUse,
    onHeartbeat: plumbing.onHeartbeat,
    onText: (t: string) => { onText?.(t); plumbing.onText?.(t); },
    onThinking: plumbing.onThinking,
    label: `demo-builder-${input.sessionId}`,
  });
  // 7.3.6 (T1 ruling 642) — READ, then WRITE. S1 run 4's write pass spent all 8
  // turns on 1 TodoWrite + 2 Glob + 6 Read and never began writing; #558 denied
  // Bash, which removed run-instead-of-write and left read-instead-of-write
  // wide open. A deny list that leaves ANY read door open is #558 again, so
  // the write pass loses Read, Glob, Grep and TodoWrite as well, and the
  // reading it needs happens first, bounded, with its findings injected.
  let findings = '';
  await runPass(
    [prompt, '', '## This turn: READ ONLY', 'Gather what you need to author the demo. Write nothing; your notes are carried to the next turn.'].join('\n'),
    DEMO_READ_TOOLS, DEMO_READ_PASS_MAX_TURNS, ['Write', 'Edit', 'MultiEdit', 'Bash'],
    (t) => { findings += t; },
  );
  // `forge-a9o9` — the pass says what it HOLDS, because the prompt it inherits
  // says otherwise. `loadSkillTurnPrompt` returns `${base}\n\n${section}`, and
  // `base` carries the SKILL.md frontmatter: `allowed-tools: [Read, Grep, Glob,
  // Bash, Write, Edit]`, true of the KIND and false of this pass. On S1 run 5
  // the agent believed it over four failing tool calls — TaskOutput, LSP, Glob,
  // Skill — before writing one of its two deliverables and ending the turn.
  const writePass = await runPass(
    [
      prompt, '',
      '## This turn: WRITE ONLY',
      'You hold Write and Edit. You have no Read, Grep, Glob, Bash, LSP, TaskOutput or Skill: the',
      'tool list in the frontmatter above is this KIND across all its turns, not what you hold now.',
      'Do not spend calls hunting for another way to read — the reading is done and its findings are',
      'below. Author BOTH deliverables from them, leaving the captured output as the marked',
      'placeholders the grounding pass replaces. That pass has Bash to run the generator; you do not,',
      'so a sample you cannot run is expected of you and a sample you invent is not.',
      '',
      '## Findings from your read turn', findings.trim() || '_(none recorded)_',
    ].join('\n'),
    agentSpec.allowedTools.filter((t) => !DEMO_WRITE_PASS_DENIED.includes(t)),
    DEMO_WRITE_PASS_MAX_TURNS, DEMO_WRITE_PASS_DENIED,
  );

  // The required generator skill is the per-element skill when iterating one
  // element, else the composer/demo-design skill; the sample DEMO.html is always
  // the reviewable artifact.
  const demoPath = join(status.project_repo_path, DEMO_HTML_REL_PATH);
  const requiredSkillRel = target ? elementSkillRelPath(target) : DEMO_SKILL_REL_PATH;
  const requiredSkillPath = join(status.project_repo_path, requiredSkillRel);
  const missing = [
    !existsSync(requiredSkillPath) ? requiredSkillRel : null,
    !existsSync(demoPath) ? DEMO_HTML_REL_PATH : null,
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `demo-builder runner: the agent turn ended without producing ${missing.join(' + ')} — re-run to retry, or refine the guidance / feedback.`,
    );
  }

  // Pass 2: the deliverables exist, so the remaining budget can only ground them.
  const groundPass = await runPass(
    [
      loadSkillTurnPrompt({ name: 'demo-builder', turnId: 'ground-it', skillPromptPath: input.skillPromptPath, root: forgeRoot }),
      '',
      `Project repo (your working directory): ${status.project_repo_path}`,
      '',
      `The two deliverables already exist: ${requiredSkillRel} and ${DEMO_HTML_REL_PATH}.`,
    ].join('\n'),
    agentSpec.allowedTools,
    DEMO_GROUND_PASS_MAX_TURNS,
  );
  // `null` only when NEITHER pass was priced (the omitted-never-zeroed rule).
  const costUsd = writePass.costUsd === null && groundPass.costUsd === null
    ? null
    : (writePass.costUsd ?? 0) + (groundPass.costUsd ?? 0);

  // R4-16: snapshot this turn's verified DEMO.html + generator skill into
  // <sessionDir>/generations/<iteration>/ (D4/D5) — byte copies (Buffer, not
  // utf8 decode/re-encode) so a later lock-time restore is byte-identical.
  // Snapshots ACCUMULATE: this never touches an earlier generation's dir.
  // SEC-04 leaf: each snapshot leaf under <sessionDir>/generations/<n>/ is
  // written through the guard (leaf included) so a symlinked snapshot slot
  // cannot escape; the demoPath/skillPath READS are repo-side (project-repo
  // root) byte copies (Buffer) preserved for byte-identical lock-time restore.
  const genSegs = [DEMO_KIND_DIR, input.sessionId, GENERATIONS_DIRNAME, String(status.iteration)];
  const demoSnapPath = guardedGenerationWritePath(input.projectRoot, [...genSegs, GENERATION_DEMO_FILENAME], 'generation DEMO.html snapshot');
  writeFileSync(demoSnapPath, readFileSync(demoPath));
  const skillSnapPath = guardedGenerationWritePath(input.projectRoot, [...genSegs, GENERATION_SKILL_FILENAME], 'generation SKILL.md snapshot');
  writeFileSync(skillSnapPath, readFileSync(requiredSkillPath));
  // feedback.md at TURN END (D8) — records what THIS generation consumed.
  // Before the M4 ruling-60 port this re-read the file, on the premise that
  // "the runner never clears it"; the port falsifies that premise (the driver
  // consumes the note once, after this step resolves), so the value the step
  // was GIVEN is now both the correct record and the only one that stays true
  // for the whole turn.
  const generationMeta = {
    iteration: status.iteration,
    createdAt: new Date().toISOString(),
    feedback,
    targetElement: target ?? null,
    composed,
    skillRelPath: requiredSkillRel,
  };
  const metaSnapPath = guardedGenerationWritePath(input.projectRoot, [...genSegs, GENERATION_META_FILENAME], 'generation meta.json');
  writeFileSync(metaSnapPath, `${JSON.stringify(generationMeta, null, 2)}\n`);

  writeStatus({ ...status, phase: 'awaiting-review' });
  logger.emit({
    initiative_id: initiativeId, phase: 'demo', skill: 'demo-builder-runner',
    event_type: 'log', input_refs: [], output_refs: [requiredSkillPath, demoPath],
    ...(costUsd !== null ? { cost_usd: costUsd } : {}),
    message: `demo-generated (iteration ${status.iteration}${target ? `, element=${target}` : composed ? ', composed' : ''}, awaiting review)`,
    metadata: { session_id: input.sessionId, iteration: status.iteration, target_element: target ?? null, composed },
  });

  return { phase: 'awaiting-review', wrote: [requiredSkillPath, demoPath], demoPath };
  });
}

function describeDemoProcess(projectRepoPath: string): string {
  let steps;
  try {
    steps = loadProjectConfig(projectRepoPath)?.demoProcess;
  } catch {
    steps = undefined;
  }
  if (!steps || steps.length === 0) return '_(no demo process configured — design the skill around a representative initiative\'s before/after changes; ground the sample in a real recent change)_';
  return steps.map((s, i) => `${i + 1}. [${s.kind}] ${s.text}`).join('\n');
}

function loadDemoSteps(projectRepoPath: string): DemoStep[] {
  try {
    return loadProjectConfig(projectRepoPath)?.demoProcess ?? [];
  } catch {
    return [];
  }
}

/** The project-side, concrete element-skill the generator authors for an element kind. */
function elementSkillRelPath(id: string): string {
  return `.forge/skills/demo/${id}/SKILL.md`;
}

/** The generator bodies for a set of elements (the skill-creating-skill prompts). */
function elementGeneratorLines(els: DemoElementDefinition[]): string[] {
  const out: string[] = ['', '### Element generators — author each project-side element-skill per these'];
  for (const e of els) {
    out.push('', `#### ${e.id} (${e.name}, phase: ${e.phase})`, e.body);
  }
  return out;
}

/** The task-specific instruction block: per-element iteration, composed, or legacy.
 * Exported (read-only) for the R4-07 descriptor-parity test — the builder and the
 * demo agent must consume the same demoProcess descriptor in the same step order. */
export function demoTaskLines(args: {
  status: DemoBuilderStatus;
  target?: string;
  composed: boolean;
  elementSteps: Array<DemoStep & { element: string }>;
  byId: Map<string, DemoElementDefinition>;
}): string[] {
  const { status, target, composed, elementSteps, byId } = args;
  if (target) {
    const el = byId.get(target)!;
    return [
      `## Iterate ONE element: '${target}' (${el.name})`,
      `Target element skill path: ${elementSkillRelPath(target)}`,
      `Target element fragment path: ${DEMO_FRAGMENTS_REL_DIR}/${target}.html`,
      ...elementGeneratorLines([el]),
    ];
  }
  if (composed) {
    const usedEls = [...new Map(elementSteps.map((s) => [s.element, byId.get(s.element)!])).values()];
    const order = elementSteps
      .map((s, i) => `  ${i + 1}. [${s.kind}] ${s.element}${s.text ? ` — ${s.text}` : ''}`)
      .join('\n');
    return [
      '## This demo is COMPOSED of demo elements, run in this order:',
      order,
      ...elementGeneratorLines(usedEls),
    ];
  }
  // Legacy / no elements configured — the single monolithic generator.
  return [
    'Configured demo process (capture / verify / present steps to bake into the skill):',
    describeDemoProcess(status.project_repo_path),
  ];
}

function readBaseCss(forgeRoot: string): string {
  try {
    return readFileSync(join(forgeRoot, FORGE_DEMO_CSS_REL_PATH), 'utf8');
  } catch {
    return '/* forge demo base stylesheet unavailable — use the dark forge palette: bg #0a0e14, fg #e6edf3 */';
  }
}
