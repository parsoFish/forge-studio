/**
 * Project-manager phase runner.
 *
 * Invokes the PM skill via the Claude Agent SDK, validates the emitted work
 * items, and emits decomposition telemetry.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';

import type { EventLogger } from '../logging.ts';
import { parseManifest, type InitiativeManifest } from '../manifest.ts';
import {
  PM_ALLOWED_TOOLS,
  PM_DISALLOWED_TOOLS,
  PM_MODEL,
  PM_BRAIN_ACCESS,
  buildPmSystemPrompt,
  renderPmUserPrompt,
  tallyToolUse,
  type PmToolUseSummary,
} from '../pm-invocation.ts';
import {
  detectHiddenCoupling,
  readWorkItemsFromDir,
  serializeWorkItem,
  validateWorkItemSet,
  type WorkItem,
} from '../work-item.ts';
import { loadProjectConfig, type ProjectConfig } from '../project-config.ts';
import { recordBrainGateResult, type CycleInput } from '../cycle-context.ts';
import { makeToolEventSink, extractLiveToolDetails } from '../tool-event-emit.ts';
import { deriveGateRecipe, renderGateRecipeBlock } from '../gate-recipes.ts';
import { withIdleDeadline } from '../stream-deadline.ts';

/**
 * Injection seam for tests. The live cycle uses `sdkQuery` from the
 * Claude Agent SDK; tests supply a stub that returns a canned PM session
 * per call so we can exercise the pass without hitting the network.
 */
export type PmQueryFn = (params: {
  prompt: string;
  options?: Record<string, unknown>;
}) => AsyncIterable<unknown>;

export type RunProjectManagerOptions = {
  queryFn?: PmQueryFn;
};

/**
 * Defaults for the live PM invocation. Higher budget + turn cap than the bench
 * (real worktrees are richer than fixtures); the bench enforces 0.5 USD / 30
 * turns to keep iteration cheap.
 */
const PM_LIVE_MAX_TURNS = 50;
// F-42: PM budget floor bumped from $1.00 → $2.50. The 22:17
// simplification-source cycle hit $1.01 and emitted 0 WIs
// (pm-budget-exhausted). At trafficGame's scale (251 files) $1.00 wasn't
// enough headroom; $2.50 is generous there (PM peaks ~$1.50).
//
// F-43: $2.50 was a FLAT constant, so the classifier's pm-budget-exhausted
// recommendation ("increase cost_budget_usd in the manifest") was inert —
// the cap ignored the manifest entirely. terraform-provider-betterado (286
// *_test.go + a huge vendored tree) proved larger than any project tuned
// for: its PM blew $2.50 on the brain-first mandate + worktree exploration
// before emitting any WIs, failing INIT 01/03 and stalling 18 dependents.
// Fix: derive the cap from the initiative's own declared budget so big
// initiatives (which already declare big budgets) get proportional PM
// planning headroom, while $2.50 stays the floor (small projects + the PM
// bench, which pins its own 2.5, are unchanged — no regression). This also
// makes the classifier's existing recommendation actually true.
const PM_LIVE_MAX_BUDGET_USD_FLOOR = 2.5;
const PM_BUDGET_FRACTION_OF_INITIATIVE = 0.2;
function pmMaxBudgetUsd(initiativeCostBudgetUsd: number): number {
  return Math.max(
    PM_LIVE_MAX_BUDGET_USD_FLOOR,
    initiativeCostBudgetUsd * PM_BUDGET_FRACTION_OF_INITIATIVE,
  );
}

export async function runProjectManager(
  input: CycleInput,
  logger: EventLogger,
  options: RunProjectManagerOptions = {},
): Promise<void> {
  const start = logger.emit({
    initiative_id: input.initiativeId,
    phase: 'project-manager',
    skill: 'project-manager',
    event_type: 'start',
    input_refs: [input.manifestPath],
    output_refs: [],
  });

  const manifest = parseManifest(readFileSync(input.manifestPath, 'utf8'));
  const queryFn = options.queryFn ?? (sdkQuery as unknown as PmQueryFn);

  const result = await runOnePmPass({
    input,
    logger,
    manifest,
    parentEventId: start.event_id,
    queryFn,
  });

  if (result.kind === 'success') return;
  throw new Error(`project-manager phase failed: ${result.summary}`);
}

