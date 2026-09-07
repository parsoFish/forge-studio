/**
 * The `demo` session kind — a registered step-handler variant (ADR 043 as
 * amended 2026-09-03, M4 ruling 60).
 *
 * Builds a project's demo: an agent authors demo machinery and DEMO.html into
 * the project repo, the operator reviews it, and an approved generation is
 * locked with a snapshot.
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
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';


import {
  runKindTurn,
  type KindTurnInput,
  type KindTurnPlumbing,
  type SessionKindVariant,
} from './kind-turn.ts';
import { guardedFile, guardedWriteFile, sendJson } from '@forge/kernel';
import { guardedWriteSessionStatus } from '../session-status-io.ts';
import {
  DEMO_HISTORY_REL_DIR,
  DEMO_REL_DIR,
  DEMO_HTML_REL_PATH,
  DEMO_KIND_DIR,
  DEMO_LOCK_REL_PATH,
  DEMO_SKILL_REL_PATH,
  GENERATIONS_DIRNAME,
  GENERATION_DEMO_FILENAME,
  GENERATION_SKILL_FILENAME,
  listExistingGenerationNumbers,
  readGenerationSnapshotMeta,
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
import { ensureStudioBranch, commitStudioChange } from '@forge/projects/project-repo-tx.ts';
import { modelForSpec } from '@forge/agents/phase-agent.ts';
import { deriveAgentSpec } from '@forge/agents/studio/derive.ts';
import { skillPathRelative, SLUG_RE } from '@forge/agents/skill-path.ts';

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
 */
