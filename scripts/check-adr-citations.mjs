#!/usr/bin/env node
/**
 * check-adr-citations — citations of the retiring decision records
 * (`docs/decisions/`), as a shrinking ratchet. Same idiom as
 * check-stale-path-citations: a committed baseline that may only shrink.
 *
 * A CITATION is `ADR 028`, `ADR-046`, `ADRs 011–013`, `ADR 028 §3`, or the
 * path fragment `docs/decisions/` (CITATION_RE; case-sensitive, so an
 * identifier like `loadReader` never matches). Cite DECISIONS.md D-xx or
 * SPEC.md §n instead.
 *
 * SCOPE: `git ls-files` (run with cwd = root) minus EXCLUDED, minus binary
 * files (a NUL in the first 8 KB). CHANGELOG.md is scoped, not excluded:
 * only the `## [1.0.0] - Unreleased` section counts; the rest is history.
 *
 * BASELINE: scripts/check-adr-citations.baseline.json
 *   { "files": { "<path>": <count> }, "total": <sum> }  sorted by path.
 *
 * CHECK (default): exit 1 on
 *   NEW   a file absent from the baseline has >=1 citation
 *   GREW  a baselined file's count rose
 *   STALE a baselined file's count fell (or hit 0) — the ratchet must be
 *         re-recorded with --write so it can never climb back. This mirrors
 *         check-stale-path-citations, which also fails an unrecorded shrink.
 *
 * --write   rewrite the baseline from current counts; REFUSES (exit 1,
 *           writes nothing) if any file is new or grew. With NO baseline on
 *           disk the first write creates it from current counts.
 * --root <dir>        repo root (tests use a temp git repo)
 * --list-exclusions   print EXCLUDED with owners and reasons
 * --list-residual     print excluded-but-citing files (path, count, owner)
 * Usage errors exit 2.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CITATION_RE = /\bADRs?[- ]?\d{1,3}\b|docs\/decisions\//;

const BASELINE_REL = 'scripts/check-adr-citations.baseline.json';
const CHANGELOG = 'CHANGELOG.md';
const CHANGELOG_START = /^## \[1\.0\.0\] - Unreleased\s*$/;
const CHANGELOG_NEXT = /^## \[/;

/** `path` ending `/**` excludes the subtree; otherwise an exact file. */
export const EXCLUDED = [
  { path: 'docs/decisions/**', owner: 'W1 (this lane)', reason: 'the records themselves — retired in the same lane' },
  { path: 'tests/stories/**', owner: 'W3 (stories workstream)', reason: 'until W3 (stories workstream) — temporary; W3 widens this scope' },
  { path: 'scripts/stories/**', owner: 'W3 (stories workstream)', reason: 'until W3 (stories workstream) — story harness, edited only by W3/W6 (DOCS-COMMON §3); temporary' },
  { path: 'demos/**', owner: 'W3 (stories workstream)', reason: 'until W3 (stories workstream) — temporary; W3 widens this scope' },
  { path: 'brain/cycles/_raw/**', owner: 'W8 (Brain-1 workstream)', reason: 'history — cycle archives' },
  { path: 'brain/_raw/**', owner: 'W8 (Brain-1 workstream)', reason: 'history — raw archives' },
  { path: 'brain/forge-dev/**', owner: 'W8 (Brain-1 workstream)', reason: 'Brain 1 forge-engineering knowledge' },
  { path: 'brain/packs/**', owner: 'W8 (Brain-1 workstream)', reason: 'Brain-1 packs' },
  { path: 'packages/kernel/tests/test-fixtures/spawn-capture/pm.json', owner: 'W8 (Brain-1 workstream)', reason: 'captures the Brain-1 index text verbatim; clears when W8 moves Brain 1 out' },
  { path: 'packages/kernel/tests/test-fixtures/spawn-capture/reflector.json', owner: 'W8 (Brain-1 workstream)', reason: 'captures the Brain-1 index text verbatim; clears when W8 moves Brain 1 out' },
  { path: 'scripts/check-adr-citations.mjs', owner: 'W1', reason: 'this check cites the pattern by necessity' },
  { path: 'scripts/check-adr-citations.test.ts', owner: 'W1', reason: 'this check cites the pattern by necessity' },
  { path: BASELINE_REL, owner: 'W1', reason: 'this check\'s own data' },
];

export function exclusionFor(path) {
  return EXCLUDED.find((e) =>
    e.path.endsWith('/**') ? path.startsWith(e.path.slice(0, -2)) : path === e.path,
  );
}

function isBinary(abs) {
  const fd = openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const n = readSync(fd, buf, 0, 8192, 0);
    return buf.subarray(0, n).includes(0);
  } finally {
    closeSync(fd);
  }
}

