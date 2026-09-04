/**
 * The session-kind SEMANTIC validator — every rule a well-formed
 * `session-kinds.yaml` can still break, and the closed check-id vocabulary
 * those rules report through.
 *
 * Split out of `studio/session-kinds.ts` (M4 exit row 5). The parent parses and
 * loads; this file judges. The seam is one-way and was proven so BEFORE the
 * move rather than after it: a cycle probe with comments stripped reports ZERO
 * references from what stayed behind to anything declared here. The raw grep
 * reported three, and all three were prose inside docstrings — which is why the
 * probe strips comments before it counts.
 *
 * THREE HELPERS TRAVELLED WITH IT, and the reason is the door rather than
 * cohesion: `err`, `allowedIdsSummary` and `discoverRuntimeAgentIds` are
 * module-private and used ONLY by these rules. Leaving them behind would have
 * required EXPORTING all three so this file could reach them — three new public
 * names on a module whose surface ruling 31 governs, bought for nothing.
 *
 * `validatePhaseTable` has no importer outside this module. `validateSessionKinds`
 * has three, and they now name this file directly rather than the parent.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import matter from 'gray-matter';

import type { Finding } from '@forge/kernel';
import { listSkillMdDirs, skillsDir, SLUG_RE } from '@forge/agents/skill-path.ts';
import { FINALIZERS } from '../interactive-finalizers.ts';

import {
  AWAITS_KINDS, BASH_FENCE_MODES, FINALIZER_IDS, SCHEMA_IDS, SESSION_ARTIFACT_KINDS,
  SESSION_STAGES, TURN_STEPS, TURN_STYLES, VERDICT_VALUES, awaitsKindState,
  bashFenceModeState, loadSessionKinds, schemaIdState, sessionArtifactKindState,
  turnStepState, turnStyleState, verdictValueState,
} from './session-kinds.ts';
import type { FinalizerIdRow, SessionKindDescriptor, TurnSpecPhase } from './session-kinds.ts';

/**
 * The DISPATCHABLE finalizer id set — derived DIRECTLY from
 * `packages/sessions/interactive-finalizers.ts`'s `FINALIZERS` registry keys, not
 * a hand-maintained mirror (that module has no import path back to this one
 * — it only imports node builtins + `packages/kernel/path-guard.ts`, which itself
 * imports only node builtins — so this is a plain, cycle-free import, not a
 * duplicated literal).
 *
 * Reviewer finding (W6-B3 post-merge review): a `turnSpec.phases` row naming
 * a `finalize` step is REAL dispatchable data — `runInteractiveTurn`
 * (packages/sessions/interactive-runner.ts) resolves its `finalizer` id via
 * `resolveFinalizer`, which throws `InteractiveFinalizerError` at SPAWN TIME
 * for any id `FINALIZERS` does not carry. `FINALIZER_IDS` above is the
 * DESCRIPTIVE, ADR-043 §5 vocabulary (every finalizer the ADR names, whether
 * or not it is wired to the primitive yet) — validating a `turnSpec` row
 * against that WIDER set would lint-approve `writeToRepoRoot`/
 * `recordLockedDemo`, both of which are real, but neither of which
 * `FINALIZERS` implements (demo/instructions never migrate onto `turnSpec`,
 * 2026-08-14 amendment §1) — a shared vocabulary must never lint-approve
 * what dispatch will throw on. `panel.phases` rows are NEVER dispatched
 * (invisible to `cmdAgentRun`'s turnSpec fork — ADR-043 2026-08-15 amendment
 * §2), so they correctly keep validating against the full descriptive
 * `FINALIZER_IDS`.
 */
const DISPATCHABLE_FINALIZER_IDS: readonly FinalizerIdRow[] = Object.freeze(FINALIZERS.map((row) => Object.freeze({ id: row.id })));


/** Renders a closed-vocabulary's allowed set for an error message — honest
 *  even when the set is empty (SCHEMA_IDS today), never silently omitted. */
function allowedIdsSummary(rows: readonly { readonly id: string }[]): string {
  return rows.length > 0 ? rows.map((r) => r.id).join('|') : '(none registered yet)';
}

// ---------------------------------------------------------------------------
// Agent-ref resolution — every skills/*/SKILL.md with a runtime: block,
// regardless of `library: false` (see header rationale; AT-12, AT-17).
// ---------------------------------------------------------------------------

