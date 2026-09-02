/**
 * Tests for the forge↔project contract preflight — the DEPS clause
 * (forge-8vfn.5.21), tested DIRECTLY against `checkDeps` rather than through
 * `runPreflight` — see `preflight-deps.ts`'s header for why this clause is
 * NOT (yet) wired into that composer's `clauses` array: doing so flips
 * `report.ok` on ~15 existing tests across ~8 sibling files whose shared
 * `happyProject()`-style fixture declares an unprovisioned `vitest run`
 * gate never meant to execute. That finding is reported, not silently
 * patched through by editing those files.
 *
 * `dir`/`cfg` fixtures are lean (a bare tmp dir + a `loadProjectConfig`
 * result, or `null`) rather than the full `happyProject()` — `checkDeps`
 * only ever reads `dir`'s `package.json`/`node_modules` and `cfg`'s
 * `testProcess.local.cmd`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkDeps } from '../../preflight-deps.ts';
import { runPreflight } from '../../preflight.ts';

/** A contract-complete project whose declared gate needs an install it has not had. */
function unprovisionedProject(): { dir: string; forgeRoot: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'deps-wire-p-'));
  const forgeRoot = mkdtempSync(join(tmpdir(), 'deps-wire-fr-'));
  const name = dir.split('/').pop()!;
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, scripts: { test: 'vitest run' } }));
  writeFileSync(join(dir, '.gitignore'), ['node_modules/', '.forge/'].join('\n'));
  writeFileSync(join(dir, 'roadmap.md'), '# Roadmap\n');
  writeFileSync(join(dir, 'CLAUDE.md'), '# Constraints\nQuality gate: `vitest run`.\n');
  mkdirSync(join(forgeRoot, 'brain', 'projects', name), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'projects', name, 'profile.md'), '# profile\n');
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(join(dir, '.forge', 'project.json'), JSON.stringify({ testProcess: { local: { cmd: ['vitest', 'run'] } } }));
  return { dir, forgeRoot, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(forgeRoot, { recursive: true, force: true }); } };
}
import { loadProjectConfig } from '../../project-config.ts';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'forge-preflight-deps-'));
}

/** Writes `.forge/project.json` declaring `cmd` as the local gate, then loads
 *  it back through the real loader (the same one `runPreflight` uses). */
function withLocalCmd(dir: string, cmd: string[]): ReturnType<typeof loadProjectConfig> {
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(join(dir, '.forge', 'project.json'), JSON.stringify({ testProcess: { local: { cmd } } }));
  return loadProjectConfig(dir);
}

