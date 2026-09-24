#!/usr/bin/env node
/**
 * check-owner — every production file has exactly one owner package.
 *
 * THE CONSTRAINT THIS ENFORCES. The spec's governance section (§8): "One
 * session = one package: a lane may touch its package, its routes and tests,
 * plus additive-only contracts/kernel edits named in the PR title;
 * `check-owner.mjs` + dependency-cruiser fail anything else." A lane cannot
 * be held to one package while the tree has files no package claims — the
 * question "whose file is this?" has to have an answer before the M3 move,
 * and `QUARRY.md` is that answer.
 *
 * `QUARRY.md` (repo root) is the single source: one row per production file
 * under `orchestrator/ cli/ loops/ skills/`, giving the owner package, the
 * disposition it will be moved under, and its line count.
 *
 *     | path | owner | disposition | loc |
 *
 * WHAT FAILS. `unowned` — a file in the tree with no row — is ratcheted
 * through `scripts/baselines/owner.json` and must reach **zero** by the
 * skeleton PR. The other classes have NO baseline and always fail, because
 * each is cheap to keep at zero and each makes the file silently lie: an
 * `orphan` row (no such file) makes the quarry describe a tree that does not
 * exist, a `duplicate` row gives one file two owners, and an owner or
 * disposition outside the vocabulary is a typo that would survive the move.
 *
 * THE NUMBERS (forge-8vfn.5.18). Owning a row was checked; nothing checked
 * that the row was TRUE. Three more classes, still with no baseline:
 *
 *   locDrift         a row's `loc` cell vs the file's real line count,
 *                     counted the same way `check-package-caps.mjs`'s
 *                     `measurePackages` counts it (`countLines`, below —
 *                     ONE definition, imported by that file rather than
 *                     re-derived, which is the bug forge-8vfn.5.18 names).
 *   dispositionDrift  the four-count summary table near the top of
 *                     QUARRY.md vs a fresh tally of the per-file rows'
 *                     `disposition` column.
 *   packageDrift      the "Per-package LOC caps" table's `files` and
 *                     `quarried LOC` columns (plus the **total** row) vs
 *                     the per-file rows summed by `owner`. The `cap` column
 *                     itself is untouched here — that is a ratified ceiling
 *                     `check-package-caps.mjs` reads and never writes, not a
 *                     derived count.
 *
 * `--write` recomputes all three straight from the rows and the tree and
 * rewrites QUARRY.md in place; it never touches `owner`, `disposition`, the
 * `cap` column or any note.
 *
 * RUN: node scripts/check-owner.mjs [--json] [--quarry <path>] [--baseline <path>] [--write]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The nine packages plus the two apps — `1.0.md` §0 and spec §3. */
export const OWNERS = Object.freeze([
  'contracts', 'kernel', 'library', 'knowledge', 'projects',
  'agents', 'sessions', 'flows', 'factory', 'apps/forge', 'apps/studio',
]);

/** `1.0.md` §4 M2 Lane A. */
export const DISPOSITIONS = Object.freeze(['verbatim', 'pruned', 'rewritten', 'deleted']);

/** The four legacy trees the quarry accounts for. */
const QUARRIED_TREES = ['orchestrator', 'cli', 'loops', 'skills', 'packages', 'apps/forge'];
const CODE = ['.ts', '.tsx', '.mjs', '.js', '.cjs'];
const NOT_PRODUCTION = /(\.test\.[cm]?[jt]sx?$)|(^|\/)test-fixtures\//;

/**
 * The production files the quarry must account for: code under the four
 * legacy trees, plus the SKILL.md agent definitions, which are production
 * artifacts (ADR 024 — the SKILL.md IS the agent) and move as such.
 */
export function productionFiles(root) {
  // `--others --exclude-standard` for the same reason `check-file-size.mjs`
  // uses it: a file must not dodge the gate by not being committed yet. The
  // two lints landed together and must see the same tree, or "unowned: 0"
  // means something different from "115 baselined".
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', ...QUARRIED_TREES], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((p) => !NOT_PRODUCTION.test(p))
    .filter((p) => CODE.some((e) => p.endsWith(e)) || /^skills\/[^/]+\/SKILL\.md$/.test(p))
    .sort();
}

