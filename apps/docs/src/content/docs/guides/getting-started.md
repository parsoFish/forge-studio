---
title: Getting started
description: Take one project from onboarding to a merged pull request with the example develop factory.
type: guide
owner: parsoFish
last_verified: 2026-10-06
covers: [apps/studio/app/projects/**, apps/studio/app/architect/**, apps/studio/app/artifact/**, apps/studio/components/PlanGate.tsx, apps/studio/components/ReviewVerdictForm.tsx, packages/projects/**]
sidebar:
  order: 2
---

This guide takes one of your repositories from onboarding to a merged pull request, using the example develop factory that ships with forge. It stops for you at four points: the plan, the kickoff, the verdict and the reflection.

## Before you start

- forge is installed and `forge studio` is running ([Install](/guides/install/)).
- Your project is a git repository with a test command that passes.

## Bring a project under forge

forge treats a directory under `projects/` as a project once it carries a `.forge/project.json` contract. Clone the repository there, or symlink it in:

```bash
git clone <url> projects/<id>
```

In **Projects**, choose **Onboard a project**. Give it a name, the command that runs its tests, and a one-line north star, then press **Onboard project →**. Studio writes the contract. To have an agent fill in the parts a form cannot, press **Run onboarding agent**.

## Get preflight green

Preflight checks the project against the contract and names each clause that fails. The project page shows the same verdict as the command line:

```bash
forge preflight <id>
```

Fix every hard clause before you plan work. Install the project's own dependencies (for a Node project, `npm ci` inside `projects/<id>`), or the scheduler refuses to claim work for it.

## Plan the work

On the project, press **Plan with Architect**, describe what you want built, and press **Start architect**. **Cost ceiling (USD, optional)** caps what the planning session may spend. The architect may ask questions before it drafts a plan.

The plan stops at the plan gate. **Approve** queues it as an initiative, **Send back** returns it to the architect with your note, and **Reject** ends it.

## Kick off and review

On the project's roadmap, press **Start development →** on the initiative's card. The ceiling field beside it caps the run's spend. The factory then builds, integrates and reviews the work without you, and opens a pull request with a demo of the change.

It stops again at the verdict gate. Write a rationale, then press **approve and merge**, or **add work items** to send it back with more to do. forge merges the pull request itself. After the merge, the reflection gate asks what the run taught, and the answers go into the project's Knowledge for later runs.

## Related

- [Onboard an existing project](/guides/how-to/onboard-an-existing-project/)
- [How forge works](/how-forge-works/)
