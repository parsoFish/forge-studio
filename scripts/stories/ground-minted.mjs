/**
 * ground-minted.mjs — which `_logs`/ground entries THIS RUN minted, and what
 * each one's own session wrote.
 *
 * Split out of `ground-hash.mjs` at the 800-line cap (SPLIT, NEVER BASELINE —
 * T1 ruling 492): that file keeps the raw ground-manifest hash primitives and
 * the drift classifier; this half answers the separate question those lean
 * on — "what did this run demonstrably create or write", derived from the
 * run's own evidence rather than a hand-written list. `run-story.mjs` and the
 * `ground-*.test.ts` files that already imported these from `ground-hash.mjs`
 * keep doing so unchanged — it re-exports every name below.
 */
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { MINTED_ID_CHARS } from './ground-clear.mjs';

/** `groundManifest`'s explicit UNKNOWN (`ground-hash.mjs`) — defined here
 *  rather than there so this file has no dependency on it, only the reverse.
 *  Only ENOENT may read as the manifest being genuinely absent (`null`); any
 *  other failure is this, and `groundMintedSessionPaths` below must not walk
 *  a `.files` map neither carries. */
export const GROUND_MANIFEST_UNKNOWN = Symbol('ground-manifest-unknown');

/**
 * The `_logs` entries this run created, as the `<kind>/<id>` pairs their names
 * encode. `_logs/_architect-2026-09-10T13-54-57-9eaf7fae` is the same session as
 * the ground's `_architect/2026-09-10T13-54-57-9eaf7fae`, so the run's own
 * product in the ground is DERIVED from what the run demonstrably minted rather
 * than from a hand-written list of directory names.
 *
 * That distinction is the whole design. A list of allowed paths is a thing that
 * goes stale silently; a set derived from the run's own evidence cannot.
 *
 * The NAME SHAPE IS NOT ENOUGH, and this file's own test caught it: the runner's
 * `_logs/_story-red-evidence` parses as kind `story`, id `red-evidence`, and
 * would have licensed a `_story/red-evidence` path in the ground that no session
 * ever writes. A licence handed out by accident is the same defect as a list
 * gone stale, so the dir must also CARRY a session's evidence — one of the
 * channels `bridge-studio-lifecycle.ts` measures, or the turn's pid.
 *
 * @param {string[]} before entry names in `_logs` before the run
 * @param {string[]} after entry names after it
 * @param {string} logsDir the `_logs` dir itself, to confirm each candidate is a session
 */
