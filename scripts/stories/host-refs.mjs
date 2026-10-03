/**
 * host-refs.mjs — EVERY ref of the forge repo (not only the running tree's
 * own checked-out one), snapshotted at story start and judged at its end.
 * Row 208 (bead `forge-8vfn.8.5.44`), the harness half of the 2026-10-03
 * incident.
 *
 * MEASURED. A story run from `~/forge-m7-e-docs` (a git WORKTREE of
 * `~/forge`, DETACHED HEAD) launched forge's onboarding agent, which
 * committed onto the docs tree's own detached HEAD — `host-head.mjs`'s
 * `recordHostHead`/`judgeHostHead` DID catch that half, but only because the
 * gate died before the end-of-story judgement ever ran; it is not a defence
 * this fence can rely on. The agent then ran `git update-ref
 * refs/heads/main 8be024930` directly, and because every worktree of ONE
 * repository shares its refs — `refs/heads/*`, `refs/tags/*`, `refs/stash`
 * and `refs/notes/*` all live in the single common `.git` dir; only `HEAD`,
 * the index and a handful of per-worktree refs are private to each checkout
 * — that one command moved the OPERATOR's own checked-out `main` in
 * `~/forge`, a tree the story never touched directly. `host-head.mjs` was
 * never watching it: it watches the ONE ref the running tree itself has
 * checked out, not every ref the repo holds. The story fence's own porcelain
 * diff saw nothing either, by the same "a committed write leaves porcelain
 * clean" reasoning `host-head.mjs`'s own header already names.
 *
 * SO THIS FENCE READS EVERY REF, via `git for-each-ref` run from the tree
 * this story is running in — which, for any ref under `refs/heads/*`,
 * `refs/tags/*`, `refs/stash` or `refs/notes/*`, reads the repo's ONE shared
 * ref database no matter which worktree asks. `refs/remotes/*` is read too
 * but EXCLUDED from the verdict: an operator or T1 `git fetch` legitimately
 * moves a remote-tracking ref while a story is running, and that is not the
 * story's doing — but a move there is still NAMED as excluded, never
 * silently invisible, so an operator reading the log can tell "this moved
 * and was judged fine" from "this moved and nobody looked".
 *
 * NO AUTO-RESTORE, deliberately unlike `host-head.mjs`'s own clear. A moved
 * ref found here can belong to ANOTHER worktree entirely — this fence has no
 * way to know whether resetting it would undo the operator's own work rather
 * than the story's — so every finding is evidence only: the before/after SHA,
 * `git log --oneline before..after` when the move is a fast-forward, and a
 * `git format-patch --stdout` of the new commits, all written into the run's
 * red-evidence dir and named in full. `judgeHostHead`'s own clear (a soft
 * reset of the RUNNING TREE's own checked-out ref) runs before this
 * judgement is ever made, so a ref `host-head.mjs` already put back reads
 * here as unmoved — this fence judges what is LEFT moved after that, not
 * what `host-head.mjs` already owns.
 *
 * UNREADABLE IS NAMED, NEVER CLEAN (§15.504), same discipline as
 * `host-head.mjs`: refs that could not be read at story start or at story end
 * are their own red, not a silent pass.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REMOTE_PREFIX = 'refs/remotes/';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function errText(e) {
  return e?.stderr?.toString().trim() || e?.message || String(e);
}

const short = (sha) => sha.slice(0, 12);
const isRemote = (ref) => ref.startsWith(REMOTE_PREFIX);
/** Repo-relative-ish, filesystem-safe name for a ref, used only in evidence filenames. */
const sanitize = (ref) => ref.replace(/[^a-zA-Z0-9._-]+/g, '-');

/**
 * Every ref in the repo, as `{ [refname]: sha }` — `git for-each-ref` with no
 * pattern lists ALL of `refs/heads/*`, `refs/tags/*`, `refs/stash`,
 * `refs/notes/*` and `refs/remotes/*` (when any exist); `HEAD` itself is not
 * under `refs/` and is `host-head.mjs`'s own concern, not this one's.
 */
function readRefs(root) {
  const out = git(root, ['for-each-ref', '--format=%(objectname) %(refname)']);
  const refs = {};
  for (const line of out.split('\n')) {
    if (line === '') continue;
    const sp = line.indexOf(' ');
    refs[line.slice(sp + 1)] = line.slice(0, sp);
  }
  return refs;
}

/**
 * Every ref in the repo, now.
 * @returns {{refs: Record<string,string>, error: null} | {refs: null, error: string}}
 */
export function recordHostRefs(root) {
  try {
    return { refs: readRefs(root), error: null };
  } catch (e) {
    return { refs: null, error: errText(e) };
  }
}

/**
 * Write one ref's evidence into `evidenceDir` — before/after SHA always; a
 * `git log --oneline` range and a `format-patch` when the move is a
 * fast-forward (the only shape a range diff means anything for). Never
 * throws: a capture that could not be written still leaves the fact of the
 * move in `judged.lines`, which is what the run's exit code actually reads.
 */
