/**
 * The ONE shim through which the legacy trees reach `@forge/kernel`.
 *
 * `docs/roadmaps/1.0.md` §0: "legacy imports a package only via
 * `orchestrator/_pkg/<pkg>.ts`". `grep -rl "_pkg/kernel"` is the exact list of
 * legacy files still depending on the package, and the shim is deleted at
 * cutover.
 */
export * from '@forge/kernel';
