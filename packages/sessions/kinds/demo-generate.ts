/**
 * The demo kind's GENERATE step — two passes, write then ground (bead 6.11.49).
 *
 * Split out of `kinds/demo-builder.ts` at the 800-line cap. Why the seam is
 * here, why the DAG is one-way, and why the agent spec arrives as a parameter:
 * `packages/sessions/design.md` §"The demo kind is three modules".
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { guardedReadFile, resolveGuardedPath } from '@forge/kernel';
import { runAgentTurn } from '../interactive-session.ts';
import type { KindTurnInput, KindTurnPlumbing } from './kind-turn.ts';
// Deep paths, not the door (bead forge-8vfn.5.31, same cycle as
// packages/sessions/kinds/architect-session.ts's own module doc).
import { resolveSessionModel, type PhaseAgentSpec } from '@forge/agents/phase-agent.ts';
import { takeScopeSnapshot, scopeViolations, type ScopeSnapshot } from '@forge/agents/phases/agent-scope-guard.ts';
import { isGitRepo, loadProjectConfig } from '@forge/projects';
import { listDemoElements } from '@forge/library';
import type { DemoStep, DemoElementDefinition } from '@forge/contracts';
import { loadSkillTurnPrompt } from '@forge/agents/skill-path.ts';
import {
  DEMO_DECLARATION_REL_PATH,
  DEMO_KIND_DIR,
  DEMO_HTML_REL_PATH,
  FORGE_DEMO_CSS_REL_PATH,
  GENERATIONS_DIRNAME,
  GENERATION_DECLARATION_FILENAME,
  GENERATION_DEMO_FILENAME,
  GENERATION_META_FILENAME,
  guardedGenerationWritePath,
  listExistingGenerationNumbers,
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
  'Bash', 'Glob', 'Grep', 'TodoWrite', 'LSP', 'TaskOutput', 'Skill',
];
/** `forge-a9o9`/7.3.6 (T1 ruling 703) — the directory this pass exists to
 *  fill (bead forge-mfv5.2.8 took `.forge/skills/demo-design` off it: the
 *  pass writes the declaration draft beside the sample, and no SKILL.md).
 *  `Read` is PERMITTED inside it and refused everywhere else, which is why it
 *  left the deny list above. §15.397: a deny that makes a required
 *  protocol step impossible is a trap, not a fence — S1 run 6 measured the
 *  trap, and the measurement is in `session-write-fence.ts`'s read-root note. */
