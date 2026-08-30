import { describe, it, expect } from 'vitest';

import {
  architectHexMeta,
  architectHexMetaForLifecycle,
  isArchitectWorking,
  isSessionStale,
  ARCHITECT_HEX_META,
  STALE_THRESHOLD_MS,
} from './architect-hex';
import { STATUS_COLOR } from './status-colors';
import type { ArchitectPhase } from './bridge-client';

const ALL_PHASES: ArchitectPhase[] = [
  'interviewing',
  'awaiting-answers',
  'exploring',
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

  it('falls back to an ATTENTION tone (never idle) for an unknown phase — W8-A2 ON-7 defect 3: idle claims "calm, nothing to worry about", which an unrecognised phase is not', () => {
    // KILLS: the pre-fix fallback `{ glow: STATUS_COLOR.idle, ... }`.
    const meta = architectHexMeta('???' as ArchitectPhase);
    expect(meta.glow).toBe(STATUS_COLOR.attention);
    expect(meta.frac).toBe(0);
    expect(meta.label).toBe('???');
  });

  it('greens the hex once committed', () => {
    expect(architectHexMeta('committed').frac).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// W8-A2 (ON-7 defect 3, WI-1a item 3) — architectHexMetaForLifecycle(phase,
// lifecycleState): a session whose DERIVED lifecycle is 'crashed' renders the
// failed tone and a truthful label regardless of its STORED (frozen-mid-work)
// phase. No settable `failed` field anywhere — `lifecycleState` is a plain
// argument, re-derived by the caller on every read, never stored by this
// function or read back from anywhere it wrote to.
// ---------------------------------------------------------------------------
describe('architectHexMetaForLifecycle (ON-7 defect 3)', () => {
  it('a crashed session renders the failed tone regardless of a stored phase of "drafting" — kills a phase-keyed-only map', () => {
    // KILLS: any implementation that ignores `lifecycleState` and only ever
    // consults `phase` (i.e. is byte-identical to `architectHexMeta`) — the
    // exact pre-fix shape, where a crashed runner frozen at 'drafting' reads
    // "drafting the plan…" forever.
    const meta = architectHexMetaForLifecycle('drafting', 'crashed');
    expect(meta.glow).toBe(STATUS_COLOR.failed);
    expect(meta.label).not.toBe(architectHexMeta('drafting').label);
    expect(meta.label.toLowerCase()).toContain('crash');
  });

  it('uses STATUS_COLOR.failed verbatim — never an invented colour', () => {
    expect(architectHexMetaForLifecycle('interviewing', 'crashed').glow).toBe(STATUS_COLOR.failed);
    expect(architectHexMetaForLifecycle('exploring', 'crashed').glow).toBe(STATUS_COLOR.failed);
  });

  it('every OTHER lifecycle state (or none at all) is UNCHANGED from the phase-only tone — never fabricates a crash', () => {
    // KILLS: an implementation that always overrides regardless of state
    // (would slander a working/awaiting-operator/terminal session as failed).
    for (const state of ['working', 'awaiting-operator', 'stalled', 'terminal', undefined] as const) {
      expect(architectHexMetaForLifecycle('drafting', state)).toEqual(architectHexMeta('drafting'));
    }
  });

  it('is pure: the same (phase, lifecycleState) always yields an equal result', () => {
    expect(architectHexMetaForLifecycle('finalizing', 'crashed')).toEqual(architectHexMetaForLifecycle('finalizing', 'crashed'));
  });
});

describe('isArchitectWorking', () => {
  it('is true only for interviewing/drafting/finalizing', () => {
    expect(isArchitectWorking('interviewing')).toBe(true);
    expect(isArchitectWorking('drafting')).toBe(true);
    expect(isArchitectWorking('exploring')).toBe(true);
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
