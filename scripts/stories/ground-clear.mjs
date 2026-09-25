/**
 * Capture-then-clear the sessions a run minted inside its OWN ground —
 * `forge-8vfn.7.6.123`, C's ruling 1100 and T1 1103/1106.
 *
 * WHAT WAS ACTUALLY WRONG. Nothing here is a new measurement. `groundManifest`
 * already walks the FILESYSTEM (`find . -type f`, pruning only `node_modules`
 * and `.git`), so it already sees gitignored content — it is the only
 * instrument in the run that does. `classifyOwnGroundDrift` already separates
 * the minted-session writes from everything else, each line naming the session
 * that accounts for it. `run-story.mjs` already prints them:
 *
 *     own ground: PRODUCED A _architect/<ts>/PLAN.md — inside _architect/<ts>,
 *                 a session this run minted
 *
 * And then nothing consumed it and nothing cleared. So
 * `projects/gitpulse/_architect/<ts>/` survived `git status --porcelain` (0
 * entries — gitignored inside the ground), `residue.sh` (clean), and the ground
 * fence (clean), and the NEXT run's launcher refused on the ground hash. The
 * pin was the only thing standing between run N's plan and run N+1's ground,
 * and it happened five times.
 *
 * S10 run 18 is the same-run A/B that pins the cause precisely: that run leaked
 * TWO things and `residue.sh` caught exactly one. `_worktrees/INIT-…` (102
 * files) was caught, because `_worktrees` is a NAMED LOCATION counted with
 * `ls`. The ground's `_architect/<ts>/` (6 files) was missed, because the ground
 * is walked through git and the output is gitignored. Same instrument, same run,
 * opposite outcomes, and the only difference is whether git can see the path.
 *
 * WHY THE SET IS DERIVED AND NEVER A PATTERN. `projects/gitpulse` carries
 * exactly one `_*` directory — `_project-brain` — and it is part of the pinned
 * ground. A clear that matched `_*` would eat it. So the set comes from
 * `mintedSessionPaths`, i.e. this run's own `_logs` entries, which is the
 * reasoning `ground-hash.mjs` already states for the classifier: a list of
 * allowed paths goes stale silently, a set derived from the run's own evidence
 * cannot.
 *
 * CAPTURE BEFORE CLEAR, AND NEVER CLEAR WHAT WAS NOT CAPTURED. §15.241 in its
 * general form — the bytes are the only record of what a costed run produced,
 * and the plan an architect wrote is the most interesting thing a run makes. A
 * capture that failed leaves the directory in place, because losing the evidence
 * is worse than leaving residue a named check will now report.
 */
import { cpSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { resolveGuardedPath } from '@forge/kernel';

/**
 * One row of `classifyOwnGroundDrift`'s structured output. `writers` is the
 * sessions whose own event logs claim the path; `home` is the minted session
 * directory it sits inside, or `null`. Both are needed here: only `home`
 * licenses a removal, and `writers` is what distinguishes the run's product
 * inside the ground from the run's own session output.
 *
 * @typedef {{kind: string, path: string, home: string|null, writers: string[]}} ProducedPath
 * @typedef {{dest: string|null, captured: string[], cleared: string[],
 *            refused: {dir: string, reason: string}[], unremoved: string[],
 *            absent: string[]}} GroundClearResult
 */

/**
 * Where a run's cleared sessions are read to — under `_logs/`, never under the
 * ground, and under THIS RUN's own stamp.
 *
 * The stamp is required rather than defaulted, for the reason `redEvidenceDir`
 * gives (ruling 368): without it every run of a story writes into one directory
 * and run 9's captured session sits beside run 10's, distinguishable only by
 * reading a session id out of the JSON. Evidence that quietly mixes two runs is
 * worse than no evidence, because it reads as one run.
 *
 * `_story-ground-clear` parses as kind `story`, id `ground-clear`, so
 * `mintedSessionPaths` would see it as a candidate — and rejects it, because it
 * carries no `events.jsonl`, `.heartbeat` or `turn.pid`. That door already
 * exists and is why this name is safe to use.
 */
export function groundClearDir(root, storyId, runStamp) {
  return join(root, '_logs', '_story-ground-clear', storyId, runStamp);
}

/**
 * The directories to clear, from the classifier's STRUCTURED output.
 *
 * Three narrowings, each of which is a way to corrupt a ground if it is missed:
 *
 *   `added` only      a MODIFIED path inside a minted dir means the run changed
 *                     something that was already there, and a REMOVED one is
 *                     already gone. Neither licenses removing a directory.
 *   `home` only       an entry attributed by a session's `writers` but with no
 *                     minted `home` is that session writing into the ground
 *                     PROPER — the `CLAUDE.md` it edited, the `CONSTRAINTS.md`
 *                     it authored. That is the run's real product and deleting
 *                     it would destroy the thing the run was for.
 *   distinct          two files in one session dir are ONE directory to remove.
 *
 * @param {ReadonlyArray<ProducedPath>} producedPaths
 * @returns {string[]} ground-relative directories, sorted and deduped
 */
export function mintedSessionDirsToClear(producedPaths) {
  const dirs = new Set();
  for (const entry of producedPaths) {
    if (entry.kind !== 'added') continue;
    if (entry.home === null || entry.home === undefined) continue;
    dirs.add(entry.home);
  }
  return [...dirs].sort();
}

/**
 * A minted session directory is `_<kind>/<id>`: the kind cannot contain `-` or
 * `/` (`mintedSessionPaths`' own regex), and the id is a session stamp such as
 * `2026-09-18T03-45-41-0b536f73`.
 *
 * THE CAP AND THE ALLOWLIST ARE NOT DECORATION. `mintedSessionPaths` derives the
 * id from `/^_([A-Za-z][A-Za-z0-9]*)-(.+)$/` against DIRECTORY NAMES READ OFF
 * DISK in `_logs/`, and `.+` is unbounded in both length and charset — it admits
 * `/` and `..`. Those names are written by the product, but an agent with a
 * shell inside the run can create one, so the value that reaches a recursive
 * delete is attacker-influenced in principle. `forge-8vfn.7.6.55a` found four
 * destructive `rmSync` calls that had skipped exactly this, one of them for a
 * missing length cap; this is the same sink class and gets the same guard shape
 * as `assertSafeSessionId` (`scripts/lib/journey-assertions.mjs`): allowlist,
 * length cap, and an explicit refusal of stringified nullish.
 */
const MAX_MINTED_DIR_CHARS = 128;
const MINTED_DIR_SHAPE = /^_[A-Za-z][A-Za-z0-9]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** `${undefined}` and friends resolve to a real, plausible directory name. */
const NULLISH_SEGMENTS = new Set(['null', 'undefined', 'NaN', 'false', '[object Object]']);

/**
 * May we remove this directory, and where does it actually live?
 *
 * Returns `{path}` for a target that exists and is safe, `{absent: true}` when
 * there is nothing there, or `{reason}` to refuse.
 *
 * CONTAINMENT IS `resolveGuardedPath`, NOT A PREFIX TEST. The first version of
 * this function did `resolve(groundDir, dir).startsWith(groundDir + sep)`, and
 * that is a LEXICAL claim about a path string standing in for a PHYSICAL claim
 * about a filesystem: `resolve` never touches the disk, so a symlinked
 * `projects/<ground>/_architect` pointing anywhere at all passes it, and the
 * `rmSync` below would then have run outside the ground with the guard
 * reporting success. `packages/kernel/path-guard.ts` exists for this and says so
 * in its own header — "never a lexical prefix check on the unresolved,
 * `join()`-constructed string" — realpathing the root, then asserting
 * per-segment IDENTITY against the expected location, and closing the hardlink
 * case realpath is blind to. Shipping the prefix test would have made this the
 * fifth `7.6.55a` bypass.
 *
 * The destructive calls use the path the GUARD returned, never a path this
 * function resolved itself — one notion of where the target is, not two.
 */
function checkTarget(dir, groundDir) {
  if (typeof dir !== 'string' || dir.length === 0) {
    return { reason: `is not a non-empty string (${typeof dir})` };
  }
  if (dir.length > MAX_MINTED_DIR_CHARS) {
    return { reason: `is ${dir.length} characters, over the ${MAX_MINTED_DIR_CHARS}-character cap` };
  }
  const segments = dir.split('/');
  const nullish = segments.find((seg) => NULLISH_SEGMENTS.has(seg));
  if (nullish !== undefined) {
    return { reason: `carries the stringified-nullish segment "${nullish}" — a real directory name, never a session` };
  }
  // `.forge/` is the ground's own forge configuration and part of what the pin
  // measures; the acceptance criterion names `.forge/skills` by name, so the
  // refusal is named too rather than arriving as "wrong shape".
  if (dir === '.forge' || dir.startsWith('.forge/')) {
    return { reason: `names ${dir}, and .forge/ is part of the pinned ground, never a session this run minted` };
  }
  if (!MINTED_DIR_SHAPE.test(dir)) {
    return { reason: `${dir} is not shaped _<kind>/<id>, so nothing in this run minted it` };
  }
  const guard = resolveGuardedPath(groundDir, segments);
  if (!guard.ok) {
    return { reason: `${dir} is outside the ground ${groundDir} (path guard: ${guard.reason})` };
  }
  if (!guard.exists) return { absent: true };
  return { path: guard.realPath };
}

/**
 * Capture every minted session out of the ground, then remove it.
 *
 * Returns what happened at each step rather than a verdict, because the caller
 * has to REPORT both halves — a clear that says only "done" cannot be checked
 * against the ground hash afterwards.
 *
 *   dest       the capture directory, or `null` when there was nothing to do.
 *              Never an empty directory: one of those reads as a capture that
 *              failed, and it would itself be residue created by the residue
 *              check.
 *   captured   dirs whose bytes are now under `dest`
 *   cleared    dirs verifiably GONE from the ground afterwards
 *   refused    dirs we declined to touch, each with its reason
 *   unremoved  dirs we captured and tried to remove that are STILL THERE. This
 *              is the one the caller must go red on: it means the removal did
 *              not take, and `rmSync` with `force` does not throw on much.
 *   absent     dirs already gone before we got to them — benign, but reported,
 *              because "nothing to remove" and "removed it" are different
 *              findings and a reader must not have to guess which happened.
 *
 * @param {{root: string, project: string, storyId: string, runStamp: string,
 *          producedPaths: ReadonlyArray<ProducedPath>}} input
 */
export function captureAndClearMintedSessions({ root, project, storyId, runStamp, producedPaths }) {
  /** @type {GroundClearResult} */
  const out = { dest: null, captured: [], cleared: [], refused: [], unremoved: [], absent: [] };
  const dirs = mintedSessionDirsToClear(producedPaths);
  if (dirs.length === 0) return out;

  const groundDir = resolve(join(root, 'projects', project));
  const dest = groundClearDir(root, storyId, runStamp);

  for (const dir of dirs) {
    const checked = checkTarget(dir, groundDir);
    if (checked.reason !== undefined) {
      out.refused.push({ dir, reason: checked.reason });
      continue;
    }
    if (checked.absent === true) {
      out.absent.push(dir);
      continue;
    }
    const from = checked.path;
    // CAPTURE FIRST, and a capture that throws leaves the directory alone.
    try {
      mkdirSync(dest, { recursive: true });
      cpSync(from, join(dest, dir), { recursive: true, preserveTimestamps: true });
    } catch (error) {
      out.refused.push({ dir, reason: `capture failed (${error.message}) — not removing what was not captured` });
      continue;
    }
    out.dest = dest;
    out.captured.push(dir);

    // `force: true` ignores a MISSING path and nothing else — an unwritable
    // parent directory still throws EACCES. Uncaught, that would abort the run
    // AFTER the capture succeeded, losing the whole end-of-run report to a
    // permissions problem in a directory nobody was going to read again. So the
    // throw is caught and becomes a finding.
    let failure = null;
    try {
      rmSync(from, { recursive: true, force: true });
    } catch (error) {
      failure = error.message;
    }
    // RE-READ RATHER THAN TRUST THE CALL, in both directions: a throw does not
    // prove the directory is still there (a partial removal may have finished
    // the job) and the absence of one does not prove it is gone. The runner has
    // already been bitten by a removal that did not stick — `fence.reappeared`
    // exists for exactly that — so "cleared" is a second look, never an
    // inference from control flow.
    // The re-read goes back through the SAME guard, so "is it still there" is
    // answered by the thing that decided where "there" was. A second notion of
    // the path here is how a removal gets confirmed against the wrong object.
    const after = checkTarget(dir, groundDir);
    if (after.absent === true) {
      out.cleared.push(dir);
    } else {
      out.unremoved.push(dir);
      if (failure !== null) out.refused.push({ dir, reason: `removal threw: ${failure}` });
    }
  }
  return out;
}

/**
 * The lines the runner prints. Here rather than at the call site so the zero
 * case cannot be dropped by an edit that only thinks about the non-zero one:
 * `0 cleared` and "no clear ran" must never render the same way. That is the
 * `IGNORED-BY-GROUND` rule, and it was written down because a `0` from a
 * directory that had never existed once reached the ledger as a measurement.
 *
 * @param {ReturnType<typeof captureAndClearMintedSessions>} result
 * @param {string} project
 */
export function describeGroundClear(result, project) {
  const lines = [];
  if (result.dest === null && result.refused.length === 0 && result.absent.length === 0) {
    lines.push(
      `own ground: MINTED-SESSION CLEAR 0 dir(s) — this run minted no session inside projects/${project}, ` +
        'so there was nothing to capture and nothing to remove',
    );
    return lines;
  }
  if (result.dest !== null) {
    lines.push(`own ground: CAPTURED ${result.captured.length} minted session(s) to ${result.dest}`);
    for (const dir of result.captured) lines.push(`own ground: CAPTURED ${dir}`);
  }
  for (const dir of result.cleared) lines.push(`own ground: CLEARED ${dir} — removed from projects/${project}, re-read to confirm`);
  for (const dir of result.absent) lines.push(`own ground: ALREADY-GONE ${dir} — nothing to remove, which is not the same finding as having removed it`);
  for (const { dir, reason } of result.refused) lines.push(`own ground: REFUSED-TO-CLEAR ${dir} — ${reason}`);
  for (const dir of result.unremoved) {
    lines.push(
      `own ground: CLEAR-DID-NOT-TAKE ${dir} — captured and removed, and still present when re-read; ` +
        'the next run will refuse on the ground hash',
    );
  }
  return lines;
}

/** Where a run parks the `_logs` sessions it minted, before removing them. */
export function logsClearDir(root, storyId, runStamp) {
  return join(root, '_logs', '_story-logs-clear', storyId, runStamp);
}

/** `_<kind>-<id>`, one segment, the shape `mintedSessionDirNames` returns. */
const MINTED_LOG_DIR_SHAPE = /^_[A-Za-z][A-Za-z0-9]*-[A-Za-z0-9._-]+$/;

/**
 * Capture every `_logs` session THIS RUN minted, then remove it —
 * `forge-8vfn.7.6.137`. 7.6.123 did the GROUND half; this is the `_logs` half.
 *
 * WHY IT EXISTS, measured rather than supposed: every costed run left its own
 * `_agent-*` behind, so the NEXT run's §15.427 residue door refused on it. S9
 * run 7's leavings blocked run 8; run 8's blocked S3 run 3. Each refusal was
 * correct and cost $0 — and each was paid off by a hand capture-then-clear that
 * nothing in the product did.
 *
 * DERIVED, NEVER A PATTERN. `mintedNames` comes from `mintedSessionDirNames`,
 * which is the before/after diff plus a session marker. A `_*` sweep would take
 * `_logs/INIT-*` fixtures and any concurrent lane's dirs with it.
 *
 * CAPTURE FIRST AND CONFIRM BY RE-READING, both for `captureAndClearMintedSessions`'
 * reasons: a capture that throws leaves the directory alone, and "cleared" is a
 * second look rather than an inference from control flow.
 */
export function captureAndClearMintedLogs({ root, storyId, runStamp, mintedNames }) {
  const out = { dest: null, captured: [], cleared: [], refused: [], unremoved: [] };
  if (!Array.isArray(mintedNames) || mintedNames.length === 0) return out;

  const logsDir = resolve(join(root, '_logs'));
  const dest = logsClearDir(root, storyId, runStamp);

  for (const name of mintedNames) {
    if (typeof name !== 'string' || !MINTED_LOG_DIR_SHAPE.test(name)) {
      out.refused.push({ dir: String(name), reason: `is not shaped _<kind>-<id>, so nothing in this run minted it` });
      continue;
    }
    const from = resolve(join(logsDir, name));
    // The shape check already excludes `/` and `..`, but the containment check
    // is kept because a guard that depends on another guard's regex staying
    // exactly as it is today is a guard with a hidden premise.
    if (from !== join(logsDir, name) || !from.startsWith(`${logsDir}/`)) {
      out.refused.push({ dir: name, reason: `resolves outside ${logsDir}` });
      continue;
    }
    if (!existsSync(from)) { out.refused.push({ dir: name, reason: 'absent by the time the clear ran' }); continue; }

    try {
      mkdirSync(dest, { recursive: true });
      cpSync(from, join(dest, name), { recursive: true, preserveTimestamps: true });
    } catch (error) {
      out.refused.push({ dir: name, reason: `capture failed (${error.message}) — not removing what was not captured` });
      continue;
    }
    out.dest = dest;
    out.captured.push(name);

    let failure = null;
    try { rmSync(from, { recursive: true, force: true }); } catch (error) { failure = error.message; }
    if (!existsSync(from)) out.cleared.push(name);
    else {
      out.unremoved.push(name);
      if (failure !== null) out.refused.push({ dir: name, reason: `removal threw: ${failure}` });
    }
  }
  return out;
}

/**
 * The lines the runner prints. Zero minted and zero cleared must not render the
 * same way — the `IGNORED-BY-GROUND` rule, because a `0` from a case that never
 * arose once reached the ledger as a measurement.
 */
export function describeLogsClear(result) {
  const lines = [];
  if (result.captured.length === 0 && result.refused.length === 0) {
    lines.push('own logs: this run minted no session in _logs/ — nothing to clear, which is not the same as clearing nothing');
    return lines;
  }
  if (result.dest !== null) lines.push(`own logs: CAPTURED ${result.captured.length} minted session(s) to ${result.dest}`);
  for (const n of result.cleared) lines.push(`own logs: CLEARED ${n} — removed from _logs/, re-read to confirm`);
  for (const n of result.unremoved) lines.push(`own logs: NOT REMOVED ${n} — captured, still present after the removal`);
  for (const r of result.refused) lines.push(`own logs: REFUSED ${r.dir} — ${r.reason}`);
  return lines;
}

/** Where a run's own non-session artefacts are captured before removal. */
export function runArtefactsClearDir(root, storyId, runStamp) {
  return join(root, '_logs', '_story-run-artefacts-clear', storyId, runStamp);
}

/** `INIT-<something>`, ONE path segment. The queue sweep only ever attributes
 *  manifests of this shape, and the containment checks below do not lean on it. */
const INITIATIVE_ID_SHAPE = /^INIT-[A-Za-z0-9._-]+$/;

/** The six queue states, named rather than globbed — an absent dir is skipped,
 *  never treated as an empty one (§15.430). */
const QUEUE_STATES = Object.freeze(['pending', 'in-flight', 'ready-for-review', 'done', 'failed', 'merged']);

/**
 * The artefacts a run minted FOR ONE INITIATIVE, derived from its id —
 * `forge-8vfn.7.6.146`.
 *
 * 7.6.123 cleared the ground, 7.6.137 the `_logs` sessions. Runs 20 and 21 then
 * showed three more, and the next costed run's residue door refused on each in
 * turn, at $0 each:
 *
 *   run 21 dispatch 1   `_queue/in-flight=1`      the `.md.heartbeat`
 *   run 21 dispatch 2   `_worktrees=2`            `<id>` and the `wi` container
 *   run 21 itself       `_logs/<ts>_INIT-*=1`     the develop cycle dir
 *
 * Every refusal was correct and each was paid off by a HUMAN capture-then-clear
 * that nothing in the product did. The queue sweep even NAMED the first one —
 * "LEFT … not an INIT manifest (the story-id sweep owns it)" — and it was read
 * as "therefore fine". An instrument deliberately leaving something and that
 * thing being safe to leave are different sentences.
 *
 * DERIVED, NEVER A PATTERN (T1 1164). `initiativeIds` comes from the queue
 * sweep, which ATTRIBUTED those manifests to this run by `created_at`. A
 * `_worktrees/*` sweep would take a concurrent lane's trees, and this box runs
 * four lanes.
 *
 * Returns only paths that EXIST, so a caller's count is of real work.
 */
export function mintedRunArtefactsToClear({ root, initiativeIds }) {
  if (!Array.isArray(initiativeIds) || initiativeIds.length === 0) return [];
  const out = [];
  const add = (p) => { if (existsSync(p)) out.push(p); };

  for (const id of initiativeIds) {
    if (typeof id !== 'string' || !INITIATIVE_ID_SHAPE.test(id)) continue;
    for (const state of QUEUE_STATES) add(join(root, '_queue', state, `${id}.md.heartbeat`));
    add(join(root, '_worktrees', id));
    add(join(root, '_worktrees', 'wi', id));

    // The cycle dir is `<timestamp>_<id>`. Matched by SUFFIX, never substring:
    // `INIT-foo` must not claim `INIT-foo-bar`.
    const logsDir = join(root, '_logs');
    let entries = [];
    try { entries = readdirSync(logsDir, { withFileTypes: true }); } catch { entries = []; }
    for (const e of entries) {
      if (e.isDirectory() && e.name.endsWith(`_${id}`)) add(join(logsDir, e.name));
    }
  }
  return out;
}

/**
 * Capture each artefact, prove the capture, then remove it — the contract
 * `captureAndClearMintedSessions` and `captureAndClearMintedLogs` already keep.
 *
 * AND THE `wi` CONTAINER IS EMPTIED TOO, which is not cosmetic: `residue.sh`
 * gates on `ls -1 _worktrees | grep -c .`, so an emptied-but-present `wi/`
 * scores 1 and the NEXT run still refuses. A fix that removed only the id trees
 * would look complete and leave the door shut.
 */
export function captureAndClearMintedRunArtefacts({ root, storyId, runStamp, initiativeIds, capture = null }) {
  const out = { dest: null, captured: [], cleared: [], refused: [], unremoved: [] };
  const paths = mintedRunArtefactsToClear({ root, initiativeIds });
  if (paths.length === 0) return out;

  const dest = runArtefactsClearDir(root, storyId, runStamp);
  const rootAbs = resolve(root);

  for (const from of paths) {
    const abs = resolve(from);
    // Containment, independent of the id shape above: a guard that depends on
    // another guard's regex staying exactly as it is today has a hidden premise.
    if (!abs.startsWith(`${rootAbs}/`)) {
      out.refused.push({ path: from, reason: `resolves outside ${rootAbs}` });
      continue;
    }
    const rel = abs.slice(rootAbs.length + 1);
    try {
      mkdirSync(join(dest, dirname(rel)), { recursive: true });
      if (typeof capture === 'function') capture(abs, join(dest, rel));
      else cpSync(abs, join(dest, rel), { recursive: true, preserveTimestamps: true });
    } catch (error) {
      out.refused.push({ path: from, reason: `capture failed (${error.message}) — not removing what was not captured` });
      continue;
    }
    out.dest = dest;
    out.captured.push(rel);

    try {
      rmSync(abs, { recursive: true, force: true });
    } catch (error) {
      out.unremoved.push({ path: from, reason: String(error.message) });
      continue;
    }
    // "Cleared" is a SECOND LOOK, never an inference from control flow.
    if (existsSync(abs)) out.unremoved.push({ path: from, reason: 'still present after removal' });
    else out.cleared.push(rel);
  }

  // The container, only when THIS run emptied it.
  const wi = join(root, '_worktrees', 'wi');
  try {
    if (existsSync(wi) && readdirSync(wi).length === 0) {
      rmSync(wi, { recursive: true, force: true });
      if (!existsSync(wi)) out.cleared.push('_worktrees/wi (emptied container)');
    }
  } catch { /* leaving it is reported by the next run's residue door, never silently */ }

  return out;
}

/** One line per outcome, in the shape the other two clears print. */
export function describeRunArtefactsClear(result) {
  const lines = [];
  if (result.dest !== null) {
    lines.push(`[stories] own artefacts: CAPTURED ${result.captured.length} path(s) to ${result.dest}`);
  }
  for (const p of result.cleared) lines.push(`[stories] own artefacts: CLEARED ${p} — removed, re-read to confirm`);
  for (const r of result.refused) lines.push(`[stories] own artefacts: REFUSED ${r.path} — ${r.reason}`);
  for (const u of result.unremoved) lines.push(`[stories] own artefacts: NOT REMOVED ${u.path} — ${u.reason}; the next run's residue door will refuse on it at $0`);
  return lines;
}
