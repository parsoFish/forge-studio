#!/usr/bin/env node
/**
 * alignment.mjs — forge-1rk5.2 (plan D7): does a story's `aligns` claim on an
 * ADR or brain theme still match what's on disk.
 *
 * MECHANISM ONLY. `aligns` entries (`story-file.mjs`'s `validateStory`) pin a
 * story to a doc by a content digest — the first 16 hex chars of its
 * sha256 — so drift is caught rather than assumed away. This module is the
 * gate that reads the CURRENT file and compares:
 *
 *   node scripts/stories/alignment.mjs                 the check: exit 1 on
 *                                                        any drift, 0 with a
 *                                                        summary otherwise
 *   node scripts/stories/alignment.mjs --intake <sha>   report-only: names
 *                                                        any ADR/theme added
 *                                                        since <sha> that no
 *                                                        story cites yet
 *                                                        (always exits 0)
 *
 * `checkAlignment(repoRoot)` is PURE FILESYSTEM — no git — so it runs
 * unmodified against a mkdtemp synthetic repo in tests and against the real
 * one in CI. `intakeReport` is the one function here that shells to git,
 * because "added since a commit" is a git question by definition; it is
 * advisory only and never affects this module's exit code on its own.
 */
import {
  readFileSync, readdirSync, existsSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import {
  join, dirname, resolve,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadStory } from './story-file.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STORY_DIR_SEGMENTS = ['tests', 'stories'];
const OUT_OF_SCOPE_README = join(...STORY_DIR_SEGMENTS, 'grounds', 'README.md');

/** Repo-relative paths `--intake` scans: an ADR or a brain theme, top-level
 *  only (a nested dir under either would be a different kind of doc). */
const INTAKE_RE = /^(docs\/decisions\/[^/]+\.md|brain\/forge-dev\/themes\/[^/]+\.md)$/;

/** The one-line procedure every drift finding ends on. */
const REALIGN_PROCEDURE =
  "update the story/fixture to the changed learning, or record it as out of this story's scope, "
  + 're-stamp the digest in the same PR';

/**
 * The first 16 hex chars of the sha256 of `bytes` — the exact shape
 * `story-file.mjs` requires an `aligns[].digest` to be.
 */
export function digest16(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

function storyFiles(repoRoot) {
  const dir = join(repoRoot, ...STORY_DIR_SEGMENTS);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.story.mjs'))
    .sort()
    .map((f) => join(dir, f));
}

async function loadAllStories(repoRoot) {
  const stories = [];
  for (const file of storyFiles(repoRoot)) {
    stories.push(await loadStory(pathToFileURL(file).href));
  }
  return stories;
}

/**
 * Load every story under `repoRoot`'s `tests/stories/`, and for every
 * `aligns` entry it declares, compare the pinned digest against the cited
 * file's CURRENT one.
 *
 * Two ways to fail, both named on the story and the path so a red is never
 * read as a product defect: the cited file is MISSING, or its digest no
 * longer matches. Neither is fatal to the loop — one story's drift must not
 * hide a second story's, so every entry of every story is checked before
 * this returns.
 */
export async function checkAlignment(repoRoot) {
  const failures = [];
  let checked = 0;
  for (const story of await loadAllStories(repoRoot)) {
    for (const entry of story.aligns ?? []) {
      checked += 1;
      const target = join(repoRoot, entry.path);
      if (!existsSync(target)) {
        failures.push({
          storyId: story.id,
          path: entry.path,
          pinned: entry.digest,
          current: null,
          message:
            `${story.id} aligns to ${entry.path}, which is MISSING (pinned ${entry.digest}). `
            + `${REALIGN_PROCEDURE}.`,
        });
        continue;
      }
      const current = digest16(readFileSync(target));
      if (current !== entry.digest) {
        failures.push({
          storyId: story.id,
          path: entry.path,
          pinned: entry.digest,
          current,
          message:
            `${story.id} aligns to ${entry.path}: pinned ${entry.digest}, now ${current}. `
            + `${REALIGN_PROCEDURE}.`,
        });
      }
    }
  }
  return { ok: failures.length === 0, checked, failures: Object.freeze(failures) };
}

/**
 * Every path named under a `## Out of story scope` heading in
 * `tests/stories/grounds/README.md`, as a backtick-quoted repo-relative path
 * — one bullet per entry, ending at the next `## ` heading or EOF. Absent
 * heading reads as an empty set, never a throw: a fresh repo (or the
 * synthetic ones this module's own tests build) has not written the section
 * yet, and that is "nothing is out of scope", not an error.
 */
function parseOutOfScopeSection(readmeText) {
  const lines = readmeText.split('\n');
  const start = lines.findIndex((l) => l.trim() === '## Out of story scope');
  if (start === -1) return new Set();
  const names = new Set();
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) break;
    const m = lines[i].match(/`([^`]+)`/);
    if (m) names.add(m[1]);
  }
  return names;
}

/**
 * `--intake <sinceSha>` — report only, never a gate. Names every ADR or
 * brain theme `git diff --diff-filter=A` shows added between `sinceSha` and
 * HEAD that no story's `aligns` cites and the README's out-of-scope list
 * does not name — so a learning worth encoding does not silently outrun the
 * stories meant to absorb it, without turning "not yet aligned" into a red
 * build.
 */
export async function intakeReport(repoRoot, sinceSha) {
  const diffOut = execFileSync(
    'git',
    ['diff', '--diff-filter=A', '--name-only', `${sinceSha}..HEAD`],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  const added = diffOut.split('\n').map((l) => l.trim()).filter((l) => INTAKE_RE.test(l)).sort();

  const stories = await loadAllStories(repoRoot);
  const cited = new Set(stories.flatMap((s) => (s.aligns ?? []).map((a) => a.path)));

  const readmePath = join(repoRoot, OUT_OF_SCOPE_README);
  const outOfScope = existsSync(readmePath)
    ? parseOutOfScopeSection(readFileSync(readmePath, 'utf8'))
    : new Set();

  const unaligned = added.filter((p) => !cited.has(p) && !outOfScope.has(p));
  return { added, unaligned };
}

async function main(argv) {
  const intakeIdx = argv.indexOf('--intake');
  if (intakeIdx !== -1) {
    const sinceSha = argv[intakeIdx + 1];
    if (!sinceSha) {
      process.stdout.write('[alignment] --intake requires <since-sha>\n');
      return 1;
    }
    const { added, unaligned } = await intakeReport(ROOT, sinceSha);
    if (unaligned.length === 0) {
      process.stdout.write(`[alignment] intake since ${sinceSha}: ${added.length} doc(s) added, 0 unaligned.\n`);
    } else {
      process.stdout.write(
        `[alignment] intake since ${sinceSha}: ${unaligned.length} of ${added.length} added doc(s) no story `
        + 'cites in aligns and tests/stories/grounds/README.md does not name out of scope:\n',
      );
      for (const p of unaligned) process.stdout.write(`  - ${p}\n`);
    }
    // Report only — an unaligned finding here is a prompt for the next
    // planning pass, never a build failure.
    return 0;
  }

  const result = await checkAlignment(ROOT);
  if (result.ok) {
    process.stdout.write(`[alignment] OK — ${result.checked} aligns entr${result.checked === 1 ? 'y' : 'ies'} checked, 0 drifted.\n`);
    return 0;
  }
  process.stdout.write(`[alignment] FAILED — ${result.failures.length} of ${result.checked} aligns entries drifted:\n`);
  for (const f of result.failures) process.stdout.write(`  ${f.message}\n`);
  return 1;
}

// Run only when executed directly — helpers here are imported by tests, and
// an import must not run the check (same convention as check-file-size.mjs).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await main(process.argv.slice(2));
  process.exitCode = code;
}
