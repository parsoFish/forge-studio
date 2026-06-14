import { describe, it, expect } from 'vitest';

import {
  architectHexMeta,
  isArchitectWorking,
  isSessionStale,
  ARCHITECT_HEX_META,
  STALE_THRESHOLD_MS,
} from './architect-hex';
import type { ArchitectPhase } from './bridge-client';

const ALL_PHASES: ArchitectPhase[] = [
  'interviewing',
  'awaiting-answers',
  'drafting',
  'awaiting-verdict',
  'finalizing',
  'committed',
  'rejected',
];

describe('architectHexMeta', () => {
  it('returns a meta for every known phase', () => {
    for (const phase of ALL_PHASES) {
      const meta = architectHexMeta(phase);
      expect(meta).toBe(ARCHITECT_HEX_META[phase]);
      expect(meta.glow).toMatch(/^#/);
      expect(meta.frac).toBeGreaterThanOrEqual(0);
      expect(meta.frac).toBeLessThanOrEqual(1);
      expect(meta.label.length).toBeGreaterThan(0);
    }
  });

  it('falls back to an idle meta for an unknown phase', () => {
    const meta = architectHexMeta('???' as ArchitectPhase);
    expect(meta.frac).toBe(0);
    expect(meta.label).toBe('???');
  });

  it('greens the hex once committed', () => {
    expect(architectHexMeta('committed').frac).toBe(1);
  });
});

describe('isArchitectWorking', () => {
  it('is true only for interviewing/drafting/finalizing', () => {
    expect(isArchitectWorking('interviewing')).toBe(true);
    expect(isArchitectWorking('drafting')).toBe(true);
    expect(isArchitectWorking('finalizing')).toBe(true);
  });

  it('is false for gate/terminal phases', () => {
    expect(isArchitectWorking('awaiting-answers')).toBe(false);
    expect(isArchitectWorking('awaiting-verdict')).toBe(false);
    expect(isArchitectWorking('committed')).toBe(false);
    expect(isArchitectWorking('rejected')).toBe(false);
  });
});

describe('isSessionStale (P1)', () => {
  it('is stale when a working phase is silent beyond the threshold', () => {
    expect(isSessionStale({ phase: 'drafting', staleMs: STALE_THRESHOLD_MS + 1 })).toBe(true);
  });

  it('is NOT stale at or under the threshold (clears on refresh)', () => {
    expect(isSessionStale({ phase: 'drafting', staleMs: STALE_THRESHOLD_MS })).toBe(false);
    expect(isSessionStale({ phase: 'drafting', staleMs: 0 })).toBe(false);
    expect(isSessionStale({ phase: 'drafting' })).toBe(false);
  });

  it('is never stale in a non-working phase, however old', () => {
    expect(isSessionStale({ phase: 'awaiting-answers', staleMs: 10 * STALE_THRESHOLD_MS })).toBe(false);
    expect(isSessionStale({ phase: 'awaiting-verdict', staleMs: 10 * STALE_THRESHOLD_MS })).toBe(false);
    expect(isSessionStale({ phase: 'committed', staleMs: 10 * STALE_THRESHOLD_MS })).toBe(false);
  });
});
