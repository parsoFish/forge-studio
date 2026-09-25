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
 * THE NOTE CELL is checked too (T1 ruling 1275(i)): every raise since M2
 * hand-APPENDED a dated entry to the same cell instead of replacing it, and
 * QUARRY.md merge-conflicted on nearly every PR because every lane's raise
 * touched the same line. `noteViolation()` fails a note that still carries
 * more than one dated entry, or that has simply grown long — the note's job
 * is naming the CURRENT cap's authority in one short sentence; the raise
 * history stays recoverable from `git log -p -- QUARRY.md`.
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
import { productionFiles, countLines } from './check-owner.mjs';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FORMULA = "productionFiles() from scripts/check-owner.mjs (CODE extensions + skills/*/SKILL.md, minus *.test.* and test-fixtures/, over git ls-files --cached --others --exclude-standard)";

/**
 * A package name, same shape as `@forge/kernel`'s `SLUG_RE`
 * (`packages/kernel/ids.ts`): lowercase, kebab-case, e.g. `forge-docs`. Kept
 * as a local literal rather than importing the kernel module — this gate and
 * `check-owner.mjs` are dependency-light lint scripts, not package consumers
 * — but the pattern must not drift from it, since a package name IS a slug.
 * Before this, both the cap-table row pattern and the `--cap-override`
 * package pattern were `[a-z]+`, so a hyphenated package could never get a
 * cap row parsed, at all — not "over cap", not "uncapped", just invisible.
 */
const PACKAGE_NAME_RE = /[a-z][a-z0-9]*(?:-[a-z0-9]+)*/;

/**
 * 75 is the campaign's REFUSED code — the one `gate.sh` already renders as
 * REFUSED rather than as a red. One code across the guards (check-file-size
 * exports the same), because a second number here would make an unmeasurable
 * corpus read as a cap breach in exactly the logs where the difference decides
 * whether anyone acts.
 */
export const EXIT_CANNOT_MEASURE = 75;

/** The corpus could not be READ. Not a finding about the corpus's contents. */
export class CorpusUnreadable extends Error {
  constructor(cause) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'CorpusUnreadable';
    this.cause = cause;
  }
}

/**
 * Every `packages/<name>` production file's line count, summed by package.
 *
 * `forge-8vfn.28`. THE LISTING AND THE READ ARE TWO MOMENTS, and four lanes
 * share this box. `productionFiles()` asks git what exists; each `readFileSync`
 * below happens afterwards, and in between a sibling worktree's branch switch
 * can remove any of those paths — a checkout is a write to every file at once
 * (§15.540). This red-ed CI during lane A's #767 gate: `readFileSync` threw
 * ENOENT into `main`'s blanket catch, which printed `check-package-caps: FAIL`
 * and returned 1. **A missing file was reported as a package over its cap.**
 *
 * WHY THIS CANNOT DO WHAT `check-file-size` DOES. That checker returns null for
 * a vanished path and carries on, which is correct THERE because it judges each
 * file on its own — a file that is gone is simply not checked, and no other
 * file's verdict moves. **This one SUMS.** Skipping a vanished file lowers the
 * package total, and under-counting is the direction that lets a breach pass:
 * the cap would read green precisely BECAUSE it measured less than the package
 * holds. Same race, opposite remedy, and the thing that decides which is
 * whether the guard aggregates.
 *
 * So an unreadable corpus is a REFUSAL, never a measurement (§15.504): green,
 * red and CANNOT-MEASURE are three states, and the unknown one never resolves
 * toward "within cap".
 *
 * `lister` is injected for the door that proves it. The race cannot be staged
 * against the live tree — by the time a test could delete a file, `git
 * ls-files` has already stopped naming it — so the only way to exercise the gap
 * is to hand this a listing that names a path which is not there, which is
 * exactly what git returned a moment before the sibling's checkout.
 */
