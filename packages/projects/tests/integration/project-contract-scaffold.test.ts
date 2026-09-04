/**
 * project-contract-scaffold.test.ts — direct unit tests for the pure helpers
 * carved out of `apps/forge/bridge-studio-writes.ts` into
 * `project-contract-scaffold.ts` (M4-projects carve, worker B).
 *
 * CARRIED ACROSS from `apps/forge/bridge-studio-project-create-containment.test.ts`
 * (the "~13 ATs" this task's brief asks for): every acceptance test in that
 * file that exercises `checkContractArtifactContainment`/
 * `scaffoldContractArtifacts` THEMSELVES — Defect 5 (the per-write
 * containment guard: `.forge` dir symlink, `.forge/project.json` dangling +
 * live-target symlink, `roadmap.md` dangling + live-target symlink, `brain/`
 * dir symlink, `brain/profile.md` dangling + live-target symlink, a
 * HARDLINKED `.forge/project.json`) and Finding B (the hardlink
 * false-rejection fix, both files, plus its ordinary-file idempotency
 * control) and the "clone a real repo first" positive control for
 * `needsGitInit`'s three-way rule. That is 9 (Defect 5) + 3 (Finding B, incl.
 * the ordinary-file control) + 1 (clone-first) = 13 tests, reproduced below
 * calling the moved functions DIRECTLY (no `startBridge`, no HTTP) — the
 * point of the carve.
 *
 * NOT carried (stayed in the original file, or live one level up in
 * `bridge-studio-project-onboard.ts`'s own tests): Defect 1 (lexical containment bypass —
 * that guard is `isContainedProjectRepoPath`, `@forge/flows`, injected into
 * `bridge-studio-project-onboard.ts` as a dependency, not owned by this file); Defect 2
 * (sibling-project clobber — an application-level check in the ROUTE
 * handler, not in these pure functions); Finding A (`seedProjectBrain`'s OWN
 * containment — `@forge/knowledge`, injected, not moved here); the SEC-03
 * round-3/4 ordering ATs (route-level phase-1/phase-2 sequencing, not a
 * property of `checkContractArtifactContainment`/`scaffoldContractArtifacts`
 * in isolation); and the two whole-route "GET both endpoints list it"
 * positive controls (they assert on `discoverProjects`/`loadKbDescriptors`,
 * neither of which lives in this file). All of those are `bridge-studio-project-onboard.ts`
 * concerns and are exercised there instead.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, linkSync, writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ScaffoldContainmentError,
  checkContractArtifactContainment,
  scaffoldContractArtifacts,
} from '../../project-contract-scaffold.ts';

/** `readArtifactRoot` faked as the constant it always resolves to in these
 *  fixtures (no `.forge/project.json` ever exists here — the real function
 *  would return '.' too; see project-contract-scaffold.ts's header for why
 *  this is injected rather than imported). */
const readArtifactRootFake = (_projectRoot: string): string => '.';

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

let symlinksUnavailable = false;
{
  const probeParent = tmp('scaffold-symlink-probe-parent-');
  const probeTarget = tmp('scaffold-symlink-probe-target-');
  try {
    symlinkSync(probeTarget, join(probeParent, 'link'), 'dir');
  } catch {
    symlinksUnavailable = true;
  }
  rmSync(probeParent, { recursive: true, force: true });
  rmSync(probeTarget, { recursive: true, force: true });
}

function skipIfNoSymlinks(t: { skip: (msg?: string) => void }): boolean {
  if (symlinksUnavailable) {
    t.skip('symlink creation unavailable in this environment');
    return true;
  }
  return false;
}

/** True iff any project-onboarding artifact exists directly under `dir`. */
function hasAnyArtifact(dir: string): boolean {
  return existsSync(join(dir, '.forge', 'project.json'))
    || existsSync(join(dir, 'roadmap.md'))
    || existsSync(join(dir, 'brain', 'profile.md'));
}

