/**
 * runner-source.mjs — read the runner module that CONTAINS a given anchor,
 * rather than the one that happened to contain it when a door was written.
 *
 * WHY THIS EXISTS. Three doors broke on `forge-0fli`'s split and none of them
 * was about the split: `7.6.51` and `7.6.52` (spend.test.ts) and `7.6.74`
 * (queue-claim.test.ts) each did `readFileSync('./run.mjs')` and then sliced
 * out the beat loop. The beat loop moved to `run-story.mjs` and all three went
 * red without a behaviour changing — the second time this exact class has been
 * paid for here. `7.6.51`'s own comment records the first: it used to match
 * `spendCeilingVerdict(` at a call site, went red when `forge-rzrs` moved that
 * call into `run-observe.mjs`, and was rewritten to follow the CHAIN instead
 * of the location. The filename was the one location left pinned.
 *
 * So: a door names the PROPERTY and the anchor that identifies its code, and
 * this resolves which module holds it today.
 *
 * ANCHORS SHOULD STILL BE CODE-SHAPED — pick one carrying a `(` or an `=`;
 * prose rarely contains them — and this still cannot enforce THAT: a
 * code-shaped-anchor rule would have to guess which punctuation counts, and
 * refusing a legitimate anchor to prevent a hypothetical one is a worse trade
 * than leaving it said rather than checked (C, reviewing `forge-0fli`).
 *
 * WHAT IS NOW CHECKED (`forge-8vfn.7.6.112`) is the sharper, DECIDABLE half of
 * the same hazard. The match is `source.includes(anchor)`, and a COMMENT
 * counts as a hit exactly like code does. Two modules hitting already refuses
 * below, loudly — but one hit that happens to sit on a comment is silent: if
 * code carrying an anchor moves away and only a comment naming it stays
 * behind, there is exactly ONE hit, on prose, and this used to return that
 * module for a door to slice. `run.mjs`'s own seam comment naming
 * `run-story.mjs` is exactly that shape. So `everyHitIsCommentShaped` below
 * refuses whenever EVERY line carrying the anchor in the winning module is
 * comment-shaped (left-trimmed `//`, `*`, `/*`) — never a guess about what
 * code looks like, only whether a line is one of the two comment forms this
 * tree uses. A legitimate anchor always keeps at least one non-comment hit,
 * so nothing that resolves today stops resolving.
 *
 * IT REFUSES RATHER THAN GUESSING, in both directions (§15.504). No module
 * containing the anchor means the door cannot run — which is not the same as
 * the property being absent, and a door that silently read an empty string
 * would assert nothing and pass. More than one means the anchor is ambiguous
 * and a slice would be taken from whichever file sorted first, which is how a
 * pattern ends up asserting a relationship it never required.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The runner's own modules: every `.mjs` in `scripts/stories/`. Enumerated
 *  from the DIRECTORY, not from a list — a list is the thing that goes stale
 *  when a file is added, which is the defect this file exists to stop. */
export function runnerModules(dir = HERE) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.mjs'))
    .sort()
    .map((f) => join(dir, f))
    // A DIRECTORY named `x.mjs` would otherwise reach `readFileSync` and throw
    // EISDIR — an unnamed failure from the one function whose argument is that
    // enumerating beats keeping a list. Enumeration is where that surprise
    // lives, so it is checked here (C, reviewing forge-0fli).
    .filter((p) => statSync(p).isFile());
}

/**
 * True when EVERY line of `source` containing `anchor`, left-trimmed, opens
 * with a comment marker (`//`, `*`, `/*`). `forge-8vfn.7.6.112` — C's
 * mechanism, which does not guess whether an anchor "looks like code": it
 * only asks whether every hit sits on one of the two comment shapes this tree
 * uses, which is mechanically decidable. A legitimate anchor always has at
 * least one non-comment hit, so this never fires on an anchor that works
 * today; it fires exactly on the hazard the header above names — code moves
 * away, a comment naming it stays behind, and there is exactly one hit, on
 * prose.
 */
function everyHitIsCommentShaped(source, anchor) {
  const hitLines = source.split('\n').filter((line) => line.includes(anchor));
  return hitLines.length > 0 && hitLines.every((line) => /^(\/\/|\*|\/\*)/.test(line.trimStart()));
}

/**
 * The source of the single runner module containing `anchor`.
 * @param {string} anchor a literal substring that identifies the code
 * @returns {{ path: string, source: string }}
 */
export function runnerSourceContaining(anchor, dir = HERE) {
  const hits = runnerModules(dir)
    .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
    .filter(({ source }) => source.includes(anchor));
  if (hits.length === 0) {
    throw new Error(
      `runnerSourceContaining: no module under ${dir} contains ${JSON.stringify(anchor)} — `
        + 'the door cannot run, which is not the same as the property being absent',
    );
  }
  if (hits.length > 1) {
    throw new Error(
      `runnerSourceContaining: ${JSON.stringify(anchor)} is in ${hits.length} modules `
        + `(${hits.map((h) => h.path.split('/').pop()).join(', ')}) — ambiguous, so a slice `
        + 'would be taken from whichever sorted first',
    );
  }
  const [winner] = hits;
  if (everyHitIsCommentShaped(winner.source, anchor)) {
    throw new Error(
      `runnerSourceContaining: ${JSON.stringify(anchor)} in ${winner.path.split('/').pop()} is on `
        + 'comment-shaped lines only — every occurrence is prose, not code, so this refuses rather '
        + 'than slicing a door from a comment (forge-8vfn.7.6.112)',
    );
  }
  return winner;
}