/** Parses every `| path | owner | disposition | loc |` row out of QUARRY.md. */
export function parseQuarry(markdown) {
  const rows = [];
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed.slice(1, trimmed.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim());
    if (cells.length < 4) continue;
    const [path, owner, disposition, loc] = cells;
    if (!QUARRIED_TREES.some((t) => path.startsWith(`${t}/`))) continue; // a header or a prose table
    rows.push({ path, owner, disposition, loc: Number.parseInt(loc, 10) });
  }
  return rows;
}

/**
 * The line-counting rule `check-package-caps.mjs`'s `measurePackages` needs
 * too: `wc -l` semantics, the number of newline characters in the file. ONE
 * definition — that file imports this rather than re-deriving it, which is
 * exactly the second-implementation defect forge-8vfn.5.18 names.
 */
export function countLines(text) {
  return text.split('\n').length - 1;
}

/**
 * The `| \`verbatim\` | meaning | count |` summary table near the top of
 * QUARRY.md. The pattern (a disposition name as a WHOLE backtick-wrapped
 * first cell) cannot collide with the per-file rows above, whose
 * disposition is a bare word in the THIRD of four cells, or with the
 * `pruned`/`deleted` detail table below, whose first cell is a file path.
 */
const DISPOSITION_SUMMARY_ROW = /^\|\s*`(verbatim|pruned|rewritten|deleted)`\s*\|.*\|\s*(\d+)\s*\|$/;

export function parseDispositionSummary(markdown) {
  const counts = {};
  for (const line of markdown.split('\n')) {
    const m = line.trim().match(DISPOSITION_SUMMARY_ROW);
    if (m) counts[m[1]] = Number.parseInt(m[2], 10);
  }
  return counts;
}

/**
 * The "Per-package LOC caps" table's `files` and `quarried LOC` columns,
 * plus the **total** row — five-cell rows shaped
 * `| \`name\` | files | loc | cap | note |`. Strips `**`/`,` the same way
 * `check-package-caps.mjs`'s `parseCaps` does for the cap column, because
 * both are reading the same markdown number syntax. The `cap` and `note`
 * cells are left alone: this file only ever reads or recomputes `files` and
 * `quarried LOC`, never the ratified cap.
 */
export function parsePackageTable(markdown) {
  const rows = [];
  for (const line of markdown.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    const cells = t.slice(1, t.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim());
    if (cells.length !== 5) continue;
    const isTotal = cells[0] === '**total**';
    const nameMatch = cells[0].match(/^`([a-z/]+)`$/);
    if (!isTotal && !nameMatch) continue; // header, separator, or another table's row
    const clean = (s) => s.replace(/\*/g, '').replace(/,/g, '').trim();
    const filesStr = clean(cells[1]);
    const locStr = clean(cells[2]);
    if (!/^\d+$/.test(filesStr) || !/^\d+$/.test(locStr)) continue; // e.g. `apps/studio`'s "0 | 0" is fine, a "—" cap cell is column 4
    rows.push({ name: isTotal ? 'total' : nameMatch[1], files: Number.parseInt(filesStr, 10), loc: Number.parseInt(locStr, 10) });
  }
  return rows;
}

