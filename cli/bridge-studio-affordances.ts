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
 *   - kb-cleanup's approve delegates WHOLESALE to `approveKbCleanup`
 *     (`cli/bridge-studio-kbs.ts`) — the ONE atomic read-check-claim-drain-
 *     finish choreography `POST /api/studio/kbs/:id/cleanup/apply` ALSO now
 *     calls (imported directly; no cycle: `bridge-studio-kbs.ts` does not
 *     import this file or `ui-bridge.ts`). W6-B4 adversarial-review fix:
 *     this used to be duplicated, non-atomic choreography in BOTH routes —
 *     a check-then-await-then-write race, live-reproduced as two concurrent
 *     approves running two independent `runBrainConsolidateNow` drains. See
 *     `approveKbCleanup`'s own doc comment for the fix (a synchronous
 *     phase:'applying' claim written BEFORE the one `await`).
 *   - authoring's approve delegates WHOLESALE to `runFinalize`
 *     (`cli/bridge-studio-authoring.ts`, exported for this file) — the
 *     entire `copyStagingToLibrary` + skill/hook-install sequence is far too
 *     security-sensitive to duplicate; this route validates the body shape
 *     and hands off, `runFinalize` sends its OWN response. `runFinalize`
 *     independently re-reads status.json and writes its OWN atomic claim
 *     (`phase:'committing'`) before ITS one await, so it needed no change
 *     here — it already had the shape `approveKbCleanup` now also has.
 *
 * CONCURRENCY (SYNC INVARIANT, W6-B4 adversarial-review fix): the
 * instructions-answer / instructions-verdict / demo-verdict handlers below
 * are race-safe TODAY only because none of them contains an `await` between
 * their `guardedReadSessionStatus`/`status` read (done once, by the caller,
 * before dispatch) and their own `guardedWriteSessionStatus` write — two
 * concurrent requests can only interleave at an `await` boundary (Node's
 * single-threaded event loop never preempts a synchronous span), so a
 * handler with NO internal await runs its whole read-derived-write
 * atomically relative to any other request. This is accidental safety, not
 * a designed invariant: it is broken the moment anyone adds an `await`
 * between the read and the write (exactly how kb-cleanup's now-fixed race
 * was introduced). Each such handler below carries its own "SYNC INVARIANT"
 * comment naming this explicitly — do not add an await inside one without
 * either preserving the invariant or restructuring it onto
 * `approveKbCleanup`'s claim-then-await shape.
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
import { resolve, dirname } from 'node:path';

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
import { approveKbCleanup } from './bridge-studio-kbs.ts';
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

/** Hardening (W6-B4 adversarial-review round): `answers[]` is an
 *  operator-supplied array with no cap anywhere upstream of this route — an
 *  unbounded count or unbounded per-field size both reach `answers.json`
 *  (and the agent's next prompt, which inlines the whole interview
 *  transcript) unbounded. Caps are generous for any genuine interview round
 *  (a real round asks a handful of questions with paragraph-length answers)
 *  and named in the 400 they produce, never silently truncated. */
const MAX_ANSWERS_COUNT = 64;
const MAX_ANSWER_FIELD_BYTES = 8 * 1024;

