#!/usr/bin/env node
/**
 * check-docs-md-twins.mjs — every page of the built docs site has its raw
 * markdown twin at `<path>.md`.
 *
 * The twin is the page's agent-readable surface (the "Copy Markdown" and
 * "Open in Claude" actions read it). The site plugin writes one per content
 * page; this proves none was dropped. Pages that are not content — the
 * landing page, 404, and the search and asset trees — need none.
 *
 * Usage: node scripts/check-docs-md-twins.mjs [--dist <dir>]
 *   dist defaults to apps/docs/dist (run `npm run build --workspace=docs` first).
 * Exit: 0 every page has a twin · 1 a twin is missing or there is no build · 2 bad usage.
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const NO_TWIN_DIRS = new Set(['_astro', 'pagefind']);

function pages(dist, dir = dist, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (dir === dist && NO_TWIN_DIRS.has(ent.name)) continue;
      pages(dist, full, out);
    } else if (ent.name === 'index.html' && dir !== dist) {
      out.push(relative(dist, dir).split(sep).join('/'));
    }
  }
  return out;
}

/** Page routes under `dist` (e.g. `guides/b`) whose `<route>.md` twin is absent. */
export function missingTwins(dist) {
  return pages(dist)
    .filter((route) => !existsSync(join(dist, `${route}.md`)))
    .sort();
}

function main(argv) {
  let dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'apps/docs/dist');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dist' && argv[i + 1] !== undefined) dist = resolve(argv[++i]);
    else {
      process.stderr.write('usage: node scripts/check-docs-md-twins.mjs [--dist <dir>]\n');
      process.exitCode = 2;
      return;
    }
  }
  if (!existsSync(dist)) {
    process.stderr.write(`check-docs-md-twins: FAIL — no built site at ${dist}; run \`npm run build --workspace=docs\` first\n`);
    process.exitCode = 1;
    return;
  }
  const missing = missingTwins(dist);
  if (missing.length > 0) {
    process.stderr.write(`check-docs-md-twins: FAIL (${missing.length} page${missing.length === 1 ? '' : 's'} without a twin)\n`);
    for (const route of missing) process.stderr.write(`  ✗ ${route}/index.html has no ${route}.md\n`);
    process.exitCode = 1;
    return;
  }
  const n = pages(dist).length;
  process.stdout.write(`check-docs-md-twins: PASS — ${n} page${n === 1 ? '' : 's'}, each with its .md twin\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
