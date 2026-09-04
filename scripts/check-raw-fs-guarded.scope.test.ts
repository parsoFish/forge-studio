/**
 * check-raw-fs-guarded.scope.test.ts — what the raw-fs lint SCANS.
 *
 * Split from `check-raw-fs-guarded.test.ts` rather than appended to it: that
 * file sits at its 800-cap exemption of 1,036 lines, and an exemption is a
 * ceiling, not a licence. Scope is also a separable concern from the taint
 * model — these tests answer "which files does the lint look at", the sibling
 * answers "what does it conclude about them".
 *
 * Bead forge-8vfn.5.32. The sweep walked `test-fixtures/` directories as if
 * they were production, while `check-owner.mjs`'s `productionFiles()` has
 * excluded them since M2 — so the repo's two definitions of "production"
 * disagreed, and eight fixture modules were linted as request-handling surface.
 * The allowlist even carried a note saying teaching this scan that rule "would
 * drop SIX modules … a wave decision, not a lane's". This is that decision.
 *
 * RUN: node --test --experimental-strip-types scripts/check-raw-fs-guarded.scope.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sweepModules, targetModules, ALLOWLIST, analyzeModule } from './check-raw-fs-guarded.mjs';
import { productionFiles } from './check-owner.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('5.32: no test-fixtures/ module is swept as production', () => {
  // Kills: the pre-fix walk, which returned eight of them.
  const swept = sweepModules(ROOT).filter((m) => m.includes('test-fixtures/'));
  assert.deepEqual(swept, [], 'a fixture is scanned by the suite that owns it, not by a request-path lint');
});

test('5.32: neither tier scans a fixture — the declared surface excludes them too', () => {
  const tier1 = targetModules(ROOT).filter((m) => m.includes('test-fixtures/'));
  assert.deepEqual(tier1, []);
});

test('5.32: this lint and check-owner agree on the ONE rule this bead is about', () => {
  // Narrow on purpose. The first draft of this test asserted that everything
  // scanned is something check-owner calls production, and it failed on 125
  // `apps/studio` modules — correctly. `productionFiles()` covers the QUARRIED
  // trees only and deliberately omits `apps/studio`, which a REQUEST-path lint
  // must scan because that is where the API routes live. The two definitions
  // differ by design; the defect was that they differed on TEST FIXTURES, and
  // that is the agreement worth pinning.
  const scanned = [...sweepModules(ROOT), ...targetModules(ROOT)];
  const production = productionFiles(ROOT);
  assert.equal(scanned.filter((m) => m.includes('test-fixtures/')).length, 0);
  assert.equal(production.filter((m) => m.includes('test-fixtures/')).length, 0);
});

test('5.32: the scan is still live — excluding fixtures removed 8 modules, not the population', () => {
  // The falling-count discipline (section 15.41/.85): a scanner's count going
  // DOWN is normally the blinded-scanner tell, so the drop is bounded here
  // rather than accepted. 383 -> 375 was exactly the eight fixture modules.
  const swept = sweepModules(ROOT);
  assert.ok(swept.length > 300, `the sweep must still hold a real population, got ${swept.length}`);
  assert.ok(targetModules(ROOT).length > 50, 'the declared surface must still hold a real population');
});

test('5.32: no allowlist row is stranded on a path the scan no longer reaches', () => {
  // The coupling that made this more than a one-liner: two rows were keyed to
  // test-fixtures paths and had to be RETIRED with the exclusion, or the
  // sibling's `stale.length === 0` would have gone red. This asserts the
  // general rule so the next scope change cannot strand a row silently.
  const stranded = ALLOWLIST.filter((a) => a.file.includes('test-fixtures/'));
  assert.deepEqual(stranded, [], 'an allowlist row for an out-of-scope file suppresses nothing');
});

test('5.32 (positive control): a real production module with an unguarded request sink STILL fires', () => {
  // Both directions. Narrowing scope must not narrow the verdict on anything
  // that stayed in it — otherwise this "fix" is the blinding it guards against.
  const text = [
    'export function handleSave(body) {',
    "  writeFileSync(join(projectsRoot, body.project, 'x.json'), String(body.contents));",
    '}',
  ].join('\n');
  const findings = analyzeModule(text, 'packages/flows/bridge-recovery.ts');
  assert.equal(findings.length, 1, 'a production module is still linted');
  assert.equal(findings[0].sink, 'writeFileSync');
});

test('5.32 (negative control): the SAME bytes in a fixture are out of scope', () => {
  // Proven by the module list rather than by analyzeModule, which is
  // path-agnostic by design: the exclusion lives in the walk, not the model.
  const fixture = 'packages/knowledge/tests/unit/test-fixtures/brain-lint.ts';
  assert.ok(readFileSync(join(ROOT, fixture), 'utf8').length > 0, 'the fixture still exists on disk');
  assert.ok(!sweepModules(ROOT).includes(fixture), 'and the scan does not reach it');
  assert.ok(!targetModules(ROOT).includes(fixture));
});
