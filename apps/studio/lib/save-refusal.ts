/**
 * forge-mfv5.1.12 — a Save that did not land. The project PUT commits the config
 * to forge-studio, then the Save either refuses (contract files uncommitted:
 * `refused`) or fails on git (`merged: false` with a reason). Either way the
 * client reports NOT saved (row 6, ruling T1 1977a); only "nothing pending" and
 * "not a git repo" are a successful no-op.
 */
const NO_OP_DETAILS = ['no pending forge-studio changes', 'not a git repo'];

export function readSaveRefusal(save: unknown): { error: string; refused: string[] } | null {
  if (save === null || typeof save !== 'object') return null;
  const { refused, detail, merged } = save as { refused?: unknown; detail?: unknown; merged?: unknown };
  const files = Array.isArray(refused) ? refused.filter((f): f is string => typeof f === 'string') : [];
  const reason = typeof detail === 'string' ? detail : '';
  if (files.length > 0) return { error: reason || `not saved: ${files.join(', ')}`, refused: files };
  if (merged === false && !NO_OP_DETAILS.includes(reason)) return { error: reason || 'not saved', refused: [] };
  return null;
}