// ---------------------------------------------------------------------------
// Defect 5 — the per-write containment guard (9 ATs)
// ---------------------------------------------------------------------------

test('[Defect 5] a .forge dir SYMLINKED beneath a real, contained projectRoot: containment check rejects it, nothing created outside', (t) => {
  if (skipIfNoSymlinks(t)) return;
  const projectRoot = tmp('scaffold-d5-forgedir-');
  const outside = tmp('scaffold-d5-forgedir-outside-');
  try {
    symlinkSync(outside, join(projectRoot, '.forge'), 'dir');
    assert.throws(
      () => checkContractArtifactContainment(projectRoot, projectRoot, readArtifactRootFake, ['echo', 'ok']),
      ScaffoldContainmentError,
      'a symlinked .forge dir must be rejected by the pre-check',
    );
    assert.equal(existsSync(join(outside, 'project.json')), false, 'nothing written through the symlink');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('[Defect 5] .forge/project.json a DANGLING symlink: containment check rejects it', (t) => {
  if (skipIfNoSymlinks(t)) return;
  const projectRoot = tmp('scaffold-d5-fjson-dangle-');
  try {
    mkdirSync(join(projectRoot, '.forge'), { recursive: true });
    symlinkSync(join(projectRoot, 'does-not-exist-target'), join(projectRoot, '.forge', 'project.json'));
    assert.throws(
      () => checkContractArtifactContainment(projectRoot, projectRoot, readArtifactRootFake, ['echo', 'ok']),
      ScaffoldContainmentError,
    );
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('[Defect 5] roadmap.md a DANGLING symlink pointing outside projectRoot: scaffoldContractArtifacts rejects the write, target untouched', (t) => {
  if (skipIfNoSymlinks(t)) return;
  const projectRoot = tmp('scaffold-d5-roadmap-dangle-');
  const outside = tmp('scaffold-d5-roadmap-dangle-outside-');
  try {
    symlinkSync(join(outside, 'ESCAPED.md'), join(projectRoot, 'roadmap.md'));
    assert.throws(
      () => scaffoldContractArtifacts(projectRoot, 'demo', projectRoot, readArtifactRootFake),
      ScaffoldContainmentError,
    );
    assert.equal(existsSync(join(outside, 'ESCAPED.md')), false, 'the dangling target must never be created');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('[Defect 5] roadmap.md a LIVE symlink to a real file OUTSIDE projectRoot: pre-check idempotency-skips it (existsSync follows the link) — MEASURED, not a write, so nothing is overwritten either', (t) => {
  if (skipIfNoSymlinks(t)) return;
  const projectRoot = tmp('scaffold-d5-roadmap-live-');
  const outside = tmp('scaffold-d5-roadmap-live-outside-');
  try {
    writeFileSync(join(outside, 'REAL.md'), 'pre-existing outside content\n');
    symlinkSync(join(outside, 'REAL.md'), join(projectRoot, 'roadmap.md'));
    // The pre-check probes `existsSync` first (idempotency contract) — a live
    // symlink resolves to a real file, so this branch is SKIPPED, not
    // guarded. Named explicitly (per the original AT's own framing) rather
    // than banked as a deliberate defense: it means the check never even
    // reaches resolveGuardedPath for this path.
    assert.doesNotThrow(() => checkContractArtifactContainment(projectRoot, projectRoot, readArtifactRootFake, ['echo', 'ok']));
    assert.equal(readFileSync(join(outside, 'REAL.md'), 'utf8'), 'pre-existing outside content\n', 'the outside file must not be modified');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('[Defect 5] a brain/ dir SYMLINKED beneath a real, contained projectRoot: scaffoldContractArtifacts rejects the profile.md write, nothing created outside', (t) => {
  if (skipIfNoSymlinks(t)) return;
  const projectRoot = tmp('scaffold-d5-braindir-');
  const outside = tmp('scaffold-d5-braindir-outside-');
  try {
    symlinkSync(outside, join(projectRoot, 'brain'), 'dir');
    assert.throws(
      () => scaffoldContractArtifacts(projectRoot, 'demo', projectRoot, readArtifactRootFake),
      ScaffoldContainmentError,
    );
    assert.equal(existsSync(join(outside, 'profile.md')), false);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('[Defect 5] brain/profile.md a DANGLING symlink (brain/ itself real): scaffoldContractArtifacts rejects the write', (t) => {
  if (skipIfNoSymlinks(t)) return;
  const projectRoot = tmp('scaffold-d5-profile-dangle-');
  const outside = tmp('scaffold-d5-profile-dangle-outside-');
  try {
    mkdirSync(join(projectRoot, 'brain'), { recursive: true });
    symlinkSync(join(outside, 'ESCAPED-profile.md'), join(projectRoot, 'brain', 'profile.md'));
    assert.throws(
      () => scaffoldContractArtifacts(projectRoot, 'demo', projectRoot, readArtifactRootFake),
      ScaffoldContainmentError,
    );
    assert.equal(existsSync(join(outside, 'ESCAPED-profile.md')), false);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('[Defect 5] brain/profile.md a LIVE symlink to a real outside file (brain/ itself real): idempotency-skips, outside file untouched', (t) => {
  if (skipIfNoSymlinks(t)) return;
  const projectRoot = tmp('scaffold-d5-profile-live-');
  const outside = tmp('scaffold-d5-profile-live-outside-');
  try {
    mkdirSync(join(projectRoot, 'brain'), { recursive: true });
    writeFileSync(join(outside, 'REAL-profile.md'), 'pre-existing\n');
    symlinkSync(join(outside, 'REAL-profile.md'), join(projectRoot, 'brain', 'profile.md'));
    const created = scaffoldContractArtifacts(projectRoot, 'demo', projectRoot, readArtifactRootFake);
    assert.equal(created.includes('brain/profile.md'), false, 'must be reported as already-present, not freshly created');
    assert.equal(readFileSync(join(outside, 'REAL-profile.md'), 'utf8'), 'pre-existing\n');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('[Defect 5] a HARDLINKED .forge/project.json sharing an inode with an outside file: MEASURED — checkContractArtifactContainment does NOT throw (accidentally blocked, named not banked)', (t) => {
  if (skipIfNoSymlinks(t)) return; // hardlinks share the same platform gate as symlinks in CI sandboxes
  const projectRoot = tmp('scaffold-d5-hardlink-');
  const outside = tmp('scaffold-d5-hardlink-outside-');
  try {
    mkdirSync(join(projectRoot, '.forge'), { recursive: true });
    writeFileSync(join(outside, 'shared.json'), '{}');
    try {
      linkSync(join(outside, 'shared.json'), join(projectRoot, '.forge', 'project.json'));
    } catch {
      t.skip('hardlink creation unavailable in this environment');
      return;
    }
    // Unlike a symlink, a hardlink cannot dangle: `.forge/project.json`
    // genuinely EXISTS the instant it's created (it shares an inode with the
    // outside file), so `checkContractArtifactContainment`'s own
    // `if (!existsSync(forgeJsonPath))` idempotency gate skips the guard
    // block entirely — it never calls `resolveGuardedPath` for this path at
    // all, so it neither throws nor "passes" a check, it just never runs
    // one. The original AT (cli/bridge-studio-project-create-containment.
    // test.ts) names this MEASURED, not a deliberate defense: end-to-end,
    // the escape is actually intercepted one layer up, by the ROUTE's OWN
    // Defect-2 clobber check (`existsSync('.forge/project.json')` → "a
    // project already exists at this repo path", 400) BEFORE this function
    // is ever called — reproduced as its own AT in project-onboard.test.ts
    // ("[Defect 2, carried]"), since that is a route-level property, not a
    // property of this pure function in isolation.
    assert.doesNotThrow(() => checkContractArtifactContainment(projectRoot, projectRoot, readArtifactRootFake, ['echo', 'ok']));
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Finding B — the hardlink false-rejection fix must not false-reject an
// ordinary in-forgeRoot hardlink or an ordinary pre-existing file (3 ATs)
// ---------------------------------------------------------------------------

test('[Finding B] an in-forgeRoot HARDLINKED roadmap.md must not false-reject scaffoldContractArtifacts', (t) => {
  if (skipIfNoSymlinks(t)) return;
  const projectRoot = tmp('scaffold-fb-roadmap-');
  try {
    const sibling = join(projectRoot, 'roadmap-source.md');
    writeFileSync(sibling, '# pre-existing roadmap (hardlinked)\n');
    try {
      linkSync(sibling, join(projectRoot, 'roadmap.md'));
    } catch {
      t.skip('hardlink creation unavailable in this environment');
      return;
    }
    const created = scaffoldContractArtifacts(projectRoot, 'demo', projectRoot, readArtifactRootFake);
    assert.equal(created.includes('roadmap.md'), false, 'the hardlinked file is already present — skip, do not overwrite');
    assert.equal(readFileSync(join(projectRoot, 'roadmap.md'), 'utf8'), '# pre-existing roadmap (hardlinked)\n');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('[Finding B] an in-forgeRoot HARDLINKED brain/profile.md must not false-reject scaffoldContractArtifacts', (t) => {
  if (skipIfNoSymlinks(t)) return;
  const projectRoot = tmp('scaffold-fb-profile-');
  try {
    mkdirSync(join(projectRoot, 'brain'), { recursive: true });
    const sibling = join(projectRoot, 'profile-source.md');
    writeFileSync(sibling, '# pre-existing profile (hardlinked)\n');
    try {
      linkSync(sibling, join(projectRoot, 'brain', 'profile.md'));
    } catch {
      t.skip('hardlink creation unavailable in this environment');
      return;
    }
    const created = scaffoldContractArtifacts(projectRoot, 'demo', projectRoot, readArtifactRootFake);
    assert.equal(created.includes('brain/profile.md'), false);
    assert.equal(readFileSync(join(projectRoot, 'brain', 'profile.md'), 'utf8'), '# pre-existing profile (hardlinked)\n');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('[Finding B, positive control] a pre-existing ORDINARY roadmap.md (no hardlink) is skipped, not clobbered — the plain idempotency contract', () => {
  const projectRoot = tmp('scaffold-fb-ordinary-');
  try {
    writeFileSync(join(projectRoot, 'roadmap.md'), '# operator-authored roadmap\n');
    const created = scaffoldContractArtifacts(projectRoot, 'demo', projectRoot, readArtifactRootFake);
    assert.equal(created.includes('roadmap.md'), false);
    assert.equal(readFileSync(join(projectRoot, 'roadmap.md'), 'utf8'), '# operator-authored roadmap\n');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// needsGitInit's three-way rule — positive control (1 AT)
// ---------------------------------------------------------------------------

test('[positive control] cloning a real repo into place FIRST, then scaffolding: skips git-init (own repo governs), still writes roadmap.md/profile.md', () => {
  const projectRoot = tmp('scaffold-clone-first-');
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: projectRoot });
    execFileSync('git', ['config', 'user.email', 'test@forge.dev'], { cwd: projectRoot });
    execFileSync('git', ['config', 'user.name', 'Forge Test'], { cwd: projectRoot });
    writeFileSync(join(projectRoot, 'README.md'), '# real project\n');
    execFileSync('git', ['add', '-A'], { cwd: projectRoot });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: projectRoot });

    const created = scaffoldContractArtifacts(projectRoot, 'demo', projectRoot, readArtifactRootFake);

    assert.equal(created.includes('.git/'), false, 'must NOT re-init an already-real repo');
    assert.ok(created.includes('roadmap.md'));
    assert.ok(created.includes('brain/profile.md'));
    assert.ok(hasAnyArtifact(projectRoot));
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
