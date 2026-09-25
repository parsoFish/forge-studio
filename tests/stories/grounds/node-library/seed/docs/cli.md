# mdtoc CLI reference

> The documented surface of `mdtoc`. The release contract (C10) keeps this in
> sync with the merged behaviour — a change to a flag must update this file
> in the same cycle. This is the `docsDir` declared in `.forge/project.json`.

## Synopsis

```
mdtoc <file.md>
mdtoc - < doc.md
mdtoc [--min <n>] [--max <n>] [--indent <n>] [--bullet <c>] <file.md>
```

## Description

`mdtoc` reads a Markdown document, extracts its ATX headings (`#`..`######`),
and prints a nested Markdown list linking to each heading's GitHub-style anchor.
Fenced code blocks are skipped, so a `#`-prefixed line inside ``` is never
treated as a heading. Duplicate headings receive a numeric anchor suffix
(`-1`, `-2`, …).

## Options

- `--min <n>` — shallowest heading level to include (default `1`).
- `--max <n>` — deepest heading level to include (default `6`).
- `--indent <n>` — spaces per nesting level (default `2`).
- `--bullet <c>` — list bullet character (default `-`).
- `-`, when given as the input, reads markdown from stdin.
- `-h`, `--help` — print usage.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success — the TOC was printed (may be empty if no heading matched the filter). |
| 1 | IO / usage error — no input given, or the input file could not be read. |
| 2 | Bad option — an unknown flag, a non-integer level, or an inverted level window. |

## Anchor rules

See the [`toc-anchor-rules` skill](../.forge/skills/toc-anchor-rules/SKILL.md)
for the exact slug algorithm the CLI implements.
