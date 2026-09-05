/**
 * The architect's TURN STEPS — interview, explore, draft, council and the
 * structured-turn plumbing they share.
 *
 * Split out of `kinds/architect.ts` (M4 exit row 5, ruling 96). The parent
 * dispatches; this file runs the steps. It imports `architect-session.ts` for
 * the session's vocabulary and `architect-manifest.ts` for manifest building,
 * and nothing imports it except the parent.
 *
 * THE CYCLE THIS SPLIT EXISTS TO DISSOLVE lived here: `runDraftStep` calls
 * `buildManifest`/`slugify`, and `runFinalizeStep` calls `runDraftStep`. A
 * two-way split along the draft/finalize line would have cut straight through
 * it. Pulling manifest construction out as a leaf BOTH halves stand on removes
 * the cycle instead of relocating it.
 *
 * `architectBrainIndex` travels with these steps rather than staying in the
 * parent: it is declared once and used 3x here, and leaving it behind would
 * have re-created the same back-edge in a smaller form.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runStructuredTurn, type QueryFn } from '../interactive-session.ts';
import { sdkHooksForAgent } from '@forge/agents/studio/hook-dispatch.ts';
import {
  writePlanDoc, sessionPaths,
  type ArchitectSession, type ProposedInitiative, type CouncilTranscript, type InterviewRound,
} from './architect-plan.ts';
import { loadBrainIndex } from '@forge/knowledge/brain-index.ts';
import { guardedFile, guardedReadFile, guardedWriteFile, type EventLogger } from '@forge/kernel';
import { requirePorts } from './architect-ports.ts';
import type { ToolUseLiveDetail } from '@forge/agents/ralph/claude-agent.ts';
import { resolveSessionModel, type ModelTier } from '@forge/agents/phase-agent.ts';
import { skillPath, loadSkillTurnPrompt, splitSkillTurnSections } from '@forge/agents/skill-path.ts';
import type { KindTurnPlumbing } from './kind-turn.ts';
import { type ArchitectQuestion, type ArchitectStatus, type DraftInitiative, type RunArchitectTurnInput, type RunArchitectTurnResult, architectAgentSpec, readInterview } from './architect-session.ts';
import { buildManifest, slugify } from './architect-manifest.ts';


/** ARCH-1: the brain navigation index, loaded per turn by the steps that
 *  inject it into prompts (PM/reflector pattern). Cheap — a few small markdown
 *  files — and deliberately not cached across turns, since each turn is a
 *  fresh process invocation. */
function architectBrainIndex(input: RunArchitectTurnInput, status: ArchitectStatus): ReturnType<typeof loadBrainIndex> {
  return loadBrainIndex({ cwd: input.brainCwd ?? resolve('.'), scope: status.project });
}
export type ArchitectStepArgs = {
  input: RunArchitectTurnInput;
  status: ArchitectStatus;
  plumbing: KindTurnPlumbing;
  writeStatus: (next: ArchitectStatus) => void;
  /** The session's derived paths — built ONCE per turn by `withPaths` below,
   *  not per step. Recomputing it in each step is harmless at runtime (one
   *  step runs per turn) but multiplies the request-derived path-construction
   *  sites `check-request-path-sinks` counts, which is surface, not cost. */
  paths: ReturnType<typeof sessionPaths>;
};

/** Adds this turn's `paths` to a step's args — the single `sessionPaths` call
 *  site for the whole kind. */
export function withPaths<T>(
  step: (args: ArchitectStepArgs) => Promise<T>,
): (args: Omit<ArchitectStepArgs, 'paths'>) => Promise<T> {
  return (args) => step({ ...args, paths: sessionPaths(args.input.projectRoot, args.input.sessionId) });
}

/**
 * The exploration stage, then the draft — one turn, R4-04-F4.
 *
 * ALWAYS a fresh run: a revise round changes the inputs, and re-exploring is
 * one cheap structured turn. The previous round's findings are unlinked FIRST,
 * so a failed re-exploration can never silently feed stale edge cases into the
 * new draft — the fail-open message has to stay honest, and no findings file
 * means no explore block, ever. Fail-open covers BOTH an empty output and a
 * thrown stream/SDK error: the stage is advisory enrichment and must never
 * brick the session.
 */
