/**
 * The single generic interactive-turn runner (ADR-043 §2, R4-22 WI-3):
 * `runInteractiveTurn(descriptor, ctx)` is the ONE spine every future
 * `turnSpec`-bearing session kind runs through instead of a bespoke
 * `orchestrator/*-runner.ts` (architect-runner.ts / instructions-runner.ts /
 * demo-builder-runner.ts / project-brain-builder-runner.ts — all four stay
 * byte-for-byte untouched; ADR-043 §3's dispatch fork lives in
 * `cli/agent-run.ts`, NOT here).
 *
 * Owns, ONCE, everything those four duplicate:
 *   - the SEC-04 containment preamble: `resolveGuardedPath(projectRoot,
 *     [turnSpec.kindDir, sessionId])` -> `guardedReadSessionStatus`;
 *   - the ADR-024 spec/model/prompt derivation:
 *     `deriveAgentSpec(skillPathRelative(agent))` -> `modelForSpec` -> the
 *     tool grant, `SKILL.md` as the runtime prompt;
 *   - the shared telemetry: `createLogger` / `makeToolEventSink` /
 *     `flushIteration(1)` / a heartbeat writer / a reasoning sink;
 *   - the phase-table dispatch loop: read `status.phase` -> find its row in
 *     `turnSpec.phases` -> run the row's `step` (`agent` via the `style`
 *     primitive — `runAgentTurn` for `style: agent`, `runStructuredTurn` for
 *     `style: structured`; `noop`; `finalize` via the named finalizer;
 *     `terminal`) -> advance to `next`.
 *
 * Modeled on `orchestrator/project-brain-builder-runner.ts` and
 * `orchestrator/instructions-runner.ts` (the closest analogues); reuses their
 * shared helpers in `orchestrator/interactive-session.ts` rather than
 * re-implementing them.
 *
 * ---------------------------------------------------------------------------
 * Two design calls this WI had to make that ADR-043 / the WI-3 brief leave
 * open (stated explicitly, per this initiative's own precedent) — REVISED
 * by the R4-22 WI-3 adversarial-review round's Finding 5 ruling (superseding
 * this file's own original design call #1, which used `skillsDir`):
 * ---------------------------------------------------------------------------
 *
 *   1. `FinalizerContext.libraryRoot` — Finding 5 (reviewer-proven): the
 *      original `skillsDir(forgeRoot)` wrote into `<forgeRoot>/skills`, the
 *      LIVE tree production agent discovery actually scans
 *      (`listAgentDefinitions`/`discoverRuntimeAgentIds` —
 *      `orchestrator/flow-runner.ts:1285`, `cli/ui-bridge.ts:1678` — promote
 *      ANY dir whose `SKILL.md` carries a `runtime:` key to a dispatchable
 *      agent, no slug gate). Ruling: the destination is now a dedicated,
 *      NON-scanned root, `<forgeRoot>/_interactive-library/<packageId>/...`
 *      — underscore-prefixed, matching the repo's `_queue`/`_logs`
 *      convention for non-registry dirs. Resolved through the SAME guard as
 *      before (`resolveGuardedPath(forgeRoot, [INTERACTIVE_LIBRARY_DIRNAME])`
 *      + a GUARD-TERMINAL `mkdirSync` of its own `.realPath` when absent —
 *      never inventing a new root to sidestep "does not exist"); `skillsDir`
 *      / `hooksDir` are no longer touched by this file at all, so a fresh
 *      `forgeRoot`'s `skills/` is never created as a side effect of a
 *      finalize that never needed it. PROVISIONAL: this destination is
 *      superseded once R4-21 wires the draft-gated `installSkillPackage`
 *      path onto a permanent library location.
 *   2. `FinalizerContext.packageId` — request-derived, so it MUST ride as its
 *      own guarded segment (never folded into `libraryRoot`; the finalizer's
 *      own `resolveGuardedPath(libraryRoot, [packageId, ...])` call is what
 *      actually enforces this). Finding 5(c) (reviewer-proven): the ORIGINAL
 *      `packageId: ctx.sessionId` ran through only `resolveGuardedPath`'s
 *      generic `isSafeSegment` — unlike every other writer into a package
 *      tree (which slug-validates via `SLUG_RE`/`assertSkillSlug`), so a raw
 *      session id landed as a directory name verbatim. Ruling: `packageId`
 *      MUST now be `SLUG_RE`-valid or the turn refuses loudly. Derivation:
 *      prefer the session's OWN declared identity — `status.session_id` when
 *      it is present as a string (the "declared package id" the session
 *      status itself carries) — falling back to `ctx.sessionId` (the
 *      already-SEC-04-checked request identity) only when `status` carries
 *      no such field; whichever value that resolves to is then validated
 *      against `SLUG_RE` and used UNMODIFIED — this file never sanitizes or
 *      invents a substitute slug. NOTE (stated honestly, not silently
 *      resolved): `SLUG_RE` requires a leading lowercase letter, so an
 *      ISO-timestamp-shaped session id (e.g. `2026-08-10T00-00-00`) is NOT a
 *      valid slug and a `committing` turn for such a session now refuses at
 *      the finalize step — this is the Finding-5(c) ruling applied
 *      faithfully, not an oversight; see this WI's report for the one
 *      pinned-suite fixture (AT-3, `interactive-runner.test.ts`) that shares
 *      exactly this fixture shape with Finding 5(c) and is affected by it.
 *
 * `result.artifacts` is deliberately always `{}` — ADR-043's signature
 * (`Record<string, unknown>`) states no key contract, and the pinned test
 * suite (`interactive-runner.test.ts`) explicitly leaves it unasserted
 * rather than guessing one.
 */

