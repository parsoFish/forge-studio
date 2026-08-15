/**
 * Forge Studio generic session-affordance WRITE endpoint (W6-B4, ADR-043
 * `docs/decisions/043-generic-interactive-surface.md`'s 2026-08-15 amendment
 * §1 — the un-deferral of the original §Consequences paragraph, "A future
 * generic `POST …/sessions/:kind/:sessionId/:affordance` write endpoint …
 * is out of the bridge").
 *
 * Owns the ONE route:
 *
 *   POST /api/studio/sessions/:kind/:sessionId/:affordance
 *     { project, ...per-affordance-kind body }
 *     → 200 { ok: true, ... }
 *     | 501 UnhandledAffordanceBody   (a validly-derived affordance this
 *                                      route has no write handler for)
 *     | 4xx/5xx { error }
 *
 * `:affordance` is one of `deriveSessionAffordances(descriptor,
 * currentPhase)`'s (`orchestrator/studio/session-kinds.ts`) derived `id`s —
 * `${phase}-${kind}` — NEVER an authored value; a stale/forged affordance id
 * a client remembered from a PRIOR phase 409s here exactly as a
 * phase-inappropriate one does, because availability is recomputed from the
 * session's CURRENT on-disk phase on every call (ADR-043 2026-08-15
 * amendment §1: "deriving availability from the live phase means a stale
 * client can't fire a phase-inappropriate write").
 *
 * ---------------------------------------------------------------------------
 * RESOLUTION CHAIN (every step fails LOUD, per the task brief; mirrors
 * `cli/bridge-studio-sessions.ts`'s GET sibling's own chain almost exactly —
 * this route reuses its exported `invalidProjectReason` rather than
 * re-deriving the KB-seeding-anchor carve-out):
 *
 *   1. `kind` → `loadSessionKinds` descriptor lookup. Unknown → 404, naming
 *      the offending value + the allowed set.
 *   2. `sessionId` → the `isSafeRunId` ratchet (`orchestrator/run-agent.ts`)
 *      FIRST (cheap, pre-fs), THEN `resolveGuardedPath` containment
 *      (`cli/studio-path-guard.ts`) — per the task brief's explicit
 *      instruction ("every path through the resolveGuardedPath/guardedReadDir
 *      choke point with the isSafeRunId ratchet"). Both collapse to the SAME
 *      404 `{error:'session not found'}` — no distinguishing signal between
 *      "malformed id", "well-formed but escaping", and "well-formed,
 *      contained, but absent" ever reaches the client (mirrors the GET
 *      route's own no-oracle discipline).
 *   3. `affordance` → must be one of `deriveSessionAffordances(descriptor,
 *      status.phase)`'s ids. Not present → 409, naming the offending
 *      affordance id + the CURRENTLY-available set (never the full
 *      registry — the whole point is phase-scoped availability).
 *   4. body → validated per the MATCHED affordance's `kind`
 *      (`question-form` | `verdict`), then per session `kind` within that —
 *      see the per-kind handlers below. Anything this switch does not
 *      explicitly wire (an out-of-scope `verdict` value, or the read-only
 *      `staged-review`/`next-turn` affordance kinds, which have no operator
 *      WRITE action at all — they describe what an `agent` step already did,
 *      not something to trigger) falls through to `UnhandledAffordanceBody`
 *      — 501, naming the affordance kind + the session kind + the phase.
 *      Never a silent 200, never a misrouted write into a DIFFERENT kind's
 *      handler.
 *
 * DELEGATION (task brief: "DELEGATE to the same underlying write+spawn
 * helpers where they exist rather than reimplement"):
 *   - Every status.json read/write goes through `guardedReadSessionStatus` /
 *     `guardedWriteSessionStatus` (`orchestrator/interactive-session.ts`) —
 *     the SAME primitives every bespoke per-kind route already uses.
 *   - `spawnAgentTurn` (`cli/ui-bridge.ts`, module-private there) is INJECTED
 *     via `AffordanceRouteContext.spawnAgentTurn`, not re-implemented and not
 *     imported directly — `bridge-studio-*.ts` modules never import FROM
 *     `ui-bridge.ts` (the one standing import-direction rule every sibling
 *     module already holds; `ui-bridge.ts` imports FROM them, never the
 *     other way — verified: no `bridge-studio*.ts` file imports
 *     `./ui-bridge.ts` anywhere in this repo). This mirrors the
 *     `ensureSessionTail` injection `SessionsRouteContext`
 *     (`cli/bridge-studio-sessions.ts`) already uses for the identical
 *     reason.
 *   - kb-cleanup's approve delegates to `enqueueConsolidate` +
 *     `runBrainConsolidateNow` (`cli/bridge-studio-kbs.ts`) — the SAME
 *     per-kbId-serialized drain `POST /api/studio/kbs/:id/cleanup/apply`
 *     already calls, imported directly (no cycle: `bridge-studio-kbs.ts`
 *     does not import this file or `ui-bridge.ts`).
 *   - authoring's approve delegates WHOLESALE to `runFinalize`
 *     (`cli/bridge-studio-authoring.ts`, exported for this file) — the
 *     entire `copyStagingToLibrary` + skill/hook-install sequence is far too
 *     security-sensitive to duplicate; this route validates the body shape
 *     and hands off, `runFinalize` sends its OWN response.
 *
 * SECURITY (mirrors `cli/bridge-studio-sessions.ts`'s own header — the part
 * reviewers attack hardest):
 *   - `project` is validated with `invalidProjectReason` (imported, not
 *     re-derived — keeps the KB-seeding dot-anchor carve-out defined in
 *     exactly one place) and `sessionId` with `isSafeRunId`, BOTH before any
 *     fs call.
 *   - The session dir is resolved via `resolveGuardedPath` — a per-segment
 *     IDENTITY walk, never a lexical `startsWith` check on an unresolved
 *     path.
 *   - A 404 for "unknown session" NEVER echoes the resolved path, and never
 *     distinguishes "escaping symlink" from "genuinely absent" — collapsing
 *     both keeps this route from being usable as a filesystem oracle.
 *   - `readJson`'s 1 MiB cap (`cli/bridge-studio.ts`) already refuses an
 *     oversized body before this route ever sees it; malformed JSON / a
 *     non-object body / a wrong-shaped per-affordance field is 400.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';

import { sendJson, allowedOrigin, sanitizeError, readJson, pathOnly, type StudioContext } from './bridge-studio.ts';
import { resolveGuardedPath, guardedReadFile, guardedWriteFile } from './studio-path-guard.ts';
import { defaultConfigPath, loadConfig, resolveProjectsDir } from '../orchestrator/config.ts';
import {
  loadSessionKinds,
  deriveSessionAffordances,
  type SessionKindDescriptor,
  type SessionAffordance,
  type SessionAffordanceKind,
} from '../orchestrator/studio/session-kinds.ts';
import { guardedReadSessionStatus, guardedWriteSessionStatus } from '../orchestrator/interactive-session.ts';
import { isSafeRunId } from '../orchestrator/run-agent.ts';
import { invalidProjectReason } from './bridge-studio-sessions.ts';
import { enqueueConsolidate, runBrainConsolidateNow } from './bridge-studio-kbs.ts';
import { runFinalize } from './bridge-studio-authoring.ts';

// ---------------------------------------------------------------------------
// UnhandledAffordanceBody — mirrors forge-ui's `UnhandledArtifactBody`
// (`forge-ui/components/studio/session/SessionArtifactPane.tsx`): an
// explicit, VISIBLE failure state for a value this route recognises as
// STRUCTURALLY valid (a real, currently-available affordance) but has no
// renderer/handler wired for — never a silent 200, never routed into a
// wrong-kind handler as a best guess. `UnhandledArtifactBody` is a React
// component taking `{kind, error}`; this is that same two-field shape as a
// JSON wire body (this route has no forge-ui surface to render into — B6
// consumes it; NO forge-ui changes ship in this batch).
// ---------------------------------------------------------------------------

export interface UnhandledAffordanceBody {
  readonly ok: false;
  readonly kind: SessionAffordanceKind;
  readonly error: string;
}

function unhandledAffordanceBody(kind: SessionAffordanceKind, error: string): UnhandledAffordanceBody {
  return { ok: false, kind, error };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/** The subset of `SpawnableAgentId` (`cli/ui-bridge.ts`) this route ever
 *  spawns a turn for — never `architect` (no writable affordance),
 *  `project-brain` (no verdict/question-form row in its panel), or
 *  `authoring` (its turn runs INSIDE `runFinalize`, not via a detached
 *  spawn). */
