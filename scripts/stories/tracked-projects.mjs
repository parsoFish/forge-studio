/**
 * tracked-projects.mjs — which projects exist in EVERY checkout, asked of git
 * rather than of the directory (`forge-8vfn.26` part b).
 *
 * WHY A RULE AND NOT A NAME. `proof.story.mjs` beat 1 binds `<someProjectId>`
 * from whatever the product discovered, and beat 2 navigates to it — that is
 * one of the three mechanisms the story exists to prove, and it is the only
 * route-binding proof the campaign has. But "the first project card" is a
 * property of the RUNNING CHECKOUT's `projects/` directory: this lane holds
 * `gitpulse` and `mdtoc`, CI holds `mdtoc` alone, and the committed sample
 * recorded `gitweave` from a third lane. So every lane that ran the mandatory
 * costless step rewrote the artifact to its own listing and the file never
 * converged — whoever committed last won.
 *
 * Naming the project in the story would converge it and destroy the binding.
 * Sorting the cards would keep the binding and NOT converge — deterministic on
 * one tree, still `gitpulse` here and `mdtoc` in CI. C's third option is the one
 * that gets both: the story states a RULE, the product is still what answers it,
 * and the answer is identical everywhere because THAT IS WHAT TRACKED MEANS.
 *
 * IT REFUSES RATHER THAN GUESSING, for the reason `groundIgnoreFromGit` does: a
 * failed `git ls-files` is not "no project is tracked". An empty set would make
 * the beat match no card at all and red as "the product rendered nothing" — a
 * product defect reported for an environment failure, which is the exact shape
 * this campaign keeps paying for.
 */
import { spawnSync } from 'node:child_process';

/**
 * The ids under `projects/` that git TRACKS, sorted. A project is tracked when
 * the repository carries at least one file beneath it, which is what makes the
 * set identical in every checkout and in CI.
 * @returns {string[]}
 */
export function trackedProjectIds(root) {
  const res = spawnSync('git', ['-C', root, 'ls-files', '--', 'projects/'], { encoding: 'utf8' });
  if (res.error !== undefined) {
    throw new Error(
      `trackedProjectIds: could not run git ls-files in ${root} — ${res.error.message}. `
        + 'Refusing: a failed read is not an empty set, and an empty set would make the beat match '
        + 'no card and red as though the product had rendered nothing.',
    );
  }
  if (res.status !== 0) {
    throw new Error(
      `trackedProjectIds: git ls-files exited ${res.status} in ${root}`
        + `${res.stderr ? ` — ${String(res.stderr).trim()}` : ''} (128 means it is not a git repository). `
        + 'Refusing rather than reporting an unread tree as a tree with no tracked projects.',
    );
  }
  const ids = new Set();
  for (const line of String(res.stdout).split('\n')) {
    // `projects/<id>/…` — a file directly under `projects/` (README.md,
    // .gitkeep) names no project and is skipped rather than becoming one.
    const parts = line.split('/');
    if (parts.length >= 3 && parts[0] === 'projects' && parts[1] !== '') ids.add(parts[1]);
  }
  if (ids.size === 0) {
    throw new Error(
      `trackedProjectIds: ${root} tracks no project under projects/. Refusing: a story that `
        + 'selects among tracked projects cannot bind anything here, and reporting that as a beat '
        + 'failure would blame the product for an empty repository.',
    );
  }
  return [...ids].sort();
}