function discoverRuntimeAgentIds(forgeRoot: string): Set<string> {
  const ids = new Set<string>();
  for (const dir of listSkillMdDirs(skillsDir(forgeRoot))) {
    const skillMdPath = join(dir, 'SKILL.md');
    try {
      const raw = readFileSync(skillMdPath, 'utf8');
      const { data } = matter(raw, {});
      if (data !== null && typeof data === 'object' && !Array.isArray(data) && 'runtime' in (data as Record<string, unknown>)) {
        ids.add(basename(dir));
      }
    } catch {
      // Unreadable/unparseable SKILL.md — simply doesn't resolve as a known
      // agent here. Surfacing SKILL.md-level parse errors is studio-lint's
      // agent-loading section's job (section 1), not this validator's.
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// validateSessionKinds — semantic rules
// ---------------------------------------------------------------------------

function err(object: string, check: string, message: string): Finding {
  return { level: 'error', object, check, message };
}

const CHECK_LOAD_ERROR = 'session-kinds/load-error';
const CHECK_SLUG = 'session-kinds/slug';
const CHECK_DUPLICATE_ID = 'session-kinds/duplicate-id';
const CHECK_UNKNOWN_AGENT = 'session-kinds/unknown-agent';
const CHECK_EMPTY_STAGES = 'session-kinds/empty-stages';
const CHECK_UNKNOWN_STAGE = 'session-kinds/unknown-stage';
const CHECK_DEFAULT_STAGE_NOT_IN_STAGES = 'session-kinds/default-stage-not-in-stages';
const CHECK_UNKNOWN_ARTIFACT_KIND = 'session-kinds/unknown-artifact-kind';
const CHECK_RESERVED_ARTIFACT_KIND = 'session-kinds/reserved-artifact-kind';
const CHECK_LEGACY_ROUTE_NOT_FOUND = 'session-kinds/legacy-route-not-found';
const CHECK_TURNSPEC_UNKNOWN_STYLE = 'session-kinds/turnspec-unknown-style';
const CHECK_TURNSPEC_UNKNOWN_STEP = 'session-kinds/turnspec-unknown-step';
const CHECK_TURNSPEC_UNKNOWN_FINALIZER = 'session-kinds/turnspec-unknown-finalizer';
const CHECK_TURNSPEC_UNKNOWN_SCHEMA = 'session-kinds/turnspec-unknown-schema';
const CHECK_TURNSPEC_UNKNOWN_BASH_FENCE = 'session-kinds/turnspec-unknown-bash-fence';
// R4-22 WI-1 adversarial-review round (AT-R422-11..18): turnSpec.phases is a
// STATE MACHINE, and its graph coherence was validated nowhere — every check
// below was confirmed by execution to load clean, zero findings, before this
// round. See the file header CRITICAL note for kindDir/SLUG_RE.
const CHECK_TURNSPEC_UNSAFE_KIND_DIR = 'session-kinds/turnspec-unsafe-kind-dir';
const CHECK_TURNSPEC_DANGLING_NEXT = 'session-kinds/turnspec-dangling-next';
const CHECK_TURNSPEC_FINALIZE_MISSING_FINALIZER = 'session-kinds/turnspec-finalize-missing-finalizer';
const CHECK_TURNSPEC_NO_TERMINAL_PHASE = 'session-kinds/turnspec-no-terminal-phase';
const CHECK_TURNSPEC_DUPLICATE_PHASE = 'session-kinds/turnspec-duplicate-phase';
const CHECK_TURNSPEC_EMPTY_PHASES = 'session-kinds/turnspec-empty-phases';
const CHECK_TURNSPEC_STRUCTURED_UNSUPPORTED = 'session-kinds/turnspec-structured-unsupported';
// W6-B3 (ADR-043 2026-08-15 amendment §2) — panel.phases reuses the SAME
// phase-row vocab checks as turnSpec.phases (validatePhaseTable below is
// shared by both), under a "panel-" prefix so a panel-side rejection is
// never confused with a turnSpec-side one in test/log output. No panel
// analog exists for kindDir/style/schema/structured-unsupported — panel
// carries none of those fields.
const CHECK_PANEL_UNKNOWN_STEP = 'session-kinds/panel-unknown-step';
const CHECK_PANEL_UNKNOWN_FINALIZER = 'session-kinds/panel-unknown-finalizer';
const CHECK_PANEL_DANGLING_NEXT = 'session-kinds/panel-dangling-next';
const CHECK_PANEL_FINALIZE_MISSING_FINALIZER = 'session-kinds/panel-finalize-missing-finalizer';
const CHECK_PANEL_NO_TERMINAL_PHASE = 'session-kinds/panel-no-terminal-phase';
const CHECK_PANEL_DUPLICATE_PHASE = 'session-kinds/panel-duplicate-phase';
const CHECK_PANEL_EMPTY_PHASES = 'session-kinds/panel-empty-phases';
// W6-B3 post-merge review — `awaits` (a `step: noop` row's REQUIRED,
// AUTHORED "what is the operator being asked for" field, AWAITS_KINDS)
// mirrors `finalizer`'s own two-check shape exactly: an UNKNOWN value (the
// key is present but not in AWAITS_KINDS) vs a MISSING one (a noop row that
// omits the key entirely) are distinct failure modes, distinct checks — see
// CHECK_TURNSPEC_UNKNOWN_FINALIZER / CHECK_TURNSPEC_FINALIZE_MISSING_FINALIZER
// for the precedent this pair follows.
const CHECK_TURNSPEC_UNKNOWN_AWAITS = 'session-kinds/turnspec-unknown-awaits';
const CHECK_TURNSPEC_NOOP_MISSING_AWAITS = 'session-kinds/turnspec-noop-missing-awaits';
const CHECK_PANEL_UNKNOWN_AWAITS = 'session-kinds/panel-unknown-awaits';
const CHECK_PANEL_NOOP_MISSING_AWAITS = 'session-kinds/panel-noop-missing-awaits';
// W6-B6 post-merge review — `verdicts` (a `noop`+`awaits:'verdict'` row's
// OPTIONAL, AUTHORED "which verdict values are legal here" field,
// VERDICT_VALUES) mirrors `awaits`'s own two-check shape: an UNKNOWN value
// (a `verdicts` entry outside VERDICT_VALUES) vs a MISPLACED declaration (a
// `verdicts` key present on a row that is NOT a `noop`+`awaits:'verdict'`
// row, where the field is meaningless) are distinct failure modes, distinct
// checks.
const CHECK_TURNSPEC_UNKNOWN_VERDICT = 'session-kinds/turnspec-unknown-verdict';
const CHECK_TURNSPEC_VERDICTS_MISPLACED = 'session-kinds/turnspec-verdicts-misplaced';
const CHECK_PANEL_UNKNOWN_VERDICT = 'session-kinds/panel-unknown-verdict';
const CHECK_PANEL_VERDICTS_MISPLACED = 'session-kinds/panel-verdicts-misplaced';
// W6-B9 (reviewer finding on W6-B8) — `requires` (a `noop`+`awaits:'verdict'`
// row's OPTIONAL, AUTHORED "which extra POST body fields this verdict needs"
// field) mirrors `verdicts`' OWN misplaced-check half only — there is no
// "unknown value" counterpart (no closed vocabulary of legal body-field
// NAMES exists, mirroring `writes`' own structural-only, unchecked-value
// discipline; see TurnSpecPhase.requires's own doc comment).
const CHECK_TURNSPEC_REQUIRES_MISPLACED = 'session-kinds/turnspec-requires-misplaced';
const CHECK_PANEL_REQUIRES_MISPLACED = 'session-kinds/panel-requires-misplaced';
// The turnSpec⊕panel mutual-exclusion check (ADR-043 2026-08-15 amendment
// §2): a descriptor carrying BOTH is rejected with exactly one finding
// naming the kind and both fields — see the exclusivity guard in the main
// loop below, which skips both the turnSpec AND panel blocks entirely when
// both are present, so this is the ONLY finding a doubly-declared descriptor
// ever produces.
const CHECK_TURNSPEC_PANEL_EXCLUSIVE = 'session-kinds/turnspec-panel-exclusive';

/** True if `seg` contains any C0 control character (codepoint 0-31
 *  inclusive), mirroring packages/kernel/path-guard.ts's own CONTROL_CHAR_RE
 *  scan for the same range — written here as an explicit codepoint scan,
 *  not a `/[\u0000-\u001f]/`-style character-class literal, so this source
 *  file itself never has to carry a raw control byte inside a regex
 *  literal. */
function hasControlChar(seg: string): boolean {
  for (let i = 0; i < seg.length; i++) {
    if (seg.charCodeAt(i) <= 0x1f) return true;
  }
  return false;
}

/**
 * turnSpec.kindDir must be a safe single path segment — it becomes
 * `resolveGuardedPath(projectRoot, [kindDir, sessionId])` in the generic
 * runner (docs/decisions/043-generic-interactive-surface.md §1), the SEC-04
 * containment guard root. `d.id` one screen down is validated against
 * SLUG_RE (CHECK_SLUG) but SLUG_RE requires a leading `a-z` letter, and
 * every REAL kindDir value in this design is underscore-prefixed
 * (`_authoring`, `_architect`, `_demo`) — reusing SLUG_RE for kindDir would
 * reject every legitimate shipped value. This mirrors `isSafeSegment` in
 * packages/kernel/path-guard.ts EXACTLY (no separators, no "." or "..", no C0
 * control characters) — the same predicate `resolveGuardedPath` itself
 * relies on one layer further down. NOT imported from that module because
 * `isSafeSegment` is not exported there (an internal helper of a file this
 * initiative's file-boundary does not touch); kept in exact lockstep by
 * design — any future edit to isSafeSegment must be mirrored here too.
 */
function isSafeKindDirSegment(seg: string): boolean {
  return (
    seg.length > 0 &&
    seg !== '.' &&
    seg !== '..' &&
    !seg.includes('/') &&
    !seg.includes('\\') &&
    !seg.includes(sep) &&
    !hasControlChar(seg)
  );
}

/** Check-id bundle for `validatePhaseTable` below — one per phase-row-level
 *  rule, so a caller (turnSpec vs panel) supplies its own check-id family
 *  while sharing every byte of the actual rule logic. */
type PhaseTableCheckIds = {
  readonly unknownStep: string;
  readonly unknownFinalizer: string;
  readonly finalizeMissingFinalizer: string;
  readonly danglingNext: string;
  readonly duplicatePhase: string;
  readonly noTerminalPhase: string;
  readonly emptyPhases: string;
  readonly unknownAwaits: string;
  readonly noopMissingAwaits: string;
  readonly unknownVerdict: string;
  readonly verdictsMisplaced: string;
  readonly requiresMisplaced: string;
};

const TURNSPEC_PHASE_CHECK_IDS: PhaseTableCheckIds = {
  unknownStep: CHECK_TURNSPEC_UNKNOWN_STEP,
  unknownFinalizer: CHECK_TURNSPEC_UNKNOWN_FINALIZER,
  finalizeMissingFinalizer: CHECK_TURNSPEC_FINALIZE_MISSING_FINALIZER,
  danglingNext: CHECK_TURNSPEC_DANGLING_NEXT,
  duplicatePhase: CHECK_TURNSPEC_DUPLICATE_PHASE,
  noTerminalPhase: CHECK_TURNSPEC_NO_TERMINAL_PHASE,
  emptyPhases: CHECK_TURNSPEC_EMPTY_PHASES,
  unknownAwaits: CHECK_TURNSPEC_UNKNOWN_AWAITS,
  noopMissingAwaits: CHECK_TURNSPEC_NOOP_MISSING_AWAITS,
  unknownVerdict: CHECK_TURNSPEC_UNKNOWN_VERDICT,
  verdictsMisplaced: CHECK_TURNSPEC_VERDICTS_MISPLACED,
  requiresMisplaced: CHECK_TURNSPEC_REQUIRES_MISPLACED,
};

const PANEL_PHASE_CHECK_IDS: PhaseTableCheckIds = {
  unknownStep: CHECK_PANEL_UNKNOWN_STEP,
  unknownFinalizer: CHECK_PANEL_UNKNOWN_FINALIZER,
  finalizeMissingFinalizer: CHECK_PANEL_FINALIZE_MISSING_FINALIZER,
  danglingNext: CHECK_PANEL_DANGLING_NEXT,
  duplicatePhase: CHECK_PANEL_DUPLICATE_PHASE,
  noTerminalPhase: CHECK_PANEL_NO_TERMINAL_PHASE,
  emptyPhases: CHECK_PANEL_EMPTY_PHASES,
  unknownAwaits: CHECK_PANEL_UNKNOWN_AWAITS,
  noopMissingAwaits: CHECK_PANEL_NOOP_MISSING_AWAITS,
  unknownVerdict: CHECK_PANEL_UNKNOWN_VERDICT,
  verdictsMisplaced: CHECK_PANEL_VERDICTS_MISPLACED,
  requiresMisplaced: CHECK_PANEL_REQUIRES_MISPLACED,
};

/**
 * Shared phase-row-level validation for BOTH `turnSpec.phases` and
 * `panel.phases` (ADR-043 2026-08-15 amendment §2 — panel reuses the SAME
 * frozen phase-row vocabulary as turnSpec, never a forked copy; AT-R422-13..18
 * originally lived inline in the turnSpec block only — this extraction keeps
 * every one of those six rules byte-identical for turnSpec while giving panel
 * the same coverage under its own `panel-*` check-id family, so a panel-side
 * rejection is never confused with a turnSpec-side one). `tableLabel`
 * ("turnSpec.phases" | "panel.phases") is the only thing that varies in the
 * message text. `writes` is deliberately NOT validated here — see
 * TurnSpecPhase's own EXPIRY CONDITION doc comment (no `writes` vocabulary
 * exists yet, for either table).
 *
 * `allowedFinalizers` (W6-B3 post-merge review): the caller supplies its OWN
 * finalizer set rather than this function reading a fixed global — `turnSpec`
 * (real dispatch, `resolveFinalizer` in packages/sessions/interactive-runner.ts)
 * must validate against `DISPATCHABLE_FINALIZER_IDS` (derived from
 * `packages/sessions/interactive-finalizers.ts`'s `FINALIZERS` registry — the set
 * dispatch will actually resolve), while `panel` (never dispatched) validates
 * against the full descriptive `FINALIZER_IDS`. A shared vocabulary must
 * never lint-approve a value dispatch will throw on.
 */
function validatePhaseTable(
  d: SessionKindDescriptor,
  phases: readonly TurnSpecPhase[],
  obj: string,
  tableLabel: string,
  checkIds: PhaseTableCheckIds,
  allowedFinalizers: readonly FinalizerIdRow[],
  findings: Finding[],
): void {
  // empty-phases (AT-R422-17): a state machine with zero rows can never run a
  // single turn — the direct analog of CHECK_EMPTY_STAGES above.
  if (phases.length === 0) {
    findings.push(err(obj, checkIds.emptyPhases, `Session kind "${d.id}" declares an empty ${tableLabel} list — at least one phase is required`));
  }

  // Real phase-name set for the dangling-next check below (the direct analog
  // of `defaultStage ∈ stages`, this is `next ∈ phase-names`) — built once,
  // ahead of the loop, over every declared phase (including any duplicate, so
  // a `next` that only a duplicate row satisfies still resolves).
  const phaseNames = [...new Set(phases.map((p) => p.phase))];
  const phaseNameSet = new Set(phaseNames);
  const seenPhaseNames = new Set<string>();

  for (const phase of phases) {
    if (turnStepState(phase.step) === undefined) {
      findings.push(
        err(
          obj,
          checkIds.unknownStep,
          `Session kind "${d.id}" ${tableLabel} phase "${phase.phase}" declares step "${phase.step}" — must be one of ${allowedIdsSummary(TURN_STEPS)}`,
        ),
      );
    }
    if (phase.finalizer !== undefined && !allowedFinalizers.some((row) => row.id === phase.finalizer)) {
      findings.push(
        err(
          obj,
          checkIds.unknownFinalizer,
          `Session kind "${d.id}" ${tableLabel} phase "${phase.phase}" declares finalizer "${phase.finalizer}" — must be one of ${allowedIdsSummary(allowedFinalizers)}`,
        ),
      );
    }

    // finalize-missing-finalizer (AT-R422-14): the check above only ever
    // fires when `finalizer` IS present (`phase.finalizer !== undefined`) — a
    // `step: finalize` phase that omits the KEY entirely never enters that
    // branch. `'finalizer' in phase` distinguishes "key absent" from "key
    // present, value undefined" (parseTurnSpecPhase only ever sets the key
    // when the source YAML carries one — AT-R422-6/19).
    if (phase.step === 'finalize' && !('finalizer' in phase)) {
      findings.push(
        err(obj, checkIds.finalizeMissingFinalizer, `Session kind "${d.id}" ${tableLabel} phase "${phase.phase}" has step "finalize" but is missing the required "finalizer" field`),
      );
    }

    // unknown-awaits (W6-B3 post-merge review): the check above's finalizer
    // shape, applied to `awaits` — fires only when the key IS present with a
    // value outside AWAITS_KINDS.
    if (phase.awaits !== undefined && awaitsKindState(phase.awaits) === undefined) {
      findings.push(
        err(
          obj,
          checkIds.unknownAwaits,
          `Session kind "${d.id}" ${tableLabel} phase "${phase.phase}" declares awaits "${phase.awaits}" — must be one of ${allowedIdsSummary(AWAITS_KINDS)}`,
        ),
      );
    }

    // noop-missing-awaits (W6-B3 post-merge review): mirrors
    // finalize-missing-finalizer's exact shape — a `step: noop` phase that
    // omits `awaits` ENTIRELY (the key itself absent, `'awaits' in phase` is
    // false) is an error naming the kind, the phase, and the allowed set. No
    // fallback, no silent misclassification: `deriveSessionAffordances`
    // trusts `awaits` is present on every noop row it is asked to derive,
    // and this is the check that makes that trust safe.
    if (phase.step === 'noop' && !('awaits' in phase)) {
      findings.push(
        err(
          obj,
          checkIds.noopMissingAwaits,
          `Session kind "${d.id}" ${tableLabel} phase "${phase.phase}" has step "noop" but is missing the required "awaits" field — must be one of ${allowedIdsSummary(AWAITS_KINDS)}`,
        ),
      );
    }

    // W6-B6 post-merge review — verdicts-misplaced: `verdicts` is meaningful
    // ONLY on a `noop` row whose `awaits` is `'verdict'` (the row
    // `deriveSessionAffordances` turns into a `verdict`-kind affordance) —
    // declared anywhere else it can never be read, so it is rejected as
    // dead, confusing authored data rather than silently ignored.
    if (phase.verdicts !== undefined && !(phase.step === 'noop' && phase.awaits === 'verdict')) {
      findings.push(
        err(
          obj,
          checkIds.verdictsMisplaced,
          `Session kind "${d.id}" ${tableLabel} phase "${phase.phase}" declares "verdicts" but is not a "noop" step with awaits "verdict" — "verdicts" is only meaningful there`,
        ),
      );
    }

    // unknown-verdict: mirrors unknown-awaits's exact shape — each entry of
    // a present `verdicts` list must be a real VERDICT_VALUES member.
    if (phase.verdicts !== undefined) {
      for (const v of phase.verdicts) {
        if (verdictValueState(v) === undefined) {
          findings.push(
            err(
              obj,
              checkIds.unknownVerdict,
              `Session kind "${d.id}" ${tableLabel} phase "${phase.phase}" declares verdict "${v}" — must be one of ${allowedIdsSummary(VERDICT_VALUES)}`,
            ),
          );
        }
      }
    }

    // W6-B9 (reviewer finding on W6-B8) — requires-misplaced: mirrors
    // verdicts-misplaced's exact shape. `requires` is meaningful ONLY on a
    // `noop` row whose `awaits` is `'verdict'` — declared anywhere else it
    // can never be read (deriveSessionAffordances only ever attaches
    // `meta.requires` off a verdict-kind row), so it is rejected as dead,
    // confusing authored data rather than silently ignored. No
    // unknown-value counterpart exists (see TurnSpecPhase.requires's own
    // doc comment — structural only, like `writes`).
    if (phase.requires !== undefined && !(phase.step === 'noop' && phase.awaits === 'verdict')) {
      findings.push(
        err(
          obj,
          checkIds.requiresMisplaced,
          `Session kind "${d.id}" ${tableLabel} phase "${phase.phase}" declares "requires" but is not a "noop" step with awaits "verdict" — "requires" is only meaningful there`,
        ),
      );
    }

    // dangling-next (AT-R422-13): mirrors CHECK_DEFAULT_STAGE_NOT_IN_STAGES's
    // shape/message style — `next ∈ phase-names` is the direct structural
    // analog of `defaultStage ∈ stages`.
    if (phase.next !== undefined && !phaseNameSet.has(phase.next)) {
      findings.push(
        err(
          obj,
          checkIds.danglingNext,
          `Session kind "${d.id}" ${tableLabel} phase "${phase.phase}" next "${phase.next}" is not a member of its own declared phases [${phaseNames.join(', ')}]`,
        ),
      );
    }

    // duplicate-phase (AT-R422-16): mirrors CHECK_DUPLICATE_ID's shape/message
    // style.
    if (seenPhaseNames.has(phase.phase)) {
      findings.push(err(obj, checkIds.duplicatePhase, `Session kind "${d.id}" ${tableLabel} declares duplicate phase name "${phase.phase}"`));
    } else {
      seenPhaseNames.add(phase.phase);
    }
  }

  // no-terminal-phase (AT-R422-15): the table as a WHOLE, not any single row
  // — the generic runner's dispatch loop (or, for panel, the derivation fn)
  // needs a legal phase to stop advancing from.
  if (!phases.some((p) => p.step === 'terminal')) {
    findings.push(
      err(obj, checkIds.noTerminalPhase, `Session kind "${d.id}" ${tableLabel} has no phase with step "terminal" — the state machine has no legal stopping point`),
    );
  }
}

const FORGE_UI_APP_DIRNAME = join('apps', 'studio', 'app');

/** A `legacyRoutes` entry ("/architect/[sessionId]/interview") maps 1:1 onto a
 *  Next.js App Router directory ("apps/studio/app/architect/[sessionId]/interview")
 *  — route path segments ARE the directory names, including literal
 *  `[sessionId]` dynamic-segment folders. An entry with no non-empty segments
 *  (blank or "/") never resolves.
 *
 *  Containment (AT-amendment-3, A1 / AT-61..67): `path.join()` normalises
 *  `..` segments BEFORE `existsSync` ever runs, so a naive
 *  `join(appDir, ...segments)` can resolve anywhere on the filesystem —
 *  including, with enough repeated `..`, an arbitrary absolute path once the
 *  climb clamps past the real filesystem root. Two independent guards apply,
 *  mirroring the `resolveSafeSessionDir` / `safeReadFileInSession`
 *  containment pattern used elsewhere in this PR: (1) the join-normalised
 *  candidate must equal `appDir` or start with `appDir + sep`; (2) ANY raw
 *  segment that is literally `..` is rejected outright, even when the
 *  resulting path would numerically round-trip back inside `appDir` — a
 *  `legacyRoutes` value is a declared Studio route path, not a filesystem
 *  expression to be evaluated (T2 ruling, AT-67), so an escape-and-return
 *  string like "../app/foo/[sessionId]" is refused on its own terms rather
 *  than accidentally accepted because it normalises back inside.
 *
 *  Honest limit (accepted, not fixed): this checks that the DIRECTORY
 *  exists, not that it still hosts a live route (a `page.tsx`/`route.ts`
 *  file). A directory left behind after its page file was deleted still
 *  passes — see AT coverage; a follow-up, stated rather than implied away. */
function legacyRouteResolves(forgeRoot: string, route: string): boolean {
  const segments = route.trim().replace(/^\//, '').split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return false;
  if (segments.includes('..')) return false;
  const appDir = join(forgeRoot, FORGE_UI_APP_DIRNAME);
  const candidate = join(appDir, ...segments);
  if (candidate !== appDir && !candidate.startsWith(appDir + sep)) return false;
  return existsSync(candidate);
}

/**
 * All semantic rules over `studio/session-kinds.yaml`: closed-vocabulary
 * membership (stages, artifact kinds), cross-field consistency
 * (defaultStage ∈ stages), slug shape, duplicate ids, and agent-ref
 * resolution (against every runtime-bearing SKILL.md, not the library-only
 * roster). A load failure (missing file / unparseable YAML) returns EXACTLY
 * one `session-kinds/load-error` finding, never a silently empty list.
 */
export function validateSessionKinds(forgeRoot: string): Finding[] {
  let descriptors: SessionKindDescriptor[];
  try {
    descriptors = loadSessionKinds(forgeRoot);
  } catch (loadErr) {
    return [err('studio:session-kinds', CHECK_LOAD_ERROR, (loadErr as Error).message)];
  }

  const findings: Finding[] = [];
  const knownAgentIds = discoverRuntimeAgentIds(forgeRoot);
  const seenIds = new Set<string>();
  const allowedStages = SESSION_STAGES.join('|');
  const allowedArtifactKinds = SESSION_ARTIFACT_KINDS.map((k) => k.id).join('|');

  for (const d of descriptors) {
    const obj = `session-kind:${d.id}`;

    if (seenIds.has(d.id)) {
      findings.push(err(obj, CHECK_DUPLICATE_ID, `Duplicate session-kind id "${d.id}"`));
    } else {
      seenIds.add(d.id);
    }

    if (!SLUG_RE.test(d.id)) {
      findings.push(err(obj, CHECK_SLUG, `Session-kind id "${d.id}" does not match ${SLUG_RE}`));
    }

    if (!knownAgentIds.has(d.agent)) {
      const allowedAgents = [...knownAgentIds].sort().join(', ');
      findings.push(
        err(
          obj,
          CHECK_UNKNOWN_AGENT,
          `Session kind "${d.id}" references unknown agent "${d.agent}" — no skills/*/SKILL.md with a runtime: block resolves to this id; known agents: ${allowedAgents}`,
        ),
      );
    }

    if (d.stages.length === 0) {
      findings.push(err(obj, CHECK_EMPTY_STAGES, `Session kind "${d.id}" declares an empty stages list — at least one stage is required`));
    }

    // legacyRoutes: an empty LIST is legal (a future kind may have no
    // predecessor route) — but every entry PRESENT must be non-blank and
    // resolve to a real apps/studio/app/ route directory (previously parsed,
    // typed, and echoed by tests but never actually checked here).
    for (const route of d.legacyRoutes) {
      if (!legacyRouteResolves(forgeRoot, route)) {
        findings.push(
          err(
            obj,
            CHECK_LEGACY_ROUTE_NOT_FOUND,
            `Session kind "${d.id}" declares legacyRoutes entry "${route}" which does not resolve to a real apps/studio/app/ route directory`,
          ),
        );
      }
    }

    for (const stage of d.stages) {
      if (!(SESSION_STAGES as readonly string[]).includes(stage)) {
        findings.push(
          err(obj, CHECK_UNKNOWN_STAGE, `Session kind "${d.id}" declares unknown stage "${stage}" — must be one of ${allowedStages}`),
        );
      }
    }

    if (!d.stages.includes(d.defaultStage)) {
      findings.push(
        err(
          obj,
          CHECK_DEFAULT_STAGE_NOT_IN_STAGES,
          `Session kind "${d.id}" defaultStage "${d.defaultStage}" is not a member of its own declared stages [${d.stages.join(', ')}]`,
        ),
      );
    }

    const artifactState = sessionArtifactKindState(d.artifact.kind);
    if (artifactState === undefined) {
      findings.push(
        err(
          obj,
          CHECK_UNKNOWN_ARTIFACT_KIND,
          `Session kind "${d.id}" declares unknown artifact kind "${d.artifact.kind}" — must be one of ${allowedArtifactKinds}`,
        ),
      );
    } else if (artifactState === 'reserved') {
      findings.push(
        err(
          obj,
          CHECK_RESERVED_ARTIFACT_KIND,
          `Session kind "${d.id}" declares reserved artifact kind "${d.artifact.kind}" — it parses fine but has no renderer implementation anywhere; wire the renderer (and flip it live in SESSION_ARTIFACT_KINDS) before using it`,
        ),
      );
    }

    // turnSpec ⊕ panel (W6-B3, ADR-043 2026-08-15 amendment §2): mutually
    // exclusive — a descriptor carrying BOTH gets exactly ONE finding, naming
    // the kind and both fields, and neither block below runs at all (running
    // them would produce a pile of secondary findings on a descriptor that is
    // already fundamentally malformed, obscuring the one finding that
    // actually matters).
    if (d.turnSpec !== undefined && d.panel !== undefined) {
      findings.push(
        err(
          obj,
          CHECK_TURNSPEC_PANEL_EXCLUSIVE,
          `Session kind "${d.id}" declares BOTH "turnSpec" and "panel" — these are mutually exclusive (turnSpec drives dispatch, panel is its read-only twin for a legacy kind); remove one`,
        ),
      );
    } else {
      // turnSpec (R4-22 WI-1, ADR-043 §1): additive-optional, so a descriptor
      // with none skips this block entirely (AT-R422-5) — no finding, no
      // default. Every closed-vocabulary rejection below names BOTH the
      // offending value AND the allowed set (the file's binding rule, header
      // comment), even when that set is empty (SCHEMA_IDS today).
      if (d.turnSpec !== undefined) {
        const ts = d.turnSpec;

        // kindDir (AT-R422-11, 12): the ONE containment segment (ADR-043 §1)
        // — checked BEFORE anything else in this block, matching the
        // review's finding that this is the single most important gap. See
        // isSafeKindDirSegment's own doc comment for why SLUG_RE/CHECK_SLUG
        // (the sibling check on `d.id` above) cannot be reused here.
        if (!isSafeKindDirSegment(ts.kindDir)) {
          findings.push(
            err(
              obj,
              CHECK_TURNSPEC_UNSAFE_KIND_DIR,
              `Session kind "${d.id}" declares turnSpec.kindDir "${ts.kindDir}" — not a safe single path segment (no "/", "\\", ".", "..", or control characters)`,
            ),
          );
        }

        if (turnStyleState(ts.style) === undefined) {
          findings.push(
            err(
              obj,
              CHECK_TURNSPEC_UNKNOWN_STYLE,
              `Session kind "${d.id}" declares turnSpec.style "${ts.style}" — must be one of ${allowedIdsSummary(TURN_STYLES)}`,
            ),
          );
        }

        // structured-unsupported (AT-R422-18): "structured" IS a member of
        // TURN_STYLES (the unknown-style check above stays silent for it),
        // but SCHEMA_IDS ships deliberately EMPTY for R4-22 WI-1 — no schema
        // id can ever validate, so a structured turnSpec can NEVER be made
        // valid. Saying nothing would be a silent pass on a value that is
        // honestly unusable; this fires unconditionally on style:
        // "structured" while SCHEMA_IDS.length === 0, and self-expires
        // (mirrors the SCHEMA_IDS EXPIRY CONDITION comment above) the moment
        // a first schema id is seeded — at that point this becomes a real
        // membership check instead of a blanket one.
        if (ts.style === 'structured' && SCHEMA_IDS.length === 0) {
          findings.push(
            err(
              obj,
              CHECK_TURNSPEC_STRUCTURED_UNSUPPORTED,
              `Session kind "${d.id}" declares turnSpec.style "structured" but no schema is registered yet (SCHEMA_IDS is empty) — a structured turnSpec cannot be made valid until a schema id is seeded`,
            ),
          );
        }

        if (ts.schema !== undefined && schemaIdState(ts.schema) === undefined) {
          findings.push(
            err(
              obj,
              CHECK_TURNSPEC_UNKNOWN_SCHEMA,
              `Session kind "${d.id}" declares turnSpec.schema "${ts.schema}" — must be one of ${allowedIdsSummary(SCHEMA_IDS)}`,
            ),
          );
        }

        // W7-FIX-A2 (W7A2-03): bashFence is a closed vocabulary — an
        // unknown value is an ERROR (the runner refuses to start a turn on
        // it), never silently read as `deny` or `inspect`.
        if (ts.bashFence !== undefined && bashFenceModeState(ts.bashFence) === undefined) {
          findings.push(
            err(
              obj,
              CHECK_TURNSPEC_UNKNOWN_BASH_FENCE,
              `Session kind "${d.id}" declares turnSpec.bashFence "${ts.bashFence}" — must be one of ${allowedIdsSummary(BASH_FENCE_MODES)}`,
            ),
          );
        }

        validatePhaseTable(d, ts.phases, obj, 'turnSpec.phases', TURNSPEC_PHASE_CHECK_IDS, DISPATCHABLE_FINALIZER_IDS, findings);

        // `writes` (each phase's optional staging-area list) is deliberately
        // NOT validated anywhere in this block — see TurnSpecPhase's own
        // EXPIRY CONDITION doc comment above for why and when.
      }

      // panel (W6-B3, ADR-043 2026-08-15 amendment §2): additive-optional,
      // same discipline as turnSpec above — a descriptor with none skips this
      // block entirely, no finding, no default. Only the phase-row-level
      // checks apply (panel carries no kindDir/style/schema to validate).
      if (d.panel !== undefined) {
        validatePhaseTable(d, d.panel.phases, obj, 'panel.phases', PANEL_PHASE_CHECK_IDS, FINALIZER_IDS, findings);
      }
    }
  }

  return findings;
}