export type LegacySpawnableAgentId = 'instructions' | 'demo-builder';

export type AffordanceRouteContext = StudioContext & {
  /** Injected from `cli/ui-bridge.ts` — see this file's header for why this
   *  is dependency-injected rather than imported: delegates to the EXACT
   *  SAME `spawnAgentTurn` every bespoke per-kind route already calls, not a
   *  reimplementation. */
  spawnAgentTurn: (forgeRoot: string, agentId: LegacySpawnableAgentId, project: string, sessionId: string) => void;
  broadcastInstructionsChanged: () => void;
  broadcastDemoChanged: () => void;
};

// ---------------------------------------------------------------------------
// Route matching
// ---------------------------------------------------------------------------

const AFFORDANCE_ROUTE_RE = /^\/api\/studio\/sessions\/([^/]+)\/([^/]+)\/([^/]+)$/;

function decodeSegment(raw: string): string {
  return decodeURIComponent(raw);
}

/** Minimal `JSON.parse` wrapper — NOT a security primitive (no guard/write
 *  behaviour to delegate to; a bare `JSON.parse` around a value already read
 *  through `guardedReadFile`), so a local copy here is not "reimplementing a
 *  write+spawn helper" the task brief asks to delegate. */
function safeParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// question-form — instructions' interview-answer round
// (`awaiting-answers-question-form`, the ONLY `awaits:questions` row in the
// whole registry — mirrors `POST /api/instructions/answer`,
// `cli/ui-bridge.ts:3236`).
// ---------------------------------------------------------------------------

