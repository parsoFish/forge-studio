/**
 * ground-merge-accounted.mjs — bead `forge-8vfn.8.1.32`, T1 ruling 1694.
 *
 * S10 PROOF RUN 35. Beat 20 approved and merged gitpulse PR #26; closure then
 * ran `closure.local-aligned-to-remote` + `closure.manifest-moved-to-merged`
 * (cycle log, 22:59:44) and fast-forwarded the ground to the merged remote.
 * The own-ground fence (`run-story.mjs`) had no notion of a legitimate merge
 * — every one of #26's 18 changed paths (src/cli.ts, src/author-filter.ts,
 * tests, CHANGELOG, package.json, README, forge/history/<INIT>/demo/…) came
 * back `UNDECLARED …nothing this run minted accounts for it`, and the run
 * went RED for the product working exactly as designed (T1 ruling 594's own
 * words: "the produced half is reported loudly and does not fail the run").
 *
 * THE RULE (T1 1694, amended by the reviewer's own acceptance pass). When a
 * run's cycle log carries BOTH `closure.local-aligned-to-remote` and
 * `closure.manifest-moved-to-merged` for this run's initiative, the merge is
 * accounted for — but the EVENT IS A POINTER, NEVER PROOF:
 *
 *   1. The align event must name a `target_sha` — no default, no regex over
 *      its human `detail` string (§15.539's dead-glob lesson: information
 *      that exists only in rendered text is information nothing can act on).
 *   2. When a `cycle.post-merge-ci` event ALSO carries a `sha` (an
 *      INDEPENDENTLY fetched fact — `gh pr view --json mergeCommit`, never
 *      derived from the same git fetch/ff the align step just ran), it must
 *      AGREE with `target_sha`. Absent (the watch is best-effort and can
 *      legitimately answer 'unavailable' on a green merge) is not itself a
 *      failure — there is nothing to disagree with.
 *   3. The ground's ACTUAL git HEAD, read live, must equal `target_sha`. The
 *      align event's word alone is never trusted for this.
 *   4. The working tree must be clean against that HEAD — BOTH untracked and
 *      modified/staged paths, `git status --porcelain`, same instrument the
 *      rest of the fence already uses. A ref that points at the right commit
 *      while the working tree still holds something else (the ref-only
 *      alignment fallback in `pr-branch-sync.ts` moves the ref without ever
 *      touching disk) is not "clean" — and a tracked-diff comparison alone
 *      would never see it, because `git diff <a> <b>` only ever compares two
 *      COMMITS, never the working tree against either.
 *   5. Only then is `git -C <ground> diff --name-status <pin> <HEAD>` taken
 *      as the merged PR's own diff — `pin` is the ground's git HEAD captured
 *      by THIS run before anything happened, read directly by the fence,
 *      never off an event.
 *
 * ANY gap in that chain — no target_sha, disagreement, HEAD mismatch, a
 * dirty tree, an unreadable diff — is UNKNOWN, reported as a NAMED
 * containment failure, NEVER a silent pass (§6.15): a run that can prove
 * nothing about its own merge cannot be waved through on the strength of a
 * green-shaped log line.
 *
 * The accounted paths are folded into `classifyOwnGroundDrift`'s existing
 * DECLARED bucket (a synthetic whole-run `expectedChanges` entry per path) —
 * `run-story.mjs` changes by a handful of lines, not a second gate; every
 * other bucket (produced / ignored / undeclared) is exactly as it was.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const MAX_BUFFER = 64 * 1024 * 1024;

/** `git rev-parse HEAD` in `dir` — null when unreadable, never thrown. */
export function safeRevParseHead(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/** The ground's pre-run pin — captured BEFORE the beat loop runs anything. */
export function captureGroundPin(root, project) {
  return project === null || project === undefined ? null : safeRevParseHead(join(root, 'projects', project));
}

/**
 * `git status --porcelain` split into untracked (`??`) and everything else
 * (staged-added, staged/unstaged modified, deleted) — the two shapes the
 * ruling names explicitly. `null` on a read failure, never "clean".
 */
export function groundWorkingTreeStatus(dir) {
  let out;
  try {
    out = execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8', maxBuffer: MAX_BUFFER });
  } catch {
    return null;
  }
  const untracked = [];
  const modified = [];
  for (const line of out.split('\n')) {
    if (line === '') continue;
    (line.startsWith('??') ? untracked : modified).push(line.slice(3));
  }
  return { untracked, modified };
}

/**
 * `git diff --name-status <from> <to>`, tracked paths only, in
 * `groundChanges`'s own vocabulary (`added`/`removed`/`modified`) so the
 * result drops straight into a `declaredChanges` entry. A rename splits into
 * its two halves — the same shape a content-hash diff sees a rename as,
 * since that diff also matches by name, never by blob identity.
 */
export function groundTrackedDiff(dir, fromRef, toRef) {
  let out;
  try {
    out = execFileSync('git', ['-C', dir, 'diff', '--name-status', '--find-renames', fromRef, toRef], {
      encoding: 'utf8', maxBuffer: MAX_BUFFER,
    });
  } catch {
    return null;
  }
  const changes = [];
  for (const line of out.split('\n')) {
    if (line === '') continue;
    const cols = line.split('\t');
    const status = cols[0];
    if (status.startsWith('R')) {
      changes.push({ kind: 'removed', path: cols[1] }, { kind: 'added', path: cols[2] });
    } else if (status.startsWith('C')) {
      changes.push({ kind: 'added', path: cols[2] });
    } else {
      changes.push({ kind: status === 'A' ? 'added' : status === 'D' ? 'removed' : 'modified', path: cols[1] });
    }
  }
  return changes;
}

/**
 * `sha`'s parent shas, in commit-graph order — `[]` for a root commit, `null`
 * on a read failure (never conflated: an unreadable graph is not "no
 * parents"). `git rev-list --parents -n 1 <sha>` prints `<sha> <p1> [<p2>]`.
 */
function groundCommitParents(dir, sha) {
  let out;
  try {
    out = execFileSync('git', ['-C', dir, 'rev-list', '--parents', '-n', '1', sha], { encoding: 'utf8', maxBuffer: MAX_BUFFER }).trim();
  } catch {
    return null;
  }
  return out.split(/\s+/).filter((s) => s !== '').slice(1);
}

/**
 * This run's merge-alignment evidence, found by scanning the cycle logs it
 * minted — `readEvents(dir)` is `run-observe.mjs`'s `readRunEvents`, injected
 * so this module never has to know `_logs`' on-disk shape or import across
 * the fence-vs-observation seam. `null` when the co-occurrence condition
 * (T1 1694's entry test) is not met — most stories never merge anything, and
 * that is not a defect.
 */
export function findMergeAlignment(logsDir, mintedLogNames, readEvents) {
  for (const name of mintedLogNames) {
    const events = readEvents(join(logsDir, name));
    const align = events.find((e) => e?.message === 'closure.local-aligned-to-remote');
    const merged = events.find((e) => e?.message === 'closure.manifest-moved-to-merged');
    if (align === undefined || merged === undefined) continue;
    const mergeEvent = events.find((e) => e?.message === 'cycle.post-merge-ci' && typeof e?.metadata?.sha === 'string');
    return { align, merged, crossCheckSha: mergeEvent?.metadata?.sha ?? null, logName: name };
  }
  return null;
}

/**
 * The chain itself (see file header). `pin` is the ground's git HEAD before
 * the run; `alignment` is `findMergeAlignment`'s result. Returns the verified
 * merge diff or a named reason — never a bare boolean, so the caller can
 * report exactly what could not be confirmed.
 *
 * @returns {{ok: true, accounted: Array<{kind:string, path:string}>}|{ok: false, reason: string}}
 */
export function verifyMergeAlignment({ groundDir, pin, alignment }) {
  if (pin === null) {
    return { ok: false, reason: 'the ground had no readable git HEAD before this run started — nothing to pin the merge diff against' };
  }
  const targetSha = alignment.align.metadata?.target_sha;
  if (typeof targetSha !== 'string' || targetSha === '') {
    return { ok: false, reason: 'closure.local-aligned-to-remote carried no target_sha — the event is a pointer with nothing to point at' };
  }
  if (alignment.crossCheckSha !== null && alignment.crossCheckSha !== targetSha) {
    return {
      ok: false,
      reason: `target_sha ${targetSha} disagrees with the independently-reported merge commit ${alignment.crossCheckSha} ` +
        '(cycle.post-merge-ci) — the alignment event cannot be trusted alone',
    };
  }
  const head = safeRevParseHead(groundDir);
  if (head === null) return { ok: false, reason: 'the ground\'s git HEAD is unreadable after the run — cannot confirm alignment' };
  if (head !== targetSha) {
    return { ok: false, reason: `ground HEAD ${head} does not match the target_sha ${targetSha} named by closure.local-aligned-to-remote` };
  }
  // Reviewer amendment to T1 1694 — `<pin>..<HEAD>` is only the PR's own
  // `base..merge` diff when HEAD really is a merge OF the pin. Forge's
  // closure merges via `gh pr merge --merge` (`pr.ts:mergePullRequest`),
  // which always produces a two-parent commit whose FIRST parent is
  // whatever the target branch pointed at when GitHub performed the merge —
  // never a squash/rebase single-parent HEAD. Without this, any commit that
  // landed on the ground's main BETWEEN the pin and the merge (this run
  // never minted it, nothing declares it) would be silently folded into
  // "the merge diff" merely for sitting between the same two shas.
  const parents = groundCommitParents(groundDir, head);
  if (parents === null) return { ok: false, reason: `could not read HEAD ${head}'s parents in the ground` };
  if (parents.length < 2) {
    return {
      ok: false,
      reason: `ground HEAD ${head} is not a merge commit (${parents.length} parent(s)) — forge's closure merges via ` +
        `'gh pr merge --merge', which always produces one; refusing to treat ${pin}..${head} as the merged PR's own diff`,
    };
  }
  if (parents[0] !== pin) {
    return {
      ok: false,
      reason: `ground HEAD ${head}'s first parent ${parents[0]} is not the pin ${pin} — the ground's main moved between ` +
        `the pin and the merge, so ${pin}..${head} is not the merged PR's own base..merge diff`,
    };
  }
  const dirty = groundWorkingTreeStatus(groundDir);
  if (dirty === null) return { ok: false, reason: `git status could not be read in the ground at HEAD ${head}` };
  if (dirty.untracked.length > 0 || dirty.modified.length > 0) {
    return {
      ok: false,
      reason: `the ground's working tree is not clean against HEAD ${head} — ` +
        `untracked: ${dirty.untracked.join(', ') || '(none)'}; modified: ${dirty.modified.join(', ') || '(none)'}`,
    };
  }
  const diff = groundTrackedDiff(groundDir, pin, head);
  if (diff === null) return { ok: false, reason: `git diff --name-status ${pin}..${head} failed in the ground` };
  return { ok: true, accounted: diff };
}

/**
 * The composed call `run-story.mjs` makes: find the evidence, verify it, and
 * hand back exactly what a caller needs — `expectedChanges` WIDENED by this
 * run's own verified merge (folded into `classifyOwnGroundDrift`'s existing
 * DECLARED bucket, never a second gate), console lines, and a pre-worded
 * containment reason (or null). No merge evidence at all is the common,
 * unremarkable case: `expectedChanges` passes through unchanged.
 */
export function applyMergeAccounting({ groundDir, project, pin, logsDir, mintedLogNames, readEvents, expectedChanges }) {
  const alignment = findMergeAlignment(logsDir, mintedLogNames, readEvents);
  if (alignment === null) return { expectedChanges, lines: [], failureReason: null };
  const verdict = verifyMergeAlignment({ groundDir, pin, alignment });
  if (!verdict.ok) {
    return {
      expectedChanges,
      lines: [`own ground: MERGE ALIGNMENT UNVERIFIABLE — ${verdict.reason}`],
      failureReason:
        `CONTAINMENT FAILURE — the merge closure reported for projects/${project} could not be verified: ` +
        `${verdict.reason}. Nothing in it is accounted for; the run is RED regardless of its beats.`,
    };
  }
  const lines = [`own ground: MERGE-ACCOUNTED ${verdict.accounted.length} path(s) — aligned to ${alignment.align.metadata.target_sha}, verified against the ground's own git`];
  for (const { kind, path } of verdict.accounted) lines.push(`own ground: merge-accounted ${kind[0].toUpperCase()} ${path}`);
  return {
    expectedChanges: [...expectedChanges, ...verdict.accounted.map(({ kind, path }) => ({ path, change: kind }))],
    lines,
    failureReason: null,
  };
}
