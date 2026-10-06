#!/usr/bin/env node
/**
 * docs-covers.mjs — maps changed repo paths to the published pages whose
 * frontmatter `covers:` globs match them.
 *
 * A page declares the code it describes as a flow sequence on one line:
 *   covers: [packages/flows/**, apps/forge/cli.ts]
 * Globs follow check-test-discovery's `globToRegExp` (`*` stops at `/`, `**`
 * crosses it, `{a,b}` alternates).
 *
 * Used by the docs-impact Stop hook, the docs-drift skill and the gardening
 * script. CLI: `node scripts/docs-covers.mjs [--root <dir>] <path>…` prints one
 * `<page>\t<path>` line per match and exits 0; a path no page covers prints
 * nothing. Exit 1 = a page was unreadable or a `covers:` line is malformed ·
 * 2 = usage.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { splitFrontmatter } from './check-docs-budget.mjs';
import { globToRegExp } from './check-test-discovery.mjs';

export const SITE_PAGES = 'apps/docs/src/content/docs';

/** `[a, b]` → ['a', 'b']. A bare scalar is one glob. Throws on an unclosed list. */
export function parseCovers(value) {
  const v = String(value ?? '').trim();
  if (v === '') return [];
  if (v.startsWith('[')) {
    if (!v.endsWith(']')) throw new Error(`malformed covers: ${v}`);
    return v
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }
  return [v.replace(/^["']|["']$/g, '')];
}

function walk(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (/\.mdx?$/.test(ent.name)) out.push(full);
  }
  return out;
}

/** Every site page with a `covers:` line: [{ page, globs, generated }]. */
export function readCoversMap(root) {
  const pages = [];
  for (const file of walk(join(root, SITE_PAGES))) {
    const { frontmatter } = splitFrontmatter(readFileSync(file, 'utf8'));
    if (frontmatter.covers === undefined) continue;
    const page = relative(root, file).split(sep).join('/');
    let globs;
    try {
      globs = parseCovers(frontmatter.covers);
    } catch (e) {
      throw new Error(`${page}: ${e.message}`);
    }
    pages.push({ page, globs, generated: Boolean(frontmatter.generated_from) });
  }
  return pages.sort((a, b) => (a.page < b.page ? -1 : 1));
}

/** [{ page, paths }] for every page at least one of `paths` matches, in page order. */
export function pagesCovering(coversMap, paths) {
  const hits = [];
  for (const { page, globs, generated } of coversMap) {
    const res = globs.map(globToRegExp);
    const matched = paths.filter((p) => res.some((re) => re.test(p)));
    if (matched.length > 0) hits.push({ page, paths: matched, generated });
  }
  return hits;
}

/** A path that is itself published documentation (an edit there IS a docs update). */
export function isDocsPath(p) {
  return p.startsWith('apps/docs/src/content/') || p.startsWith('apps/docs/public/');
}

function main(argv) {
  let root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const paths = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' && argv[i + 1] !== undefined) root = resolve(argv[++i]);
    else if (argv[i].startsWith('--')) {
      process.stderr.write('usage: node scripts/docs-covers.mjs [--root <dir>] <path>…\n');
      process.exitCode = 2;
      return;
    } else paths.push(argv[i]);
  }
  let map;
  try {
    map = readCoversMap(root);
  } catch (e) {
    process.stderr.write(`docs-covers: ${e.message}\n`);
    process.exitCode = 1;
    return;
  }
  for (const { page, paths: ps } of pagesCovering(map, paths)) {
    for (const p of ps) process.stdout.write(`${page}\t${p}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