async function handleInstructionsAnswer(
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
  const answers = body.answers;
  if (
    !Array.isArray(answers) ||
    !answers.every((a) => a !== null && typeof a === 'object' && typeof (a as Record<string, unknown>).question === 'string' && typeof (a as Record<string, unknown>).answer === 'string')
  ) {
    sendJson(res, 400, { error: 'body.answers must be an array of {question: string, answer: string}' }, origin);
    return;
  }

  const priorRaw = guardedReadFile(projectsRoot, [...dirSegs, 'answers.json']);
  const prior = (priorRaw !== null ? safeParseJson<{ round: number; answers: unknown[] }[]>(priorRaw) : null) ?? [];
  const round = prior.length + 1;

  if (
    guardedWriteFile(projectsRoot, [...dirSegs, 'answers.json'], JSON.stringify([...prior, { round, answers }], null, 2)) === null ||
    guardedWriteSessionStatus(projectsRoot, dirSegs, { ...status, phase: 'interviewing', round: round + 1 }) === null
  ) {
    sendJson(res, 400, { error: 'invalid session path', sessionId }, origin);
    return;
  }

  ctx.spawnAgentTurn(ctx.forgeRoot, 'instructions', project, sessionId);
  ctx.broadcastInstructionsChanged();
  sendJson(res, 200, { ok: true, round }, origin);
}