export function audit(root, quarryMarkdown) {
  const tree = new Set(productionFiles(root));
  const rows = parseQuarry(quarryMarkdown);

  const seen = new Map();
  const duplicates = [];
  for (const row of rows) {
    if (seen.has(row.path)) duplicates.push(row.path);
    else seen.set(row.path, row);
  }

  const unowned = [...tree].filter((p) => !seen.has(p)).sort();
  const orphans = [...seen.keys()].filter((p) => !tree.has(p)).sort();
  const badOwner = rows.filter((r) => !OWNERS.includes(r.owner)).map((r) => `${r.path} (owner "${r.owner}")`).sort();
  const badDisposition = rows.filter((r) => !DISPOSITIONS.includes(r.disposition)).map((r) => `${r.path} (disposition "${r.disposition}")`).sort();
  const badLoc = rows.filter((r) => !Number.isInteger(r.loc) || r.loc < 0).map((r) => r.path).sort();

  // locDrift: each row's declared loc vs the file's real line count. Only for
  // rows the tree actually has — a missing file is already an `orphan`, and
  // comparing loc for something unreadable would be a second complaint about
  // the same row.
  const locDrift = [];
  for (const row of rows) {
    if (!tree.has(row.path)) continue;
    let text;
    try {
      text = readFileSync(join(root, row.path), 'utf8');
    } catch {
      continue; // vanished between the listing and this read — not this check's concern
    }
    const measured = countLines(text);
    if (measured !== row.loc) locDrift.push({ path: row.path, quarried: row.loc, measured });
  }
  locDrift.sort((a, b) => (a.path < b.path ? -1 : 1));

  // dispositionDrift: the header summary's four counts vs a fresh tally of
  // the rows' own `disposition` column.
  const dispositionCounts = Object.fromEntries(DISPOSITIONS.map((d) => [d, 0]));
  for (const row of rows) if (DISPOSITIONS.includes(row.disposition)) dispositionCounts[row.disposition] += 1;
  const summary = parseDispositionSummary(quarryMarkdown);
  const dispositionDrift = DISPOSITIONS
    .filter((d) => summary[d] !== undefined && summary[d] !== dispositionCounts[d])
    .map((d) => ({ disposition: d, header: summary[d], table: dispositionCounts[d] }));

  // packageDrift: the "Per-package LOC caps" table's `files`/`quarried LOC`
  // columns (and **total**) vs the rows summed by `owner`. Uses each row's
  // DECLARED loc, not its measured loc — this checks the table's internal
  // arithmetic against its own rows; `locDrift` above is the separate check
  // that a row's declared loc matches the real file. A quarry passing both
  // therefore has a package total that matches the real tree too.
  const byOwner = new Map(OWNERS.map((o) => [o, { files: 0, loc: 0 }]));
  for (const row of rows) {
    if (!OWNERS.includes(row.owner)) continue; // badOwner already reported
    const entry = byOwner.get(row.owner);
    entry.files += 1;
    entry.loc += row.loc;
  }
  let totalFiles = 0;
  let totalLoc = 0;
  for (const { files, loc } of byOwner.values()) {
    totalFiles += files;
    totalLoc += loc;
  }
  const packageDrift = [];
  for (const r of parsePackageTable(quarryMarkdown)) {
    const actual = r.name === 'total' ? { files: totalFiles, loc: totalLoc } : byOwner.get(r.name);
    if (!actual) continue; // a package name outside OWNERS is badOwner-shaped, not this check's job
    if (r.files !== actual.files) packageDrift.push({ name: r.name, column: 'files', header: r.files, table: actual.files });
    if (r.loc !== actual.loc) packageDrift.push({ name: r.name, column: 'quarried LOC', header: r.loc, table: actual.loc });
  }

  return {
    files: tree.size,
    rows: rows.length,
    unowned,
    orphans,
    duplicates: [...new Set(duplicates)].sort(),
    badOwner,
    badDisposition,
    badLoc,
    locDrift,
    dispositionDrift,
    packageDrift,
  };
}

/**
 * Rewrites QUARRY.md's three DERIVED surfaces from its own rows and the real
 * tree (`--write`, forge-8vfn.5.18): the per-file `loc` column, the
 * disposition summary header, and the per-package `files`/`quarried LOC`
 * columns (including **total**). Never touches `owner`, `disposition`, the
 * `cap` column, or any note — those are ratified decisions, not derived
 * numbers, the same boundary `check-package-caps.mjs` already draws around
 * the cap column it reads and never writes.
 */
