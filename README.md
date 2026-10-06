# forge-studio

forge-studio is a kit for building software factories run by AI agents:
pipelines that take work on a codebase from an idea to a merged pull request,
stopping only at the gates you declare. Studio is the browser UI you build, run
and watch them from. It ships one example factory, the develop flow.

## Prerequisites

- Linux or WSL2 (macOS and native Windows are not supported)
- Node 22.12 or later, git, and the GitHub CLI logged in (`gh auth status`)
- Claude Code, installed and logged in
- To run the test suite: `npx playwright-core install chromium`

## Quickstart

```bash
git clone https://github.com/parsoFish/forge-studio.git && cd forge-studio
npm install && npm run build && npm link
forge init && forge studio
```

Then open `http://localhost:4124`. Set `FORGE_CLAUDE_CLI` before your first
run; [Install](./apps/docs/src/content/docs/guides/install.md) explains it, and
[Getting started](./apps/docs/src/content/docs/guides/getting-started.md) takes
you from there to a merged pull request.

## More

- [Documentation](./apps/docs/src/content/docs/) · [Roadmap](./ROADMAP.md) ·
  [Contributing](./CONTRIBUTING.md)

## License

[AGPL-3.0-or-later](./LICENSE). Anyone who runs a modified forge as a service
must offer its source to that service's users.