export async function runExploreThenDraft(args: ArchitectStepArgs): Promise<RunArchitectTurnResult> {
  const { input, status, plumbing, writeStatus, paths } = args;
  const { logger, initiativeId } = plumbing;

  // SEC-04 leaf: resolve the stale `edge-cases.json` through the guard before
  // removing it — never rm THROUGH a symlinked/escaping leaf (null ⇒ absent or
  // out-of-root, both a safe no-op).
  const staleEdge = guardedFile(input.projectRoot, ['_architect', input.sessionId, 'edge-cases.json'], 'read');
  if (staleEdge) {
    try {
      rmSync(staleEdge, { force: true });
    } catch {
      /* best-effort — a stale file that survives is overwritten on success */
    }
  }

  let findings: ExploreFindings | null = null;
  let exploreCrash: string | null = null;
  try {
    findings = await runExploreStep(args);
  } catch (err) {
    exploreCrash = err instanceof Error ? err.message : String(err);
  }
  logger.emit({
    initiative_id: initiativeId,
    phase: 'architect',
    skill: 'architect-runner',
    event_type: 'log',
    input_refs: [],
    // A non-fs event-log string only — no bytes flow through it. Every ACTUAL
    // read/write/rm of `edge-cases.json` routes its leaf through `guardedFile`.
    output_refs: findings ? [join(paths.sessionDir, 'edge-cases.json')] : [],
    message: findings
      ? `exploration stage — ${findings.edgeCases.length} edge case(s), ${findings.brainConstraints.length} brain constraint(s)`
      : exploreCrash
        ? `exploration stage crashed — proceeding to draft without an explore block (fail-open): ${exploreCrash}`
        : 'exploration stage returned nothing — proceeding to draft without an explore block (fail-open)',
    metadata: {
      session_id: input.sessionId,
      edge_cases: findings?.edgeCases.length ?? 0,
      brain_constraints: findings?.brainConstraints.length ?? 0,
      ...(exploreCrash ? { crashed: true } : {}),
    },
  });

  writeStatus({ ...status, phase: 'drafting' });
  return await runDraftStep({ ...args, resolvedDecisions: null });
}

// ---------------------------------------------------------------------------
// Interview step
// ---------------------------------------------------------------------------

type InterviewDecision = { done: boolean; questions: ArchitectQuestion[] };

const INTERVIEW_SCHEMA = {
  type: 'object',
  properties: {
    done: { type: 'boolean' },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          header: { type: 'string' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              properties: { label: { type: 'string' }, description: { type: 'string' } },
              required: ['label', 'description'],
            },
          },
        },
        required: ['question', 'header'],
      },
    },
  },
  required: ['done'],
};

export async function runInterviewStep(
  args: ArchitectStepArgs & { interview: InterviewRound[] },
): Promise<InterviewDecision> {
  const { input, status, interview, plumbing } = args;
  const { queryFn, logger, initiativeId, onToolUse, onHeartbeat, onText, onThinking } = plumbing;
  const skillPromptPath = input.skillPromptPath;
  const brainIndex = architectBrainIndex(input, status);
  const skill = loadSkillTurnPrompt({ name: 'architect', turnId: 'interview', skillPromptPath });
  const priorQa = interview.length
    ? interview.map((r, i) => `${i + 1}. Q: ${r.question}\n   A: ${r.answer}`).join('\n')
    : '_(no answers yet — this is the first round)_';
  const prompt = [
    ...(brainIndex
      ? [
          '# Brain navigation index',
          '',
          'Read relevant brain theme files listed below before answering. Your first tool calls must be Read against brain/ paths.',
          '',
          brainIndex,
          '',
          '---',
          '',
        ]
      : []),
    skill,
    '',
    `Project: ${status.project}`,
    '',
    'Operator idea / brief:',
    status.idea,
    '',
    'Interview so far:',
    priorQa,
  ].join('\n');

  const { output: out } = await runStructured<{ done?: boolean; questions?: ArchitectQuestion[] }>({
    logger, initiativeId, cwd: status.project_repo_path,
    queryFn,
    prompt,
    schema: INTERVIEW_SCHEMA,
    modelTier: status.modelTier,
    onToolUse,
    onHeartbeat,
    onText,
    onThinking,
  });
  const questions = Array.isArray(out?.questions) ? out!.questions! : [];
  return { done: out?.done === true, questions };
}

