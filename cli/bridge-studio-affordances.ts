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
 *      (`question-form` | `verdict`), then — for `verdict` — GENERICALLY
 *      against `affordance.meta.requires` (W6-B9, reviewer finding on
 *      W6-B8: any extra POST body field a row's `requires:` list names must
 *      be present as a non-empty string, checked ONCE here for every
 *      session kind, never a hand-kept per-kind field list), then per
 *      session `kind` within that — see the per-kind handlers below.
 *      Anything this switch does not explicitly wire (an out-of-scope
 *      `verdict` value, or the read-only `staged-review`/`next-turn`
 *      affordance kinds, which have no operator WRITE action at all — they
 *      describe what an `agent` step already did, not something to
 *      trigger) falls through to `UnhandledAffordanceBody` — 501, naming
 *      the affordance kind + the session kind + the phase. Never a silent
 *      200, never a misrouted write into a DIFFERENT kind's handler.
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
 *     finish choreography (imported directly; no cycle: `bridge-studio-
 *     kbs.ts` does not import this file or `ui-bridge.ts`). W6-B4
 *     adversarial-review fix: this used to be duplicated, non-atomic
 *     choreography in BOTH this route AND the bespoke `POST /api/studio/
 *     kbs/:id/cleanup/apply` route — a check-then-await-then-write race,
 *     live-reproduced as two concurrent approves running two independent
 *     `runBrainConsolidateNow` drains. See `approveKbCleanup`'s own doc
 *     comment for the fix (a synchronous phase:'applying' claim written
 *     BEFORE the one `await`). W6-B9 (reviewer finding on W6-B8): the
 *     bespoke route is now DELETED — kb-cleanup migrated onto the generic
 *     session shell, and the bespoke route had no production caller left.
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
import { resolve } from 'node:path';

import { sendJson, allowedOrigin, sanitizeError, readJson, pathOnly, type StudioContext } from './bridge-studio.ts';
import { resolveGuardedPath, guardedReadFile, guardedWriteFile } from './studio-path-guard.ts';
import { defaultConfigPath, loadConfig, resolveProjectsDir } from '../orchestrator/config.ts';
import {
  loadSessionKinds,
  deriveSessionAffordances,
  verdictValueState,
  VERDICT_VALUES,
  type SessionKindDescriptor,
  type SessionAffordance,
  type SessionAffordanceKind,
} from '../orchestrator/studio/session-kinds.ts';
import { guardedReadSessionStatus, guardedWriteSessionStatus } from '../orchestrator/interactive-session.ts';
import { isSafeRunId } from '../orchestrator/run-agent.ts';
import { SLUG_RE } from '../orchestrator/skill-path.ts';
import { invalidProjectReason, parsePendingQuestions } from './bridge-studio-sessions.ts';
import { approveKbCleanup } from './bridge-studio-kbs.ts';
import { runFinalize } from './bridge-studio-authoring.ts';
import { dryBridgeAgentTurnMarker } from './dry-bridge.ts';

// ---------------------------------------------------------------------------
// UnhandledAffordanceBody — mirrors forge-ui's `UnhandledArtifactBody`
// (`apps/studio/components/studio/session/SessionArtifactPane.tsx`): an
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
 *  spawns a turn for — never `architect` (no writable affordance) or
 *  `project-brain` (no verdict/question-form row in its panel). W7-C2: the
 *  generic-spine kinds (`authoring`/`kb-cleanup`) joined for the REVISE
 *  verdict — a revise sends the session back to its agent phase and spawns
 *  the next turn through the SAME detached `spawnAgentTurn` their own start
 *  routes already use (authoring's APPROVE still runs its turn INSIDE
 *  `runFinalize`, unchanged). */
export type LegacySpawnableAgentId = 'instructions' | 'demo-builder' | 'authoring' | 'kb-cleanup';

/** W7-C2 T1 review (A7) — what `spawnAgentTurn` reports back. It used to
 *  return void with its whole body inside a bare best-effort catch, so
 *  a failed spawn left a 200 `{ok:true, phase:'analyzing'}` and a session
 *  stuck in a working phase with NO turn: a session with no log dir has
 *  `lastActivityMs === null`, which `cli/bridge-studio-lifecycle.ts` says
 *  can never be `stalled`, so the operator saw `working` forever with
 *  `needsYou:false`. `spawned:false` with `ok:true` is the DELIBERATE
 *  no-spawn (FORGE_ARCHITECT_NO_SPAWN / the dry bridge), which is not a
 *  failure. */
export type SpawnTurnOutcome =
  | { readonly ok: true; readonly spawned: boolean }
  | { readonly ok: false; readonly error: string };

