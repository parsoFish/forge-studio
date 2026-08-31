/**
 * Forge Studio object model (ADR 027). Pure types — no logic.
 *
 * The definitions moved to `@forge/contracts` in M2: they are browser-safe
 * types with no runtime behaviour, which is exactly what that package is for,
 * and `apps/studio` may import nothing else. This file stays as the legacy
 * path's re-export so the 58 modules that import it do not all change in a
 * move PR; it goes when those callers are ported to their own packages.
 */
export * from '@forge/contracts';