function writeRefEvidence(root, evidenceDir, ref, status, before, after) {
  const base = sanitize(ref);
  const lines = [
    `ref: ${ref}`,
    `status: ${status}`,
    `before: ${before ?? '(none — the ref did not exist at story start)'}`,
    `after: ${after ?? '(none — the ref no longer exists at story end)'}`,
    '',
  ];
  let patchPath = null;
  if (before !== null && after !== null) {
    try {
      git(root, ['merge-base', '--is-ancestor', before, after]);
      const log = git(root, ['log', '--oneline', `${before}..${after}`]).trim();
      lines.push('--- git log --oneline before..after ---', log === '' ? '(empty range)' : log, '');
      const patch = git(root, ['format-patch', '--stdout', `${before}..${after}`]);
      patchPath = join(evidenceDir, `HOST-REF-MOVED-${base}.patch`);
      writeFileSync(patchPath, patch);
    } catch (e) {
      lines.push(
        `(${short(before)} is not an ancestor of ${short(after)} — the ref was rewritten, not committed onto; ` +
        `no range diff kept: ${errText(e)})`,
      );
    }
  }
  const txtPath = join(evidenceDir, `HOST-REF-${status.toUpperCase()}-${base}.txt`);
  writeFileSync(txtPath, `${lines.join('\n')}\n`);
  return { txtPath, patchPath };
}

/**
 * @param {{root: string, recorded: ReturnType<typeof recordHostRefs>, storyId: string, evidenceDir: string}} args
 * @returns {{red: boolean, moved: string[], created: string[], deleted: string[],
 *   excludedRemoteMoved: string[], evidence: string[], summary: string|null, lines: string[]}}
 */
export function judgeHostRefs({ root, recorded, storyId, evidenceDir }) {
  const judged = {
    red: false, moved: [], created: [], deleted: [], excludedRemoteMoved: [], evidence: [], summary: null, lines: [],
  };
  const red = (summary, ...lines) => ({ ...judged, red: true, summary, lines: [...judged.lines, ...lines] });

  if (recorded.error !== null) {
    return red('refs could not be read at story start',
      `[stories] fence: REFS UNKNOWN — could not read this repo's refs at story start (${recorded.error}); a ref ` +
      'the run moved would be invisible, so this is not clean');
  }

  let now;
  try {
    now = readRefs(root);
  } catch (e) {
    return red('refs could not be read at story end',
      `[stories] fence: REFS UNKNOWN — could not read this repo's refs at story end (${errText(e)}); ` +
      `${Object.keys(recorded.refs).length} ref(s) recorded at story start — not clean`);
  }

  const before = recorded.refs;
  const allNames = new Set([...Object.keys(before), ...Object.keys(now)]);
  const changes = [];
  for (const ref of allNames) {
    const b = before[ref] ?? null;
    const a = now[ref] ?? null;
    if (b === a) continue;
    const status = b === null ? 'created' : a === null ? 'deleted' : 'moved';
    changes.push({ ref, status, before: b, after: a, remote: isRemote(ref) });
  }

  // `refs/remotes/*` is excluded from EVERY count below (`-- the exclusion`):
  // an operator/T1 `git fetch` during the run legitimately moves a
  // remote-tracking ref, and that is not the story's doing — but it is still
  // NAMED below as excluded, never silently invisible.
  const remoteChanges = changes.filter((c) => c.remote);
  const localChanges = changes.filter((c) => !c.remote);

  for (const c of remoteChanges) {
    judged.excludedRemoteMoved.push(c.ref);
    judged.lines.push(
      `[stories] fence: REF ${c.status.toUpperCase()} ${c.ref} (${c.before ? short(c.before) : '(none)'}..` +
      `${c.after ? short(c.after) : '(none)'}) — EXCLUDED from judgement (refs/remotes/* is never this story's ` +
      'doing — an operator or T1 fetch during the run moves it legitimately)',
    );
  }

  if (localChanges.length === 0) {
    const clean = remoteChanges.length > 0
      ? `[stories] fence: refs unchanged outside refs/remotes/* — ${allNames.size - remoteChanges.length} ref(s), as the story found them`
      : `[stories] fence: refs unchanged — ${allNames.size} ref(s), as the story found them (excluding refs/remotes/*, ` +
        'which this fence never judges — an operator/T1 fetch during the run legitimately moves those)';
    return { ...judged, lines: [...judged.lines, clean] };
  }

  mkdirSync(evidenceDir, { recursive: true });
  const namedLines = [];
  for (const c of localChanges) {
    const { txtPath, patchPath } = writeRefEvidence(root, evidenceDir, c.ref, c.status, c.before, c.after);
    judged.evidence.push(txtPath, ...(patchPath ? [patchPath] : []));
    if (c.status === 'moved') {
      judged.moved.push(c.ref);
      namedLines.push(
        `[stories] fence: REF MOVED ${c.ref} ${short(c.before)}..${short(c.after)} — evidence kept in ${txtPath}` +
        (patchPath ? ` and ${patchPath}` : ''),
      );
    } else if (c.status === 'created') {
      judged.created.push(c.ref);
      namedLines.push(`[stories] fence: REF CREATED ${c.ref} at ${short(c.after)} — evidence kept in ${txtPath}`);
    } else {
      judged.deleted.push(c.ref);
      namedLines.push(`[stories] fence: REF DELETED ${c.ref} (was ${short(c.before)}) — evidence kept in ${txtPath}`);
    }
  }

  return {
    ...judged,
    red: true,
    summary: `${localChanges.length} ref(s) changed outside refs/remotes/* (${judged.moved.length} moved, ` +
      `${judged.created.length} created, ${judged.deleted.length} deleted); evidence kept under ${evidenceDir}`,
    lines: [...judged.lines, ...namedLines],
  };
}