export type AffordanceRouteContext = StudioContext & {
  /** Injected from `cli/ui-bridge.ts` — see this file's header for why this
   *  is dependency-injected rather than imported: delegates to the EXACT
   *  SAME `spawnAgentTurn` every bespoke per-kind route already calls, not a
   *  reimplementation. */
  spawnAgentTurn: (forgeRoot: string, agentId: LegacySpawnableAgentId, project: string, sessionId: string) => SpawnTurnOutcome;
  /** W7-C2 T1 review (A12) — the ONE per-kind live-refresh seam, the SAME
   *  mapping `handleSessionCancelRoute` is already injected with
   *  (cli/ui-bridge.ts). Replaces the two hand-kept
   *  `broadcastInstructionsChanged`/`broadcastDemoChanged` calls that used
   *  to live inline here: this module no longer keeps its own per-kind list
   *  of which kinds have a list-changed WS event. A kind with no event
   *  (authoring / kb-cleanup — no `*-list-changed` message exists in the
   *  bridge's WS vocabulary) honestly no-ops; those surfaces refresh on the
   *  session shell's own 3s poll (SHELL_POLL_MS,
   *  apps/studio/app/sessions/[kind]/[sessionId]/page.tsx). */
  broadcastKindChanged: (kind: string) => void;
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
// (`awaiting-answers-question-form` — mirrors `POST /api/instructions/answer`,
// `cli/ui-bridge.ts:3236`). W6-B9 — instructions' `briefing` phase ALSO
// derives a `question-form` row (`briefing-question-form`, same reused
// `awaits: 'questions'` shape) — dispatched to `handleInstructionsBrief`
// below instead, by `affordance.phase`, since the two share a `kind` but
// write to different files with different semantics.
// ---------------------------------------------------------------------------

/** Hardening (W6-B4 adversarial-review round): `answers[]` is an
 *  operator-supplied array with no cap anywhere upstream of this route — an
 *  unbounded count or unbounded per-field size both reach `answers.json`
 *  (and the agent's next prompt, which inlines the whole interview
 *  transcript) unbounded. Caps are generous for any genuine interview round
 *  (a real round asks a handful of questions with paragraph-length answers)
 *  and named in the 400 they produce, never silently truncated. */
const MAX_ANSWERS_COUNT = 64;
/** Exported (W6-B9 reviewer fix) so `cli/ui-bridge.ts`'s bespoke
 *  `POST /api/instructions/brief` route can cap its own `body.brief` field
 *  against this SAME limit — `handleInstructionsBrief` above already caps
 *  the generic `briefing-question-form` path's equivalent field to it; two
 *  routes writing the identical `prompt.md`/`status.prompt` target with two
 *  different, hand-kept limits (one bounded, one not) is exactly the kind
 *  of quiet drift a single shared constant closes, one number, not two. */
export const MAX_ANSWER_FIELD_BYTES = 8 * 1024;

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

// ---------------------------------------------------------------------------
// W6-B9 reviewer fix — the generic route's spawn-triggering handlers
// (answer/brief/verdict-instructions/verdict-demo) previously called
// `ctx.spawnAgentTurn` with no dry-bridge marker at all: `spawnAgentTurn`
// itself already no-ops under `FORGE_DRY_BRIDGE=1`
// (`cli/ui-bridge.ts:2124`), so no REAL spawn ever happened — but the 200
// body silently omitted the `dryBridge:{skipped:['agent-turn']}` disclosure
// every bespoke per-kind spawn route already gives the same caller (e.g.
// `POST /api/instructions/brief`, `cli/ui-bridge.ts:3310`), a parity gap
// this batch has otherwise been careful to close. ONE shared helper (not
// four repeated `...dryBridgeAgentTurnMarker(...)` call sites) — `route` is
// a fixed, literal identifier for this generic dispatch point (mirrors
// `BRIDGE_ROUTE_CLASSIFICATION`'s own `:id`-style placeholder convention,
// `cli/dry-bridge.ts` — documentation, not a router pattern), never the
// bespoke route name a given call happens to mirror, so the emitted
// `dry-bridge.skip` event names what ACTUALLY handled the request.
// ---------------------------------------------------------------------------

const GENERIC_AFFORDANCE_ROUTE = '/api/studio/sessions/:kind/:sessionId/:affordance';

function affordanceDryBridgeMarker(ctx: AffordanceRouteContext, sessionId: string): ReturnType<typeof dryBridgeAgentTurnMarker> {
  return dryBridgeAgentTurnMarker(ctx.logsRoot, GENERIC_AFFORDANCE_ROUTE, sessionId);
}

// ---------------------------------------------------------------------------
// W7-C2 (sessions-kinds-29) — the durable verdict record. Appended by the
// MAIN dispatcher, AFTER the per-kind handler has sent its response and ONLY
// when that response was a 2xx — a refused verdict (409 wrong-phase, 422
// unsupported value, 400 bad body, a failed finalize) never records a
// decision that did not happen. `deriveSessionTranscript`
// (orchestrator/studio/session-transcript.ts) renders each record as an
// operator turn, so a reject (and its rationale) is never invisible in the
// session record.
//
// W7-C2 T1 review (P0-3, finding A2/F2) — the prior-history read FAILS
// CLOSED. It used to do `Array.isArray(parsed) ? parsed : []`, so a
// verdicts.json this route could not parse (a partial write from a killed
// bridge, an out-of-band edit) made the NEXT accepted verdict silently
// truncate the whole audit trail to one record, 200 OK, no log. The parse
// now runs as a PRE-FLIGHT, before the per-kind handler is dispatched at
// all: an unparseable history refuses the verdict outright (409, naming the
// file) rather than applying a decision whose record it cannot keep. Nothing
// this route cannot read is ever overwritten.
//
// W7-C2 T1 review (P0-2, findings A5/F1) — a `revise` record carries its OWN
// `feedback` text. The record used to carry none, on the theory that
// feedback.md held the words — true only for the LAST round, because a
// revise OVERWRITES feedback.md, so round 1's rationale was permanently
// unrecoverable in a multi-round session. Each round's words now live with
// the decision that produced them.
// ---------------------------------------------------------------------------

const VERDICTS_FILENAME = 'verdicts.json';

type VerdictHistory =
  | { readonly ok: true; readonly prior: readonly unknown[] }
  | { readonly ok: false; readonly message: string };

/** Parse the session's existing verdicts.json. An ABSENT file is an empty
 *  history (the ordinary first-verdict case); a present-but-unparseable one
 *  is an explicit refusal — never silently reset to []. */
function readVerdictHistory(projectsRoot: string, dirSegs: readonly string[]): VerdictHistory {
  const priorRaw = guardedReadFile(projectsRoot, [...dirSegs, VERDICTS_FILENAME]);
  if (priorRaw === null) return { ok: true, prior: [] };
  const parsed = safeParseJson<unknown>(priorRaw);
  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      message: `${VERDICTS_FILENAME} is present but is not a JSON array of verdict records — refusing to append (the existing decision history would be destroyed). Repair or remove the file to record further verdicts.`,
    };
  }
  return { ok: true, prior: parsed };
}

