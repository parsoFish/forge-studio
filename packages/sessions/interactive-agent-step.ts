/**
 * What one interactive turn DOES, once `runInteractiveTurn` has decided which
 * phase row it is running: the agent-style step, the finalize step, the write
 * fence they run under, and the prompt/feedback/status plumbing around them.
 *
 * Split out of `interactive-runner.ts` (M4 exit row 5). The parent keeps the
 * dispatch — read the descriptor, pick the phase row, delegate — and this module
 * keeps the work. The seam is one-way: the parent calls in, and nothing here
 * calls back. `runInteractiveTurn` appears in this file only inside ERROR
 * STRINGS, which is why a name-based cycle check flags it and a real one does
 * not; the strings name the operator-facing entry point on purpose and must
 * keep saying `runInteractiveTurn`.
 *
 * `InteractiveRunnerError` and the turn's input/output types travel with the
 * work rather than staying behind, because everything that constructs or
 * returns them is here.
 */
import { readFileSync, readdirSync, lstatSync, mkdirSync, rmSync } from 'node:fs';

import { type EventLogger, type Phase, resolveGuardedPath } from '@forge/kernel';
import { pinnedSdkQuery as sdkQuery } from '@forge/agents/pinned-sdk-query.ts';
import { sdkHooksForAgent } from '@forge/agents/studio/hook-dispatch.ts';
import { resolveSessionModel, type ModelTier } from '@forge/agents/phase-agent.ts';
import { deriveAgentSpec } from '@forge/agents/studio/derive.ts';
import { loadAgentDefinition } from '@forge/agents/studio/agent-registry.ts';
import { skillPath, skillPathRelative, SLUG_RE } from '@forge/agents/skill-path.ts';
import { resolveFinalizer, type FinalizerContext } from './interactive-finalizers.ts';
import { BASH_FENCE_MODES, bashFenceModeState, type SessionKindDescriptor, type TurnSpec, type TurnSpecPhase } from './studio/session-kinds.ts';
import {
  runAgentTurn,
  guardedWriteSessionStatus,
  statusWriteRefusalReason,
  CANCELLED_PHASE,
  type QueryFn,
  type BashFenceMode,
} from './interactive-session.ts';

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
export const INTERACTIVE_LIBRARY_DIRNAME = '_interactive-library';

/** No dedicated `interactive`/`session` Phase value exists in the closed
 *  `Phase` union (`packages/kernel/logging.ts`) — adding one is out of this
 *  file's scope (logging.ts is not one of this WI's two files). `orchestrator`
 *  is the generic, non-committal bucket for cross-cutting spine plumbing. */
export const RUNNER_PHASE: Phase = 'orchestrator';
export const RUNNER_SKILL = 'interactive-runner';

// W6-B1: interactive sessions are operator-attended, low-volume turns (one
// turn per bridge action) — unlike the unattended dev-loop/PM/reflector phases
// `createToolEventSampler` also backs, there is no wedged-loop risk to guard
// against here, so `makeToolEventSink`'s sampler opts below pass tool-use
// events through effectively unsampled (rate 1) with a generous cap. The same
// literal opts are passed, per-runner (not a shared export — one line each,
// no new orchestrator surface), by the four legacy interactive runners +
// brain-fix-runner. The unattended flow phases (pm/dev/reflector bindings)
// are UNCHANGED and keep the sampler's defaults.

/** Generic over any `{ phase: string, … }` JSON — mirrors how
 *  `guardedReadSessionStatus<S>` is generic in interactive-session.ts. Every
 *  real session-kind status shape (InstructionsStatus, ProjectBrainStatus,
 *  a future turnSpec-driven status) satisfies this structurally. An optional
 *  `modelTier` (ADR-043 §3 amendment, wave-6) rides here structurally too —
 *  the bridge's kickoff route already validated it before it ever reached
 *  disk (see `resolveKickoffModelTier`, cli/ui-bridge.ts), so this module
 *  only needs to READ it back, never re-validate its shape. */
export type InteractiveTurnStatus = { phase: string } & Record<string, unknown>;

