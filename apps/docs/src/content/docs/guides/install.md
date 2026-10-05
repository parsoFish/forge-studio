---
title: Install
description: Install forge from a source checkout on Linux or WSL2 and open Studio, its browser UI.
type: guide
owner: parsoFish
last_verified: 2026-10-06
covers: [package.json, bin/forge.mjs, apps/forge/cli.ts, packages/kernel/init.ts, packages/kernel/config.ts, .env.example]
sidebar:
  order: 1
---

forge installs as a Node source checkout: you clone the repository, build it, and link the `forge` command. After that you work in Studio, forge's browser UI.

## Before you start

- Linux or WSL2. macOS and native Windows are not supported.
- Node 22.12 or later, git, and the GitHub CLI logged in (`gh auth status`).
- Claude Code installed and logged in. forge's agents run through it.

## Set up

Clone, build and link:

```bash
git clone https://github.com/parsoFish/forge-studio.git
cd forge-studio
npm install
npm run build
npm link        # puts `forge` on your PATH
```

Create the working layout and check your environment:

```bash
forge init
```

`forge init` writes a default `forge.config.json` and the directories forge uses, including `projects/`, where your projects live. It warns when `ANTHROPIC_API_KEY` is unset (Claude Code's own credentials work instead) and when `gh` is not logged in.

Tell forge which Claude Code binary to run agents through:

```bash
export FORGE_CLAUDE_CLI="$(readlink -f "$(command -v claude)")"
```

Put that line in your shell profile. `.env.example` lists the other environment variables, all optional.

## Open Studio

```bash
forge studio
```

Studio serves on two fixed ports: the bridge on 4123 and the UI on `http://localhost:4124`. On WSL2, open that address in your Windows browser. The command stays in the foreground; Ctrl-C stops it. It also runs `forge serve`, the background scheduler that picks up approved work.

To open a second window onto a running Studio, run `forge studio --attach`. It joins the running bridge read-only and never replaces it.

## Troubleshooting

- **A run refuses with `FORGE_CLAUDE_CLI is not set`.** Export the variable as above, then restart `forge studio`.
- **forge cannot open or merge pull requests.** Run `gh auth login`.

## Related

- [Getting started](/guides/getting-started/)
- [How forge works](/how-forge-works/)