type PmPassInput = {
  input: CycleInput;
  logger: EventLogger;
  manifest: InitiativeManifest;
  parentEventId: string;
  queryFn: PmQueryFn;
};

type PmPassOutcome =
  | { kind: 'success' }
  | { kind: 'failure'; summary: string };

/**
 * Run the PM pass against the SDK, validate the emitted work-items, and
 * emit telemetry. Returns a discriminated outcome rather than throwing so
 * the outer orchestrator can decide how to handle failure.
 */
async function runOnePmPass(p: PmPassInput): Promise<PmPassOutcome> {
  const { input, logger, manifest, parentEventId, queryFn } = p;

  // F-21: wipe any stale `.forge/work-items/` inherited from the project's
  // base branch. The dev-loop's pre-review boundary snapshot historically
  // committed cycle scratch into project repos; without this wipe, the PM
  // agent sees pre-existing WI files and emits stale content (wrong
  // initiative_id, wrong work) instead of starting from a clean canvas.
  // Idempotent — missing dir is fine; gitignore is the structural fix,
  // this is the runtime backstop.
  const stalePmScratch = resolve(input.worktreePath, '.forge', 'work-items');
  if (existsSync(stalePmScratch)) {
    rmSync(stalePmScratch, { recursive: true, force: true });
  }

  const forgeRoot = resolve(import.meta.dirname, '..', '..');
  const systemPrompt = buildPmSystemPrompt(forgeRoot);
  // 2026-05-25 (claude-harness cycle 8 audit): read the project-shape
  // context off-disk and inject it into the prompt. PM was hallucinating
  // tooling (jest in a node:test project, npm run build with no build
  // script) because "go read package.json" wasn't load-bearing —
  // inlining the contents makes it so.
  const projectContext = readProjectContext(input.worktreePath);
  // betterado #2: derive the language-specific scoped-gate recipe from the
  // worktree so the PM writes a discriminating per-WI gate (e.g. Go's
  // `-tags all -run <NewPrefix> ./pkg/`) instead of the operator hand-encoding it.
  const gateRecipe = renderGateRecipeBlock(deriveGateRecipe(input.worktreePath));
  const prompt = renderPmUserPrompt({
    initiativeId: input.initiativeId,
    manifestRelPath: input.manifestPath,
    worktreeRelPath: input.worktreePath,
    projectName: manifest.project,
    projectContext,
    gateRecipe,
  });

  const opts: Record<string, unknown> = {
    // F-37: PM runs with cwd = the worktree, NOT forgeRoot. Previously
    // the PM agent's `Glob({pattern: 'src/**'})` resolved against forge's
    // own root (which has no src/ directory) — getting zero results, then
    // fabricating plausible paths from training-data priors (e.g.,
    // src/engine/physics.test.ts on a project that has no src/engine/).
    // With cwd at the worktree, every relative-path tool call sees the
    // actual project. The system prompt's brain content is captured at
    // build time so it's unaffected by the cwd switch.
    cwd: input.worktreePath,
    systemPrompt,
    model: PM_MODEL,
    permissionMode: 'acceptEdits',
    allowedTools: PM_ALLOWED_TOOLS,
    disallowedTools: PM_DISALLOWED_TOOLS,
    maxTurns: PM_LIVE_MAX_TURNS,
    maxBudgetUsd: pmMaxBudgetUsd(manifest.cost_budget_usd),
  };
  // Idle-deadline safety net: a stalled stream (usage limit / network) aborts +
  // throws into cycle.ts → classifier (transient) instead of hanging the queue.
  // betterado roadmap run stalled exactly here mid-PM (known-gaps 2026-06-01).
  const abortController = new AbortController();
  opts.abortController = abortController;

  const toolUseSummary: PmToolUseSummary = { brainReads: 0, writes: 0 };
  let costUsd = 0;
  let durationMs = 0;
  let resultSubtype: string | undefined;

  // Phase A — per-tool live telemetry for the PM (no work-item yet).
  // The PM drives its own stream loop, so it feeds the sink manually via
  // `extractLiveToolDetails` rather than `createClaudeAgent`'s `onToolUse`.
  const pmToolSink = makeToolEventSink(logger, {
    initiativeId: input.initiativeId,
    parentEventId,
    phase: 'project-manager',
    skill: 'project-manager',
  });
  let pmToolSeq = 0;

  for await (const msg of withIdleDeadline(queryFn({ prompt, options: opts }) as AsyncIterable<unknown>, {
    label: 'project-manager',
    abortController,
  })) {
    if (typeof msg !== 'object' || msg === null) continue;
    const m = msg as { type?: string; message?: { content?: Array<{ type?: string; name?: string; input?: unknown }> }; subtype?: string; total_cost_usd?: number; duration_ms?: number };
    if (m.type === 'assistant') {
      tallyToolUse(m.message, toolUseSummary);
      for (const detail of extractLiveToolDetails(m.message, pmToolSeq)) {
        pmToolSink.onToolUse(detail);
        pmToolSeq = detail.seq;
      }
      continue;
    }
    if (m.type !== 'result') continue;
    if (typeof m.duration_ms === 'number') durationMs = m.duration_ms;
    if (typeof m.total_cost_usd === 'number') costUsd = m.total_cost_usd;
    resultSubtype = m.subtype ?? 'success';
    break;
  }
  // PM is single-pass (not iterative); flush the coalesced remainder once.
  pmToolSink.flushIteration(0);

  for (let i = 0; i < toolUseSummary.brainReads; i++) {
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: parentEventId,
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'tool_use',
      input_refs: ['brain/'],
      output_refs: [],
      message: 'pm.brain-query',
    });
  }

  // F-13 / F-19: enforce the brain-first mandate at the orchestrator when the
  // agent's brainAccess is 'mandatory'. If the PM agent skipped brain-query
  // entirely, fail fast with a distinct error (rather than continuing into
  // validateWorkItemSet, where the brain-skip's downstream effect — incomplete
  // frontmatter — surfaces instead, masking the real cause).
  // M2-3: gate is conditional on PM_BRAIN_ACCESS so a hypothetical advisory
  // agent would not abort on 0 reads. PM IS mandatory, so behaviour is
  // identical in production.
  if (
    PM_BRAIN_ACCESS === 'mandatory' &&
    !recordBrainGateResult('project-manager', 'project-manager', toolUseSummary.brainReads, {
      initiativeId: input.initiativeId,
      logger,
      parentEventId,
    })
  ) {
    return {
      kind: 'failure',
      summary:
        'brain-first mandate not honoured (0 brain-query calls). The system prompt requires reading from `brain/...` (forge themes + project themes) before producing work items.',
    };
  }

  const workItemsDir = resolve(input.worktreePath, '.forge', 'work-items');
  const read = readWorkItemsFromDir(workItemsDir);
  let items = read.items;
  const parseErrors = read.parseErrors;

  for (const item of items) {
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: parentEventId,
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'log',
      input_refs: [input.manifestPath],
      output_refs: [resolve(workItemsDir, `${item.work_item_id}.md`)],
      message: 'pm.work-item-emitted',
      metadata: { work_item_id: item.work_item_id },
    });
  }

  // Load the project's forge config (best-effort) for the A2 testing-contract
  // checks. A malformed config is surfaced + fail-closed elsewhere (the
  // dev-loop loads it); here we skip the EXTRA checks rather than break the PM
  // pass on a config problem unrelated to decomposition quality.
  let projectConfig: ProjectConfig | null = null;
  try {
    projectConfig = loadProjectConfig(input.worktreePath);
  } catch {
    projectConfig = null;
  }

  // A2b (2026-06-06): inject the project's standing acceptance criteria into
  // every WI body as a fixed contract section. Static + automatic — removes
  // the per-WI PM judgment that kept varying. Body-only (frontmatter stays
  // byte-stable), idempotent (skips a WI already carrying the section).
  if (projectConfig?.standing_work_item_acs && projectConfig.standing_work_item_acs.length > 0) {
    items = appendStandingAcs(workItemsDir, items, projectConfig.standing_work_item_acs);
  }

  const { perItem, setErrors } = validateWorkItemSet(items, {
    expectedInitiativeId: manifest.initiative_id,
  });
  const itemErrorCount = Object.values(perItem).reduce((acc, errs) => acc + errs.length, 0);

  // F-05: hidden-coupling check. Two WIs whose `files_in_scope` overlap
  // without a `depends_on` edge between them will conflict at merge time.
  const couplingViolations = items.length > 0 ? detectHiddenCoupling(items) : [];

  // A2a (2026-06-06): live-acceptance-WI requirement (contract C7). When the
  // project declares `acceptance_gate.required`, the decomposition MUST include
  // ≥1 WI whose `quality_gate_cmd` targets the live acceptance suite — so every
  // initiative is proven by a real TF_ACC test, not an offline proxy. INIT-2
  // shipped with NO live-acc WI; this makes that a hard PM failure.
  let accGateViolation: string | null = null;
  const accGate = projectConfig?.acceptance_gate;
  if (accGate?.required && items.length > 0) {
    const hasLiveAccWi = items.some((it) =>
      (it.quality_gate_cmd ?? []).some((tok) => tok.includes(accGate.match)),
    );
    if (!hasLiveAccWi) {
      accGateViolation =
        `no live-acceptance work item: this project requires ≥1 WI whose quality_gate_cmd targets ` +
        `"${accGate.match}" (a live TF_ACC acceptance test proving the change against the real ` +
        `external system). Add an acceptance WI whose gate runs that suite.`;
    }
  }

  // Operator sanity-check surface: a greppable WI list so a human can eyeball
  // at a glance whether each WI got plausible scope (and spot off-target scope —
  // e.g. a WI touching brain/ for a code initiative).
  writeDecompositionDoc(workItemsDir, manifest, items);

  // Terminal: zero work items emitted → pm-empty-decomposition.
  if (items.length === 0) {
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: parentEventId,
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'error',
      input_refs: [input.manifestPath],
      output_refs: [],
      message: 'pm.empty-decomposition',
      metadata: { result_subtype: resultSubtype },
    });
  }

  const failed =
    items.length === 0 ||
    Object.keys(parseErrors).length > 0 ||
    setErrors.length > 0 ||
    itemErrorCount > 0 ||
    couplingViolations.length > 0 ||
    accGateViolation !== null;

  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: parentEventId,
    phase: 'project-manager',
    skill: 'project-manager',
    event_type: 'log',
    input_refs: [input.manifestPath],
    output_refs: [resolve(workItemsDir, '_graph.md')],
    message: 'pm.graph-emitted',
    metadata: {},
  });

  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: parentEventId,
    phase: 'project-manager',
    skill: 'project-manager',
    event_type: failed ? 'error' : 'end',
    input_refs: [input.manifestPath],
    output_refs: [workItemsDir],
    duration_ms: durationMs,
    cost_usd: costUsd,
    metadata: {
      work_item_count: items.length,
      result_subtype: resultSubtype,
      tool_use: toolUseSummary,
      parse_errors: parseErrors,
      set_errors: setErrors,
      per_item_error_count: itemErrorCount,
      hidden_coupling_violations: couplingViolations,
      ...(accGateViolation ? { acceptance_gate_violation: accGateViolation } : {}),
    },
  });

  if (!failed) return { kind: 'success' };

  const summary = [
    items.length === 0 ? 'no work items emitted' : null,
    Object.keys(parseErrors).length > 0 ? `parse errors: ${Object.keys(parseErrors).join(', ')}` : null,
    setErrors.length > 0 ? `set errors: ${setErrors.join('; ')}` : null,
    itemErrorCount > 0 ? `${itemErrorCount} per-item validation errors` : null,
    couplingViolations.length > 0
      ? `${couplingViolations.length} hidden-coupling pair(s): ${couplingViolations.map((pair) => `${pair.a}↔${pair.b} share ${pair.sharedFiles.join(',')}`).join('; ')}`
      : null,
    accGateViolation,
  ]
    .filter((s): s is string => s !== null)
    .join('; ');

  return { kind: 'failure', summary };
}