/** Pull `status.modelTier` back out as a (loosely-typed) requested tier for
 *  `resolveSessionModel`. Deliberately does NOT pre-filter an unrecognised
 *  string here — `resolveSessionModel` is the one place that validates it
 *  against the SKILL-declared envelope and throws naming the allowed set;
 *  duplicating that check here would just be a second, weaker copy of it.
 *  Only a non-string (or absent) value degrades to `undefined` — that is
 *  "no request was made," not "an invalid request," and `status.json` is
 *  never hand-authored, so a non-string `modelTier` can only mean corrupt
 *  session state, not a request this turn should refuse over. */
export function readRequestedModelTier(status: InteractiveTurnStatus): ModelTier | undefined {
  const raw = status.modelTier;
  return typeof raw === 'string' ? (raw as ModelTier) : undefined;
}

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
/**
 * bead forge-eip (W6-CR-3) — derives `runAgentTurn`'s `writeRoots` from the
 * phase row's OWN declared `writes:` entries, never a hardcoded `staging`
 * literal (so kb-cleanup's `plan/` gets the identical fence authoring's
 * `staging/` does — this is a spine fix, not a per-kind one; the
 * `community-refresh` kind that originally motivated this alongside
 * authoring was retired in W8-B5b, but the rule stays general). Each
 * declared dir name is resolved through the SAME
 * `resolveGuardedPath` containment guard every other write in this file
 * uses, GUARD-TERMINAL `mkdirSync`'d into existence if absent — mirrors
 * `runFinalizeStep`'s own `libraryRootGuard` pattern exactly — so
 * `runAgentTurn`'s fence always has a REAL, already-existing root to
 * realpath at turn start, never a not-yet-created path a symlink could
 * race into being ahead of the agent's very first write.
 *
 * A guard-rejected dir name throws rather than silently degrading to an
 * empty (fence-disabling) `writeRoots` list — `writes:` entries are
 * forge-authored data (studio/session-kinds.yaml), never request data, so
 * a rejection here can only mean a malformed session-kinds row, which
 * should fail loud at the first turn that reaches it, not silently ship a
 * kind with no fence.
 */
export function resolveWriteRoots(sessionDir: string, writesDirs: readonly string[]): string[] {
  const roots: string[] = [];
  for (const dirName of writesDirs) {
    const guarded = resolveGuardedPath(sessionDir, [dirName]);
    if (!guarded.ok) {
      throw new InteractiveRunnerError(
        `runInteractiveTurn: declared writes entry "${dirName}" failed containment (${guarded.reason}) while provisioning the write-root fence.`,
      );
    }
    if (!guarded.exists) {
      mkdirSync(guarded.realPath, { recursive: true });
    }
    roots.push(guarded.realPath);
  }
  return roots;
}

/**
 * W7-FIX-A2 (W7A2-03, bead forge-w08) — the ONE authored Bash switch,
 * `turnSpec.bashFence` (studio/session-kinds.yaml), threaded to
 * `runAgentTurn`. Absent ⇒ `deny` (a fenced kind that did not opt in has no
 * ungated write-capable tool). A value outside BASH_FENCE_MODES is a studio
 * lint ERROR already; here it fails LOUD rather than being read as either
 * mode — declared data never fails open.
 */
function resolveBashFence(turnSpec: TurnSpec): BashFenceMode {
  const raw = turnSpec.bashFence;
  if (raw === undefined) return 'deny';
  const known = bashFenceModeState(raw);
  if (known === 'deny' || known === 'inspect') return known;
  throw new InteractiveRunnerError(
    `runInteractiveTurn: turnSpec.bashFence "${raw}" is not one of ${BASH_FENCE_MODES.map((m) => m.id).join(', ')} — refusing to start the turn (studio lint reports this).`,
  );
}

// ---------------------------------------------------------------------------
// step: agent — dispatches on turnSpec.style (runAgentTurn | runStructuredTurn)
// ---------------------------------------------------------------------------

