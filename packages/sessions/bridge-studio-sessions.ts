/**
 * Forge Studio session-shell read route (R2-10, PR1: the session-shell
 * backend contract).
 *
 * Owns the ONE route:
 *
 *   GET /api/studio/sessions/:kind/:sessionId?project=<p>
 *     → { ok, kind, title, sessionId, project, phase, stages, defaultStage, turns, artifact,
 *         affordances, modelTier, terminal }
 *
 * W6-B3 (ADR-043 2026-08-15 amendment §1/§2) data-contract additions:
 *   - `affordances` — `deriveSessionAffordances(descriptor, phase)`
 *     (packages/sessions/studio/session-kinds.ts), computed server-side from
 *     whichever phase table the descriptor carries (`turnSpec` for a real
 *     dispatchable kind, `panel` for a legacy kind's read-only twin) —
 *     "derived, not authored" (ADR-043 §1): the client renders what it is
 *     handed and never re-derives. A descriptor with neither table
 *     (architect, permanently bespoke — amendment §4) always yields `[]`.
 *   - `modelTier` — the session's own kickoff-selected tier (ADR-043
 *     2026-08-15 amendment §3), read straight off `status.json.modelTier`
 *     (W6-B5 landed the write side: every `/start` route persists
 *     `resolveKickoffModelTier`'s validated `tier` there when the operator
 *     supplied one). `null` for a session with no `modelTier` key at all —
 *     no request predates the seam, and a `strategy:fixed` skill's kickoff
 *     never writes one (the model chip renders the descriptor's fixed model
 *     instead) — never fabricated, never defaulted to a guessed tier. The
 *     key is always present (never omitted) either way.
 *   - `terminal` (W6-B8) — `isTerminalPhase(descriptor, phase)`, the SAME
 *     derivation this route already used internally to gate `ensureSessionTail`,
 *     now also threaded onto the wire so the generic `SessionInteractivePanel`
 *     can gate its ActivityLog drawer without a second, hand-kept
 *     terminal-phase table client-side. ALWAYS present (never omitted).
 *
 * Mirrors bridge-studio-templates.ts's contract exactly: a single
 * `handleStudioSessionsRoutes(req, res, ctx, rawUrl, method): Promise<boolean>`,
 * a linear if-chain, `return false` on a non-matching URL, `sendJson` for every
 * response, `sanitizeError` for anything that reaches a user-visible error
 * string derived from a thrown value. Read-only: no writes, no spawns, no
 * mutation of any session — this route only derives a view over
 * already-on-disk session state (packages/sessions/studio/session-kinds.ts +
 * session-transcript.ts do all the real work; this module is glue + guards).
 *
 * `kind` is resolved against the LIVE `studio/session-kinds.yaml` registry
 * (loadSessionKinds) rather than a hardcoded switch — a new descriptor (R4-15/
 * 16/17) needs no code change here. The on-disk session dir is derived as
 * `<projectsRoot>/<project>/_<kind>/<sessionId>` — `_<kind>` built from
 * `descriptor.id`, the same shape `architectSessionDir` / `instructionsSessionDir`
 * / `projectBrainSessionDir` already use (apps/forge/ui-bridge.ts:1416,
 * packages/sessions/kinds/instructions.ts, kinds/project-brain.ts).
 *
 * Security (the part reviewers attack hardest — a standing brief after 3
 * consecutive lexical-check failures in this campaign):
 *   - `sessionId` is validated with SAFE_ID_RE (apps/forge/bridge-studio.ts) — real
 *     session ids are ISO-ish timestamps (`2026-08-05T10-00-00`, uppercase
 *     `T`) which a lowercase-only slug rule rejects. `project` is validated
 *     with the ONE case-preserving id rule (PROJECT_ID_RE; a `.kb-<id>`
 *     seeding anchor with KB_ID_RE — W7-A4 / W7-FIX-A4). Exact precedent:
 *     packages/flows/bridge-studio-runs.ts's plan-verdict route. BOTH are validated
 *     (length cap + charset) BEFORE any fs call.
 *   - The session dir is resolved via `resolveGuardedPath`
 *     (packages/kernel/path-guard.ts) — a per-segment IDENTITY walk, never a
 *     lexical `startsWith(dir + sep)` check on the unresolved path, and
 *     never (R6-06 round 6 fix) a realpath computed on an ALREADY-FOLDED
 *     `<project>/_<kind>` baseline — see `resolveSafeSessionDir` below for
 *     why that earlier shape was tautological when `_<kind>` itself was the
 *     symlink. The escape probe AT-47 defends is a symlink whose OWN on-disk
 *     path is safely inside the requested `<project>/_<kind>/` dir but which
 *     resolves to a DIFFERENT project's session — a check that only verifies
 *     "somewhere under projectsRoot" would miss this (the target is still
 *     under projectsRoot, just under a different project); the check must be
 *     scoped to the specific `<project>/_<kind>/` parent, not the whole
 *     projectsRoot tree. `resolveGuardedPath`'s per-segment walk additionally
 *     catches a symlinked `_<kind>` DIRECTORY itself (the R6-06 P0 shape,
 *     git-plantable via `git update-index --cacheinfo 120000` inside any
 *     onboarded project's own repo) — the one shape the old hand-rolled check
 *     missed.
 *   - `phase` is read from the session's real `status.json` through the SAME
 *     realpath-guarded choke point (`safeReadFileInSession`,
 *     packages/sessions/studio/session-transcript.ts) every other session file in
 *     this route goes through — never `readSessionStatus`
 *     (packages/sessions/interactive-session.ts:240), a plain
 *     existsSync/readFileSync with no realpath containment that would leak a
 *     symlinked status.json's outside content. `phase` is never fabricated.
 *     A resolved session dir with no readable, parseable, or string-`phase`
 *     `status.json` — including an escaping symlink, which is treated as
 *     unreadable — is a 404, not a 200 with a guessed or leaked phase.
 *
 *   - Traversal (session dirs AND status.json) is blocked for SYMLINK
 *     escapes via realpathSync. It is NOT blocked for HARDLINK escapes — a
 *     hardlink has no separate target to resolve away from — which is
 *     accepted, not fixed: creating a hardlink inside a session dir needs
 *     the same local write access as writing the outside content in
 *     directly, so the residual risk is negligible (see
 *     session-transcript.ts's module header for the full rationale).
 * W8-F6 (bead forge-6gv.27) — READ existence and WRITE existence are different
 * questions, deliberately. This GET serves a legacy session (working dir gone,
 * central event log intact) as 200; the cancel route
 * (packages/sessions/bridge-studio-session-cancel.ts) and the affordance dispatch
 * (cli/bridge-studio-affordances.ts) still 404 the same session, because THEIR
 * question is "is there a session dir to write into?" and the honest answer is
 * no. Both 404 BEFORE any write, so no phantom session dir is ever created for
 * one. The UI never puts an operator in front of that gap: a legacy session's
 * `lifecycle.cancellable` is false and its `affordances` are `[]`.
 *
 *   - `deriveSessionTranscript`'s `{ok:false}` (an unknown stage in a
 *     checkpoint, a malformed answers/questions/verdicts file) yields ZERO
 *     turns plus the verbatim reason on the ALWAYS-present `transcriptError`
 *     field — never smoothed into defaulted stages or a partial transcript,
 *     and (W7-C2 T1 review, P0-3) never a 409 that takes the whole page down
 *     with it: a corrupt verdicts.json used to make the session
 *     unrenderable, so the operator could not approve/reject/revise their
 *     way out of the very state that produced it. Fail-closed, scoped to the
 *     one pane. A `deriveSessionArtifact` throw (reserved artifact kind)
 *     surfaces as a 500 — never a 200 with an empty artifact.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';

import { sendJson, allowedOrigin, sanitizeError, pathOnly, parseQuery, resolveGuardedPath, type StudioContext } from '@forge/kernel';
import { computeAgentCleanupFindings } from '@forge/knowledge/bridge-studio-kbs.ts';
import { defaultConfigPath, loadConfig, resolveProjectsDir } from '@forge/kernel';
import { loadSessionKinds, type SessionKindDescriptor } from './studio/session-kinds.ts';
import { deriveSessionAffordances } from './studio/session-kinds-affordances.ts';
import { deriveSessionTranscript, deriveSessionArtifact, safeReadFileInSession, type ParseManifestPort } from './studio/session-transcript.ts';
import { resolveKbBrainDir } from '@forge/knowledge/brain-paths.ts';
import { deriveContractStages } from '@forge/projects/contract-stages.ts';
import { deriveSessionLifecycleFor } from './bridge-studio-lifecycle.ts';
import {
  decodeSegment,
  invalidProjectReason,
  invalidSessionIdReason,
  isTerminalPhase,
  resolveReadableSession,
} from './session-resolution.ts';
import { fixedTierForSessionKind } from './session-model-tier.ts';


const SESSION_ROUTE_RE = /^\/api\/studio\/sessions\/([^/]+)\/([^/]+)$/;

/** W6-B2 — this route is the generic "session-detail GET" EVERY session kind
 *  goes through (`apps/studio/app/sessions/[kind]/[sessionId]/page.tsx` calls
 *  `fetchSessionShell` for architect/instructions/project-brain/demo/
 *  onboarding/authoring/kb-cleanup alike), and for authoring + kb-cleanup it
 *  is the ONLY read route they have — neither has a per-kind list route like
 *  `/api/architect/sessions`. `ensureSessionTail` is threaded in here (rather
 *  than only from the four legacy per-kind list routes in apps/forge/ui-bridge.ts)
 *  so every kind's live event log gets tailed to the WS stream, closing bd
 *  forge-2ee's "no consumer reads the authoring spine's events dir" half. */