function answersCapReason(answers: readonly { question: string; answer: string }[]): string | null {
  if (answers.length > MAX_ANSWERS_COUNT) {
    return `body.answers carries ${answers.length} entries — exceeds the ${MAX_ANSWERS_COUNT}-entry limit`;
  }
  for (const [i, a] of answers.entries()) {
    const qBytes = Buffer.byteLength(a.question, 'utf8');
    const aBytes = Buffer.byteLength(a.answer, 'utf8');
    if (qBytes > MAX_ANSWER_FIELD_BYTES) {
      return `body.answers[${i}].question is ${qBytes} bytes — exceeds the ${MAX_ANSWER_FIELD_BYTES}-byte limit`;
    }
    if (aBytes > MAX_ANSWER_FIELD_BYTES) {
      return `body.answers[${i}].answer is ${aBytes} bytes — exceeds the ${MAX_ANSWER_FIELD_BYTES}-byte limit`;
    }
  }
  return null;
}

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
  const answersRaw = body.answers;
  if (
    !Array.isArray(answersRaw) ||
    !answersRaw.every((a) => a !== null && typeof a === 'object' && typeof (a as Record<string, unknown>).question === 'string' && typeof (a as Record<string, unknown>).answer === 'string')
  ) {
    sendJson(res, 400, { error: 'body.answers must be an array of {question: string, answer: string}' }, origin);
    return;
  }
  const answers = answersRaw as { question: string; answer: string }[];
  const capReason = answersCapReason(answers);
  if (capReason !== null) {
    sendJson(res, 400, { error: capReason }, origin);
    return;
  }

  const priorRaw = guardedReadFile(projectsRoot, [...dirSegs, 'answers.json']);
  const prior = (priorRaw !== null ? safeParseJson<{ round: number; answers: unknown[] }[]>(priorRaw) : null) ?? [];
  const round = prior.length + 1;

  // SYNC INVARIANT: no await between this function's writes and the caller's
  // own status read above — an await here reopens the double-spawn race; see
  // kb-cleanup's now-fixed `approveKbCleanup` (cli/bridge-studio-kbs.ts) for
  // the shape a genuinely-awaited claim needs.
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
  // SYNC INVARIANT: no await between the caller's status read and this
  // write — see this file's header note.
  if (guardedWriteSessionStatus(projectsRoot, dirSegs, { ...status, phase: nextPhase }) === null) {
    sendJson(res, 400, { error: 'invalid session path', sessionId }, origin);
    return;
  }
  ctx.spawnAgentTurn(ctx.forgeRoot, 'instructions', project, sessionId);
  ctx.broadcastInstructionsChanged();
  sendJson(res, 200, { ok: true, phase: nextPhase }, origin);
}

// ---------------------------------------------------------------------------
// question-form — demo (the briefing phase: operator brief -> generating).
// Mirrors `POST /api/demo-builder/brief` (`cli/ui-bridge.ts:4623`). W6-B10 —
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
async function handleDemoBrief(
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
  const answersRaw = body.answers;
  if (
    !Array.isArray(answersRaw) ||
    answersRaw.length === 0 ||
    !answersRaw.every((a) => a !== null && typeof a === 'object' && typeof (a as Record<string, unknown>).question === 'string' && typeof (a as Record<string, unknown>).answer === 'string')
  ) {
    sendJson(res, 400, { error: 'body.answers must be a non-empty array of {question: string, answer: string}' }, origin);
    return;
  }
  const answers = answersRaw as { question: string; answer: string }[];
  const capReason = answersCapReason(answers);
  if (capReason !== null) {
    sendJson(res, 400, { error: capReason }, origin);
    return;
  }
  const brief = answers[0].answer;

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
  ctx.broadcastDemoChanged();
  sendJson(res, 200, { ok: true, phase: 'generating' }, origin);
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
  // SYNC INVARIANT: no await between the caller's status read and either
  // write below — an await here reopens the double-spawn race; see
  // kb-cleanup's now-fixed `approveKbCleanup` (cli/bridge-studio-kbs.ts) —
  // this file's header note.
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
  sessionId: string,
  project: string,
): Promise<void> {
  // W6-B6 post-merge review: the reject-422 that used to live here is now
  // the GENERIC gate in the main handler above, reading the SAME
  // `affordance.meta.verdicts` `studio/session-kinds.yaml`'s
  // `awaiting-approval` row declares (`verdicts: [approve]`) — this
  // function is only ever reached with `verdict === 'approve'` now, so it
  // no longer needs `verdict` as a parameter at all.
  //
  // Delegates WHOLESALE to `approveKbCleanup` (cli/bridge-studio-kbs.ts) —
  // the phase re-check (belt-and-suspenders on top of the caller's own
  // affordance-membership check AND the generic verdicts gate above), the
  // kb_id presence check, the ATOMIC phase:'applying' claim, the drain, and
  // the phase:'applied' write all live in exactly one place now, shared
  // with the bespoke `/cleanup/apply` route (W6-B4 adversarial-review fix —
  // this used to be duplicated, non-atomic choreography here).
  const outcome = await approveKbCleanup(ctx.forgeRoot, projectsRoot, dirSegs);
  if (!outcome.ok) {
    sendJson(res, outcome.status, { error: outcome.error, sessionId, project }, origin);
    return;
  }
  sendJson(res, 200, { ok: true, runId: outcome.runId }, origin);
}

