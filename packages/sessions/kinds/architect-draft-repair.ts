/**
 * Row 159 (bead forge-8vfn.8.1.47, ruling 1891) — the ONE bounded repair
 * turn a draft-manifest VALIDATION error earns before the architect session
 * fails: a single extra structured call, never a loop, carrying the validator's OWN message back
 * to the model verbatim so it fixes the one field named instead of
 * re-guessing the whole draft.
 *
 * S10 run 41 (`_1.0/reports/m7-a-run41-triage.md`): the architect's
 * revise-round draft produced `acceptance_criteria[8].given = ""` and
 * `buildManifest` (`architect-manifest.ts`'s `requireDraftAcceptanceCriteria`)
 * threw; the session went straight to `phase: 'failed'` with the raw error —
 * no repair turn, and no classified reason for the operator to act on.
 *
 * Split out of `architect-steps.ts` rather than inlined (that file is at its
 * own size budget) — `runDraftStep` is this module's only caller.
 */
import type { EventLogger } from '@forge/kernel';
import type { InitiativeManifest } from '@forge/contracts';
import { ARCHITECT_DRAFT_MANIFEST_UNRESOLVED_PREFIX } from '@forge/contracts';
import type { ToolUseLiveDetail } from '@forge/agents';
import type { ModelTier } from '@forge/agents/phase-agent.ts';
import { runStructured } from './architect-structured-turn.ts';
import type { QueryFn } from '../interactive-session.ts';
import type { DraftInitiative } from './architect-session.ts';

export type DraftManifestRepairArgs = {
  logger: EventLogger;
  initiativeId: string;
  sessionId: string;
  /** The project ground this turn runs on (`status.project_repo_path`). */
  cwd: string;
  queryFn: QueryFn;
  /** Row 193b — `plumbing.turnBudgetUsd`, forwarded to `runStructured`. */
  turnBudgetUsd?: () => number | undefined;
  modelTier?: ModelTier;
  onToolUse?: (d: ToolUseLiveDetail) => void;
  onHeartbeat?: () => void;
  onText?: (text: string) => void;
  onThinking?: (text: string) => void;
  /** The ORIGINAL draft prompt (brain index, idea, interview, explore block —
   *  everything `runDraftStep` already composed), with the repair section
   *  appended rather than rebuilt from scratch. */
  draftPrompt: string;
  schema: unknown;
  /** `buildManifest`'s own thrown Error — its `.message` IS the validator's
   *  text, carried to the model verbatim. */
  validationError: Error;
  /** `runDraftStep`'s own echoed-id unwrap, applied to the repaired draft the
   *  SAME way it was applied to the first one. */
  unwrap: (list: DraftInitiative[]) => DraftInitiative[];
  /** `runDraftStep`'s own manifest builder (unwrap already applied inside the
   *  caller's `buildAll`) — re-run over the repaired draft. Throws the same
   *  shape `buildManifest` does on a second, unresolved validation failure. */
  buildAll: (list: DraftInitiative[]) => InitiativeManifest[];
};

export type DraftManifestRepairResult = {
  manifests: InitiativeManifest[];
  draftInitiatives: DraftInitiative[];
  brainReads: string[];
};

/**
 * Runs the one bounded repair turn. Resolves with the repaired manifests on
 * success. On a second validation failure — the repair also produced an
 * invalid draft, or produced no initiatives at all — REJECTS with a
 * classified `Error` prefixed with `ARCHITECT_DRAFT_MANIFEST_UNRESOLVED_PREFIX`
 * (mirroring `PM_SET_VALIDATION_UNREPAIRED_PREFIX`, D-49): the same
 * literal lands in BOTH the thrown message (which `writeSessionTerminalPhase`
 * — `apps/forge/agent-dispatch-cmd.ts` — stamps onto `status.json.error`)
 * and an `architect`-phase `error` event, so `failure-classifier.ts` can name
 * the failure instead of "could not be classified".
 */
export async function repairDraftManifest(args: DraftManifestRepairArgs): Promise<DraftManifestRepairResult> {
  const {
    logger, initiativeId, sessionId, cwd, queryFn, turnBudgetUsd, modelTier,
    onToolUse, onHeartbeat, onText, onThinking, draftPrompt, schema, validationError, unwrap, buildAll,
  } = args;
  const emit = (message: string, eventType: 'log' | 'error', metadata: Record<string, unknown>): void => {
    logger.emit({
      initiative_id: initiativeId, phase: 'architect', skill: 'architect-runner', event_type: eventType,
      input_refs: [], output_refs: [], message, metadata: { session_id: sessionId, ...metadata },
    });
  };
  emit('architect.draft-repair.start', 'log', { validation_error: validationError.message });

  const repairPrompt = [
    draftPrompt,
    '',
    '# Draft repair (one bounded turn — row 159, ruling 1891)',
    '',
    `Manifest validation rejected your last draft: ${validationError.message}`,
    '',
    'Return the SAME structured output (vision + the full initiatives list) with ONLY the ' +
      'failing field corrected. Do not otherwise change the initiatives.',
  ].join('\n');
  const { output, brainReads } = await runStructured<{ vision?: string; initiatives?: DraftInitiative[] }>({
    logger, initiativeId, cwd, queryFn, turnBudgetUsd, prompt: repairPrompt, schema, modelTier,
    onToolUse, onHeartbeat, onText, onThinking,
  });
  const repairedInitiatives = Array.isArray(output?.initiatives) ? unwrap(output.initiatives) : [];

  try {
    if (repairedInitiatives.length === 0) throw validationError;
    const manifests = buildAll(repairedInitiatives);
    emit('architect.draft-repair.end', 'log', { outcome: 'repaired' });
    return { manifests, draftInitiatives: repairedInitiatives, brainReads };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const classified = `${ARCHITECT_DRAFT_MANIFEST_UNRESOLVED_PREFIX} ${message}`;
    emit(`architect.draft-repair.end: ${classified}`, 'error', { outcome: 'unresolved' });
    throw new Error(classified);
  }
}
