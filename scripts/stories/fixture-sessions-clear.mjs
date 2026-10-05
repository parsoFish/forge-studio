/**
 * fixture-sessions-clear.mjs — a fixture story's own sessions end with the
 * story (forge-8vfn.30.8, T1 1975d).
 *
 * A session lives under `<root>/_logs/_sessions/<project>/<kind>/<id>/`,
 * outside the fixture ground, so removing `projects/story-<id>` left every
 * session the story opened behind. A later story's Studio lists sessions
 * across projects and counted them: S7's `_instructions` session, still
 * `briefing`, made S9 read one active session where it expected none.
 *
 * Only the story's OWN project dirs are touched: `story-<id>/` and its
 * knowledge scaffold `.kb-story-<id>/`. Each is captured under
 * `_logs/_story-logs-clear/<storyId>/<stamp>/_sessions/` before it is removed,
 * a failed capture leaves the directory in place, and "cleared" is a re-read,
 * never an inference — `captureAndClearMintedLogs`' shape (ground-clear.mjs).
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SESSIONS_DIRNAME } from '@forge/kernel';
import { logsClearDir } from './ground-clear.mjs';

/** The session-project dirs a fixture project owns. */
export function fixtureSessionProjects(project) {
  return [project, `.kb-${project}`];
}

/**
 * @param {string} root
 * @param {{storyId: string, project: string, runStamp: string}} args
 *   `project` is already namespace-checked by the caller (`teardownFixtureGround`).
 * @returns {{captured: string[], cleared: string[], refused: {dir: string, reason: string}[]}}
 */
export function captureAndClearFixtureSessions(root, { storyId, project, runStamp }) {
  const out = { captured: [], cleared: [], refused: [] };
  const sessionsDir = join(root, '_logs', SESSIONS_DIRNAME);
  const dest = join(logsClearDir(root, storyId, runStamp), SESSIONS_DIRNAME);
  for (const name of fixtureSessionProjects(project)) {
    const from = join(sessionsDir, name);
    if (!existsSync(from)) continue;
    try {
      mkdirSync(dest, { recursive: true });
      cpSync(from, join(dest, name), { recursive: true, preserveTimestamps: true });
    } catch (error) {
      out.refused.push({ dir: name, reason: `capture failed (${error.message}) — not removing what was not captured` });
      continue;
    }
    out.captured.push(name);
    try {
      rmSync(from, { recursive: true, force: true });
    } catch (error) {
      out.refused.push({ dir: name, reason: `removal threw: ${error.message}` });
    }
    if (!existsSync(from)) out.cleared.push(name);
  }
  return out;
}
