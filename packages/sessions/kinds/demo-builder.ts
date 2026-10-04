/**
 * The `demo` session kind — a registered step-handler variant (ADR 043 as
 * amended 2026-09-03, M4 ruling 60).
 *
 * Builds a project's demo DECLARATION (bead forge-mfv5.2.8): an agent drafts
 * the `demoProcess` steps and renders a sample DEMO.html by running them, the
 * operator reviews the generation, and locking it writes the declaration into
 * `.forge/project.json` — the sole cycle-time demo input — once it passes the
 * drive rule `forge preflight`'s DEMO-SKILL clause applies.
 *
 * THE NAME TRAP, which is real and load-bearing (`AgentRunnerEntry.kindDir`'s
 * own doc calls it out): the operator types the agent-id `demo-builder`, but
 * the SESSION KIND is `demo` and its on-disk dir is `_demo`. So the registry
 * KEY is `demo-builder` while `demoKind.id` is `demo` — which is what drives
 * the `_demo-<sid>` event-log directory every consumer already derives
 * independently. Naming the variant `demo-builder` would write events into
 * `_demo-builder-<sid>`, a directory nothing reads.
 *
 * This file holds ONLY the kind's identity — its agent spec, its variant, the
 * lock step and its containment guards, the affordance arms, and the
 * studio-branch bracket around the steps that write into the project repo.
 * Every piece of turn plumbing it used to carry now lives once in
 * `kind-turn.ts`; the phases, path constants and status contract live in
 * `demo-session-store.ts`; the generate step lives in `demo-generate.ts`.
 *
 * Ported from `packages/sessions/demo-builder-runner.ts`. Byte-identical spawn
 * behaviour is pinned by `interactive-runners-golden.test.ts` against
 * `packages/kernel/tests/test-fixtures/spawn-capture/interactive-demo-builder.json`.
 */

