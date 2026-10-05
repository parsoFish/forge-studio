/**
 * find-session-project.ts — `findSessionProject`, split out of `agent-run.ts`
 * (M4-agents, exit row 5).
 *
 * One function with one caller shape: the operator omitted `--project`, so the
 * project is discovered by scanning the session dirs under the logs root
 * (`<logsRoot>/_sessions/*`) for the session's own `_architect/<sessionId>`.
 * It is separate from both command paths because it belongs to neither — it is
 * the fallback both can reach for.
 */

import { ARCHITECT_KIND_DIR, guardedFile, guardedReadDir, sessionDirSegments, SESSIONS_DIRNAME } from '@forge/kernel';

import { isSafeRunId } from './run-agent.ts';

/**
 * Scan `<logsRoot>/_sessions/*` for `_architect/<sessionId>` and return the
 * first match's PROJECT NAME. Used when the operator omits `--project`.
 */
export function findSessionProject(logsRoot: string, sessionId: string): string | null {
  // Defense-in-depth (SEC-07 r35): a malformed session id (separator/`..`/empty)
  // can never name a legitimate architect session — refuse it early.
  // `isSafeRunId` (SAFE_RUN_ID_RE + explicit `..` check) still admits a legit
  // `<iso-with-dashes>-<name>` architect id.
  if (!isSafeRunId(sessionId)) return null;
  for (const project of guardedReadDir(logsRoot, [SESSIONS_DIRNAME]) ?? []) {
    // Match on the session dir (status.json appears from the first turn;
    // PLAN.md only appears once drafting completes).
    const segs = sessionDirSegments(project, ARCHITECT_KIND_DIR, sessionId);
    if (guardedFile(logsRoot, [...segs, 'status.json'], 'read') !== null || guardedFile(logsRoot, [...segs, 'PLAN.md'], 'read') !== null) {
      return project;
    }
  }
  return null;
}
