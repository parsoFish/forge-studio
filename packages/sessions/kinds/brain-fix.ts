/**
 * The brain-fix session kind — port 5 of ruling 60.
 *
 * IDENTITY only: the skill, the prompt, where the agent may write, what
 * "cleared" means, what the turn returns. The twelve plumbing behaviours are
 * `kinds/fix-turn.ts`'s, whose header carries the whole rationale for this
 * port (why not `kind-turn.ts`, why not `runAgentTurn`, why the kind owns its
 * options bag). Behaviour is unchanged from `brain-fix-runner.ts`, byte for
 * byte at the SDK seam. Every W-numbered comment below records a defect this
 * file must not reacquire and is carried over verbatim.
 */
import { relative } from 'node:path';

import { deriveAgentSpec } from '@forge/agents/studio/derive.ts';
import { modelForSpec } from '@forge/agents/phase-agent.ts';
import { skillPathRelative } from '@forge/agents/skill-path.ts';
import { runBrainLint, lintThemeFiles, classify } from '@forge/knowledge/brain-lint.ts';
import { guardAgentKbEdits, snapshotBrainTree, type KbEditGateResult } from '@forge/knowledge/kb-drain-edit-soundness.ts';
import { resolveKbBrainDir } from '@forge/knowledge/brain-paths.ts';

import { writeRootFenceOptions } from '../session-write-fence.ts';
import { runFixTurn, type FixTurnInput, type FixTurnResult, type FixTurnVariant } from './fix-turn.ts';

// ---------------------------------------------------------------------------
// ADR-024: spec derived from skills/brain-fix/SKILL.md
// ---------------------------------------------------------------------------

export const brainFixAgentSpec = deriveAgentSpec(skillPathRelative('brain-fix'));
export const BRAIN_FIX_MODEL = modelForSpec(brainFixAgentSpec);

// ---------------------------------------------------------------------------
// Public types — the entry point's shape is UNCHANGED across the port
// ---------------------------------------------------------------------------

export type { QueryFn } from './fix-turn.ts';

export type RunBrainFixInput = FixTurnInput & {
  /** The KB id of the brain this file belongs to (for context). */
  kbId: string;
  /** Absolute path to the file to fix. */
  file: string;
  /** The check slug from the finding (e.g. 'frontmatter.missing-field'). */
  check: string;
  /** The kind slug from the finding (same as check in practice). */
  kind: string;
  /** Optional concrete repair hint from classifyFinding. */
  fixHint?: string;
  /** The finding's human-readable message. */
  message: string;
};

export type RunBrainFixResult = FixTurnResult & {
  /**
   * True when the re-lint after the agent turn found no same-kind finding
   * AND the edit gate left every one of the turn's writes standing.
   *
   * W8-F1: `cmdBrainFix` (apps/forge/cli.ts — what the per-finding
   * `op=fix-agent` button spawns) reads ONLY this field and prints "CLEARED".
   * A turn whose writes were refused has not cleared anything, so the refusal
   * is folded in here rather than left for a caller to remember to check.
   */
  cleared: boolean;
  /**
   * What the edit-soundness gate did to this turn's writes.
   *
   * W8-F1: REQUIRED. It used to be optional and was omitted whenever the KB
   * id resolved to no brain dir, or whenever the gate threw — in both cases
   * the turn ran with NO gate and said so only by omission, which nothing
   * downstream ever read as a failure. A turn that was not audited must not
   * be representable.
   */
  editAudit: KbEditGateResult;
};

/** What `prepare` hands `finish`: the pre-turn brain snapshot the gate diffs. */
type BrainFixPre = { snapshot: ReturnType<typeof snapshotBrainTree> };

// ---------------------------------------------------------------------------
// The variant
// ---------------------------------------------------------------------------

