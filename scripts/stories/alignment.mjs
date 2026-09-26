#!/usr/bin/env node
/**
 * alignment.mjs — forge-1rk5.2 (plan D7), redesigned under T1 ruling 1593:
 * does a story's claim on an ADR or brain theme still match what's on disk.
 *
 * THE SIDECAR, AND WHY. `aligns` first lived as a top-level key inside the
 * story file itself, but `artifact-staleness.mjs` hashes a story file's raw
 * bytes to decide whether its demo artifacts are stale — so re-stamping a
 * digest inside the story file marked every one of its demos stale for a
 * change that touched no beat, no ground, no product surface. `aligns` now
 * lives in a SEPARATE tracked file, `tests/stories/<id>.aligns.json`, one per
 * story file, so pinning a doc's digest never perturbs the story's own bytes.
 * `story-file.mjs`'s schema no longer carries the field at all — no dual
 * path, one place this is validated.
 *
 * A sidecar is one of two shapes:
 *   { "aligns": [ { path, digest, why }, … ] }   — cites ADRs/themes
 *   { "aligns": "none", "reason": "<one line>" } — deliberately cites none
 *
 * ABSENT IS NEVER "UNALIGNED". A story with no sidecar at all is refused by
 * `checkAlignment` outright, distinctly from a story that explicitly encodes
 * none — the first is an omission, the second is a judgement call on record.
 *
 *   node scripts/stories/alignment.mjs                 the check: exit 1 on
 *                                                        any drift or missing
 *                                                        sidecar, 0 with a
 *                                                        summary otherwise
 *   node scripts/stories/alignment.mjs --intake <sha>   report-only: names
 *                                                        any ADR/theme added
 *                                                        since <sha> that no
 *                                                        sidecar cites yet,
 *                                                        plus the tracked
 *                                                        authoring targets
 *
 * `checkAlignment(repoRoot)` is PURE FILESYSTEM — no git — so it runs
 * unmodified against a mkdtemp synthetic repo in tests and against the real
 * one in CI. `intakeReport` is the one function here that shells to git.
 */
import {
  readFileSync, readdirSync, existsSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STORY_DIR_SEGMENTS = ['tests', 'stories'];
const OUT_OF_SCOPE_README = join(...STORY_DIR_SEGMENTS, 'grounds', 'README.md');

/** Repo-relative paths `--intake` scans: an ADR or a brain theme, top-level
 *  only (a nested dir under either would be a different kind of doc). */
const INTAKE_RE = /^(docs\/decisions\/[^/]+\.md|brain\/forge-dev\/themes\/[^/]+\.md)$/;

/** `aligns[].digest` — the first 16 hex chars of the cited file's sha256.
 *  Fixed length and case so a pinned digest is unambiguous to compare, never
 *  coerced. */
const ALIGN_DIGEST_RE = /^[0-9a-f]{16}$/;

/** The one-line procedure every drift finding ends on. */
const REALIGN_PROCEDURE =
  "update the story/fixture to the changed learning, or record it as out of this story's scope, "
  + 're-stamp the digest in the same PR';

/**
 * The first 16 hex chars of the sha256 of `bytes` — the exact shape a
 * sidecar's `aligns[].digest` must be.
 */
export function digest16(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

function storyIds(repoRoot) {
  const dir = join(repoRoot, ...STORY_DIR_SEGMENTS);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.story.mjs'))
    .map((f) => f.slice(0, -'.story.mjs'.length))
    .sort();
}

function sidecarPath(repoRoot, id) {
  return join(repoRoot, ...STORY_DIR_SEGMENTS, `${id}.aligns.json`);
}

function failSidecar(storyId, field, why) {
  throw new Error(`aligns sidecar for "${storyId}" is invalid — ${field}: ${why}`);
}

function requireOneLine(value, storyId, field, maxLen = 200) {
  if (typeof value !== 'string' || value.trim() === '') {
    failSidecar(storyId, field, `expected a non-empty string, got ${JSON.stringify(value)}`);
  }
  if (value.includes('\n')) {
    failSidecar(storyId, field, 'expected a single line, got a value containing a newline');
  }
  if (value.length > maxLen) {
    failSidecar(storyId, field, `expected at most ${maxLen} characters, got ${value.length}`);
  }
}

/**
 * Validate a raw, JSON-parsed sidecar object and return a frozen, normalised
 * shape: `{ kind: 'none', reason }` or `{ kind: 'entries', entries }`. The
 * only place `aligns`'s shape is checked — `story-file.mjs` carries no
 * knowledge of this field at all (T1 1593: no dual path).
 */
export function validateAlignsSidecar(raw, storyId) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    failSidecar(storyId, 'aligns', `expected an object, got ${JSON.stringify(raw)}`);
  }
  if (raw.aligns === 'none') {
    requireOneLine(raw.reason, storyId, 'reason');
    return Object.freeze({ kind: 'none', reason: raw.reason });
  }
  if (!Array.isArray(raw.aligns) || raw.aligns.length === 0) {
    failSidecar(
      storyId,
      'aligns',
      `expected "none" or a non-empty array of {path, digest, why}, got ${JSON.stringify(raw.aligns)}`,
    );
  }
  const entries = raw.aligns.map((entry, i) => {
    const at = `aligns[${i}]`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      failSidecar(storyId, at, `expected an object {path, digest, why}, got ${JSON.stringify(entry)}`);
    }
    if (typeof entry.path !== 'string' || entry.path.trim() === '') {
      failSidecar(storyId, `${at}.path`, `expected a non-empty string, got ${JSON.stringify(entry.path)}`);
    }
    if (entry.path.startsWith('/') || entry.path.split('/').includes('..')) {
      failSidecar(storyId, `${at}.path`, `expected a repo-relative path with no traversal, got ${JSON.stringify(entry.path)}`);
    }
    if (entry.path.split('/')[0] === '_1.0') {
      failSidecar(
        storyId,
        `${at}.path`,
        `refuses a path under _1.0/ (the gitignored campaign dir) — a permanent artifact must never cite a `
        + `path inside it, got ${JSON.stringify(entry.path)}`,
      );
    }
    if (typeof entry.digest !== 'string' || !ALIGN_DIGEST_RE.test(entry.digest)) {
      failSidecar(
        storyId,
        `${at}.digest`,
        `expected exactly 16 lowercase hex characters (the first 16 of the cited file's sha256), `
        + `got ${JSON.stringify(entry.digest)}`,
      );
    }
    requireOneLine(entry.why, storyId, `${at}.why`);
    return Object.freeze({ path: entry.path, digest: entry.digest, why: entry.why });
  });
  return Object.freeze({ kind: 'entries', entries: Object.freeze(entries) });
}