// ---------------------------------------------------------------------------
// verdict — instructions (approve|reject only; "revise" stays on the bespoke
// `/api/instructions/verdict` route — out of the generic body schema the
// task brief scopes: "verdict: approve|reject").
// ---------------------------------------------------------------------------

async function handleInstructionsVerdict(
  ctx: AffordanceRouteContext,
  res: ServerResponse,
  origin: string,
  projectsRoot: string,
  dirSegs: readonly string[],
  status: Record<string, unknown>,
  project: string,
  sessionId: string,
  verdict: 'approve' | 'reject',
): Promise<void> {
  const nextPhase = verdict === 'approve' ? 'finalizing' : 'rejected';
  if (guardedWriteSessionStatus(projectsRoot, dirSegs, { ...status, phase: nextPhase }) === null) {
    sendJson(res, 400, { error: 'invalid session path', sessionId }, origin);
    return;
  }
  ctx.spawnAgentTurn(ctx.forgeRoot, 'instructions', project, sessionId);
  ctx.broadcastInstructionsChanged();
  sendJson(res, 200, { ok: true, phase: nextPhase }, origin);
}

// ---------------------------------------------------------------------------
// verdict — demo (approve => lock; reject => abandon). Mirrors
// `POST /api/demo-builder/lock` / `POST /api/demo-builder/abandon`
// (`cli/ui-bridge.ts:4618`/`4661`).
// ---------------------------------------------------------------------------

