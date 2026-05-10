# slugifier

URL-safe slug generation. Merged sample tree for the reflection bench fixture
`slugifier-merged`.

## Surface

- `slugify(input, options?)` — single-string slug.
- `slugifyMany(inputs)` — batch slugifier.
- `uniqueSlug(candidate, taken)` — disambiguates collisions with `-N` suffix.

See `src/slugify.ts` and `src/batch.ts`.