function appendVerdictRecord(
  projectsRoot: string,
  dirSegs: readonly string[],
  prior: readonly unknown[],
  verdict: string,
  notes: string,
  feedback: string,
): void {
  const record = {
    at: new Date().toISOString(),
    verdict,
    ...(notes.length > 0 ? { notes } : {}),
    ...(feedback.length > 0 ? { feedback } : {}),
  };
  if (guardedWriteFile(projectsRoot, [...dirSegs, VERDICTS_FILENAME], JSON.stringify([...prior, record], null, 2)) === null) {
    // Never swallowed: the verdict itself already landed (the phase write IS
    // the source of truth, and the response is already sent), but a lost
    // record is a real gap in the audit trail and says so on the bridge's
    // stderr rather than vanishing.
    console.error(`appendVerdictRecord: failed to write ${VERDICTS_FILENAME} for session ${dirSegs.join('/')} — the "${verdict}" decision was applied but is NOT recorded.`);
  }
}

/** W7-C2 T1 review (A6) — "did the handler actually answer?".
 *
 *  The append gate used to read `res.statusCode` alone, which Node defaults
 *  to 200: a per-kind handler that returned WITHOUT responding would have
 *  recorded a verdict that never happened (and hung the request). It was
 *  correct only by accident — every handler happens to respond first.
 *  `headersSent` is the thing the handler itself asserts (sendJson's
 *  writeHead sets it synchronously), so an unanswered request now records
 *  nothing. Exported for a direct unit pin of the no-response case, which no
 *  route-level test can reach today. */
export function verdictWasAccepted(res: { readonly headersSent: boolean; readonly statusCode: number }): boolean {
  return res.headersSent && res.statusCode >= 200 && res.statusCode < 300;
}

// ---------------------------------------------------------------------------
// W7-C2 (sessions-kinds-09/23, library-24, bead forge-4ei) — the ONE generic
// revise handler. A revise is the same shape for every kind that declares
// it: write the operator's feedback to the session's feedback.md (the file
// every draft runner already reads — instructions/demo bespoke, the generic
// spine via buildTurnPrompt's feedback section), send the session back to
// its DRAFTING phase, and spawn the next turn. The target phase is DERIVED
// from the phase table, never a hand-kept per-kind map: the drafting phase
// is the `step: agent` row whose own `next` lands on the verdict row this
// affordance was derived from (instructions drafting→awaiting-verdict, demo
// generating→awaiting-review, authoring analyzing→awaiting-review,
// kb-cleanup drafting→awaiting-approval — all four real tables have exactly
// one). No such row ⇒ 501, fail LOUD — a yaml row declaring `revise` with no
// agent producer to re-run is authored-data-with-no-consumer, never guessed
// around.
//
// `iteration` is bumped when the status already tracks one (demo's
// regenerate semantics — mirrors POST /api/demo-builder/feedback's
// `iteration + 1` exactly); a kind with no iteration field is untouched.
//
// SYNC INVARIANT: no await between the caller's status read and the writes
// below — see this file's header note.
// ---------------------------------------------------------------------------

/** Which SPAWN_AGENT_SPECS id runs a kind's next turn — the SAME mapping
 *  each kind's own start route uses (`demo` sessions spawn the
 *  `demo-builder` agent; every other revise-capable kind's spawn id IS its
 *  descriptor id). Fail-loud for anything else. */
function reviseSpawnAgentId(descriptorId: string): LegacySpawnableAgentId | null {
  switch (descriptorId) {
    case 'instructions': return 'instructions';
    case 'demo': return 'demo-builder';
    case 'authoring': return 'authoring';
    case 'kb-cleanup': return 'kb-cleanup';
    default: return null;
  }
}