import { readFileSync, readdirSync, lstatSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { pinnedSdkQuery as sdkQuery } from './pinned-sdk-query.ts';

import {
  runAgentTurn,
  guardedReadSessionStatus,
  guardedWriteSessionStatus,
  makeHeartbeatWriter,
  type QueryFn,
} from './interactive-session.ts';
import { createLogger, type EventLogger, type Phase } from './logging.ts';
import { resolveGuardedPath } from '../cli/studio-path-guard.ts';
import { makeToolEventSink } from './tool-event-emit.ts';
import { modelForSpec } from './phase-agent.ts';
import { deriveAgentSpec } from './studio/derive.ts';
import { skillPath, skillPathRelative, SLUG_RE } from './skill-path.ts';
import { resolveFinalizer, type FinalizerContext } from './interactive-finalizers.ts';
import type { SessionKindDescriptor, TurnSpec, TurnSpecPhase } from './studio/session-kinds.ts';

/**
 * Named error type for this module (mirrors `interactive-finalizers.ts`'s
 * own `InteractiveFinalizerError` convention — same shape, deliberately NOT
 * cross-imported, so this module's error identity stays local). Every throw
 * this file adds for the R4-22 WI-3 adversarial-review findings (ghost
 * `next`, a guard-rejected `writes:` entry, a non-slug `packageId`) uses
 * this class so a caller can distinguish "the runner refused this turn" from
 * an unrelated crash bubbling up through the same call.
 */
export class InteractiveRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InteractiveRunnerError';
    // Belt-and-suspenders under ES5-target transpilation — see
    // InteractiveFinalizerError's identical comment for why this matters.
    Object.setPrototypeOf(this, InteractiveRunnerError.prototype);
  }
}

/** Finding 5's dedicated, NON-scanned finalize-destination root — see the
 *  header note. Underscore-prefixed, matching `_queue`/`_logs`. PROVISIONAL:
 *  superseded once R4-21 wires the draft-gated `installSkillPackage` path. */
const INTERACTIVE_LIBRARY_DIRNAME = '_interactive-library';

/** No dedicated `interactive`/`session` Phase value exists in the closed
 *  `Phase` union (`orchestrator/logging.ts`) — adding one is out of this
 *  file's scope (logging.ts is not one of this WI's two files). `orchestrator`
 *  is the generic, non-committal bucket for cross-cutting spine plumbing. */
const RUNNER_PHASE: Phase = 'orchestrator';
const RUNNER_SKILL = 'interactive-runner';
const MAX_REASONING_TEXT = 400;

/** Generic over any `{ phase: string, … }` JSON — mirrors how
 *  `guardedReadSessionStatus<S>` is generic in interactive-session.ts. Every
 *  real session-kind status shape (InstructionsStatus, ProjectBrainStatus,
 *  a future turnSpec-driven status) satisfies this structurally. */
