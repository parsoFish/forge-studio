/**
 * The realpath containment guard (SEC-04).
 *
 * Moved to `@forge/kernel` in M2 with its history and its tests. This file
 * stays as the legacy path's re-export so a move PR does not touch the
 * modules that import it; it goes when those callers are ported.
 */
export * from '../orchestrator/_pkg/kernel.ts';
