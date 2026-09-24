import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { copyStagingToLibrary, InteractiveFinalizerError } from '../../interactive-finalizers.ts';

/**
 * forge-7m2 — `copyStagingToLibrary` must read the staging dirname it walks
 * from `FinalizerContext.stagingDirName` (sourced, per the fix, from the
 * ADR-043 yaml turnSpec's authored field), never from a hardcoded `'staging'`
 * literal. Before this fix, `discoverStagingEntries`
 * (`packages/sessions/interactive-finalizers.ts`) hardcodes the literal at TWO call
 * sites, so a session kind that authors a non-default staging dirname has its
 * finalizer look in the wrong (literal) path and fail.
 *
 * Isolated fixture — deliberately NOT `test-fixtures/finalizer-scratch.ts`'s
 * `mkScratch` (which always builds a `staging/` child): this file exists
 * specifically to exercise a NON-default dirname, so it builds its own
 * scratch tree with the child directory named `drafts/`.
 */

type Scratch = { base: string; forgeRoot: string; libraryRoot: string; sessionDir: string };

function mkScratch(prefix: string): Scratch {
  const base = mkdtempSync(join(tmpdir(), prefix));
  const forgeRoot = join(base, 'forge');
  const libraryRoot = join(forgeRoot, 'library');
  const sessionDir = join(forgeRoot, '_authoring', 'sess-001');
  mkdirSync(libraryRoot, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  return { base, forgeRoot, libraryRoot, sessionDir };
}

test('RED/FIX: copyStagingToLibrary honors a NON-default ctx.stagingDirName ("drafts") — must not look at the hardcoded "staging" literal', async () => {
  const { base, forgeRoot, libraryRoot, sessionDir } = mkScratch('finalizer-staging-dirname-nondefault-');
  try {
    const draftsDir = join(sessionDir, 'drafts');
    mkdirSync(draftsDir, { recursive: true });
    const MARKER = '# non-default staging dirname marker 3c9a1f\n';
    writeFileSync(join(draftsDir, 'SKILL.md'), MARKER, 'utf8');

    // Deliberately no 'staging/' child exists at all — only 'drafts/'. Before
    // the fix, discoverStagingEntries's realpathSync(join(sessionDir,
    // 'staging')) throws "session staging directory is missing or
    // unreadable" because there IS no 'staging/' dir here, proving the
    // hardcoded literal (not ctx.stagingDirName) is what it actually reads.
    const ctx = { sessionDir, forgeRoot, libraryRoot, packageId: 'nondefault-pkg', stagingDirName: 'drafts' };
    let error: (Error & { name: string }) | null = null;
    let wrote: string[] | null = null;
    try {
      wrote = await copyStagingToLibrary(ctx as never);
    } catch (err) {
      error = err as Error & { name: string };
    }

    assert.equal(
      error,
      null,
      `copyStagingToLibrary must walk the AUTHORED stagingDirName ("drafts"), not a hardcoded "staging" literal: ` +
        `${error ? `${error.name}: ${error.message}` : ''}`,
    );
    const landed = (wrote ?? []).find((p) => p.endsWith(join('nondefault-pkg', 'SKILL.md')));
    assert.ok(landed, `expected a landed SKILL.md under the packageId dir, got wrote=${JSON.stringify(wrote)}`);
    assert.equal(readFileSync(landed!, 'utf8'), MARKER, 'the landed file must carry the staged content verbatim');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('RED/FIX: copyStagingToLibrary refuses (named error) when ctx.stagingDirName is omitted — never silently falls back to a literal', async () => {
  const { base, forgeRoot, libraryRoot, sessionDir } = mkScratch('finalizer-staging-dirname-missing-');
  try {
    // A 'staging/' child DOES exist here — if the fix silently defaulted to
    // 'staging' when ctx.stagingDirName is absent, this call would SUCCEED,
    // masking the very omission this test exists to catch.
    const stagingDir = join(sessionDir, 'staging');
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, 'SKILL.md'), 'should never be reached\n', 'utf8');

    const ctx = { sessionDir, forgeRoot, libraryRoot, packageId: 'missing-dirname-pkg' };
    let error: (Error & { name: string }) | null = null;
    try {
      await copyStagingToLibrary(ctx as never);
    } catch (err) {
      error = err as Error & { name: string };
    }

    assert.ok(error, 'must throw/reject, not silently default to a literal staging dirname');
    assert.ok(error instanceof InteractiveFinalizerError, `must throw InteractiveFinalizerError, got ${error!.name}`);
    assert.match(
      error!.message,
      /stagingDirName/,
      `the refusal must name the missing field, got: ${error!.message}`,
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