export const DEMO_PASS_ROOTS: readonly string[] = ['.forge/demo'];
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

  // Bead forge-mfv5.2.8 — the turn's output IS the declaration: the
  // `demoProcess` steps a lock writes into `.forge/project.json`. The agent
  // revises the current declaration (the newest generation's draft, else the
  // project's declared steps); `targetElement` narrows the revision to the
  // steps bound to one demo-element kind from the forge library.
  const byId = new Map(listDemoElements(forgeRoot).map((e) => [e.id, e]));
  const target = status.targetElement && byId.has(status.targetElement) ? status.targetElement : undefined;
  const skill = loadSkillTurnPrompt({ name: 'demo-builder', turnId: 'generate-declaration', skillPromptPath: input.skillPromptPath, root: forgeRoot });
  const taskLines = demoTaskLines({ steps: currentDeclaration(input.projectRoot, input.sessionId, status), target, byId });

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
    '## Forge demo base stylesheet — inline this verbatim into the sample DEMO.html',
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
  const runPass = (turnPrompt: string, allowedTools: readonly string[], maxTurns: number, denied: readonly string[] = [], onText?: (t: string) => void, roots: readonly string[] = []) => runAgentTurn({
    ...(roots.length > 0 ? { writeRoots: roots, readRoots: roots } : {}),
    queryFn: plumbing.queryFn,
    maxBudgetUsd: plumbing.turnBudgetUsd(), // row 193b — per pass, against what is left
    prompt: turnPrompt,
    cwd: status.project_repo_path,
    model: resolveSessionModel(agentSpec, status.modelTier),
    allowedTools,
    disallowedTools: [...(agentSpec.disallowedTools ?? []), ...denied],
    // W8-B6 — hook dispatch comes from the driver already bound to this turn's
    // logger and initiative id, so no kind can spawn hook-blind.
    ...plumbing.hooksForSkill(agentSpec.skill, status.project_repo_path),
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
  const ground = snapshotGround(status.project_repo_path);
  const fenceGround = (pass: string): void => assertGroundUnchanged({ ground, repo: status.project_repo_path, pass, logger, initiativeId, sessionId: input.sessionId });
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
  // The directory this pass fills, created before the turn so the fence can
  // realpath it — a root that will not resolve now DENIES rather than
  // ungates (see `makeWriteRootCanUseTool`'s fail-closed note).
  // GUARDED, because `project_repo_path` is request-derived at the bridge and
  // `check-request-path-sinks` caught the bare `join` on its first gate — the
  // same catch `writeProjectGroundFile` took earlier today, in the same class of
  // change. The segments are constants; the ROOT is the untrusted part.
  const passRoots = DEMO_PASS_ROOTS.map((rel) => {
    const guarded = resolveGuardedPath(status.project_repo_path, rel.split('/'));
    if (!guarded.ok) throw new Error(`demo write pass: ${rel} does not resolve beneath ${status.project_repo_path}`);
    mkdirSync(guarded.realPath, { recursive: true });
    return guarded.realPath;
  });
  const writePass = await runPass(
    [
      prompt, '',
      '## This turn: WRITE ONLY',
      'You hold Write and Edit. You have no Read, Grep, Glob, Bash, LSP, TaskOutput or Skill: the',
      'tool list in the frontmatter above is this KIND across all its turns, not what you hold now.',
      'Do not spend calls hunting for another way to read — the reading is done and its findings are',
      'below. Author BOTH deliverables from them, leaving the captured output as the marked',
      'placeholders the grounding pass replaces. That pass has Bash to run the declared commands; you',
      'do not, so a sample you cannot run is expected of you and a sample you invent is not.',
      '',
      `WRITE \`${DEMO_DECLARATION_REL_PATH}\` FIRST, in one call, then \`${DEMO_HTML_REL_PATH}\`. Neither`,
      'exists yet, and a path that does not exist needs no prior Read. You may Read inside',
      '`.forge/demo/` if you need to re-write a file you already created — nowhere else.',
      '',
      '## Findings from your read turn', findings.trim() || '_(none recorded)_',
    ].join('\n'),
    agentSpec.allowedTools.filter((t) => !DEMO_WRITE_PASS_DENIED.includes(t)),
    DEMO_WRITE_PASS_MAX_TURNS, DEMO_WRITE_PASS_DENIED, undefined, passRoots,
  );
  fenceGround('read+write');

  // The declaration draft and the sample it renders are the two deliverables.
  const demoPath = join(status.project_repo_path, DEMO_HTML_REL_PATH);
  const declarationPath = join(status.project_repo_path, DEMO_DECLARATION_REL_PATH);
  const missing = [
    !existsSync(declarationPath) ? DEMO_DECLARATION_REL_PATH : null,
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
      `The two deliverables already exist: ${DEMO_DECLARATION_REL_PATH} and ${DEMO_HTML_REL_PATH}.`,
    ].join('\n'),
    agentSpec.allowedTools,
    DEMO_GROUND_PASS_MAX_TURNS,
  );
  fenceGround('ground');
  // `null` only when NEITHER pass was priced (the omitted-never-zeroed rule).
  const costUsd = writePass.costUsd === null && groundPass.costUsd === null
    ? null
    : (writePass.costUsd ?? 0) + (groundPass.costUsd ?? 0);

  // R4-16: snapshot this turn's verified DEMO.html + declaration draft into
  // <sessionDir>/generations/<iteration>/ (D4/D5) — byte copies (Buffer, not
  // utf8 decode/re-encode) so a later lock-time restore is byte-identical.
  // Snapshots ACCUMULATE: this never touches an earlier generation's dir.
  // SEC-04 leaf: each snapshot leaf under <sessionDir>/generations/<n>/ is
  // written through the guard (leaf included) so a symlinked snapshot slot
  // cannot escape; the demoPath/declarationPath READS are repo-side
  // (project-repo root) byte copies.
  const genSegs = [DEMO_KIND_DIR, input.sessionId, GENERATIONS_DIRNAME, String(status.iteration)];
  const demoSnapPath = guardedGenerationWritePath(input.projectRoot, [...genSegs, GENERATION_DEMO_FILENAME], 'generation DEMO.html snapshot');
  writeFileSync(demoSnapPath, readFileSync(demoPath));
  const declarationSnapPath = guardedGenerationWritePath(input.projectRoot, [...genSegs, GENERATION_DECLARATION_FILENAME], 'generation declaration snapshot');
  writeFileSync(declarationSnapPath, readFileSync(declarationPath));
  // The draft LEAVES the repo once snapshotted (forge-mfv5.2.8): left there it
  // would be committed beside `demoProcess` as a second declared source. The
  // lock writes the chosen generation's declaration into project.json.
  const draft = resolveGuardedPath(status.project_repo_path, DEMO_DECLARATION_REL_PATH.split('/'));
  if (!draft.ok) throw new Error(`demo-builder runner: ${DEMO_DECLARATION_REL_PATH} does not resolve beneath ${status.project_repo_path}`);
  rmSync(draft.realPath, { force: true });
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
  };
  const metaSnapPath = guardedGenerationWritePath(input.projectRoot, [...genSegs, GENERATION_META_FILENAME], 'generation meta.json');
  writeFileSync(metaSnapPath, `${JSON.stringify(generationMeta, null, 2)}\n`);

  writeStatus({ ...status, phase: 'awaiting-review' });
  logger.emit({
    initiative_id: initiativeId, phase: 'demo', skill: 'demo-builder-runner',
    event_type: 'log', input_refs: [], output_refs: [declarationSnapPath, demoPath],
    ...(costUsd !== null ? { cost_usd: costUsd } : {}),
    message: `demo-generated (iteration ${status.iteration}${target ? `, element=${target}` : ''}, awaiting review)`,
    metadata: { session_id: input.sessionId, iteration: status.iteration, target_element: target ?? null },
  });

  return { phase: 'awaiting-review', wrote: [declarationSnapPath, demoPath], demoPath };
  });
}

