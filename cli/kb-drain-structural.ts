/**
 * kb-drain-structural.ts (W7-B2, orch-01) — the pure classification core of
 * the drain's STRUCTURAL-ONLY auto-apply rule.
 *
 * The wave-7 walkthrough caught Drain-to-green's brain-fix agent
 * lossy-rewriting theme PROSE to clear lint flags (S1 orch-01:
 * brain/forge-dev/themes/brain-read-policy.md silently lost 26 lines of
 * amendment history, no diff, no approval, no undo). The rule this module
 * encodes, enforced in CODE at the drain's own call site (never merely asked
 * of the agent prompt — declared-data-fails-open):
 *
 *   A drain-dispatched agent fix may land directly ONLY when every byte it
 *   changed is STRUCTURAL — frontmatter (fields, related_themes, keywords),
 *   markdown/wikilink TARGETS, or an index/category page. Any change to body
 *   prose is reverted and re-emitted as a kb-cleanup DRAFT session carrying
 *   a reviewable diff the operator approves.
 *
 * Everything here is a pure function over strings/paths (plus two thin fs
 * walkers) so the classification matrix is directly unit-testable
 * (cli/kb-drain-structural.test.ts).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export type KbEditClass = 'structural' | 'prose';

/** Index/category pages (KB-root level) whose whole PURPOSE is structural
 *  listings — an edit there is never prose. Mirrors
 *  `KB_OWN_THEME_INDEX_FILES` (cli/kb-lint-summary.ts) plus the brain
 *  meta-index name. `README.md` is included at ANY depth (themes/README.md
 *  is a listing page too). */
const INDEX_PAGE_NAMES = new Set([
  'README.md',
  'INDEX.md',
  'patterns.md',
  'antipatterns.md',
  'operations.md',
  'decisions.md',
  'reference.md',
  'profile.md',
]);

/** Split a raw markdown file into its YAML frontmatter block (including the
 *  `---` fences) and the body after it. No frontmatter → `fm: ''`. */
export function splitFrontmatter(raw: string): { fm: string; body: string } {
  if (!raw.startsWith('---')) return { fm: '', body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { fm: '', body: raw };
  const bodyStart = raw.indexOf('\n', end + 1);
  if (bodyStart === -1) return { fm: raw, body: '' };
  return { fm: raw.slice(0, bodyStart + 1), body: raw.slice(bodyStart + 1) };
}

/** Replace every markdown link TARGET and wikilink TARGET with a fixed
 *  placeholder, so two bodies that differ ONLY in where their links point
 *  normalize to the same string. Link TEXT (the part a reader reads) is
 *  prose and is deliberately NOT normalized away. */
export function normalizeLinkTargets(body: string): string {
  return body
    .replace(/\]\(([^)\n]*)\)/g, '](#)')
    .replace(/\[\[([^\]\n]+)\]\]/g, '[[#]]');
}

/**
 * Classify one file's change. `before === null` = the file was created;
 * `after === null` = deleted. Deciding rule (see module header):
 *   - index/category pages → structural (creating one included);
 *   - created or deleted theme files → prose (a drain fix never silently
 *     adds or removes a theme);
 *   - frontmatter-only change → structural;
 *   - body change that is link-target-only → structural;
 *   - anything else → prose.
 */
export function classifyKbEdit(relPath: string, before: string | null, after: string | null): KbEditClass {
  if (INDEX_PAGE_NAMES.has(basename(relPath))) return 'structural';
  if (before === null || after === null) return 'prose';
  const b = splitFrontmatter(before);
  const a = splitFrontmatter(after);
  if (b.body === a.body) return 'structural';
  if (normalizeLinkTargets(b.body) === normalizeLinkTargets(a.body)) return 'structural';
  return 'prose';
}

// ---------------------------------------------------------------------------
// Snapshot / diff-detection walkers
// ---------------------------------------------------------------------------

/** All `.md` files under `brainDir` (recursive), keyed by path relative to
 *  `brainDir`, values = full content. `brainDir` is ALWAYS a resolved,
 *  trusted dir (`resolveKbBrainDir`'s return) — never request-derived text.
 *  Symlinked subdirectories are not followed (`withFileTypes` reports the
 *  link itself). */
export function snapshotKbMarkdown(brainDir: string): Map<string, string> {
  const snapshot = new Map<string, string>();
  const walk = (dir: string, rel: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), childRel);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      try {
        snapshot.set(childRel, readFileSync(join(dir, entry.name), 'utf8'));
      } catch {
        // TOCTOU unlink between readdir and read — treat as absent.
      }
    }
  };
  walk(brainDir, '');
  return snapshot;
}

export type KbEditChange = {
  relPath: string;
  before: string | null;
  after: string | null;
  klass: KbEditClass;
};

/** Compare the current on-disk state of `brainDir` against a prior
 *  `snapshotKbMarkdown` capture; one entry per changed/created/deleted `.md`
 *  file, each classified. */
export function diffKbSnapshot(brainDir: string, snapshot: Map<string, string>): KbEditChange[] {
  const current = snapshotKbMarkdown(brainDir);
  const changes: KbEditChange[] = [];
  for (const [relPath, after] of current) {
    const before = snapshot.get(relPath) ?? null;
    if (before === after) continue;
    changes.push({ relPath, before, after, klass: classifyKbEdit(relPath, before, after) });
  }
  for (const [relPath, before] of snapshot) {
    if (current.has(relPath)) continue;
    changes.push({ relPath, before, after: null, klass: classifyKbEdit(relPath, before, null) });
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Minimal unified-ish diff (for the operator-reviewable draft plan)
// ---------------------------------------------------------------------------

/**
 * Plain LCS line diff rendered in unified style (`-`/`+`/` ` prefixed lines,
 * one `---`/`+++` header). Purpose-built for the kb-cleanup draft plan's
 * ```diff fence — theme files are lint-capped at 800 lines, so the O(n·m) DP
 * is bounded and no dependency is warranted for a display-only diff.
 */
export function buildUnifiedDiff(label: string, before: string, after: string): string {
  const a = before.split('\n');
  const b = after.split('\n');
  // LCS length table.
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lines: string[] = [`--- a/${label}`, `+++ b/${label}`];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push(` ${a[i]}`);
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push(`-${a[i]}`);
      i++;
    } else {
      lines.push(`+${b[j]}`);
      j++;
    }
  }
  while (i < n) { lines.push(`-${a[i]}`); i++; }
  while (j < m) { lines.push(`+${b[j]}`); j++; }
  return lines.join('\n');
}