// ---------------------------------------------------------------------------
// Exploration step (R4-04-F4 — operator-journey gap #6)
// ---------------------------------------------------------------------------

/**
 * One edge case the architect enumerated before drafting, with an explicit
 * disposition so nothing enumerated can silently vanish (the scope-ledger
 * discipline from brain theme 2026-07-01-architect-coverage-scope-fidelity).
 */
export type ExploreEdgeCase = {
  title: string;
  detail: string;
  /** covered = an initiative's ACs will own it; needs-initiative = it demands its own; deferred = explicitly out of this plan. */
  disposition: 'covered' | 'needs-initiative' | 'deferred';
};

export type ExploreFindings = {
  edgeCases: ExploreEdgeCase[];
  /** Brain-sourced constraints that must shape ACs, each citing its theme. */
  brainConstraints: { constraint: string; source: string }[];
  exploreSummary: string;
};

const EXPLORE_SCHEMA = {
  type: 'object',
  properties: {
    edgeCases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          disposition: { type: 'string', enum: ['covered', 'needs-initiative', 'deferred'] },
        },
        required: ['title', 'detail', 'disposition'],
      },
    },
    brainConstraints: {
      type: 'array',
      items: {
        type: 'object',
        properties: { constraint: { type: 'string' }, source: { type: 'string' } },
        required: ['constraint', 'source'],
      },
    },
    exploreSummary: { type: 'string' },
  },
  required: ['edgeCases', 'brainConstraints', 'exploreSummary'],
};

/** SEC-04: the `edge-cases.json` leaf rides through the guard (read mode); a
 *  symlinked leaf collapses to `null`, indistinguishable from absent. */
export function readExploreFindings(projectsRoot: string, sessionId: string): ExploreFindings | null {
  const raw = guardedReadFile(projectsRoot, ['_architect', sessionId, 'edge-cases.json']);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as ExploreFindings;
  } catch {
    return null;
  }
}

/**
 * The explicit "exploring / edge cases" stage between the interview and the
 * draft (R4-04-F4). One structured turn prompting enumeration: edge cases
 * with dispositions, plus brain-sourced constraints to propagate into ACs.
 * FAIL-OPEN: this stage enriches the draft — an empty/failed exploration is
 * recorded honestly and the session proceeds (never bricks on an advisory
 * enrichment step); the draft prompt then simply carries no explore block.
 */
async function runExploreStep(args: ArchitectStepArgs): Promise<ExploreFindings | null> {
  const { input, status, plumbing } = args;
  const { queryFn, logger, initiativeId, onToolUse, onHeartbeat, onText, onThinking } = plumbing;
  const projectRoot = input.projectRoot;
  const sessionId = input.sessionId;
  const skillPromptPath = input.skillPromptPath;
  const brainIndex = architectBrainIndex(input, status);
  const skill = loadSkillTurnPrompt({ name: 'architect', turnId: 'explore', skillPromptPath });
  const interview = readInterview(projectRoot, sessionId);
  const priorQa = interview.length
    ? interview.map((r, i) => `${i + 1}. Q: ${r.question}\n   A: ${r.answer}`).join('\n')
    : '_(operator drafted directly)_';
  const prompt = [
    ...(brainIndex
      ? [
          '# Brain navigation index',
          '',
          'Read the relevant brain theme files below FIRST — a brain-sourced constraint you surface here must cite its theme path as `source`.',
          '',
          brainIndex,
          '',
          '---',
          '',
        ]
      : []),
    skill,
    '',
    `Project: ${status.project}`,
    '',
    'Operator idea / brief:',
    status.idea,
    '',
    'Interview answers:',
    priorQa,
  ].join('\n');

  const { output } = await runStructured<ExploreFindings>({
    logger, initiativeId, cwd: status.project_repo_path,
    queryFn,
    prompt,
    schema: EXPLORE_SCHEMA,
    modelTier: status.modelTier,
    onToolUse,
    onHeartbeat,
    onText,
    onThinking,
  });
  if (!output || !Array.isArray(output.edgeCases) || !Array.isArray(output.brainConstraints)) {
    return null;
  }
  // Item-shape validation (review finding): the downstream renderers consume
  // these fields verbatim after the EXPENSIVE draft call — drop malformed
  // items here rather than TypeError-ing the whole turn later.
  const DISPOSITIONS = new Set(['covered', 'needs-initiative', 'deferred']);
  const edgeCases = output.edgeCases.filter(
    (ec): ec is ExploreEdgeCase =>
      ec !== null &&
      typeof ec === 'object' &&
      typeof ec.title === 'string' &&
      typeof ec.detail === 'string' &&
      typeof ec.disposition === 'string' &&
      DISPOSITIONS.has(ec.disposition),
  );
  const brainConstraints = output.brainConstraints.filter(
    (bc): bc is { constraint: string; source: string } =>
      bc !== null && typeof bc === 'object' && typeof bc.constraint === 'string' && typeof bc.source === 'string',
  );
  if (edgeCases.length === 0 && brainConstraints.length === 0) return null;
  const findings: ExploreFindings = {
    edgeCases,
    brainConstraints,
    exploreSummary: typeof output.exploreSummary === 'string' ? output.exploreSummary : '',
  };
  // SEC-04 leaf: persist through the guard (write mode). A symlinked/escaping
  // `edge-cases.json` leaf is refused (null) — this stage is advisory
  // enrichment, so a refused write is fail-open (findings still returned for
  // THIS turn; the draft step simply finds no persisted explore block).
  guardedWriteFile(projectRoot, ['_architect', sessionId, 'edge-cases.json'], JSON.stringify(findings, null, 2));
  return findings;
}

