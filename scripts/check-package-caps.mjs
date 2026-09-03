#!/usr/bin/env node
/**
 * check-package-caps.mjs — the per-package LOC cap gate (bead forge-8vfn.5.18).
 *
 * WHY THIS EXISTS. `QUARRY.md` has carried a ratified cap per package since M2
 * and nothing enforced it. Consequences, all recorded in the M4 ledger: three
 * caps were re-seeded by re-attribution with no gate watching (rulings 48/51);
 * one package breached its cap on main unnoticed for a whole carve, because the
 * per-FILE cap was checked at every commit while the per-PACKAGE total was
 * quoted from session open (ruling 72 / §15.76); and three lanes measured
 * "production LOC" three different ways, differing by 20–96 lines each.
 *
 * THE FORMULA IS REUSED, NOT RESTATED (ruling 94). The file set is
 * `productionFiles()` from `scripts/check-owner.mjs` — the repo's single
 * encoded definition of a production file:
 *
 *     git ls-files --cached --others --exclude-standard over
 *     orchestrator/ cli/ loops/ skills/ packages/ apps/forge
 *       minus  *.test.* and any path under a test-fixtures/ directory
 *       keeping .ts .tsx .mjs .js .cjs, plus skills/<name>/SKILL.md
 *
 * A second implementation of that rule is the defect this gate is for, so this
 * file imports it and must never re-derive it. The cap gate and the ownership
 * gate therefore cannot disagree about what they are counting.
 *
 * THE CAPS come from `QUARRY.md`'s "Per-package LOC caps" table, which is the
 * ratified record. This gate READS that table and never writes it: a package
 * that would exceed its cap parks for a cull, a split, or an operator-ratified
 * new cap — never a silent raise (QUARRY.md §"Per-package LOC caps").
 *
 * USAGE
 *   node scripts/check-package-caps.mjs                 # the gate
 *   node scripts/check-package-caps.mjs --json          # machine-readable
 *   node scripts/check-package-caps.mjs --cap-override flows=1
 *       Lowers one cap for THIS RUN ONLY. It exists so the gate's own failure
 *       branch is testable without breaching a real cap; it cannot raise a cap
 *       in CI because CI runs the gate with no arguments.
 */
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { productionFiles } from './check-owner.mjs';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FORMULA = "productionFiles() from scripts/check-owner.mjs (CODE extensions + skills/*/SKILL.md, minus *.test.* and test-fixtures/, over git ls-files --cached --others --exclude-standard)";

/** Every `packages/<name>` production file's line count, summed by package. */
export function measurePackages(root = FORGE_ROOT) {
  const lines = new Map();
  for (const rel of productionFiles(root)) {
    const m = rel.match(/^packages\/([^/]+)\//);
    if (!m) continue;
    const n = readFileSync(join(root, rel), 'utf8').split('\n').length - 1;
    lines.set(m[1], (lines.get(m[1]) ?? 0) + n);
  }
  return lines;
}

/**
 * The ratified caps from QUARRY.md's "Per-package LOC caps" table. Rows look
 * like `| \`flows\` | 62 | 21,327 | **22,500** | note |`; the total row and the
 * apps/* rows carry no package cap this gate governs.
 */
export function parseCaps(markdown) {
  const caps = new Map();
  for (const line of markdown.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    const cells = t.slice(1, t.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim());
    if (cells.length < 4) continue;
    const name = cells[0].match(/^`([a-z]+)`$/);
    if (!name) continue; // a header, the **total** row, or `apps/forge`
    const cap = cells[3].replace(/\*/g, '').replace(/,/g, '').trim();
    if (!/^\d+$/.test(cap)) continue;
    caps.set(name[1], Number.parseInt(cap, 10));
  }
  return caps;
}

function parseOverrides(argv) {
  const out = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--cap-override') continue;
    const spec = argv[i + 1];
    const m = spec?.match(/^([a-z]+)=(\d+)$/);
    if (!m) {
      throw new Error(`--cap-override expects <package>=<number>, got ${spec === undefined ? '(nothing)' : `"${spec}"`}`);
    }
    out.set(m[1], Number.parseInt(m[2], 10));
    i += 1;
  }
  return out;
}

export function audit(root = FORGE_ROOT, overrides = new Map()) {
  const measuredLines = measurePackages(root);
  const caps = parseCaps(readFileSync(join(root, 'QUARRY.md'), 'utf8'));
  for (const name of overrides.keys()) {
    if (!caps.has(name)) throw new Error(`--cap-override names "${name}", which has no cap row in QUARRY.md`);
  }
  const packages = {};
  const breaches = [];
  const unmeasured = [];
  for (const [name, cap] of [...caps].sort()) {
    const lines = measuredLines.get(name);
    if (lines === undefined) {
      unmeasured.push(name);
      continue;
    }
    const effective = overrides.get(name) ?? cap;
    packages[name] = { lines, cap: effective };
    if (lines > effective) breaches.push({ name, lines, cap: effective });
  }
  const uncapped = [...measuredLines.keys()].filter((n) => !caps.has(n)).sort();
  return { packages, breaches, unmeasured, uncapped, formula: FORMULA };
}

function main(argv) {
  let result;
  try {
    result = audit(FORGE_ROOT, parseOverrides(argv));
  } catch (err) {
    console.error(`check-package-caps: FAIL — ${err.message}`);
    return 1;
  }
  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return result.breaches.length || result.unmeasured.length || result.uncapped.length ? 1 : 0;
  }

  const rows = Object.entries(result.packages);
  const width = Math.max(...rows.map(([n]) => n.length));
  for (const [name, { lines, cap }] of rows) {
    const flag = lines > cap ? 'OVER' : `${Math.round((lines / cap) * 100)}%`;
    console.log(`  ${name.padEnd(width)}  ${String(lines).padStart(7)} / ${String(cap).padStart(7)}  ${flag}`);
  }
  console.log(`  formula: ${result.formula}`);

  // A package present in QUARRY's caps table but absent from the tree, or
  // present in the tree with no cap row, is a gap in the ratchet's coverage —
  // the shape that let a whole package go unwatched. Both fail.
  for (const name of result.unmeasured) {
    console.error(`check-package-caps: "${name}" has a cap in QUARRY.md but no production files were measured for it`);
  }
  for (const name of result.uncapped) {
    console.error(`check-package-caps: packages/${name} has production files but no cap row in QUARRY.md`);
  }
  for (const b of result.breaches) {
    console.error(`check-package-caps: packages/${b.name} is ${b.lines} production lines, over its ratified cap of ${b.cap} by ${b.lines - b.cap}`);
  }
  const bad = result.breaches.length + result.unmeasured.length + result.uncapped.length;
  if (bad > 0) {
    console.error(
      'check-package-caps: FAIL — a package over its cap parks for a cull, a split, or an operator-ratified new cap (QUARRY.md). Never a silent raise.',
    );
    return 1;
  }
  console.log(`check-package-caps: PASS — ${rows.length} packages, every one within its ratified QUARRY.md cap`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
