/**
 * forge-nk1y.8 ratchet — a raw `decodeURIComponent` throws `URIError` on a
 * malformed escape; out of an async route handler on an unauthenticated
 * request that killed the bridge. `decodeUrlPart` (packages/kernel/url-decode.ts)
 * is the ONE decoder. Any other non-test source reference — a call OR a bare
 * identifier such as `.map(decodeURIComponent)` — fails this test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
const ALLOWED = 'packages/kernel/url-decode.ts';
const SKIP_DIRS = new Set(['node_modules', 'tests', 'dist', '.next', '.git']);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** Blank block and line comments (keeping line numbers) so prose mentions do not count. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

test('no non-test source references decodeURIComponent outside packages/kernel/url-decode.ts', () => {
  const roots = [join(ROOT, 'apps/forge'), ...readdirSync(join(ROOT, 'packages')).map((p) => join(ROOT, 'packages', p))]
    .filter((d) => statSync(d).isDirectory());
  const sites: string[] = [];
  for (const root of roots) {
    for (const file of sourceFiles(root)) {
      const rel = relative(ROOT, file);
      if (rel === ALLOWED) continue;
      stripComments(readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
        if (line.includes('decodeURIComponent')) sites.push(`${rel}:${i + 1}`);
      });
    }
  }
  assert.deepEqual(sites, [], `use decodeUrlPart from @forge/kernel, not decodeURIComponent:\n${sites.join('\n')}`);
});