export type SessionsRouteContext = StudioContext & {
  ensureSessionTail: (kind: string, sessionId: string) => void;
  /** Injected `parseManifest` (flows is rank 5). Only the `roadmap-draft`
   *  artifact uses it, and REFUSES without it — an empty draft would read as
   *  "produced nothing" rather than "could not be read" (ruling 79/81). */
  parseManifest?: ParseManifestPort;
};


// ---------------------------------------------------------------------------
// W7-C2 (sessions-kinds-17/19, bead forge-lzv) — pending interview questions
// on the wire. `deriveSessionAffordances` is a PURE function over the
// descriptor (it can never read the session dir), so the file-backed half of
// the question-form affordance — the actual pending questions.json — is
// attached HERE, at the one place that already owns the guarded session-dir
// reads. Attached ONLY at phase 'awaiting-answers' (the same pending rule
// `deriveSessionTranscript`'s own AWAITING_ANSWERS_PHASE constant encodes —
// hand-copied literal per that module's convention): any other phase means
// questions.json is stale leftover from a prior round. The panel renders one
// control per entry and posts the REAL question text back with each answer,
// which is what keeps the durable answers.json record honest.
// ---------------------------------------------------------------------------

type PendingQuestion = {
  /** W7-C2 T1 review (A3, finding sessions-kinds-19) — the CORRELATION
   *  handle. questions.json carries no authored id (the shape is the
   *  reflector's `StructuredQuestion`: question/header/options), so the one
   *  honest, stable identity a pending question has is its POSITION in the
   *  round's file — rendered here as `q<1-based index>`. Derived, never
   *  stored: the same file always yields the same ids, and nothing has to
   *  keep a second copy in sync. The panel posts it back with each answer
   *  and `handleInstructionsAnswer` re-derives it from the SAME file to
   *  cross-check, so an edited/duplicated question TEXT can no longer
   *  mis-bind an answer. */
  readonly id: string;
  readonly question: string;
  readonly header?: string;
  readonly options: ReadonlyArray<{ readonly label: string; readonly description: string }>;
};

