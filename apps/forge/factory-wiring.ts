/**
 * factory-wiring.ts — the ONE place the assembly names the installed example
 * factory (ADR 048, clause 2's seam), and the only module in the repository
 * that may import `@forge/factory` at all.
 *
 * `packages/flows` declares the ports and imports no factory, so something has
 * to bind them. That something is the assembly, and it is this file alone.
 *
 * **Absence is a supported state, not an error.** The resolution is dynamic and
 * `resolveInstalledFactory()` answers `null` when `@forge/factory` does not
 * resolve; every caller degrades rather than throwing, which is what makes
 * `packages/factory` removable with `forge studio` still booting (exit row 5,
 * proven by the `factory-deletable` CI job, ADR 048 clause 3).
 *
 * WHAT IS NOT SWALLOWED. Only a module-not-found naming `@forge/factory` counts
 * as "no example installed". A factory that IS installed and throws while
 * loading — a syntax error, a bad transitive import, a failing top-level await —
 * propagates. A catch-all here would turn every future breakage in the example
 * into a silent "no example installed", which is the fail-open shape this
 * milestone keeps finding, dressed up as graceful degradation.
 */
import type { PhaseWiring } from '@forge/flows/phase-wiring.ts';

/**
 * Everything the assembly binds from the example. One record rather than a
 * dozen accessors: the package is present or it is not, and a per-surface
 * answer would let half a factory look installed.
 */
export type InstalledFactory = {
  /** The shipped example factory's phase wiring (ADR 028's runner ports). */
  readonly phaseWiring: PhaseWiring;
  /**
   * The class → gate-profile answer for the plan gate (ADR 051, ruling 229
   * half B). `null` for a class the installed table does not know, so an
   * unknown class is neither permissive nor forbidden — the plan gate simply
   * has no opinion, the honest answer when the table cannot speak to it.
   */
  singleWiAllowed(changeClass: string): boolean | null;
  /** True for a string the installed class table knows (`band-agent-deps.ts`). */
  isChangeClass(value: string): boolean;
  /** The band pipeline: the one read-only review agent (spec §5 item 5). */
  runAdversarialReview: typeof import('@forge/factory/phases/adversarial-review.ts')['runAdversarialReview'];
  /** The review-comment store behind `/api/review-comments/*`. */
  readonly reviewComments: typeof import('@forge/factory/review-comments.ts');
  /** The release-finalize phase behind the verdict hook. */
  runReleaseFinalize: typeof import('@forge/factory/phases/release-finalize.ts')['runReleaseFinalize'];
  /** Feedback reconciliation at bridge boot. */
  reconcileReflectFeedback: typeof import('@forge/factory/reflect-reconcile.ts')['reconcileReflectFeedback'];
  /** The reflector re-run the feedback route fires. */
  rerunReflector: typeof import('@forge/factory/reflector-rerun.ts')['rerunReflector'];
};


/**
 * Memoized: `undefined` = not yet resolved, `null` = resolved and absent. One
 * import of each entry point per process, and one answer — a second resolution
 * could disagree with the first if the tree changed under a running bridge.
 */
let resolved: InstalledFactory | null | undefined;

/** True for the one error that means "no example package is installed". */
export function isFactoryNotInstalled(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') return false;
  return String((err as { message?: unknown }).message ?? '').includes('@forge/factory');
}

/**
 * The installed example factory, or `null` when none is installed.
 *
 * Every specifier below is a literal, so the bundler and the boundary lint can
 * both see them; they are dynamic only in WHEN they load, never in WHAT.
 */
