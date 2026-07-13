# `projects/` — Managed Projects

> **Scope 3 — projects forge develops** ([repo map](../docs/repo-map.md)). Gitignored. Each subdirectory is a managed project; forge auto-discovers them
> from disk — any sub-directory carrying a `.forge/project.json` contract file
> is a managed project (no registry file to edit). The projects root is
> configurable via `FORGE_PROJECTS_DIR` or `projectsDir` in `forge.config.json`
> (default: this directory).

## Onboarding a project

See [`docs/getting-started.md`](../docs/getting-started.md) for the full
walkthrough; in short:

1. Clone (or symlink) the project repo here:
   ```bash
   git clone <url> projects/<name>
   # OR
   ln -s ~/path/to/repo projects/<name>
   ```
2. Bring it up to the forge↔project contract (the `forge-onboard-project`
   skill + [`docs/forge-project-contract.md`](../docs/forge-project-contract.md)),
   then run `forge preflight <name>` until every hard clause is green. The UI
   onboarding form (Studio → Projects → New) scaffolds the same contract files.
3. The first cycle on this project will:
   - Create `projects/<name>/brain/profile.md` (initial taste profile, populated by Pass B or by the architect).
   - Open the project's directory tree to the architect during ideation.
3. From then on, the architect, project-manager, developer-loop, reviewer, and reflector all read this directory as the project's working tree.

## Per-project conventions

- `<project>/.forge/` — gitignored at the project level; forge writes work-item specs and per-project scratch here. **Exception:** `.forge/project.json` + `.forge/quality_gate_cmd` are *tracked* config (force-added past the ignore).
- `<project>/.forge/work-items/` — populated by the project-manager skill.
- `<project>/demo/<initiative-id>/` — the structured demo (`demo.json` + derived `DEMO.md`/`DEMO.html`), authored by the developer-unifier via the `demo` skill and committed **tracked** on the branch (ADR 021; there is no `.forge/demos/` shadow).

## Multi-project orchestration

Forge enqueues initiatives across all projects into a single `_queue/`. The scheduler claims them in order; the worktree per initiative keeps projects isolated. Cross-project work isn't directly supported (and shouldn't need to be); a single initiative is scoped to one project.

## Why gitignored

Forge's repo holds the *system*. The projects forge manages are independent repos with their own histories. Symlinking or cloning them into `projects/` makes them visible to forge without committing them into forge's git history.
