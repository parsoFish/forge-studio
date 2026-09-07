/**
 * `deriveSessionLedgerRows` — M6-A exit row 3, S9 beats 13-14.
 *
 * The dedupe is the load-bearing part and it was measured, not guessed: S9
 * run 2 read `/monitor` with two live sessions and found
 * `data-ledger-total="1"`, the row belonging to `onboarding-agent`. Onboarding
 * dispatches through the run host, so it already HAS a standalone-run row;
 * joining every session would list that work twice and inflate the total the
 * operator reads as their spend. So the third test below is not a nicety — it
 * is the reason this module filters at all.
 */
import { test, expect } from 'vitest';
import { deriveSessionLedgerRows } from './session-ledger';
import type { SessionIndexRow } from './studio-client';

function session(over: Partial<SessionIndexRow>): SessionIndexRow {
  return {
    kind: 'authoring',
    sessionId: '2026-09-08T00-00-00-abcdef',
    project: 'mdtoc',
    phase: 'analyzing',
    terminal: false,
    needsYou: false,
    state: 'working',
    error: null,
    idleMs: null,
    modelTier: 'opus',
    agent: 'creation-agent',
    costUsd: 1.5,
    runId: null,
    updatedAt: '2026-09-08T00:00:00.000Z',
    href: '/sessions/authoring/2026-09-08T00-00-00-abcdef',
    ...over,
  };
}

test('a spine session becomes a ledger row carrying its agent, its cost and its own href', () => {
  const [row] = deriveSessionLedgerRows([session({})]);
  expect(row.linkKind).toBe('session');
  expect(row.agent).toBe('creation-agent');
  expect(row.costUsd).toBe(1.5);
  expect(row.href).toBe('/sessions/authoring/2026-09-08T00-00-00-abcdef');
  expect(row.status).toBe('analyzing');
  expect(row.narrative, 'no segment kind applies to a session — honest null, never filler').toBeNull();
});

test('an unpriced session keeps null — the ledger omits the attribute rather than showing 0.00', () => {
  const [row] = deriveSessionLedgerRows([session({ costUsd: null })]);
  expect(row.costUsd).toBeNull();
});

test('a session that dispatched through the run host is DROPPED — it already has a row, and listing it twice inflates the operator’s spend', () => {
  const rows = deriveSessionLedgerRows([
    session({ kind: 'onboarding', agent: 'onboarding-agent', sessionId: 'ran-through-the-host', runId: 'RUN-123' }),
    session({}),
  ]);
  expect(rows.map((r) => r.id)).toEqual(['2026-09-08T00-00-00-abcdef']);
});
