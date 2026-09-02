/**
 * Legacy-shape session readability primitives (W8-F6, bead forge-6gv.27).
 *
 * A forge session has, historically, had TWO on-disk homes:
 *
 *   1. the session's own working dir, `projects/<project>/_<kind>/<sessionId>/`,
 *      holding `status.json` (the phase) plus whatever files the kind's
 *      artifact/transcript renderers read; and
 *   2. the runner's log dir, `_logs/_<kind>-<sessionId>/`, holding
 *      `events.jsonl`, `stderr.log`, and (while alive) `.heartbeat` / `turn.pid`.
 *
 * (2) is written centrally and is never pruned; (1) lives inside a managed
 * project tree that is gitignored and routinely deleted and recreated. The
 * measured consequence on the reference host: 236 of 249 central `_logs/_*`
 * session dirs — and 32 of 32 `_logs/_architect-*` — have no `status.json`
 * anywhere. Wave 8 started LINKING to those sessions (the flow-run page's
 * "architect session →" breadcrumb, minted from the run manifest's
 * `architect_session_id`), so the walkthrough crawl began reporting them as
 * first-party 404s: linked AND invisible.
 *
 * This module holds the primitives for reading (2) SAFELY, so the session read
 * route can serve such a session read-only instead of 404ing it. The composite
 * predicate that decides between (1) and (2) — `resolveReadableSession` — lives
 * in `packages/sessions/bridge-studio-sessions.ts`, next to the project/session-id validation
 * rules it must reuse (`invalidProjectReason`, `findSessionProject`).
 *
 * WHY THIS MODULE IS AN IMPORT LEAF. `cli/bridge-studio.ts` imports no
 * `bridge-studio-*` sibling today, and `packages/sessions/bridge-studio-lifecycle.ts` /
 * `packages/sessions/bridge-studio-sessions.ts` both import FROM it. `invalidProjectReason`
 * transitively needs `SAFE_ID_RE` (cli/bridge-studio.ts) and
 * `KB_SEEDING_ANCHOR_PREFIX` (packages/knowledge/bridge-studio-kbs.ts), so pulling it in here
 * would create the first cycle in that graph. Everything in this file therefore
 * imports only `node:*`, `./studio-path-guard.ts`, and `../orchestrator/**`.
 *
 * CONTAINMENT. `kind` is always a live-registry descriptor id and `sessionId`
 * is SAFE_ID_RE-validated by the route before it ever reaches here, but nothing
 * in this module trusts either: every filesystem touch goes through
 * `resolveGuardedPath` (packages/kernel/path-guard.ts) with the log-dir name and the
 * `events.jsonl` leaf as their OWN segments under the fixed, config-derived
 * `logsRoot` — never folded into the root (the root-folding shape that made an
 * earlier guard tautological, R6-06 round 6). That gives, in one choke point:
 * a symlinked log DIRECTORY, a symlinked `events.jsonl` LEAF and a HARDLINKED
 * `events.jsonl` leaf (`nlink === 1`, studio-path-guard.ts:411) all rejected.
 * A guard rejection and a genuinely absent file collapse to the SAME outcome,
 * so no caller can use this module as an existence oracle outside `logsRoot`.
 */

import { readFileSync } from 'node:fs';

import { resolveGuardedPath } from '@forge/kernel';

/** `_logs/_<kind>-<sessionId>` — the SAME directory template `spawnAgentTurn`
 *  (cli/ui-bridge.ts) writes stderr.log/turn.pid into and `runInteractiveTurn`
 *  (packages/sessions/interactive-runner.ts) writes events.jsonl/.heartbeat into
 *  (`SPAWN_AGENT_SPECS[..].logPrefix === descriptor.id`, pinned by
 *  packages/sessions/session-tail-kind-parity.test.ts). ONE directory-entry name: the hyphen
 *  is a literal character in the name, never a path separator, so the whole
 *  string is a single `resolveGuardedPath` segment.
 *
 *  Re-exported by packages/sessions/bridge-studio-lifecycle.ts, which is where it used to
 *  live — moved here so this leaf module can use it without importing the
 *  lifecycle module (which imports cli/bridge-studio.ts). */
export function sessionLogDirName(kind: string, sessionId: string): string {
  return `_${kind}-${sessionId}`;
}

/**
 * Guarded parse of `<root>/<entryName>/events.jsonl`.
 *
 * MOVED VERBATIM from `cli/ui-bridge.ts`'s private `parseGuardedEventsJsonl`
 * (R6-06 round 6, adversarial-containment-review) so this module and that one
 * share ONE implementation rather than growing a second copy — ui-bridge.ts now
 * imports it from here. `entryName` is a SINGLE directory-entry name (never a
 * multi-segment path), so `resolveGuardedPath`'s per-segment identity walk plus
 * its `nlink === 1` leaf check close the symlinked-entry-dir, symlinked-leaf and
 * hardlinked-leaf shapes in one place. `root` MUST be a fixed, config-derived
 * constant (logsRoot) per `resolveGuardedPath`'s own contract — NEVER fold
 * `entryName` into `root` before calling this.
 *
 * `null` covers BOTH "the file doesn't exist" (a legitimate no-events-yet run)
 * AND "the guard rejected this entry" (a poisoned symlink/hardlink) — collapsed
 * into the exact same outcome so a poisoned entry is never distinguishable from
 * an absent one (the no-oracle rule). A malformed individual JSONL line is
 * skipped, not fatal.
 */