export type InteractiveTurnStatus = { phase: string } & Record<string, unknown>;

export type RunInteractiveTurnCtx = {
  sessionId: string;
  projectRoot: string;
  /** Forge install root (finalizer library root, log root default). Defaults
   *  to `resolve('.')` — NOT threaded into skill/agent-spec resolution (see
   *  header note — those always resolve against the real forge install). */
  forgeRoot?: string;
  /** Inject a fake `query` for tests. Defaults to the SDK. */
  queryFn?: QueryFn;
  /** `_logs/` root; defaults to `<forgeRoot>/_logs`. */
  logsRoot?: string;
  /** Logger override (tests). */
  logger?: EventLogger;
};

export type RunInteractiveTurnResult = {
  phase: string;
  wrote: string[];
  artifacts: Record<string, unknown>;
};

export async function runInteractiveTurn(
  descriptor: SessionKindDescriptor,
  ctx: RunInteractiveTurnCtx,
): Promise<RunInteractiveTurnResult> {
  const turnSpec = descriptor.turnSpec;
  if (!turnSpec) {
    throw new Error(
      `runInteractiveTurn: session kind "${descriptor.id}" has no turnSpec — this runner only drives turnSpec-bearing descriptors (ADR-043 §1).`,
    );
  }

  // -------------------------------------------------------------------------
  // SEC-04 containment preamble — BEFORE any read/write. `kindDir` and
  // `sessionId` each ride as their OWN segment against the trusted
  // `projectRoot` root; never folded into it (the guard's own CONTRACT).
  // -------------------------------------------------------------------------
  const dirSegments = [turnSpec.kindDir, ctx.sessionId];
  const guarded = resolveGuardedPath(ctx.projectRoot, dirSegments);
  if (!guarded.ok) {
    throw new Error(
      `runInteractiveTurn: session dir failed containment for session kind "${descriptor.id}" / session "${ctx.sessionId}" (${guarded.reason}). Has the session been started?`,
    );
  }
  const sessionDir = guarded.realPath;

  // SEC-04 leaf: route the status.json READ through the guarded sibling
  // (leaf included) so a symlinked/hardlinked status.json inside the real,
  // contained session dir is refused too.
  const status = guardedReadSessionStatus<InteractiveTurnStatus>(ctx.projectRoot, dirSegments);
  if (!status) {
    throw new Error(
      `runInteractiveTurn: no status.json at ${sessionDir} for session kind "${descriptor.id}". Has the session been started?`,
    );
  }

  // -------------------------------------------------------------------------
  // Phase-table dispatch — an unhandled status.phase fails LOUD, naming it
  // (the declared-data-fails-open antipattern this campaign guards against).
  // -------------------------------------------------------------------------
  const phaseRow = turnSpec.phases.find((p) => p.phase === status.phase);
  if (!phaseRow) {
    const known = turnSpec.phases.map((p) => p.phase).join(', ') || '(none declared)';
    throw new Error(
      `runInteractiveTurn: session kind "${descriptor.id}" turnSpec.phases has no row for phase "${status.phase}" (session ${ctx.sessionId}). Known phases: ${known}.`,
    );
  }

  const forgeRoot = ctx.forgeRoot ?? resolve('.');
  const logsRoot = ctx.logsRoot ?? resolve(forgeRoot, '_logs');
  const cycleId = `_interactive-${descriptor.id}-${ctx.sessionId}`;
  const initiativeId = `interactive-${descriptor.id}-${ctx.sessionId}`;
  const logger = ctx.logger ?? createLogger(cycleId, logsRoot);
  const queryFn: QueryFn = ctx.queryFn ?? (sdkQuery as unknown as QueryFn);

  const startEv = logger.emit({
    initiative_id: initiativeId,
    phase: RUNNER_PHASE,
    skill: RUNNER_SKILL,
    event_type: 'start',
    input_refs: [join(sessionDir, 'status.json')],
    output_refs: [],
    message: `interactive turn (kind=${descriptor.id}, phase=${status.phase}, step=${phaseRow.step})`,
    metadata: { session_id: ctx.sessionId, session_kind: descriptor.id, phase: status.phase, step: phaseRow.step },
  });

  const sink = makeToolEventSink(logger, {
    initiativeId,
    parentEventId: startEv.event_id,
    phase: RUNNER_PHASE,
    skill: RUNNER_SKILL,
  });
  const onHeartbeat = makeHeartbeatWriter(join(logsRoot, cycleId));
  const onText = makeReasoningSink(logger, initiativeId, ctx.sessionId);

  let result: RunInteractiveTurnResult;

  switch (phaseRow.step) {
    case 'noop':
    case 'terminal':
      // No `next` is ever declared on a noop/terminal row in practice
      // (ADR-043's worked example); even if one were, a noop/terminal step
      // performs no work to justify advancing on — the phase stays put.
      result = { phase: status.phase, wrote: [], artifacts: {} };
      break;

    case 'agent':
      result = await runAgentStyleStep({
        descriptor,
        turnSpec,
        phaseRow,
        ctx,
        sessionDir,
        dirSegments,
        status,
        queryFn,
        onToolUse: sink.onToolUse,
        onHeartbeat,
        onText,
      });
      break;

    case 'finalize':
      result = await runFinalizeStep({
        descriptor,
        turnSpec,
        phaseRow,
        ctx,
        sessionDir,
        dirSegments,
        status,
        forgeRoot,
      });
      break;

    default:
      throw new Error(
        `runInteractiveTurn: session kind "${descriptor.id}" turnSpec phase "${phaseRow.phase}" declares unknown step "${phaseRow.step}" — expected one of agent|noop|finalize|terminal.`,
      );
  }

  sink.flushIteration(1);
  logger.emit({
    initiative_id: initiativeId,
    parent_event_id: startEv.event_id,
    phase: RUNNER_PHASE,
    skill: RUNNER_SKILL,
    event_type: 'end',
    input_refs: [],
    output_refs: result.wrote,
    message: `interactive turn end (kind=${descriptor.id}, phase=${result.phase})`,
    metadata: { session_id: ctx.sessionId, session_kind: descriptor.id, phase: result.phase },
  });
  return result;
}