function handleGenericRevise(
  ctx: AffordanceRouteContext,
  res: ServerResponse,
  origin: string,
  projectsRoot: string,
  dirSegs: readonly string[],
  descriptor: SessionKindDescriptor,
  affordance: SessionAffordance,
  status: Record<string, unknown>,
  project: string,
  sessionId: string,
  feedback: string,
): void {
  const phases = descriptor.turnSpec?.phases ?? descriptor.panel?.phases ?? [];
  const producer = phases.find((p) => p.step === 'agent' && p.next === affordance.phase);
  if (!producer) {
    sendJson(
      res,
      501,
      unhandledAffordanceBody('verdict', `session kind "${descriptor.id}" declares a "revise" verdict at phase "${affordance.phase}" but its phase table has no agent-step producer row to re-run`),
      origin,
    );
    return;
  }
  const agentId = reviseSpawnAgentId(descriptor.id);
  if (agentId === null) {
    sendJson(
      res,
      501,
      unhandledAffordanceBody('verdict', `no revise turn spawner is wired for session kind "${descriptor.id}"`),
      origin,
    );
    return;
  }

  const iterationBump = typeof status.iteration === 'number' ? { iteration: (status.iteration as number) + 1 } : {};
  if (
    guardedWriteFile(projectsRoot, [...dirSegs, 'feedback.md'], feedback) === null ||
    guardedWriteSessionStatus(projectsRoot, dirSegs, { ...status, phase: producer.phase, ...iterationBump }) === null
  ) {
    sendJson(res, 400, { error: 'invalid session path', sessionId }, origin);
    return;
  }

  // W7-C2 T1 review (A7) — a failed spawn is REPORTED, not swallowed. The
  // phase write above is rolled back to the verdict row the operator acted
  // from, so the session lands back on a real, actionable affordance instead
  // of sitting in a working phase that no turn will ever leave (the
  // `lastActivityMs === null` -> never-`stalled` hole in
  // cli/bridge-studio-lifecycle.ts). feedback.md deliberately stays: it is
  // the operator's pending note, and the retry should carry it.
  const spawn = ctx.spawnAgentTurn(ctx.forgeRoot, agentId, project, sessionId);
  if (!spawn.ok) {
    guardedWriteSessionStatus(projectsRoot, dirSegs, status);
    ctx.broadcastKindChanged(descriptor.id);
    sendJson(res, 500, { error: `your feedback was saved to this session but no agent turn could be started — ${spawn.error}. The session is back on its review gate; send the revision again once the cause is cleared.`, phase: affordance.phase }, origin);
    return;
  }
  ctx.broadcastKindChanged(descriptor.id);
  sendJson(res, 200, { ok: true, phase: producer.phase, ...affordanceDryBridgeMarker(ctx, sessionId) }, origin);
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
  const answers = answersRaw as { questionId?: unknown; question: string; answer: string }[];
  const capReason = answersCapReason(answers);
  if (capReason !== null) {
    sendJson(res, 400, { error: capReason }, origin);
    return;
  }

  // W7-C2 T1 review (A3, finding sessions-kinds-19) — CORRELATE BY ID, not
  // by text. The panel renders one control per pending question and posts
  // each answer back with the `questionId` the shell route derived
  // (`pendingQuestionId`, cli/bridge-studio-sessions.ts); this re-derives the
  // SAME ids from the SAME on-disk questions.json and refuses an answer that
  // names an unknown id, or whose text does not match the question that id
  // actually asks. Answers correlated by text alone mis-bind the moment a
  // round repeats or rewords a question, and the durable answers.json is the
  // permanent record of that mis-binding.
  //
  // The requirement is DERIVED from live state, not a flag: it applies
  // exactly when there IS a pending questions.json to correlate against. The
  // free-text single-box submission (a round whose questions never reached
  // the wire) has nothing to correlate and carries no id — and cannot,
  // because there is no question list to name.
  const pendingRaw = guardedReadFile(projectsRoot, [...dirSegs, 'questions.json']);
  const pending = pendingRaw !== null ? parsePendingQuestions(pendingRaw) : null;
  if (pending !== null && pending.length > 0) {
    for (const [i, a] of answers.entries()) {
      const id = a.questionId;
      if (typeof id !== 'string' || id.length === 0) {
        sendJson(res, 400, { error: `body.answers[${i}].questionId is required (one of: ${pending.map((q) => q.id).join(', ')}) — answers are correlated by id, never by question text` }, origin);
        return;
      }
      const match = pending.find((q) => q.id === id);
      if (match === undefined) {
        sendJson(res, 400, { error: `body.answers[${i}].questionId ${JSON.stringify(id)} names no pending question — expected one of: ${pending.map((q) => q.id).join(', ')}` }, origin);
        return;
      }
      if (match.question !== a.question) {
        sendJson(res, 400, { error: `body.answers[${i}].question does not match the text of pending question ${JSON.stringify(id)} — refusing to record a mis-bound answer` }, origin);
        return;
      }
    }
  }
  const recordedAnswers = answers.map((a) => ({
    ...(typeof a.questionId === 'string' && a.questionId.length > 0 ? { questionId: a.questionId } : {}),
    question: a.question,
    answer: a.answer,
  }));

  const priorRaw = guardedReadFile(projectsRoot, [...dirSegs, 'answers.json']);
  const prior = (priorRaw !== null ? safeParseJson<{ round: number; answers: unknown[] }[]>(priorRaw) : null) ?? [];
  const round = prior.length + 1;

  // SYNC INVARIANT: no await between this function's writes and the caller's
  // own status read above — an await here reopens the double-spawn race; see
  // kb-cleanup's now-fixed `approveKbCleanup` (cli/bridge-studio-kbs.ts) for
  // the shape a genuinely-awaited claim needs.
  if (
    guardedWriteFile(projectsRoot, [...dirSegs, 'answers.json'], JSON.stringify([...prior, { round, answers: recordedAnswers }], null, 2)) === null ||
    guardedWriteSessionStatus(projectsRoot, dirSegs, { ...status, phase: 'interviewing', round: round + 1 }) === null
  ) {
    sendJson(res, 400, { error: 'invalid session path', sessionId }, origin);
    return;
  }

  ctx.spawnAgentTurn(ctx.forgeRoot, 'instructions', project, sessionId);
  ctx.broadcastKindChanged('instructions');
  sendJson(res, 200, { ok: true, round, ...affordanceDryBridgeMarker(ctx, sessionId) }, origin);
}

