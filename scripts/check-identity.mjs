#!/usr/bin/env node
/**
 * check-identity — the retired-vocabulary gate.
 *
 * Spec §2 (docs/superpowers/specs/2026-08-28-forge-1-0-blueprint-design.md):
 * forge has one name, forge-studio, and "ideas machine", "forge v2",
 * "unifier" and "zep" are retired. A fresh session must not be able to learn
 * a retired concept from the repo's own instructions, so this lint fails CI
 * when a CURRENT-STATE doc, skill or README still narrates one of them.
 *
 * Scanned: CLAUDE.md, README.md, ARCHITECTURE.md, docs/**\/*.{md,json},
 * skills/**\/SKILL.md.
 *
 * NOT scanned — record-type files. Each of these documents the decision to
 * retire these things and must keep saying so; the exclusion is by explicit
 * name (never a blanket tree under docs/roadmaps/) so a NEW roadmap doc is
 * policed from the day it lands.
 *
 * Usage: node scripts/check-identity.mjs [rootDir]   (default: repo root)
 * Exit 0 = zero hits. Exit 1 = one or more hits, listed path:line.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOKENS = ['unifier', 'ideas machine', 'forge v2', 'zep'];
const TOKEN_RE = new RegExp(`\\b(${TOKENS.join('|')})\\b`, 'gi');

/** Trees that are records of decisions taken, not statements of current state. */
const EXCLUDED_TREES = [
  'docs/decisions', // ADRs — append-only; they record the retirements themselves
  'docs/superpowers/specs', // design records; the 1.0 blueprint names what it retires
];

/** Individual record files, each with the reason it is not current-state prose. */
const EXCLUDED_FILES = new Map([
  ['docs/roadmaps/1.0.md', 'the active plan — it names the retired tokens as tokens'],
  ['docs/roadmaps/1.0-kickoffs.md', 'the active plan’s kickoff prompts'],
  ['docs/roadmaps/README.md', 'the R1–R8 record of what was built (1.0.md §7); archived in M6'],
  ['docs/roadmaps/R1-contract-componentry.md', 'R1–R8 record; archived in M6'],
  ['docs/roadmaps/R2-runnable-componentry.md', 'R1–R8 record; archived in M6'],
  ['docs/roadmaps/R4-ootb-suite.md', 'R1–R8 record; archived in M6'],
  ['docs/roadmaps/R5-hardening-operability.md', 'R1–R8 record; archived in M6'],
  ['docs/roadmaps/wave-7-walkthrough-findings.md', 'a closed wave’s findings record'],
]);

/** Directory names never worth walking, wherever they appear. */
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '_worktrees', 'projects', 'dist', 'coverage']);

const rootArg = process.argv[2];
const ROOT = rootArg
  ? resolve(rootArg)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..');

const rel = (abs) => relative(ROOT, abs).split(sep).join('/');

function isExcluded(relPath) {
  if (EXCLUDED_FILES.has(relPath)) return true;
  return EXCLUDED_TREES.some((t) => relPath === t || relPath.startsWith(`${t}/`));
}

function walk(absDir, out) {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return; // a scanned root that does not exist in this tree is simply empty
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.github') continue;
    const abs = join(absDir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(abs, out);
    } else if (e.isFile()) {
      out.push(abs);
    }
  }
}

function scannedFiles() {
  const files = [];

  for (const name of ['CLAUDE.md', 'README.md', 'ARCHITECTURE.md']) {
    const abs = join(ROOT, name);
    try {
      if (statSync(abs).isFile()) files.push(abs);
    } catch {
      /* absent in this tree */
    }
  }

  const docs = [];
  walk(join(ROOT, 'docs'), docs);
  files.push(...docs.filter((f) => f.endsWith('.md') || f.endsWith('.json')));

  const skills = [];
  walk(join(ROOT, 'skills'), skills);
  files.push(...skills.filter((f) => f.endsWith('SKILL.md')));

  return files.filter((f) => !isExcluded(rel(f)));
}

function scan() {
  const hits = [];
  const files = scannedFiles();
  for (const abs of files) {
    const lines = readFileSync(abs, 'utf8').split('\n');
    lines.forEach((text, i) => {
      TOKEN_RE.lastIndex = 0;
      let m;
      while ((m = TOKEN_RE.exec(text)) !== null) {
        hits.push({ file: rel(abs), line: i + 1, token: m[1].toLowerCase(), text: text.trim() });
      }
    });
  }
  return { hits, scanned: files.length };
}

const { hits, scanned } = scan();
for (const h of hits) {
  console.log(`${h.file}:${h.line}: ${h.token} — ${h.text.slice(0, 120)}`);
}
const files = new Set(hits.map((h) => h.file)).size;
console.log(`check-identity: ${hits.length} hit(s) in ${files} file(s) (scanned ${scanned} files)`);
if (hits.length > 0) {
  console.log(
    'Retired vocabulary (spec §2): use the integrate band / the review agent / the example develop factory / forge-studio / the KbBackend seam.',
  );
  process.exit(1);
}