// ---------------------------------------------------------------------------
// Draft step (+ council + PLAN)
// ---------------------------------------------------------------------------


const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    vision: { type: 'string' },
    initiatives: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          slug: { type: 'string' },
          title: { type: 'string' },
          iteration_budget: { type: 'number' },
          cost_budget_usd: { type: 'number' },
          depends_on: { type: 'array', items: { type: 'string' } },
          // ADR 051: both are REQUIRED of the model. `class` selects the gate
          // profile; `acceptance_criteria` is the typed field that replaces
          // prose recovered by regex, so the shape is stated here rather than
          // hoped for in the skill's prose.
          class: { type: 'string', enum: ['code', 'docs', 'config', 'infra'] },
          acceptance_criteria: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: { given: { type: 'string' }, when: { type: 'string' }, then: { type: 'string' } },
              required: ['given', 'when', 'then'],
            },
          },
          body: { type: 'string' },
        },
        required: ['slug', 'title', 'iteration_budget', 'cost_budget_usd', 'class', 'acceptance_criteria', 'body'],
      },
    },
  },
  required: ['vision', 'initiatives'],
};

/**
 * Render the explore stage's findings into the draft prompt (R4-04-F4).
 * Empty array when no findings exist (fail-open exploration) — the draft
 * prompt is then byte-identical to the pre-explore shape.
 */
function renderExploreBlock(findings: ExploreFindings | null): string[] {
  if (!findings || (findings.edgeCases.length === 0 && findings.brainConstraints.length === 0)) {
    return [];
  }
  const lines: string[] = ['', '### Edge cases + brain constraints (exploration stage)', ''];
  if (findings.edgeCases.length > 0) {
    lines.push(
      'Edge cases you enumerated — every one MUST land per its disposition: ' +
        '`covered` cases appear in a matching initiative\'s ACs; `needs-initiative` ' +
        'cases get their own initiative; `deferred` cases are named in the ' +
        'initiative body\'s out-of-scope note (nothing enumerated may silently vanish):',
    );
    for (const ec of findings.edgeCases) {
      lines.push(`- [${ec.disposition}] **${ec.title}** — ${ec.detail}`);
    }
  }
  if (findings.brainConstraints.length > 0) {
    lines.push(
      '',
      'Brain-sourced constraints — shape the matching acceptance criteria and ' +
        'cite the source theme in the AC line where applicable:',
    );
    for (const bc of findings.brainConstraints) {
      lines.push(`- ${bc.constraint} _(source: ${bc.source})_`);
    }
  }
  return lines;
}

