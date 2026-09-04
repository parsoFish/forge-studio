import { FORGE_ROOT } from '@forge/kernel/ids.ts';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyStagingToLibrary } from '../../../interactive-finalizers.ts';

/**
 * R4-22 WI-2 (T3, acceptance tests) — pins the contract for
 * `packages/sessions/interactive-finalizers.ts` BEFORE it exists (ADR-043 §2/§5).
 *
 * ADR-043 §5 ratifies a deep-frozen `FINALIZERS` registry of pure exported
 * functions with explicit error contracts (ADR-042's third boundary), seeded
 * incrementally — THIS WI seeds exactly ONE entry: `copyStagingToLibrary`,
 * the step a generic interactive runner invokes at the `committing` phase to
 * install a drafted package from its session's staging dir into the real
 * library under the forge root.
 *
 * THE CONTRACT THIS FILE PINS (my call, as the writer of these tests, on the
 * parts ADR-043/the WI leave open — stated explicitly so the implementer has
 * one target):
 *
 *   export type FinalizerId = 'copyStagingToLibrary';
 *   export type FinalizerFn = (ctx: FinalizerContext) => string[] | Promise<string[]>;
 *   export type FinalizerRow = { readonly id: FinalizerId; readonly run: FinalizerFn };
 *   export const FINALIZERS: readonly FinalizerRow[];               // deep-frozen, exactly 1 row today
 *   export function resolveFinalizer(id: string): FinalizerFn | undefined;  // TOTAL, never throws
 *   export function copyStagingToLibrary(ctx: {
 *     sessionDir: string;    // trusted — the caller already SEC-04-guarded this
 *     forgeRoot: string;     // trusted, config-derived
 *     libraryRoot: string;   // trusted, config-derived containment root
 *     packageId: string;     // UNTRUSTED, request-derived
 *   }): string[] | Promise<string[]>;                                // sync OR async — tests below `await`
 *                                                                     // either shape uniformly and never assume one
 *
 * Layout pinned: walks `<sessionDir>/staging/` recursively; installs each
 * entry at `<libraryRoot>/<packageId>/<relPath...>`, resolving that FULL
 * destination (leaf included) through the EXISTING `resolveGuardedPath`
 * (`packages/kernel/path-guard.ts`) with `packageId` and every relative-path
 * component passed as their OWN elements of `segments[]` — never folded into
 * the `root` argument (see that module's CONTRACT section: folding makes the
 * containment comparison tautological).
 *
 * Row field name (`run`) is my own naming choice — not dictated by the WI,
 * which specifies only the `id` vocabulary and the total-lookup shape.
 *
 * DISCIPLINE: this file is black-box against `copyStagingToLibrary` — it
 * never imports `resolveGuardedPath` directly and never assumes an internal
 * mechanism. Every escape test plants a distinguishable SECRET/CANARY
 * *before* invoking the finalizer and byte-compares it *after*, so a
 * rejection is proven to be containment, not an accidental miss (the
 * "counter-proof" discipline already established in
 * packages/kernel/path-guard.test.ts SEC-04 P1 etc.). Every symlink/hardlink
 * fixture asserts its own precondition (lstat/nlink) before reading the
 * verdict, and skips cleanly via `t.skip` if the platform cannot create the
 * link — never silently passes.
 *
 * RED-NOW: the entire suite fails at import time ("Cannot find module
 * './interactive-finalizers.ts'") because the module does not exist yet —
 * see the run output recorded in this WI's report.
 *
 * ADDENDUM (T3 second pass, R4-22 WI-2): a TOCTOU test pinning an
 * adversarial-review-REPRODUCED finding (not discovered by this file) was
 * added at the bottom — `copyStagingToLibrary`'s CHECK-THEN-WRITE is two
 * PHASES (`discoverStagingEntries` validates + records every entry's
 * `srcRealPath`; a later, separate loop `readFileSync`s each recorded path)
 * with a real gap between them: a staged entry swapped for a symlink to an
 * outside secret AFTER it passes Phase-1 containment but BEFORE Phase-2
 * reads it is followed straight into the library. See that test's own
 * header comment for the full mechanism, the determinism approach, and the
 * two dead-end probe attempts it documents to avoid repeating.
 */


/** Repo root, computed the same way packages/sessions/interactive-runner.test.ts's
 *  own REPO_ROOT does (`resolve(import.meta.dirname, '..')`) — robust
 *  regardless of the shell's cwd when the test runner is invoked, unlike a
 *  `process.cwd()`-relative path. Only P3 (below) reads a real, checked-in
 *  repo file (`skills/creation-agent/SKILL.md`); every other test in this
 *  file stays a pure isolated-tmpdir fixture, unaffected. */
export const REPO_ROOT = FORGE_ROOT;

// ---------------------------------------------------------------------------
// Scratch fs helpers — every test builds its own isolated tree under a fresh
// mkdtemp dir; nothing depends on process.cwd() or ambient state.
// ---------------------------------------------------------------------------

type Scratch = {
  base: string;
  forgeRoot: string;
  libraryRoot: string;
  sessionDir: string;
  stagingDir: string;
};

export function mkScratch(prefix: string): Scratch {
  const base = mkdtempSync(join(tmpdir(), prefix));
  const forgeRoot = join(base, 'forge');
  const libraryRoot = join(forgeRoot, 'library');
  const sessionDir = join(forgeRoot, '_authoring', 'sess-001');
  const stagingDir = join(sessionDir, 'staging');
  mkdirSync(libraryRoot, { recursive: true });
  mkdirSync(stagingDir, { recursive: true });
  return { base, forgeRoot, libraryRoot, sessionDir, stagingDir };
}

export function cleanup(...roots: string[]): void {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
}

/** Calls the finalizer and normalizes sync-throw / async-reject / sync-return
 *  / async-resolve into one shape, so tests never have to guess which of the
 *  two the implementation picked. `await` on a non-promise value just resolves
 *  to it immediately, and a synchronous throw inside the awaited expression is
 *  still caught by the surrounding try/catch — both cases collapse cleanly. */
export async function callAndCapture(ctx: {
  sessionDir: string;
  forgeRoot: string;
  libraryRoot: string;
  packageId: string;
}): Promise<{ error: (Error & { name: string }) | null; wrote: string[] | null }> {
  try {
    const wrote = await copyStagingToLibrary(ctx as never);
    return { error: null, wrote };
  } catch (err) {
    return { error: err as Error & { name: string }, wrote: null };
  }
}

/** JS-runtime built-in error names — a throw carrying one of these is an
 *  ACCIDENTAL crash (a bug), not a deliberate, explicit error contract. The
 *  finalizer must throw its OWN named error class. */
const BUILTIN_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
  'URIError',
]);

export function assertNamedThrow(err: (Error & { name: string }) | null, context: string): void {
  assert.ok(err, `${context}: must throw/reject, not silently succeed`);
  assert.ok(err instanceof Error, `${context}: rejection must be a real Error instance`);
  assert.ok(
    !BUILTIN_ERROR_NAMES.has(err!.name),
    `${context}: must throw a deliberately NAMED custom error (explicit error contract — ADR-042's third boundary), ` +
      `not a bare/accidental ${err!.name}. Got: ${err!.name}: ${err!.message}`,
  );
}

