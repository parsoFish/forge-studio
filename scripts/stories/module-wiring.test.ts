/**
 * module-wiring.test.ts — every name the harness imports actually exists.
 *
 * THE MISS THIS CLOSES (M5-B session 6, 2026-09-05). `run.mjs` gained a call to
 * `reapReasonFor` and the import was never added. The local 17-step gate went
 * **17/17 rc=0** and CI's `stories` job went RED with a `ReferenceError`,
 * because:
 *
 *   - `npm run build` and `test:ui:typecheck` do not typecheck `.mjs`;
 *   - `node --check` is a SYNTAX check and an undefined identifier is valid
 *     syntax;
 *   - no gate step EXECUTES `scripts/stories/run.mjs` — it is a CLI, and the
 *     only thing in the repository that runs it is the `stories` CI job.
 *
 * So the harness that judges every story had a whole class of defect its own
 * gate could not see, and the feedback arrived only after a push. That is
 * §15.92's shape one level up: two states — "wired" and "not wired" — with one
 * appearance to every check that runs locally.
 *
 * WHY A STATIC CHECK AND NOT "JUST RUN IT". Executing `run.mjs` boots a bridge,
 * binds the host-global Studio ports and drives a browser; it cannot live in
 * `npm test`. But the defect is not behavioural — it is a NAME that does not
 * resolve — so it is answerable without running anything: read every
 * `import { … } from './x.mjs'` the harness declares, import the module it
 * names, and assert the module actually exports each name.
 *
 * This is the cheapest control that makes the class impossible rather than
 * unlikely, and it covers every harness module, not the one that broke.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Every `import { a, b as c } from './x.mjs'` in one source file. Default and
 *  namespace imports carry no names to verify and are deliberately ignored. */
function namedLocalImports(source: string): Array<{ from: string; names: string[] }> {
  const out: Array<{ from: string; names: string[] }> = [];
  const re = /import\s*\{([^}]*)\}\s*from\s*'(\.\/[^']+\.mjs)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const names = m[1]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      // `a as b` imports the exported name `a`.
      .map((s) => s.split(/\s+as\s+/)[0].trim());
    if (names.length > 0) out.push({ from: m[2], names });
  }
  return out;
}

const harnessModules = readdirSync(HERE)
  .filter((f) => f.endsWith('.mjs'))
  .sort();

test('the harness has modules to check (the check itself is not vacuous)', () => {
  assert.ok(harnessModules.length >= 5, `expected the story harness's modules, found ${harnessModules.length}`);
});

for (const file of harnessModules) {
  const source = readFileSync(join(HERE, file), 'utf8');
  const imports = namedLocalImports(source);
  if (imports.length === 0) continue;

  test(`${file}: every name it imports from a sibling harness module is exported by that module`, async () => {
    for (const { from, names } of imports) {
      const mod = (await import(pathToFileURL(join(HERE, from)).href)) as Record<string, unknown>;
      for (const name of names) {
        assert.ok(
          name in mod,
          `${file} imports { ${name} } from '${from}', which exports no such name — ` +
            `an undefined identifier at the call site, invisible to build, typecheck and node --check`,
        );
      }
    }
  });
}

test('run.mjs uses no sibling-module name it did not import', async () => {
  // The mirror of the check above, and the half that actually caught the miss:
  // a name can be CALLED without being imported at all, in which case there is
  // no import row for the loop above to verify.
  const source = readFileSync(join(HERE, 'run.mjs'), 'utf8');
  const imported = new Set(namedLocalImports(source).flatMap((i) => i.names));
  const reap = (await import(pathToFileURL(join(HERE, 'reap.mjs')).href)) as Record<string, unknown>;
  const exportedFns = Object.keys(reap).filter((k) => typeof reap[k] === 'function');

  const called = exportedFns.filter((name) => new RegExp(`(?<![\\w.])${name}\\s*\\(`).test(source));
  const uncalled = called.filter((name) => !imported.has(name));
  assert.deepEqual(
    uncalled,
    [],
    `run.mjs calls ${uncalled.join(', ')} from reap.mjs without importing it — a ReferenceError at runtime`,
  );
});
