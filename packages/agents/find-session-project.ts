/**
 * find-session-project.ts — `findSessionProject`, split out of `agent-run.ts`
 * (M4-agents, exit row 5).
 *
 * One function with one caller shape: the operator omitted `--project`, so the
 * project is discovered by scanning `projects/*` for the session's own
 * `_architect/<sessionId>/PLAN.md`. It is separate from both command paths
 * because it belongs to neither — it is the fallback both can reach for.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { isSafeRunId } from './run-agent.ts';

/**
 * Scan `projects/*` for `_architect/<sessionId>/PLAN.md` and return the
 * first match's project root. Used when the operator omits `--project`.
 */
export function findSessionProject(sessionId: string): string | null {
  // Defense-in-depth (SEC-07 r35): the function is statically proven never to
  // return an out-of-root path (it only ever returns a real readdir-enumerated
  // `projects/*` entry), but a malformed session id (separator/`..`/empty) can
  // never name a legitimate architect session — refuse it early. `isSafeRunId`
  // (SAFE_RUN_ID_RE + explicit `..` check) still admits a legit
  // `<iso-with-dashes>-<name>` architect id.
  if (!isSafeRunId(sessionId)) return null;
  const projectsDir = resolve('projects');
  if (!existsSync(projectsDir)) return null;
  let entries: string[];
  try {
    entries = readdirSync(projectsDir);
  } catch {
    return null;
  }
  for (const name of entries) {
    const candidate = join(projectsDir, name);
    try {
      const stat = statSync(candidate);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }
    // Match on the session dir (status.json appears from the first turn;
    // PLAN.md only appears once drafting completes).
    const sessionDir = join(candidate, '_architect', sessionId);
    if (existsSync(join(sessionDir, 'status.json')) || existsSync(join(sessionDir, 'PLAN.md'))) {
      return candidate;
    }
  }
  return null;
}
