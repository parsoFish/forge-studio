---
title: Projects
description: Register a git repository so forge can build it, check it against the project contract, and rebuild the contract when it drifts.
type: guide
owner: parsoFish
last_verified: 2026-10-06
covers: [apps/studio/app/projects/**, packages/projects/**]
sidebar:
  order: 4
---

A project is a git repository that forge builds against. In **Projects** you register one, see whether it meets the contract forge needs to run it unattended, and repair it when it does not.

## Before you start

- A git repository, and a quality-gate command (for example `npm test`) that exits non-zero when the project is broken.

## How Studio finds projects

Studio scans one projects directory on disk. A sub-directory with a `.forge/project.json` is a managed project. The directory is `projects/` under your forge checkout by default. Set `FORGE_PROJECTS_DIR`, or `projectsDir` in `forge.config.json`, to move it. The environment variable wins.

## Onboard a project

To bring in an existing repository, press **Onboard a project** on **Projects**. The form asks for a project name, a **Quality-gate command**, and a **North star**: one line, at most 140 characters, saying what the project is for. Under **Advanced** you can point at a repository elsewhere and add instructions for developer agents.

On submit, Studio scaffolds the contract artifacts and runs preflight. If every hard clause passes, you land in the project editor. If not, the form reports that the project is not yet contract-complete and lists the failing clauses.

To start with no repository, press **Start a greenfield project**. Its form takes a name, north star and app type, and Studio scaffolds a new repository from a framework template, filling every contract element the template can.

## Let the agent finish onboarding

To drive a project to a passing contract without hand-fixing each clause, open it and press **Run onboarding agent**. It declares the quality gate, works through the failing preflight clauses and settles the advisory ones. **Brief the agent (optional)** lets you pass it context first.

## Keep a project healthy

The contract is the set of clauses a project must meet for forge to work on it unattended. Hard clauses block work: a trustworthy quality gate, forge's scratch files ignored by git, machine-readable architecture context, and every declared skill resolving. Advisory clauses, such as a demo process or an agent-instruction file, only warn.

The editor's **Contract Readiness** panel shows the preflight result clause by clause. To re-check from a terminal, run:

```bash
forge preflight <project-name | path>
```

It checks the same clauses and prints a pass, fail or warn line for each. It also treats a runnable quality gate as hard, so it fails until the project's dependencies are installed; Studio reports that check separately. It exits non-zero when a hard clause fails.

When a project's generated mechanisms have drifted from the current template, press **Rebuild contract**. Studio shows a drift report first. Read it, then press **Apply rebuild**. The rebuild regenerates the test, demo and release processes and skill wiring. It never touches the north star, instructions or secrets. If the project has no recorded app type, choose one and press **Preview drift**. See [Reset a project contract](/guides/how-to/reset-a-project-contract/).

## Troubleshooting

- **Fill in the required fields first**: the onboarding button stays disabled until name, quality gate and north star are all set.
- *The onboarding button says a run is in progress.* An onboarding run is already in flight for this project. Wait for it or cancel it.
- **choose an app type first**: **Preview drift** needs an app type when the project has none recorded.

## Related

- [project.json](/reference/project-json/)
- [Onboard an existing project](/guides/how-to/onboard-an-existing-project/)
- [Getting started](/guides/getting-started/)
