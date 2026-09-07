#!/usr/bin/env node
/**
 * check-adr-links.mjs — two-way `supersedes` / `amends` symmetry for docs/decisions/.
 *
 * Spec §4 "Docs": `decisions/` is append-only, with two-way links on the
 * amended records. A reader who lands on the SUPERSEDED ADR must learn that
 * from the ADR itself — a one-way link is only discoverable by having already
 * read the newer record, which is the reader who does not need it.
 *
 * "prove-or-warn" style like scripts/check-adr-index.mjs (which owns the
 * README index; this script owns the links between the records): plain node,
 * no deps, fail = non-zero exit + one actionable line per violation.
 *
 * A DECLARATION is a field at the start of a line — optionally bulleted —
 * whose bold name is Supersedes / Amends / Superseded-by / Amended-by (the
 * combined "Supersedes / amends" form counts as forward), carrying at least
 * one link to another ADR file. Prose that says "extends ADR 011" without a
 * link is NOT a declaration: the rule is about links, and policing prose
 * would demand body edits, which §4 forbids.
 *
 * Checks:
 *   1. every declared reference resolves to a file in docs/decisions/;
 *   2. A declares Supersedes B  =>  B declares Superseded-by A;
 *   3. A declares Amends B      =>  B declares Amended-by A.
 *
 * Usage: node scripts/check-adr-links.mjs [root]   (root defaults to the repo)
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(process.argv[2] ?? FORGE_ROOT);
const DECISIONS_DIR = join(root, 'docs/decisions');

const ADR_FILE_RE = /^(\d{3})-.+\.md$/;

/**
 * A field line: optional bullet, then the bold field name, then a colon INSIDE
 * the bold — which is what every real ADR header uses, and what keeps a bold
 * word mid-sentence ("**supersedes** the estimate") from being read as one.
 */
const FIELD_RE = /^\s*(?:[-*]\s*)?\*\*([A-Za-z][A-Za-z \/-]*?)\s*:\s*\*\*/;
/** Links to another ADR: [ADR 026](./026-slug.md) — the target is what matters. */
const ADR_LINK_RE = /\[[^\]]*\]\((?:\.\/)?(\d{3}-[^)]*\.md)\)/g;
/**
 * A field line often carries more links than it declares. ADR 026's line
 * amends 019 and then says "Builds on [ADR 021] … and [ADR 031]"; ADR 044's
 * amends a brain theme and only mentions 042 as the boundary it operates
 * inside. So: the FIRST ADR link is the declared target, and even that one
 * declares nothing when a non-declaring phrase introduces it. A back-link
 * demanded on either basis would make its ADR claim a relation nobody wrote.
 */
const NON_DECLARING_LEAD_IN = /\b(builds on|operates inside|relates to|needs no|see|cf\.?)\s*$/i;

/**
 * The converses a forward declaration will accept. The COMBINED
 * "Supersedes / amends" field is deliberately satisfied by either: ADR 043 and
 * ADR 044 both use it against ADR 042, but one supersedes a ruling and the
 * other amends one — forcing a single converse would make the back-link say
 * something the record does not mean.
 */
const FORWARD = {
  supersedes: ['Superseded-by'],
  amends: ['Amended-by'],
  'supersedes-or-amends': ['Superseded-by', 'Amended-by'],
};

/** Normalises the field name; "Amended by" and "Amended-by" are one field. */
function fieldKind(name) {
  const n = name.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/^superseded[ -]by$/.test(n)) return 'superseded-by';
  if (/^amended[ -]by$/.test(n)) return 'amended-by';
  if (/^supersedes \/ amends$/.test(n)) return 'supersedes-or-amends';
  if (/^supersedes$/.test(n)) return 'supersedes';
  if (/^amends$/.test(n)) return 'amends';
  return null;
}

function onDiskAdrs() {
  if (!existsSync(DECISIONS_DIR)) return [];
  return readdirSync(DECISIONS_DIR)
    .filter((name) => ADR_FILE_RE.test(name))
    .sort();
}

/** Every declaration in one ADR: { kind, targets: [filename], line }. */
function declarations(file) {
  const out = [];
  const lines = readFileSync(join(DECISIONS_DIR, file), 'utf8').split('\n');
  for (const [i, line] of lines.entries()) {
    const m = line.match(FIELD_RE);
    if (!m) continue;
    const kind = fieldKind(m[1]);
    if (!kind) continue;
    ADR_LINK_RE.lastIndex = 0;
    const first = ADR_LINK_RE.exec(line);
    if (!first) continue;
    const leadIn = line.slice(m[0].length, first.index);
    if (NON_DECLARING_LEAD_IN.test(leadIn)) continue;
    out.push({ kind, targets: [first[1]], line: i + 1 });
  }
  return out;
}

function main() {
  const violations = [];
  const files = onDiskAdrs();
  const onDisk = new Set(files);
  const byFile = new Map(files.map((f) => [f, declarations(f)]));
  let pairs = 0;

  for (const [file, decls] of byFile) {
    for (const { kind, targets, line } of decls) {
      for (const target of targets) {
        // Check 1 — the reference resolves.
        if (!onDisk.has(target)) {
          violations.push(
            `${file}:${line} declares ${kind} of docs/decisions/${target}, which does not exist on disk`,
          );
          continue;
        }
        if (!(kind in FORWARD)) continue; // a back-link needs no back-link of its own
        pairs++;

        // Checks 2 and 3 — the target declares a converse, pointing back here.
        const wanted = FORWARD[kind];
        const wantedKinds = wanted.map((w) => w.toLowerCase());
        const back = (byFile.get(target) ?? []).some(
          (d) => wantedKinds.includes(d.kind) && d.targets.includes(file),
        );
        if (!back) {
          const options = wanted.map((w) => `\`**${w}:** [ADR ${file.slice(0, 3)}](./${file})\``).join(' or ');
          violations.push(
            `docs/decisions/${target} is missing its back-link: ${file}:${line} declares ${kind} of it, so ${target} needs a ${options} line`,
          );
        }
      }
    }
  }

  const summary = `${pairs} linked pair${pairs === 1 ? '' : 's'}`;
  if (violations.length) {
    console.error(`check-adr-links: FAIL (${violations.length} violation${violations.length === 1 ? '' : 's'}) — ${summary} declared`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    // `process.exitCode` + `return`, never `process.exit()`: the violation list
    // is unbounded and `process.exit()` tears the process down before a piped
    // stdout has drained (see check-raw-fs-guarded.mjs).
    process.exitCode = 1;
    return;
  }

  console.log(`check-adr-links: PASS — ${files.length} ADRs, ${summary}, every reference resolves and links both ways`);
}

main();