test('DEPS (HARD): no declared local gate at all — passes (C1 already reports this)', () => {
  const dir = tmp();
  try {
    const r = checkDeps(dir, null);
    assert.equal(r.pass, true);
    assert.equal(r.hard, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('DEPS (HARD): no package.json at all — passes (not a Node project this clause understands)', () => {
  const dir = tmp();
  try {
    const cfg = withLocalCmd(dir, ['vitest', 'run']);
    const r = checkDeps(dir, cfg);
    assert.equal(r.pass, true);
    assert.match(r.detail, /no package\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('DEPS (HARD): the real starter shape — "npm test" resolving to "node --experimental-strip-types --test" needs nothing installed, passes with NO node_modules', () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      scripts: { test: 'node --experimental-strip-types --test' },
      devDependencies: { typescript: '^5.6.0' },
    }));
    const cfg = withLocalCmd(dir, ['npm', 'test']);
    const r = checkDeps(dir, cfg);
    assert.equal(r.pass, true, r.detail);
    assert.match(r.detail, /needs nothing installed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('DEPS (HARD): forge-8vfn.5.21\'s exact bug — a bare devDependency-provided runner ("vitest run") with NO node_modules fails hard', () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: { vitest: '^2.0.0' } }));
    const cfg = withLocalCmd(dir, ['vitest', 'run']);
    const r = checkDeps(dir, cfg);
    assert.equal(r.pass, false);
    assert.equal(r.hard, true);
    assert.match(r.detail, /node_modules/);
    assert.match(r.detail, /npm ci/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('DEPS (HARD): "vitest run" passes once node_modules is provisioned', () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: { vitest: '^2.0.0' } }));
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    const cfg = withLocalCmd(dir, ['vitest', 'run']);
    const r = checkDeps(dir, cfg);
    assert.equal(r.pass, true, r.detail);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('DEPS (HARD): the LIVE gitpulse repro shape — "npx tsx --test" with no node_modules fails, naming "Cannot find package tsx"\'s root cause', () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: { tsx: '^4.0.0' } }));
    const cfg = withLocalCmd(dir, ['npx', 'tsx', '--test']);
    const r = checkDeps(dir, cfg);
    assert.equal(r.pass, false);
    assert.match(r.detail, /node_modules/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('DEPS (HARD): an "npm run <script>" gate resolves through the SAME package.json script indirection as npm test', () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      scripts: { 'unit': 'node --experimental-strip-types --test test/**/*.test.ts' },
    }));
    const cfg = withLocalCmd(dir, ['npm', 'run', 'unit']);
    const r = checkDeps(dir, cfg);
    assert.equal(r.pass, true, r.detail);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('DEPS (HARD): a relative script path (./run-tests.sh) needs nothing installed', () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: { vitest: '^2.0.0' } }));
    const cfg = withLocalCmd(dir, ['./run-tests.sh']);
    const r = checkDeps(dir, cfg);
    assert.equal(r.pass, true, r.detail);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('DEPS (HARD): malformed package.json is skipped (C1\'s problem to report), never crashes', () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'package.json'), '{ not valid json');
    const cfg = withLocalCmd(dir, ['vitest', 'run']);
    const r = checkDeps(dir, cfg);
    assert.equal(r.pass, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The WIRING, not just the clause. `checkDeps` is exercised directly above,
// which proves the predicate but not that anything consults it. A clause that
// is implemented, tested and never reached is the declared-data shape this
// campaign exists to close — so these two pin the option itself:
// `requireRunnableGate` ON produces a HARD DEPS failure that flips `ok`, and
// OFF produces no DEPS clause at all.
//
// The default is OFF deliberately, and the asymmetry is the point: a project
// is born contract-green BEFORE anyone installs its dependencies (R1-03-F1,
// `cli/onboard-born-green.test.ts`), so judging runnability at creation would
// break one ratified acceptance to satisfy another. Claim time is when an
// unprovisioned ground stops being "not yet" and becomes the reason a run dies
// three minutes later — `packages/flows/claim-validator.ts` is the one caller
// that sets it.
// ---------------------------------------------------------------------------

test('wiring: requireRunnableGate ON makes an unprovisioned ground fail DEPS hard and flips report.ok', () => {
  const { dir, forgeRoot, cleanup } = unprovisionedProject();
  try {
    const r = runPreflight(dir, { forgeRoot, requireRunnableGate: true });
    const deps = r.clauses.find((c) => c.clause === 'DEPS');
    assert.ok(deps, 'the DEPS clause must be present when the caller asks for it');
    assert.equal(deps!.pass, false, 'an unprovisioned ground must fail it');
    assert.equal(deps!.hard, true, 'it must be HARD — an advisory would be the silent no-op this bead exists to kill');
    assert.equal(r.ok, false, 'and it must flip the report, or claim-validator would still admit the ground');
  } finally {
    cleanup();
  }
});

test('wiring: requireRunnableGate OFF (the default) emits no DEPS clause — birth is not claim time', () => {
  const { dir, forgeRoot, cleanup } = unprovisionedProject();
  try {
    const r = runPreflight(dir, { forgeRoot });
    assert.equal(
      r.clauses.some((c) => c.clause === 'DEPS'),
      false,
      'the default must not judge runnability — a project is born green before anyone has installed anything',
    );
  } finally {
    cleanup();
  }
});