export function rewriteQuarry(root, markdown) {
  const rows = parseQuarry(markdown);
  const tree = new Set(productionFiles(root));

  const measuredByPath = new Map();
  for (const row of rows) {
    if (!tree.has(row.path)) continue;
    let text;
    try {
      text = readFileSync(join(root, row.path), 'utf8');
    } catch {
      continue;
    }
    measuredByPath.set(row.path, countLines(text));
  }

  // The per-package/total aggregation uses each row's CORRECTED loc (the
  // same value the loc-column fix above is about to write), not its stale
  // declared one — otherwise a single `--write` would leave the package
  // table summing numbers the row cells no longer say, and the very next
  // (read-only) audit would report fresh packageDrift it just introduced.
  const dispositionCounts = Object.fromEntries(DISPOSITIONS.map((d) => [d, 0]));
  const byOwner = new Map(OWNERS.map((o) => [o, { files: 0, loc: 0 }]));
  for (const row of rows) {
    if (DISPOSITIONS.includes(row.disposition)) dispositionCounts[row.disposition] += 1;
    if (!OWNERS.includes(row.owner)) continue;
    const entry = byOwner.get(row.owner);
    entry.files += 1;
    entry.loc += measuredByPath.get(row.path) ?? row.loc;
  }
  let totalFiles = 0;
  let totalLoc = 0;
  for (const { files, loc } of byOwner.values()) {
    totalFiles += files;
    totalLoc += loc;
  }

  const fmt = (n) => n.toLocaleString('en-US');
  let locRows = 0;
  let dispositionRows = 0;
  let packageRows = 0;

  const lines = markdown.split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) return line;
    const cells = trimmed.slice(1, trimmed.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim());

    if (cells.length === 4 && QUARRIED_TREES.some((t) => cells[0].startsWith(`${t}/`))) {
      const measured = measuredByPath.get(cells[0]);
      if (measured !== undefined && String(measured) !== cells[3]) {
        locRows += 1;
        return `| ${cells[0]} | ${cells[1]} | ${cells[2]} | ${measured} |`;
      }
      return line;
    }

    if (cells.length === 3) {
      const m = cells[0].match(/^`(verbatim|pruned|rewritten|deleted)`$/);
      if (m) {
        const want = String(dispositionCounts[m[1]]);
        if (cells[2] !== want) {
          dispositionRows += 1;
          return `| ${cells[0]} | ${cells[1]} | ${want} |`;
        }
      }
      return line;
    }

    if (cells.length === 5) {
      const isTotal = cells[0] === '**total**';
      const nameMatch = cells[0].match(/^`([a-z/]+)`$/);
      if (isTotal || nameMatch) {
        const agg = isTotal ? { files: totalFiles, loc: totalLoc } : byOwner.get(nameMatch[1]);
        if (agg) {
          const filesWant = isTotal ? `**${fmt(agg.files)}**` : String(agg.files);
          const locWant = isTotal ? `**${fmt(agg.loc)}**` : fmt(agg.loc);
          if (cells[1] !== filesWant || cells[2] !== locWant) {
            packageRows += 1;
            return `| ${cells[0]} | ${filesWant} | ${locWant} | ${cells[3]} | ${cells[4]} |`;
          }
        }
      }
      return line;
    }

    return line;
  });

  return { content: lines.join('\n'), locRows, dispositionRows, packageRows };
}

function readBaseline(path) {
  if (!existsSync(path)) return { unowned: 0 };
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (parsed === null || typeof parsed !== 'object' || !Number.isInteger(parsed.unowned)) {
    throw new Error(`${path}: expected { "unowned": <integer> }`);
  }
  return parsed;
}

