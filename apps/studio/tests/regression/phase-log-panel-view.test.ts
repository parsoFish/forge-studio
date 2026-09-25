/**
 * forge-7wc — PhaseDrawer's Effect 1 identity fetch swallowed rejections
 * (try/finally, no catch), leaving the log pane empty with nothing
 * surfaced to the operator — indistinguishable from a genuinely empty log.
 *
 * Pins the pure derivation `derivePhaseLogPanelState` (lib/phase-log-panel-
 * view.ts): a rejected fetch must read as its OWN state, never fall through
 * to "empty". See that module's header for the full defect writeup.
 *
 * RUN: npx vitest run --root apps/studio apps/studio/tests/regression/phase-log-panel-view.test.ts
 */
import { test, expect } from 'vitest';
import { derivePhaseLogPanelState, phaseLogErrorMessage } from '@/lib/phase-log-panel-view';

test('RED forge-7wc: a failed fetch (error set, zero lines, not loading) reads as "error", never "empty"', () => {
  const state = derivePhaseLogPanelState({ loading: false, error: 'network down', lineCount: 0 });
  expect(state).toEqual({ kind: 'error', message: 'network down' });
});

test('a genuinely empty log (no error, zero lines, not loading) still reads as "empty"', () => {
  const state = derivePhaseLogPanelState({ loading: false, error: null, lineCount: 0 });
  expect(state).toEqual({ kind: 'empty' });
});

test('a fetch in flight reads as "loading" regardless of a stale error or line count', () => {
  expect(derivePhaseLogPanelState({ loading: true, error: 'stale error', lineCount: 3 })).toEqual({ kind: 'loading' });
  expect(derivePhaseLogPanelState({ loading: true, error: null, lineCount: 0 })).toEqual({ kind: 'loading' });
});

test('populated, settled, no error reads as "lines"', () => {
  expect(derivePhaseLogPanelState({ loading: false, error: null, lineCount: 5 })).toEqual({ kind: 'lines' });
});

test('error takes priority over a non-zero line count (a stale error must not be silently dropped by leftover lines)', () => {
  expect(derivePhaseLogPanelState({ loading: false, error: 'boom', lineCount: 5 })).toEqual({ kind: 'error', message: 'boom' });
});

test('phaseLogErrorMessage: a real Error carries its own message through', () => {
  expect(phaseLogErrorMessage(new Error('fetch failed: 500'))).toBe('fetch failed: 500');
});

test('phaseLogErrorMessage: a string rejection is carried through', () => {
  expect(phaseLogErrorMessage('boom')).toBe('boom');
});

test('phaseLogErrorMessage: a non-Error, non-string, or empty-message rejection still yields a non-empty honest fallback', () => {
  expect(phaseLogErrorMessage(undefined)).toBe('Could not load this phase’s log.');
  expect(phaseLogErrorMessage({ weird: true })).toBe('Could not load this phase’s log.');
  expect(phaseLogErrorMessage(new Error(''))).toBe('Could not load this phase’s log.');
  expect(phaseLogErrorMessage('')).toBe('Could not load this phase’s log.');
});
