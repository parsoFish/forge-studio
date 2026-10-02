/**
 * ground-turn-window.mjs — attribute a ground change to a minted AGENT by the
 * agent's own LIFETIME and CWD, for the changes no tool call names.
 *
 * Row 195 (bead `forge-8vfn.8.5.33`), T1 rulings 1973gc + anchor. S3 run 6
 * went 13/13 beats green and RED on containment: `UNDECLARED A
 * PROVIDER_VERSION.txt` and `UNDECLARED A docs/.gitkeep`. The onboarding agent
 * wrote both with Bash — one call at 21:18:34.984Z (`echo … > CHANGELOG.md &&
 * echo "0.1.0" > PROVIDER_VERSION.txt && mkdir -p docs …`), again at
 * 21:18:47.535Z, and a `mkdir -p docs/… && touch …` at 21:18:49.954Z.
 * `CHANGELOG.md` attributed only because the agent ALSO wrote it with the Write
 * tool: `sessionWriteTargets` (`ground-minted.mjs`, `WRITE_TOOLS`) reads
 * tool-call PATHS, and a Bash call is never a writer there.
 *
 * WHY NOT PARSE THE BASH COMMAND. A redirect regex catches `> PROVIDER_VERSION.txt`
 * and misses `mkdir`, `touch`, `cp`, a heredoc, a script the command runs, and
 * the `input_summary` itself is TRUNCATED (`touc…` above). The process that ran
 * the command is the evidence, not its text: an agent spawned with the ground
 * as its cwd, alive while the file changed.
 *
 * THE WINDOW. `[start − FS_CLOCK_SLACK_MS, end + FS_CLOCK_SLACK_MS]` where
 *   start = the EARLIER of the session's first event `started_at` and its
 *           `turn.pid` mtime (the pid is rewritten each turn, so it can only
 *           move later than birth — the min keeps the birth);
 *   end   = the session's LAST parseable event `started_at`. A killed agent's
 *           last line (`agent-dispatch.failed`) is written AFTER its process
 *           exits, so a write the dying process made still sits inside.
 * The slack is the tree's one measured allowance for the kernel's coarse
 * mtime clock (`beats-queue-terminal.mjs`), never a new constant.
 *
 * THE CWD. A session counts only when its own `agent-run.dispatched` event
 * binds it to THIS ground (`metadata.project === basename(groundDir)`):
 * `dispatchAgentRun` spawns at `opts.workdir ?? opts.project?.repoPath ??
 * runDir` (`packages/agents/agent-dispatch.ts:335`), and no product caller
 * passes `workdir`, so a project-bound agent's cwd IS the ground. A `_bridge`
 * session (no dispatch event) or an agent bound elsewhere contributes no window.
 *
 * WHAT IT CANNOT SEE, said rather than hidden: a REMOVED path has no mtime, so
 * a Bash `rm` stays UNDECLARED unless a tool call names it. And a window is an
 * inference, not an observation — anything else writing into the ground while
 * the agent lived would fall inside it too. That is why the classifier consults
 * it LAST (`classifyOwnGroundDrift`): after tool-path attribution, the story's
 * declarations and the ground's ignore rules, only for what would otherwise be
 * UNDECLARED. OVERLAPPING WINDOWS attribute the path to EVERY agent whose
 * window covers it, and the PRODUCED line names them all — the run cannot say
 * which one ran the command, and does not pretend to. A change outside every
 * window still reads UNDECLARED and still reds the run.
 */
import { readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { FS_CLOCK_SLACK_MS } from './beats-queue-terminal.mjs';

/** The dispatch marker both product dispatch routes emit at t0 (`bridge-agents-slug.ts`, `bridge-studio-kickoff.ts`). */
const DISPATCHED_MESSAGE = 'agent-run.dispatched';

/**
 * One session's turn window over `groundDir`, or `null` when the session
 * carries no dispatch binding it to that ground, or no parseable timestamp.
 *
 * @param {string} sessionDir the session's `_logs/_<kind>-<id>` dir
 * @param {string} groundDir absolute path to the ground being judged
 * @returns {{startMs: number, endMs: number} | null} slack already applied
 */
export function sessionTurnWindow(sessionDir, groundDir) {
  let text;
  try {
    text = readFileSync(join(sessionDir, 'events.jsonl'), 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error(`[stories] own ground: ${sessionDir}/events.jsonl unreadable (${e.code}) — no turn window, so its Bash-born changes stay UNDECLARED`);
    }
    return null;
  }
  const project = basename(groundDir);
  let bound = false;
  let first = Infinity;
  let last = -Infinity;
  for (const line of text.split('\n')) {
    if (line === '') continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue; // a killed session's final line is half-written
    }
    if (ev.message === DISPATCHED_MESSAGE && ev.metadata?.project === project) bound = true;
    const at = Date.parse(ev.started_at);
    if (Number.isNaN(at)) continue;
    if (at < first) first = at;
    if (at > last) last = at;
  }
  if (!bound || first === Infinity) return null;
  try {
    first = Math.min(first, statSync(join(sessionDir, 'turn.pid')).mtimeMs);
  } catch (e) {
    // An unreadable pid is not "no pid": the birth cannot be confirmed, so no
    // window — the safe direction, the session's Bash-born changes stay UNDECLARED.
    if (e.code !== 'ENOENT') {
      console.error(`[stories] own ground: ${sessionDir}/turn.pid unreadable (${e.code}) — no turn window`);
      return null;
    }
  }
  return { startMs: first - FS_CLOCK_SLACK_MS, endMs: last + FS_CLOCK_SLACK_MS };
}

/**
 * The production `mtimeOf`: a ground-relative path's mtime, or `null` when it
 * is gone. Any failure other than ENOENT is NAMED and reads `null` — the safe
 * direction, since `null` leaves the path UNDECLARED rather than licensing it.
 *
 * @param {string} groundDir
 * @returns {(rel: string) => number | null}
 */
export function groundMtimeOf(groundDir) {
  return (rel) => {
    try {
      return statSync(join(groundDir, rel)).mtimeMs;
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.error(`[stories] own ground: ${rel}'s mtime unreadable (${e.code}) — not window-attributable, stays UNDECLARED`);
      }
      return null;
    }
  };
}

/**
 * Every minted session's window-attributed changes, keyed by the session path
 * `mintedSessionPaths` produced — the same keying as `mintedSessionWrites`.
 * Only ADDED and MODIFIED paths: a removal has no mtime to place in a window.
 *
 * @param {string[]} mintedPaths `_<kind>/<id>` session paths
 * @param {string} logsDir the `_logs` dir the sessions live in
 * @param {string} groundDir absolute path to the ground being judged
 * @param {{added: string[], modified: string[]}} changes `groundChanges` output
 * @param {(rel: string) => number | null} mtimeOf `groundMtimeOf(groundDir)` — REQUIRED; tests pass a captured map
 * @returns {Map<string, string[]>} sessions with at least one path, paths sorted
 */
export function mintedSessionWindowWrites(mintedPaths, logsDir, groundDir, changes, mtimeOf) {
  if (typeof mtimeOf !== 'function') {
    throw new Error('mintedSessionWindowWrites: mtimeOf (groundMtimeOf(groundDir)) is REQUIRED — never skippable');
  }
  const candidates = [...changes.added, ...changes.modified]
    .map((path) => ({ path, mtimeMs: mtimeOf(path) }))
    .filter((c) => c.mtimeMs !== null);
  const out = new Map();
  for (const p of mintedPaths) {
    const at = p.indexOf('/');
    if (at === -1) continue;
    const window = sessionTurnWindow(join(logsDir, `_${p.slice(1, at)}-${p.slice(at + 1)}`), groundDir);
    if (window === null) continue;
    const inside = candidates
      .filter((c) => c.mtimeMs >= window.startMs && c.mtimeMs <= window.endMs)
      .map((c) => c.path)
      .sort();
    if (inside.length > 0) out.set(p, inside);
  }
  return out;
}
