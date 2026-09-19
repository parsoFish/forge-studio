/**
 * The `rejected` phase handler's `catch {}` must not swallow a genuine
 * containment refusal from `archiveSessionDir` — forge-8vfn.5.58.
 *
 * `kinds/architect.ts`'s `rejected` step wraps `archiveSessionDir(...)` in a
 * blanket `try { ... } catch { /* already archived or gone *\/ }`. That catch
 * is right for the idempotent case (ARCH-6: a repeat reject turn finds no
 * live session dir, which is a legitimate no-op) but WRONG for a genuine
 * `PathGuardContainmentError` — a refusal indistinguishable from
 * "already archived" and logged nowhere.
 *
 * This drives the refusal WITHOUT a malicious session id (a malicious id
 * would already be refused by `runKindTurn`'s own SEC-04 preamble on
 * `[kindDir, sessionId]`, before the turn ever reaches this phase's step —
 * that is a different, already-closed defect). Instead the session id is
 * perfectly legitimate; what is poisoned is the ARCHIVE ROOT itself
 * (`_architect/_archived` symlinked outside the project root), which
 * `archiveSessionDir`'s own second `guardedOrRefuse` call catches — proving
 * the containment fix from forge-8vfn.5.57 does not, by itself, make the
 * refusal visible to an operator watching this session's event log.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runArchitectTurn, type ArchitectStatus } from '../../kinds/architect.ts';
import { stubArchitectManifestPorts } from '../../tests/architect-ports-stub.ts';
import type { EventLogEntry, EventLogger } from '@forge/kernel';

/** A logger that keeps every row it is given, so assertions are about rows —
 *  mirrors `critic-turn-cost.test.ts` / `architect-round-ceiling.test.ts`'s
 *  own fake. */
function capturingLogger(): { logger: EventLogger; rows: EventLogEntry[] } {
  const rows: EventLogEntry[] = [];
  const logger: EventLogger = {
    emit: (entry) => {
      const row = { event_id: `e${rows.length}`, cycle_id: 'c', started_at: '1970-01-01T00:00:00.000Z', ...entry } as EventLogEntry;
      rows.push(row);
      return row;
    },
    cycleId: 'c',
    logFilePath: '',
  };
  return { logger, rows };
}

/** Plants a `rejected`-phase session with a legitimate id, plus a SYMLINKED
 *  `_archived` dir pointing outside `projectRoot` — the archive ROOT is
 *  poisoned, not the session id. */
function plantRejectedSessionWithPoisonedArchiveRoot(): { root: string; projectRoot: string; sessionId: string } {
  const root = mkdtempSync(join(tmpdir(), 'arch-rejected-refusal-'));
  const projectRoot = join(root, 'projects', 'p1');
  const sessionId = '2026-09-19T00-00-00';
  const sessionDir = join(projectRoot, '_architect', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  mkdirSync(join(root, '_logs'), { recursive: true });
  const victim = join(root, 'victim');
  mkdirSync(victim, { recursive: true });
  symlinkSync(victim, join(projectRoot, '_architect', '_archived'), 'dir');
  const status: ArchitectStatus = {
    session_id: sessionId,
    project: 'p1',
    project_repo_path: projectRoot,
    phase: 'rejected',
    round: 1,
    idea: 'test the rejected-phase archive refusal',
    updated_at: new Date().toISOString(),
  };
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify(status, null, 2), 'utf8');
  return { root, projectRoot, sessionId };
}

test('a containment refusal while archiving a rejected session is NOT silently swallowed', async () => {
  const { root, projectRoot, sessionId } = plantRejectedSessionWithPoisonedArchiveRoot();
  const { logger, rows } = capturingLogger();

  const result = await runArchitectTurn({
    manifestPorts: stubArchitectManifestPorts(),
    sessionId,
    projectRoot,
    logsRoot: join(root, '_logs'),
    brainCwd: root,
    logger,
  });

  assert.equal(result.phase, 'rejected', 'the session still ends the turn in the rejected phase');

  const refusalRows = rows.filter(
    (r) => r.event_type === 'error' && typeof r.message === 'string' && r.message.toLowerCase().includes('archiv'),
  );
  assert.equal(
    refusalRows.length,
    1,
    `a containment refusal must be logged as a distinct, visible event — rows were:\n${JSON.stringify(rows, null, 2)}`,
  );

  assert.equal(
    (result as Record<string, unknown>)['archiveRefused'],
    true,
    'the turn result must carry a distinct outcome for the caller, not the same {phase:"rejected", wrote:[]} a genuine already-archived no-op returns',
  );
});

test('POSITIVE CONTROL: a repeat reject turn on an already-archived session stays a quiet success — the fix must not turn every reject into an error', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arch-rejected-already-archived-'));
  const projectRoot = join(root, 'projects', 'p1');
  const sessionId = '2026-09-19T00-00-01';
  // Archived up front below, so by the time `runArchitectTurn` runs,
  // `_architect/<sessionId>` is gone — this exercises `architectMissingStatus`
  // (ARCH-6's idempotency short-circuit), the SAME "no live session dir" case
  // `archiveSessionDir`'s "session dir not found" Error covers when reached
  // from inside the `rejected` step directly. Both are the genuine no-op this
  // fix must leave quiet.
  mkdirSync(join(projectRoot, '_architect'), { recursive: true });
  mkdirSync(join(root, '_logs'), { recursive: true });
  const status: ArchitectStatus = {
    session_id: sessionId,
    project: 'p1',
    project_repo_path: projectRoot,
    phase: 'rejected',
    round: 1,
    idea: 'idempotent reject after the session already archived',
    updated_at: new Date().toISOString(),
  };
  mkdirSync(join(projectRoot, '_architect', sessionId), { recursive: true });
  writeFileSync(join(projectRoot, '_architect', sessionId, 'status.json'), JSON.stringify(status, null, 2), 'utf8');
  // Archive it for real up front, through the SAME function, so the second
  // reject turn below finds a genuinely gone session dir.
  const { archiveSessionDir } = await import('../../kinds/architect-plan.ts');
  archiveSessionDir(projectRoot, sessionId);

  const { logger, rows } = capturingLogger();
  const result = await runArchitectTurn({
    manifestPorts: stubArchitectManifestPorts(),
    sessionId,
    projectRoot,
    logsRoot: join(root, '_logs'),
    brainCwd: root,
    logger,
  });

  assert.equal(result.phase, 'rejected');
  assert.equal((result as Record<string, unknown>)['archiveRefused'], undefined, 'a genuine idempotent no-op must not carry the refusal flag');
  assert.equal(
    rows.filter((r) => r.event_type === 'error').length,
    0,
    `the idempotent already-archived case must stay a quiet success — rows were:\n${JSON.stringify(rows, null, 2)}`,
  );
});