import type { ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';


import {
  runKindTurn,
  type KindTurnInput,
  type KindTurnPlumbing,
  type SessionKindVariant,
} from './kind-turn.ts';
import { emitGroundFileChanges, guardedFile, guardedReadFile, guardedWriteFile, sendJson } from '@forge/kernel';
import { guardedWriteSessionStatus } from '../session-status-io.ts';
import {
  DEMO_HISTORY_REL_DIR,
  DEMO_REL_DIR,
  DEMO_HTML_REL_PATH,
  DEMO_KIND_DIR,
  DEMO_LOCK_REL_PATH,
  GENERATIONS_DIRNAME,
  GENERATION_DECLARATION_FILENAME,
  GENERATION_DEMO_FILENAME,
  listExistingGenerationNumbers,
  type DemoBuilderStatus,
  type RunDemoBuilderTurnResult,
} from './demo-session-store.ts';
import { runGenerateStep } from './demo-generate.ts';

export function demoSessionDir(projectRoot: string, sessionId: string): string {
  return join(projectRoot, DEMO_KIND_DIR, sessionId);
}
import {
  affordanceDryBridgeMarker,
  readAnswersBody,
  type AffordanceRouteContext,
} from '../bridge-studio-sessions-affordance-shell.ts';
import { ensureStudioBranch, commitStudioChange, PROJECT_CONFIG_REL_PATH, validateDemoDeclaration, writeProjectConfigPatch } from '@forge/projects';
// Deep paths, not the door (bead forge-8vfn.5.31, same cycle as
// architect-session.ts's own module doc — `kinds/registry.ts` needs
// `demoKind` fully bound at its own top level).
import { modelForSpec } from '@forge/agents/phase-agent.ts';
import { deriveAgentSpec } from '@forge/agents/studio/derive.ts';
import { skillPathRelative } from '@forge/agents/skill-path.ts';

// ---------------------------------------------------------------------------
// ADR-024: spec derived from skills/demo-builder/SKILL.md (single source)
// ---------------------------------------------------------------------------

export const demoBuilderAgentSpec = deriveAgentSpec(skillPathRelative('demo-builder'));
export const DEMO_BUILDER_MODEL = modelForSpec(demoBuilderAgentSpec);

export type RunDemoBuilderTurnInput = KindTurnInput;
// ---------------------------------------------------------------------------
// The variant
// ---------------------------------------------------------------------------

/**
 * The studio-branch bracket around the steps that WRITE INTO THE PROJECT REPO.
 * Kind composition, not plumbing: only this kind's agent authors machinery into
 * someone else's repo, so only this kind brackets its steps that way.
 *
 * R4-23 WI-2 round-2 fix (AT-10): the commit runs in a `finally`, so a step
 * that throws AFTER the agent has already written partial machinery still gets
 * committed rather than leaving the project repo checked out on `forge-studio`
 * with uncommitted writes. No `catch` — only `finally` — so the error still
 * propagates unchanged.
 *
 * forge-8vfn.7.3.6 round 2: "the error still propagates unchanged" only held
 * for `run()` throwing. When `run()` SUCCEEDED, a commit failure (e.g.
 * `StudioWritePathIgnoredError` — the deliverable landed under a git-ignored
 * path) was swallowed by a bare `catch`, so the turn reported success over an
 * uncommitted demo and nobody was told. A commit failure after a SUCCESSFUL
 * `run()` now propagates; a commit failure after `run()` THREW is still
 * swallowed so the original error — not the commit's — is what the caller sees.
 */
async function withStudioRepo<T>(
  status: DemoBuilderStatus,
  run: () => Promise<T> | T,
): Promise<T> {
  try { ensureStudioBranch(status.project_repo_path); } catch { /* non-git project */ }
  let succeeded = false;
  try {
    const result = await run();
    succeeded = true;
    return result;
  } finally {
    try {
      const own = [DEMO_REL_DIR].filter((p) => existsSync(join(status.project_repo_path, p))); // 7.3.6 — why: packages/sessions/tests/unit/demo-commit-scope.test.ts
      if (own.length > 0) commitStudioChange(status.project_repo_path, `forge-studio: demo machinery (${status.phase})`, own);
    } catch (commitErr) {
      if (succeeded) throw commitErr; // run() succeeded — a swallowed commit failure is a silent data loss.
      // run() itself threw — that error propagates unchanged; the commit's failure is best-effort only.
    }
  }
}

export const demoKind: SessionKindVariant<DemoBuilderStatus, RunDemoBuilderTurnResult> = {
  // `demo`, NOT `demo-builder` — see this file's header. The id drives the
  // `_demo-<sid>` event-log directory every consumer derives independently.
  id: 'demo',
  kindDir: DEMO_KIND_DIR,
  label: 'demo-builder runner',
  eventLabel: 'demo-builder turn',
  eventPhase: 'demo',
  eventSkill: 'demo-builder-runner',
  initiativeId: (sessionId) => `demo-${sessionId}`,

  steps: {
    generating: async ({ input, status, plumbing, writeStatus }) =>
      await withStudioRepo(status, () => runGenerateStep({ agentSpec: demoBuilderAgentSpec, input, status, plumbing, writeStatus })),

    locking: async ({ input, status, plumbing, writeStatus }) =>
      await withStudioRepo(status, () => runLockStep({ input, status, plumbing, writeStatus })),

    abandoned: async ({ status, writeStatus }) => {
      writeStatus({ ...status, phase: 'abandoned' });
      return { phase: 'abandoned', wrote: [] };
    },
  },

  // awaiting-review / locked — no actionable work this turn.
  otherwise: (status) => ({ phase: status.phase, wrote: [] }),
  startMetadata: (status) => ({ iteration: status.iteration }),
};

export async function runDemoBuilderTurn(
  input: RunDemoBuilderTurnInput,
): Promise<RunDemoBuilderTurnResult> {
  return await runKindTurn(demoKind, input);
}


// ---------------------------------------------------------------------------
// Lock step — deterministic: write the declaration, record the locked demo
// ---------------------------------------------------------------------------

function runLockStep(args: {
  input: RunDemoBuilderTurnInput;
  status: DemoBuilderStatus;
  plumbing: KindTurnPlumbing;
  writeStatus: (next: DemoBuilderStatus) => void;
}): RunDemoBuilderTurnResult {
  const { input, status, plumbing, writeStatus } = args;
  const { logger, initiativeId, sessionDir } = plumbing;

  // R4-16 (D6) — the chosen generation, else the newest on disk, is validated
  // BEFORE any write happens. Fail closed: a generation with no readable
  // snapshot throws, naming the requested number AND the generations that DO
  // exist — no project.json write, no lock file, no history entry, phase not
  // flipped (declared-data-fails-open is exactly the antipattern this guards
  // against; it must never silently lock something else).
  const existing = listExistingGenerationNumbers(input.projectRoot, input.sessionId);
  const generation = status.selectedGeneration ?? existing[existing.length - 1];
  if (generation === undefined) {
    throw new Error('demo-builder runner: cannot lock — no generation on disk. Generate a demo before locking.');
  }
  const genSegs = [DEMO_KIND_DIR, input.sessionId, GENERATIONS_DIRNAME, String(generation)];
  // SEC-04 leaf: resolve the snapshot leaves under the session dir through the
  // guard (leaf included) — a symlinked snapshot slot collapses to null, the
  // same no-oracle answer as absent.
  const snapshotDemoPath = guardedFile(input.projectRoot, [...genSegs, GENERATION_DEMO_FILENAME], 'read');
  const declarationRaw = guardedReadFile(input.projectRoot, [...genSegs, GENERATION_DECLARATION_FILENAME]);
  if (snapshotDemoPath === null || declarationRaw === null) {
    throw new Error(
      `demo-builder runner: cannot lock — generation ${generation} has no readable snapshot at ` +
      `${join(sessionDir, GENERATIONS_DIRNAME, String(generation))}. Generations on disk: ${existing.length > 0 ? existing.join(', ') : '(none)'}.`,
    );
  }

  // Bead forge-mfv5.2.8 — the declaration is refused HERE, with the drive
  // rule's own words, when it could not drive a checkpoint: the same rule
  // `forge preflight`'s DEMO-SKILL clause applies, so a lock never writes a
  // declaration preflight then reports as undrivable. Nothing is written.
  let parsed: unknown;
  try {
    parsed = JSON.parse(declarationRaw);
  } catch (err) {
    throw new Error(`demo-builder runner: cannot lock — generation ${generation}'s declaration is not JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const declaration = validateDemoDeclaration(parsed);
  if (!declaration.ok) {
    throw new Error(`demo-builder runner: cannot lock — generation ${generation}'s declaration is refused: ${declaration.reason}`);
  }

  // Read BEFORE the writes, or a re-lock looks like a creation (#663's shape:
  // a write that MODIFIES cannot appear in a created-list by construction).
  // GUARDED, not `existsSync`: `project_repo_path` is request-derived and
  // `check-request-path-sinks` refuses the bare form. `guardedFile(root,
  // segments, 'read')` is null for absent OR unresolvable, which is the same
  // existence answer with the root contained.
  const configExisted = guardedFile(status.project_repo_path, PROJECT_CONFIG_REL_PATH.split('/'), 'read') !== null;
  const lockExisted = guardedFile(status.project_repo_path, ['.forge', 'demo', 'demo.lock.json'], 'read') !== null;
  const demoExisted = guardedFile(status.project_repo_path, DEMO_HTML_REL_PATH.split('/'), 'read') !== null;

  // The ONE project.json writer — every other key survives as it was.
  writeProjectConfigPatch(
    status.project_repo_path,
    () => ({ demoProcess: declaration.steps }),
    `forge-studio: demo declaration (session ${status.session_id})`,
  );

  mkdirSync(join(status.project_repo_path, DEMO_REL_DIR), { recursive: true });
  const demoPath = join(status.project_repo_path, DEMO_HTML_REL_PATH);
  writeFileSync(demoPath, readFileSync(snapshotDemoPath));
  const lockPath = join(status.project_repo_path, DEMO_LOCK_REL_PATH);
  const lock = {
    session_id: status.session_id,
    project: status.project,
    prompt: status.prompt,
    iterations: status.iteration,
    // The declaration this lock wrote into `.forge/project.json` demoProcess —
    // recorded so the locked demo stays reproducible from its own record.
    declaration: declaration.steps,
    demo_html: DEMO_HTML_REL_PATH,
    // R4-16 (D6) — the generation actually locked, never attributed from
    // status.iteration (a field that happens to be a number is not the same
    // thing as "the chosen generation").
    generation,
    locked_at: status.updated_at,
  };
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  // Archive this locked demo into history/<sessionId>/ so previous demos remain
  // viewable — the latest stays at .forge/demo/DEMO.html, each lock is snapshotted.
  const histDir = join(status.project_repo_path, DEMO_HISTORY_REL_DIR, status.session_id);
  mkdirSync(histDir, { recursive: true });
  writeFileSync(join(histDir, 'DEMO.html'), readFileSync(demoPath, 'utf8'));
  writeFileSync(join(histDir, 'meta.json'), `${JSON.stringify(lock, null, 2)}\n`);

  // forge-qm4d's EIGHTH writer, undeclared until S1 run 7 because no run had
  // ever REACHED this step: it throws without a DEMO.html, which the write
  // pass could not produce until #666. The `log` event below names two of
  // these paths already, but the containment fence reads `file_change` and a
  // write tool's refs by name — a path appearing in a log is not evidence the
  // run wrote it. `logger` is the SESSION's: handed none,
  // `emitGroundFileChanges` opens a bridge run and the fence stays green with
  // the wrong author recorded. forge-mfv5.2.8 added `.forge/project.json`
  // (the declaration) and the restored DEMO.html to what this step writes.
  const lockCause = `demo-builder lock (session ${status.session_id})`;
  const emit = (relPaths: string[], op: 'write' | 'modify') =>
    emitGroundFileChanges({ forgeRoot: plumbing.forgeRoot, cause: lockCause, projectRoot: status.project_repo_path, relPaths, op, logger });
  emit([PROJECT_CONFIG_REL_PATH], configExisted ? 'modify' : 'write');
  emit([DEMO_HTML_REL_PATH], demoExisted ? 'modify' : 'write');
  emit([DEMO_LOCK_REL_PATH], lockExisted ? 'modify' : 'write');
  // `history/<sessionId>/` is per-session, so these two are always creations —
  // stated as a fact about the path, not assumed from the lock's own op.
  emit([
    `${DEMO_HISTORY_REL_DIR}/${status.session_id}/DEMO.html`,
    `${DEMO_HISTORY_REL_DIR}/${status.session_id}/meta.json`,
  ], 'write');

  // W7-C2 T1 review (P0-4, sessions-kinds-36) — the permanent "what this
  // session produced" pointer (see instructions-runner's own note for why
  // all five finalizing kinds now write one). A locked demo IS the project's
  // declaration + .forge/demo/demo.lock.json, so the pointer names the
  // PROJECT; the shell route derives whether that lock is still on disk.
  writeStatus({
    ...status,
    phase: 'locked',
    finalized: { kind: 'demo', id: status.project },
  });

  logger.emit({
    initiative_id: initiativeId, phase: 'demo', skill: 'demo-builder-runner',
    event_type: 'log', input_refs: [snapshotDemoPath], output_refs: [join(status.project_repo_path, PROJECT_CONFIG_REL_PATH), lockPath, join(histDir, 'DEMO.html')],
    message: `demo-locked (generation ${generation}: ${declaration.steps.length} declared step(s) written to demoProcess; snapshotted to history)`,
    metadata: { session_id: input.sessionId, lock_path: lockPath, history_dir: histDir, generation },
  });

  return { phase: 'locked', wrote: [join(status.project_repo_path, PROJECT_CONFIG_REL_PATH), lockPath, join(histDir, 'DEMO.html')], lockPath };
}

// W6-B1 review round 2 removed this file's local makeReasoningSink/
// makeThinkingSink duplicates in favour of the shared pair. The M4 ruling-60
// port took the next step: the sinks are BUILT by kind-turn.ts and arrive on
// `plumbing`, so this file neither declares nor constructs them.

// ---------------------------------------------------------------------------
// The generic session-affordance WRITE arms for this kind (M4 row 37 carve).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// question-form — demo (the briefing phase: operator brief -> generating).
// Mirrored the bespoke `POST /api/demo-builder/brief` at W6-B10 (that route
// is now deleted — row 206 sweep, forge-8vfn.8.5.56, no forge-ui caller —
// this is the only write path for this phase today). W6-B10 —
// added alongside `studio/session-kinds.yaml`'s new `briefing` row (that
// file's own comment explains why the row was missing until now: every demo
// session is minted straight into `briefing`, so without this handler a
// session opened on the dedicated `/sessions/demo/<sid>` screen could never
// get the agent started). Reuses `answersCapReason`'s shape/size validation
// (instructions' own guard, generic over any `answers[]` body) rather than a
// second, hand-kept copy; a brief is a single free-text note, so only the
// FIRST answer's `.answer` field is read — the client always sends one
// (`SessionInteractivePanel`'s question-form box), and `question` is
// discarded (there is no real "question" here, unlike an interview round).
// ---------------------------------------------------------------------------
export async function handleDemoBrief(
  ctx: AffordanceRouteContext,
  res: ServerResponse,
  origin: string,
  projectsRoot: string,
  dirSegs: readonly string[],
  status: Record<string, unknown>,
  project: string,
  sessionId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const parsed = readAnswersBody(body, true);
  if ('error' in parsed) {
    sendJson(res, 400, { error: parsed.error }, origin);
    return;
  }
  const brief = parsed.answers[0].answer;

  // Row 206 part (a) — claim BEFORE either write below: a refused dispatch
  // must leave prompt.md/status.json untouched. SYNC INVARIANT: no await
  // between the caller's status read and either write — see this file's
  // header note.
  ctx.claimAgentTurnSlot(ctx.forgeRoot, 'demo-builder', sessionId);
  if (
    guardedWriteFile(projectsRoot, [...dirSegs, 'prompt.md'], brief) === null ||
    guardedWriteSessionStatus(projectsRoot, dirSegs, { ...status, phase: 'generating', iteration: 1, prompt: brief }) === null
  ) {
    sendJson(res, 400, { error: 'invalid session path', sessionId }, origin);
    return;
  }
  ctx.spawnClaimedAgentTurn(ctx.forgeRoot, 'demo-builder', project, sessionId);
  ctx.broadcastKindChanged('demo');
  sendJson(res, 200, { ok: true, phase: 'generating', ...affordanceDryBridgeMarker(ctx, sessionId) }, origin);
}

// ---------------------------------------------------------------------------
// verdict — demo (approve => lock; reject => abandon). Mirrors
// `POST /api/demo-builder/lock` / `POST /api/demo-builder/abandon`
// (`apps/forge/ui-bridge.ts:4618`/`4661`).
// ---------------------------------------------------------------------------

export async function handleDemoVerdict(
  ctx: AffordanceRouteContext,
  res: ServerResponse,
  origin: string,
  projectsRoot: string,
  dirSegs: readonly string[],
  status: Record<string, unknown>,
  project: string,
  sessionId: string,
  verdict: 'approve' | 'reject',
  body: Record<string, unknown>,
): Promise<void> {
  // SYNC INVARIANT: no await between the caller's status read and either
  // write below — an await here reopens the double-spawn race; see
  // kb-cleanup's now-fixed `approveKbCleanup` (packages/knowledge/bridge-studio-kbs.ts) —
  // this file's header note.
  if (verdict === 'reject') {
    ctx.claimAgentTurnSlot(ctx.forgeRoot, 'demo-builder', sessionId);
    if (guardedWriteSessionStatus(projectsRoot, dirSegs, { ...status, phase: 'abandoned' }) === null) {
      sendJson(res, 400, { error: 'invalid session path', sessionId }, origin);
      return;
    }
    ctx.spawnClaimedAgentTurn(ctx.forgeRoot, 'demo-builder', project, sessionId);
    ctx.broadcastKindChanged('demo');
    sendJson(res, 200, { ok: true, phase: 'abandoned', ...affordanceDryBridgeMarker(ctx, sessionId) }, origin);
    return;
  }

  // approve => lock. `generation` mirrors the bespoke lock route's own
  // structural validation (integer >= 1) BEFORE any write.
  const hasGeneration = Object.prototype.hasOwnProperty.call(body, 'generation') && body.generation !== undefined;
  if (hasGeneration && !(typeof body.generation === 'number' && Number.isInteger(body.generation) && (body.generation as number) >= 1)) {
    sendJson(res, 400, { error: `generation must be an integer >= 1, got ${JSON.stringify(body.generation)}` }, origin);
    return;
  }
  ctx.claimAgentTurnSlot(ctx.forgeRoot, 'demo-builder', sessionId);
  if (
    guardedWriteSessionStatus(projectsRoot, dirSegs, {
      ...status,
      phase: 'locking',
      ...(hasGeneration ? { selectedGeneration: body.generation as number } : {}),
    }) === null
  ) {
    sendJson(res, 400, { error: 'invalid session path', sessionId }, origin);
    return;
  }
  ctx.spawnClaimedAgentTurn(ctx.forgeRoot, 'demo-builder', project, sessionId);
  ctx.broadcastKindChanged('demo');
  sendJson(res, 200, { ok: true, phase: 'locking', ...affordanceDryBridgeMarker(ctx, sessionId) }, origin);
}