function main(argv) {
  const json = argv.includes('--json');
  const write = argv.includes('--write');
  const qAt = argv.indexOf('--quarry');
  const bAt = argv.indexOf('--baseline');
  const quarryPath = qAt === -1 ? join(ROOT, 'QUARRY.md') : resolve(argv[qAt + 1]);
  const baselinePath = bAt === -1 ? join(ROOT, 'scripts/baselines/owner.json') : resolve(argv[bAt + 1]);

  if (!existsSync(quarryPath)) {
    process.stdout.write(`check-owner: FAIL — ${quarryPath} does not exist; the quarry is the source of ownership\n`);
    return 1;
  }

  if (write) {
    const { content, locRows, dispositionRows, packageRows } = rewriteQuarry(ROOT, readFileSync(quarryPath, 'utf8'));
    writeFileSync(quarryPath, content);
    process.stdout.write(
      `check-owner: WROTE ${quarryPath} — ${locRows} row loc value(s), ${dispositionRows} disposition summary ` +
      `count(s), ${packageRows} package table cell(s) recomputed from the rows and the tree\n`,
    );
    return 0;
  }

  const result = audit(ROOT, readFileSync(quarryPath, 'utf8'));
  const baseline = readBaseline(baselinePath);
  const over = result.unowned.length > baseline.unowned;
  const stale = result.unowned.length < baseline.unowned;
  const hard = result.orphans.length + result.duplicates.length + result.badOwner.length + result.badDisposition.length
    + result.badLoc.length + result.locDrift.length + result.dispositionDrift.length + result.packageDrift.length;

  if (json) process.stdout.write(`${JSON.stringify({ ...result, baselineUnowned: baseline.unowned }, null, 2)}\n`);

  if (!over && !stale && hard === 0) {
    if (!json) {
      process.stdout.write(
        `check-owner: PASS — ${result.rows} rows own ${result.files} production files, unowned: ${result.unowned.length}\n`,
      );
    }
    return 0;
  }

  if (!json) {
    for (const p of result.unowned.slice(0, 20)) process.stdout.write(`  unowned: ${p} — add a QUARRY.md row naming its package\n`);
    if (result.unowned.length > 20) process.stdout.write(`  … and ${result.unowned.length - 20} more unowned\n`);
    for (const p of result.orphans) process.stdout.write(`  orphan row: ${p} — QUARRY.md claims a file that is not in the tree\n`);
    for (const p of result.duplicates) process.stdout.write(`  duplicate row: ${p} — a file has exactly one owner\n`);
    for (const p of result.badOwner) process.stdout.write(`  unknown owner: ${p} — one of ${OWNERS.join(', ')}\n`);
    for (const p of result.badDisposition) process.stdout.write(`  unknown disposition: ${p} — one of ${DISPOSITIONS.join(', ')}\n`);
    for (const p of result.badLoc) process.stdout.write(`  bad loc: ${p} — the row's line count must be a non-negative integer\n`);
    for (const d of result.locDrift.slice(0, 15)) process.stdout.write(`  loc drift: ${d.path} — QUARRY says ${d.quarried}, the file is ${d.measured} lines\n`);
    if (result.locDrift.length > 15) process.stdout.write(`  … and ${result.locDrift.length - 15} more loc drift row(s)\n`);
    for (const d of result.dispositionDrift) process.stdout.write(`  disposition summary drift: \`${d.disposition}\` — header says ${d.header}, the table counts ${d.table}\n`);
    for (const d of result.packageDrift) process.stdout.write(`  package table drift: \`${d.name}\` ${d.column} — header says ${d.header}, the table counts ${d.table}\n`);
    if (over) process.stdout.write(`check-owner: FAIL — ${result.unowned.length} unowned files, above the baseline of ${baseline.unowned}\n`);
    else if (stale) process.stdout.write(`check-owner: FAIL — ${result.unowned.length} unowned files, below the baseline of ${baseline.unowned}; tighten scripts/baselines/owner.json\n`);
    else {
      process.stdout.write(`check-owner: FAIL — ${hard} row error(s); these have no baseline\n`);
      if (result.locDrift.length + result.dispositionDrift.length + result.packageDrift.length > 0) {
        process.stdout.write('  run `node scripts/check-owner.mjs --write` to recompute the drifted numbers from the rows and the tree\n');
      }
    }
  }
  return 1;
}

// Run only when executed directly — helpers here are imported by tests and by
// tooling, and an import must not run the check.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
