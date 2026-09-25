/**
 * artifact-staleness.mjs — NAMES a committed demo artifact whose story file
 * has moved on since the artifact was written; NEVER reds.
 *
 * Findings row 56 + row 14, T1 ruling 1283 (option B). `writeStoryJson`
 * (`gallery.mjs`) stamps each `demos/stories/<id>/story.json` with a
 * `storyDigest` — sha256(hex, first 16) of the `tests/stories/<id>.story.mjs`
 * bytes that produced it (`shortDigest`, exported here so both sides of the
 * comparison use the IDENTICAL derivation and can never disagree about what a
 * digest of the same bytes is). This module is the READ side: given a
 * checkout, which committed artifacts no longer match the story file that
 * would (re)produce them.
 *
 * WHY THIS NEVER REDS. Every artifact committed BEFORE this bead has no
 * `storyDigest` at all — that is every entry in `demos/stories/` as of this
 * PR. Making that a gate would fail every existing story at once for a change
 * nobody made to the story itself; T1 ruling 1283 chose option B: NAME the
 * gap (`no digest — recorded before provenance`) so an operator can see it and
 * decide, rather than block the pipeline on it. The CLI at the bottom of this
 * file is the same shape: it always exits 0.
 *
 * PURE. `staleArtifacts` reads only the tree at `root` — no git, no network —
 * so a CI step, a unit test and an operator's own terminal see the identical
 * answer for the identical tree.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const STORY_FILE_SUFFIX = '.story.mjs';

/** sha256, hex, first 16 chars. THE ONE PLACE this derivation lives — both
 *  `writeStoryJson` (the write side) and this module's own staleness check
 *  (the read side) import it from here, so a digest computed today always
 *  agrees with one computed tomorrow from byte-identical input. */
export function shortDigest(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

/**
 * Every `tests/stories/<id>.story.mjs` whose committed
 * `demos/stories/<id>/story.json` no longer matches it.
 *
 * @param {string} root
 * @returns {ReadonlyArray<{id: string, reason: string}>} empty when nothing
 *   is stale, or when `root` has no `tests/stories/` at all (a fixture tree
 *   with none is not a finding — there is nothing to compare).
 */
export function staleArtifacts(root) {
  const storiesDir = join(root, 'tests', 'stories');
  if (!existsSync(storiesDir)) return Object.freeze([]);

  const out = [];
  for (const entry of readdirSync(storiesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(STORY_FILE_SUFFIX)) continue;
    const id = entry.name.slice(0, -STORY_FILE_SUFFIX.length);
    const artifactPath = join(root, 'demos', 'stories', id, 'story.json');
    if (!existsSync(artifactPath)) continue; // never run (or never committed) — nothing to call stale

    let artifact;
    try {
      artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
    } catch (err) {
      out.push({ id, reason: `story.json is not readable JSON — ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }

    const recorded = artifact?.storyDigest;
    if (typeof recorded !== 'string' || recorded === '') {
      out.push({ id, reason: 'no digest — recorded before provenance' });
      continue;
    }

    const current = shortDigest(readFileSync(join(storiesDir, entry.name)));
    if (recorded !== current) {
      const sha = artifact?.git?.sha;
      out.push({ id, reason: `stale since ${typeof sha === 'string' && sha !== '' ? sha : 'unknown'}` });
    }
  }
  return Object.freeze(out.map((r) => Object.freeze(r)));
}

function renderTable(stale) {
  if (stale.length === 0) {
    return '[stories] artifact-staleness: every committed story artifact matches its story file.';
  }
  const rows = stale.map(({ id, reason }) => `  ${id.padEnd(24)} ${reason}`).join('\n');
  return (
    `[stories] artifact-staleness: ${stale.length} stale artifact(s) — a NAME, not a gate ` +
    `(T1 ruling 1283):\n${rows}`
  );
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function main() {
  console.log(renderTable(staleArtifacts(ROOT)));
  // ALWAYS 0 — this function NAMES staleness, it never judges it.
  process.exit(0);
}

// Runs only when invoked directly (`node scripts/stories/artifact-staleness.mjs`),
// never on import — a test importing `staleArtifacts` must not also exit the
// test process.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