/** Heading for the project-contract standing-AC section injected per WI. */
const STANDING_ACS_HEADER = '## Standing acceptance criteria (project contract)';

/**
 * A2b (2026-06-06) — append the project's `standing_work_item_acs` to every WI
 * body as a fixed contract section, then re-serialise the file. Body-only
 * (frontmatter byte-stable via `serializeWorkItem`), idempotent (a WI already
 * carrying the header is left untouched — safe on resume). Best-effort per
 * file: a write error leaves that WI unchanged rather than failing the PM pass.
 * Returns the items with their in-memory bodies updated to match disk.
 */
function appendStandingAcs(
  workItemsDir: string,
  items: ReadonlyArray<WorkItem>,
  standingAcs: ReadonlyArray<string>,
): WorkItem[] {
  const section = [
    STANDING_ACS_HEADER,
    '',
    'These project-wide testing invariants apply to **every** work item in this initiative, in addition to the work-specific acceptance criteria above. The dev-loop must satisfy them and the reviewer must confirm them:',
    '',
    ...standingAcs.map((ac) => `- ${ac}`),
  ].join('\n');
  return items.map((item) => {
    if (item.body.includes(STANDING_ACS_HEADER)) return item; // idempotent
    const updated: WorkItem = { ...item, body: `${item.body.replace(/\s+$/, '')}\n\n${section}\n` };
    try {
      writeFileSync(join(workItemsDir, `${item.work_item_id}.md`), serializeWorkItem(updated));
      return updated;
    } catch {
      return item; // best-effort — never fail the PM pass on a write error
    }
  });
}

