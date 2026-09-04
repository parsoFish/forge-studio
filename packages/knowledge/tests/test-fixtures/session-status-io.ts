/**
 * A real implementation of `SessionStatusIoPort` for tests that drive the drain
 * and the approve path end to end (M4 ruling 99).
 *
 * WHY THIS EXISTS RATHER THAN AN IMPORT. The production implementation lives in
 * `@forge/sessions/session-status-io.ts`, which this package (rank 2) may not
 * import — and a test importing it would mint exactly the boundary row the port
 * was created to close. So the port is implemented here, over `@forge/kernel`'s
 * `guardedFile`, which is the SAME containment primitive the real functions use.
 * The double is contained, not merely convenient.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not reimplement the sticky-cancel
 * refusal (`cancelledPhaseWins`). That rule is sessions' own, it is tested where
 * it is defined, and a second copy here would be a rule with two homes that
 * could disagree — the failure this package's port exists to avoid. A knowledge
 * test that needs sticky-cancel semantics is testing the wrong package.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { guardedFile } from '@forge/kernel';
import type { SessionStatusIoPort } from '../../kb-drain-model.ts';

export const testSessionStatusIo: SessionStatusIoPort = {
  read: <S,>(projectsRoot: string, dirSegments: readonly string[], leaf = 'status.json'): S | null => {
    const p = guardedFile(projectsRoot, [...dirSegments, leaf], 'read');
    if (p === null) return null;
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as S;
    } catch {
      return null;
    }
  },
  write: <S extends Record<string, unknown>>(
    projectsRoot: string,
    dirSegments: readonly string[],
    status: S,
    leaf = 'status.json',
  ): string | null => {
    const p = guardedFile(projectsRoot, [...dirSegments, leaf], 'write');
    if (p === null) return null;
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ ...status, updated_at: new Date().toISOString() }, null, 2));
    return p;
  },
};


/**
 * The REFUSING port, for the many route tests that never write a session
 * status. It throws for the same reason `runFixTurn`'s stub does: a stub that
 * returned a plausible path would let a future change write a session status
 * from a test that asserts nothing about it, unnoticed.
 *
 * Shared rather than repeated: eleven call sites declared this inline before it
 * moved here, which is twelve lines of identical prose per file and eleven
 * places for the refusal to drift.
 */
export const refusingSessionStatusIo: SessionStatusIoPort = {
  read: () => {
    throw new Error('unexpected guarded session-status READ in this test');
  },
  write: () => {
    throw new Error('unexpected guarded session-status WRITE in this test');
  },
};
