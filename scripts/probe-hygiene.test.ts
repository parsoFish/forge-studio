/**
 * probe-hygiene.test.ts — a gate's own test may not create a directory in the
 * tree the gates scan.
 *
 * T1 ruling 512, P1. `npm test` was intermittently red with an `ENOENT` out of
 * `check-raw-fs-guarded.mjs`'s reachability walk, on a directory that plainly
 * existed a moment earlier. It was not a defect in the walk. Two probe tests
 * were fighting over one real directory while a third scanner walked it:
 *
 *   - `check-boundaries.test.ts` planted BOTH ends of a legacy import edge, so
 *     it `mkdirSync`ed `orchestrator/` and — removing only its file — LEFT the
 *     directory behind. The tree M6 deleted, back, untracked, after every run.
 *   - `check-owner.test.ts` planted an untracked file in that same directory
 *     and `rmSync(dirname(victim), { recursive: true })`ed it on the way out.
 *   - `check-raw-fs-guarded.mjs` walks `['cli','orchestrator','packages','apps']`
 *     with `if (!existsSync(abs)) return;` followed by `readdirSync(abs)`.
 *
 * `node --test` runs files concurrently, so the removal landed between that
 * `existsSync` and that `readdirSync` and the walk threw. A textbook TOCTOU,
 * and the guard reads as if it had handled it.
 *
 * THE FIX IS NOT TO SWALLOW THE ENOENT. A walk that shrugs at a directory
 * vanishing under it would hide the next real one, and the scanners' whole
 * value is that they see the tree as it is.
 *
 * WHY THIS DOOR IS STATIC, having been built behavioural first. The obvious
 * door spawns each probe and samples the directory every 5 ms while it runs; it
 * works, and it caught both probes red from a clean tree (including
 * `check-owner`'s create-then-remove, which a before/after check cannot see).
 * It also cannot ship. Re-running `check-boundaries.test.ts`'s probe from
 * another test FILE plants `apps/studio/lib/__boundary_probe__.ts` in the live
 * tree at the same moment `npm test`'s own copy of that file is running its
 * "the real tree is at its baseline" cruise — measured, one red — so the door
 * would have introduced a second race to police the first. A door that re-runs
 * the thing it audits, inside the run that is already running it, is not a door.
 *
 * So the rule is enforced where it can be enforced without touching anything:
 * on the SOURCE. A `scripts/*.test.ts` may not `mkdirSync` a path rooted at the
 * repository, nor `rmSync(..., { recursive: true })` one. Planting a FILE in a
 * directory that already exists is fine and stays fine — that is what every
 * surviving probe does. It is creating and destroying the DIRECTORY that puts a
 * concurrent walker on the floor.
 *
 * The binding backscan is deliberately one level deep, which is exactly what
 * these call sites need (`mkdirSync(dirname(target))`, `const target =
 * join(ROOT, …)`) and is the same bounded-resolution shape
 * `check-raw-fs-guarded.mjs` already uses. A deeper analysis would be a second
 * import graph in `scripts/`, which §15 has one of on purpose.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/** The calls that move a directory rather than a file. */
const MOVERS = [
  { fn: 'mkdirSync', what: 'creates' },
  { fn: 'rmSync', what: 'recursively removes', needs: /recursive:\s*true/ },
];

/** Every `const <id> = <expr>;` in one source, as a lookup. One level, no scoping:
 *  a name that is bound twice in a file with different roots would defeat it, and
 *  the assertion below says so rather than pretending otherwise. */
function bindings(source: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const prior = out.get(m[1]) ?? [];
    prior.push(m[2]);
    out.set(m[1], prior);
  }
  return out;
}

/** The first argument's source text of a call, by paren matching. */
function firstArg(source: string, callAt: number): string {
  const open = source.indexOf('(', callAt);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return source.slice(open + 1, i); }
    else if (c === ',' && depth === 1) return source.slice(open + 1, i);
  }
  return source.slice(open + 1);
}

/** Does this expression reach the repository ROOT — directly, or through one
 *  local binding? `mkdtempSync(join(tmpdir(), …))` does not, which is what a
 *  hermetic fixture looks like. */
function reachesRoot(expr: string, binds: Map<string, string[]>): boolean {
  if (/\bROOT\b/.test(expr)) return true;
  for (const [name, values] of binds) {
    if (!new RegExp(`\\b${name}\\b`).test(expr)) continue;
    if (values.some((v) => /\bROOT\b/.test(v))) return true;
  }
  return false;
}

const TEST_FILES = readdirSync(HERE)
  .filter((f) => f.endsWith('.test.ts'))
  .sort();

test('512: no scripts/*.test.ts creates or recursively removes a directory in the live tree', () => {
  assert.ok(TEST_FILES.length > 10, `expected the scripts/ test suite, found ${TEST_FILES.length} file(s)`);

  const offences: string[] = [];
  for (const file of TEST_FILES) {
    if (file === 'probe-hygiene.test.ts') continue;
    const source = readFileSync(join(HERE, file), 'utf8');
    const binds = bindings(source);
    for (const mover of MOVERS) {
      const re = new RegExp(`\\b${mover.fn}\\s*\\(`, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(source)) !== null) {
        // A call inside a comment is not a call. The two probes this rule exists
        // for both DESCRIBE their old selves in prose, and a scan that could not
        // tell the difference would fail on its own fix.
        const lineStart = source.lastIndexOf('\n', m.index) + 1;
        const line = source.slice(lineStart, source.indexOf('\n', m.index));
        if (/^\s*(\*|\/\/)/.test(line)) continue;
        const whole = source.slice(m.index, source.indexOf('\n', m.index));
        if (mover.needs !== undefined && !mover.needs.test(whole)) continue;
        const arg = firstArg(source, m.index);
        if (reachesRoot(arg, binds)) {
          offences.push(`${file}: ${mover.fn}(${arg.trim()}) ${mover.what} a directory under the repository root`);
        }
      }
    }
  }

  assert.deepEqual(
    offences,
    [],
    'A probe may plant a FILE in a directory that already exists; it may not create or destroy the ' +
      'DIRECTORY. `node --test` runs files concurrently, and `check-raw-fs-guarded.mjs` walks ' +
      "`['cli','orchestrator','packages','apps']` with an `existsSync` followed by a `readdirSync` — a " +
      'directory appearing or vanishing between those two lines is an ENOENT that reads like a defect in ' +
      'the walk. Plant in a `mkdtempSync` fixture and drive the checker\'s exported entry point, which ' +
      'takes its root (`check-owner.test.ts`), or point the probe at a directory the tree already has ' +
      `(\`check-boundaries.test.ts\`). Offences:\n  ${offences.join('\n  ')}`,
  );
});
