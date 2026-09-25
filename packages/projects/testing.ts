/**
 * `@forge/projects/testing` — the test-only subpath (bead forge-8vfn.5.31).
 *
 * `parseSkills` has no production consumer outside this package today — only
 * `scripts/skill-example-validators.test.ts` reaches for it. Folding it into
 * the main door (`index.ts`) would widen the package's PRODUCTION public API
 * on the strength of a test's convenience; a dedicated subpath keeps the
 * distinction the brief asks for.
 */
export { parseSkills } from './project-config-validate.ts';
export { checkDemo } from './preflight.ts';
export { StudioWritePathIgnoredError } from './project-repo-tx.ts';
