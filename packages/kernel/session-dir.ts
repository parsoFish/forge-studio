/**
 * Where an interactive session's directory lives (forge-8vfn.8.5.58).
 *
 * A session dir is forge's own scratch (status.json, questions, plans, drafts).
 * It lives under forge's logs root, NEVER inside the managed project's checkout
 * (the "ground"): writing it there moved the ground's content hash and left
 * scratch in someone else's repo. The agent's working directory stays the
 * ground; only the session dir moves.
 *
 *   <logsRoot>/_sessions/<project>/<kindDir>/<sessionId>/
 *   <logsRoot>/_sessions/<project>/<kindDir>/_archived/<sessionId>/   (archived)
 *
 * These helpers are the ONE seam: every production site that names a session
 * dir builds its segments here and resolves them against the trusted
 * `logsRoot` with `resolveGuardedPath` / the guarded fs primitives. The
 * segments are validated per-segment by that guard (project, kindDir and
 * sessionId each ride as their OWN element, never folded into the root).
 */

import { resolveGuardedPath, type PathGuardResult } from './path-guard.ts';

/** The directory under `logsRoot` that holds every session of every project. */
export const SESSIONS_DIRNAME = '_sessions';

/** The architect session kind's on-disk kind dir. Lives here (not in `sessions`)
 *  because `agents` (lower-ranked) must also find an architect session. */
export const ARCHITECT_KIND_DIR = '_architect';

/** Where a session's files are homed: the trusted logs root plus the project
 *  whose sessions they are. Pair it with a kind dir and a session id to get
 *  the segments below. */
export type SessionHome = { readonly logsRoot: string; readonly project: string };

/** `['_sessions', project, kindDir, sessionId]` — a fresh array each call. */
export function sessionDirSegments(project: string, kindDir: string, sessionId: string): string[] {
  return [SESSIONS_DIRNAME, project, kindDir, sessionId];
}

/** `['_sessions', project, kindDir]` — the parent of every session of one kind. */
export function sessionKindSegments(project: string, kindDir: string): string[] {
  return [SESSIONS_DIRNAME, project, kindDir];
}

/** Contain a session dir under `logsRoot` (realpath identity per segment). */
export function resolveSessionDir(logsRoot: string, project: string, kindDir: string, sessionId: string): PathGuardResult {
  return resolveGuardedPath(logsRoot, sessionDirSegments(project, kindDir, sessionId));
}