export async function runAgentStyleStep(args: {
  descriptor: SessionKindDescriptor;
  turnSpec: TurnSpec;
  phaseRow: TurnSpecPhase;
  ctx: RunInteractiveTurnCtx;
  sessionDir: string;
  dirSegments: string[];
  status: InteractiveTurnStatus;
  queryFn?: QueryFn;
  /** W8-B6 — required, so this step cannot spawn hook-blind. */
  logger: EventLogger;
  onToolUse: Parameters<typeof runAgentTurn>[0]['onToolUse'];
  onHeartbeat: () => void;
  onText: (text: string) => void;
  onThinking: (text: string) => void;
}): Promise<RunInteractiveTurnResult> {
  const { descriptor, turnSpec, phaseRow, ctx, sessionDir, dirSegments, status, onToolUse, onHeartbeat, onText, onThinking } = args;
  // The pinned SDK default lives with the code that SPAWNS, not with the
  // dispatcher that hands it down: a file that imports the query as a value
  // and wires no hooks is hook-blind by the enumeration ratchet's definition,
  // and it was right to say so when the split first moved the hook wiring here.
  const queryFn: QueryFn = args.queryFn ?? (sdkQuery as unknown as QueryFn);

  // ADR-024: spec/model/prompt derivation from the agent's OWN SKILL.md —
  // resolved against the real forge install (deriveAgentSpec's default root),
  // never `ctx.forgeRoot` — the agent/skill roster is part of the forge
  // install, not per-project/per-test data (see header note).
  const agentSpec = deriveAgentSpec(skillPathRelative(descriptor.agent));
  const model = resolveSessionModel(agentSpec, readRequestedModelTier(status));
  const skill = readSkillPrompt(descriptor.agent);

  if (turnSpec.style === 'agent') {
    // bead forge-eip (W6-CR-3) — a REAL write-root fence, derived from THIS
    // phase row's own declared `writes:` (never hardcoded to `staging`, so
    // kb-cleanup's `plan/` gets the identical protection authoring's
    // `staging/` does — community-refresh's `staging/` was a third example
    // here before that kind was retired in W8-B5b). Absent/empty `writes:`
    // yields an empty writeRoots, which `runAgentTurn` correctly reads as
    // "no fence" — matching this phase's pre-existing behaviour (an `agent`
    // step with no declared writes, e.g. a Q&A-only turn, never needed one).
    //
    // W7-B3 (sessions-kinds-32 / home-sessions-06): the roots are resolved
    // BEFORE the prompt is built so the prompt can name the EXACT realpaths
    // the fence accepts — the old relative "staging" instruction let a live
    // agent resolve it against the wrong base (beside status.registryPath)
    // and crash the session with "produced no files".
    const writeRoots = resolveWriteRoots(sessionDir, phaseRow.writes ?? []);
    const operatorFeedback = readOperatorFeedback(sessionDir);
    const prompt = buildTurnPrompt(descriptor, phaseRow, status, skill, writeRoots, operatorFeedback);
    // W7-B3 (community-13): the turn budget comes from the agent's OWN
    // SKILL.md `budgets.maxTurns` — the same declared field every unattended
    // agent already carries (run-agent.ts reads it for one-shot spawns). A
    // skill that declares none keeps runAgentTurn's own prior 16 default
    // (maxTurns: undefined → `?? 16` there). Read via the SAME loader that
    // parsed the frontmatter for deriveAgentSpec — never a second parser.
    const maxTurns = loadAgentDefinition(skillPath(descriptor.agent)).budgets.maxTurns;
    await runAgentTurn({
      queryFn,
      prompt,
      cwd: sessionDir,
      model,
      allowedTools: agentSpec.allowedTools,
      disallowedTools: agentSpec.disallowedTools,
      // W8-B6 — this session kind's agent may carry bound library hooks.
      // Derived from the SAME spec the model/tools came from, so a kind
      // re-pointed at another agent can never fire the old agent's hooks.
      ...(() => {
        const hooks = sdkHooksForAgent({
          skill: agentSpec.skill,
          logger: args.logger,
          initiativeId: ctx.sessionId,
        });
        return hooks !== undefined ? { hooks } : {};
      })(),
      ...(maxTurns !== undefined ? { maxTurns } : {}),
      writeRoots,
      bashFence: resolveBashFence(turnSpec),
      onToolUse,
      onHeartbeat,
      onText,
      onThinking,
      label: `interactive-${descriptor.id}-${ctx.sessionId}`,
    });
    // W7-C2 T1 review (P0-2, finding A5) — CONSUME-ONCE. `readOperatorFeedback`
    // runs on EVERY `step: agent` turn, not only the one a revise triggered,
    // and nothing used to clear feedback.md — so round 1's corrections kept
    // riding round 2's and round 3's prompts, silently steering turns the
    // operator never aimed. The words are not lost by this delete: the revise
    // that wrote them also recorded them on its own verdicts.json record
    // (cli/bridge-studio-affordances.ts), which is what the transcript renders
    // per round. Deleted only AFTER the turn actually folded them into a
    // prompt — a turn that threw leaves the note in place for the retry.
    if (operatorFeedback !== null) clearOperatorFeedback(sessionDir);
  } else if (turnSpec.style === 'structured') {
    // No schema registry exists yet — SCHEMA_IDS ships empty (R4-22 WI-1's
    // own deliberately-green gap-pin, packages/sessions/studio/session-kinds.ts).
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
  // P1 fix (declared-data-fails-open, live adversarial-review finding): a
  // phase row that DECLARES a non-empty `writes:` must have SOMETHING to
  // show for it — a declared `writes:` dir that never appeared and one that
  // exists but is empty are the SAME "the turn produced nothing" shape (see
  // listWrittenFiles's own carve-out comment for why both collapse to
  // `wrote: []` here). Refuse loudly, BEFORE assertNextPhaseKnown/persisting
  // `next`, rather than silently advancing the session to an operator-facing
  // empty package. A phase row that declares NO `writes:` at all is the true
  // surviving carve-out — this only fires when `writes:` IS declared.
  if ((phaseRow.writes?.length ?? 0) > 0 && wrote.length === 0) {
    throw new InteractiveRunnerError(
      `runInteractiveTurn: session kind "${descriptor.id}" phase "${phaseRow.phase}" declares writes: [${(phaseRow.writes ?? []).join(', ')}], but the turn produced no files there — refusing to advance the session with an empty package rather than persisting a ghost turn to status.json.`,
    );
  }
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

export async function runFinalizeStep(args: {
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
  // itself carries (`status.package_id`, when present as a string) is
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
export function assertNextPhaseKnown(descriptor: SessionKindDescriptor, turnSpec: TurnSpec, phaseRow: TurnSpecPhase): void {
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
 *  never a silent skip.
 *
 *  W7-FIX-A2 (W7A2-01): the seam ALSO refuses when the on-disk phase is the
 *  reserved terminal `cancelled` and this write would move off it — the
 *  operator cancelled while the (possibly long) agent turn ran, and this
 *  runner's `{ ...status, phase: next }` is a STALE pre-turn object. The two
 *  refusals are told apart by re-reading the on-disk status: a sticky-cancel
 *  refusal throws a NAMED `InteractiveRunnerError` (so stderr.log records
 *  that a turn finished after the cancel and its advance was discarded —
 *  the lifecycle derivation still reads `terminal`, never `crashed`, because
 *  terminal wins), a containment refusal keeps its own message. */
export function writeStatus(projectRoot: string, dirSegments: readonly string[], status: InteractiveTurnStatus): void {
  const p = guardedWriteSessionStatus(projectRoot, dirSegments, status);
  if (p === null) {
    if (statusWriteRefusalReason(projectRoot, dirSegments, status.phase) === 'cancelled') {
      throw new InteractiveRunnerError(
        `runInteractiveTurn: the session was cancelled (phase "${CANCELLED_PHASE}") while this turn ran — the turn's advance to "${status.phase}" is discarded and status.json stays cancelled (the terminal cancelled phase is sticky).`,
      );
    }
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
 *  matching `kinds/project-brain.ts`'s own skill-prompt load. */
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
/**
 * W7-B3 (sessions-kinds-32 / home-sessions-06): `writeRoots` are the SAME
 * already-realpath-resolved absolute directories `resolveWriteRoots` handed
 * the fence — the prompt names them verbatim so the instruction and the
 * enforcement can never disagree. The old relative wording ("the following
 * sub-directory of your working directory: staging") let a live
 * community-refresh agent resolve `staging` beside `status.registryPath`,
 * landing three files in the repo and crashing the session. (That kind was
 * retired in W8-B5b; the incident is kept as the motivating history — the
 * fix is general, applying to every `agent`-style phase's `writeRoots`.)
 */
function buildTurnPrompt(
  descriptor: SessionKindDescriptor,
  phaseRow: TurnSpecPhase,
  status: InteractiveTurnStatus,
  skill: string,
  writeRoots: readonly string[],
  feedback: string | null,
): string {
  const writes = phaseRow.writes ?? [];
  return [
    skill,
    '',
    `## Your task this turn: the "${phaseRow.phase}" step of the "${descriptor.id}" session`,
    '',
    writeRoots.length > 0
      ? [
          `Write your output files under ${writeRoots.length > 1 ? 'these exact absolute directories' : 'this exact absolute directory'} (the ${writes.join(', ')} sub-director${writes.length > 1 ? 'ies' : 'y'} of your own session directory):`,
          ...writeRoots.map((root) => `- ${root}`),
          'Use these absolute paths exactly as given — a write anywhere else (any other absolute path, or a relative path resolved against some other base) is refused by the tool fence.',
        ].join('\n')
      : 'Write your output where the skill above instructs.',
    // W7-C2 (revise verdict, sessions-kinds-09/23) — the operator's revision
    // feedback, when the generic affordance route sent this session back to
    // its drafting phase: mirrored from instructions-runner.ts's /
    // demo-builder-runner.ts's own feedback.md sections, so the generic
    // spine's revise turn actually carries the words that triggered it.
    ...(feedback !== null ? ['', 'Operator revision feedback on the previous draft (apply it):', feedback] : []),
    '',
    'Session status (read-only context):',
    '```json',
    JSON.stringify(status, null, 2),
    '```',
  ].join('\n');
}

/** Read `feedback.md` (the operator's revise-verdict notes) from the session
 *  dir through the SAME containment choke point every other session-dir
 *  read here uses — an escaping symlink collapses to null == absent, same
 *  as `readFeedback` in instructions-runner.ts / demo-builder-runner.ts.
 *  Trimmed content, or null when absent/empty. */
function readOperatorFeedback(sessionDir: string): string | null {
  const guarded = resolveGuardedPath(sessionDir, ['feedback.md']);
  if (!guarded.ok || !guarded.exists) return null;
  try {
    const body = readFileSync(guarded.realPath, 'utf8').trim();
    return body.length > 0 ? body : null;
  } catch {
    return null;
  }
}

/** Delete `feedback.md` once a turn has folded it into its prompt (W7-C2 T1
 *  review, P0-2 / finding A5) — through the SAME containment choke point the
 *  read above uses, so an escaping symlink is never followed to an outside
 *  unlink. A failure is REPORTED, never swallowed: the turn itself already
 *  ran, so this must not throw the session away, but a note that survives
 *  its own consumption WILL re-steer the next turn and the operator needs to
 *  be able to see why. */
function clearOperatorFeedback(sessionDir: string): void {
  const guarded = resolveGuardedPath(sessionDir, ['feedback.md']);
  if (!guarded.ok || !guarded.exists) return;
  try {
    rmSync(guarded.realPath);
  } catch (err) {
    console.error(
      `interactive-runner: failed to clear feedback.md in ${sessionDir} after consuming it — the SAME operator feedback will be re-injected into the next turn's prompt:`,
      err,
    );
  }
}

// W6-B1 review round 2: the local makeReasoningSink/makeThinkingSink duplicates
// were removed — this file now consumes the ONE shared pair exported from
// interactive-session.ts (imported above), which also owns the per-turn
// SINK_ROW_CAP backstop and the raw-text (not truncated-text) coalescing fix.

// Re-export so callers don't need a second import for the shared QueryFn type.
export type { QueryFn } from './interactive-session.ts';