export function parseGuardedEventsJsonl(root: string, entryName: string): Record<string, unknown>[] | null {
  const guarded = resolveGuardedPath(root, [entryName, 'events.jsonl']);
  if (!guarded.ok || !guarded.exists) return null;
  let raw: string;
  try {
    // guard-terminal: `guarded.realPath` IS the guard's own output.
    raw = readFileSync(guarded.realPath, 'utf8');
  } catch {
    return null;
  }
  return raw
    .trim().split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } })
    .filter((e): e is Record<string, unknown> => e !== null);
}

/** The one `metadata` accessor these two derivations share: the event's own
 *  `metadata` object, or `null` for anything that is not a plain object. */
function eventMetadata(event: Record<string, unknown>): Record<string, unknown> | null {
  const meta = event['metadata'];
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return null;
  return meta as Record<string, unknown>;
}

/**
 * PURE. The LAST `metadata.phase` string the log recorded — the honest answer to
 * "what phase was this session in the last time anything wrote about it".
 *
 * Deliberately NOT a mapping from terminal event shapes onto each kind's phase
 * vocabulary: that would be a second, hand-kept copy of every kind's phase table
 * living outside `studio/session-kinds.yaml`, i.e. exactly the drift ADR-043's
 * "derived, not authored" rule exists to prevent. What the log literally says is
 * what the operator gets.
 *
 * `''` — never a fabricated phase — when the log records none. The route pairs
 * this with `legacy: true` and a structural `terminal: true`, so an in-flight-
 * looking phase name on a long-dead session can never render as "running".
 */
export function deriveLegacySessionPhase(events: readonly Record<string, unknown>[]): string {
  let last = '';
  for (const event of events) {
    const meta = eventMetadata(event);
    if (meta === null) continue;
    const phase = meta['phase'];
    if (typeof phase === 'string') last = phase;
  }
  return last;
}

/**
 * PURE. The FIRST `metadata.project` string the log recorded, RAW and
 * UNVALIDATED — `''` when the log records none.
 *
 * Validation deliberately does NOT happen here: `invalidProjectReason`
 * (packages/sessions/bridge-studio-sessions.ts) is the ONE rule for what a project id may be,
 * including the `.kb-<id>` / `.community-registry` dot-anchor carve-outs, and a
 * second copy of it in this leaf module would drift. The caller
 * (`resolveReadableSession`) runs the raw candidate through that one rule and
 * substitutes `''` when it refuses — so a traversal-shaped or otherwise odd
 * value recorded in a log can never reach the wire or a filesystem call.
 *
 * FIRST rather than last: the anchor project of a session cannot change
 * mid-session, and the earliest event that names one is the closest to the
 * session's own kickoff.
 */
export function deriveLegacySessionProject(events: readonly Record<string, unknown>[]): string {
  for (const event of events) {
    const meta = eventMetadata(event);
    if (meta === null) continue;
    const project = meta['project'];
    if (typeof project === 'string' && project.length > 0) return project;
  }
  return '';
}

export type LegacySessionResolution =
  | {
      ok: true;
      /** The guard's own realPath for `<logsRoot>/_<kind>-<sessionId>`. */
      logDir: string;
      /** `deriveLegacySessionPhase` over this session's own log. */
      phase: string;
      /** `deriveLegacySessionProject` over this session's own log — RAW; the
       *  caller must run it through `invalidProjectReason` before use. */
      projectFromLog: string;
    }
  | { ok: false };

/**
 * Does this session survive as a legacy-shape log dir, and if so what does its
 * log say about it?
 *
 * `{ok:true}` requires BOTH the guarded log dir AND a guard-readable
 * `events.jsonl` inside it. A log dir holding only `stderr.log` (or only
 * `turn.pid`) is NOT a readable session: nothing there records what the session
 * was or did, so serving it would be a 200 over an empty page. An events.jsonl
 * that exists but is EMPTY, on the other hand, IS readable — the runner started
 * and recorded nothing, which is a fact worth showing, and it yields
 * `phase: ''` honestly rather than a guess.
 *
 * Every rejection — guard refusal, missing dir, missing/poisoned events.jsonl —
 * returns the same bare `{ok:false}`: no reason string escapes this module, so
 * a caller cannot use it to fingerprint the guard (`PathGuardReject.reason`'s
 * own rule).
 */
export function resolveLegacySession(args: {
  logsRoot: string;
  kind: string;
  sessionId: string;
}): LegacySessionResolution {
  const entryName = sessionLogDirName(args.kind, args.sessionId);
  const guarded = resolveGuardedPath(args.logsRoot, [entryName]);
  if (!guarded.ok || !guarded.exists) return { ok: false };
  const events = parseGuardedEventsJsonl(args.logsRoot, entryName);
  if (events === null) return { ok: false };
  return {
    ok: true,
    logDir: guarded.realPath,
    phase: deriveLegacySessionPhase(events),
    projectFromLog: deriveLegacySessionProject(events),
  };
}
