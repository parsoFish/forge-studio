/**
 * ACCEPTANCE PINS (SEC-04 residual #1, WIRE-REACHABLE) — the loadProjectConfig
 * `.forge/project.json` LEAF escape.
 *
 * `loadProjectConfig(projectRoot)` (orchestrator/project-config.ts) reads
 * `<projectRoot>/.forge/project.json`. The dir-level containment its callers do
 * — the POST /api/verdict send-back validates `manifest.project_repo_path` with
 * `isContainedProjectRepoPath` (cli/bridge-studio-runs.ts:397) BEFORE calling
 * `loadProjectConfig(manifest.project_repo_path)` (line 423) — blesses the
 * DIRECTORY. But the loader used to RAW-APPEND the leaf
 * (`readFileSync(join(projectRoot, '.forge/project.json'))`) and follow whatever
 * that leaf pointed at. So a genuinely-contained projectRoot whose
 * `.forge/project.json` is a SYMLINK to an out-of-root victim config — or whose
 * `.forge` is itself a symlinked DIRECTORY — was READ out of root, disclosing the
 * victim's config back to the caller (the send-back would run the victim's
 * quality_gate_cmd). This is the Lens-C wire-reachable escape: the DIR is
 * blessed, the LEAF rode raw.
 *
 * The class fix routes the FULL path (leaf included) through
 * `guardedReadFile(projectRoot, ['.forge','project.json'])` — the leaf then fails
 * the per-segment realpath identity walk (`.forge/project.json` symlink) or the
 * `.forge` segment fails it (dir symlink), collapsing to `null` == absent
 * (fail-closed: config null, caller refuses), never an out-of-root read.
 *
 * These pins call `loadProjectConfig` DIRECTLY on a real, genuinely-contained
 * projectRoot in scratch fs, with the `.forge/project.json` leaf (or `.forge`
 * dir) symlinked to an out-of-root victim, and assert it does NOT disclose the
 * victim config (returns null — indistinguishable from absent, no oracle). This
 * is the primitive the wire path (verdict send-back) delegates to; the verdict
 * route's own DIR containment is pinned separately by
 * bridge-studio-runs-verdict-containment.test.ts.
 *
 * FALSE-NEGATIVE DISCIPLINE (immutable-gates): every precondition is asserted by
 * execution BEFORE the verdict — the projectRoot DIR is a real, non-symlink
 * directory (a plain dir-traversal is a different escape the DIR guard already
 * covers), the `.forge/project.json` leaf (or `.forge` dir) is a GENUINE symlink
 * whose target is out of root, and the victim config on disk carries a
 * distinctive marker cmd that a leak would surface. Victim lives under
 * os.tmpdir(), a sibling OUTSIDE projectRoot.
 *
 * RED-ON-PRE-FIX: each `(RED)` test FAILS on the raw existsSync+readFileSync
 * loader (it follows the symlink and returns the victim config); GREEN after the
 * guardedReadFile fix. The positive control passes before AND after.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  lstatSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';

import { loadProjectConfig } from '../orchestrator/project-config.ts';

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** A minimal, VALID project.json body carrying a distinctive gate cmd so a leak
 *  is visible in the returned config's `quality_gate_cmd`. */
function configJson(marker: string): string {
  return JSON.stringify({ testProcess: { local: { cmd: [marker] } } });
}

const VICTIM_MARKER = 'VICTIM-PWNED-CMD-9f3ac';

let scratchRoot: string;
let symlinksUnavailable = false;
const cleanup: string[] = [];

before(() => {
  scratchRoot = tmp('sec04-lpc-');
  cleanup.push(scratchRoot);
  // Symlink-capability probe (Windows/dev-container guard, mirrors the sibling
  // SEC-04 leaf pins).
  const probeTarget = tmp('sec04-lpc-probe-');
  cleanup.push(probeTarget);
  try {
    const link = join(scratchRoot, '__symlink_probe__');
    symlinkSync(probeTarget, link, 'dir');
    rmSync(link, { force: true });
  } catch {
    symlinksUnavailable = true;
  }
});

after(() => {
  for (const d of cleanup) rmSync(d, { recursive: true, force: true });
});

function skipIfNoSymlinks(t: { skip: (msg?: string) => void }): boolean {
  if (symlinksUnavailable) {
    t.skip('symlink creation unavailable in this environment');
    return true;
  }
  return false;
}

/** A real, genuinely-contained projectRoot (a real directory, NOT a symlink)
 *  under scratchRoot. */
function newProjectRoot(name: string): string {
  const root = join(scratchRoot, name);
  mkdirSync(root, { recursive: true });
  return root;
}

