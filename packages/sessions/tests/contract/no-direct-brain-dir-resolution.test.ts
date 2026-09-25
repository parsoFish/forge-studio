/**
 * The bypass ratchet — sessions half (M7-C KN1, bead forge-8vfn.23).
 *
 * SPEC.md §4 (`@forge/knowledge`): "Every per-knowledge-base read and write
 * goes through `KbBackend`. A per-KB read path that bypasses it is a defect,
 * not an optimisation." Three sites in this package (bridge-studio-
 * sessions.ts:309/532, kinds/brain-fix.ts:125 as measured at the bead's
 * filing commit — lines drift, the SITES are what matters) imported
 * `resolveKbBrainDir` straight from `@forge/knowledge`,
 * reaching around the seam entirely. The cure repoints all three through
 * `tryGetKbBackend` (the package's public door, `@forge/knowledge`) — see
 * that function and `KbBackend.rootDir()`'s own doc for why a raw path is
 * still, deliberately, reachable for the two that need one (a write-root
 * fence, a scanned-domain signal).
 *
 * WHY A REPO WALK AND NOT A NAMED LIST. A named list (the shape
 * `affordance-no-raw-fs.test.ts` uses) only ever shrinks by hand-editing the
 * list alongside the fix — it says nothing about a FOURTH site appearing
 * somewhere the list never named. This package has no legitimate reason to
 * resolve a KB's brain directory itself at all (unlike `@forge/knowledge`
 * itself, which owns `brain-paths.ts` and the backend that wraps it), so the
 * allow-list here is empty and stays empty: the assertion is simply "zero
 * hits, anywhere in this package's production code".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Directories under the package root that are not production source. */
const EXCLUDED_DIRS = new Set(['tests', 'node_modules']);

/** Every `.ts` production-source file under `root`, walked recursively,
 *  skipping `tests/` (and anything `.test.ts`, belt-and-braces). */
function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name));
        continue;
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
      out.push(join(dir, entry.name));
    }
  };
  walk(root);
  return out;
}

/** Every non-comment line referencing the identifier, `file: line` pairs. */
function findIdentifierHits(absPath: string, identifier: string): string[] {
  const src = readFileSync(absPath, 'utf8');
  const rel = relative(PKG_ROOT, absPath);
  const hits: string[] = [];
  src.split('\n').forEach((line, idx) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    if (line.includes(identifier)) hits.push(`${rel}:${idx + 1}: ${line.trim()}`);
  });
  return hits;
}

test('RATCHET: no file in @forge/sessions imports or calls resolveKbBrainDir — every per-KB brain-dir resolution goes through @forge/knowledge\'s KbBackend seam (tryGetKbBackend)', () => {
  const files = listSourceFiles(PKG_ROOT);
  assert.ok(files.length > 50, `sanity: expected a real package tree, found only ${files.length} source files`);

  const offenders = files.flatMap((f) => findIdentifierHits(f, 'resolveKbBrainDir'));
  assert.deepEqual(
    offenders,
    [],
    'these lines reach `resolveKbBrainDir` directly instead of `tryGetKbBackend`/`KbBackend` — repoint them through ' +
      'the seam (packages/knowledge/kb-backend.ts), the same cure bead forge-8vfn.23 applied to the other sites:\n' +
      offenders.join('\n'),
  );
});