/** The 1-based positional id for the question at `index` of a round's
 *  questions.json. Exported so the WRITE route (cli/bridge-studio-
 *  affordances.ts) derives answer-correlation ids from this ONE rule
 *  instead of re-deriving its own. */
export function pendingQuestionId(index: number): string {
  return `q${index + 1}`;
}

const AWAITING_ANSWERS_PHASE = 'awaiting-answers';
const QUESTIONS_FILENAME = 'questions.json';

/** Structural parse of questions.json for the WIRE (display data). The
 *  transcript derivation has already fail-closed the whole read on a
 *  malformed file by the time this runs, so this parser only needs to shape
 *  what survived: `question` must be a string; `header` optional; `options`
 *  must be an array whose every entry carries string label+description.
 *
 *  W7-C2 T1 review (A4) — EVERY malformed shape returns null (the whole
 *  field is then absent and the panel falls back to the free-text box),
 *  including a malformed OPTION entry. The prior `flatMap` silently dropped
 *  a bad option, showing the operator FEWER choices than the agent asked
 *  for with no signal — a silent partial in a module whose stated
 *  discipline is fail-closed. This now matches the CLIENT's own rule
 *  (`parsePendingQuestionsMeta`, apps/studio/lib/session-client.ts) exactly,
 *  so the stricter side is no longer unreachable behind a pre-sanitising
 *  server. */