export async function runDraftStep(
  args: ArchitectStepArgs & { resolvedDecisions: string | null },
): Promise<RunArchitectTurnResult> {
  const { input, status, plumbing, writeStatus, resolvedDecisions, paths } = args;
  const { queryFn, logger, onToolUse, onHeartbeat, onText, onThinking } = plumbing;
  const brainIndex = architectBrainIndex(input, status);
  // W8-B6 — the same initiative id every event in this session already uses.
  const initiativeId = `architect-session-${input.sessionId}`;
  const interview = readInterview(input.projectRoot, input.sessionId);
  const skill = loadSkillTurnPrompt({ name: 'architect', turnId: 'draft', skillPromptPath: input.skillPromptPath });

  const prompt = [
    ...(brainIndex
      ? [
          '# Brain navigation index',
          '',
          'Read relevant Brain 2 (brain/cycles/) and Brain 3 (projects/<project>/brain/) theme files listed below as your FIRST action. Record the paths you consulted — they surface in the PLAN\'s Brain context section.',
          '',
          brainIndex,
          '',
          '---',
          '',
        ]
      : []),
    skill,
    '',
    `Project: ${status.project}`,
    '',
    'Operator idea / brief:',
    status.idea,
    '',
    'Interview answers:',
    interview.length
      ? interview.map((r, i) => `${i + 1}. Q: ${r.question}\n   A: ${r.answer}`).join('\n')
      : '_(operator drafted directly)_',
    ...(resolvedDecisions
      ? ['', 'Resolved design decisions (bake these into the manifests):', resolvedDecisions]
      : []),
    ...renderExploreBlock(readExploreFindings(input.projectRoot, input.sessionId)),
  ].join('\n');

  let { output: draft, brainReads } = await runStructured<{ vision?: string; initiatives?: DraftInitiative[] }>({
    logger, initiativeId, cwd: status.project_repo_path,
    queryFn,
    prompt,
    schema: DRAFT_SCHEMA,
    modelTier: status.modelTier,
    onToolUse,
    onHeartbeat,
    onText,
    onThinking,
  });
  let draftInitiatives = Array.isArray(draft?.initiatives) ? draft!.initiatives! : [];
  // Convergence backstop: if the model still returns zero initiatives (e.g. it did not
  // honour the schema's minItems), re-issue ONE focused, research-light turn that forbids
  // further tools and demands ≥1 initiative, so the agent synthesizes what it already
  // gathered rather than failing the whole session. (The turn cap that originally caused
  // empty drafts on the release-CRUD idea, 2026-06-08, has been removed — the architect
  // is operator-driven, so it now runs uncapped.)
  if (draftInitiatives.length === 0) {
    logger.emit({
      initiative_id: `architect-session-${input.sessionId}`,
      phase: 'architect',
      skill: 'architect-runner',
      event_type: 'log',
      input_refs: [],
      output_refs: [],
      message: 'draft returned no initiatives — retrying with a forced-emit turn (no further research)',
      metadata: { session_id: input.sessionId },
    });
    const forceEmitSection = loadForceEmitTurnSection(input.skillPromptPath);
    const retry = await runStructured<{ vision?: string; initiatives?: DraftInitiative[] }>({
    logger, initiativeId, cwd: status.project_repo_path,
      queryFn,
      prompt: `${prompt}\n\n${forceEmitSection}`,
      schema: DRAFT_SCHEMA,
      modelTier: status.modelTier,
      onToolUse,
      onHeartbeat,
      onText,
      onThinking,
    });
    if (Array.isArray(retry.output?.initiatives) && retry.output!.initiatives!.length > 0) {
      draft = retry.output;
      brainReads.push(...retry.brainReads);
      draftInitiatives = retry.output!.initiatives!;
    }
  }
  const vision = (draft?.vision ?? status.idea).trim();
  if (draftInitiatives.length === 0) {
    throw new Error(
      'architect runner: draft step returned no initiatives after a forced-emit retry — the idea may be ' +
      'too broad to plan in one pass. Re-run to retry, or split/refine the idea or interview answers.',
    );
  }

  const created_at = new Date().toISOString();
  const datePart = created_at.slice(0, 10);
  // Slug set lets buildManifest resolve `depends_on` refs to sibling initiatives
  // (and drop refs to slugs not in this draft, which would block forever).
  // W7-C3 deref guard: a draft row with NEITHER slug nor title (structured
  // output is LLM-produced) must not crash the whole run inside slugify's
  // .toLowerCase() — it falls to slugify's own 'initiative' fallback.
  const knownSlugs = new Set(draftInitiatives.map((d) => slugify(d.slug || d.title || '')));
  const manifests = draftInitiatives.map((d) =>
    buildManifest(d, status, datePart, created_at, knownSlugs),
  );

  const councilTranscript: CouncilTranscript = { flags: [], escalations: [], perCritic: [], totalCostUsd: 0 };

  // Write draft manifests (promoted to the queue only on finalize/approve).
  if (!existsSync(paths.manifestsDir)) mkdirSync(paths.manifestsDir, { recursive: true });
  for (const m of manifests) {
    writeFileSync(join(paths.manifestsDir, `${m.initiative_id}.md`), requirePorts(input).serializeManifest(m));
  }

  const proposed: ProposedInitiative[] = manifests.map((m, idx) => ({
    initiative_id: m.initiative_id,
    project: m.project,
    project_repo_path: m.project_repo_path,
    title: draftInitiatives[idx]?.title ?? m.initiative_id,
    iteration_budget: m.iteration_budget,
    cost_budget_usd: m.cost_budget_usd,
    // ADR 051: read off the MANIFEST, not the draft — `buildManifest` is where
    // the class and the criteria were validated, so the plan the operator
    // confirms shows the same values the queue will run.
    class: m.class,
    acceptance_criteria: m.acceptance_criteria,
    // Carry cross-initiative build order through to the PLAN render. The
    // renderer's "Depends on" column reads this; without it the plan showed
    // every initiative as "—" even when the manifests DID carry deps
    // (operator catch, 2026-06-01).
    depends_on_initiatives: m.depends_on_initiatives,
    body: m.body,
  }));

  // ARCH-1: build brain_context from the brain/ paths the agent actually Read
  // during the draft turn. Deduplicate paths; use a generic summary since the
  // agent's Read content is not parsed here.
  const seenPaths = new Set<string>();
  const brain_context = brainReads
    .filter((p) => {
      if (seenPaths.has(p)) return false;
      seenPaths.add(p);
      return true;
    })
    .map((p) => ({ path: p, summary: 'consulted during architect draft' }));

  const exploreFindings = readExploreFindings(input.projectRoot, input.sessionId);
  const session: ArchitectSession = {
    session_id: status.session_id,
    project: status.project,
    project_repo_path: status.project_repo_path,
    vision,
    interview,
    brain_context,
    council: councilTranscript,
    ...(exploreFindings ? { explore: exploreFindings } : {}),
    initiatives: proposed,
  };

  const planPath = writePlanDoc(session, input.projectRoot);
  writeStatus({ ...status, phase: 'awaiting-verdict' });

  logger.emit({
    initiative_id: `architect-session-${input.sessionId}`,
    phase: 'architect',
    skill: 'architect-runner',
    event_type: 'log',
    input_refs: [],
    output_refs: [planPath],
    message: `plan-emitted (${manifests.length} initiative(s), 0 escalation(s))`,
    metadata: {
      session_id: input.sessionId,
      initiative_ids: manifests.map((m) => m.initiative_id),
      escalation_count: 0,
    },
  });

  return { phase: 'awaiting-verdict', wrote: [planPath], planPath };
}
// ---------------------------------------------------------------------------
// Structured-output query (mirrors council's parse path)
// ---------------------------------------------------------------------------

