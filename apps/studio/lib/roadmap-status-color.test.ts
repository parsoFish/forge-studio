/**
 * AT2 (R4-13) — acceptance for the NOT-YET-EXISTING pure mapper
 * `queueStatusToColor` in forge-ui/lib/roadmap-status-color.ts.
 *
 * R4-13 replaces `SerpentineTimeline` (the roadmap laid out over TIME) with a
 * dependency DAG. The new DAG must colour initiative nodes from the SHARED
 * 5-tone palette (forge-ui/lib/status-colors.ts `STATUS_COLOR`:
 * idle/active/attention/complete/failed) — it must NOT port
 * SerpentineTimeline's own retiring `STATUS_COLOURS` map
 * (SerpentineTimeline.tsx:28-35) forward. That retiring map is a SIX-key
 * `Record<string,string>` keyed status→CSS-var string, and it hands
 * `ready-for-review` its OWN amber tone (`var(--c-review, #f0a500)`). The
 * shared palette has exactly FIVE tones and `ready-for-review` maps onto the
 * existing `attention` tone.
 *
 * CONTRACT this file pins: `queueStatusToColor(status: QueueState)` returns a
 * KEY of `STATUS_COLOR` (a semantic tone NAME — 'idle' | 'active' |
 * 'attention' | 'complete' | 'failed'), never a hex / `var(--…)` string.
 * `QueueState` is the status vocabulary carried by `RoadmapInitiative.status`
 * (forge-ui/lib/bridge-client.ts:199-215):
 * pending | in-flight | ready-for-review | merged | done | failed.
 *
 * KILLS:
 *  - porting the 6-key `STATUS_COLOURS` forward (that would return a
 *    `var(--…)`/hex string, and/or give `ready-for-review` a distinct 6th
 *    tone instead of reusing `attention`);
 *  - failing to collapse BOTH `merged` AND `done` onto `complete`.
 *
 * RED AT BASE: forge-ui/lib/roadmap-status-color.ts does NOT exist on this
 * branch yet — the `queueStatusToColor` import below fails to resolve, so the
 * whole file fails to load and every test is RED until the implementer creates
 * the module. Marker to grep in the runner output: `R4-13-AT2`.
 *
 * RUN: npx vitest run lib/roadmap-status-color.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';

import { queueStatusToColor } from '@/lib/roadmap-status-color';
import { STATUS_COLOR } from '@/lib/status-colors';

// The QueueState vocabulary carried by RoadmapInitiative.status
// (forge-ui/lib/bridge-client.ts:199-215).
const QUEUE_STATES = [
  'pending',
  'in-flight',
  'ready-for-review',
  'merged',
  'done',
  'failed',
] as const;

test('R4-13-AT2: pending -> idle', () => {
  expect(queueStatusToColor('pending')).toBe('idle');
});

test('R4-13-AT2: in-flight -> active', () => {
  expect(queueStatusToColor('in-flight')).toBe('active');
});

test('R4-13-AT2: ready-for-review -> attention (the SHARED tone, NOT the 6th "review" tone ported from STATUS_COLOURS)', () => {
  expect(queueStatusToColor('ready-for-review')).toBe('attention');
});

test('R4-13-AT2: merged -> complete', () => {
  expect(queueStatusToColor('merged')).toBe('complete');
});

test('R4-13-AT2: done -> complete', () => {
  expect(queueStatusToColor('done')).toBe('complete');
});

test('R4-13-AT2: merged AND done BOTH collapse to complete (kills "kept merged and done as distinct tones")', () => {
  expect(queueStatusToColor('merged')).toBe(queueStatusToColor('done'));
  expect(queueStatusToColor('merged')).toBe('complete');
});

test('R4-13-AT2: failed -> failed', () => {
  expect(queueStatusToColor('failed')).toBe('failed');
});

test('R4-13-AT2: every QueueState maps to a KEY of the shared STATUS_COLOR palette — never a hex / var() string (kills porting the 6-key STATUS_COLOURS values forward)', () => {
  const toneKeys = Object.keys(STATUS_COLOR);
  for (const state of QUEUE_STATES) {
    const tone = queueStatusToColor(state);
    // A key of the shared 5-tone palette, not a colour literal.
    expect(toneKeys).toContain(tone);
    // A ported STATUS_COLOURS value looks like 'var(--c-active, #3b82f6)'.
    expect(tone).not.toMatch(/var\(|#/);
  }
});

test('R4-13-AT2: the shared palette has exactly 5 tones and ready-for-review reuses one of them — kills a 6th "review" tone leaking through from the retiring 6-key map', () => {
  expect(Object.keys(STATUS_COLOR)).toHaveLength(5);
  expect(Object.keys(STATUS_COLOR)).toContain(queueStatusToColor('ready-for-review'));
});