/**
 * Write `.forge/work-items/_decomposition.md` — a greppable WI list for a
 * fast operator sanity check. Lists each WI (id + the files it touches, so
 * off-target scope is obvious). Excluded from `readWorkItemsFromDir` so it
 * is never parsed as a WI.
 */
function writeDecompositionDoc(
  workItemsDir: string,
  manifest: InitiativeManifest,
  items: ReadonlyArray<WorkItem>,
): void {
  const lines: string[] = [
    `# Work-item decomposition — ${manifest.initiative_id}`,
    '',
    `${items.length} work item(s) emitted.`,
    '',
  ];

  // A1 advisory (2026-06-06): a top-level-scope summary so the operator can
  // eyeball off-target decomposition AT A GLANCE. If the PM mis-grounds (e.g.
  // hallucinates off the title and touches `releases/`, `docs/`, or `brain/`
  // instead of the project's source tree), the stray top-level dir shows up
  // here immediately. Advisory only — not a hard gate (a legit WI may touch
  // docs/examples); the teeth are the restate-the-target step + the live-acc-WI
  // requirement.
  const topLevel = new Map<string, number>();
  for (const item of items) {
    for (const f of item.files_in_scope) {
      const seg = f.split('/')[0] || f;
      topLevel.set(seg, (topLevel.get(seg) ?? 0) + 1);
    }
  }
  if (topLevel.size > 0) {
    lines.push('## Top-level scope (eyeball for off-target dirs)');
    for (const [seg, count] of [...topLevel.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`- \`${seg}/\` — ${count} file ref(s)`);
    }
    lines.push('');
  }

  for (const item of items) {
    lines.push(`## ${item.work_item_id}`);
    for (const f of item.files_in_scope) lines.push(`- ${f}`);
    lines.push('');
  }
  try {
    writeFileSync(join(workItemsDir, '_decomposition.md'), lines.join('\n'));
  } catch {
    /* best-effort telemetry artifact — never fail the PM pass on a write error */
  }
}

