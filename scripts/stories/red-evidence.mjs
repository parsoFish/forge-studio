/**
 * On a RED story run, read the ground before the trailing sweep removes it.
 *
 * Bead `forge-8vfn.6.11.42` (T1 ruling 356b). S2 run 8 went red at beat 12: the
 * architect logged `interview round 2 — 2 question(s) for the operator` at
 * 21:12:30 and the page did not present `question-freetext` for 7 m 40 s.
 * Whether the questions were WRITTEN late or RENDERED late is the whole
 * question — and it could not be answered, because the trailing sweep removed
 * `projects/story-s2` before anything read `_architect/<sid>/questions.json`.
 * The sweep was working exactly as designed; nothing had asked it to wait.
 *
 * So on a red run the ground is read FIRST, into `_logs/` — outside the
 * directory the sweep removes, which is why `_logs/_architect-<sid>/
 * events.jsonl` is the one thing that survived run 8 and is the reason this
 * lands there rather than under `demos/`.
 *
 * THE MTIMES ARE THE POINT, not the contents. "Written 21:12:30, rendered
 * 21:20:10" and "written 21:20:10" hold byte-identical JSON and are different
 * defects, so every captured file's mtime is recorded EXPLICITLY in a manifest
 * rather than left to whatever a copy happens to preserve.
 *
 * A GREEN run captures nothing and sweeps exactly as before: a capture that
 * fired on every run would quietly turn the sweep off, which is the failure
 * this module would otherwise introduce while fixing another.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

import { productFixturePathsFor } from './sweep.mjs';

/** Where a red run's ground is read to — under `_logs/`, never under the ground. */
export function redEvidenceDir(root, storyId) {
  return join(root, '_logs', '_story-red-evidence', storyId);
}

/**
 * The grounds the trailing sweep is ABOUT to remove — asked of the sweep's own
 * definition rather than re-derived.
 *
 * Re-deriving it from `story.ground.project` was wrong and the green-path proof
 * caught it: `proof` declares its ground as `mdtoc`, which the sweep never
 * touches, while what it actually removes is `projects/story-proof`. A capture
 * keyed on the declared ground would have read a directory that was never at
 * risk and preserved nothing of the one that was — the same
 * two-notions-of-one-thing shape `handleFor` exists to prevent between the
 * repeat's gate and its act.
 */
function groundsAboutToBeSwept(storyId, root) {
  const projectsRoot = join(root, 'projects');
  return productFixturePathsFor(storyId, root).filter(
    (p) => p.startsWith(projectsRoot + '/') && existsSync(p) && statSync(p).isDirectory(),
  );
}

/** Every `_<kind>` session root a ground carries (`_architect`, `_onboarding`, `_demo`, …). */
function sessionKindDirs(groundDir) {
  try {
    return readdirSync(groundDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith('_'))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Every file under `dir`, repo-relative, with its mtime — recorded, not inferred. */
function mtimeRows(dir, root, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) mtimeRows(p, root, out);
    else out.push(`${new Date(statSync(p).mtimeMs).toISOString()}  ${relative(root, p)}`);
  }
  return out;
}

/**
 * Read a red run's ground before the sweep. Returns the capture directory, or
 * `null` when there was nothing to do (a green run, a story with no ground, a
 * ground already gone) — none of which is an error.
 *
 * @param {{root: string, storyId: string, project: string|null, red: boolean}} input
 */
export function captureRedEvidence({ root, storyId, red }) {
  if (!red) return null;
  const grounds = groundsAboutToBeSwept(storyId, root);
  const rows = [];
  const copies = [];
  for (const groundDir of grounds) {
    for (const kind of sessionKindDirs(groundDir)) {
      const from = join(groundDir, kind);
      rows.push(...mtimeRows(from, root));
      copies.push([from, join(basename(groundDir), kind)]);
    }
  }
  if (copies.length === 0) return null;

  const dest = redEvidenceDir(root, storyId);
  mkdirSync(dest, { recursive: true });
  for (const [from, rel] of copies) {
    cpSync(from, join(dest, rel), { recursive: true, preserveTimestamps: true });
  }
  writeFileSync(
    join(dest, 'MTIMES.txt'),
    '# mtimes read from the grounds the trailing sweep was about to remove, BEFORE it ran\n' +
      '# (bead forge-8vfn.6.11.42). The mtime is what separates "written late" from\n' +
      '# "rendered late"; the JSON is identical either way.\n' +
      `${rows.sort().join('\n')}\n`,
  );
  return dest;
}

/**
 * The page's DOM at the moment a beat went red, written into the same place the
 * ground is read to.
 *
 * Ruling 356b asks for it beside the session files for one reason: the session
 * dir says what the PRODUCT had, and the DOM says what the OPERATOR could see.
 * S2 run 8's whole open question is the difference between those two, and no
 * amount of re-reading the JSON afterwards can supply the second half.
 *
 * Never load-bearing: a page that has already gone (a crashed browser, a closed
 * context) must not turn a recorded red into a crash.
 */
export async function captureBeatDom(page, root, storyId, index, act) {
  try {
    const dest = redEvidenceDir(root, storyId);
    mkdirSync(dest, { recursive: true });
    const html = await page.content();
    writeFileSync(join(dest, `beat-${index + 1}-dom.html`), `<!-- red beat ${index + 1}: ${act} -->\n${html}`);
    return join(dest, `beat-${index + 1}-dom.html`);
  } catch {
    return null; // evidence is never load-bearing
  }
}

/** The run's own words for what it read — printed whether or not it read anything (§15.92). */
export function describeRedEvidence(dir, root) {
  return dir === null
    ? []
    : [`[stories] red run: ground read into ${relative(root, dir)} BEFORE the sweep (bead 6.11.42) — session files + MTIMES.txt`];
}
