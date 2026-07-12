# mdtoc — Patterns

> Category index. Lists theme pages describing **proven approaches that work in this project**.

`brain-lint` ensures every theme page with `category: pattern` appears here exactly once.

## Theme pages

- [`anchor-slug-fidelity`](./themes/anchor-slug-fidelity.md) — For a TOC generator the links must resolve; slug drift (host slugging rules) and duplicate-heading disambiguation are the two dominant failure modes, both invisible to a "does it produce a list" test — so the acceptance fixture carries a duplicated heading + a fenced fake heading and the read-back asserts the -1 suffix and the fenced exclusion.

## Format

Each entry on this index is one line:

```markdown
- [`<theme-slug>`](./themes/<theme-slug>.md) — one-line hook from the theme page's `description` frontmatter.
```
