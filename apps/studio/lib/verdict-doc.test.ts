import { describe, expect, it } from 'vitest';

import { verdictRecordToDoc } from './verdict-doc';

describe('verdictRecordToDoc', () => {
  it('maps the on-disk VerdictRecord shape onto VerdictDoc', () => {
    const doc = verdictRecordToDoc({
      kind: 'send-back',
      initiative_id: 'INIT-x',
      cycleId: 'CY-1',
      decidedBy: 'operator',
      rationale: 'AC-2 must be byte-identical',
      at: '2026-07-24T00:00:00.000Z',
    });
    expect(doc).toEqual({
      decision: 'send-back',
      by: 'operator',
      at: '2026-07-24T00:00:00.000Z',
      reasons: ['AC-2 must be byte-identical'],
    });
  });

  it('an approve record maps to decision approve with empty reasons when no rationale', () => {
    const doc = verdictRecordToDoc({ kind: 'approve', decidedBy: 'merge', at: 'T' });
    expect(doc?.decision).toBe('approve');
    expect(doc?.reasons).toEqual([]);
  });

  it('passes an already-mapped doc through and rejects junk', () => {
    const mapped = { decision: 'approve' as const, by: 'operator' };
    expect(verdictRecordToDoc(mapped)).toBe(mapped);
    expect(verdictRecordToDoc(null)).toBeNull();
    expect(verdictRecordToDoc({ neither: true })).toBeNull();
  });
});
