#!/usr/bin/env node
/**
 * check-docs-shape.mjs — the Diátaxis shape + hand-written budget guard for docs/.
 *
 * Spec §4 "Docs" and §7 clause 4: `docs/` is four Diátaxis quadrants plus
 * three planning directories, and 1.0 caps the HAND-WRITTEN pages at 25.
 * Ruling 392 fixes what "hand-written" means, and this script is where that
 * definition lives — a rule moved out of prose, not a new bar.
 *
 * "prove-or-warn" style like scripts/check-adr-index.mjs: plain node, no deps,
 * fail = non-zero exit + one actionable line per violation.
 *
 * Rules:
 *   1. every docs/**\/*.md lives in one of the four quadrants
 *      (tutorials|how-to|reference|explanation) or the three planning
 *      directories (decisions|roadmaps|superpowers) or product/ — the one
 *      exception is docs/README.md, the index itself;
 *   2. HAND-WRITTEN = every docs/**\/*.md minus decisions/, roadmaps/,
 *      superpowers/ and product/, minus every file carrying `generated_from:`
 *      frontmatter (the story runner's output). That count is <= 25;
 *   3. a page under tutorials/ or how-to/ whose basename is a story id in
 *      tests/stories/*.story.mjs MUST carry `generated_from:
 *      tests/stories/<id>.story.mjs` — stripping the header is how a
 *      generated file would slip into the hand-written count;
 *   4. the index reaches everything, in two tiers:
 *      (a) every HAND-WRITTEN page is linked from docs/README.md DIRECTLY —
 *          with ~17 pages there is no excuse for a directory fallback;
 *      (b) every OTHER tracked file under docs/ (`git ls-files docs/`, which
 *          includes non-markdown: schemas, the archived overview.html) is
 *          covered directly OR by a directory-level mention.
 *      (b) is check-docs-claims.mjs's own rule, preserved verbatim in effect,
 *      because this check REPLACES that guard. Retiring it on (a) alone would
 *      have silently un-enforced four files — proved by deleting the index's
 *      schemas entry and watching this check stay green while the retired one
 *      went red. A fold is a fold only when the survivor fails on everything
 *      the retired guard failed on.
 *
 * Usage: node scripts/check-docs-shape.mjs [root]   (root defaults to the repo)
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(process.argv[2] ?? FORGE_ROOT);
const DOCS_DIR = join(root, 'docs');
const README_PATH = join(DOCS_DIR, 'README.md');
const STORIES_DIR = join(root, 'tests/stories');

/** The four Diátaxis quadrants — the shape the tree is FOR. */
const QUADRANTS = ['tutorials', 'how-to', 'reference', 'explanation'];
/** Planning + catalogue directories: outside the four AND outside the count (392). */
const UNCOUNTED = ['decisions', 'roadmaps', 'superpowers', 'product'];
/** The index is the one page allowed to sit at the top of docs/. */
const TOP_LEVEL_ALLOWED = 'README.md';
const HANDWRITTEN_CAP = 25;

function markdownFilesUnder(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...markdownFilesUnder(abs));
    else if (entry.endsWith('.md')) out.push(abs);
  }
  return out;
}

/** The frontmatter block's raw text, or '' when the file has none. */
function frontmatter(abs) {
  const text = readFileSync(abs, 'utf8');
  if (!text.startsWith('---\n')) return '';
  const end = text.indexOf('\n---', 4);
  return end === -1 ? '' : text.slice(4, end);
}

function frontmatterField(fm, name) {
  const m = fm.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : null;
}

/** Story ids the runner generates docs for, from the story files themselves. */
function storyIds() {
  if (!existsSync(STORIES_DIR)) return [];
  return readdirSync(STORIES_DIR)
    .filter((f) => f.endsWith('.story.mjs'))
    .map((f) => f.replace(/\.story\.mjs$/, ''));
}

/** Every markdown-link target in the index, './' stripped and '#anchor' dropped. */
function indexLinkTargets() {
  if (!existsSync(README_PATH)) return null;
  const text = readFileSync(README_PATH, 'utf8');
  const targets = new Set();
  const re = /\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(text))) {
    const t = m[1].trim().split('#')[0].replace(/^\.\//, '').replace(/^docs\//, '');
    if (t) targets.add(t);
  }
  return targets;
}

/** Every tracked file under docs/, as the retired guard enumerated them. */
function trackedDocsFiles(root_) {
  try {
    return execFileSync('git', ['ls-files', 'docs/'], { cwd: root_, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    return null; // not a git tree — rule 4b cannot run; reported by the caller
  }
}

/**
 * Directory-level cover, narrower than "the substring D/ appears somewhere":
 * a link to D/README.md, to the bare D/, or D/ as free-standing text. A link
 * to ONE file inside D must NOT be read as covering D — otherwise the second
 * file added there is silently unreachable, which is exactly the trap the
 * retired guard's own header documented.
 */
function directoriesMentioned(text) {
  const dirs = new Set();
  for (const m of text.matchAll(/\]\(([^)]+)\)/g)) {
    const t = m[1].trim().split('#')[0].replace(/^\.\//, '').replace(/^docs\//, '');
    if (t.endsWith('/')) dirs.add(t.slice(0, -1));
    else if (t.endsWith('/README.md')) dirs.add(t.slice(0, -'/README.md'.length));
  }
  for (const m of text.matchAll(/(?:^|[\s`(])([A-Za-z0-9._-]+)\/(?=[\s`),.]|$)/gm)) dirs.add(m[1]);
  return dirs;
}

