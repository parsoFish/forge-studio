/**
 * The generic session-affordance WRITE endpoint (W6-B4, ADR 043's 2026-08-15
 * amendment §1), carved out of `cli/bridge-studio-affordances.ts` by M4 row 37.
 *
 *   POST /api/studio/sessions/:kind/:sessionId/:affordance
 *     { project, ...per-affordance-kind body }
 *     → 200 { ok: true, ... }
 *     | 501 UnhandledAffordanceBody   (a validly-derived affordance this
 *                                      route has no write handler for)
 *     | 4xx/5xx { error }
 *
 * `:affordance` is one of `deriveSessionAffordances(descriptor, phase)`'s
 * derived ids — never an authored value — recomputed from the session's CURRENT
 * on-disk phase on every call, so a stale client cannot fire a
 * phase-inappropriate write.
 *
 * WHAT LIVES HERE: the resolution chain (kind → sessionId → affordance → body),
 * the verdict record, and the dispatch to a kind. WHAT DOES NOT: the per-kind
 * arms, which live with their kinds under `kinds/`, and the shared shell they
 * call (`bridge-studio-sessions-affordance-shell.ts`). `design.md` §affordance
 * holds the resolution chain's no-oracle 404 discipline, the delegation
 * contract (`approveKbCleanup` / `runFinalize` send their own responses), and
 * the SYNC INVARIANT the arms depend on — read it before adding an `await`
 * inside one.
 *
 * ORDERING: `AFFORDANCE_ROUTE_RE` is a bare three-segment matcher and also
 * matches `…/:kind/:sessionId/cancel`, so this route's table entry MUST sit
 * after the cancel entry. `tests/contract/routes-table.test.ts` pins that with
 * a mutation, not with prose.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';

import { sendJson, allowedOrigin, sanitizeError, pathOnly } from '@forge/kernel';
import { resolveGuardedPath, guardedReadFile, guardedWriteFile } from '@forge/kernel';
import { defaultConfigPath, loadConfig, resolveProjectsDir } from '@forge/kernel';
import {
  loadSessionKinds,
  verdictValueState,
  VERDICT_VALUES,
  type SessionKindDescriptor,
} from './studio/session-kinds.ts';
import { deriveSessionAffordances, type SessionAffordance } from './studio/session-kinds-affordances.ts';
import { guardedReadSessionStatus } from './interactive-session.ts';
import { isSafeRunId } from '@forge/agents/run-agent.ts';
import { invalidProjectReason } from './session-resolution.ts';
import {
  unhandledAffordanceBody,
  handleGenericRevise,
  safeParseJson,
  MAX_ANSWER_FIELD_BYTES,
  type AffordanceRouteContext,
} from './bridge-studio-sessions-affordance-shell.ts';
import {
  handleInstructionsAnswer,
  handleInstructionsBrief,
  handleInstructionsVerdict,
} from './kinds/instructions.ts';
import { handleDemoBrief, handleDemoVerdict } from './kinds/demo-builder.ts';
import { handleKbCleanupVerdict } from './kinds/kb-cleanup.ts';
import { handleAuthoringVerdict } from './kinds/authoring.ts';

export type { AffordanceRouteContext };

// ---------------------------------------------------------------------------
// Route matching
// ---------------------------------------------------------------------------

const AFFORDANCE_ROUTE_RE = /^\/api\/studio\/sessions\/([^/]+)\/([^/]+)\/([^/]+)$/;

function decodeSegment(raw: string): string {
  return decodeURIComponent(raw);
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
      body = await ctx.readBody();
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
