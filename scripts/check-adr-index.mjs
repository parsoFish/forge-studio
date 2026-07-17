#!/usr/bin/env node
/**
 * check-adr-index.mjs — ADR-index completeness guard for docs/decisions/.
 *
 * Verifies docs/decisions/README.md accurately indexes every ADR file on
 * disk. "prove-or-warn" style like scripts/verify-cycle.mjs's gates: plain
 * node, no deps, fail = non-zero exit + one actionable line per violation.
 *
 * Checks:
 *   1. every on-disk numbered ADR (docs/decisions/NNN-*.md) has exactly one
 *      row, in either the Active table or the Retired/folded table;
 *   2. every Active row links to a file that exists on disk, and the linked
 *      filename's number matches the row's own number column;
 *   3. every Retired row's number has NO on-disk file — retired numbers stay
 *      reserved and are never reused (verified against the current repo:
 *      005/014/016/023 are retired and none of those files exist);
 *   4. no ADR number is double-booked across the two tables;
 *   5. the "next free: **NNN**" line equals max(on-disk numbers) + 1.
 *
 * Usage: node scripts/check-adr-index.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DECISIONS_DIR = join(FORGE_ROOT, 'docs/decisions');
const README_PATH = join(DECISIONS_DIR, 'README.md');

const ADR_FILE_RE = /^(\d{3})-.+\.md$/;

function onDiskAdrs() {
  return readdirSync(DECISIONS_DIR)
    .map((name) => ({ name, m: name.match(ADR_FILE_RE) }))
    .filter((f) => f.m)
    .map((f) => ({ number: f.m[1], file: f.name }))
    .sort((a, b) => a.number.localeCompare(b.number));
}

/** Slice out just the table-row lines (start with "|", skip the header
 *  separator row) between a section heading and the next "## " heading (or
 *  end of file). */
function tableRows(lines, headingPredicate) {
  const start = lines.findIndex(headingPredicate);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start + 1, end).filter((l) => l.trim().startsWith('|') && !/^\|\s*-+\s*\|/.test(l));
}

function parseReadme(text) {
  const lines = text.split('\n');

  const activeRows = tableRows(lines, (l) => l.trim() === '## Active');
  if (activeRows === null) throw new Error('docs/decisions/README.md is missing the "## Active" section heading');
  const retiredRows = tableRows(lines, (l) => l.trim().startsWith('## Retired'));
  if (retiredRows === null) throw new Error('docs/decisions/README.md is missing the "## Retired" section heading');

  // Active row: | [NNN](./NNN-slug.md) | Title | Role |
  const activeRowRe = /^\|\s*\[(\d{3})\]\(\.\/([^)]+\.md)\)\s*\|/;
  const active = [];
  for (const line of activeRows) {
    const m = line.match(activeRowRe);
    if (m) active.push({ number: m[1], file: m[2].replace(/^\.\//, '') });
  }

  // Retired row: | NNN | Was | Where the surviving intent lives | (no link)
  const retiredRowRe = /^\|\s*(\d{3})\s*\|/;
  const retired = [];
  for (const line of retiredRows) {
    const m = line.match(retiredRowRe);
    if (m) retired.push({ number: m[1] });
  }

  const nextFreeMatch = text.match(/next free:\s*\*\*(\d+)\*\*/);
  const nextFree = nextFreeMatch ? parseInt(nextFreeMatch[1], 10) : null;

  return { active, retired, nextFree };
}

function findDuplicates(rows) {
  const seen = new Map();
  const dupes = new Set();
  for (const { number } of rows) {
    if (seen.has(number)) dupes.add(number);
    seen.set(number, true);
  }
  return dupes;
}

function main() {
  const violations = [];
  const onDisk = onDiskAdrs();
  const readmeText = readFileSync(README_PATH, 'utf8');
  const { active, retired, nextFree } = parseReadme(readmeText);

  const onDiskNumbers = new Set(onDisk.map((a) => a.number));
  const activeNumbers = new Set(active.map((a) => a.number));
  const retiredNumbers = new Set(retired.map((r) => r.number));

  // 1. every on-disk ADR has a row (Active or Retired)
  for (const { number, file } of onDisk) {
    if (!activeNumbers.has(number) && !retiredNumbers.has(number)) {
      violations.push(`on-disk ADR ${number} (${file}) has no row in docs/decisions/README.md (neither Active nor Retired) — add an Active row`);
    }
  }

  // 2. every Active row links to a real, matching-numbered file
  for (const { number, file } of active) {
    const fileMatch = file.match(ADR_FILE_RE);
    if (!fileMatch) {
      violations.push(`Active row ${number} links to "${file}", which doesn't look like a numbered ADR filename (NNN-slug.md)`);
      continue;
    }
    if (fileMatch[1] !== number) {
      violations.push(`Active row ${number} links to "${file}" whose filename number (${fileMatch[1]}) doesn't match the row's own number (${number})`);
    }
    if (!onDiskNumbers.has(fileMatch[1])) {
      violations.push(`Active row ${number} links to "docs/decisions/${file}", which does not exist on disk`);
    }
  }

  // 3. retired numbers must have no on-disk file (numbers stay reserved, never reused)
  for (const { number } of retired) {
    if (onDiskNumbers.has(number)) {
      violations.push(`Retired row ${number} is marked retired (numbers stay reserved) but docs/decisions/${number}-*.md exists on disk — either it was reused without updating the README, or it belongs in the Active table`);
    }
  }

  // 4. no double-booking
  for (const number of activeNumbers) {
    if (retiredNumbers.has(number)) {
      violations.push(`ADR ${number} appears in BOTH the Active and Retired tables`);
    }
  }
  for (const number of findDuplicates(active)) {
    violations.push(`ADR ${number} has more than one row in the Active table`);
  }
  for (const number of findDuplicates(retired)) {
    violations.push(`ADR ${number} has more than one row in the Retired table`);
  }

  // 5. next free == max(on-disk) + 1
  const maxOnDisk = onDisk.length ? Math.max(...onDisk.map((a) => parseInt(a.number, 10))) : 0;
  const expectedNextFree = maxOnDisk + 1;
  const expectedNextFreeStr = String(expectedNextFree).padStart(3, '0');
  if (nextFree === null) {
    violations.push(`docs/decisions/README.md is missing the "next free: **NNN**" line`);
  } else if (nextFree !== expectedNextFree) {
    violations.push(`"next free" says **${String(nextFree).padStart(3, '0')}** but the highest on-disk ADR is ${String(maxOnDisk).padStart(3, '0')} — next free should be **${expectedNextFreeStr}**`);
  }

  if (violations.length) {
    console.error(`check-adr-index: FAIL (${violations.length} violation${violations.length === 1 ? '' : 's'})`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    process.exit(1);
  }

  console.log(`check-adr-index: PASS — ${onDisk.length} on-disk ADRs, ${active.length} active rows, ${retired.length} retired rows, next free **${expectedNextFreeStr}**`);
}

main();
