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
 *   markdown/wikilink TARGETS, or the body of an EXISTING index/category
 *   page. Any change to body prose — and any file created, deleted, or
 *   written outside the markdown corpus at all — is reverted and re-emitted
 *   as a kb-cleanup DRAFT session carrying a reviewable diff the operator
 *   approves.
 *
 * "Every byte" is meant literally: the walkers below snapshot EVERY file
 * under the KB's brain dir, not just `*.md`, so a `kb.yaml` rewrite or a
 * stray non-markdown file cannot slip past the gate unseen.
 *
 * Everything here is a pure function over strings/paths (plus two thin fs
 * walkers) so the classification matrix is directly unit-testable
 * (packages/knowledge/tests/unit/kb-drain-structural.test.ts).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export type KbEditClass = 'structural' | 'prose';

/** Index/category pages (KB-root level) whose whole PURPOSE is structural
 *  listings — an edit there is never prose. Mirrors
 *  `KB_OWN_THEME_INDEX_FILES` (packages/knowledge/kb-lint-summary.ts) plus the brain
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
 *  prose and is deliberately NOT normalized away.
 *
 *  A wikilink's ALIAS — the half after `|` in `[[target|alias]]` — is link
 *  TEXT, not a target, and is preserved for exactly that reason (W7-B2
 *  code-review round). Collapsing the whole `[[…]]` body let an agent invert
 *  a sentence's MEANING behind an unchanged target
 *  (`[[x|never reads the brain]]` → `[[x|reads allowed]]`) and have it
 *  classify 'structural', landing ungated. */
export function normalizeLinkTargets(body: string): string {
  return body
    .replace(/\]\(([^)\n]*)\)/g, '](#)')
    .replace(/\[\[([^\]\n]+)\]\]/g, (_match, inner: string) => {
      const bar = inner.indexOf('|');
      return bar === -1 ? '[[#]]' : `[[#|${inner.slice(bar + 1)}]]`;
    });
}

/**
 * Classify one file's change. `before === null` = the file was created;
 * `after === null` = deleted. Deciding rule (see module header), IN ORDER:
 *   - created or deleted file → prose, whatever its name (a drain fix never
 *     silently adds or removes a file — index/category pages INCLUDED: the
 *     listing pages are curated, with ordering and annotations no agent can
 *     re-derive, so their deletion is the most destructive edit of the lot);
 *   - MODIFIED index/category page → structural (that is what those pages
 *     are for);
 *   - frontmatter-only change → structural;
 *   - body change that is link-target-only → structural;
 *   - anything else → prose.
 *
 * Order is load-bearing (W7-B2 code-review round): the index-page rule used
 * to run FIRST, so deleting `patterns.md` classified 'structural' and landed
 * unattended with no draft, no approval and no undo.
 */
export function classifyKbEdit(relPath: string, before: string | null, after: string | null): KbEditClass {
  if (before === null || after === null) return 'prose';
  if (INDEX_PAGE_NAMES.has(basename(relPath))) return 'structural';
  const b = splitFrontmatter(before);
  const a = splitFrontmatter(after);
  if (b.body === a.body) return 'structural';
  if (normalizeLinkTargets(b.body) === normalizeLinkTargets(a.body)) return 'structural';
  return 'prose';
}

// ---------------------------------------------------------------------------
// Snapshot / diff-detection walkers
// ---------------------------------------------------------------------------

/** EVERY regular file under `brainDir` (recursive), keyed by path relative to
 *  `brainDir`, values = full content. `brainDir` is ALWAYS a resolved,
 *  trusted dir (`resolveKbBrainDir`'s return) — never request-derived text.
 *  Symlinked subdirectories are not followed (`withFileTypes` reports the
 *  link itself).
 *
 *  ALL files, not just `*.md` (W7-B2 code-review round). A `*.md`-only walk
 *  left the gate blind to every non-markdown byte an agent turn could write:
 *  a `kb.yaml` rewrite (the KB's own identity, binding and consolidate
 *  obligation — more dangerous than any theme prose) or a stray file dropped
 *  into the tree produced ZERO detected changes and landed completely
 *  ungated. That directly contradicts this module's own declared rule — a fix
 *  may land only when EVERY BYTE it changed is structural, enforced in code —
 *  which is the declared-data-fails-open shape the rule exists to prevent.
 *
 *  Content is read as utf8 because the gate's whole job is comparing and, on
 *  a prose verdict, RESTORING text; a brain dir holds markdown, YAML and
 *  JSONL by contract. A binary an agent writes into one is out of contract
 *  and is gated (detected → reverted) rather than silently allowed.
 *
 *  DO NOT make this lazy on `(mtime, size)`. It is the obvious optimisation
 *  and it is wrong twice over: the BEFORE side must hold real bytes or a
 *  prose verdict has nothing to restore from, and `(mtime, size)` is not a
 *  sound change oracle for a gate whose whole purpose is catching a rewrite —
 *  a same-size rewrite inside one filesystem mtime tick reads as unchanged
 *  and lands ungated. Correctness over IO here, deliberately. */
export function snapshotKbFiles(brainDir: string): Map<string, string> {
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
      if (!entry.isFile()) continue;
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
 *  `snapshotKbFiles` capture; one entry per changed/created/deleted file,
 *  each classified. */
export function diffKbSnapshot(brainDir: string, snapshot: Map<string, string>): KbEditChange[] {
  const current = snapshotKbFiles(brainDir);
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