// ---------------------------------------------------------------------------
// question-form — instructions' PRE-interview briefing checkpoint
// (`briefing-question-form`, the phase `POST /api/instructions/start` lands
// EVERY new session in — cli/ui-bridge.ts:3193-3197 — without spawning the
// agent). Mirrors `POST /api/instructions/brief` (cli/ui-bridge.ts:3275):
// writes `prompt.md` (NOT `answers.json` — a different on-disk target from
// `handleInstructionsAnswer` above) and sets `status.prompt`/`round: 1`/
// `phase: 'interviewing'`, then spawns the same turn.
// ---------------------------------------------------------------------------

async function handleInstructionsBrief(
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
  if (!Array.isArray(answersRaw) || !answersRaw.every((a) => a !== null && typeof a === 'object' && typeof (a as Record<string, unknown>).answer === 'string')) {
    sendJson(res, 400, { error: 'body.answers must be an array of {question: string, answer: string}' }, origin);
    return;
  }
  // W6-B9 — the generic single-box question-form UI submits at most one
  // entry (SessionInteractivePanel's hardcoded `[{question:'Operator
  // response', answer: answerText}]`); only the free text itself is the
  // brief — this phase is not a real interview round, so there is no
  // question to echo back. An empty submission (no entries, or a lone
  // empty-string answer) is a legal "no notes" brief — mirrors the bespoke
  // route's own `body.brief ?? ''` default, and is WHY the generic panel's
  // Send button no longer requires non-empty text (see that file's own note).
  const brief = (answersRaw[0] as { answer?: string } | undefined)?.answer ?? '';
  const briefBytes = Buffer.byteLength(brief, 'utf8');
  if (briefBytes > MAX_ANSWER_FIELD_BYTES) {
    sendJson(res, 400, { error: `body.answers[0].answer is ${briefBytes} bytes — exceeds the ${MAX_ANSWER_FIELD_BYTES}-byte limit` }, origin);
    return;
  }

  // SYNC INVARIANT: no await between this function's writes and the
  // caller's own status read above — see this file's header note.
  if (
    guardedWriteFile(projectsRoot, [...dirSegs, 'prompt.md'], brief) === null ||
    guardedWriteSessionStatus(projectsRoot, dirSegs, { ...status, phase: 'interviewing', round: 1, prompt: brief }) === null
  ) {
    sendJson(res, 400, { error: 'invalid session path', sessionId }, origin);
    return;
  }

  ctx.spawnAgentTurn(ctx.forgeRoot, 'instructions', project, sessionId);
  ctx.broadcastKindChanged('instructions');
  sendJson(res, 200, { ok: true, phase: 'interviewing', ...affordanceDryBridgeMarker(ctx, sessionId) }, origin);
}

// ---------------------------------------------------------------------------
// verdict — instructions (approve|reject; "revise" is the ONE generic
// `handleGenericRevise` arm since W7-C2 — the bespoke
// `/api/instructions/verdict` route keeps its own revise arm as the
// independently-tested bespoke surface, and C2-REV-4 pins the two reaching
// the identical phase + feedback.md).
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
  ctx.broadcastKindChanged('instructions');
  sendJson(res, 200, { ok: true, phase: nextPhase, ...affordanceDryBridgeMarker(ctx, sessionId) }, origin);
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
  ctx.broadcastKindChanged('demo');
  sendJson(res, 200, { ok: true, phase: 'generating', ...affordanceDryBridgeMarker(ctx, sessionId) }, origin);
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

// ---------------------------------------------------------------------------
// verdict — kb-cleanup. W7-C2 (sessions-kinds-23) SUPERSEDED W6-B6's
// approve-only ruling: the `awaiting-approval` row now declares
// `verdicts: [approve, revise, reject]`, and the function below handles
// `reject` (terminal `rejected`, no spawn, nothing drained) alongside
// approve; `revise` never reaches here at all — it is the ONE generic
// `handleGenericRevise` arm. This route carries
// no URL-supplied kb id at all (there is no `:id` segment in
// `/api/studio/sessions/:kind/:sessionId/:affordance`), so `status.kb_id` is
// the ONLY candidate value — the security invariant ("the drain's SOLE
// source of truth is status.kb_id, never a URL segment") is satisfied by
// construction here, never an extra check. W6-B9 (reviewer finding on
// W6-B8): this WAS one of two callers of `approveKbCleanup` — the bespoke
// `POST /api/studio/kbs/:id/cleanup/apply` route (which DID carry a URL
// `:id`, cross-checked against `status.kb_id`) is now DELETED, so this is
// the ONLY caller left.
// ---------------------------------------------------------------------------