type StructuredResult<T> = {
  output: T | null;
  /** Brain paths Read by the agent during this turn (for brain_context). */
  brainReads: string[];
};

/**
 * Architect-local thin wrapper over the shared `runStructuredTurn` (ADR 020 spine
 * extracted to interactive-session.ts). It binds the architect's model + tool
 * allow-list (derived from skills/architect/SKILL.md, ADR-024) and narrows the
 * generic `reads` down to the `brain/` paths the PLAN's brain-context section
 * needs (ARCH-1). Callsites keep their `{ output, brainReads }` shape.
 */
async function runStructured<T>(args: {
  queryFn: QueryFn;
  prompt: string;
  schema: unknown;
  /** W8-B6 — the run's logger + initiative id, so the architect's own bound
   *  library hooks can fire and record. Required, not optional: an optional
   *  field here would let a call site silently spawn hook-blind. */
  logger: EventLogger;
  initiativeId: string;
  /** Bead forge-8vfn.6.10.19 — the PROJECT GROUND this turn runs on, passed to
   *  the SDK as `cwd`. REQUIRED, like `logger` above and for the same reason: an
   *  optional field here would let a call site silently spawn ground-blind, and
   *  a ground-blind architect session inherits the BRIDGE's cwd — the forge repo
   *  root — so a relative write by it lands in forge's own tree.
   *
   *  It comes from `ArchitectStatus.project_repo_path`, which the start route
   *  already validated through `rejectStartProjectRepoPath` before the session
   *  record existed; this is the same value being USED rather than a fresh
   *  request-derived path entering here. */
  cwd: string;
  /** ADR-043 §3 amendment (wave-6): the session's requested kickoff tier
   *  (`status.modelTier`), resolved against `architectAgentSpec` — absent
   *  resolves to the unchanged `ARCHITECT_MODEL` default. */
  modelTier?: ModelTier;
  onToolUse?: (d: ToolUseLiveDetail) => void;
  onHeartbeat?: () => void;
  onText?: (text: string) => void;
  onThinking?: (text: string) => void;
}): Promise<StructuredResult<T>> {
  const { output, reads, costUsd } = await runStructuredTurn<T>({
    queryFn: args.queryFn,
    prompt: args.prompt,
    schema: args.schema,
    model: resolveSessionModel(architectAgentSpec, args.modelTier),
    cwd: args.cwd,
    allowedTools: architectAgentSpec.allowedTools,
    disallowedTools: architectAgentSpec.disallowedTools,
    ...(() => {
      const hooks = sdkHooksForAgent({
        skill: architectAgentSpec.skill,
        logger: args.logger,
        initiativeId: args.initiativeId,
      });
      return hooks !== undefined ? { hooks } : {};
    })(),
    onToolUse: args.onToolUse,
    onHeartbeat: args.onHeartbeat,
    onText: args.onText,
    onThinking: args.onThinking,
    label: 'architect-structured',
  });
  // bead forge-8vfn.18 — emit the turn's spend so the ceiling can bound stage 1.
  // Authoritative because this phase emits no `iteration` events (trap pinned in
  // architect-turn-cost-event.test.ts). Best-effort: never fail a completed turn.
  try {
    args.logger.emit({
      initiative_id: args.initiativeId, phase: 'architect', skill: 'architect',
      event_type: 'end', input_refs: [], output_refs: [],
      cost_usd: costUsd, message: 'architect.turn-cost',
    });
  } catch { /* a logging failure must not fail the turn */ }
  return { output, brainReads: reads.filter((p) => p.includes('brain/')) };
}