export function measurePackages(root = FORGE_ROOT, lister = productionFiles) {
  const lines = new Map();
  for (const rel of lister(root)) {
    const m = rel.match(/^packages\/([^/]+)\//);
    if (!m) continue;
    let text;
    try {
      text = readFileSync(join(root, rel), 'utf8');
    } catch (err) {
      // The corpus moved under us. NOT a cap verdict, and deliberately not a
      // skip — see the aggregation argument above.
      throw new CorpusUnreadable(
        new Error(`${rel} was listed by the corpus and could not be read (${err instanceof Error ? err.message : String(err)})`),
      );
    }
    // ONE definition (forge-8vfn.5.18): countLines lives in check-owner.mjs,
    // which check-owner's own loc-drift check uses too — a second inline copy
    // of this arithmetic is exactly the defect that bead is about.
    lines.set(m[1], (lines.get(m[1]) ?? 0) + countLines(text));
  }
  return lines;
}

/**
 * Every capped row of QUARRY.md's "Per-package LOC caps" table, cap and note
 * together — one parse, so the two can never drift apart the way a second
 * hand-copied row pattern would. Rows look like
 * `| \`flows\` | 62 | 21,327 | **22,500** | note |`; the total row and the
 * apps/* rows carry no package cap this gate governs.
 */
export function parseCapRows(markdown) {
  const rows = new Map();
  for (const line of markdown.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    const cells = t.slice(1, t.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim());
    if (cells.length < 4) continue;
    const name = cells[0].match(new RegExp(`^\`(${PACKAGE_NAME_RE.source})\`$`));
    if (!name) continue; // a header, the **total** row, or `apps/forge`
    const cap = cells[3].replace(/\*/g, '').replace(/,/g, '').trim();
    if (!/^\d+$/.test(cap)) continue;
    rows.set(name[1], { cap: Number.parseInt(cap, 10), note: cells[4] ?? '' });
  }
  return rows;
}

/** Just the cap numbers — the shape every caller before this gate's note check wanted. */
export function parseCaps(markdown) {
  return new Map([...parseCapRows(markdown)].map(([name, row]) => [name, row.cap]));
}

/**
 * T1 ruling 1275(i). Every raise since M2 hand-APPENDED a dated
 * "**Raised X → Y (…)**" (or Re-seeded/Pruned/DECREASE/NEW ROW) entry to the
 * same note cell instead of replacing it, so the cell only ever grew — one
 * row reached 40,000+ characters — and QUARRY.md merge-conflicted on nearly
 * every PR because every lane's raise touched the same line. The full raise
 * history is not lost: it stays recoverable from `git log -p -- QUARRY.md`.
 * The note cell's job is narrower — name the CURRENT cap's authority in one
 * short sentence — so this gate fails a note that still carries more than
 * one dated entry (counted by its bold `**…**` markers, which is how every
 * entry so far has been written) or that has simply grown long regardless of
 * markup, and tells the author to replace it, not append to it.
 */
export const NOTE_MAX_LENGTH = 300;
const BOLD_SPAN_RE = /\*\*[^*]+\*\*/g;

export function noteViolation(note) {
  const boldEntries = note.match(BOLD_SPAN_RE)?.length ?? 0;
  if (boldEntries > 1) {
    return `carries ${boldEntries} bold-marked history entries — replace the note with the current cap's authority in one short sentence (the prior raises stay in \`git log -p -- QUARRY.md\`); do not append another`;
  }
  if (note.length > NOTE_MAX_LENGTH) {
    return `is ${note.length} characters, over the ${NOTE_MAX_LENGTH}-character short-note limit — replace the note with the current cap's authority in one short sentence (the prior raises stay in \`git log -p -- QUARRY.md\`); do not append another`;
  }
  return null;
}

function parseOverrides(argv) {
  const out = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--cap-override') continue;
    const spec = argv[i + 1];
    const m = spec?.match(new RegExp(`^(${PACKAGE_NAME_RE.source})=(\\d+)$`));
    if (!m) {
      throw new Error(`--cap-override expects <package>=<number>, got ${spec === undefined ? '(nothing)' : `"${spec}"`}`);
    }
    out.set(m[1], Number.parseInt(m[2], 10));
    i += 1;
  }
  return out;
}

export function audit(root = FORGE_ROOT, overrides = new Map(), lister = productionFiles) {
  const measuredLines = measurePackages(root, lister);
  const capRows = parseCapRows(readFileSync(join(root, 'QUARRY.md'), 'utf8'));
  const caps = new Map([...capRows].map(([name, row]) => [name, row.cap]));
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
  // Checked against every capped row regardless of whether it was measured —
  // a note's shape does not depend on the corpus being readable.
  const noteViolations = [];
  for (const [name, { note }] of [...capRows].sort()) {
    const reason = noteViolation(note);
    if (reason) noteViolations.push({ name, reason });
  }
  return { packages, breaches, unmeasured, uncapped, noteViolations, formula: FORMULA };
}

/**
 * EXPORTED for its exit code, which IS this guard's contract (`forge-8vfn.28`).
 *
 * The refusal path had no door: every test here exercised `measurePackages` and
 * `audit`, and nothing asserted what the process actually RETURNS when the
 * corpus cannot be read. A three-state guard whose third state is never
 * observed at the boundary is a two-state guard with a comment. `gate.sh` reads
 * the code and nothing else, so the code is the part that must be pinned.
 *
 * `scripts/check-file-size.mjs` has the same gap and is NOT fixed here — named
 * rather than quietly carried, since it is a sibling's file and its own change.
 */
export function main(argv, lister = productionFiles) {
  let result;
  try {
    result = audit(FORGE_ROOT, parseOverrides(argv), lister);
  } catch (err) {
    // A real bug is not a refusal (§15.504's other half, and the half that is
    // easy to lose): if every error became CANNOT-MEASURE, a genuine defect in
    // this checker would report "could not measure" forever and nobody would
    // look. Only the corpus read refuses; everything else is still a FAIL.
    if (err instanceof CorpusUnreadable) {
      console.error(
        `check-package-caps: REFUSED — ${err.message}\n` +
        `  The corpus changed between the listing and the read, so there is no total to compare\n` +
        `  against a cap. Exiting ${EXIT_CANNOT_MEASURE} (REFUSED) rather than 1, which would mean\n` +
        `  "a package is over its cap" — and a partial sum is SMALLER than the truth, so a cap\n` +
        `  compared against it passes on absence (forge-8vfn.28).`,
      );
      return EXIT_CANNOT_MEASURE;
    }
    console.error(`check-package-caps: FAIL — ${err.message}`);
    return 1;
  }
  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return result.breaches.length || result.unmeasured.length || result.uncapped.length || result.noteViolations.length ? 1 : 0;
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
  for (const v of result.noteViolations) {
    console.error(`check-package-caps: \`${v.name}\`'s QUARRY.md cap-table note ${v.reason}`);
  }
  const bad = result.breaches.length + result.unmeasured.length + result.uncapped.length + result.noteViolations.length;
  if (bad > 0) {
    console.error(
      'check-package-caps: FAIL — a package over its cap parks for a cull, a split, or an operator-ratified new cap (QUARRY.md). Never a silent raise.',
    );
    return 1;
  }
  console.log(`check-package-caps: PASS — ${rows.length} packages, every one within its ratified QUARRY.md cap`);
  return 0;
}

// `process.exitCode`, never `process.exit()` — see check-raw-fs-guarded.mjs's
// note: `process.exit()` truncates a piped stdout that has not drained.
if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
