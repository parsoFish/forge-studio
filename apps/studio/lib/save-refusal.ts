/**
 * forge-mfv5.1.12 — a refused Save. The project PUT commits the config to
 * forge-studio, then the Save refuses while a contract file is uncommitted; the
 * client must report that as NOT saved, carrying the files (row 6, ruling T1 1977a).
 */
export function readSaveRefusal(save: unknown): { error: string; refused: string[] } | null {
  if (save === null || typeof save !== 'object') return null;
  const { refused, detail } = save as { refused?: unknown; detail?: unknown };
  const files = Array.isArray(refused) ? refused.filter((f): f is string => typeof f === 'string') : [];
  if (files.length === 0) return null;
  return { error: typeof detail === 'string' ? detail : `not saved: ${files.join(', ')}`, refused: files };
}