// ---------------------------------------------------------------------------
// Prompt source (ADR 003 / ADR 024 — prompt is skill content, not re-baked TS)
// ---------------------------------------------------------------------------
//
// Per-turn prose now lives in `skills/architect/SKILL.md` as `<!-- turn: id -->`
// sections, loaded through the shared, fail-loud `loadSkillTurnPrompt`
// (`packages/agents/skill-path.ts`, R4-23) at each of the three call sites above
// — no runner-private fallback survives.

/**
 * The `draft-force-emit` turn section's raw text WITHOUT the shared `base`
 * preamble. The forced-emit retry APPENDS this to the already-composed draft
 * prompt rather than rebuilding it from scratch (park §2c / AT-7: the retry
 * prompt must be the first prompt with this text appended, a strict prefix
 * relationship). `loadSkillTurnPrompt` always returns `base + '\n\n' +
 * section`, which would duplicate `base` into the appended tail, so this
 * reads the same file and pulls just the one section via the shared, pure
 * `splitSkillTurnSections`. Fails loud on the same two conditions
 * `loadSkillTurnPrompt` does (unreadable file / missing turn id) — no silent
 * default here either (the declared-data-fails-open antipattern this whole
 * lane exists to close).
 */
function loadForceEmitTurnSection(skillPromptPath?: string): string {
  const resolvedPath = skillPromptPath ?? skillPath('architect');
  let text: string;
  try {
    text = readFileSync(resolvedPath, 'utf8');
  } catch (err) {
    throw new Error(
      `architect runner: could not read skill "architect" (turn "draft-force-emit") at ${resolvedPath}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const { turns } = splitSkillTurnSections(text);
  const section = turns.get('draft-force-emit');
  if (section === undefined) {
    const available = [...turns.keys()].sort().join(', ');
    throw new Error(
      `architect runner: skill "architect" (${resolvedPath}) has no turn "draft-force-emit" — available turns: ${available}.`,
    );
  }
  return section;
}
