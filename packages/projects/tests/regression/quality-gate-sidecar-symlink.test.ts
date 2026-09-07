/**
 * Bead `forge-8vfn.7.2.6` / T1 ruling 470 — ONE reader of
 * `.forge/quality_gate_cmd`, and it is the guarded one.
 *
 * THE DEFECT. The file had two readers. `loadProjectConfig` reached it through
 * `readQualityGateSidecar`, which resolves the whole path — leaf included —
 * with `guardedReadFile`, so a symlinked sidecar is refused (SEC-04). The
 * preflight gate had its OWN `join` + `existsSync` + `readFileSync` of the same
 * path, which followed the symlink. Same file, same question, two answers
 * depending on which door asked it.
 *
 * That asymmetry was invisible to the repo's own scanner: `check-raw-fs-guarded`
 * does not model `preflight-gate.ts`'s `dir` as request-derived, so nothing
 * flagged the second door. It was found by reading both readers while culling
 * duplicated rationale out of this package, which is the honest provenance —
 * no tool pointed at it.
 *
 * RED AT BASE, verified rather than asserted: with the pre-collapse
 * `readQualityGateCmd` in place this test reports the planted command through
 * C1's detail. It is green only because the gate now shares the loader's
 * guarded reader.
 *
 * The behaviour change is deliberate and is 386's ONE named exception to
 * "no behaviour change": a project whose `.forge/quality_gate_cmd` is a
 * SYMLINK now has no declared gate command from that source, where before the
 * link was followed out of the project root.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runPreflight } from '../../preflight.ts';

/** Duplicated rather than imported — this package keeps test helpers local
 *  (packages/agents/tests/README.md's rule), and a `.test.ts` that exports a
 *  helper becomes an import target that constrains what it may assert. */
function clause(report: ReturnType<typeof runPreflight>, id: string) {
  const c = report.clauses.find((x) => x.clause === id);
  assert.ok(c, `clause ${id} present`);
  return c!;
}

/** The minimum tree C1 needs before the sidecar is the only gate source left:
 *  no package.json "test" script and no project.json testProcess. */
function bareProject(): { dir: string; forgeRoot: string } {
  const dir = mkdtempSync(join(tmpdir(), 'gate-project-'));
  const forgeRoot = mkdtempSync(join(tmpdir(), 'gate-forge-'));
  const name = dir.split('/').pop()!;
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name }));
  mkdirSync(join(forgeRoot, 'brain', 'projects', name), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'projects', name, 'profile.md'), '# profile\n');
  mkdirSync(join(dir, '.forge'), { recursive: true });
  return { dir, forgeRoot };
}

test('a SYMLINKED .forge/quality_gate_cmd is not followed out of the project root (kills: the gate\'s own raw reader)', () => {
  const outside = mkdtempSync(join(tmpdir(), 'gate-outside-'));
  const { dir, forgeRoot } = bareProject();
  try {
    // The command an escaping link would hand the gate. It has to be something
    // a passing report would visibly quote, or the assertion proves nothing.
    const planted = join(outside, 'planted_gate_cmd');
    writeFileSync(planted, 'echo PLANTED-FROM-OUTSIDE-THE-PROJECT');

    symlinkSync(planted, join(dir, '.forge', 'quality_gate_cmd'));
    // No package.json and no project.json: the sidecar is the ONLY source the
    // gate could resolve a command from, so the symlink is load-bearing here.

    const c1 = clause(runPreflight(dir, { forgeRoot }), 'C1');
    assert.doesNotMatch(c1.detail, /PLANTED-FROM-OUTSIDE-THE-PROJECT/, 'the gate followed a symlinked sidecar out of the project root');
    // C1's own "none found" message names the sidecar as a place it LOOKED, so
    // the absence of the planted command is only half the claim — the other
    // half is that no gate was resolved at all.
    assert.equal(c1.pass, false, 'with the only sidecar symlinked away, C1 has no gate command and must fail');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('POSITIVE CONTROL: a REAL .forge/quality_gate_cmd still satisfies the gate (the guard refuses links, not files)', () => {
  const { dir, forgeRoot } = bareProject();
  try {
    writeFileSync(join(dir, '.forge', 'quality_gate_cmd'), 'pytest -q');

    const c1 = clause(runPreflight(dir, { forgeRoot }), 'C1');

    assert.match(c1.detail, /quality_gate_cmd/, 'a real sidecar must still be the gate source');
    assert.match(c1.detail, /pytest -q/, 'and its command must survive the argv round trip through readQualityGateSidecar');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