// ---------------------------------------------------------------------------
// step: agent — dispatches on turnSpec.style (runAgentTurn | runStructuredTurn)
// ---------------------------------------------------------------------------

async function runAgentStyleStep(args: {
  descriptor: SessionKindDescriptor;
  turnSpec: TurnSpec;
  phaseRow: TurnSpecPhase;
  ctx: RunInteractiveTurnCtx;
  sessionDir: string;
  dirSegments: string[];
  status: InteractiveTurnStatus;
  queryFn: QueryFn;
  onToolUse: Parameters<typeof runAgentTurn>[0]['onToolUse'];
  onHeartbeat: () => void;
  onText: (text: string) => void;
}): Promise<RunInteractiveTurnResult> {
  const { descriptor, turnSpec, phaseRow, ctx, sessionDir, dirSegments, status, queryFn, onToolUse, onHeartbeat, onText } = args;

  // ADR-024: spec/model/prompt derivation from the agent's OWN SKILL.md —
  // resolved against the real forge install (deriveAgentSpec's default root),
  // never `ctx.forgeRoot` — the agent/skill roster is part of the forge
  // install, not per-project/per-test data (see header note).
  const agentSpec = deriveAgentSpec(skillPathRelative(descriptor.agent));
  const model = modelForSpec(agentSpec);
  const skill = readSkillPrompt(descriptor.agent);
  const prompt = buildTurnPrompt(descriptor, phaseRow, status, skill);

  if (turnSpec.style === 'agent') {
    await runAgentTurn({
      queryFn,
      prompt,
      cwd: sessionDir,
      model,
      allowedTools: agentSpec.allowedTools,
      disallowedTools: agentSpec.disallowedTools,
      onToolUse,
      onHeartbeat,
      onText,
      label: `interactive-${descriptor.id}-${ctx.sessionId}`,
    });
  } else if (turnSpec.style === 'structured') {
    // No schema registry exists yet — SCHEMA_IDS ships empty (R4-22 WI-1's
    // own deliberately-green gap-pin, orchestrator/studio/session-kinds.ts).
    // Fail LOUD rather than fabricate a schema or silently fall back to the
    // agent primitive — the declared-data-fails-open shape this campaign
    // guards against.
    throw new Error(
      `runInteractiveTurn: session kind "${descriptor.id}" turnSpec.style is "structured", but no schema registry is wired yet (turnSpec.schema="${turnSpec.schema ?? '(none)'}"). No structured-style turnSpec consumer exists; wire a schema resolver before shipping one.`,
    );
  } else {
    throw new Error(
      `runInteractiveTurn: session kind "${descriptor.id}" turnSpec.style "${turnSpec.style}" is unrecognised — expected "agent" or "structured".`,
    );
  }

  const wrote = listWrittenFiles(sessionDir, phaseRow.writes ?? []);
  // Finding 1 fix: validate `next` BEFORE persisting it — see
  // assertNextPhaseKnown's own doc comment.
  assertNextPhaseKnown(descriptor, turnSpec, phaseRow);
  const nextPhase = phaseRow.next ?? status.phase;
  if (phaseRow.next) {
    writeStatus(ctx.projectRoot, dirSegments, { ...status, phase: phaseRow.next });
  }
  return { phase: nextPhase, wrote, artifacts: {} };
}

