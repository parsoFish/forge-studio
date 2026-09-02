/**
 * Two facts about `_logs/` and the ids under it that more than one package
 * needs, and none of them owns.
 *
 * Both arrived here because a rank-2 package had to reach ABOVE itself for
 * them (M4-knowledge s5, ruling 57): `listCycles` sat in `@forge/flows`
 * (rank 5) and `isSafeRunId` in `@forge/agents` (rank 3), while
 * `packages/knowledge` needed each to walk `_logs/<cycleId>/events.jsonl` and
 * to gate a drain-run id before it becomes a path. Neither drags a dependency
 * down: one is a directory listing, the other a charset test.
 *
 * Their previous homes re-export them, so every existing caller is unchanged.
 */
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/** The cycle directories under `_logs/`, sorted. Absent dir -> `[]`, never a throw. */
export function listCycles(logsDir = '_logs'): string[] {
  const dir = resolve(logsDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/**
 * Single path segment of `[A-Za-z0-9._-]` — deliberately permits a leading
 * `_` (unlike `review-comments.ts`'s `SAFE_CYCLE_ID_RE`, which requires an
 * alnum first char and so does not fit `runAgent`'s own runId formats,
 * `_agent-<slug>` / `_agent-<slug>-<n>`, or cycleId-like ids).
 */
const SAFE_RUN_ID_RE = /^[A-Za-z0-9._-]+$/;

/**
 * The ONE predicate every path-traversal-sensitive call site that builds a
 * `_logs/`-relative dir name from a caller-supplied id shares, rather than
 * re-deriving the regex. The `..` check is not redundant with the charset:
 * `.` is in the charset, so `..` matches the regex and must be excluded
 * explicitly.
 */
export function isSafeRunId(runId: string): boolean {
  return SAFE_RUN_ID_RE.test(runId) && !runId.includes('..');
}
