/**
 * The shared shell every per-kind affordance arm calls, and the context type
 * both the assembly and the arms import. It is a THIRD module because the
 * dispatch imports the kinds, so anything a kind imported back out of the
 * dispatch would be a cycle. See `design.md` for the rest.
 */
import type { AuthoringSessionPort } from '@forge/library/studio/authoring-session.ts';
import type { ServerResponse } from 'node:http';

import { sendJson, guardedWriteFile, type StudioContext } from '@forge/kernel';
import type { approveKbCleanup } from '@forge/knowledge/bridge-studio-kbs.ts';
import type { SessionKindDescriptor } from './studio/session-kinds.ts';
import type { SessionAffordance, SessionAffordanceKind } from './studio/session-kinds-affordances.ts';
import { guardedWriteSessionStatus } from './session-status-io.ts';
import type { SpawnTurnOutcome } from './bridge-studio-session-helpers.ts';
import { MAX_ANSWER_FIELD_BYTES } from './session-answer-limits.ts';

export type { SpawnTurnOutcome };
export { MAX_ANSWER_FIELD_BYTES };

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

export function unhandledAffordanceBody(kind: SessionAffordanceKind, error: string): UnhandledAffordanceBody {
  return { ok: false, kind, error };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/** The subset of `SpawnableAgentId` (`apps/forge/ui-bridge.ts`) this route ever
 *  spawns a turn for — never `architect` (no writable affordance) or
 *  `project-brain` (no verdict/question-form row in its panel). W7-C2: the
 *  generic-spine kinds (`authoring`/`kb-cleanup`) joined for the REVISE
 *  verdict — a revise sends the session back to its agent phase and spawns
 *  the next turn through the SAME detached `spawnAgentTurn` their own start
 *  routes already use (authoring's APPROVE still runs its turn INSIDE
 *  `runFinalize`, unchanged). */
export type LegacySpawnableAgentId = 'instructions' | 'demo-builder' | 'authoring' | 'kb-cleanup';

/**
 * What this dispatch needs from the bridge it runs on.
 *
 * `StudioContext` is `@forge/kernel`'s `{forgeRoot, logsRoot}` — the two the
 * arms below actually read. The other four are per-bridge state or host
 * machinery this package may not import, so they are INJECTED at assembly
 * (`routes.ts`), never asserted into existence with a cast: a field the
 * context does not declare compiles and then reads `undefined` at runtime,
 * which is the defect 36 tests named during the routes carve (§15.66).
 */
export type AffordanceRouteContext = StudioContext & {
  /** Ruling 30: a mutating route takes its parsed body from the context. The
   *  host owns request policy (the 1 MiB cap, CSRF); this package never
   *  reaches into `cli/` for a body reader. */
  readBody: () => Promise<unknown>;
  /** `cli/dry-bridge.ts`'s turn marker, injected for the same reason
   *  `spawnAgentTurn` is: host machinery, and its kernel move is only
   *  half-done (see `SessionHostSurface`'s own note). */
  dryBridgeAgentTurnMarker: (logsRoot: string, route: string, sessionId: string) => Record<string, unknown>;
  authoringSession: AuthoringSessionPort;
  /** Injected from `apps/forge/ui-bridge.ts` — see this file's header for why this
   *  is dependency-injected rather than imported: delegates to the EXACT
   *  SAME `spawnAgentTurn` every bespoke per-kind route already calls, not a
   *  reimplementation. */
  spawnAgentTurn: (forgeRoot: string, agentId: LegacySpawnableAgentId, project: string, sessionId: string) => SpawnTurnOutcome;
  /** M4 ruling 86 — the real brain-fix turn, injected like `spawnAgentTurn`:
   *  knowledge declares the port (rank 2), sessions implements it (rank 4),
   *  the binding is at the assembly. DERIVED from `approveKbCleanup`'s own
   *  parameter, not imported: naming the port type would mint a fresh
   *  `cli/ -> packages/knowledge` row for a type this file already reaches. */
  runFixTurn: NonNullable<Parameters<typeof approveKbCleanup>[3]>['runFixTurn'];
  /** W7-C2 T1 review (A12) — the ONE per-kind live-refresh seam, the SAME
   *  mapping `handleSessionCancelRoute` is already injected with
   *  (apps/forge/ui-bridge.ts). Replaces the two hand-kept
   *  `broadcastInstructionsChanged`/`broadcastDemoChanged` calls that used
   *  to live inline here: this module no longer keeps its own per-kind list
   *  of which kinds have a list-changed WS event. A kind with no event
   *  (authoring / kb-cleanup — no `*-list-changed` message exists in the
   *  bridge's WS vocabulary) honestly no-ops; those surfaces refresh on the
   *  session shell's own 3s poll (SHELL_POLL_MS,
   *  apps/studio/app/sessions/[kind]/[sessionId]/page.tsx). */
  broadcastKindChanged: (kind: string) => void;
};

/** Minimal `JSON.parse` wrapper — NOT a security primitive (no guard/write
 *  behaviour to delegate to; a bare `JSON.parse` around a value already read
 *  through `guardedReadFile`), so a local copy here is not "reimplementing a
 *  write+spawn helper" the task brief asks to delegate. */
export function safeParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// question-form — instructions' interview-answer round
// (`awaiting-answers-question-form` — mirrors `POST /api/instructions/answer`,
// `apps/forge/ui-bridge.ts:3236`). W6-B9 — instructions' `briefing` phase ALSO
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

export function answersCapReason(answers: readonly { question: string; answer: string }[]): string | null {
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
// (`apps/forge/ui-bridge.ts:2124`), so no REAL spawn ever happened — but the 200
// body silently omitted the `dryBridge:{skipped:['agent-turn']}` disclosure
// every bespoke per-kind spawn route already gives the same caller (e.g.
// `POST /api/instructions/brief`, `apps/forge/ui-bridge.ts:3310`), a parity gap
// this batch has otherwise been careful to close. ONE shared helper (not
// four repeated `...dryBridgeAgentTurnMarker(...)` call sites) — `route` is
// a fixed, literal identifier for this generic dispatch point (mirrors
// `BRIDGE_ROUTE_CLASSIFICATION`'s own `:id`-style placeholder convention,
// `cli/dry-bridge.ts` — documentation, not a router pattern), never the
// bespoke route name a given call happens to mirror, so the emitted
// `dry-bridge.skip` event names what ACTUALLY handled the request.
// ---------------------------------------------------------------------------

const GENERIC_AFFORDANCE_ROUTE = '/api/studio/sessions/:kind/:sessionId/:affordance';

export function affordanceDryBridgeMarker(ctx: AffordanceRouteContext, sessionId: string): Record<string, unknown> {
  return ctx.dryBridgeAgentTurnMarker(ctx.logsRoot, GENERIC_AFFORDANCE_ROUTE, sessionId);
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
export function reviseSpawnAgentId(descriptorId: string): LegacySpawnableAgentId | null {
  switch (descriptorId) {
    case 'instructions': return 'instructions';
    case 'demo': return 'demo-builder';
    case 'authoring': return 'authoring';
    case 'kb-cleanup': return 'kb-cleanup';
    default: return null;
  }
}

export function handleGenericRevise(
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
  // packages/sessions/bridge-studio-lifecycle.ts). feedback.md deliberately stays: it is
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