/** Read and validate one story's sidecar. `null` when the file is absent —
 *  the caller decides what an absent sidecar means (`checkAlignment` treats
 *  it as a hard failure; `intakeReport` simply has nothing to add to `cited`). */
function loadSidecar(repoRoot, id) {
  const p = sidecarPath(repoRoot, id);
  if (!existsSync(p)) return null;
  let raw;
  try {
    raw = JSON.parse(readFileSync(p, 'utf8'));
  } catch (err) {
    failSidecar(id, 'aligns', `tests/stories/${id}.aligns.json is not valid JSON: ${err.message}`);
  }
  return validateAlignsSidecar(raw, id);
}

/**
 * For every `tests/stories/*.story.mjs`, its sidecar must exist and, if it
 * cites entries, every cited digest must match the file's CURRENT one.
 *
 * THREE ways to fail, all named on the story (and the path, where there is
 * one) so a red is never read as a product defect: the sidecar is MISSING
 * (§6.15 — absent is never "unaligned"), the sidecar itself is malformed, or
 * a cited file is missing or its digest has drifted. None is fatal to the
 * loop — one story's problem must not hide a second story's.
 */
export function checkAlignment(repoRoot) {
  const failures = [];
  let checked = 0;
  for (const id of storyIds(repoRoot)) {
    if (!existsSync(sidecarPath(repoRoot, id))) {
      failures.push({
        storyId: id,
        path: null,
        pinned: null,
        current: null,
        message:
          `${id} has NO aligns sidecar (tests/stories/${id}.aligns.json) — absent is never "unaligned": `
          + 'every story must say so explicitly, with { "aligns": [...] } or { "aligns": "none", "reason": "…" }.',
      });
      continue;
    }
    let sidecar;
    try {
      sidecar = loadSidecar(repoRoot, id);
    } catch (err) {
      failures.push({
        storyId: id, path: null, pinned: null, current: null, message: err.message,
      });
      continue;
    }
    if (sidecar.kind === 'none') continue;
    for (const entry of sidecar.entries) {
      checked += 1;
      const target = join(repoRoot, entry.path);
      if (!existsSync(target)) {
        failures.push({
          storyId: id,
          path: entry.path,
          pinned: entry.digest,
          current: null,
          message:
            `${id} aligns to ${entry.path}, which is MISSING (pinned ${entry.digest}). `
            + `${REALIGN_PROCEDURE}.`,
        });
        continue;
      }
      const current = digest16(readFileSync(target));
      if (current !== entry.digest) {
        failures.push({
          storyId: id,
          path: entry.path,
          pinned: entry.digest,
          current,
          message:
            `${id} aligns to ${entry.path}: pinned ${entry.digest}, now ${current}. `
            + `${REALIGN_PROCEDURE}.`,
        });
      }
    }
  }
  return { ok: failures.length === 0, checked, failures: Object.freeze(failures) };
}

