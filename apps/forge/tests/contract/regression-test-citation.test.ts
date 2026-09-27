/**
 * Contract: every tracked regression test names the incident it pins.
 *
 * Every file under a package's `tests/regression/` directory is reserved
 * for a test that pins a REAL,
 * already-observed defect or incident (a PR fix, a bead, a measured
 * failure) — never a plain behaviour/unit test filed there by habit (that
 * belongs in the package's own `unit/`/`integration/` tier). A regression
 * file that names no incident is undiscoverable the day someone asks "why
 * does this exist, can I delete it?" — the answer must live in the file,
 * not in whoever's memory filed it.
 *
 * `CONCRETE_CITATION_RE` requires an artifact a reader can actually go look
 * up: a GitHub PR number (`#123`), a bead id (`forge-8vfn.6.10`), a 7+ hex
 * commit sha, or a roadmap section (`§15.4`) — never the loose prose words
 * ("ruling", "measured", "trace", "bead", "incident", "run 3") on their
 * own, which anyone can drop into a comment without naming anything a
 * reader can check.
 *
 * The scan is COMMENT-SCOPED (line + block comments only), not whole-file
 * text: a fixture literal that happens to look like a citation (an HTTP
 * header `x-forge-csrf`, a KB id `forge-dev`, a route path) must never
 * satisfy this contract — only prose the author actually wrote to explain
 * the file can. `extractComments` below is a deliberately crude text scan
 * (same documented-limits register as `packages/agents/tests/contract/
 * destroy-prunes-ledger.test.ts`'s own scanner) that skips string/template
 * literals so a citation-shaped fixture value is never mistaken for a
 * citation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** The ONE pattern this contract enforces — see the module header. */
const CONCRETE_CITATION_RE = /#\d+|forge-[a-z0-9]+(?:\.[0-9]+)*|[0-9a-f]{7,}|§15\.\d+/i;

/** Every tracked regression test file, repo-wide. */
function trackedRegressionTestFiles(): string[] {
  const out = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
  return out
    .split('\n')
    .filter((f) => /\/regression\/.*\.test\./.test(f))
    .sort();
}

/**
 * Pull out line comments and block comments, skipping the content of
 * single-quoted, double-quoted and template literals first so a
 * citation-shaped fixture value (a header name, a seeded KB id) is never
 * read as a citation. Crude (no real tokenizer — see the module header) but
 * sufficient: it only has to tell "this is prose the author wrote" from
 * "this is a string literal".
 */
function extractComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      let j = i + 2;
      while (j < n && src[j] !== '\n') j++;
      out += `${src.slice(i, j)}\n`;
      i = j;
      continue;
    }
    if (c === '/' && c2 === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      j = Math.min(j + 2, n);
      out += `${src.slice(i, j)}\n`;
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      let j = i + 1;
      while (j < n && src[j] !== quote) {
        if (src[j] === '\\') j++;
        j++;
      }
      i = j + 1;
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '`' && depth === 0) { j++; break; }
        if (src[j] === '$' && src[j + 1] === '{') { depth++; j += 2; continue; }
        if (src[j] === '}' && depth > 0) { depth--; j++; continue; }
        j++;
      }
      i = j;
      continue;
    }
    i++;
  }
  return out;
}

test('every tracked */tests/regression/*.test.* names a concrete citation in its own comments', () => {
  const files = trackedRegressionTestFiles();
  assert.ok(files.length > 100, `expected the real regression population, got ${files.length}`);

  const uncited = files.filter((f) => {
    const comments = extractComments(readFileSync(join(ROOT, f), 'utf8'));
    return !CONCRETE_CITATION_RE.test(comments);
  });

  assert.deepEqual(
    uncited,
    [],
    `${uncited.length} regression file(s) name no concrete citation (PR #, bead id, commit sha, or §15.n):\n${uncited.map((f) => `  - ${f}`).join('\n')}`,
  );
});
