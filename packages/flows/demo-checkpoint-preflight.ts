/**
 * Pre-claim demo-checkpoint producibility (bead forge-8vfn.8.5.18, T1 ruling
 * 1973cf — row 182).
 *
 * THE DEFECT. A work item's AC can name a bare CLI command in its WHEN
 * clause's inline-code span (`extractDrivableCommand`, `@forge/contracts`) —
 * the SAME text `derive-demo-model.ts`'s `acDerivedCheckpoints`
 * (`@forge/stations`) turns into a demo checkpoint at the integrate band,
 * AFTER the dev loop has already spent its iteration budget. Whether that
 * command's executable resolves (PATH / a declared package.json script / a
 * worktree-relative path) is knowable the moment the work items exist.
 *
 * WHY THIS IS THE EARLIEST POINT. The architect's `plan` gate
 * (`plan-gate-class-check.ts`) runs BEFORE the architect flow's `pm` node, so
 * the approved manifest carries no work items yet — no checkpoint commands
 * exist there to check. `pm` writes `.forge/work-items/*.md` into the SAME
 * worktree `forge-develop` later claims (S9/DEC-3 hand-off), so by
 * `forge-develop`'s claim (`validateClaimable`) the commands AND the ground
 * to resolve them against both already exist on disk — nothing downstream
 * of claim generates a checkpoint command that was not already there.
 *
 * REUSES THE INTEGRATE BAND'S OWN PREDICATE. `preflightDemoCommands`
 * (`phases/orchestrated-capture.ts`) is the exact rule `integrate.ts` applies
 * to a parsed demo.json's checkpoints, called here with commands read
 * straight off work items before any demo.json exists — a command judged
 * (un)producible here is never judged the other way there.
 *
 * SCOPED TO THE ONE CLASS THAT CAPTURES CHECKPOINT-COMMAND EVIDENCE. The
 * class → gate-profile table is the installed example factory's
 * (`@forge/factory/class-profiles.ts`), read elsewhere only through
 * `@forge/stations`'s `ClassProfilePort` (ADR 048); `packages/flows` sits
 * below both and may import neither. Today exactly one class (`code`) sets
 * `capture: 'checkpoints'` — every other class's AC-derived checkpoints are
 * never read downstream, so checking them here is pure false-refusal risk
 * for no payoff. Revisit the literal below if the table ever adds a second
 * checkpoint-capturing class.
 */

import { join } from 'node:path';

import type { ManifestClass } from '@forge/contracts';
import { extractDrivableCommand } from '@forge/contracts';

import { readWorkItemsFromDir, type WorkItem } from './work-item.ts';
import { preflightDemoCommands, type DemoCheckpointCommand } from './phases/orchestrated-capture.ts';

/** The one class whose installed gate profile captures checkpoint-command
 *  evidence (`@forge/factory/class-profiles.ts`'s `capture: 'checkpoints'`
 *  row) — see module header for why this is a literal, not a port read. */
const CLASSES_WITH_COMMAND_CHECKPOINTS: ReadonlySet<ManifestClass> = new Set(['code']);

/**
 * Every AC-derived checkpoint command the work items declare, flattened and
 * labelled in the SAME order `acDerivedCheckpoints`
 * (`@forge/stations/phases/derive-demo-model.ts`) would later assign — a
 * criterion that names no drivable command (no inline code, or one with shell
 * metacharacters) contributes nothing, exactly as it contributes no
 * checkpoint there.
 */
export function acDerivedCheckpointCommands(
  workItems: ReadonlyArray<Pick<WorkItem, 'work_item_id' | 'acceptance_criteria'>>,
): DemoCheckpointCommand[] {
  const commands: DemoCheckpointCommand[] = [];
  let i = 0;
  for (const wi of workItems) {
    for (const ac of wi.acceptance_criteria) {
      i += 1;
      const result = extractDrivableCommand(ac.when);
      if (result.ok) commands.push({ label: `AC ${i}: ${wi.work_item_id}`, command: result.command });
    }
  }
  return commands;
}

/**
 * `null` when the claim has nothing to refuse on this ground: the class does
 * not capture checkpoint-command evidence, no work items exist yet (a fresh
 * initiative with no architect hand-off), or every AC-derived command
 * resolves. Otherwise the refusal detail, naming every unproducible
 * checkpoint — the SAME wording `integrate.ts`'s `tooling-unavailable`
 * failure uses, so an operator who has seen that failure recognises this one.
 */
export function demoCheckpointPreflightRefusal(worktreePath: string, changeClass: ManifestClass): string | null {
  if (!CLASSES_WITH_COMMAND_CHECKPOINTS.has(changeClass)) return null;
  const { items } = readWorkItemsFromDir(join(worktreePath, '.forge', 'work-items'));
  if (items.length === 0) return null;
  const commands = acDerivedCheckpointCommands(items);
  if (commands.length === 0) return null;
  const preflight = preflightDemoCommands(commands, worktreePath);
  if (preflight.ok) return null;
  return `demo checkpoint command(s) not producible: ${preflight.problems.join('; ')}`;
}
