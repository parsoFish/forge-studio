/**
 * sweep-remotes.mjs — deleting the GitHub remotes a story's run created, split
 * out of `sweep.mjs` (T1 ruling 1350's fork brief) to make room for that
 * ruling's own new function without pushing an already-over-cap file further
 * over it (`scripts/check-file-size.mjs`, 1.0.md §0; ruling 492: an edit to
 * `sweep.mjs` owes it a split, never a baseline entry). Same reason
 * `sweep-agent-logs.mjs` exists — see ITS header for the precedent.
 *
 * `sweep.mjs` keeps the PATH-DELTA fence and the fixture sweeps. This is a
 * different kind of residue: a real GitHub repository, which no path rule can
 * remove and which a `delete_repo` token reaches for the WHOLE account, not
 * just this run's own fixtures — bead `forge-8vfn.6.11.2`, T1 ruling 255.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * The env var and the operator-root file the story sweep's DELETE token is read
 * from. Constants, not literals at the call site: they name where an operator
 * puts a credential that can delete repositories, and that location is a
 * decision, not an implementation detail.
 *
 * The path is deliberately OUTSIDE the repo and outside every agent env. A
 * `delete_repo` token reaches EVERY repository the account owns, so it is never
 * the token the agents run under: never `AGENT_ENV_ALLOWLIST`, never a project
 * `secrets.env`, never a spawned session's env.
 */
export const SWEEP_DELETE_TOKEN_ENV = 'FORGE_STORY_SWEEP_DELETE_TOKEN';
export const SWEEP_DELETE_TOKEN_PATH = join(homedir(), '.config', 'forge', 'story-sweep-token');

/** Read the delete token, or null. Operator-root file first, then the env var
 *  the operator may export from it; a missing or empty token is `null`, never
 *  an empty string that would reach `gh` as a credential. */
function readSweepDeleteToken() {
  try {
    const raw = readFileSync(SWEEP_DELETE_TOKEN_PATH, 'utf8').trim();
    if (raw !== '') return raw;
  } catch { /* absent is an ordinary state, not an error */ }
  const env = process.env[SWEEP_DELETE_TOKEN_ENV];
  return typeof env === 'string' && env.trim() !== '' ? env.trim() : null;
}

/**
 * Delete the GitHub remotes a story's run created — bead `forge-8vfn.6.11.2`,
 * T1 ruling 255. The sweep owns every fixture a story authors (#407/#412), and
 * `gh repo create` at project creation makes one of those a real repository.
 *
 * TWO INDEPENDENT CONDITIONS gate every delete, and neither is sufficient
 * alone: the repo must appear in the RUN'S OWN creation manifest, AND its name
 * must carry the story's `story-<id>` prefix. A manifest is written by the run
 * and a prefix is a string; `delete_repo` is not a permission to be one mistake
 * away from.
 *
 * Absent the token this REFUSES LOUDLY BY NAME — naming both the env var and
 * the path — rather than skipping quietly. An un-swept remote nobody is told
 * about is how a story leaks a repository per run, and the token is not yet
 * issued, so the refusal is the expected state today.
 *
 * `readToken` and `runGh` are injected so no test touches a real credential or
 * a real GitHub.
 */
/**
 * The RUNNER'S DOOR to the delete — bead `forge-8vfn.6.11.29`.
 *
 * `sweepStoryRemotes` was correct and unreachable: nothing called it, and
 * nothing wrote the `created` manifest it needs, so its "refuse an unlisted
 * repo" guard was proven against a list that could never hold anything. This
 * reads the manifest the MINT now writes (`recordMintedRemote`, kernel) and
 * hands it over. Tested through THIS function, not through `sweepStoryRemotes`,
 * because "a manifest on disk becomes a delete" is the step that was missing.
 */
