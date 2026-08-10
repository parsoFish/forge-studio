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
 * open (stated explicitly, per this initiative's own precedent):
 * ---------------------------------------------------------------------------
 *
 *   1. `FinalizerContext.libraryRoot` — an EXISTING named, config-derived
 *      helper, never an ad hoc literal (binding constraint from this WI's
 *      adversarial review: folding an untrusted value into `libraryRoot`, or
 *      inventing a fresh literal root, is a full containment-bypass shape —
 *      see `resolveGuardedPath`'s own CONTRACT section in
 *      `cli/studio-path-guard.ts`). This runner uses `skillsDir(forgeRoot)`
 *      (`orchestrator/skill-path.ts`) — the created-package artifact a
 *      turnSpec-driven agent (e.g. R4-21's creation-agent) drafts is, by
 *      construction, exactly the shape a skill/hook package already is, so
 *      installing it under the forge install's own `skills/` tree is the
 *      natural, existing containment root — not `hooksDir`, which is
 *      hook-package-specific. A brand-new `forgeRoot` (a test fixture, or a
 *      forge install that has never installed a package) legitimately has no
 *      `skills/` dir yet; this is handled by a GUARD-TERMINAL `mkdirSync`
 *      (the path argument is `resolveGuardedPath(forgeRoot, ['skills'])`'s
 *      own `.realPath`) — never by inventing a new root to sidestep the
 *      "does not exist" case.
 *   2. `FinalizerContext.packageId` — request-derived, so it MUST ride as its
 *      own guarded segment (never folded into `libraryRoot`; the finalizer's
 *      own `resolveGuardedPath(libraryRoot, [packageId, ...])` call is what
 *      actually enforces this). This runner uses `ctx.sessionId`: it is
 *      already the one request-derived identity every turn carries, it has
 *      already passed the SEC-04 containment check once, and "the package
 *      this session produced" is a natural 1:1 identity for the artifact a
 *      `committing` phase installs.
 *
 * `result.artifacts` is deliberately always `{}` — ADR-043's signature
 * (`Record<string, unknown>`) states no key contract, and the pinned test
 * suite (`interactive-runner.test.ts`) explicitly leaves it unasserted
 * rather than guessing one.
 */

import { readFileSync, lstatSync, mkdirSync } from 'node:fs';
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
import { resolveGuardedPath, guardedFile, guardedReadDir } from '../cli/studio-path-guard.ts';
import { makeToolEventSink } from './tool-event-emit.ts';
import { modelForSpec } from './phase-agent.ts';
import { deriveAgentSpec } from './studio/derive.ts';
import { skillPath, skillPathRelative, skillsDir } from './skill-path.ts';
import { resolveFinalizer, type FinalizerContext } from './interactive-finalizers.ts';
import type { SessionKindDescriptor, TurnSpec, TurnSpecPhase } from './studio/session-kinds.ts';

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
  phaseRow: TurnSpecPhase;
  ctx: RunInteractiveTurnCtx;
  sessionDir: string;
  dirSegments: string[];
  status: InteractiveTurnStatus;
  forgeRoot: string;
}): Promise<RunInteractiveTurnResult> {
  const { descriptor, phaseRow, ctx, sessionDir, dirSegments, status, forgeRoot } = args;

  const finalizerId = phaseRow.finalizer;
  if (!finalizerId) {
    throw new Error(
      `runInteractiveTurn: session kind "${descriptor.id}" turnSpec phase "${phaseRow.phase}" declares step "finalize" but no finalizer id.`,
    );
  }
  const finalizerFn = resolveFinalizer(finalizerId);
  if (!finalizerFn) {
    throw new Error(
      `runInteractiveTurn: session kind "${descriptor.id}" turnSpec phase "${phaseRow.phase}" names finalizer "${finalizerId}", which is not registered in FINALIZERS.`,
    );
  }

  // libraryRoot — see header note (design call #1): an EXISTING named,
  // config-derived helper, never an ad hoc literal. `skillsDir(forgeRoot)`
  // may legitimately not exist yet (a fresh forge install / a test fixture);
  // ensure it via a GUARD-TERMINAL mkdirSync rather than inventing a root.
  const libraryRootGuard = resolveGuardedPath(forgeRoot, ['skills']);
  if (!libraryRootGuard.ok) {
    throw new Error(
      `runInteractiveTurn: finalizer library root failed containment (${libraryRootGuard.reason}).`,
    );
  }
  if (!libraryRootGuard.exists) {
    mkdirSync(libraryRootGuard.realPath, { recursive: true });
  }
  const libraryRoot = skillsDir(forgeRoot);

  const finalizerCtx: FinalizerContext = {
    sessionDir,
    forgeRoot,
    libraryRoot,
    // packageId — see header note (design call #2): request-derived, rides
    // as its OWN guarded segment inside the finalizer (never folded into
    // libraryRoot). The session id is the natural package identity for the
    // artifact this turn produces.
    packageId: ctx.sessionId,
  };

  const wrote = await finalizerFn(finalizerCtx);
  const nextPhase = phaseRow.next ?? status.phase;
  if (phaseRow.next) {
    writeStatus(ctx.projectRoot, dirSegments, { ...status, phase: phaseRow.next });
  }
  return { phase: nextPhase, wrote, artifacts: {} };
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
 *  guard, reused, never reimplemented). A `writes` dir absent on this turn
 *  contributes no entries — that's a legitimate "this phase didn't populate
 *  every declared dir yet", not an error. */
function listWrittenFiles(sessionDir: string, writesDirs: readonly string[]): string[] {
  const out: string[] = [];

  function walk(segments: string[]): void {
    const entries = guardedReadDir(sessionDir, segments);
    if (entries === null) return;
    for (const name of [...entries].sort()) {
      const segPath = [...segments, name];
      const p = guardedFile(sessionDir, segPath, 'read');
      if (p === null) continue;
      let st;
      try {
        // Safe: `p` is already identity-verified by resolveGuardedPath
        // (inside guardedFile) — this lstat is a pure file-vs-dir type
        // check on the real entry, not following anything new.
        st = lstatSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(segPath);
      else if (st.isFile()) out.push(p);
    }
  }

  for (const dirName of writesDirs) walk([dirName]);
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
