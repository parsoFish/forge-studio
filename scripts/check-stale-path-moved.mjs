import { existsSync } from 'node:fs';
import { join } from 'node:path';

// MOVED paths — a citation held by a file its owner has not yet amended (used by check-stale-path-citations.mjs).

/** Who owns a citing file, by path prefix. A mapped row only forgives citations from its owner. */
const OWNER_PREFIXES = { stories: ['tests/stories/', 'scripts/stories/'] };

/** Rows are added only by PR; --write never adds one. */
export const MOVED_PATHS = [
  { old: 'docs/reference/studio-dom-contract.md', new: 'dev/studio-dom-contract.md', owner: 'stories', retire: "the story's next amendment or recorded run" },
];

/** The MOVED count today; a count above it fails. Lower it as stories are amended. */
export const MOVED_BASELINE = 19;

/**
 * Splits `findings` into the ones a MOVED row forgives (owner's files citing
 * `old`) and the rest, and checks the table itself: every `new` target must
 * exist, no `old` may exist again, and the count may not exceed the baseline.
 */
export function applyMoved(root, findings, table) {
  const rows = table.rows;
  const moved = [];
  const rest = [];
  for (const f of findings) {
    const row = f.kind === 'path' ? rows.find((r) => r.old === f.cited) : undefined;
    const owned = row && (OWNER_PREFIXES[row.owner] ?? []).some((pre) => f.file.startsWith(pre));
    (owned ? moved : rest).push(f);
  }
  const problems = [];
  for (const r of rows) {
    if (!existsSync(join(root, r.new))) problems.push(`MOVED target missing: ${r.new} (mapped from ${r.old})`);
    if (existsSync(join(root, r.old))) problems.push(`MOVED old path exists again: ${r.old} — drop its row`);
  }
  if (moved.length > table.baseline) problems.push(`MOVED (${moved.length}) exceeds baseline ${table.baseline}`);
  return { moved, rest, problems };
}
