#!/usr/bin/env node
/**
 * check-decisions.mjs — every DECISIONS.md row names an enforcement that exists.
 *
 * DECISIONS.md is the repo-root ledger of standing decisions. A decision that
 * names no enforcement is a wish; one that names a path which has since been
 * deleted is a lie. This guard makes the "Enforced by" column provable: each
 * entry is either the literal `review` (a human gate, by definition) or a
 * repo-relative path that exists on disk. Absence of the file is never a pass.
 *
 * "prove-or-warn" style like scripts/check-docs-shape.mjs: plain node, no
 * deps, fail = non-zero exit + one actionable line per violation.
 *
 * Shape:
 *   ## Decisions                   | ID | Decision | Why | Enforced by |   IDs D-<n>
 *   ## Rejected — don't re-propose | ID | Rejected | Why |                 IDs R-<n>
 *
 * Rules:
 *   1. both headings present, each followed by a table whose header row
 *      matches the columns above (case-insensitive, trimmed);
 *   2. every ID matches its table's pattern; IDs are unique across BOTH
 *      tables, compared numerically per prefix (D-01 and D-1 are one id);
 *   3. every cell is non-empty;
 *   4. "Enforced by" is split on `;` or `,` (not inside parentheses). Each
 *      part, trimmed, with a trailing ` (note)` and surrounding backticks
 *      removed, is EITHER the literal `review` (case-sensitive) OR an
 *      existing repo-relative path (no `..`, not absolute, no `*` glob) OR a
 *      command starting `node `/`npm `/`npx ` whose FIRST path-like token
 *      (contains `/` or ends .mjs|.ts|.js) is such a path. Prose fails;
 *   5. at least one decision row (an empty ledger is a violation);
 *   6. the file never contains "aim for", "up to" or "use the budget"
 *      (case-insensitive): budgets are ceilings, never targets.
 *
 * Usage: node scripts/check-decisions.mjs [root]   (root defaults to the repo)
 * Exit:  0 pass · 1 violations (or DECISIONS.md missing) · 2 usage error
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DECISION_COLS = ['id', 'decision', 'why', 'enforced by'];
const REJECTED_COLS = ['id', 'rejected', 'why'];
const FORBIDDEN_PHRASES = ['aim for', 'up to', 'use the budget'];
const COMMAND_RE = /^(node|npm|npx)\s+(.*)$/;

const splitRow = (line) => {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
};

/** Find the table under the heading matching `headingRe`. */
function readTable(lines, headingRe, expectedCols) {
  const h = lines.findIndex((l) => headingRe.test(l));
  if (h === -1) return { found: false };
  let i = h + 1;
  while (i < lines.length && !lines[i].trim().startsWith('|') && !/^#{1,6}\s/.test(lines[i])) i++;
  if (i >= lines.length || !lines[i].trim().startsWith('|')) return { found: true, table: false, headingLine: h + 1 };
  const header = splitRow(lines[i]).map((c) => c.toLowerCase());
  const headerOk = header.length === expectedCols.length && expectedCols.every((c, k) => header[k] === c);
  const rows = [];
  for (let j = i + 2; j < lines.length && lines[j].trim().startsWith('|'); j++) {
    rows.push({ cells: splitRow(lines[j]), line: j + 1 });
  }
  return { found: true, table: true, headerOk, headerLine: i + 1, rows };
}

export function parseDecisions(markdown) {
  const lines = markdown.split(/\r?\n/);
  const errors = [];
  const decisions = [];
  const rejected = [];

  const d = readTable(lines, /^##\s+Decisions\s*$/i, DECISION_COLS);
  const r = readTable(lines, /^##\s+Rejected\b/i, REJECTED_COLS);

  const handle = (t, name, cols, sink) => {
    if (!t.found) return errors.push(`missing heading "## ${name}"`);
    if (!t.table) return errors.push(`"## ${name}" has no table under it`);
    if (!t.headerOk) {
      return errors.push(`line ${t.headerLine}: "## ${name}" table header must be | ${cols.join(' | ')} | (case-insensitive)`);
    }
    for (const { cells, line } of t.rows) sink(cells, line);
  };

  handle(d, 'Decisions', ['ID', 'Decision', 'Why', 'Enforced by'], (c, line) => {
    if (c.length !== 4) return errors.push(`line ${line}: Decisions row needs 4 cells, found ${c.length}`);
    decisions.push({ id: c[0], decision: c[1], why: c[2], enforcedBy: c[3], line });
  });
  handle(r, "Rejected — don't re-propose", ['ID', 'Rejected', 'Why'], (c, line) => {
    if (c.length !== 3) return errors.push(`line ${line}: Rejected row needs 3 cells, found ${c.length}`);
    rejected.push({ id: c[0], rejected: c[1], why: c[2], line });
  });
  return { decisions, rejected, errors };
}

/** Split on ; or , outside parentheses. */
function splitParts(s) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if ((ch === ';' || ch === ',') && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => p !== '');
}

const cleanPart = (p) => p.trim().replace(/\s*\([^()]*\)\s*$/, '').trim().replace(/^`+|`+$/g, '').trim();

const isSafePath = (p) => p !== '' && !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && !p.includes('*') &&
  !p.split('/').includes('..');

const looksLikePath = (tok) => tok.includes('/') || /\.(mjs|ts|js)$/.test(tok);

function partOk(part, exists) {
  if (part === 'review') return true;
  const cmd = COMMAND_RE.exec(part);
  if (cmd) {
    const tok = cmd[2].split(/\s+/).map((t) => t.replace(/^`+|`+$/g, '')).find(looksLikePath);
    return tok !== undefined && isSafePath(tok) && exists(tok);
  }
  if (/\s/.test(part)) return false;
  return isSafePath(part) && exists(part);
}

const idKey = (id) => {
  const m = /^([DR])-(\d+)$/.exec(id);
  return m ? `${m[1]}-${parseInt(m[2], 10)}` : null;
};

/** Pure core: returns the violation lines (empty = pass). */
export function checkDecisions({ markdown, exists }) {
  const { decisions, rejected, errors } = parseDecisions(markdown);
  const v = [...errors];
  const seen = new Map();

  const checkRow = (row, prefix, label, cells) => {
    const key = idKey(row.id);
    if (!new RegExp(`^${prefix}-\\d+$`).test(row.id)) {
      v.push(`${row.id || '(blank id)'}: line ${row.line}: id must match ${prefix}-<n>`);
    } else if (seen.has(key)) {
      v.push(`${row.id}: duplicate id (same as ${seen.get(key).id} on line ${seen.get(key).line})`);
    } else seen.set(key, row);
    cells.forEach(([name, val]) => {
      if (val.trim() === '') v.push(`${row.id || '(blank id)'}: empty cell "${name}" (line ${row.line})`);
    });
    return label;
  };

  for (const r of decisions) {
    checkRow(r, 'D', 'decision', [['ID', r.id], ['Decision', r.decision], ['Why', r.why], ['Enforced by', r.enforcedBy]]);
    for (const raw of splitParts(r.enforcedBy)) {
      const part = cleanPart(raw);
      if (!partOk(part, exists)) {
        v.push(`${r.id}: "Enforced by" part "${part}" is neither \`review\` nor an existing path`);
      }
    }
  }
  for (const r of rejected) {
    checkRow(r, 'R', 'rejected', [['ID', r.id], ['Rejected', r.rejected], ['Why', r.why]]);
  }

  if (decisions.length === 0 && errors.length === 0) v.push('no decision rows — an empty ledger is not a pass');

  markdown.split(/\r?\n/).forEach((text, i) => {
    const low = text.toLowerCase();
    for (const phrase of FORBIDDEN_PHRASES) {
      if (new RegExp(`\\b${phrase}\\b`).test(low)) {
        v.push(`line ${i + 1}: contains "${phrase}" — budgets are ceilings, never targets`);
      }
    }
  });
  return v;
}

function counts(markdown) {
  const { decisions, rejected } = parseDecisions(markdown);
  const reviewOnly = decisions.filter((d) => splitParts(d.enforcedBy).every((p) => cleanPart(p) === 'review')).length;
  return { d: decisions.length, r: rejected.length, c: decisions.length - reviewOnly, v: reviewOnly };
}

function main(argv) {
  if (argv.length > 1) {
    console.error('usage: node scripts/check-decisions.mjs [root]');
    return 2;
  }
  const root = resolve(argv[0] ?? FORGE_ROOT);
  const file = join(root, 'DECISIONS.md');
  if (!existsSync(file)) {
    console.log(`DECISIONS.md not found at ${root}`);
    console.log('check-decisions: FAIL — 1 violation(s)');
    return 1;
  }
  const markdown = readFileSync(file, 'utf8');
  const violations = checkDecisions({ markdown, exists: (p) => existsSync(join(root, p)) });
  if (violations.length > 0) {
    for (const line of violations) console.log(line);
    console.log(`check-decisions: FAIL — ${violations.length} violation(s)`);
    return 1;
  }
  const n = counts(markdown);
  console.log(`check-decisions: PASS — ${n.d} decisions, ${n.r} rejected, ${n.c} check-enforced, ${n.v} review-only`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
