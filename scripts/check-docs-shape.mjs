#!/usr/bin/env node
/**
 * check-docs-shape.mjs — two rules about generated and internal pages.
 *
 *   A. Every page under apps/docs/src/content/docs/guides/how-to/ carries
 *      `generated_from: tests/stories/<id>.story.mjs` naming a story that
 *      exists — a how-to is generated from a story, never hand-written. A
 *      docs/ page carrying `generated_from:` is a write to the retired emit
 *      target and fails.
 *   B. No internal ledger on the published site: a page anywhere under
 *      apps/docs/src/content/docs/ sharing a basename with a `dev/*.md`
 *      file fails, as does a site page whose `generated_from:` points into
 *      dev/ or at a checker script. A missing dev/ means nothing to check.
 *
 * The page-count cap is replaced by check-docs-budget's word ceilings and its
 * 20-guide cap (D-37).
 *
 * Usage: node scripts/check-docs-shape.mjs [root]   (root defaults to the repo)
 * Fail = non-zero exit + one actionable line per violation.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(process.argv[2] ?? FORGE_ROOT);
const DOCS_DIR = join(root, 'docs');
const DEV_DIR = join(root, 'dev');
const STORIES_DIR = join(root, 'tests/stories');
const SITE_REL = 'apps/docs/src/content/docs';
const SITE_DIR = join(root, SITE_REL);
const SITE_HOWTO_REL = `${SITE_REL}/guides/how-to`;
const SITE_HOWTO_DIR = join(root, SITE_HOWTO_REL);

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

const rel = (abs) => relative(root, abs).split('\\').join('/');

/** The `generated_from:` value of a page's frontmatter, or null. */
function generatedFrom(abs) {
  const text = readFileSync(abs, 'utf8');
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 4);
  if (end === -1) return null;
  const m = text.slice(4, end).match(/^generated_from:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

function main() {
  const violations = [];
  let howtos = 0;

  // Rule A — a docs/ page must not carry generated_from.
  for (const abs of markdownFilesUnder(DOCS_DIR)) {
    if (generatedFrom(abs)) {
      violations.push(
        `${rel(abs)} carries \`generated_from:\` — generated pages live in ${SITE_HOWTO_REL}/, never under docs/; delete it and re-run the story`,
      );
    }
  }

  // Rule A — every site how-to is a story's generated page.
  for (const abs of markdownFilesUnder(SITE_HOWTO_DIR)) {
    howtos++;
    const from = generatedFrom(abs);
    if (!from) {
      violations.push(`${rel(abs)} carries no \`generated_from:\` header — a how-to is generated from a story under tests/stories/, never hand-written; re-run the story that writes it`);
    } else if (!/^tests\/stories\/[A-Za-z0-9._-]+\.story\.mjs$/.test(from) || !existsSync(join(root, from))) {
      violations.push(`${rel(abs)} says \`generated_from: ${from}\` but no such story exists — re-run the story that writes this page, or delete the page`);
    }
  }

  // Rule B — no internal ledger on the published site.
  const ledgers = existsSync(DEV_DIR)
    ? readdirSync(DEV_DIR).filter((f) => f.endsWith('.md') && statSync(join(DEV_DIR, f)).isFile())
    : [];
  const ledgerNames = new Set(ledgers);
  for (const abs of markdownFilesUnder(SITE_DIR)) {
    if (ledgerNames.has(basename(abs))) {
      violations.push(`${rel(abs)}: internal ledger ${basename(abs)} belongs in dev/, never on the published site`);
    }
    const from = generatedFrom(abs);
    if (from && (/^(\.\/)?dev\//.test(from) || /^scripts\/check-[^/]*$/.test(from))) {
      violations.push(`${rel(abs)} says \`generated_from: ${from}\` — a ledger from dev/ or a checker never publishes to the site`);
    }
  }

  if (violations.length) {
    console.error(`check-docs-shape: FAIL (${violations.length} violation${violations.length === 1 ? '' : 's'})`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    // exitCode + return, never process.exit(): a piped stdout must drain.
    process.exitCode = 1;
    return;
  }

  console.log(
    `check-docs-shape: PASS — ${howtos} generated how-tos name their story, ${ledgers.length} dev/ ledgers absent from the site`,
  );
}

main();