/** Ruling 1973fa — forge's own prefixes in a ground: its config + this pass's
 *  root (`.forge/`), the session kinds' dirs (`_demo/`, `_onboarding/`),
 *  forge's logs (`_logs/`) and its history (`forge/history/`). Not
 *  `project-repo-tx.ts`'s `SCRATCH_EXCLUDES`: that set names what forge
 *  never COMMITS and lacks `.forge/`, `_onboarding/`, `_logs/`, `forge/history/`. */
const FORGE_OWNED_GROUND_PREFIXES: readonly string[] = [`.forge/`, `${DEMO_KIND_DIR}/`, '_onboarding/', '_logs/', 'forge/history/'];

/**
 * Row 190 (forge-8vfn.8.5.28, T1 ruling 1973en) — the GROUND fence. Measured on
 * a costed S1 run: the grounding pass, the one holding Bash, ran `python3 …
 * json.dump` into `schemas/overlay.schema.json` (16:12:20), `cp`'d a backup over
 * it (16:12:31) and `del`'d a key again (16:12:55) — project source, left
 * edited; the demo locked on it and only the story's own-ground sweep saw it
 * (`UNDECLARED M`). A Bash write is invisible to the write-root fence, and Bash
 * cannot leave the pass (no Bash, no REAL output), so the ground is diffed.
 * Snapshot = `takeScopeSnapshot` + a content hash of every porcelain path (an
 * already-dirty file edited further still shows: the pre-turn tree is the
 * baseline). A breach is an `error` event naming the paths, then a throw
 * `agent-run` turns into `failed`, the missing-deliverable road. NOT reverted —
 * naming and failing is the ruling. `null` off a git root: no baseline, and a
 * nested project's porcelain is its ANCESTOR's tree. A failing snapshot throws.
 *
 * Row 190b (forge-8vfn.8.5.31, T1 ruling 1973fa) — the fence judges PROJECT
 * SOURCE only. r9 false-redded on `.forge/contract-compliance-report.json`,
 * `HEAD (commit)` and `_onboarding/<sid>/status.json`: the onboarding session
 * finishing (17:50:42, MTIMES.txt) inside the demo's ground pass — other forge
 * actors, not this pass. So `FORGE_OWNED_GROUND_PREFIXES` are skipped (a
 * superset of `.forge/demo/` + `_demo/`, which it replaces), and HEAD left this
 * fence: row 188's host fence owns HEAD, and a ground's own commits are the
 * product's. Cull note (T1): an end-of-pass diff cannot see a transient edit
 * the builder restored before the check (r8/r9's BEFORE-pass schema removal) —
 * accepted, not fixed here.
 */
type GroundSnapshot = Extract<ScopeSnapshot, { ok: true }>;
function snapshotGround(repo: string): GroundSnapshot | null {
  if (!isGitRepo(repo)) return null;
  const snap = takeScopeSnapshot(repo);
  if (!snap.ok) throw new Error(`demo-builder runner: cannot snapshot the ground ${repo} — ${snap.error}`);
  const entries = new Map(snap.entries);
  for (const [p, stamp] of snap.entries) if (stamp.startsWith('git:')) entries.set(p, `${stamp}:${contentStamp(repo, p)}`);
  return { ok: true, entries };
}