export function parsePendingQuestions(raw: string): PendingQuestion[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const questions: PendingQuestion[] = [];
  for (const [index, entry] of parsed.entries()) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const rec = entry as Record<string, unknown>;
    if (typeof rec.question !== 'string') return null;
    if (rec.options !== undefined && !Array.isArray(rec.options)) return null;
    const optionsRaw = Array.isArray(rec.options) ? rec.options : [];
    const options: { label: string; description: string }[] = [];
    for (const o of optionsRaw) {
      if (o === null || typeof o !== 'object' || Array.isArray(o)) return null;
      const or = o as Record<string, unknown>;
      if (typeof or.label !== 'string' || typeof or.description !== 'string') return null;
      options.push({ label: or.label, description: or.description });
    }
    questions.push({
      id: pendingQuestionId(index),
      question: rec.question,
      ...(typeof rec.header === 'string' ? { header: rec.header } : {}),
      options,
    });
  }
  return questions;
}

/** Attach `meta.questions` onto the question-form affordance when (and only
 *  when) a pending questions.json exists at awaiting-answers. Every other
 *  affordance rides through untouched. */
function attachPendingQuestions(
  affordances: ReturnType<typeof deriveSessionAffordances>,
  sessionDir: string,
  phase: string,
): ReturnType<typeof deriveSessionAffordances> {
  if (phase !== AWAITING_ANSWERS_PHASE) return affordances;
  if (!affordances.some((a) => a.kind === 'question-form' && a.phase === AWAITING_ANSWERS_PHASE)) return affordances;
  const raw = safeReadFileInSession(sessionDir, QUESTIONS_FILENAME);
  if (raw === null) return affordances;
  const questions = parsePendingQuestions(raw);
  if (questions === null || questions.length === 0) return affordances;
  return affordances.map((a) =>
    a.kind === 'question-form' && a.phase === AWAITING_ANSWERS_PHASE
      ? { ...a, meta: { ...(a.meta ?? {}), questions } }
      : a,
  );
}

/** W7-C2 (sessions-kinds-36) — the persisted "what this session produced"
 *  pointer, read off status.json, plus `exists` — whether the object it
 *  points at is STILL THERE, derived at read time.
 *
 *  W7-C2 T1 review (P0-4) — `exists` closes the dangling-pointer half of
 *  this field: `FinalizedLink` used to emit `/skills/<id>` off the stored
 *  pointer alone, so a deleted or renamed object left the operator a dead
 *  link forever. The pointer's IDENTITY is genuinely new information the
 *  finalizer alone knows (which library id the operator chose), so it stays
 *  persisted; its LIVENESS is derived from the filesystem on every read —
 *  never a second stored copy that can go stale. */
export type FinalizedPointer = { kind: string; id: string; exists: boolean };

/** Where each finalized `kind` lands its object. The ONE table that answers
 *  "does the thing this session produced still exist" — every entry resolves
 *  through the same `resolveGuardedPath` choke point the rest of this module
 *  uses (or, for a KB, through `resolveKbBrainDir`, the SAME resolver the
 *  cleanup-plan artifact branch above already trusts). An unrecognised kind
 *  is NOT dropped from the wire — it rides through with `exists: false`, and
 *  the panel renders the honest label with no link (never a guessed href). */
function finalizedObjectExists(
  kind: string,
  id: string,
  opts: { forgeRoot: string; projectsRoot: string; project: string },
): boolean {
  const guarded = (root: string, segs: readonly string[]): boolean => {
    const g = resolveGuardedPath(root, segs);
    return g.ok && g.exists;
  };
  switch (kind) {
    case 'skill': return guarded(opts.forgeRoot, ['skills', id]);
    case 'hook': return guarded(opts.forgeRoot, ['studio', 'hooks', id]);
    case 'community-registry': return guarded(opts.forgeRoot, ['studio', 'community', 'registry.yaml']);
    // `agents-md`/`demo` name the PROJECT they landed in (instructions writes
    // AGENTS.md at the project repo root; demo's lock lands at
    // .forge/demo/demo.lock.json — DEMO_LOCK_REL_PATH,
    // packages/sessions/kinds/demo-builder.ts, hand-copied as segments here the
    // same way this module hand-copies AWAITING_ANSWERS_PHASE).
    case 'agents-md': return guarded(opts.projectsRoot, [id, 'AGENTS.md']);
    case 'demo': return guarded(opts.projectsRoot, [id, '.forge', 'demo', 'demo.lock.json']);
    case 'kb': return resolveKbBrainDir(opts.forgeRoot, id) !== null;
    default: return false;
  }
}

/** Anything but the exact {kind: string, id: string} shape collapses to null
 *  (never echoed raw). */
