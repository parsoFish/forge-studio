/**
 * The ONE shim through which the legacy trees reach `@forge/contracts`.
 *
 * `docs/roadmaps/1.0.md` §0: "legacy imports a package only via
 * `orchestrator/_pkg/<pkg>.ts`". One greppable file per package, deleted at
 * cutover, and `scripts/check-boundaries.mjs` fails any legacy import of a
 * package that does not come through here.
 *
 * It exists so the move is reversible and countable: `grep -rl "_pkg/contracts"`
 * is the exact list of legacy files still depending on the package.
 */
export * from '@forge/contracts';
