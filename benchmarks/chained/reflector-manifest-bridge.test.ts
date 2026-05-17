/**
 * Deterministic regression tests for chained-bench FALSE-RED **Bug B**,
 * proven against a PRESERVED real paid-run tempdir (run-4).
 *
 * The real run proved forge works end-to-end and closure genuinely succeeded
 * (events: `closure.manifest-moved-to-done`, `closure.end`). But the chained
 * bench MISREAD the artifacts and scored reflection = error
 * (`reflector.manifest-unreadable`). This is a harness root bug, NOT a forge
 * bug and NOT LLM stochasticity — deterministically reproducible from the
 * preserved artifacts with NO SDK call and NO paid run.
 *
 *   Bug B — the reflector (anchored at the REAL forge root) resolves the
 *           moved manifest via
 *           `resolveCurrentManifestPath(input.manifestPath, realForgeRoot)`.
 *           Closure moved the manifest to the *tempdir* `_queue/done/`, so
 *           the reflector's fallback to `<realForgeRoot>/_queue/done/<id>.md`
 *           ENOENTs.
 *
 * Fixture: /tmp/forge-bench-chained-cxi6td/ (do not mutate or delete). The
 * fixture-bound assertions read it READ-ONLY (the bridge symlinks point AT
 * it; nothing writes to it). If the fixture is absent the fixture-bound
 * assertions skip — the synthetic precedence/cleanup assertions still run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import {
  bridgeMovedManifestForReflector,
  removeReflectorManifestBridge,
} from './reflector-manifest-bridge.ts';

const PRESERVED = '/tmp/forge-bench-chained-cxi6td';
const INITIATIVE_ID = 'INIT-2026-05-17-canonical-slugifier';
const FIXTURE_PRESENT = existsSync(PRESERVED);

const SKIP_MSG =
  `preserved run-4 fixture absent at ${PRESERVED} ` +
  '(fixture-bound assertion skipped; synthetic coverage still runs)';

/**
 * Mirror the reflector's OWN resolution (orchestrator/phases/reflector.ts:
 * `resolveCurrentManifestPath`, which is module-private) so the test asserts
 * against EXACTLY what the runtime checks.
 */
function reflectorWouldResolve(
  originalPath: string,
  forgeRoot: string,
): string {
  if (existsSync(originalPath)) return originalPath;
  const filename = basename(originalPath);
  for (const p of [
    resolve(forgeRoot, '_queue', 'done', filename),
    resolve(forgeRoot, '_queue', 'ready-for-review', filename),
    resolve(forgeRoot, '_queue', 'failed', filename),
  ]) {
    if (existsSync(p)) return p;
  }
  return originalPath;
}

function makeRealRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'forge-frB-realroot-'));
  for (const q of [
    'pending',
    'in-flight',
    'ready-for-review',
    'done',
    'failed',
  ]) {
    mkdirSync(resolve(root, '_queue', q), { recursive: true });
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('Bug B repro: without the bridge the reflector resolves the moved manifest to a NON-EXISTENT real-forge path (the false-red ENOENT)', () => {
  if (!FIXTURE_PRESENT) return assert.ok(true, SKIP_MSG);
  const real = makeRealRoot();
  try {
    const inFlightTempdirPath = resolve(
      PRESERVED,
      '_queue',
      'in-flight',
      `${INITIATIVE_ID}.md`,
    );
    // Closure moved it out of in-flight → the tempdir done/ holds it.
    assert.equal(
      existsSync(inFlightTempdirPath),
      false,
      'closure moved the manifest out of the tempdir in-flight/',
    );
    assert.equal(
      existsSync(resolve(PRESERVED, '_queue', 'done', `${INITIATIVE_ID}.md`)),
      true,
      'preserved run: the manifest lives in the tempdir _queue/done/',
    );

    const resolved = reflectorWouldResolve(inFlightTempdirPath, real.root);
    // Falls back to the (now non-existent) original path → ENOENT on read.
    assert.equal(resolved, inFlightTempdirPath);
    assert.equal(
      existsSync(resolved),
      false,
      'reflector would ENOENT here → reflector.manifest-unreadable (the false-red)',
    );
  } finally {
    real.cleanup();
  }
});

test('Bug B fix: the bridge makes resolveCurrentManifestPath(inFlightTempdirPath, realForgeRoot) resolve the moved done/ manifest; cleanup leaves no residue', () => {
  if (!FIXTURE_PRESENT) return assert.ok(true, SKIP_MSG);
  const real = makeRealRoot();
  let bridge: ReturnType<typeof bridgeMovedManifestForReflector> = null;
  try {
    const inFlightTempdirPath = resolve(
      PRESERVED,
      '_queue',
      'in-flight',
      `${INITIATIVE_ID}.md`,
    );
    const tempdirDone = resolve(
      PRESERVED,
      '_queue',
      'done',
      `${INITIATIVE_ID}.md`,
    );

    bridge = bridgeMovedManifestForReflector({
      tempdir: PRESERVED,
      initiativeId: INITIATIVE_ID,
      inFlightManifestPath: inFlightTempdirPath,
      realForgeRoot: real.root,
    });
    assert.ok(bridge, 'bridge installed');
    // The done/ link's target (tempdir done/) exists → resolvedPath is the
    // real-forge done/ link, exactly what the reflector picks first.
    assert.equal(
      bridge!.resolvedPath,
      resolve(real.root, '_queue', 'done', `${INITIATIVE_ID}.md`),
      'bridge resolvedPath = real-forge done/ link',
    );

    // The reflector's OWN resolution now finds + can READ the manifest.
    const resolved = reflectorWouldResolve(inFlightTempdirPath, real.root);
    assert.equal(
      resolved,
      resolve(real.root, '_queue', 'done', `${INITIATIVE_ID}.md`),
      'reflector resolves the bridged real-forge done/ path',
    );
    assert.equal(existsSync(resolved), true, 'no ENOENT — the manifest is readable');
    const body = readFileSync(resolved, 'utf8');
    assert.match(
      body,
      new RegExp(`initiative_id:\\s*${INITIATIVE_ID}`),
      'bridged manifest is the genuine moved manifest (parses the right id)',
    );
    assert.ok(body.length > 1000, 'full manifest content followed through the symlink');

    // Cleanup → no residue under the real forge _queue/.
    removeReflectorManifestBridge(bridge);
    bridge = null;
    for (const q of ['done', 'ready-for-review', 'in-flight', 'pending']) {
      assert.equal(
        existsSync(resolve(real.root, '_queue', q, `${INITIATIVE_ID}.md`)),
        false,
        `no bridged link left under real _queue/${q}/`,
      );
    }
    // The tempdir source is untouched (the bridge only READS it via symlink).
    assert.equal(
      existsSync(tempdirDone),
      true,
      'tempdir done/ manifest untouched (read-only source)',
    );
  } finally {
    removeReflectorManifestBridge(bridge);
    real.cleanup();
  }
});

test('reflector-manifest-bridge: symlink activates the instant the tempdir target appears (models closure moving the manifest mid-runCycle)', () => {
  // Synthetic — proves the load-bearing symlink-to-future-target semantics
  // the fix relies on (the bridge is installed BEFORE runCycle; the tempdir
  // done/ target only appears when closure runs mid-cycle).
  const tmp = mkdtempSync(join(tmpdir(), 'forge-frB-tmp-'));
  const real = makeRealRoot();
  const id = 'INIT-2026-05-17-x';
  try {
    for (const q of [
      'pending',
      'in-flight',
      'ready-for-review',
      'done',
      'failed',
    ]) {
      mkdirSync(resolve(tmp, '_queue', q), { recursive: true });
    }
    // Manifest starts in the tempdir in-flight/ (as at runCycle start).
    const inFlight = resolve(tmp, '_queue', 'in-flight', `${id}.md`);
    writeFileSync(inFlight, 'initiative_id: INIT-2026-05-17-x\nfoo: bar\n');

    const bridge = bridgeMovedManifestForReflector({
      tempdir: tmp,
      initiativeId: id,
      inFlightManifestPath: inFlight,
      realForgeRoot: real.root,
    });
    assert.ok(bridge);
    // At install time the in-flight target exists; done/ does not yet → the
    // resolver would pick the in-flight link (not done/) right now.
    assert.equal(
      bridge!.resolvedPath,
      resolve(real.root, '_queue', 'in-flight', `${id}.md`),
      'pre-closure: resolves the in-flight link (done/ target absent)',
    );

    // Closure moves it in-flight/ → done/ INSIDE the tempdir (rename).
    const tmpDone = resolve(tmp, '_queue', 'done', `${id}.md`);
    renameSync(inFlight, tmpDone);

    // The done/ link now resolves (target appeared); the reflector picks it
    // FIRST (done > in-flight precedence) — exactly the runtime sequence.
    assert.equal(
      bridge!.resolvedPath,
      resolve(real.root, '_queue', 'done', `${id}.md`),
      'post-closure: resolves the done/ link (target now exists)',
    );
    const resolved = reflectorWouldResolve(inFlight, real.root);
    assert.equal(resolved, resolve(real.root, '_queue', 'done', `${id}.md`));
    assert.equal(
      readFileSync(resolved, 'utf8'),
      'initiative_id: INIT-2026-05-17-x\nfoo: bar\n',
      'reads the moved manifest through the symlink',
    );

    removeReflectorManifestBridge(bridge);
    for (const q of ['done', 'ready-for-review', 'in-flight', 'pending']) {
      assert.equal(
        existsSync(resolve(real.root, '_queue', q, `${id}.md`)),
        false,
        `cleanup removed the ${q}/ link`,
      );
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    real.cleanup();
  }
});

test('reflector-manifest-bridge: NEVER clobbers a real forge manifest already at a bridge path', () => {
  // Synthetic — the safety invariant. A real (non-symlink) manifest sitting
  // in the real-forge done/ must be left exactly as-is.
  const tmp = mkdtempSync(join(tmpdir(), 'forge-frB-noclobber-tmp-'));
  const real = makeRealRoot();
  const id = 'INIT-2026-05-17-x';
  try {
    for (const q of [
      'pending',
      'in-flight',
      'ready-for-review',
      'done',
      'failed',
    ]) {
      mkdirSync(resolve(tmp, '_queue', q), { recursive: true });
    }
    writeFileSync(
      resolve(tmp, '_queue', 'done', `${id}.md`),
      'TEMPDIR-MANIFEST',
    );
    // A pre-existing REAL forge manifest with the same filename.
    const realDoneManifest = resolve(real.root, '_queue', 'done', `${id}.md`);
    writeFileSync(realDoneManifest, 'REAL-FORGE-MANIFEST-DO-NOT-TOUCH');

    const bridge = bridgeMovedManifestForReflector({
      tempdir: tmp,
      initiativeId: id,
      inFlightManifestPath: resolve(tmp, '_queue', 'in-flight', `${id}.md`),
      realForgeRoot: real.root,
    });
    // done/ was blocked (real file present) but a lower-precedence dir may
    // still have linked; either way the REAL manifest is byte-identical.
    assert.equal(
      readFileSync(realDoneManifest, 'utf8'),
      'REAL-FORGE-MANIFEST-DO-NOT-TOUCH',
      'pre-existing real forge done/ manifest left untouched',
    );
    removeReflectorManifestBridge(bridge);
    assert.equal(
      readFileSync(realDoneManifest, 'utf8'),
      'REAL-FORGE-MANIFEST-DO-NOT-TOUCH',
      'still untouched after cleanup (cleanup only removes OUR links)',
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    real.cleanup();
  }
});