/**
 * Every LIST-BULLET line (`- ` or `* `, after trim) under `heading` in
 * `text`, as `{ paths, text }` — `paths` is every backtick-quoted repo-
 * relative path on that line (a line may name more than one, e.g. an ADR
 * paired with the theme it derives), `text` the line itself, bullet marker
 * stripped, for display. Ends at the next `## ` heading or EOF. An absent
 * heading returns `[]`, never a throw: a fresh repo has not written the
 * section yet, which is "nothing here", not an error.
 *
 * ONLY bullet lines, never prose: this section's own explanatory paragraph
 * cites `` `<id>.aligns.json` `` and the CLI invocation in backticks, and a
 * looser match over every backtick on every line would misread that prose as
 * a target/exclusion entry.
 */
function parseSection(text, heading) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) return [];
  const rows = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) break;
    const line = lines[i].trim();
    if (!/^[-*]\s/.test(line)) continue;
    const paths = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (paths.length > 0) rows.push({ paths, text: line.replace(/^[-*]\s*/, '') });
  }
  return rows;
}

function readmeSections(repoRoot) {
  const p = join(repoRoot, OUT_OF_SCOPE_README);
  const text = existsSync(p) ? readFileSync(p, 'utf8') : '';
  return {
    outOfScope: new Set(parseSection(text, '## Out of story scope').flatMap((r) => r.paths)),
    targets: parseSection(text, '## Alignment authoring targets'),
  };
}

/**
 * `--intake <sinceSha>` — report only, never a gate. Names every ADR or
 * brain theme `git diff --diff-filter=A` shows added between `sinceSha` and
 * HEAD that no sidecar cites and the README's out-of-scope list does not
 * name, plus the tracked authoring targets (the README's
 * `## Alignment authoring targets` section) minus anything a sidecar already
 * cites — so a learning worth encoding does not silently outrun the stories
 * meant to absorb it, without turning "not yet aligned" into a red build.
 *
 * A missing or malformed sidecar is `checkAlignment`'s failure to report, not
 * this function's — intake simply treats it as citing nothing.
 */
export function intakeReport(repoRoot, sinceSha) {
  const diffOut = execFileSync(
    'git',
    ['diff', '--diff-filter=A', '--name-only', `${sinceSha}..HEAD`],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  const added = diffOut.split('\n').map((l) => l.trim()).filter((l) => INTAKE_RE.test(l)).sort();

  const cited = new Set();
  for (const id of storyIds(repoRoot)) {
    let sidecar;
    try {
      sidecar = loadSidecar(repoRoot, id);
    } catch {
      continue;
    }
    if (sidecar?.kind === 'entries') for (const e of sidecar.entries) cited.add(e.path);
  }

  const { outOfScope, targets: allTargets } = readmeSections(repoRoot);
  const unaligned = added.filter((p) => !cited.has(p) && !outOfScope.has(p));
  const targets = allTargets.filter((t) => !t.paths.every((p) => cited.has(p)));
  return { added, unaligned, targets };
}

function main(argv) {
  const intakeIdx = argv.indexOf('--intake');
  if (intakeIdx !== -1) {
    const sinceSha = argv[intakeIdx + 1];
    if (!sinceSha) {
      process.stdout.write('[alignment] --intake requires <since-sha>\n');
      return 1;
    }
    const { added, unaligned, targets } = intakeReport(ROOT, sinceSha);
    if (unaligned.length === 0) {
      process.stdout.write(`[alignment] intake since ${sinceSha}: ${added.length} doc(s) added, 0 unaligned.\n`);
    } else {
      process.stdout.write(
        `[alignment] intake since ${sinceSha}: ${unaligned.length} of ${added.length} added doc(s) no sidecar `
        + 'cites and tests/stories/grounds/README.md does not name out of scope:\n',
      );
      for (const p of unaligned) process.stdout.write(`  - ${p}\n`);
    }
    if (targets.length === 0) {
      process.stdout.write('[alignment] authoring targets: 0 outstanding.\n');
    } else {
      process.stdout.write(`[alignment] authoring targets — ${targets.length} tracked, not yet cited by any sidecar:\n`);
      for (const t of targets) process.stdout.write(`  - ${t.text}\n`);
    }
    // Report only — a finding here is a prompt for the next planning pass,
    // never a build failure.
    return 0;
  }

  const result = checkAlignment(ROOT);
  if (result.ok) {
    process.stdout.write(`[alignment] OK — ${result.checked} aligns entr${result.checked === 1 ? 'y' : 'ies'} checked, 0 drifted.\n`);
    return 0;
  }
  process.stdout.write(`[alignment] FAILED — ${result.failures.length} finding(s):\n`);
  for (const f of result.failures) process.stdout.write(`  ${f.message}\n`);
  return 1;
}

// Run only when executed directly — helpers here are imported by tests, and
// an import must not run the check (same convention as check-file-size.mjs).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
