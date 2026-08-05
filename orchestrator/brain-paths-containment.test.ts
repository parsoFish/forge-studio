/**
 * ACCEPTANCE TESTS (must be RED until fixed) — bd `forge-wze` (P0): KB
 * containment defect, unit level on `resolveKbBrainDir`.
 *
 * Root cause (orchestrator/brain-paths.ts::resolveKbBrainDir): the function
 * resolves `brain/<kbId>` (and its `brain/projects/<kbId>` fallback) with a
 * bare `resolve()` + `existsSync()` — no `realpathSync`, no per-segment
 * identity check, no `nlink` check. Contrast with the ratified guard at
 * `cli/studio-path-guard.ts::resolveGuardedPath`, which closes exactly this
 * shape for the five Studio write routes it already covers (symlinked dir,
 * cross-object alias, hardlinked leaf). `resolveKbBrainDir` is the KB
 * equivalent lookup and has none of those defenses on EITHER of its two
 * candidate roots (`brain/<id>` and `brain/projects/<id>`).
 *
 * Each test pins a genuine CLASSIFICATION/CONTAINMENT defect, not incidental
 * output shape — see the per-test comment for the exact failure today.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, symlinkSync, linkSync, lstatSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';

import { resolveKbBrainDir } from './brain-paths.ts';

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// ---------------------------------------------------------------------------
// A. dir symlink at brain/<id> pointing OUTSIDE the forge root
// ---------------------------------------------------------------------------

test('A (RED): resolveKbBrainDir must not resolve a dir-symlinked brain/<id> to a location outside forgeRoot', () => {
  const root = tmp('brain-paths-dirsym-');
  const outside = tmp('brain-paths-dirsym-outside-');
  try {
    mkdirSync(join(root, 'brain'), { recursive: true });
    writeFileSync(join(outside, 'kb.yaml'), 'id: evilkb\nname: Evil\nbinding: { kind: unique }\ndesc: d\n');
    try {
      symlinkSync(outside, join(root, 'brain', 'evilkb'), 'dir');
    } catch {
      assert.fail('symlink creation is unavailable in this environment — cannot construct the escape fixture');
    }

    const result = resolveKbBrainDir(root, 'evilkb');
    if (result !== null) {
      const realRoot = realpathSync(root);
      const realResult = realpathSync(result);
      assert.ok(
        realResult === realRoot || realResult.startsWith(realRoot + sep),
        `resolveKbBrainDir must never resolve to a location outside forgeRoot — got "${result}" (realpath "${realResult}"), forgeRoot realpath "${realRoot}". Today: it returns the unresolved symlink path verbatim (existsSync follows the symlink to find kb.yaml, but the returned string is never realpath-checked), so every downstream join()/readFileSync in kb-graph.ts silently reads/writes through the outside target.`,
      );
    }
    // A null result (outright rejection) is also an acceptable fixed shape —
    // this test only pins "must not point outside", not a specific
    // null-vs-contained-path choice.
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// B. cross-object: brain/<id> a symlink to a DIFFERENT REAL kb under the SAME
// root. A plain "somewhere under brain/" check reports this as contained —
// exactly the shape studio-path-guard.ts's per-segment IDENTITY check exists
// to close (see that module's docstring, escape shape 3).
// ---------------------------------------------------------------------------

test('B (RED): resolveKbBrainDir must reject an id whose own directory is a symlink to a DIFFERENT real kb (cross-object alias)', () => {
  const root = tmp('brain-paths-crossobj-');
  try {
    mkdirSync(join(root, 'brain', 'realkb'), { recursive: true });
    writeFileSync(join(root, 'brain', 'realkb', 'kb.yaml'), 'id: realkb\nname: Real\nbinding: { kind: unique }\ndesc: d\n');
    try {
      symlinkSync(join(root, 'brain', 'realkb'), join(root, 'brain', 'evilalias'), 'dir');
    } catch {
      assert.fail('symlink creation is unavailable in this environment — cannot construct the escape fixture');
    }

    const result = resolveKbBrainDir(root, 'evilalias');
    assert.equal(
      result,
      null,
      `resolveKbBrainDir("evilalias") must be REJECTED (null) — its own directory entry is a symlink to a DIFFERENT real kb ("realkb"), not a genuine "evilalias" brain. Today: it returns the resolved-via-existsSync path (the "evilalias" name lexically inside brain/, aliasing realkb's real content) — got ${JSON.stringify(result)}. A caller trusting the returned dir for "evilalias" silently reads/writes realkb's actual files.`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// C. hardlinked kb.yaml — realpathSync cannot resolve a hardlink away; only an
// explicit nlink check (mirroring studio-path-guard.ts's leaf check) closes
// it. resolveKbBrainDir has no such check on EITHER candidate root.
// ---------------------------------------------------------------------------

test('C (FIXED, amendment round): resolveKbBrainDir must reject (or the caller must be able to detect) a hardlinked kb.yaml sharing an inode with an outside file', () => {
  const root = tmp('brain-paths-hardlink-');
  const outside = tmp('brain-paths-hardlink-outside-');
  try {
    const outsideKbYaml = join(outside, 'kb.yaml');
    writeFileSync(outsideKbYaml, 'id: outside-secret\nname: Outside\nbinding: { kind: unique }\ndesc: d\n');

    mkdirSync(join(root, 'brain', 'hlkb'), { recursive: true });
    const linkedKbYaml = join(root, 'brain', 'hlkb', 'kb.yaml');
    try {
      linkSync(outsideKbYaml, linkedKbYaml);
    } catch {
      // Cross-filesystem hardlinks (EXDEV) can be unavailable — skip rather
      // than false-failing the suite for an environment limitation, mirroring
      // the convention in bridge-studio-write.test.ts.
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
      return;
    }

    // The real property is "no caller can obtain a path to a kb whose
    // kb.yaml shares an inode with an outside file" — satisfied EITHER by
    // resolveKbBrainDir rejecting outright (null, the now-shipped, STRICTER
    // behavior: resolveGuardedPath's leaf check runs the nlink test on
    // kb.yaml itself since it is the guard's segments[] leaf here) OR by a
    // non-null result whose kb.yaml genuinely has nlink === 1. A test that
    // required non-null as a precondition would fail on the stronger,
    // fixed behavior for the wrong reason — this asserts the property, not
    // a specific shape of success.
    const result = resolveKbBrainDir(root, 'hlkb');
    if (result !== null) {
      const st = lstatSync(join(result, 'kb.yaml'));
      assert.equal(
        st.nlink,
        1,
        `if resolveKbBrainDir returns a non-null dir, its kb.yaml must NOT be hardlinked (nlink=${st.nlink}) to an outside file — got a certified-safe dir whose kb.yaml still shares an inode with the outside file.`,
      );
    }
    // result === null is also an acceptable (and, per the current build, the
    // actual) closure of this escape — no further assertion needed in that
    // branch.
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// D. The brain/projects/<id> FALLBACK root is a second, independently
// unguarded resolution path — a fix that only hardens the direct brain/<id>
// branch and forgets the fallback leaves this escape wide open.
// ---------------------------------------------------------------------------

test('D (RED): resolveKbBrainDir must not resolve a dir-symlinked brain/projects/<id> fallback to a location outside forgeRoot', () => {
  const root = tmp('brain-paths-fallback-dirsym-');
  const outside = tmp('brain-paths-fallback-outside-');
  try {
    mkdirSync(join(root, 'brain', 'projects'), { recursive: true });
    writeFileSync(join(outside, 'kb.yaml'), 'id: evilproj\nname: Evil Project\nbinding: { kind: project, ref: evilproj }\ndesc: d\n');
    try {
      symlinkSync(outside, join(root, 'brain', 'projects', 'evilproj'), 'dir');
    } catch {
      assert.fail('symlink creation is unavailable in this environment — cannot construct the escape fixture');
    }
    // No brain/evilproj/kb.yaml exists — the direct branch misses, forcing
    // resolution down the brain/projects/<id> fallback branch.

    const result = resolveKbBrainDir(root, 'evilproj');
    if (result !== null) {
      const realRoot = realpathSync(root);
      const realResult = realpathSync(result);
      assert.ok(
        realResult === realRoot || realResult.startsWith(realRoot + sep),
        `resolveKbBrainDir's brain/projects/<id> FALLBACK must also never resolve outside forgeRoot — got "${result}" (realpath "${realResult}"). Today: the fallback branch (\`const project = projectBrainDir(...); if (existsSync(resolve(project,'kb.yaml'))) return project;\`) has the identical unguarded shape as the direct branch — a fix touching only the first \`if\` and forgetting this second one leaves the fallback exploitable.`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
