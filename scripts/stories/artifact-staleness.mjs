/**
 * artifact-staleness.mjs — NAMES a committed demo artifact whose story file
 * has moved on since the artifact was written; NEVER reds.
 *
 * Findings row 56 + row 14, T1 ruling 1283 (option B). `writeStoryJson`
 * (`gallery.mjs`) stamps each `demos/stories/<id>/story.json` with a
 * `storyDigest` — sha256(hex, first 16) of the `tests/stories/<id>.story.mjs`
 * bytes that produced it (`shortDigest`, exported here so both sides of the
 * comparison use the IDENTICAL derivation and can never disagree about what a
 * digest of the same bytes is).
 */
import { createHash } from 'node:crypto';

/** sha256, hex, first 16 chars. THE ONE PLACE this derivation lives — both
 *  `writeStoryJson` (the write side) and this module's own staleness check
 *  (the read side) import it from here, so a digest computed today always
 *  agrees with one computed tomorrow from byte-identical input. */
export function shortDigest(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}
