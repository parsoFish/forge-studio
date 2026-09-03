/**
 * session-index-sort.test.ts — `sortAndCapSessionIndexRows`, as a package unit
 * test.
 *
 * SPLIT OUT of `cli/ui-bridge-sessions-index.test.ts` by the M4 routes carve.
 * That file held two different kinds of test against one subject: six
 * HTTP-level acceptance tests that boot a real bridge and fetch
 * `GET /api/studio/sessions`, and these five, which call a pure sorting helper
 * with hand-built rows and never touch a socket.
 *
 * The carve moved the helper into this package, which left the host file
 * importing `@forge/sessions` — a `legacy-to-package` edge. Splitting on the
 * line the tests themselves already drew fixes that honestly: the pure tests
 * come here where their subject lives (COMMON §5's "table-driven calls of the
 * handler" half), and the HTTP-level tests stay in `cli/` (§5's other half:
 * host HTTP tests stay until the host moves), now with no package import.
 *
 * Nothing about the assertions changed — only where they live and what they
 * import.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sortAndCapSessionIndexRows,
  SESSION_INDEX_MAX_ROWS,
  type SessionIndexRow,
} from '../../bridge-studio-session-index.ts';

function row(overrides: Partial<SessionIndexRow>): SessionIndexRow {
  return {
    kind: 'instructions',
    sessionId: 'fixture',
    project: 'p',
    phase: 'drafting',
    terminal: false,
    needsYou: false,
    // W7-A2 — the three lifecycle fields every row carries.
    state: 'working',
    error: null,
    idleMs: null,
    modelTier: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    href: '/sessions/instructions/fixture?project=p',
    ...overrides,
  };
}

test('sortAndCapSessionIndexRows: needsYou rows sort before non-needsYou rows regardless of updatedAt', () => {
  const older = row({ sessionId: 'a', needsYou: true, updatedAt: '2020-01-01T00:00:00.000Z' });
  const newer = row({ sessionId: 'b', needsYou: false, updatedAt: '2030-01-01T00:00:00.000Z' });
  const sorted = sortAndCapSessionIndexRows([newer, older]);
  assert.deepEqual(sorted.map((r) => r.sessionId), ['a', 'b']);
});

test('sortAndCapSessionIndexRows: within the same needsYou group, newest updatedAt sorts first', () => {
  const oldest = row({ sessionId: 'a', updatedAt: '2020-01-01T00:00:00.000Z' });
  const newest = row({ sessionId: 'b', updatedAt: '2030-01-01T00:00:00.000Z' });
  const middle = row({ sessionId: 'c', updatedAt: '2025-01-01T00:00:00.000Z' });
  const sorted = sortAndCapSessionIndexRows([oldest, newest, middle]);
  assert.deepEqual(sorted.map((r) => r.sessionId), ['b', 'c', 'a']);
});

test('sortAndCapSessionIndexRows: an honest-absent ("") updatedAt sorts LAST within its needsYou group, never treated as newest', () => {
  const absent = row({ sessionId: 'a', updatedAt: '' });
  const real = row({ sessionId: 'b', updatedAt: '2020-01-01T00:00:00.000Z' });
  const sorted = sortAndCapSessionIndexRows([absent, real]);
  assert.deepEqual(sorted.map((r) => r.sessionId), ['b', 'a']);
});

test('sortAndCapSessionIndexRows: caps to the given bound', () => {
  const rows = Array.from({ length: 10 }, (_, i) => row({ sessionId: `s${i}`, updatedAt: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z` }));
  const capped = sortAndCapSessionIndexRows(rows, 3);
  assert.equal(capped.length, 3);
  assert.deepEqual(capped.map((r) => r.sessionId), ['s9', 's8', 's7']);
});

test('sortAndCapSessionIndexRows: default cap is SESSION_INDEX_MAX_ROWS', () => {
  const rows = Array.from({ length: SESSION_INDEX_MAX_ROWS + 5 }, (_, i) => row({ sessionId: `s${i}` }));
  const capped = sortAndCapSessionIndexRows(rows);
  assert.equal(capped.length, SESSION_INDEX_MAX_ROWS);
});