/**
 * Read the project-shape context files off the worktree. Each is
 * optional — skipped if the file isn't present. Caps each file at
 * 8 KB so a freak large CLAUDE.md / package.json doesn't blow the
 * prompt budget; trims aren't ideal but the agent only needs enough
 * to identify the tooling.
 *
 * Surfaced 2026-05-25 by the claude-harness cycle 8 audit: PM was
 * hallucinating `jest` in a `node:test` project. Inlining
 * package.json's actual scripts makes it impossible to ignore.
 */
function readProjectContext(worktreePath: string): {
  packageJson?: string;
  pyprojectToml?: string;
  cargoToml?: string;
  forgeProjectJson?: string;
  claudeMd?: string;
} {
  const safeRead = (rel: string): string | undefined => {
    const p = resolve(worktreePath, rel);
    if (!existsSync(p)) return undefined;
    try {
      const raw = readFileSync(p, 'utf8');
      return raw.length > 8192 ? raw.slice(0, 8192) + '\n… (truncated)' : raw;
    } catch {
      return undefined;
    }
  };
  return {
    packageJson: safeRead('package.json'),
    pyprojectToml: safeRead('pyproject.toml'),
    cargoToml: safeRead('Cargo.toml'),
    forgeProjectJson: safeRead('.forge/project.json'),
    claudeMd: safeRead('CLAUDE.md'),
  };
}
