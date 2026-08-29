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
 * skills/**\/SKILL.md — enumerated with `git ls-files`, so only TRACKED files
 * count. A checker must scan the REPO, not the working directory: walking the
 * tree made this gate red on the operator's checkout (gitignored local notes
 * under docs/investigations/) and green on CI, which teaches operators to
 * ignore it.
 *
 * NOT scanned — record-type files. Each of these documents the decision to
 * retire these things and must keep saying so; the exclusion is by explicit
 * name (never a blanket tree under docs/roadmaps/) so a NEW roadmap doc is
 * policed from the day it lands.
 *
 * Usage: node scripts/check-identity.mjs [rootDir]   (default: repo root)
 * Exit 0 = zero hits. Exit 1 = one or more hits, listed path:line.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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
]);

/** The scanned roots: a git pathspec, and which of its tracked files count. */
const SCANNED = [
  { pathspec: ['CLAUDE.md', 'README.md', 'ARCHITECTURE.md'], keep: () => true },
  { pathspec: ['docs'], keep: (p) => p.endsWith('.md') || p.endsWith('.json') },
  { pathspec: ['skills'], keep: (p) => p.endsWith('SKILL.md') },
];

const rootArg = process.argv[2];
const ROOT = rootArg
  ? resolve(rootArg)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..');

const rel = (abs) => relative(ROOT, abs).split(sep).join('/');

function isExcluded(relPath) {
  if (EXCLUDED_FILES.has(relPath)) return true;
  return EXCLUDED_TREES.some((t) => relPath === t || relPath.startsWith(`${t}/`));
}

/**
 * Tracked files under `pathspec`, repo-relative. A pathspec matching nothing
 * yields empty output at exit 0 (measured), so a root without a docs/ or
 * skills/ tree is simply empty; anything else — ROOT is not a git work tree,
 * git is missing — is a hard error, because a silent empty scan is a gate that
 * passes by scanning nothing.
 */
function trackedFiles(pathspec) {
  const r = spawnSync('git', ['ls-files', '-z', '--', ...pathspec], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.error) throw new Error(`check-identity: cannot run git in ${ROOT}: ${r.error.message}`);
  if (r.status !== 0) {
    throw new Error(`check-identity: git ls-files failed in ${ROOT} (exit ${r.status}): ${r.stderr.trim()}`);
  }
  return r.stdout.split('\0').filter(Boolean);
}

function scannedFiles() {
  const files = [];
  for (const { pathspec, keep } of SCANNED) {
    files.push(...trackedFiles(pathspec).filter(keep));
  }
  return files.filter((p) => !isExcluded(p)).map((p) => join(ROOT, p));
}

/**
 * Blank out the TARGET of a markdown link that points into an excluded tree,
 * leaving the link text and the surrounding prose fully scanned.
 *
 * Two real ADRs carry a retired token in their filename
 * (019-cycle-resume-from-unifier.md, 026-review-unifier-wi-list.md), and ADR
 * filenames are append-only history. Without this, citing one is a lint hit,
 * and the cheapest way to go green is to DE-LINK the citation — the guard
 * degrading the docs it exists to protect. Masking is target-only, so
 * retired vocabulary in the prose beside the link is still caught.
 */
function maskExcludedLinkTargets(text, fileAbs) {
  return text.replace(/\]\(([^)\s]+)/g, (whole, target) => {
    if (/^[a-z]+:/i.test(target)) return whole; // external URL — not a repo path
    const clean = target.split(/[#?]/)[0];
    if (!clean) return whole;
    const resolved = rel(resolve(dirname(fileAbs), clean));
    return isExcluded(resolved) ? `](${'\u0000'.repeat(target.length)}` : whole;
  });
}

function scan() {
  const hits = [];
  const files = scannedFiles();
  for (const abs of files) {
    const lines = readFileSync(abs, 'utf8').split('\n');
    lines.forEach((raw, i) => {
      const text = maskExcludedLinkTargets(raw, abs);
      TOKEN_RE.lastIndex = 0;
      let m;
      while ((m = TOKEN_RE.exec(text)) !== null) {
        hits.push({ file: rel(abs), line: i + 1, token: m[1].toLowerCase(), text: raw.trim() });
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
    'Retired vocabulary (spec §2). Current-state docs name what exists TODAY:',
  );
  console.log(
    '  orchestrator/phases/demo-agent.ts (demo/capture) · orchestrator/phases/adversarial-review.ts (findings/verdict)',
  );
  console.log(
    "  · \"the develop flow's successor band\" when the passage covers both · the example develop factory · forge-studio · the KbBackend seam (ADR 018).",
  );
  console.log(
    '  Do NOT write \"the integrate band\": spec §5 lists it as 1.0-TARGET work, so naming it in a current-state doc invents a claim.',
  );
  process.exit(1);
}
