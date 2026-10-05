/**
 * No operator-facing string names a retired CLI verb (forge-8vfn.8.5.11).
 *
 * M7-5 / S9 (D-12) retired `forge review`, `forge requeue` and
 * `forge enqueue`; recovery and review live in Studio. The M7-E stranger
 * (attempt 1, Q15) read `serve.log` telling it to "resolve via 'forge review
 * <id>'" — a verb the getting-started page says no longer exists. Comments
 * may keep the history; code lines may not tell an operator to run one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const RETIRED = /\bforge (review|requeue|enqueue)\b/;
const COMMENT = /^\s*(\/\/|\*|\/\*)/;

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'tests' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

test('no non-comment line in packages/ or apps/forge/ tells an operator to run a retired verb', () => {
  const hits: string[] = [];
  for (const file of [...sources(join(ROOT, 'packages')), ...sources(join(ROOT, 'apps', 'forge'))]) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (!COMMENT.test(line) && RETIRED.test(line)) hits.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, [], `retired verbs in operator-facing code:\n${hits.join('\n')}`);
});