function mintedSessions(before, after, logsDir) {
  const was = new Set(before);
  const out = [];
  for (const name of after) {
    if (was.has(name)) continue;
    // `_<kind>-<id>` — the kind cannot contain `-`, the id may.
    const m = /^_([A-Za-z][A-Za-z0-9]*)-(.+)$/.exec(name);
    if (m === null) continue;
    // ROW 102b/9 — ENOENT is an ordinary, expected miss; any OTHER failure
    // means this could not be CONFIRMED absent. The exclusion is unchanged
    // either way (never grant the produced-licence on unverifiable evidence,
    // review finding 1 below) — but it is NAMED, not silently dropped.
    let unverifiable = false;
    const isSession = ['events.jsonl', '.heartbeat', 'turn.pid'].some((f) => {
      try {
        return statSync(join(logsDir, name, f)).isFile();
      } catch (e) {
        if (e.code !== 'ENOENT') unverifiable = true;
        return false;
      }
    });
    if (isSession) out.push({ name, kind: m[1], id: m[2] });
    else if (unverifiable) {
      console.error(
        `[stories] own ground: ${name}'s session markers could not be confirmed (a non-ENOENT read failure) — ` +
        'treated as NOT a minted session, so any ground writes attributed to it read UNDECLARED rather than produced',
      );
    }
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function mintedSessionPaths(before, after, logsDir) {
  return mintedSessions(before, after, logsDir).map((e) => `_${e.kind}/${e.id}`);
}

/**
 * The same sessions as `mintedSessionPaths`, in the form they exist on disk:
 * `_<kind>-<id>` directory names under `_logs/` — `forge-8vfn.7.6.137`.
 *
 * ONE PREDICATE, TWO SHAPES, deliberately. The ground half matches on
 * `_<kind>/<id>` (how a minted session appears as a path inside the ground) and
 * the `_logs` half needs the directory name. Deriving the second by rebuilding
 * `_${kind}-${id}` from the first would be a SECOND source of truth for "what
 * did this run mint", and the two could drift apart while both looked right.
 * They share `mintedSessions` instead, so a change to the session predicate
 * cannot move one without the other.
 */
export function mintedSessionDirNames(before, after, logsDir) {
  return mintedSessions(before, after, logsDir).map((e) => e.name);
}

/**
 * THE SECOND MINTED PATH — T1 1418, S7's own fixture proof (2026-09-25).
 *
 * `mintedSessionPaths` above reads `_logs/`, but `POST /api/instructions/
 * start` (`bridge-studio-instructions.ts:163-238`) deliberately writes ONLY
 * the ground's own `_instructions/<id>/status.json` — the agent, and its
 * `_logs/_<kind>-<id>` dir, spawn later, at `/brief`. For that window this
 * run's own session has no `_logs` evidence at all, so `mintedSessionPaths`
 * contributes nothing and the write reads as UNDECLARED — a containment
 * failure for a session this run demonstrably started.
 *
 * A `_<kind>/<id>` dir born directly under the GROUND ROOT, between the same
 * before/after manifests `run-story.mjs` already reads for the hash fence, is
 * the same evidence read from the other side — no second filesystem walk.
 *
 * REVIEW FINDING 1: A BARE SHAPE MATCH IS NOT A LICENCE. The first cut
 * licensed ANY new top-level `_<kind>/<id>` prefix — no check that `<kind>`
 * was a kind the product declares — and `captureAndClearMintedSessions`
 * DELETES whatever this licenses: a new `_snapshots/2026-09-26/report.md`
 * with no `_logs` correlate read as PRODUCED and was cleared, for matching a regex.
 *
 * So a prefix counts as minted only when BOTH hold: (a) `kind` is in
 * `registeredKindIds`, read from the product's own registry
 * (`session-kind-registry.mjs`, never a hand-copied list) the way
 * `bridge-studio-session-index.ts` iterates it (`_${descriptor.id}`); (b) the
 * AFTER manifest holds `_<kind>/<id>/status.json` — every session kind
 * writes that the instant it starts (`packages/sessions/interactive-
 * session.ts`), so a dir with no status.json is not a session, however its
 * name is shaped. `registeredKindIds` is REQUIRED — `groundIgnoreFromGit`'s
 * own "an argument you cannot skip silently" rule (7.6.38). The id capture
 * also reuses `MINTED_ID_CHARS` (`ground-clear.mjs`) — the SAME charset the
 * clear's own guard requires before removing anything — not the looser
 * `[^/]+` the first cut used.
 *
 * NEWLY MINTED still means the whole `<kind>/<id>` PREFIX is absent from
 * `before`, not merely that some file under it is new — a dir that already
 * existed and grew a sibling file is judged by the EXISTING rules instead.
 *
 * @param {{files: Map<string,string>}|null|typeof GROUND_MANIFEST_UNKNOWN} before ground manifest before the run
 * @param {{files: Map<string,string>}|null|typeof GROUND_MANIFEST_UNKNOWN} after ground manifest after the run
 * @param {Set<string>} registeredKindIds product session-kind ids (`loadRegisteredSessionKindIds`) — REQUIRED
 * @returns {string[]} `_<kind>/<id>` paths, sorted
 */
const GROUND_MINTED_PREFIX_SHAPE = new RegExp(`^_([A-Za-z][A-Za-z0-9]*)/(${MINTED_ID_CHARS.source.slice(1, -1)})(?:/|$)`);

export function groundMintedSessionPaths(before, after, registeredKindIds) {
  // ROW 102b/8 — UNKNOWN joins null: neither carries a `.files` map to walk;
  // `groundChanges` (`ground-hash.mjs`, called separately) is what reds the
  // run on it.
  if (before === null || before === GROUND_MANIFEST_UNKNOWN || after === null || after === GROUND_MANIFEST_UNKNOWN) return [];
  if (!(registeredKindIds instanceof Set)) {
    throw new Error('groundMintedSessionPaths: registeredKindIds (a Set from loadRegisteredSessionKindIds) is REQUIRED — never skippable');
  }
  const prefixOf = (p) => {
    const m = GROUND_MINTED_PREFIX_SHAPE.exec(p);
    return m === null ? null : { prefix: `_${m[1]}/${m[2]}`, kind: m[1] };
  };
  const beforePrefixes = new Set();
  for (const p of before.files.keys()) {
    const hit = prefixOf(p);
    if (hit !== null) beforePrefixes.add(hit.prefix);
  }
  const out = new Set();
  for (const p of after.files.keys()) {
    const hit = prefixOf(p);
    if (hit === null || beforePrefixes.has(hit.prefix)) continue;
    if (!registeredKindIds.has(hit.kind)) continue; // finding 1(a) — unregistered kind, never a licence
    if (!after.files.has(`${hit.prefix}/status.json`)) continue; // finding 1(b) — no session status file
    out.add(hit.prefix);
  }
  return [...out].sort();
}

/**
 * The tools whose `tool_use` event names a file the session WROTE.
 *
 * A BELT TO `file_change`'S BRACES, never the primary read. `makeToolEventSink`
 * (`packages/agents/tool-event-emit.ts`) emits the `file_change` FIRST and
 * unconditionally — "file mutations are always durable, independent of the
 * tool_use sampling decision" — and only then consults the sampler for the
 * `tool_use` line. So the `tool_use` stream is the LOSSY one, and a rule that
 * read only `Write`/`Edit` tool uses would be reading the sampled copy of a
 * record the product already guarantees in full.
 *
 * That is not a theoretical ordering: S1 run 5 priced it. The onboarding agent
 * put `.forge/skills/demo-design/SKILL.md` into the ground through a Bash
 * command; the run's log carries the `file.add` with no paired `tool_use` line
 * anywhere near it, and the only Bash tool use naming that path is a `cat` of
 * the SOURCE file. Attribute from `Write`/`Edit` alone and that path reads as
 * undeclared — a red run for a file the run demonstrably produced.
 */
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/**
 * What ONE session's own event log says IT wrote, as ground-relative paths.
 *
 * T1 ruling 663. The containment check knew which session dirs the run minted;
 * it did not know what those sessions did OUTSIDE their own dirs, so every
 * write an agent made into the ground proper — the `CLAUDE.md` it edited, the
 * `CONSTRAINTS.md` it authored — read as undeclared. The session's own
 * `events.jsonl` already names them.
 *
 * READS ARE NOT WRITES, and the fixture for this makes the point with real
 * bytes: S1 run 5's architect `Read` both (project:) `roadmap.md` and `brain/profile.md`,
 * and a rule that matched on the path appearing in the log at all would have
 * licensed two files that session never touched. Only `file_change` and a
 * WRITE tool's `output_refs` count; `input_summary` is deliberately not read.
 *
 * A missing or truncated log is a normal end state, not an error: a killed
 * session's last line is half-written, and a session that never started one
 * (S1 run 5's `_onboarding/…4857c9a9` holds only a `turn.pid`) has no log at
 * all. Both mean "this session accounts for nothing", which is the safe answer
 * — it leaves the path UNDECLARED rather than licensing it.
 *
 * @param {string} eventsPath the session's `events.jsonl`
 * @param {string} groundDir absolute path to the ground being judged
 * @returns {string[]} ground-relative paths, sorted and deduped
 */
export function sessionWriteTargets(eventsPath, groundDir) {
  let text;
  try {
    text = readFileSync(eventsPath, 'utf8');
  } catch {
    return [];
  }
  const out = new Set();
  for (const line of text.split('\n')) {
    if (line === '') continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue; // a killed session's final line is half-written
    }
    const wrote =
      ev.event_type === 'file_change' ||
      (ev.event_type === 'tool_use' && WRITE_TOOLS.has(ev.metadata?.tool));
    if (!wrote) continue;
    for (const ref of Array.isArray(ev.output_refs) ? ev.output_refs : []) {
      // ABSOLUTE ONLY. `relative()` resolves a bare name against `process.cwd()`,
      // so a relative ref would silently land somewhere plausible and wrong —
      // the same class of defect as #607's `./` prefix, which cost a $3.2562 run.
      if (typeof ref !== 'string' || !isAbsolute(ref)) continue;
      const rel = relative(groundDir, ref);
      if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) continue;
      out.add(rel);
    }
  }
  return [...out].sort();
}

/**
 * Every minted session's own write targets, keyed by the session path
 * `mintedSessionPaths` produced.
 *
 * The session path is `_<kind>/<id>`; the `_logs` entry it came from is
 * `_<kind>-<id>`. Mapping back rather than carrying both keeps
 * `mintedSessionPaths` the single place that decides what counts as a session.
 *
 * @param {string[]} mintedPaths from `mintedSessionPaths`
 * @param {string} logsDir the `_logs` dir the sessions live in
 * @param {string} groundDir absolute path to the ground being judged
 * @returns {Map<string, string[]>}
 */
export function mintedSessionWrites(mintedPaths, logsDir, groundDir) {
  const out = new Map();
  for (const p of mintedPaths) {
    const at = p.indexOf('/');
    if (at === -1) continue;
    const dir = `_${p.slice(1, at)}-${p.slice(at + 1)}`;
    out.set(p, sessionWriteTargets(join(logsDir, dir, 'events.jsonl'), groundDir));
  }
  return out;
}