async function handleKbCleanupVerdict(
  ctx: AffordanceRouteContext,
  res: ServerResponse,
  origin: string,
  projectsRoot: string,
  dirSegs: readonly string[],
  status: Record<string, unknown>,
  sessionId: string,
  project: string,
  verdict: 'approve' | 'reject',
): Promise<void> {
  // W7-C2 (sessions-kinds-23) — reject: a plain, SYNC-INVARIANT write (no
  // await before it) straight to the terminal `rejected` row the yaml now
  // declares, mirroring handleDemoVerdict's own reject arm. No spawn — a
  // discarded plan runs nothing. The drafted plan file stays on disk (the
  // session dir is the audit trail), it just never drains.
  if (verdict === 'reject') {
    if (guardedWriteSessionStatus(projectsRoot, dirSegs, { ...status, phase: 'rejected' }) === null) {
      sendJson(res, 400, { error: 'invalid session path', sessionId }, origin);
      return;
    }
    sendJson(res, 200, { ok: true, phase: 'rejected' }, origin);
    return;
  }

  // W6-B6 post-merge review: the unsupported-verdict 422 lives in the main
  // handler above, reading the SAME `affordance.meta.verdicts`
  // `studio/session-kinds.yaml`'s `awaiting-approval` row declares.
  //
  // Delegates WHOLESALE to `approveKbCleanup` (cli/bridge-studio-kbs.ts) —
  // the phase re-check (belt-and-suspenders on top of the caller's own
  // affordance-membership check AND the generic verdicts gate above), the
  // kb_id presence check, the ATOMIC phase:'applying' claim, the drain, and
  // the phase:'applied' write all live in exactly one place now (W6-B4
  // adversarial-review fix — this used to be duplicated, non-atomic
  // choreography here; W6-B9 deleted the last other caller, the bespoke
  // `/cleanup/apply` route).
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

/** The ONE enumeration of "which single file at an authoring session's
 *  `staging/` root identifies the drafted package's shape" — SERVER-side
 *  source of truth (W8-B4 FIX-1). `'staging'` itself mirrors
 *  `orchestrator/studio/session-transcript.ts`'s own (unexported)
 *  `PACKAGE_DIRNAME` literal — not imported, to avoid widening that file's
 *  export surface for a single constant this route can just as honestly
 *  hand-copy (the same convention this file's own header already documents
 *  for `SLUG_RE`-class values).
 *
 *  W8-B4/WI-3 landed `kind:'template'` on the DEDICATED finalize route
 *  (`cli/bridge-studio-authoring.ts`'s `runFinalize` + its own
 *  `TEMPLATE_STAGING_FILENAME`) but this array's OWN two-shape version —
 *  the one `deriveAuthoringPackageKind` below actually used — never learned
 *  about `template.md`. Drafting a template therefore worked end to end,
 *  but the operator's real Approve button (which calls THIS route, never
 *  the dedicated one) 409'd forever. Exported so:
 *   (a) `deriveAuthoringPackageKind` below derives from it (one iteration,
 *       not a hand-rolled if-chain that a fourth shape is easy to forget
 *       inside), and
 *   (b) `cli/authoring-package-shape-parity.test.ts` can cross-check it,
 *       byte-for-byte, against forge-ui's own hand-mirrored copy
 *       (`apps/studio/lib/authoring-package-shape.ts` — forge-ui never
 *       imports cli/ at runtime, so that file is a second, independent
 *       definition, not an import of this one; the parity test is what
 *       keeps a hand-copy honest instead of silent). */
export const AUTHORING_PACKAGE_SHAPES: ReadonlyArray<{ readonly filename: string; readonly kind: 'skill' | 'hook' | 'template' }> = [
  { filename: 'SKILL.md', kind: 'skill' },
  { filename: 'hook.yaml', kind: 'hook' },
  { filename: 'template.md', kind: 'template' },
];

/** Derives the drafted package's shape purely by file PRESENCE, from
 *  `AUTHORING_PACKAGE_SHAPES` above — reads the REAL staging files
 *  server-side via `guardedReadFile` (the SAME guarded primitive
 *  `handleInstructionsAnswer` above already uses), never a client-supplied
 *  `body.kind` (W6-B9, reviewer finding on W6-B8: "keep kind derived from
 *  artifact" — `kind` is not an operator decision, D4; only the library
 *  `id` is, and that is what `meta.requires` now enforces generically).
 *  `null` when no marker file exists yet under `staging/` — still
 *  drafting, never guessed. */
function deriveAuthoringPackageKind(projectsRoot: string, dirSegs: readonly string[]): 'skill' | 'hook' | 'template' | null {
  for (const shape of AUTHORING_PACKAGE_SHAPES) {
    if (guardedReadFile(projectsRoot, [...dirSegs, 'staging', shape.filename]) !== null) return shape.kind;
  }
  return null;
}

async function handleAuthoringVerdict(
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
  // W7-C2 (sessions-kinds-23 / library-24) — reject: a plain, SYNC-INVARIANT
  // write straight to the terminal `rejected` row the yaml now declares. No
  // spawn, nothing landed in either library; the staged draft stays on disk
  // as the session's own record but is never installed.
  if (verdict === 'reject') {
    if (guardedWriteSessionStatus(projectsRoot, dirSegs, { ...status, phase: 'rejected' }) === null) {
      sendJson(res, 400, { error: 'invalid session path', sessionId }, origin);
      return;
    }
    sendJson(res, 200, { ok: true, phase: 'rejected' }, origin);
    return;
  }

  // W6-B9 (reviewer finding on W6-B8): `body.kind`/`body.id` used to be
  // hardcoded, authoring-specific checks here — `kind` duplicated a fact
  // the server can derive for itself (never an operator decision, D4), and
  // `id`'s requiredness had no wire signal a client could read back. Both
  // are gone: `id`'s presence is now the GENERIC `meta.requires` check in
  // the main dispatcher above (studio/session-kinds.yaml's `requires: [id]`
  // on this row), and `kind` is derived here, from the REAL staging files,
  // never trusted from the request body.
  const kind = deriveAuthoringPackageKind(projectsRoot, dirSegs);
  if (kind === null) {
    // The enumeration pin: built FROM AUTHORING_PACKAGE_SHAPES, never a
    // hand-typed literal list — a shape added to that array is a shape this
    // message names for free, so the operator-facing error can never drift
    // behind the actual check above the way the old two-item "neither a
    // SKILL.md nor a hook.yaml" copy silently did the day `template.md`
    // became a real third shape.
    const expected = AUTHORING_PACKAGE_SHAPES.map((s) => s.filename).join(', ');
    sendJson(res, 409, { error: `cannot finalize: the drafted package has none of ${expected} at its staging root yet` }, origin);
    return;
  }
  // body.id is already guaranteed a non-empty (post-trim) string by the
  // generic `requires` check above — re-read (never re-validate presence)
  // here.
  const id = (body.id as string).trim();
  // W7-C2 (library-22) — the id's SHAPE is validated HERE, before any phase
  // write: the finalizer downstream (runInteractiveTurn) enforces the same
  // SLUG_RE but raises it as an InteractiveRunnerError, which used to
  // surface as a 500 carrying the raw error-class text. A 400 with an
  // operator-readable rule (and no internal class name) is the honest
  // answer to a typo'd id; the panel mirrors this SAME rule as a
  // disable+hint, and the server check remains the enforcement.
  if (!SLUG_RE.test(id)) {
    sendJson(
      res,
      400,
      { error: `"${id}" is not a valid id — use lowercase letters/digits separated by hyphens, starting with a letter (e.g. "pr-diff-summary")` },
      origin,
    );
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
        // W6-B9 — 'briefing' and 'awaiting-answers' both derive a
        // `question-form` affordance (same `kind`, different `phase`,
        // different on-disk target) — dispatch on `affordance.phase`, the
        // SAME server-derived field the client already reads, never a
        // second phase read.
        if (affordance.phase === 'briefing') {
          await handleInstructionsBrief(ctx, res, origin, projectsRoot, dirSegs, status, project, sessionId, b);
        } else {
          await handleInstructionsAnswer(ctx, res, origin, projectsRoot, dirSegs, status, project, sessionId, b);
        }
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
      // W7-C2 T1 review (A8) — the vocabulary check reads the SSOT
      // (`VERDICT_VALUES` / `verdictValueState`, orchestrator/studio/
      // session-kinds.ts) instead of a hand-kept `!== 'approve' && !==
      // 'reject' && !== 'revise'` triple. That triple was the frozen
      // vocabulary's second copy — a fourth value added to VERDICT_VALUES
      // (and lint-accepted in the yaml) would have 400'd here with nothing
      // catching the drift, contradicting this feature's own "one source"
      // framing. Note this is the SHAPE gate only; "legal AT THIS PHASE"
      // stays `affordance.meta.verdicts` below.
      const verdictRaw = b.verdict;
      const verdict = typeof verdictRaw === 'string' ? verdictValueState(verdictRaw) : undefined;
      if (verdict === undefined) {
        sendJson(res, 400, { error: `body.verdict is required and must be one of: ${VERDICT_VALUES.map((v) => v.id).join(', ')}, got ${JSON.stringify(verdictRaw)}` }, origin);
        return true;
      }

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

      // W7-C2 (sessions-kinds-29) — `notes`: the OPTIONAL operator rationale,
      // legal on every verdict value, capped against the SAME shared limit
      // the interview answers hold. Recorded (verdicts.json) only after the
      // per-kind handler responds 2xx — see appendVerdictRecord's own header.
      const notesRaw = b.notes;
      if (notesRaw !== undefined && typeof notesRaw !== 'string') {
        sendJson(res, 400, { error: `body.notes must be a string when present, got ${JSON.stringify(notesRaw)}` }, origin);
        return true;
      }
      const notes = typeof notesRaw === 'string' ? notesRaw.trim() : '';
      const notesBytes = Buffer.byteLength(notes, 'utf8');
      if (notesBytes > MAX_ANSWER_FIELD_BYTES) {
        sendJson(res, 400, { error: `body.notes is ${notesBytes} bytes — exceeds the ${MAX_ANSWER_FIELD_BYTES}-byte limit` }, origin);
        return true;
      }

      // W7-C2 — `feedback`: REQUIRED (non-empty) for revise, refused on any
      // other verdict shape only by absence of meaning (it is simply ignored
      // there — the revise arm is its only reader). An empty revise is
      // refused: re-running the drafting turn with no guidance regenerates
      // the same draft, which is never what the operator meant.
      let feedback = '';
      if (verdict === 'revise') {
        const feedbackRaw = b.feedback;
        if (typeof feedbackRaw !== 'string' || feedbackRaw.trim().length === 0) {
          sendJson(
            res,
            400,
            { error: `body.feedback is required for verdict "revise" on session kind "${descriptor.id}" at phase "${phase}" — say what to change, got ${JSON.stringify(feedbackRaw)}` },
            origin,
          );
          return true;
        }
        feedback = feedbackRaw;
        const feedbackBytes = Buffer.byteLength(feedback, 'utf8');
        if (feedbackBytes > MAX_ANSWER_FIELD_BYTES) {
          sendJson(res, 400, { error: `body.feedback is ${feedbackBytes} bytes — exceeds the ${MAX_ANSWER_FIELD_BYTES}-byte limit` }, origin);
          return true;
        }
      }

      // W6-B9 (reviewer finding on W6-B8) — the GENERIC body-shape check:
      // "which extra POST body fields this verdict needs beyond `verdict`
      // itself" is now ONE business rule with ONE source, exactly mirroring
      // `allowedVerdicts` immediately above — `affordance.meta.requires`
      // (the row's authored `requires:` list, studio/session-kinds.yaml;
      // omitted when the row needs nothing extra). This REPLACES the
      // authoring-specific hardcoded `{kind,id}` check that used to live
      // inside `handleAuthoringVerdict` for the `id` half — a client that
      // wants to know what a verdict needs now reads the SAME derived
      // `meta.requires` this check enforces, never a second, hand-kept
      // per-kind list. Each named field must be present as a non-empty
      // (post-trim) string; the FIRST missing/empty field 400s, naming it —
      // never a generic "bad request".
      //
      // W7-C2 scoped this to APPROVE: `requires` names what the approve
      // FINALIZER needs (authoring's library `id`); revise/reject need
      // nothing extra, and enforcing `id` on them would block the very
      // exits the three-way gate exists to provide. The panel gates only
      // its Approve button on the same list — both sides read the same
      // scoping.
      if (verdict === 'approve') {
        const requiresFields = affordance.meta?.requires ?? [];
        for (const field of requiresFields) {
          const value = b[field];
          if (typeof value !== 'string' || value.trim().length === 0) {
            sendJson(
              res,
              400,
              { error: `body.${field} is required for verdict "${verdict}" on session kind "${descriptor.id}" at phase "${phase}", got ${JSON.stringify(value)}` },
              origin,
            );
            return true;
          }
        }
      }

      // W7-C2 T1 review (P0-3) — PRE-FLIGHT the existing decision history,
      // BEFORE any handler runs. A verdicts.json this route cannot parse
      // refuses the verdict outright rather than applying a decision whose
      // record it would then have to destroy to write (the old
      // `Array.isArray(parsed) ? parsed : []` silently truncated the whole
      // audit trail on the next accepted verdict). Fail closed, and fail
      // BEFORE the phase write, so nothing is half-applied. The session GET
      // stays renderable through the same corruption (that route now scopes
      // its own fail-closed transcript error to the transcript pane), so the
      // operator can still see the session — they just cannot record a new
      // decision until the history is repaired.
      const history = readVerdictHistory(projectsRoot, dirSegs);
      if (!history.ok) {
        sendJson(res, 409, { ok: false, error: history.message }, origin);
        return true;
      }

      // W7-C2 — revise is ONE generic arm for every kind (see
      // handleGenericRevise's own header: feedback.md + the derived
      // producer phase + the kind's own turn spawner).
      let dispatched = false;
      if (verdict === 'revise') {
        handleGenericRevise(ctx, res, origin, projectsRoot, dirSegs, descriptor, affordance, status, project, sessionId, feedback);
        dispatched = true;
      } else if (verdict === 'approve' || verdict === 'reject') {
        // W7-C2 T1 review (A8) — an explicit narrow, not an `else`. A value
        // added to the frozen VERDICT_VALUES vocabulary (and declared in the
        // yaml) with no arm wired here leaves `dispatched` false and falls
        // through to the 501 below, recording nothing — it is never coerced
        // into the approve/reject switch as a best guess.
        switch (descriptor.id) {
          case 'instructions':
            await handleInstructionsVerdict(ctx, res, origin, projectsRoot, dirSegs, status, project, sessionId, verdict);
            dispatched = true;
            break;
          case 'demo':
            await handleDemoVerdict(ctx, res, origin, projectsRoot, dirSegs, status, project, sessionId, verdict, b);
            dispatched = true;
            break;
          case 'kb-cleanup':
            await handleKbCleanupVerdict(ctx, res, origin, projectsRoot, dirSegs, status, sessionId, project, verdict);
            dispatched = true;
            break;
          case 'authoring':
            await handleAuthoringVerdict(ctx, res, origin, projectsRoot, dirSegs, status, project, sessionId, verdict, b);
            dispatched = true;
            break;
          default:
            // Structurally unreachable today — the only descriptors whose
            // panel/turnSpec ever derive a verdict affordance are the four
            // above. Fails LOUD, never routes an unknown kind through one of
            // the four handlers as a best guess.
            break;
        }
      }
      if (dispatched) {
        // W7-C2 (sessions-kinds-29) — record the decision ONLY when the
        // handler accepted it. `verdictWasAccepted` reads `headersSent` as
        // well as the code (W7-C2 T1 review, A6): Node defaults
        // `res.statusCode` to 200, so a handler that returned WITHOUT
        // responding used to record a verdict that never happened.
        // Best-effort on the WRITE only: the phase write is the source of
        // truth, and a failed append is logged, never silent.
        if (verdictWasAccepted(res)) {
          appendVerdictRecord(projectsRoot, dirSegs, history.prior, verdict, notes, feedback);
        }
        return true;
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