// ---------------------------------------------------------------------------
// verdict — authoring (approve only; delegates WHOLESALE to `runFinalize`).
//
// NOT subject to this file's SYNC INVARIANT note (header): `runFinalize`
// does not reuse this file's caller-supplied `status` at all — it
// re-reads status.json ITSELF (`bridge-studio-authoring.ts` step 3) and
// writes its OWN atomic claim (`phase:'committing'`, step 4) synchronously
// before its one `await runInteractiveTurn(...)`, independent of whatever
// this dispatcher read earlier. It already had the claim-then-await shape
// `approveKbCleanup` (cli/bridge-studio-kbs.ts) was built to match — the
// W6-B4 adversarial-review fix generalised authoring's existing pattern to
// kb-cleanup, not the other way around.
// ---------------------------------------------------------------------------

async function handleAuthoringVerdict(
  ctx: AffordanceRouteContext,
  res: ServerResponse,
  origin: string,
  project: string,
  sessionId: string,
  body: Record<string, unknown>,
): Promise<void> {
  // W6-B6 post-merge review: same as handleKbCleanupVerdict above — the
  // reject-422 now happens generically, reading `affordance.meta.verdicts`
  // (`studio/session-kinds.yaml`'s `awaiting-review` row declares
  // `verdicts: [approve]`). Only ever reached with `verdict === 'approve'`.
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
// verdict — community-refresh (W6-CR-3). BOTH `approve` and `reject` are
// meaningful here — UNLIKE kb-cleanup/authoring, `studio/session-kinds.yaml`'s
// `community-refresh` row declares `verdicts: [approve, reject]` on its
// `awaiting-review` phase, because a refresh pass may propose changes the
// operator genuinely wants to discard, never touching the real registry.
//
// `reject` is a plain, SYNC-INVARIANT write (no await before it) straight to
// the `rejected` terminal phase — mirroring `handleDemoVerdict`'s own reject
// arm.
//
// `approve` is NOT subject to this file's SYNC INVARIANT note: it re-reads
// status.json ITSELF and writes its OWN atomic `phase:'committing'` claim
// BEFORE its one `await runInteractiveTurn(...)`, independent of whatever
// this dispatcher's caller read earlier — exactly the claim-then-await shape
// `handleAuthoringVerdict`/`runFinalize` (bridge-studio-authoring.ts)
// established. Inlined here (rather than a separate bespoke finalize route
// module) because `commitRegistryDraft` has no skill/hook-install-shaped
// complexity to warrant one — see that finalizer's own header
// (`orchestrator/interactive-finalizers.ts`).
// ---------------------------------------------------------------------------

async function handleCommunityRefreshVerdict(
  ctx: AffordanceRouteContext,
  res: ServerResponse,
  origin: string,
  projectsRoot: string,
  dirSegs: readonly string[],
  sessionId: string,
  verdict: 'approve' | 'reject',
): Promise<void> {
  if (verdict === 'reject') {
    // SYNC INVARIANT: no await between this function's own status read and
    // its write — see this file's header note.
    const status = guardedReadSessionStatus<Record<string, unknown>>(projectsRoot, dirSegs);
    if (!status) {
      sendJson(res, 404, { error: 'session not found', sessionId }, origin);
      return;
    }
    if (guardedWriteSessionStatus(projectsRoot, dirSegs, { ...status, phase: 'rejected' }) === null) {
      sendJson(res, 400, { error: 'invalid session path', sessionId }, origin);
      return;
    }
    sendJson(res, 200, { ok: true, phase: 'rejected' }, origin);
    return;
  }

  // approve => run the committing turn (commitRegistryDraft).
  const status = guardedReadSessionStatus<Record<string, unknown>>(projectsRoot, dirSegs);
  if (!status) {
    sendJson(res, 404, { error: 'session not found', sessionId }, origin);
    return;
  }
  if (status.phase !== 'awaiting-review') {
    sendJson(
      res,
      409,
      { error: `cannot commit: session is in phase "${status.phase}", required phase is "awaiting-review"` },
      origin,
    );
    return;
  }
  if (guardedWriteSessionStatus(projectsRoot, dirSegs, { ...status, phase: 'committing' }) === null) {
    sendJson(res, 500, { error: 'failed to advance session status to "committing"' }, origin);
    return;
  }
  const revert = (): void => {
    try {
      guardedWriteSessionStatus(projectsRoot, dirSegs, { ...status, phase: 'awaiting-review' });
    } catch {
      /* best-effort — see runFinalize's own revertToAwaitingReview note (bridge-studio-authoring.ts) */
    }
  };

  try {
    const descriptor = loadSessionKinds(ctx.forgeRoot).find((d) => d.id === 'community-refresh');
    if (!descriptor) {
      revert();
      sendJson(res, 500, { error: 'community-refresh session-kind descriptor not found' }, origin);
      return;
    }
    const sessionGuard = resolveGuardedPath(projectsRoot, dirSegs);
    if (!sessionGuard.ok || !sessionGuard.exists) {
      revert();
      sendJson(res, 404, { error: 'session not found', sessionId }, origin);
      return;
    }
    // sessionGuard.realPath === <projectsRoot realpath>/<anchor>/
    // _community-refresh/<sessionId> — the project root is the same value
    // with the trailing two segments stripped (mirrors runFinalize's own
    // derivation, bridge-studio-authoring.ts).
    const projectRoot = dirname(dirname(sessionGuard.realPath));

    // Dynamically imported so a static import never pulls the Claude Agent
    // SDK into bridge start-up (mirrors bridge-studio-authoring.ts's own
    // runFinalize / cli/agent-run.ts's project-brain-builder-runner
    // dynamic-import precedent).
    const { runInteractiveTurn } = await import('../orchestrator/interactive-runner.ts');
    const turnResult = await runInteractiveTurn(descriptor, { sessionId, projectRoot, forgeRoot: ctx.forgeRoot });
    if (turnResult.phase !== 'committed') {
      // Never report success on an unfinished turn.
      revert();
      sendJson(res, 500, { error: `commit turn did not reach phase "committed" (got "${turnResult.phase}")` }, origin);
      return;
    }
    sendJson(res, 200, { ok: true, phase: 'committed' }, origin);
  } catch (err) {
    revert();
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
  }
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
      // W6-B10: demo's own `briefing` row (studio/session-kinds.yaml).
      if (descriptor.id === 'demo') {
        await handleDemoBrief(ctx, res, origin, projectsRoot, dirSegs, status, project, sessionId, b);
        return true;
      }
      // Structurally unreachable today (instructions/demo are the only
      // descriptors whose panel/turnSpec ever derives a question-form
      // affordance) — fails LOUD rather than silently guessing a handler if
      // the registry ever grows a third one.
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

      // W6-B6 post-merge review: "which verdict values are legal for THIS
      // phase" is ONE business rule with ONE source — `deriveSessionAffordances`
      // (orchestrator/studio/session-kinds.ts) ALWAYS attaches it as
      // `affordance.meta.verdicts` (the row's authored `verdicts:` list, or
      // the ADR default `['approve','reject']`). This gate reads that SAME
      // derived value — it is no longer a hand-kept per-session-kind 422
      // table that could silently drift from the yaml (kb-cleanup/authoring
      // used to hardcode approve-only here; now `studio/session-kinds.yaml`
      // says so, once, and every consumer — this route AND the client panel
      // — reads it back).
      const allowedVerdicts = affordance.meta?.verdicts ?? ['approve', 'reject'];
      if (!allowedVerdicts.includes(verdict)) {
        sendJson(
          res,
          422,
          { error: `session kind "${descriptor.id}" does not support verdict "${verdict}" at phase "${phase}" — allowed: ${allowedVerdicts.join(', ')}` },
          origin,
        );
        return true;
      }

      switch (descriptor.id) {
        case 'instructions':
          await handleInstructionsVerdict(ctx, res, origin, projectsRoot, dirSegs, status, project, sessionId, verdict);
          return true;
        case 'demo':
          await handleDemoVerdict(ctx, res, origin, projectsRoot, dirSegs, status, project, sessionId, verdict, b);
          return true;
        case 'kb-cleanup':
          await handleKbCleanupVerdict(ctx, res, origin, projectsRoot, dirSegs, sessionId, project);
          return true;
        case 'authoring':
          await handleAuthoringVerdict(ctx, res, origin, project, sessionId, b);
          return true;
        case 'community-refresh':
          await handleCommunityRefreshVerdict(ctx, res, origin, projectsRoot, dirSegs, sessionId, verdict);
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