export function countIn(text) {
  const g = new RegExp(CITATION_RE.source, 'g');
  return (text.match(g) ?? []).length;
}

function changelogSection(text) {
  const out = [];
  let inside = false;
  for (const line of text.split('\n')) {
    if (CHANGELOG_START.test(line)) { inside = true; out.push(line); continue; }
    if (inside && CHANGELOG_NEXT.test(line)) break;
    if (inside) out.push(line);
  }
  return out.join('\n');
}

/** @returns {{counts: Map<string, number>, residual: Map<string, number>}} */
export function scan(root) {
  const listed = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 1 << 28 })
    .toString('utf8').split('\0').filter(Boolean);
  const counts = new Map();
  const residual = new Map();
  for (const p of listed) {
    const abs = join(root, p);
    if (!existsSync(abs) || isBinary(abs)) continue;
    let text = readFileSync(abs, 'utf8');
    if (p === CHANGELOG) text = changelogSection(text);
    const n = countIn(text);
    if (n === 0) continue;
    (exclusionFor(p) ? residual : counts).set(p, n);
  }
  return { counts, residual };
}

function readBaseline(path) {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!parsed || typeof parsed.files !== 'object' || parsed.files === null) {
    throw new Error(`${path}: expected { files: {path: count}, total }`);
  }
  return parsed.files;
}

const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
const byPath = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function serialise(map) {
  const files = {};
  for (const k of [...map.keys()].sort(byPath)) files[k] = map.get(k);
  return `${JSON.stringify({ files, total: sum(map) }, null, 2)}\n`;
}

/** Violations that --write must refuse and the check must fail on. */
function growth(counts, base) {
  const out = [];
  for (const [p, n] of [...counts].sort(([a], [b]) => byPath(a, b))) {
    if (!(p in base)) out.push(`NEW — ${p} cites a decision record (${n}); cite DECISIONS.md D-xx or SPEC.md §n instead`);
    else if (n > base[p]) out.push(`GREW — ${p} ${base[p]} → ${n}`);
  }
  return out;
}

function main(argv) {
  const known = new Set(['--write', '--root', '--list-exclusions', '--list-residual']);
  let root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') {
      if (!argv[i + 1]) { process.stderr.write('check-adr-citations: --root needs a directory\n'); return 2; }
      root = resolve(argv[++i]);
    } else if (!known.has(a)) {
      process.stderr.write(`check-adr-citations: unknown argument ${a}\n`);
      return 2;
    }
  }
  if (argv.includes('--list-exclusions')) {
    for (const e of EXCLUDED) process.stdout.write(`${e.path}  [${e.owner}]  ${e.reason}\n`);
    process.stdout.write(`${CHANGELOG}  [W1]  only the "## [1.0.0] - Unreleased" section counts; the rest is history\n`);
    return 0;
  }

  const { counts, residual } = scan(root);
  if (argv.includes('--list-residual')) {
    for (const [p, n] of [...residual].sort(([a], [b]) => byPath(a, b))) {
      process.stdout.write(`${p}\t${n}\t${exclusionFor(p).owner}\n`);
    }
    return 0;
  }

  const baselinePath = join(root, BASELINE_REL);
  const base = readBaseline(baselinePath);

  if (argv.includes('--write')) {
    if (base !== null) {
      const bad = growth(counts, base);
      if (bad.length > 0) {
        process.stderr.write(`${bad.join('\n')}\ncheck-adr-citations: REFUSED — the baseline only shrinks; nothing written\n`);
        return 1;
      }
    }
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, serialise(counts));
    process.stdout.write(`check-adr-citations: baseline written — ${base ? sum(new Map(Object.entries(base))) : 'none'} → ${sum(counts)} citation(s) in ${counts.size} file(s)\n`);
    return 0;
  }

  const b = base ?? {};
  const violations = growth(counts, b);
  const baseTotal = sum(new Map(Object.entries(b)));
  const shrunk = Object.keys(b).some((p) => (counts.get(p) ?? 0) < b[p]);
  if (violations.length > 0) {
    process.stdout.write(`${violations.join('\n')}\n`);
    return 1;
  }
  if (shrunk) {
    process.stdout.write(`STALE — run node scripts/check-adr-citations.mjs --write (baseline ${baseTotal} → ${sum(counts)})\n`);
    return 1;
  }
  const total = sum(counts);
  process.stdout.write(total === 0
    ? 'check-adr-citations: PASS — 0 citations\n'
    : `check-adr-citations: PASS — ${total} citation(s) in ${counts.size} file(s) (baseline ${baseTotal})\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
