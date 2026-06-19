# mdtoc

A tiny, dependency-free CLI that turns a Markdown document's headings into a
correct, GitHub-compatible table of contents.

This is **forge's out-of-the-box reference project** — a small, novel,
creds-free, self-contained TypeScript project that exercises every part of the
[forge↔project contract](../../docs/forge-project-contract.md) and is the
contract's worked example.

## Install

```bash
npm install      # tsx + typescript (dev-only; zero runtime deps)
npm run build    # tsc → dist/
```

## Usage

```bash
mdtoc README.md                    # print the TOC for a file
mdtoc --min 2 --max 3 README.md    # only include H2..H3
cat doc.md | mdtoc -               # read markdown from stdin
```

Options:

| Flag | Meaning | Default |
|------|---------|---------|
| `--min <n>` | shallowest heading level to include | 1 |
| `--max <n>` | deepest heading level to include | 6 |
| `--indent <n>` | spaces per nesting level | 2 |
| `--bullet <c>` | list bullet character | `-` |
| `-h`, `--help` | show help | — |

### Example

For a doc with `# Title`, `## Section`, `## Section` (duplicated), the CLI emits:

```markdown
- [Title](#title)
  - [Section](#section)
  - [Section](#section-1)
```

Duplicate headings get a numeric anchor suffix (`-1`, `-2`, …) so every link
resolves, matching GitHub's algorithm.

## Develop

```bash
npm test            # quality gate — fast unit suite (node:test), < 1s
npm run acceptance  # runs the BUILT CLI against a fixture and asserts the TOC
npm run demo        # acceptance + writes captured evidence into forge/history/
```

See [`CLAUDE.md`](./CLAUDE.md) for the agent-facing build/test/lint invocations
and locked-core constraints, and [`roadmap.md`](./roadmap.md) for the planned
milestones.

## License

AGPL-3.0.