// ---------------------------------------------------------------------------
// Positive control (mandatory) — passes before AND after the fix.
// ---------------------------------------------------------------------------

test('positive control: a real (non-symlink) .forge/project.json loads its own cmd', () => {
  const root = newProjectRoot('legit-real');
  mkdirSync(join(root, '.forge'), { recursive: true });
  writeFileSync(join(root, '.forge', 'project.json'), configJson('legit-real-cmd'));

  const cfg = loadProjectConfig(root);
  assert.ok(cfg, 'a real contained config must load');
  assert.deepEqual(cfg!.quality_gate_cmd, ['legit-real-cmd'],
    'the loaded config must be the projectRoot\'s OWN config');
});

test('positive control: an absent .forge/project.json returns null', () => {
  const root = newProjectRoot('legit-absent');
  assert.equal(loadProjectConfig(root), null, 'absent config → null (unchanged)');
});

// ---------------------------------------------------------------------------
// (RED) — the leaf / dir symlink escapes.
// ---------------------------------------------------------------------------

test('(RED) a symlinked .forge/project.json LEAF pointing out of root is NOT read (no disclosure)', (t) => {
  if (skipIfNoSymlinks(t)) return;
  // Victim config OUTSIDE the projectRoot (sibling under tmpdir).
  const outside = tmp('sec04-lpc-leaf-outside-');
  cleanup.push(outside);
  const victim = join(outside, 'victim-project.json');
  writeFileSync(victim, configJson(VICTIM_MARKER));

  const root = newProjectRoot('evil-leaf');
  mkdirSync(join(root, '.forge'), { recursive: true });
  const leaf = join(root, '.forge', 'project.json');
  symlinkSync(victim, leaf, 'file');

  // Preconditions by execution: the projectRoot + .forge are REAL directories
  // (this is the LEAF vector), and project.json is a genuine out-of-root symlink.
  assert.ok(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink(),
    'precondition: projectRoot is a real, contained directory');
  assert.ok(lstatSync(join(root, '.forge')).isDirectory() && !lstatSync(join(root, '.forge')).isSymbolicLink(),
    'precondition: .forge is a real directory (leaf is the only out-of-root hop)');
  assert.ok(lstatSync(leaf).isSymbolicLink(), 'precondition: project.json is a symlink');
  assert.equal(relative(root, join(root, '.forge', 'project.json')).split(sep)[0], '.forge',
    'precondition: the lexical path is inside root — only the symlink target escapes');

  const cfg = loadProjectConfig(root);
  assert.equal(
    cfg, null,
    `loadProjectConfig followed a symlinked .forge/project.json leaf and disclosed the out-of-root victim (cmd=${JSON.stringify(cfg?.quality_gate_cmd)}) — must return null`,
  );
});

test('(RED) a symlinked .forge DIRECTORY pointing out of root is NOT read (nested-segment escape)', (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = tmp('sec04-lpc-dir-outside-');
  cleanup.push(outside);
  // The victim .forge dir (out of root) with a real project.json inside it.
  mkdirSync(join(outside, 'project.json') /* placeholder overwritten below */, { recursive: true });
  rmSync(join(outside, 'project.json'), { recursive: true, force: true });
  writeFileSync(join(outside, 'project.json'), configJson(VICTIM_MARKER));

  const root = newProjectRoot('evil-dir');
  const forgeLink = join(root, '.forge');
  symlinkSync(outside, forgeLink, 'dir');

  assert.ok(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink(),
    'precondition: projectRoot is a real, contained directory');
  assert.ok(lstatSync(forgeLink).isSymbolicLink(), 'precondition: .forge is a symlinked directory out of root');

  const cfg = loadProjectConfig(root);
  assert.equal(
    cfg, null,
    `loadProjectConfig followed a symlinked .forge directory and disclosed the out-of-root victim (cmd=${JSON.stringify(cfg?.quality_gate_cmd)}) — must return null`,
  );
});

// A guard-shape anchor: the projectRoot itself is genuinely contained under
// scratchRoot (relative does NOT step out) — so the escapes above are
// attributable to the LEAF / nested .forge segment, not a projectRoot-level
// traversal (which the DIR guard at the call sites already covers).
test('anchor: the planted projectRoot is genuinely contained under scratchRoot', (t) => {
  if (skipIfNoSymlinks(t)) return;
  const root = join(scratchRoot, 'evil-leaf');
  assert.notEqual(relative(scratchRoot, root).split(sep)[0], '..',
    'projectRoot is inside scratchRoot (leaf / .forge symlink is the only out-of-root hop)');
});