// ---------------------------------------------------------------------------
// step: finalize — resolves the named finalizer against FINALIZERS (never a
// hardcoded switch) and runs it.
// ---------------------------------------------------------------------------

async function runFinalizeStep(args: {
  descriptor: SessionKindDescriptor;
  turnSpec: TurnSpec;
  phaseRow: TurnSpecPhase;
  ctx: RunInteractiveTurnCtx;
  sessionDir: string;
  dirSegments: string[];
  status: InteractiveTurnStatus;
  forgeRoot: string;
}): Promise<RunInteractiveTurnResult> {
  const { descriptor, turnSpec, phaseRow, ctx, sessionDir, dirSegments, status, forgeRoot } = args;

  const finalizerId = phaseRow.finalizer;
  if (!finalizerId) {
    throw new InteractiveRunnerError(
      `runInteractiveTurn: session kind "${descriptor.id}" turnSpec phase "${phaseRow.phase}" declares step "finalize" but no finalizer id.`,
    );
  }
  const finalizerFn = resolveFinalizer(finalizerId);
  if (!finalizerFn) {
    throw new InteractiveRunnerError(
      `runInteractiveTurn: session kind "${descriptor.id}" turnSpec phase "${phaseRow.phase}" names finalizer "${finalizerId}", which is not registered in FINALIZERS.`,
    );
  }

  // packageId — Finding 5(c): the "declared package id" the session status
  // itself carries (`status.session_id`, when present as a string) is
  // preferred over the raw request identity `ctx.sessionId`; either way the
  // resolved value MUST be `SLUG_RE`-valid or this refuses loudly — never
  // silently sanitized/invented (see header note design call #2).
  const statusPackageId = (status as Record<string, unknown>).package_id;
  const rawPackageId = typeof statusPackageId === 'string' ? statusPackageId : ctx.sessionId;
  if (!SLUG_RE.test(rawPackageId)) {
    throw new InteractiveRunnerError(
      `runInteractiveTurn: finalize packageId "${rawPackageId}" is not a valid slug (must match ${SLUG_RE.source}) — refusing rather than silently accepting it into an oddly-named library directory.`,
    );
  }

  // libraryRoot — Finding 5(a)/(b): a dedicated, NON-scanned root, never
  // `skillsDir`/`hooksDir` (see header note design call #1). May legitimately
  // not exist yet (a fresh forge install / a test fixture); ensure it via a
  // GUARD-TERMINAL mkdirSync rather than inventing a root.
  const libraryRootGuard = resolveGuardedPath(forgeRoot, [INTERACTIVE_LIBRARY_DIRNAME]);
  if (!libraryRootGuard.ok) {
    throw new InteractiveRunnerError(
      `runInteractiveTurn: finalizer library root failed containment (${libraryRootGuard.reason}).`,
    );
  }
  if (!libraryRootGuard.exists) {
    mkdirSync(libraryRootGuard.realPath, { recursive: true });
  }
  const libraryRoot = libraryRootGuard.realPath;

  const finalizerCtx: FinalizerContext = {
    sessionDir,
    forgeRoot,
    libraryRoot,
    packageId: rawPackageId,
  };

  const wrote = await finalizerFn(finalizerCtx);
  // Finding 1 fix: validate `next` BEFORE persisting it — see
  // assertNextPhaseKnown's own doc comment. The finalizer above already ran
  // to completion (a successful copy); this only gates what happens to
  // status.json AFTER that success.
  assertNextPhaseKnown(descriptor, turnSpec, phaseRow);
  const nextPhase = phaseRow.next ?? status.phase;
  if (phaseRow.next) {
    writeStatus(ctx.projectRoot, dirSegments, { ...status, phase: phaseRow.next });
  }
  return { phase: nextPhase, wrote, artifacts: {} };
}