async function handleDemoVerdict(
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
  if (verdict === 'reject') {
    if (guardedWriteSessionStatus(projectsRoot, dirSegs, { ...status, phase: 'abandoned' }) === null) {
      sendJson(res, 400, { error: 'invalid session path', sessionId }, origin);
      return;
    }
    ctx.spawnAgentTurn(ctx.forgeRoot, 'demo-builder', project, sessionId);
    ctx.broadcastDemoChanged();
    sendJson(res, 200, { ok: true, phase: 'abandoned' }, origin);
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
  ctx.broadcastDemoChanged();
  sendJson(res, 200, { ok: true, phase: 'locking' }, origin);
}

// ---------------------------------------------------------------------------
// verdict — kb-cleanup (approve only; the turnSpec's `awaiting-approval` row
// deliberately declares no rejection semantics anywhere in this repo — see
// `studio/session-kinds.yaml`'s own comment on that row). Mirrors
// `POST /api/studio/kbs/:id/cleanup/apply` (`cli/ui-bridge.ts:4337`) MINUS
// the URL `:id` <-> `status.kb_id` equality check that route needs — THIS
// route carries no URL-supplied kb id at all (there is no `:id` segment in
// `/api/studio/sessions/:kind/:sessionId/:affordance`), so `status.kb_id` is
// the ONLY candidate value; the security invariant that route's own header
// documents ("the drain's SOLE source of truth is status.kb_id, never the
// URL") is satisfied by construction here, not by an extra check.
// ---------------------------------------------------------------------------

async function handleKbCleanupVerdict(
  ctx: AffordanceRouteContext,
  res: ServerResponse,
  origin: string,
  projectsRoot: string,
  dirSegs: readonly string[],
  status: Record<string, unknown>,
  phase: string,
  sessionId: string,
  project: string,
  verdict: 'approve' | 'reject',
): Promise<void> {
  if (verdict === 'reject') {
    sendJson(res, 422, { error: 'kb-cleanup supports only verdict "approve" — the awaiting-approval gate declares no rejection path' }, origin);
    return;
  }
  // Belt-and-suspenders (mirrors the bespoke apply route's own posture):
  // structurally guaranteed by the caller's affordance-membership check
  // (deriveSessionAffordances only ever derives THIS verdict at exactly
  // "awaiting-approval"), re-asserted here so a future registry change
  // cannot silently widen this to a phase the drain was never designed for.
  if (phase !== 'awaiting-approval') {
    sendJson(res, 409, { error: `session "${sessionId}" is not awaiting-approval (current phase: "${phase}")`, sessionId, project }, origin);
    return;
  }
  if (typeof status.kb_id !== 'string') {
    sendJson(res, 500, { error: `kb-cleanup apply: session "${sessionId}" status.json has no string "kb_id"` }, origin);
    return;
  }
  const kbId = status.kb_id;
  const runId = `${kbId}-consolidate-${Date.now().toString(36)}`;
  await enqueueConsolidate(kbId, () => runBrainConsolidateNow(ctx.forgeRoot, kbId, runId));

  const written = guardedWriteSessionStatus(projectsRoot, dirSegs, { ...status, phase: 'applied' });
  if (written === null) {
    sendJson(res, 500, { error: `kb-cleanup apply: status.json write for session "${sessionId}" failed containment` }, origin);
    return;
  }
  sendJson(res, 200, { ok: true, runId }, origin);
}

// ---------------------------------------------------------------------------
// verdict — authoring (approve only; delegates WHOLESALE to `runFinalize`).
// ---------------------------------------------------------------------------

async function handleAuthoringVerdict(
  ctx: AffordanceRouteContext,
  res: ServerResponse,
  origin: string,
  project: string,
  sessionId: string,
  verdict: 'approve' | 'reject',
  body: Record<string, unknown>,
): Promise<void> {
  if (verdict === 'reject') {
    sendJson(res, 422, { error: 'authoring supports only verdict "approve" — the awaiting-review gate declares no rejection path' }, origin);
    return;
  }
  const kind = body.kind;
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (kind !== 'skill' && kind !== 'hook') {
    sendJson(res, 400, { error: 'body.kind is required and must be "skill" or "hook"' }, origin);
    return;
  }
  if (!id) {
    sendJson(res, 400, { error: 'body.id is required' }, origin);
    return;
  }
  // runFinalize sends its OWN response (success and every failure path) —
  // this route hands off wholesale rather than reimplementing any part of
  // the copyStagingToLibrary + skill/hook-install sequence.
  await runFinalize(ctx, res, origin, { project, sessionId, kind, id });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleStudioAffordanceRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AffordanceRouteContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  if (method !== 'POST') return false;

  const url = pathOnly(rawUrl);
  const routeMatch = url.match(AFFORDANCE_ROUTE_RE);
  if (!routeMatch) return false;

  const origin = allowedOrigin(req);

  try {
    let kind: string;
    let sessionId: string;
    let affordanceId: string;
    try {
      kind = decodeSegment(routeMatch[1]);
      sessionId = decodeSegment(routeMatch[2]);
      affordanceId = decodeSegment(routeMatch[3]);
    } catch {
      sendJson(res, 400, { error: 'invalid session-affordance route — malformed URL encoding' }, origin);
      return true;
    }

    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { error: 'invalid or oversized JSON body' }, origin);
      return true;
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      sendJson(res, 400, { error: 'body must be a JSON object' }, origin);
      return true;
    }
    const b = body as Record<string, unknown>;

    const project = typeof b.project === 'string' ? b.project : '';
    const projectReason = invalidProjectReason(project);
    if (projectReason !== null) {
      sendJson(res, 400, { error: projectReason }, origin);
      return true;
    }

    // --- 1. kind -> registry lookup. Unknown -> 404. ---------------------
    let descriptors: SessionKindDescriptor[];
    try {
      descriptors = loadSessionKinds(ctx.forgeRoot);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
      return true;
    }
    const descriptor = descriptors.find((d) => d.id === kind);
    if (!descriptor) {
      const allowed = descriptors.map((d) => d.id).join(', ');
      sendJson(res, 404, { error: `unknown session kind "${kind}" — must be one of: ${allowed}` }, origin);
      return true;
    }

    // --- 2. sessionId -> isSafeRunId ratchet, THEN resolveGuardedPath. ----
    if (!isSafeRunId(sessionId)) {
      sendJson(res, 404, { error: 'session not found' }, origin);
      return true;
    }
    const projectsRoot = resolveProjectsDir(resolve(ctx.forgeRoot), loadConfig(defaultConfigPath(ctx.forgeRoot)));
    const kindDirName = `_${descriptor.id}`;
    const dirSegs = [project, kindDirName, sessionId];
    const sessionGuard = resolveGuardedPath(projectsRoot, dirSegs);
    if (!sessionGuard.ok || !sessionGuard.exists) {
      // Collapses "malformed", "escaping symlink", and "genuinely absent"
      // into one message — never a filesystem oracle.
      sendJson(res, 404, { error: 'session not found' }, origin);
      return true;
    }

    const status = guardedReadSessionStatus<Record<string, unknown>>(projectsRoot, dirSegs);
    if (!status || typeof status.phase !== 'string') {
      sendJson(res, 404, { error: 'session not found' }, origin);
      return true;
    }
    const phase = status.phase;

    // --- 3. affordance -> must be currently derivable for this phase. ----
    const affordances: SessionAffordance[] = deriveSessionAffordances(descriptor, phase);
    const affordance = affordances.find((a) => a.id === affordanceId);
    if (!affordance) {
      const available = affordances.map((a) => a.id).join(', ') || '(none)';
      sendJson(
        res,
        409,
        { error: `affordance "${affordanceId}" is not available for session "${sessionId}" (kind "${kind}") in phase "${phase}" — currently available: ${available}` },
        origin,
      );
      return true;
    }

    // --- 4. body -> per-affordance-kind schema, then per session kind. ---
    if (affordance.kind === 'question-form') {
      if (descriptor.id === 'instructions') {
        await handleInstructionsAnswer(ctx, res, origin, projectsRoot, dirSegs, status, project, sessionId, b);
        return true;
      }
      // Structurally unreachable today (instructions is the only descriptor
      // whose panel ever derives a question-form affordance) — fails LOUD
      // rather than silently guessing a handler if the registry ever grows a
      // second one.
      sendJson(res, 501, unhandledAffordanceBody(affordance.kind, `no question-form write handler is wired for session kind "${descriptor.id}"`), origin);
      return true;
    }

    if (affordance.kind === 'verdict') {
      const verdictRaw = b.verdict;
      if (verdictRaw !== 'approve' && verdictRaw !== 'reject') {
        sendJson(res, 400, { error: `body.verdict is required and must be "approve" or "reject", got ${JSON.stringify(verdictRaw)}` }, origin);
        return true;
      }
      const verdict = verdictRaw;
      switch (descriptor.id) {
        case 'instructions':
          await handleInstructionsVerdict(ctx, res, origin, projectsRoot, dirSegs, status, project, sessionId, verdict);
          return true;
        case 'demo':
          await handleDemoVerdict(ctx, res, origin, projectsRoot, dirSegs, status, project, sessionId, verdict, b);
          return true;
        case 'kb-cleanup':
          await handleKbCleanupVerdict(ctx, res, origin, projectsRoot, dirSegs, status, phase, sessionId, project, verdict);
          return true;
        case 'authoring':
          await handleAuthoringVerdict(ctx, res, origin, project, sessionId, verdict, b);
          return true;
        default:
          // Structurally unreachable today — the only descriptors whose
          // panel/turnSpec ever derive a verdict affordance are the four
          // above. Fails LOUD, never routes an unknown kind through one of
          // the four handlers as a best guess.
          break;
      }
    }

    // `staged-review` / `next-turn` (display-only — describe what an
    // `agent` step already wrote / where it advances to; there is no
    // operator WRITE action for either), or any affordance kind this switch
    // does not explicitly wire.
    sendJson(
      res,
      501,
      unhandledAffordanceBody(affordance.kind, `no write handler is wired for affordance kind "${affordance.kind}" on session kind "${descriptor.id}" (phase "${phase}")`),
      origin,
    );
    return true;
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
    return true;
  }
}