async function withStudioRepo<T>(
  status: DemoBuilderStatus,
  run: () => Promise<T> | T,
): Promise<T> {
  try { ensureStudioBranch(status.project_repo_path); } catch { /* non-git project */ }
  try {
    return await run();
  } finally {
    try {
      commitStudioChange(status.project_repo_path, `forge-studio: demo machinery (${status.phase})`);
    } catch { /* best-effort */ }
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
// Lock step — deterministic: record the locked demo for reproducibility
// ---------------------------------------------------------------------------

function runLockStep(args: {
  input: RunDemoBuilderTurnInput;
  status: DemoBuilderStatus;
  plumbing: KindTurnPlumbing;
  writeStatus: (next: DemoBuilderStatus) => void;
}): RunDemoBuilderTurnResult {
  const { input, status, plumbing, writeStatus } = args;
  const { logger, initiativeId, sessionDir } = plumbing;

  // R4-16 pin 2 (Finding C) — set only when THIS lock actually restored a
  // generation's snapshot; then it names the skill THAT generation recorded,
  // never the hardcoded composer path. Left null for an unselected lock
  // (behaviour unchanged — falls back to DEMO_SKILL_REL_PATH below, exactly
  // as before this fix).
  let restoredSkillRelPath: string | null = null;

  // R4-16 (D6) — a chosen generation is validated and restored BEFORE any
  // write happens. Fail closed: a selectedGeneration naming a missing or
  // unparsable snapshot throws, naming the requested number AND the
  // generations that DO exist — no lock file, no history entry, phase not
  // flipped, repo files untouched (declared-data-fails-open is exactly the
  // antipattern this guards against; it must never silently lock the latest).
  if (status.selectedGeneration !== undefined) {
    const genSegs = [DEMO_KIND_DIR, input.sessionId, GENERATIONS_DIRNAME, String(status.selectedGeneration)];
    const meta = readGenerationSnapshotMeta(input.projectRoot, input.sessionId, status.selectedGeneration);
    const genDir = join(sessionDir, GENERATIONS_DIRNAME, String(status.selectedGeneration));
    // SEC-04 leaf: resolve the snapshot leaves under the session dir through the
    // guard (leaf included) — a symlinked snapshot slot collapses to null, the
    // same no-oracle answer as absent.
    const snapshotDemoPath = guardedFile(input.projectRoot, [...genSegs, GENERATION_DEMO_FILENAME], 'read');
    const snapshotSkillPath = guardedFile(input.projectRoot, [...genSegs, GENERATION_SKILL_FILENAME], 'read');
    if (meta === null || snapshotDemoPath === null || snapshotSkillPath === null) {
      const existing = listExistingGenerationNumbers(input.projectRoot, input.sessionId);
      throw new Error(
        `demo-builder runner: cannot lock — generation ${status.selectedGeneration} has no readable/parsable snapshot at ` +
        `${genDir}. Generations on disk: ${existing.length > 0 ? existing.join(', ') : '(none)'}.`,
      );
    }

    // R4-16 pin 2 (Finding B) — `meta.skillRelPath` is a WRITE target read
    // back off disk (a generation's own meta.json, which — per AT-43..45 — a
    // compromised agent turn or an operator-facing bug could smuggle a
    // malicious value into). An ALLOWLIST, never a ".." blocklist: a
    // blocklist would still admit an absolute-shaped path with zero ".."
    // segments (AT-44), and neither an allowlist nor a blocklist alone stops
    // a path that LEXICALLY matches the legitimate shape but resolves
    // through a symlinked directory (AT-45) — hence the realpath containment
    // check right after.
    if (!isAllowedSkillRelPath(meta.skillRelPath)) {
      throw new Error(
        `demo-builder runner: cannot lock — generation ${status.selectedGeneration}'s skillRelPath "${meta.skillRelPath}" ` +
        `is not an allowed write target (must be "${DEMO_SKILL_REL_PATH}" or match ".forge/skills/demo/<slug>/SKILL.md") — refusing to write anywhere.`,
      );
    }
    const destSkillPath = join(status.project_repo_path, meta.skillRelPath);
    let realRepoRoot: string;
    try {
      realRepoRoot = realpathSync(status.project_repo_path);
    } catch {
      throw new Error(
        `demo-builder runner: cannot lock — project repo "${status.project_repo_path}" could not be resolved to verify write containment.`,
      );
    }
    if (!closestExistingAncestorContained(dirname(destSkillPath), realRepoRoot)) {
      throw new Error(
        `demo-builder runner: cannot lock — generation ${status.selectedGeneration}'s skillRelPath "${meta.skillRelPath}" ` +
        'resolves outside the project repo (a symlinked directory along its path) — refusing to write.',
      );
    }

    mkdirSync(dirname(destSkillPath), { recursive: true });
    mkdirSync(join(status.project_repo_path, DEMO_REL_DIR), { recursive: true });
    writeFileSync(join(status.project_repo_path, DEMO_HTML_REL_PATH), readFileSync(snapshotDemoPath));
    writeFileSync(destSkillPath, readFileSync(snapshotSkillPath));
    restoredSkillRelPath = meta.skillRelPath;
  }

  const demoPath = join(status.project_repo_path, DEMO_HTML_REL_PATH);
  if (!existsSync(demoPath)) {
    throw new Error(
      `demo-builder runner: cannot lock — no ${DEMO_HTML_REL_PATH} in the repo. Generate a demo before locking.`,
    );
  }
  // R4-16 pin 2 (Finding C) — the generator this lock actually restored
  // (per-element or composer), never a hardcoded composer-path check that
  // ignores which skill this generation used. `restoredSkillRelPath` is null
  // only when no generation was selected this lock (unchanged fallback).
  const demoSkillRelPathForLock = restoredSkillRelPath ?? DEMO_SKILL_REL_PATH;
  const demoSkillAbsPathForLock = join(status.project_repo_path, demoSkillRelPathForLock);
  const lockPath = join(status.project_repo_path, DEMO_LOCK_REL_PATH);
  const lock = {
    session_id: status.session_id,
    project: status.project,
    prompt: status.prompt,
    iterations: status.iteration,
    // The locked, reproducible generator — future cycles run it per completed
    // initiative to render a before/after demo of that initiative's changes.
    // null only if the generator this lock actually names genuinely is not
    // on disk (never fabricated, never a stale/unrelated generator's path).
    demo_skill: existsSync(demoSkillAbsPathForLock) ? demoSkillRelPathForLock : null,
    demo_html: DEMO_HTML_REL_PATH,
    // R4-16 (D6) — the CHOSEN generation, never attributed from
    // status.iteration (a field that happens to be a number is not the same
    // thing as "the chosen generation"). null when nothing was chosen.
    generation: status.selectedGeneration ?? null,
    locked_at: status.updated_at,
  };
  if (!existsSync(join(status.project_repo_path, DEMO_REL_DIR))) {
    mkdirSync(join(status.project_repo_path, DEMO_REL_DIR), { recursive: true });
  }
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  // Archive this locked demo into history/<sessionId>/ so previous demos remain
  // viewable — the latest stays at .forge/demo/DEMO.html, each lock is snapshotted.
  const histDir = join(status.project_repo_path, DEMO_HISTORY_REL_DIR, status.session_id);
  mkdirSync(histDir, { recursive: true });
  writeFileSync(join(histDir, 'DEMO.html'), readFileSync(demoPath, 'utf8'));
  writeFileSync(join(histDir, 'meta.json'), `${JSON.stringify(lock, null, 2)}\n`);

  // W7-C2 T1 review (P0-4, sessions-kinds-36) — the permanent "what this
  // session produced" pointer (see instructions-runner's own note for why
  // all five finalizing kinds now write one). A locked demo IS the project's
  // .forge/demo/demo.lock.json, so the pointer names the PROJECT; the shell
  // route derives whether that lock is still on disk.
  writeStatus({
    ...status,
    phase: 'locked',
    finalized: { kind: 'demo', id: status.project },
  });

  logger.emit({
    initiative_id: initiativeId, phase: 'demo', skill: 'demo-builder-runner',
    event_type: 'log', input_refs: [demoPath], output_refs: [lockPath, join(histDir, 'DEMO.html')],
    message: 'demo-locked (snapshotted to history; machinery reproducible in the repo)',
    metadata: { session_id: input.sessionId, lock_path: lockPath, history_dir: histDir },
  });

  return { phase: 'locked', wrote: [lockPath, join(histDir, 'DEMO.html')], lockPath };
}
/** R4-16 pin 2 (Finding B) — the ONLY two shapes `readGenerationSnapshotMeta`'s
 *  `skillRelPath` may ever legitimately carry, because they are the only two
 *  shapes the runner ITSELF ever writes there (see `runGenerateStep`'s
 *  `requiredSkillRel`): the fixed composer path, or a per-element path whose
 *  slug matches the SAME `SLUG_RE` forge's own demo-element library ids use
 *  (`elementSkillRelPath` above). An allowlist, not a ".." blocklist — see
 *  `isAllowedSkillRelPath`'s call site for why a blocklist is insufficient.
 *  `SLUG_RE.source` carries its OWN `^`/`$` anchors (it is normally matched
 *  standalone against a whole slug) — stripped here before splicing into a
 *  larger pattern, since an embedded mid-pattern `^`/`$` would anchor to the
 *  position 0 / end of the ENTIRE tested string, not the slug segment, and
 *  silently reject every legitimate input. */
const SLUG_SEGMENT_SOURCE = SLUG_RE.source.replace(/^\^/, '').replace(/\$$/, '');
const ELEMENT_SKILL_REL_PATH_RE = new RegExp(`^\\.forge/skills/demo/(?:${SLUG_SEGMENT_SOURCE})/SKILL\\.md$`);

function isAllowedSkillRelPath(relPath: string): boolean {
  return relPath === DEMO_SKILL_REL_PATH || ELEMENT_SKILL_REL_PATH_RE.test(relPath);
}

/** R4-16 pin 2 (Finding B) — belt-and-braces beyond the allowlist above: a
 *  `skillRelPath` can lexically match the legitimate shape and STILL resolve
 *  outside the repo if some directory along its path is a symlink to an
 *  outside location (AT-45 — the allowlist only proves the path STRING's
 *  shape, never where it resolves). Walks up from `dir` to the closest
 *  EXISTING ancestor — the allowlist already forbids ".." and absolute paths,
 *  so once that ancestor is verified contained, the remaining NEW segments
 *  are plain literal directory names, not symlinks — and verifies THAT
 *  ancestor's realpath stays inside `repoRealPath`. Fails closed (false) if
 *  no ancestor can be resolved at all.
 *
 *  Honest limit (R4-16 round 2), same trust tier as the TOCTOU residual
 *  documented in `packages/sessions/studio/session-transcript.ts`'s header — read
 *  that first; this follows the same disclosure shape (mechanism, trust
 *  tier, why accepted). This check and the `mkdirSync`/`writeFileSync` calls
 *  it gates (this function's caller, above) are separate syscalls, not one
 *  atomic operation: "cannot escape" above describes the segments as they
 *  are checked, not a guarantee that holds across time. An attacker able to
 *  race a symlink into one of those NEW segments in the gap between this
 *  check returning `true` and the write actually landing defeats
 *  containment. Accepted, not fixed, on the same basis as
 *  session-transcript.ts's TOCTOU note: mounting that race requires the same
 *  local write access inside the project repo that would let an attacker
 *  write the outside content in directly, so closing it (e.g. holding an
 *  open directory file descriptor from `mkdir` instead of re-resolving paths
 *  by name) buys negligible additional protection for real implementation
 *  cost. */
function closestExistingAncestorContained(dir: string, repoRealPath: string): boolean {
  let candidate = dir;
  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) return false;
    candidate = parent;
  }
  let real: string;
  try {
    real = realpathSync(candidate);
  } catch {
    return false;
  }
  return real === repoRealPath || real.startsWith(repoRealPath + sep);
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
// Mirrors `POST /api/demo-builder/brief` (`apps/forge/ui-bridge.ts:4623`). W6-B10 —
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

  // SYNC INVARIANT: no await between the caller's status read and either
  // write below — see this file's header note.
  if (
    guardedWriteFile(projectsRoot, [...dirSegs, 'prompt.md'], brief) === null ||
    guardedWriteSessionStatus(projectsRoot, dirSegs, { ...status, phase: 'generating', iteration: 1, prompt: brief }) === null
  ) {
    sendJson(res, 400, { error: 'invalid session path', sessionId }, origin);
    return;
  }
  ctx.spawnAgentTurn(ctx.forgeRoot, 'demo-builder', project, sessionId);
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
    if (guardedWriteSessionStatus(projectsRoot, dirSegs, { ...status, phase: 'abandoned' }) === null) {
      sendJson(res, 400, { error: 'invalid session path', sessionId }, origin);
      return;
    }
    ctx.spawnAgentTurn(ctx.forgeRoot, 'demo-builder', project, sessionId);
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
  ctx.spawnAgentTurn(ctx.forgeRoot, 'demo-builder', project, sessionId);
  ctx.broadcastKindChanged('demo');
  sendJson(res, 200, { ok: true, phase: 'locking', ...affordanceDryBridgeMarker(ctx, sessionId) }, origin);
}
