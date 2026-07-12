# terraform-provider-betterado — Decisions

> Category index. Lists theme pages describing **per-project architectural/design decisions**.

`brain-lint` ensures every theme page with `category: decision` appears here exactly once.

## Theme pages

## Format

Each entry on this index is one line:

```markdown
- [`<theme-slug>`](./themes/<theme-slug>.md) — one-line hook from the theme page's `description` frontmatter.
```

### Auto-linked (re-file under a curated heading when convenient)

- [`2026-06-20-tfacc-guard-relocate-decision`](./themes/2026-06-20-tfacc-guard-relocate-decision.md) — The TF_ACC skip guard on SharedReleaseFixture and the acceptance_gate requires_env list are permanent safety interlocks — never remove them. TF_ACC=1 is set only in the forge review/unifier phase and the operator's live shell. The CI gate always strips TF_ACC. This prevents false-pass (dogfood 2026-06-06/07) and avoids stray live resource creation.
