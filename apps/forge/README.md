# `apps/forge/` — the assembly

> **The assembly.** The one tree that is allowed to know about every package,
> because binding them together is what it is for. Each package contributes a
> factory — routes, deps, a port implementation — and this tree wires them into
> a running bridge (`makeRouteTable(deps)`, ruling 59) and into the `forge` CLI.

It holds the HTTP host (`ui-bridge.ts`, `bridge-studio.ts`, `bridge-studio-writes.ts`),
the dry-run bridge (`dry-bridge.ts`), the Studio linter's CLI entry
(`studio-lint.ts`), the route table, boot/health and the watch identity — plus
every test that boots a real bridge or needs real objects from more than one
package (rulings 89/92).

**Direction is the whole rule.** The assembly may import any package; a package
may never import the assembly. `check-boundaries.mjs` names both halves —
`package-to-assembly` is a violation, `apps/forge → packages/*` is not a row —
so the shape is enforced rather than agreed (ruling 116). The assembly's own
remaining imports of `orchestrator/` are `assembly-to-legacy` rows, visible and
owned.

This tree absorbed `cli/` in the M4-flows host carve; the modules are
byte-identical, and 115 `legacy-to-package` rows closed because a legacy tree
importing a package is debt while an assembly importing a package is the design.

See [docs/repo-map.md](../../docs/repo-map.md) · the committed CLI reference at
[docs/reference/cli.md](../../docs/reference/cli.md).