/** Through the guard, base64 = lossless; `null` (deleted, submodule, refused symlink) is a stamp. */
function contentStamp(repo: string, rel: string): string {
  const bytes = guardedReadFile(repo, rel.split('/'), 'base64');
  return bytes === null ? 'unreadable' : createHash('sha256').update(bytes).digest('hex');
}

function assertGroundUnchanged(a: { ground: GroundSnapshot | null; repo: string; pass: string; logger: KindTurnPlumbing['logger']; initiativeId: string; sessionId: string }): void {
  if (a.ground === null) return;
  const after = snapshotGround(a.repo);
  if (after === null) throw new Error(`demo-builder runner: the ground ${a.repo} stopped being a git repo during the ${a.pass} pass`);
  const paths = scopeViolations(a.ground, after, (p) => FORGE_OWNED_GROUND_PREFIXES.some((r) => p.startsWith(r)));
  if (paths.length === 0) return;
  const message = `demo-builder runner: the ${a.pass} pass changed the project's source (outside ${FORGE_OWNED_GROUND_PREFIXES.join(', ')}): ${paths.join(', ')} — the demo builder may write .forge/demo/ only; the edits are left in place for the operator to inspect.`;
  a.logger.emit({
    initiative_id: a.initiativeId, phase: 'demo', skill: 'demo-builder-runner', event_type: 'error', input_refs: [], output_refs: paths,
    message, metadata: { session_id: a.sessionId, pass: a.pass, paths, rule: 'demo-ground-fence' },
  });
  throw new Error(message);
}

/**
 * The declaration this turn revises: the newest earlier generation's draft
 * (a revision builds on what the operator just reviewed), else the steps the
 * project already declares. A draft that no longer parses is shown as nothing
 * rather than guessed at — the project's own steps stand in for it.
 */
function currentDeclaration(projectRoot: string, sessionId: string, status: DemoBuilderStatus): DemoStep[] {
  const earlier = listExistingGenerationNumbers(projectRoot, sessionId).filter((n) => n < status.iteration);
  const latest = earlier.length > 0 ? earlier[earlier.length - 1] : undefined;
  if (latest !== undefined) {
    const raw = guardedReadFile(projectRoot, [DEMO_KIND_DIR, sessionId, GENERATIONS_DIRNAME, String(latest), GENERATION_DECLARATION_FILENAME]);
    try {
      const parsed: unknown = raw === null ? null : JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as DemoStep[];
    } catch { /* an unparsable draft falls through to the declared steps */ }
  }
  try {
    return loadProjectConfig(status.project_repo_path)?.demoProcess ?? [];
  } catch {
    return [];
  }
}

/** One library element as the declaration's author needs it: what it is and
 *  what per-step config it takes. */
function elementLine(e: DemoElementDefinition): string {
  return `- \`${e.id}\` (${e.name}, phase: ${e.phase}) — ${e.description} Config: ${e.configHint}`;
}

/** The task-specific data block: the declaration to revise, the element
 * library its steps may bind to, and — when narrowed — the one element whose
 * steps this turn revises. Exported (read-only) for the R4-07 descriptor-parity
 * test — the builder and the integrate band must read the same demoProcess
 * descriptor in the same step order. */
export function demoTaskLines(args: {
  steps: readonly DemoStep[];
  target?: string;
  byId: Map<string, DemoElementDefinition>;
}): string[] {
  const { steps, target, byId } = args;
  const current = steps.length > 0
    ? ['```json', JSON.stringify(steps, null, 2), '```']
    : ['_(none declared yet — author the declaration from a representative recent change)_'];
  return [
    '## The current demo declaration (the steps you revise)',
    ...current,
    '',
    '## Demo elements a step may bind to (`element`)',
    ...(byId.size > 0 ? [...byId.values()].map(elementLine) : ['_(the library holds no elements — leave `element` off)_']),
    ...(target ? ['', `## Revise ONLY the steps bound to element '${target}' — carry every other step over unchanged`] : []),
  ];
}

function readBaseCss(forgeRoot: string): string {
  try {
    return readFileSync(join(forgeRoot, FORGE_DEMO_CSS_REL_PATH), 'utf8');
  } catch {
    return '/* forge demo base stylesheet unavailable — use the dark forge palette: bg #0a0e14, fg #e6edf3 */';
  }
}