export function sweepStoryRemotesFromManifest({ storyId, root, readToken = readSweepDeleteToken, runGh = null }) {
  let created = [];
  try {
    const raw = readFileSync(join(root, '_logs', 'minted-remotes.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) created = parsed;
  } catch { /* no manifest = nothing this run minted = nothing to delete */ }
  return sweepStoryRemotes({ storyId, created, readToken, runGh });
}

/** A `gh repo delete` 404 means already-gone, not a failure. `gh` appends a
 *  "needs the repo scope" hint to EVERY delete 404 regardless of cause, so
 *  that hint is dropped rather than reported (`forge-8vfn.6.11.53`). */
function isAlreadyGoneError(error) {
  const msg = String(error?.message ?? error ?? '');
  return /HTTP 404\b/.test(msg) || /\bnot found\b/i.test(msg);
}

export function sweepStoryRemotes({ storyId, created = [], readToken = readSweepDeleteToken, runGh = null }) {
  const deleted = [];
  const alreadyGone = [];
  const refusals = [];
  const failed = [];
  if (created.length === 0) return { deleted, alreadyGone, refusals, failed };

  const prefix = `story-${String(storyId).toLowerCase()}`;
  // The manifest is the AUTHORITY; the prefix is the second, independent check.
  const authorised = [];
  // DEDUPE THE TARGET LIST (`forge-8vfn.6.11.53`): the APPEND-ONLY manifest can
  // carry this run's mint AND an earlier run's row for the same deterministic
  // name (`story-s2`) — without this, the second `gh delete` 404s on what the
  // first just removed.
  const seen = new Set();
  for (const entry of created) {
    const nameWithOwner = typeof entry === 'string' ? entry : entry?.nameWithOwner;
    if (typeof nameWithOwner !== 'string' || nameWithOwner === '') continue;
    if (seen.has(nameWithOwner)) continue;
    seen.add(nameWithOwner);
    const repo = nameWithOwner.split('/').pop() ?? '';
    if (!repo.startsWith(prefix)) {
      refusals.push(
        `REFUSING to delete ${nameWithOwner}: it is in this run's creation manifest but its name does not ` +
          `carry the "${prefix}" story prefix. Both conditions must hold before a delete_repo token is used.`,
      );
      continue;
    }
    authorised.push(nameWithOwner);
  }
  if (authorised.length === 0) return { deleted, alreadyGone, refusals, failed };

  const token = readToken();
  if (token === null) {
    refusals.push(
      `REFUSING to delete ${authorised.length} remote(s) this run created (${authorised.join(', ')}): no delete ` +
        `token. Provide it at ${SWEEP_DELETE_TOKEN_PATH} (mode 0600) or as ${SWEEP_DELETE_TOKEN_ENV}. ` +
        'The sweep does not fall back to the agents\' own gh auth: delete_repo reaches every repository the ' +
        'account owns, so it is deliberately not a permission the agents run under. Delete these by hand.',
    );
    return { deleted, alreadyGone, refusals, failed };
  }

  const gh =
    runGh ??
    ((args) =>
      execFileSync('gh', args, {
        encoding: 'utf8',
        env: { ...process.env, GH_TOKEN: token },
      }).toString());
  for (const nameWithOwner of authorised) {
    try {
      gh(['repo', 'delete', nameWithOwner, '--yes']);
      deleted.push(nameWithOwner);
    } catch (e) {
      if (isAlreadyGoneError(e)) {
        alreadyGone.push(nameWithOwner);
      } else {
        failed.push({ nameWithOwner, error: e?.message ?? String(e) });
      }
    }
  }
  return { deleted, alreadyGone, refusals, failed };
}

/**
 * The trailing sweep's remote-delete report, split by the stream each line
 * prints to. Extracted from `run-story.mjs` so it is testable without running
 * a story end to end (`forge-8vfn.6.11.53`): the inline version read
 * `f.nameWithOwner` off an entry that actually carried the field as `path`,
 * so a genuine failure printed `[object Object]` instead of naming the repo.
 *
 * @param {{deleted: string[], alreadyGone: string[], refusals: string[], failed: {nameWithOwner: string, error: string}[]}} remotes
 * @returns {{lines: string[], warnLines: string[]}}
 */
export function describeRemoteSweep(remotes) {
  return {
    lines: [
      ...remotes.deleted.map((r) => `[stories] trailing sweep DELETED remote ${r}`),
      ...remotes.alreadyGone.map(
        (r) => `[stories] trailing sweep remote ${r} already gone — not treated as a failure`,
      ),
    ],
    warnLines: [
      ...remotes.refusals.map((r) => `[stories] ${r}`),
      ...remotes.failed.map(
        (f) => `[stories] could not delete remote ${f.nameWithOwner ?? '(unnamed remote)'}: ${f.error ?? ''}`,
      ),
    ],
  };
}
