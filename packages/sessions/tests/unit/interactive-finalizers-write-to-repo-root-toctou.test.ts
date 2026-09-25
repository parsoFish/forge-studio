/**
 * Bead forge-8vfn.6.6 review, defect 2 — writeToRepoRoot's destination-leaf
 * write must use the SAME fd-hardened discipline copyStagingToLibrary's
 * `writeValidatedLibraryFile` already does (O_NOFOLLOW, now with a `mode:
 * 'truncate'` variant for AGENTS.md-style overwrite semantics — see that
 * function's own doc comment in interactive-finalizers.ts), not a plain
 * `writeFileSync` that would happily follow a symlink planted at the exact
 * leaf between the destination containment check (`resolveGuardedPath`) and
 * the write.
 *
 * Mirrors `interactive-finalizers-toctou.test.ts`'s own established
 * monkeypatch technique EXACTLY (same header rationale for why a bare
 * `require()` patch is silently inert against a statically-imported ESM
 * module, and why `syncBuiltinESMExports()` is the one mechanism that
 * reaches back into the already-materialized facade) — adapted to
 * `writeToRepoRoot`'s own call shape. Unlike `copyStagingToLibrary`
 * (Phase-1-validate-everything, THEN Phase-2-write-everything, with real
 * separation in time between an entry's own check and its own use),
 * `writeToRepoRoot`'s loop checks and writes ONE entry per iteration with no
 * cross-entry phase split — so the hook here targets the ONE call that sits
 * between THIS entry's own `resolveGuardedPath` check and its own write:
 * `mkdirSync(dirname(destGuard.realPath), { recursive: true })`, called
 * once per entry, immediately before the write.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, lstatSync, realpathSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { writeToRepoRoot } from '../../interactive-finalizers.ts';

/** Mirrors interactive-finalizers-toctou.test.ts's own `installLstatTrigger`
 *  exactly, targeting `mkdirSync` instead — the call writeToRepoRoot makes
 *  immediately before its own write, once per entry. */
function installMkdirTrigger(triggerPath: string, onTrigger: () => void): () => void {
  const require = createRequire(import.meta.url);
  const fsCjs = require('node:fs') as unknown as { mkdirSync: unknown };
  const original = fsCjs.mkdirSync as (...args: unknown[]) => unknown;
  let fired = false;
  const patched = (...args: unknown[]): unknown => {
    if (!fired && args[0] === triggerPath) {
      fired = true;
      onTrigger();
    }
    return original(...args);
  };
  fsCjs.mkdirSync = patched;
  syncBuiltinESMExports();
  return function uninstall(): void {
    fsCjs.mkdirSync = original;
    syncBuiltinESMExports();
  };
}

function containedUnder(allowedRoot: string): (candidate: string, opts: { forgeRoot: string; projectsRoot?: string }) => boolean {
  return (candidate: string) => {
    const real = resolve(candidate);
    return real === allowedRoot || real.startsWith(`${allowedRoot}${sep}`);
  };
}

test(
  'ESCAPE (TOCTOU): a destination leaf swapped for a symlink AFTER the destination containment check but BEFORE the write is refused, not followed',
  async (t) => {
    const base = mkdtempSync(join(tmpdir(), 'finalizer-writetorepo-toctou-'));
    const sessionDir = join(base, '_instructions', 'sess-001');
    const stagingDir = join(sessionDir, 'staging');
    const repoPathRaw = join(base, 'project-repo');
    mkdirSync(stagingDir, { recursive: true });
    mkdirSync(repoPathRaw, { recursive: true });
    const repoPath = realpathSync(repoPathRaw);

    const secretDir = mkdtempSync(join(tmpdir(), 'finalizer-writetorepo-SECRET-'));
    const secretFile = join(secretDir, 'secret.env');
    const secretBytes = 'API_KEY=SECRET-MUST-NEVER-BE-OVERWRITTEN-c71fa2';
    writeFileSync(secretFile, secretBytes);

    writeFileSync(join(stagingDir, 'AGENTS.md'), 'ATTACKER-CONTROLLED CONTENT');

    const expectedDestLeaf = join(repoPath, 'AGENTS.md');
    let swapPerformed = false;
    let symlinkUnavailable = false;
    let swapError: unknown = null;

    // The trigger fires on mkdirSync(repoPath, ...) — dirname('<repoPath>/AGENTS.md') === repoPath — the ONE call
    // writeToRepoRoot makes between this entry's own destGuard check and its own write.
    const uninstall = installMkdirTrigger(repoPath, () => {
      try {
        symlinkSync(secretFile, expectedDestLeaf);
        swapPerformed = true;
      } catch (err) {
        symlinkUnavailable = true;
        swapError = err;
      }
    });

    let error: Error | null = null;
    try {
      try {
        await writeToRepoRoot({
          sessionDir,
          forgeRoot: repoPath,
          libraryRoot: repoPath,
          project_repo_path: repoPath,
          project: 'fixture-project',
          isContainedProjectRepoPath: containedUnder(repoPath),
        });
      } catch (err) {
        error = err as Error;
      }

      if (symlinkUnavailable) {
        t.skip(`symlink creation unavailable in this environment: ${String(swapError)}`);
        return;
      }

      assert.ok(swapPerformed, 'arrange: the mkdirSync trigger must have fired and planted the symlink — if this is false the whole test is vacuous');
      assert.ok(lstatSync(expectedDestLeaf).isSymbolicLink(), 'arrange: the destination leaf must genuinely be a symlink after the swap');
      assert.equal(realpathSync(expectedDestLeaf), realpathSync(secretFile), 'arrange: the planted symlink must genuinely resolve to the outside secret');

      // ---- THE SECURITY ASSERTION ----
      assert.equal(
        readFileSync(secretFile, 'utf8'),
        secretBytes,
        `the outside secret file must be byte-unchanged. Observed: error=${error ? `${error.name}: ${error.message}` : 'none (call returned normally)'}`,
      );
    } finally {
      uninstall();
      rmSync(base, { recursive: true, force: true });
      rmSync(secretDir, { recursive: true, force: true });
    }
  },
);