function deriveFinalized(
  statusParsed: Record<string, unknown>,
  opts: { forgeRoot: string; projectsRoot: string; project: string },
): FinalizedPointer | null {
  const raw = statusParsed.finalized;
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.kind !== 'string' || typeof rec.id !== 'string') return null;
  return { kind: rec.kind, id: rec.id, exists: finalizedObjectExists(rec.kind, rec.id, opts) };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleStudioSessionsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: SessionsRouteContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  if (method !== 'GET') return false;

  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  const routeMatch = url.match(SESSION_ROUTE_RE);
  if (!routeMatch) return false;

  try {
    let kind: string;
    let sessionId: string;
    try {
      kind = decodeSegment(routeMatch[1]);
      sessionId = decodeSegment(routeMatch[2]);
    } catch {
      sendJson(res, 400, { error: 'invalid session route — malformed URL encoding' }, origin);
      return true;
    }

    // Slug-validate BOTH sessionId and project BEFORE any fs read (C1/C2
    // precedent, bridge-studio-runs.ts).
    const sessionIdInvalidReason = invalidSessionIdReason(sessionId);
    if (sessionIdInvalidReason) {
      sendJson(res, 400, { error: sessionIdInvalidReason }, origin);
      return true;
    }

    // W7-A2 — `?project=` is OPTIONAL: when present it is validated exactly
    // as before; when absent the anchor project is resolved server-side via
    // `findSessionProject` (below), so a deep link that omits it (or names
    // no guessable dot-anchor like `.kb-cycles`) still resolves.
    const projectRaw = parseQuery(rawUrl).get('project');
    if (projectRaw !== null) {
      const projectInvalidReason = invalidProjectReason(projectRaw);
      if (projectInvalidReason) {
        sendJson(res, 400, { error: projectInvalidReason }, origin);
        return true;
      }
    }

    // Resolve `kind` against the live registry — never a hardcoded switch, so
    // a new descriptor needs no code change here.
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

    const projectsRoot = resolveProjectsDir(resolve(ctx.forgeRoot), loadConfig(defaultConfigPath(ctx.forgeRoot)));

    // W8-F6 (bead forge-6gv.27) — ONE predicate decides where this session
    // lives and whether it can be read at all: `resolveReadableSession` (this
    // file, above). It performs EXACTLY the project resolution + guarded
    // status read this route used to inline, and only then falls back to the
    // session's central log dir. Every rejection reason maps back onto the
    // SAME response this route sent before, byte-identical (AT-70..74 pin the
    // two status buckets; AT-F6-R3/R4 re-pin them from the outside).
    const resolved = resolveReadableSession({
      projectsRoot, logsRoot: ctx.logsRoot, kind: descriptor.id, sessionId, project: projectRaw,
    });
    if (!resolved.ok) {
      if (resolved.reason === 'ambiguous') {
        sendJson(res, 409, { error: `session "${sessionId}" (kind "${kind}") exists under more than one project — pass ?project= to disambiguate`, kind, sessionId }, origin);
        return true;
      }
      const error =
        resolved.reason === 'status-missing' ? 'session not found (status.json is missing, unreadable, or not valid JSON)'
        : resolved.reason === 'status-no-phase' ? 'session not found (status.json has no string "phase" field)'
        : 'session not found';
      // `project` is echoed only when one was actually resolved — the
      // no-project 404 stays exactly the two-field body it has always been.
      sendJson(res, 404, resolved.project !== null ? { error, kind, sessionId, project: resolved.project } : { error, kind, sessionId }, origin);
      return true;
    }

    const project = resolved.project;
    const phase = resolved.phase;
    // W8-F6 — TRUE iff the only surviving state is the central log dir. Such a
    // session is served READ-ONLY: no transcript (its sources are gone), no
    // affordances (there is nowhere to write a turn), no tail.
    const legacy = resolved.source === 'legacy';
    // `sessionDir` for a legacy session is its LOG dir — deliberately, and only
    // so `deriveSessionArtifact` below can run its ONE real derivation against
    // a directory that provably holds none of the files any renderer scans
    // (a log dir holds events.jsonl / stderr.log / .heartbeat / turn.pid /
    // cancel.json, and not one of `manifests/`, `themes/`, `generations/`,
    // `staging/`, `plan/cleanup-plan.md`, `AGENTS.draft.md` — the real names,
    // packages/sessions/studio/session-transcript.ts:125,126,127,758,897,898;
    // enumerated on BOTH sides, zero intersection).
    // That yields each kind's genuine EMPTY artifact without a second,
    // hand-kept per-kind empty table here — pinned by AT-F6-R1.
    const sessionDir = resolved.source === 'status' ? resolved.sessionDir : resolved.logDir;
    const statusParsed: Record<string, unknown> | null = resolved.source === 'status' ? resolved.status : null;

    // W8-F6 — structural, not derived from the phase name: a legacy session has
    // no session dir left for a runner to advance or an affordance to write
    // into, so no further event can ever be appended to it, whatever phase its
    // log last recorded. `isTerminalPhase` still owns every OTHER session.
    const terminal = legacy ? true : isTerminalPhase(descriptor, phase);

    // W6-B2 — live-tail this session's event log (idempotent; no-ops for a
    // kind whose runner never writes `_logs/_<kind>-<sid>/events.jsonl`, e.g.
    // 'onboarding', which dispatches through a different, already-streaming
    // mechanism — see apps/forge/ui-bridge.ts's ensureSessionTail doc comment).
    // Gated on isTerminalPhase (review fix, MEDIUM 2): a terminal session
    // never appends further events, so tailing it would spin a permanent
    // 200ms poll with no per-tail teardown (ensureTailFor only stops ALL
    // tails together, on the last WS client disconnecting from the whole
    // bridge) — mirrors the legacy per-kind list routes' own terminal-phase
    // filter, derived (not re-invented) from the turnSpec table or
    // LEGACY_SESSION_TERMINAL_PHASES; see isTerminalPhase's own doc comment.
    // W8-F6 — gated on the COMPUTED `terminal` (above), so a legacy session
    // never opens a permanent 200ms tail on a log nothing will ever append to.
    if (!terminal) ctx.ensureSessionTail(descriptor.id, sessionId);

    // W7-C2 T1 review (P0-3) — fail-closed, SCOPED. A malformed transcript
    // source yields ZERO turns plus the verbatim reason on `transcriptError`
    // (below) — never defaulted stages, never a partial transcript, and
    // never a 409 that takes the operator's verdict controls down with it.
    // See the `transcriptError` field comment for the full rationale.
    // W8-F6 — a legacy session has NO transcript sources to scan (the dir that
    // held them is gone), so the derivation is not run at all: zero turns, zero
    // sources scanned, and `transcriptError: null` — nothing REFUSED, there was
    // simply nothing there. Running it against the log dir would report the
    // same empty result by accident; skipping it says so on purpose.
    const transcriptResult = legacy ? null : deriveSessionTranscript({ descriptor, sessionDir, phase });
    const transcriptError = transcriptResult === null || transcriptResult.ok ? null : transcriptResult.error.message;
    const turns = transcriptResult !== null && transcriptResult.ok ? transcriptResult.turns : [];

    let artifact: unknown;
    try {
      // R4-17 — the 'contract-buildout' kind needs rows derived from the
      // PROJECT tree (outside sessionDir's own containment — D4), so they
      // are computed HERE, via packages/projects/contract-stages.ts's own realpath-guarded
      // containment, and threaded in verbatim. A {ok:false} derivation (an
      // unknown/escaping project, or a malformed .forge/project.json)
      // surfaces as a 409 naming the cause — never a 200 with an empty
      // artifact, mirroring the fail-closed pass-through just above for
      // deriveSessionTranscript.
      if (legacy) {
        // W8-F6 — the SAME derivation every other session goes through, handed
        // this session's log dir (see `sessionDir`'s note above). The two kinds
        // that REQUIRE caller-supplied data get honest empties: a legacy
        // onboarding/kb-cleanup session's stages and findings describe live
        // project/KB state that this dead session neither produced nor owns.
        artifact = deriveSessionArtifact({ descriptor, sessionDir, contractStages: [], cleanupFindings: [], parseManifest: ctx.parseManifest });
      } else if (descriptor.artifact.kind === 'contract-buildout') {
        const contractResult = deriveContractStages({ forgeRoot: ctx.forgeRoot, projectsRoot, projectId: project });
        if (!contractResult.ok) {
          sendJson(res, 409, { ok: false, error: contractResult.error.message }, origin);
          return true;
        }
        artifact = deriveSessionArtifact({ descriptor, sessionDir, contractStages: contractResult.rows, parseManifest: ctx.parseManifest });
      } else if (descriptor.artifact.kind === 'cleanup-plan') {
        // R4-19-F2 — the kb-cleanup session needs a LIVE, KB-scoped
        // brain-lint pass (derive-don't-store: the plan file on disk only
        // ever supplies the agent's PROPOSED actions, never current truth).
        // `kb_id` comes from the session's own status.json — an
        // unresolvable kb_id (the KB was deleted/renamed since the session
        // started) fails LOUD here, naming it, rather than falling through
        // to deriveSessionArtifact with no cleanupFindings (which would
        // throw a DIFFERENT, less specific error) or smoothing into a 200
        // with an empty artifact.
        const kbId = typeof statusParsed?.kb_id === 'string' ? statusParsed.kb_id : null;
        if (kbId === null) {
          sendJson(res, 409, { ok: false, error: `session "${sessionId}" status.json has no string "kb_id" — cannot compute live cleanup findings` }, origin);
          return true;
        }
        let cleanupFindings: ReturnType<typeof computeAgentCleanupFindings>;
        try {
          cleanupFindings = computeAgentCleanupFindings(ctx.forgeRoot, kbId);
        } catch (findingsErr) {
          sendJson(res, 409, { ok: false, error: sanitizeError(findingsErr) }, origin);
          return true;
        }
        // R4-19-F2 fail-safe fix (ORCHESTRATOR RULING) — the scanned-domain
        // signal that makes 'cleared' derivable at all (see session-
        // transcript.ts's CleanupScan doc). Resolved via the SAME
        // `resolveKbBrainDir` choke point `computeAgentCleanupFindings`
        // itself already used, immediately above, to scope the live lint
        // pass — so `brainDir` names exactly the region that was actually
        // scanned. A TOCTOU miss (the KB vanishes between the two calls,
        // vanishingly unlikely) degrades to `cleanupScan` omitted, i.e.
        // every unmatched action stays 'unknown' — fail SAFE, never a hard
        // 500 for a signal that is advisory, not load-bearing for the
        // read's own success.
        const brainDir = resolveKbBrainDir(ctx.forgeRoot, kbId);
        const cleanupScan = brainDir !== null ? { forgeRoot: ctx.forgeRoot, brainDir } : undefined;
        artifact = deriveSessionArtifact({ descriptor, sessionDir, cleanupFindings, cleanupScan, parseManifest: ctx.parseManifest });
      } else {
        artifact = deriveSessionArtifact({ descriptor, sessionDir, parseManifest: ctx.parseManifest });
      }
    } catch (err) {
      // A reserved (or otherwise unrecognised) artifact kind — an explicit
      // error, never a 200 with an empty artifact.
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
      return true;
    }

    sendJson(
      res,
      200,
      {
        ok: true,
        kind: descriptor.id,
        // R2-10 PR2, WI-8: the descriptor's declared `title` (studio/session-
        // kinds.yaml), threaded through verbatim — mirrors how `artifact.label`
        // already flows via `deriveSessionArtifact`. Closes a declared-data-
        // with-no-consumer gap: `title` was parsed and lint-validated but the
        // session-shell page previously hardcoded its own local heading map
        // instead of reading it off the wire.
        title: descriptor.title,
        sessionId,
        project,
        phase,
        stages: descriptor.stages,
        defaultStage: descriptor.defaultStage,
        turns,
        artifact,
        // W6-B3 (ADR-043 2026-08-15 amendment §1/§2) — the derived affordance
        // view for the CURRENT phase; see this file's header for the full
        // contract note. Computed unconditionally (never omitted) — a kind
        // with no turnSpec/panel (architect) yields `[]`, not a missing key.
        // W7-C2: the question-form affordance additionally carries the
        // PENDING questions at awaiting-answers (attachPendingQuestions —
        // file-backed data the pure derivation cannot read itself).
        // W8-F6 — a legacy session derives NO affordance: every affordance is a
        // control that writes into the session dir, and there is no session dir.
        // An empty array here is the honest answer, not a suppressed one.
        affordances: legacy ? [] : attachPendingQuestions(deriveSessionAffordances(descriptor, phase), sessionDir, phase),
        // W6-B6 (ADR-043 2026-08-15 amendment §3) — see this file's header
        // note. Read directly off the already-parsed `statusParsed`, the
        // SAME realpath-guarded read every other field on this envelope
        // comes from; never a second, unguarded status read.
        // W8-B3 (sessions-kinds-R06/31) — when the session recorded no tier,
        // fall back to the kind's agent's FIXED tier, derived live off its
        // SKILL.md. Scoped to `strategy:fixed` on purpose: such an agent has
        // exactly one legal tier, so a session of that kind provably ran on
        // it; a `strategy:range` agent's untiered session ran on whatever the
        // default was at the time, which today's default may no longer be, so
        // "not recorded" stays the honest answer there. Never stored — a
        // skill re-pointed at a different model cannot leave a stale copy.
        // W8-F6: a legacy session recorded no status.json at all, so it falls
        // straight to the kind's FIXED tier (derived live off the agent's
        // SKILL.md) or `null` — never a fabricated tier.
        modelTier: typeof statusParsed?.modelTier === 'string'
          ? statusParsed.modelTier
          : fixedTierForSessionKind(ctx.forgeRoot, descriptor),
        // W6-B8 — the SAME `isTerminalPhase` derivation this route already
        // used internally to gate `ensureSessionTail` (this file's header),
        // now also threaded onto the wire (ALWAYS present, never omitted —
        // mirrors `affordances`' own unconditional presence) so the generic
        // `SessionInteractivePanel` can gate its ActivityLog drawer without a
        // second, hand-kept terminal-phase table client-side.
        terminal,
        // W8-F6 (bead forge-6gv.27) — ALWAYS present, mirroring `terminal`:
        // this session's project-side working dir is gone and everything above
        // was derived from its central event log alone. The shell renders an
        // explicit read-only notice on it rather than an empty live session.
        legacy,
        // W8-B3 (ON-5) — REPLACES W7-FIX-A2's `transcript: descriptor.turnSpec
        // === undefined`. That boolean was a STORED PROXY for "does this kind
        // record turns", and it was factually wrong: its own comment claimed a
        // `turnSpec` kind "never writes the transcript files", but `authoring`
        // declares a turnSpec AND its start route (`writeAuthoringSession`,
        // apps/forge/ui-bridge.ts) writes `prompt.md` before the generic spine ever
        // runs — so the wire said "records no turns" for a kind that records
        // one from second zero. Measured, not argued: driving the real writer
        // and the real derivation yields `turns=1, source=prompt.md`.
        //
        // What ships instead is the FACT, derived by the same reads that built
        // `turns`: which of the scanned candidate sources actually exist here.
        // The consumer (apps/studio/lib/session-shell-view.ts's
        // `deriveSessionPanes`) decides whether a transcript pane belongs from
        // `turns` + the live affordances — there is no longer any field for a
        // writer to leave a stale per-kind copy in. ALWAYS present, mirroring
        // `terminal`/`affordances`.
        transcriptSources: transcriptResult !== null && transcriptResult.ok ? [...transcriptResult.sourcesFound] : [],
        // W7-A2 — the DERIVED lifecycle view (packages/sessions/bridge-studio-lifecycle.ts):
        // state (working | awaiting-operator | crashed | stalled | terminal),
        // a truthful `needsYou`, the runner's crash text read live off
        // `_logs/_<kind>-<sid>/stderr.log`, idle time, and cancellability.
        // Derived at read time from the phase row + on-disk liveness facts —
        // nothing here is ever stored on status.json (derive-don't-store).
        // ALWAYS present, mirroring `affordances`/`terminal`.
        lifecycle: deriveSessionLifecycleFor({
          descriptor, phase, terminal, project, sessionId, projectsRoot, logsRoot: ctx.logsRoot,
        }),
        // W7-C2 (sessions-kinds-36) — ALWAYS present, mirroring
        // `modelTier`'s own null-is-honest convention: the persisted
        // {kind, id} pointer at whatever object a committed session
        // produced (runFinalize writes it; historically the now-retired
        // community-refresh kind's own approve arm did too — those old
        // sessions still carry the pointer on disk), or null for a session
        // that produced nothing.
        // W8-F6: no status.json ⇒ no persisted pointer ⇒ `null`, the same
        // honest-absent value a session that produced nothing already gets.
        finalized: statusParsed === null ? null : deriveFinalized(statusParsed, { forgeRoot: ctx.forgeRoot, projectsRoot, project }),
        // W7-C2 T1 review (P0-3, finding A2/F2) — the transcript's own
        // fail-closed error, SCOPED to the transcript. It used to 409 the
        // WHOLE session GET, which made a corrupt verdicts.json brick the
        // page: no verdict controls, so the operator could not approve,
        // reject or revise their way out of it. Fail-closed semantics are
        // unchanged (nothing malformed is ever silently dropped or
        // smoothed into fabricated turns — `turns` is EMPTY, never
        // partial), but the blast radius is now one pane: the shell still
        // renders, the affordances still work, and the transcript pane
        // shows this message verbatim. ALWAYS present, mirroring
        // `terminal`/`affordances`/`finalized`; null when the derivation
        // succeeded.
        transcriptError,
      },
      origin,
    );
    return true;
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
    return true;
  }
}