function main() {
  const violations = [];

  if (!existsSync(DOCS_DIR)) {
    console.error('check-docs-shape: FAIL — no docs/ directory');
    process.exitCode = 1;
    return;
  }

  const files = markdownFilesUnder(DOCS_DIR)
    .map((abs) => ({ abs, rel: relative(root, abs).split('\\').join('/') }))
    .sort((a, b) => a.rel.localeCompare(b.rel));

  const ids = new Set(storyIds());
  const handwritten = [];
  const generatedRels = [];

  for (const file of files) {
    const parts = file.rel.split('/'); // docs/<a>/<b>...
    const top = parts.length === 2 ? null : parts[1];

    // Rule 1 — location.
    if (top === null) {
      if (parts[1] !== TOP_LEVEL_ALLOWED) {
        violations.push(
          `${file.rel} lives outside the Diátaxis tree — the only page allowed at the top of docs/ is docs/${TOP_LEVEL_ALLOWED}; move it into one of ${QUADRANTS.join('|')} (or ${UNCOUNTED.join('|')})`,
        );
      }
    } else if (!QUADRANTS.includes(top) && !UNCOUNTED.includes(top)) {
      violations.push(
        `${file.rel} lives outside the Diátaxis tree — docs/${top}/ is not one of ${QUADRANTS.join('|')} (or ${UNCOUNTED.join('|')})`,
      );
    }

    const fm = frontmatter(file.abs);
    const generatedFrom = frontmatterField(fm, 'generated_from');

    // Rule 3 — a story's page carries the story's own header.
    if (top !== null && (top === 'tutorials' || top === 'how-to')) {
      const id = basename(file.rel, '.md');
      if (ids.has(id)) {
        const expected = `tests/stories/${id}.story.mjs`;
        if (!generatedFrom) {
          violations.push(
            `${file.rel} is story ${id}'s generated page but carries no \`generated_from:\` header — restore it by re-running \`npm run stories -- --story ${id}\`; a generated page is never hand-written and never counted`,
          );
        } else if (generatedFrom !== expected) {
          violations.push(
            `${file.rel} is story ${id}'s page but its \`generated_from:\` says "${generatedFrom}" — it must say "${expected}"`,
          );
        }
      }
    }

    // Rule 2 — the hand-written set.
    if (top !== null && UNCOUNTED.includes(top)) continue;
    if (generatedFrom) { generatedRels.push(file.rel); continue; }
    handwritten.push(file.rel);
  }

  // Rule 4 — the index links every hand-written page.
  const targets = indexLinkTargets();
  if (targets === null) {
    violations.push('docs/README.md is missing — it is the index every hand-written page is reached from');
  } else {
    for (const rel of handwritten) {
      const fromDocs = rel.replace(/^docs\//, '');
      if (fromDocs === TOP_LEVEL_ALLOWED) continue; // the index need not link itself
      if (!targets.has(fromDocs)) {
        violations.push(`${rel} is not linked from docs/README.md — every hand-written page is reachable from the index`);
      }
    }
  }

  // Rule 4b — everything else tracked under docs/, directly or by its directory.
  let coveredCount = 0;
  const tracked = trackedDocsFiles(root);
  if (tracked === null) {
    violations.push('cannot enumerate tracked docs files (`git ls-files docs/` failed) — rule 4 cannot be proven');
  } else if (targets !== null) {
    const handwrittenSet = new Set(handwritten);
    const dirs = directoriesMentioned(readFileSync(README_PATH, 'utf8'));
    const generatedSet = new Set(generatedRels);
    for (const rel of tracked) {
      if (handwrittenSet.has(rel)) continue;            // 4a already required a direct link
      if (generatedSet.has(rel)) continue;              // the story runner's, listed by its quadrant README
      if (rel === 'docs/README.md') continue;
      coveredCount++;
      const fromDocs = rel.replace(/^docs\//, '');
      if (targets.has(fromDocs)) continue;
      const top = fromDocs.includes('/') ? fromDocs.split('/')[0] : null;
      if (top && dirs.has(top)) continue;
      violations.push(`${rel} is not covered by docs/README.md — link it, or mention its directory`);
    }
  }

  // Rule 2's verdict, last so the count is the line a reader ends on.
  const summary = `hand-written ${handwritten.length} (cap ${HANDWRITTEN_CAP})`;
  if (handwritten.length > HANDWRITTEN_CAP) {
    violations.push(
      `${summary} — the 1.0 budget (spec §7 clause 4) is ${HANDWRITTEN_CAP} hand-written pages; cut or merge ${handwritten.length - HANDWRITTEN_CAP} more`,
    );
  }

  if (violations.length) {
    console.error(`check-docs-shape: FAIL (${violations.length} violation${violations.length === 1 ? '' : 's'}) — ${summary}`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    // `process.exitCode` + `return`, never `process.exit()`: the violation list
    // is unbounded and `process.exit()` tears the process down before a piped
    // stdout has drained (see check-raw-fs-guarded.mjs).
    process.exitCode = 1;
    return;
  }

  console.log(
    `check-docs-shape: PASS — ${files.length} docs pages, ${summary}, ${ids.size} story ids generated, index links every hand-written page, ${coveredCount} tracked docs files covered`,
  );
}

main();