export async function resolveInstalledFactory(): Promise<InstalledFactory | null> {
  if (resolved !== undefined) return resolved;
  try {
    const [executorTable, executorDeps, reflector, classProfiles, review, reviewComments, releaseFinalize, reflectReconcile, reflectorRerun] =
      await Promise.all([
        import('@forge/factory/phases/executor-table.ts'),
        import('@forge/factory/phases/executor-deps.ts'),
        import('@forge/factory/phases/reflector.ts'),
        import('@forge/factory/class-profiles.ts'),
        import('@forge/factory/phases/adversarial-review.ts'),
        import('@forge/factory/review-comments.ts'),
        import('@forge/factory/phases/release-finalize.ts'),
        import('@forge/factory/reflect-reconcile.ts'),
        import('@forge/factory/reflector-rerun.ts'),
      ]);
    resolved = {
      phaseWiring: {
        executor: executorTable.createPhaseExecutor(),
        projectGate: executorDeps.createProjectGate(),
        runClosure: executorDeps.defaultRunClosure,
        runReflector: reflector.runReflector,
      },
      singleWiAllowed(changeClass: string): boolean | null {
        const profile = (classProfiles.CLASS_PROFILES as Record<string, { singleWiAllowed: boolean } | undefined>)[changeClass];
        return profile === undefined ? null : profile.singleWiAllowed;
      },
      isChangeClass: (value: string) => classProfiles.isChangeClass(value),
      runAdversarialReview: review.runAdversarialReview,
      reviewComments,
      runReleaseFinalize: releaseFinalize.runReleaseFinalize,
      reconcileReflectFeedback: reflectReconcile.reconcileReflectFeedback,
      rerunReflector: reflectorRerun.rerunReflector,
    };
    return resolved;
  } catch (err) {
    if (!isFactoryNotInstalled(err)) throw err;
    resolved = null;
    return null;
  }
}

/** The message every surface prints when a factory verb is asked for and none is installed. */
export const NO_EXAMPLE_INSTALLED =
  'no example factory is installed (`packages/factory` does not resolve) — this surface is the example\'s, not the platform\'s (ADR 048)';

/** Test seam ONLY: forget the memoized answer so a test can resolve again. */
export function resetInstalledFactoryForTests(): void {
  resolved = undefined;
}

/**
 * The memoized answer WITHOUT awaiting — `undefined` until something has
 * resolved. For a synchronous caller (a route handler) that runs only after the
 * bridge's own boot-time `resolveInstalledFactory()`; it never triggers a
 * resolution of its own, so it cannot answer "absent" for a factory that simply
 * has not been asked for yet.
 */
export function peekInstalledFactory(): InstalledFactory | null | undefined {
  return resolved;
}

/**
 * The installed example, for a caller that has already established one is
 * there. Throws rather than returning null: a surface that reached a factory
 * verb without its own absence guard is a wiring bug, and a null-returning
 * accessor would let it degrade into a wrong ANSWER instead of an error.
 */
export function installedExample(): InstalledFactory {
  if (!resolved) throw new Error(NO_EXAMPLE_INSTALLED);
  return resolved;
}

/**
 * The review-comment sidecar, bound. These live in the seam rather than at the
 * bridge because the seam is where the assembly names the example — the bridge
 * only calls them.
 */
export const reviewCommentsBinding = {
  read: (logsRoot: string, cycleId: string) => installedExample().reviewComments.readReviewComments(logsRoot, cycleId),
  write: (logsRoot: string, cycleId: string, sidecar: ReturnType<InstalledFactory['reviewComments']['readReviewComments']>) =>
    installedExample().reviewComments.writeReviewComments(logsRoot, cycleId, sidecar),
  append: (...a: Parameters<InstalledFactory['reviewComments']['appendReviewComment']>) => installedExample().reviewComments.appendReviewComment(...a),
  resolve: (...a: Parameters<InstalledFactory['reviewComments']['resolveComment']>) => installedExample().reviewComments.resolveComment(...a),
  edit: (...a: Parameters<InstalledFactory['reviewComments']['editComment']>) => installedExample().reviewComments.editComment(...a),
  remove: (...a: Parameters<InstalledFactory['reviewComments']['deleteComment']>) => installedExample().reviewComments.deleteComment(...a),
  verdict: (...a: Parameters<InstalledFactory['reviewComments']['deriveVerdictFromComments']>) => installedExample().reviewComments.deriveVerdictFromComments(...a),
  path: (logsRoot: string, cycleId: string) => installedExample().reviewComments.reviewCommentsPath(logsRoot, cycleId),
  isSafeCycleId: (cycleId: string) => installedExample().reviewComments.isSafeCycleId(cycleId),
  get max(): number { return installedExample().reviewComments.REVIEW_COMMENTS_MAX; },
} as const;

/**
 * The example, or a loud exit. For CLI verbs that ARE the example's: with none
 * installed there is nothing to do and nothing to report but that, so the verb
 * fails as a usage error (exit 2) rather than passing on an empty result.
 */
export async function requireInstalledFactory(verb: string): Promise<InstalledFactory> {
  const factory = await resolveInstalledFactory();
  if (factory === null) { console.error(`${verb}: ${NO_EXAMPLE_INSTALLED}`); process.exit(2); }
  return factory;
}
