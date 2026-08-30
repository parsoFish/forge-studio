/**
 * verdict-doc.ts — map the on-disk VerdictRecord shape
 * (orchestrator/flow-artifacts.ts: `{kind, decidedBy, rationale, at}`) onto
 * the renderer's VerdictDoc. The artifact page used to pass the raw record
 * straight through, so `doc.decision` was always undefined and view mode
 * rendered "Approved" for every verdict — including send-backs (R4-08-F3
 * fix). Pure module (no React) so the mapping is unit-testable under the
 * lib/** vitest include.
 */

export type VerdictDoc = {
  decision?: 'approve' | 'send-back';
  by?: string;
  at?: string;
  reasons?: string[];
};

/** Tolerant: an already-mapped doc passes through; junk maps to null. */
export function verdictRecordToDoc(raw: unknown): VerdictDoc | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.decision === 'string') return raw as VerdictDoc;
  if (typeof r.kind !== 'string') return null;
  return {
    decision: r.kind === 'send-back' ? 'send-back' : 'approve',
    by: typeof r.decidedBy === 'string' ? r.decidedBy : undefined,
    at: typeof r.at === 'string' ? r.at : undefined,
    reasons: typeof r.rationale === 'string' && r.rationale.trim() ? [r.rationale] : [],
  };
}
