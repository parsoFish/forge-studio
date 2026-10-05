#!/usr/bin/env node
/**
 * check-docs-budget.mjs — reports prose words per documentation page against
 * the R22 per-type ceilings.
 *
 * The numbers in CEILINGS are CEILINGS, never targets: a page is finished when
 * it says what the reader needs, and most pages should land well under their
 * ceiling. The report exists to surface the pages that are heavy, not to
 * reward length.
 *
 * REPORT-ONLY for now: `--report` always exits 0 whatever it finds. A later
 * workstream decides whether it becomes blocking.
 *
 * What counts as a word: prose only. Frontmatter, fenced and indented code,
 * GFM tables, MDX import/export lines, HTML/MDX tags (their inner text stays),
 * HTML comments, images and link URLs are stripped first; an inline code span
 * counts as one word. A word is a run of non-whitespace holding at least one
 * letter or digit, so a lone `-` or an em dash is not a word.
 *
 * Usage: node scripts/check-docs-budget.mjs --report [--root <dir>]
 *   root defaults to the repo. Walks docs/**\/*.md and
 *   apps/docs/src/content/**\/*.{md,mdx}.
 * Exit: 0 report printed · 1 a page was unreadable · 2 bad usage.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CEILINGS = Object.freeze({
  guide: 1000,
  'how-to': 800,
  tutorial: 800,
  reference: 2000,
  explanation: 2000,
  landing: 600,
});

const PAGE_TYPES = ['guide', 'how-to', 'reference', 'explanation', 'landing', 'tutorial'];

/** Split leading `---` frontmatter from the body. Flat `key: value` pairs only. */
export function splitFrontmatter(markdown) {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown);
  if (!m) return { frontmatter: {}, body: markdown };
  const frontmatter = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*?)\s*$/.exec(line);
    if (kv) frontmatter[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return { frontmatter, body: markdown.slice(m[0].length) };
}

function stripFencedCode(text) {
  const out = [];
  let fence = null;
  for (const line of text.split(/\r?\n/)) {
    if (fence) {
      const close = new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`);
      if (close.test(line)) fence = null;
      continue;
    }
    const open = /^\s*(`{3,}|~{3,})/.exec(line);
    if (open) {
      fence = open[1];
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

function stripIndentedCode(text) {
  const out = [];
  let prevBlank = false;
  let inCode = false;
  for (const line of text.split('\n')) {
    const blank = line.trim() === '';
    const indented = /^( {4}|\t)/.test(line);
    if (!blank && indented && (prevBlank || inCode)) {
      inCode = true;
      continue;
    }
    if (!blank) inCode = false;
    prevBlank = blank;
    out.push(line);
  }
  return out.join('\n');
}

export function countWords(markdown) {
  const { body } = splitFrontmatter(String(markdown ?? ''));
  let text = stripFencedCode(body);
  text = stripIndentedCode(text);
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  // Inline code: one word each, and shielded from the tag/link rules below.
  text = text.replace(/`[^`\n]+`/g, ' code ');
  text = text
    .split('\n')
    .filter((l) => !l.trim().startsWith('|') && !/^\s*(import|export)\s/.test(l))
    .join('\n');
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/<\/?[A-Za-z][^>]*>/g, ' ');
  text = text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)+/, ''))
    .join('\n');
  return text.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
}

export function pageType(relPath, frontmatter) {
  const fmType = frontmatter?.type;
  if (PAGE_TYPES.includes(fmType)) return fmType;
  const p = relPath.split(sep).join('/');
  if (p.startsWith('docs/how-to/')) return 'how-to';
  if (p.startsWith('docs/tutorials/')) return 'tutorial';
  if (p.startsWith('docs/reference/')) return 'reference';
  if (p.startsWith('docs/explanation/')) return 'explanation';
  if (p.startsWith('docs/guides/')) return 'guide';
  const site = 'apps/docs/src/content/docs/';
  if (p === `${site}index.md` || p === `${site}index.mdx`) return 'landing';
  if (p.startsWith(`${site}guides/how-to/`)) return 'how-to';
  if (p.startsWith(`${site}guides/`)) return 'guide';
  if (p.startsWith(`${site}reference/`)) return 'reference';
  return 'other';
}

export function median(numbers) {
  if (numbers.length === 0) return 0;
  const s = [...numbers].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function buildReport(pages) {
  const rows = pages.map(({ path, type, words }) => {
    const ceiling = Object.hasOwn(CEILINGS, type) ? CEILINGS[type] : null;
    return { path, type, words, ceiling, pct: ceiling === null ? null : (words / ceiling) * 100 };
  });
  const groups = {};
  for (const r of rows) (groups[r.type] ??= []).push(r.words);
  const byType = {};
  for (const [t, ws] of Object.entries(groups)) byType[t] = { count: ws.length, median: median(ws) };
  return {
    rows,
    byType,
    overall: { count: rows.length, median: median(rows.map((r) => r.words)) },
    over70: rows.filter((r) => r.pct !== null && r.pct > 70),
    over100: rows.filter((r) => r.pct !== null && r.pct > 100),
  };
}

function walk(dir, exts, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return out;
    throw e;
  }
  for (const ent of entries) {
    if (ent.name === 'node_modules') continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) walk(full, exts, out);
    else if (exts.some((x) => ent.name.endsWith(x))) out.push(full);
  }
  return out;
}

function usage() {
  process.stderr.write('usage: node scripts/check-docs-budget.mjs --report [--root <dir>]\n');
  process.exitCode = 2;
}

function main(argv) {
  let report = false;
  let root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--report') report = true;
    else if (argv[i] === '--root' && argv[i + 1] !== undefined) root = resolve(argv[++i]);
    else return usage();
  }
  if (!report) return usage();

  const files = [
    ...walk(join(root, 'docs'), ['.md']),
    ...walk(join(root, 'apps/docs/src/content'), ['.md', '.mdx']),
  ];
  const pages = [];
  for (const file of files) {
    const rel = relative(root, file).split(sep).join('/');
    try {
      if (!statSync(file).isFile()) continue;
      const src = readFileSync(file, 'utf8');
      pages.push({ path: rel, type: pageType(rel, splitFrontmatter(src).frontmatter), words: countWords(src) });
    } catch (e) {
      process.stderr.write(`check-docs-budget: cannot read ${rel}: ${e.message}\n`);
      process.exitCode = 1;
      return;
    }
  }
  pages.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const rep = buildReport(pages);

  const lines = rep.rows.map(
    (r) => `${r.type}\t${r.words}\t${r.ceiling ?? '-'}\t${r.pct === null ? '-' : Math.round(r.pct)}\t${r.path}`,
  );
  lines.push('', '== summary ==', `pages: ${rep.overall.count}  median words: ${rep.overall.median}`);
  for (const [t, s] of Object.entries(rep.byType).sort()) {
    lines.push(`  ${t}: ${s.count} pages, median ${s.median}`);
  }
  const list = (title, rs) => {
    lines.push(`${title}`);
    if (rs.length === 0) lines.push('  (none)');
    for (const r of rs) lines.push(`  ${r.path} (${r.words}/${r.ceiling}, ${Math.round(r.pct)}%)`);
  };
  list('above 70% of ceiling:', rep.over70);
  list('above ceiling:', rep.over100);
  process.stdout.write(lines.join('\n') + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