// ---------------------------------------------------------------------------
// Finding 1 — shared `next` validation for both call sites above.
// ---------------------------------------------------------------------------

/**
 * `phaseRow.next` must name a real row in `turnSpec.phases` BEFORE it is
 * ever persisted to status.json. Reviewer-reproduced: writing it
 * unconditionally let a session succeed a turn, land a ghost phase on disk,
 * and only throw the FOLLOWING turn (a session-bricking typo discovered one
 * turn late, recoverable only by hand-editing status.json). A phase that
 * declares no `next` at all (a legitimate terminal/awaiting row) is a no-op
 * here — this only fires when `next` IS declared but names nothing real.
 */
function assertNextPhaseKnown(descriptor: SessionKindDescriptor, turnSpec: TurnSpec, phaseRow: TurnSpecPhase): void {
  if (!phaseRow.next) return;
  const known = turnSpec.phases.some((p) => p.phase === phaseRow.next);
  if (!known) {
    throw new InteractiveRunnerError(
      `runInteractiveTurn: session kind "${descriptor.id}" turnSpec phase "${phaseRow.phase}" declares next "${phaseRow.next}", which is not a phase present in turnSpec.phases — refusing to persist a ghost phase to status.json.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SEC-04 leaf: guarded status.json write. Routes the WHOLE
 *  `<projectRoot>/<dirSegments...>/status.json` path (leaf included) through
 *  the containment guard and THROWS (fail closed) if the leaf escapes —
 *  never a silent skip. */
function writeStatus(projectRoot: string, dirSegments: readonly string[], status: InteractiveTurnStatus): void {
  const p = guardedWriteSessionStatus(projectRoot, dirSegments, status);
  if (p === null) {
    throw new Error(
      'runInteractiveTurn: status.json write failed containment (symlinked/escaping leaf) — refusing to write.',
    );
  }
}

/** Recursively enumerate every FILE under `<sessionDir>/<dirName>` for each
 *  declared `writes` entry, routing every discovered segment — directories
 *  included, before ever descending into one — through `resolveGuardedPath`
 *  anchored at the already SEC-04-guarded `sessionDir` (mirrors
 *  `interactive-finalizers.ts`'s own `discoverStagingEntries` walk: the same
 *  guard, reused, never reimplemented).
 *
 *  Finding 2/3 fix: a guard-rejected entry — a symlink planted inside an
 *  otherwise-real `writes:` dir, or the declared `writes:` dir itself being
 *  a symlink pointing outside the session — used to be silently dropped
 *  (`if (p === null) continue`), collapsing `result.wrote` to a silent
 *  under-report indistinguishable from the LEGITIMATE "this phase hasn't
 *  populated `writes:` yet" case. Every guard rejection now throws a NAMED
 *  error identifying the offending entry, matching
 *  `discoverStagingEntries`'s own convention — EXCEPT at the top level,
 *  where a `writes:` dir that genuinely does not exist yet (`resolveGuardedPath`
 *  reports `exists:false`, not a rejection) is the deliberate carve-out that
 *  must survive this fix: still no entries, still no throw. A NESTED entry
 *  that vanishes between its parent's `readdirSync` and its own guard check
 *  is a genuine TOCTOU race, not that same legitimate case, so it throws
 *  too — mirroring `discoverStagingEntries`'s own "vanished mid-walk". */
function listWrittenFiles(sessionDir: string, writesDirs: readonly string[]): string[] {
  const out: string[] = [];

  function walk(segments: string[], isTopLevel: boolean): void {
    const guarded = resolveGuardedPath(sessionDir, segments);
    if (!guarded.ok) {
      throw new InteractiveRunnerError(
        `runInteractiveTurn: writes entry "${segments.join('/')}" failed containment (${guarded.reason}) — refusing rather than silently dropping it from result.wrote.`,
      );
    }
    if (!guarded.exists) {
      if (isTopLevel) return; // legitimate: this phase hasn't populated this writes: dir yet
      throw new InteractiveRunnerError(
        `runInteractiveTurn: writes entry "${segments.join('/')}" vanished between being listed and its containment check.`,
      );
    }

    let st;
    try {
      // Safe: `guarded.realPath` is already identity-verified by
      // resolveGuardedPath above — this lstat is a pure file-vs-dir type
      // check on the real entry, not following anything new.
      st = lstatSync(guarded.realPath);
    } catch (err) {
      throw new InteractiveRunnerError(
        `runInteractiveTurn: writes entry "${segments.join('/')}" vanished after its containment check: ${(err as NodeJS.ErrnoException).message}`,
      );
    }

    if (st.isDirectory()) {
      let names: string[];
      try {
        names = readdirSync(guarded.realPath).sort();
      } catch (err) {
        throw new InteractiveRunnerError(
          `runInteractiveTurn: failed to list writes entry "${segments.join('/')}": ${(err as NodeJS.ErrnoException).message}`,
        );
      }
      for (const name of names) walk([...segments, name], false);
    } else if (st.isFile()) {
      out.push(guarded.realPath);
    } else {
      // A FIFO, socket, device node, etc. — never silently drop it.
      throw new InteractiveRunnerError(
        `runInteractiveTurn: writes entry "${segments.join('/')}" is neither a regular file nor a directory — refusing.`,
      );
    }
  }

  for (const dirName of writesDirs) walk([dirName], true);
  return out.sort();
}

/** Read `skills/<agentId>/SKILL.md` from the real forge install (default
 *  root — see header note). Falls back to a generic prompt if unreadable,
 *  matching `project-brain-builder-runner.ts`'s own `loadSkillPrompt`. */
function readSkillPrompt(agentId: string): string {
  const path = skillPath(agentId);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return `You are the forge "${agentId}" agent.`;
  }
}

/** A generic, kind-agnostic turn prompt: the skill (single source of the
 *  agent's intent, ADR-024), which phase/step this turn is, where to write,
 *  and the current session status as read-only context. */
function buildTurnPrompt(
  descriptor: SessionKindDescriptor,
  phaseRow: TurnSpecPhase,
  status: InteractiveTurnStatus,
  skill: string,
): string {
  const writes = phaseRow.writes ?? [];
  return [
    skill,
    '',
    `## Your task this turn: the "${phaseRow.phase}" step of the "${descriptor.id}" session`,
    '',
    writes.length > 0
      ? `Write your output into the following sub-director${writes.length > 1 ? 'ies' : 'y'} of your working directory: ${writes.join(', ')}`
      : 'Write your output where the skill above instructs.',
    '',
    'Session status (read-only context):',
    '```json',
    JSON.stringify(status, null, 2),
    '```',
  ].join('\n');
}

/** Forward each non-empty reasoning text block to the event log (live panel),
 *  capped to keep the durable log bounded — mirrors
 *  `instructions-runner.ts`'s own `makeReasoningSink`. */
function makeReasoningSink(logger: EventLogger, initiativeId: string, sessionId: string): (text: string) => void {
  return (text: string) => {
    const capped = text.length > MAX_REASONING_TEXT ? `${text.slice(0, MAX_REASONING_TEXT)}…` : text;
    logger.emit({
      initiative_id: initiativeId,
      phase: RUNNER_PHASE,
      skill: RUNNER_SKILL,
      event_type: 'log',
      input_refs: [],
      output_refs: [],
      message: capped,
      metadata: { session_id: sessionId, kind: 'reasoning' },
    });
  };
}

// Re-export so callers don't need a second import for the shared QueryFn type.
export type { QueryFn } from './interactive-session.ts';
