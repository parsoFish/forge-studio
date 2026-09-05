/**
 * The class → gate-profile rules that observe a DECOMPOSED SET (ADR 051,
 * T1 ruling 229 half A).
 *
 * `singleWiAllowed` is enforced as a GATE at the plan gate, on the initiative's
 * declared `acceptance_criteria`, before any spend — see
 * `@forge/flows`'s plan-gate class check. Here, after the project manager has
 * run, the same column is a FLAG and never a failure, for a reason worth
 * stating: a one-item decomposition of a genuinely one-item initiative is the
 * PM being CORRECT, and the PM is the wrong actor to punish for the architect's
 * scoping. The warning belongs in the report the operator reads, next to the
 * plan-gate refusal that would have caught it earlier.
 *
 * That asymmetry is why this is a table lookup and not an `if`: the same
 * one-item set is worth flagging for `code` and `infra` and is the normal shape
 * for `docs` and `config`.
 */

import { profileFor } from '../class-profiles.ts';
import type { InitiativeManifest } from '@forge/flows/manifest.ts';
import type { WorkItem } from '@forge/flows/work-item.ts';

/**
 * The flag's message, or `null` when there is nothing to say.
 *
 * An EMPTY set is not this rule's business — "the PM produced nothing" is
 * already its own failure, and a flag on top of it would bury the real one.
 */
export function underDecomposedFlag(
  manifest: InitiativeManifest,
  items: ReadonlyArray<WorkItem>,
): string | null {
  if (items.length !== 1) return null;
  if (profileFor(manifest.class).singleWiAllowed) return null;
  return (
    `a ${manifest.class} initiative decomposed to ONE work item (${items[0]?.work_item_id}). The ` +
    `${manifest.class} gate profile does not accept a single-criterion initiative at the plan gate, so ` +
    `either this initiative was scoped smaller than its class expects, or one work item genuinely covers ` +
    `it. Recorded for the report, not enforced here: the decomposition is not the place to punish scoping.`
  );
}
