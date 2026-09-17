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
 * ANCHORS MUST BE CODE-SHAPED, and this cannot enforce it. The match is
 * `source.includes(anchor)`, and a COMMENT counts as a hit. Today that biases
 * safe: a comment mentioning moved code adds a second module and you get the
 * ambiguity refusal below, which is loud. The unsafe case is real though — if
 * code moves away and only a comment mentioning it remains behind, there is
 * exactly ONE hit, on prose, and this returns the wrong module for a door to
 * slice. `run.mjs`'s own seam comment names `run-story.mjs` and is exactly that
 * shape. So pick anchors carrying a `(` or an `=`: prose rarely contains them.
 * Said rather than checked, deliberately — a code-shaped-anchor rule would have
 * to guess which punctuation counts, and refusing a legitimate anchor to prevent
 * a hypothetical one is a worse trade than a sentence. It is a sentence and not
 * a mechanism, and the next author should know which of those they are relying
 * on (C, reviewing forge-0fli).
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
  return hits[0];
}
