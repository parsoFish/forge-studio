#!/usr/bin/env node
/**
 * check-docs-claims.mjs — docs/README.md coverage guard for docs/.
 *
 * Rule: every file tracked under docs/ (via `git ls-files docs/`) must be
 * MENTIONED in docs/README.md. "prove-or-warn" style like
 * scripts/verify-cycle.mjs's gates: plain node, no deps, fail = non-zero
 * exit + one actionable line per uncovered file.
 *
 * Mention-matching rules (deliberately two-tier, so the index doesn't have
 * to enumerate 30+ ADRs one by one — the wrong bar — but a lone loose file
 * can't hide):
 *
 *   - FILE-LEVEL mention: the file's path relative to docs/ (e.g.
 *     "gate-script-template.md" or "operations/serve-supervision.md")
 *     appears as a markdown-link target, or verbatim in the README text.
 *     Every top-level loose file (no subdirectory) MUST have one of these —
 *     there is no directory to fall back on.
 *
 *   - DIRECTORY-LEVEL mention: a nested file (path contains "/") is also
 *     covered if its top-level directory, call it D, is mentioned as a
 *     *directory* rather than as one specific file inside it — either a
 *     link to D's own index page (D/README.md), a link to the bare
 *     directory (D/), or D/ appearing as free-standing text (not as a
 *     prefix of a longer specific-file path). This is intentionally
 *     narrower than "the substring D/ appears anywhere": a link to
 *     ./operations/serve-supervision.md must NOT be read as covering all of
 *     operations/ — only that one file — so a second file added later under
 *     operations/ (e.g. headroom-token-efficiency-trial.md) still needs its
 *     own mention. Linking to decisions/README.md (its own index), by
 *     contrast, legitimately covers every docs/decisions/*.md file.
 *
 * Usage: node scripts/check-docs-claims.mjs
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_README = join(FORGE_ROOT, 'docs/README.md');

function trackedDocsFiles() {
  const out = execFileSync('git', ['ls-files', 'docs/'], { cwd: FORGE_ROOT, encoding: 'utf8' });
  return out
    .split('\n')
    .filter(Boolean)
    .map((p) => p.replace(/^docs\//, ''))
    .filter((p) => p !== 'README.md'); // the index doesn't need to mention itself
}

/** Every markdown-link target `](target)` in the text, "./" stripped and any
 *  "#anchor" dropped. */
function extractLinkTargets(text) {
  const targets = [];
  const re = /\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(text))) {
    let t = m[1].trim().split('#')[0];
    if (t.startsWith('./')) t = t.slice(2);
    if (t) targets.push(t);
  }
  return targets;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True if "D/" appears in the text as a free-standing directory reference
 *  (preceded by start-of-line/whitespace/paren/backtick, followed by
 *  whitespace/close-paren/backtick/period/end-of-line) rather than as the
 *  prefix of a longer specific-file path like "D/some-file.md". */
function hasBareDirMention(text, dir) {
  const re = new RegExp('(^|[\\s(`])' + escapeRegExp(dir) + '/(?=[\\s)`.]|$)', 'm');
  return re.test(text);
}

function main() {
  const violations = [];
  const files = trackedDocsFiles();
  const readmeText = readFileSync(DOCS_README, 'utf8');
  const linkTargets = new Set(extractLinkTargets(readmeText));

  const dirMentionCache = new Map();
  function isDirectoryMentioned(dir) {
    if (!dirMentionCache.has(dir)) {
      const mentioned =
        linkTargets.has(`${dir}/README.md`) ||
        linkTargets.has(`${dir}/`) ||
        hasBareDirMention(readmeText, dir);
      dirMentionCache.set(dir, mentioned);
    }
    return dirMentionCache.get(dir);
  }

  for (const relPath of files) {
    const fileLevelMention = linkTargets.has(relPath) || readmeText.includes(relPath);
    if (fileLevelMention) continue;

    const slash = relPath.indexOf('/');
    if (slash !== -1 && isDirectoryMentioned(relPath.slice(0, slash))) continue;

    violations.push(`docs/${relPath}`);
  }

  if (violations.length) {
    console.error(`check-docs-claims: FAIL (${violations.length} file${violations.length === 1 ? '' : 's'} not mentioned in docs/README.md)`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    console.error('Add a one-line entry to docs/README.md — either a direct link to the file, or (for a new subdirectory) a link to its own <dir>/README.md to cover the whole directory.');
    process.exit(1);
  }

  console.log(`check-docs-claims: PASS — ${files.length} tracked docs files, all mentioned in docs/README.md (directly or via a directory-level mention)`);
}

main();
