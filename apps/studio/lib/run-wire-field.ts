/**
 * The declared-data-fails-open guard `parseRun` (studio-client.ts) applies to
 * every Run field the server serves OPTIONALLY: a field the server actually
 * sent must survive parsing unchanged; a field it omitted must stay absent,
 * never coerced to a default. `stopOnBudget` (W8-A2, ON-7 defect 2) and
 * `operatorStop` (M7 row 150, bead forge-8vfn.8.1.39, ruling 1774) are the
 * same guard applied to two different fields — this is the ONE place that
 * rule lives, so a third field never re-derives it slightly differently.
 *
 * Split out of studio-client.ts (rather than inlined a third time) so
 * restoring this guard's own explanatory comment — undone by an earlier,
 * disallowed "pack it to fit the line-count baseline" edit — does not grow
 * that file past its baseline again; see the cleanup round that added this
 * file for the full history.
 */
export function carryWireFieldIfDefined<K extends string, V>(
  value: V | undefined,
  key: K,
): { [P in K]?: V } {
  return value !== undefined ? ({ [key]: value } as { [P in K]?: V }) : {};
}