export const brainFixKind: FixTurnVariant<RunBrainFixInput, RunBrainFixResult, BrainFixPre> = {
  // `_brainfix`, not `_brain-fix`: the on-disk dir has never carried the
  // hyphen, `readBrainFixTurnCostUsd` in knowledge's drain reads
  // `_logs/_brainfix-<subRunId>/events.jsonl` by that exact name, and the UI
  // tail keys on it. Stated, never computed from the skill name.
  cycleIdPrefix: '_brainfix',
  eventPhase: 'reflection',
  eventSkill: 'brain-fix',
  skillName: 'brain-fix',
  fallbackPrompt: 'You are the forge brain-fix agent.',
  inputRefs: (input) => [input.file],
  startMessage: (input) => `brain-fix.start (kind=${input.kind}, file=${input.file})`,
  startMetadata: (input) => ({
    runId: input.runId,
    kbId: input.kbId,
    kind: input.kind,
    check: input.check,
  }),

  prepare: ({ input, skillPrompt }) => {
    const userPayload = [
      '## Fix task',
      '',
      `**File (absolute path):** ${input.file}`,
      `**Finding kind:** ${input.kind}`,
      `**Finding message:** ${input.message}`,
      ...(input.fixHint ? [`**Fix hint:** ${input.fixHint}`] : []),
      '',
      'Open the file, apply ONLY the single targeted fix that clears this finding, do not touch any other files, then stop.',
    ].join('\n');

    // W8-F1 — the WRITE-ROOT FENCE, at the spawn seam. Before it, the only
    // thing keeping the agent on-target was the prose "do not touch any other
    // files" (declared-data-fails-open): the C4 hostile re-verification had it
    // delete a resolvable `related_themes` edge in another sub-wiki entirely.
    // A fence is three settings TOGETHER, which is why one builder installs
    // them — wave-7's sessions-kinds-V01 was a live write escape from getting
    // two of the three right.
    //
    // The call is UNCONDITIONAL because an unresolvable kbId must deny every
    // write, not permit them: an empty root list makes `canUseTool` refuse a
    // write matching no root. Fail closed. Arm 3 of
    // `tests/regression/fix-turn-capture.test.ts` pins that branch.
    const guardedBrainDir = resolveKbBrainDir(input.forgeRoot, input.kbId);

    // W8-B2/W8-F1 — the snapshot is the WHOLE brain, not the drained KB's own
    // dir. The audit was already brain-wide (`buildKbEditSoundnessCtx`
    // collects theme targets from `brain/`); only the snapshot was per-KB, so
    // the gate knew the neighbour theme existed and could not see it change.
    // `snapshotBrainTree` takes no scope parameter for exactly that reason.
    const snapshot = snapshotBrainTree(input.forgeRoot);

    return {
      pre: { snapshot },
      spawn: {
        prompt: [skillPrompt, '', userPayload].join('\n'),
        // Key order is load-bearing evidence, not style — see fix-turn.ts's
        // header. This is the bespoke runner's order, unchanged.
        options: {
          cwd: input.forgeRoot,
          model: BRAIN_FIX_MODEL,
          disallowedTools: [...brainFixAgentSpec.disallowedTools],
          maxTurns: 8,
          ...writeRootFenceOptions({
            writeRoots: guardedBrainDir ? [guardedBrainDir] : [],
            allowedTools: brainFixAgentSpec.allowedTools,
            cwd: input.forgeRoot,
          }),
        },
      },
    };
  },

  finish: ({ input, pre, crashed }) => {
    // W8-B2 — the gate runs around the TURN, not at a call site. There are
    // three production callers (the drain's round loop, `runBrainConsolidateNow`,
    // and `forge brain fix`); the first cut guarded the drain alone, so the two
    // paths an operator clicks by HAND could still land the 2026-08-22 edits.
    // Guarding a call site closes a door; guarding the turn closes the class.
    // BEFORE the re-lint, deliberately: a refused edit is reverted, so the
    // finding is back on disk and the lint must see that. It runs on the CRASH
    // path too — omitting the audit is not the same as refusing the edit.
    const editAudit = applyEditGate(input, pre.snapshot);

    let cleared = false;
    if (!crashed) {
      const relFile = relative(input.forgeRoot, input.file);
      try {
        // W8-B2 — the verification lens must cover the file it is verifying.
        // `runBrainLint`'s `checkSourceLinks`/`checkDanglingEdges` are
        // CHECK_SCOPE 'forge-themes' and walk only brain/cycles/themes and
        // brain/forge-dev/themes, so for a PROJECT theme they produced no
        // finding at all and `cleared` came back unconditionally TRUE for the
        // two check kinds both 2026-08-22 drain defects involved. Unioning in
        // `lintThemeFiles` (the project-aware lens the drain already surfaces
        // findings through) makes the thing that raises a finding and the
        // thing that verifies its fix agree about which files exist — two
        // derivations disagreeing is forge-d8l's shape.
        const scoped = runBrainLint({ cwd: input.forgeRoot, scope: 'single-file', file: relFile }).findings;
        const perFile = lintThemeFiles(input.forgeRoot, [input.file]).map((f) => (f.resolution ? f : classify(f)));
        cleared = ![...scoped, ...perFile].some(
          (f) => f.kind === input.kind && (f.file === input.file || f.file === relFile),
        );
      } catch {
        cleared = false;
      }
    }

    // W8-F1 — a turn that had a write REFUSED, or whose gate could not
    // complete, has not cleared anything, whatever the re-lint says. Folded in
    // HERE, once, rather than left to each caller: `cmdBrainFix` reads only
    // this field.
    if (editAudit.refused.length > 0 || editAudit.errors.length > 0) cleared = false;

    return {
      result: { runId: input.runId, cleared, editAudit },
      endMetadata: {
        runId: input.runId,
        kind: input.kind,
        file: input.file,
        cleared,
        refused: editAudit.refused.length,
        unsound: editAudit.unsound.map((u) => u.kind),
        ...(editAudit.errors.length > 0 ? { gateErrors: editAudit.errors } : {}),
      },
    };
  },
};

/** Run one brain-fix turn. The entry point's name and shape are unchanged. */
export async function runBrainFixTurn(input: RunBrainFixInput): Promise<RunBrainFixResult> {
  return runFixTurn(brainFixKind, input);
}

/**
 * W8-F1 — the gate is TOTAL and its verdict is folded into `cleared`.
 *
 * This used to `catch` and return `undefined`: the agent's writes stayed on
 * disk, the turn returned normally, and the two callers with no second gate
 * (`runBrainConsolidateNow`, `cmdBrainFix`) reported success. Omitting the
 * audit is not the same as refusing the edit.
 *
 * `guardAgentKbEdits` no longer throws — it names what it could not dispose of
 * in `errors`. The `catch` here is the last line of defence for an
 * unforeseeable failure (an OOM in the walk, say), and it too refuses rather
 * than reporting clean.
 */
function applyEditGate(
  input: RunBrainFixInput,
  snapshot: ReturnType<typeof snapshotBrainTree>,
): KbEditGateResult {
  try {
    return guardAgentKbEdits(input.forgeRoot, input.kbId, snapshot);
  } catch (err) {
    return {
      changes: [], refused: [], repaired: [], unsound: [],
      errors: [`kb-edit-gate: the gate itself failed (${err instanceof Error ? err.message : String(err)}) — this turn's writes were NOT audited`],
    };
  }
}
