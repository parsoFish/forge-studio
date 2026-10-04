/**
 * per-work-item-row.ts — the ONE rule for "is this event a per-work-item row,
 * not a phase boundary?" (row 207, bead `forge-8vfn.8.5.57`).
 *
 * developer-ralph writes one `ralph.end` per work item, stamped
 * `metadata.work_item_id`, beside the developer-loop phase's own end per
 * attempt. A per-WI row never opens or closes the phase it rides on:
 * `deriveNodeStatuses` (@forge/flows) skips it when deciding whether a node
 * ended, and the story harness's run-end parity
 * (`scripts/stories/agent-parity.mjs`) skips it when pairing run-level
 * starts with ends. Both read this predicate, so they cannot disagree.
 *
 * Dependency-free on purpose: the story runner runs under plain `node` and
 * imports this file directly, the way it imports `process-liveness.ts`.
 */
export function isPerWorkItemRow(row: unknown): boolean {
  const metadata = (row as { metadata?: { work_item_id?: unknown } } | null | undefined)?.metadata;
  return typeof metadata?.work_item_id === 'string';
}
