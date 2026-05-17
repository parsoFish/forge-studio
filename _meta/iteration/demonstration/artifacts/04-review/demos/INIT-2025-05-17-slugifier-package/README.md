# Demo — INIT-2025-05-17-slugifier-package

This recording demonstrates the canonical URL-safe slugifier package introduced in this initiative. It exercises every acceptance criterion from FEAT-1 (core `slugify` function: empty-string passthrough, ASCII lowercasing with hyphens, number preservation, NFD accent stripping, emoji/non-Latin drop-to-empty, consecutive-separator collapse, and leading/trailing hyphen trimming), FEAT-2 (batch helpers: `slugifyMany` order-preservation across an array including empty strings, and `uniqueSlug` suffix-disambiguation producing `foo`, `foo-2`, `foo-3`, and `foo-5`), and FEAT-3 (configurable `SlugifyOptions`: custom separator, `maxLength` truncation with trailing-separator re-trim, combined options, empty-options defaults, and non-positive `maxLength` ignored). The session then runs `npm test --silent` to confirm all 21 tests pass under the Node.js `--experimental-strip-types` runner.

**Prerequisites:** Node.js ≥ 22 (for `--experimental-strip-types`); no `npm install` required — the package has no runtime dependencies.

**Expected outcome:** All `console.log` calls print the slugified value matching the AC, and the final `npm test` run shows `pass 21 / fail 0`.
