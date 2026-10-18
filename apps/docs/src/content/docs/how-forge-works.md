---
title: How forge works
description: The parts of a forge factory and how a piece of work moves through one.
type: explanation
owner: parsoFish
last_verified: 2026-10-18
covers: [packages/flows/**, packages/stations/**, packages/factory/**, packages/knowledge/**, studio/flows/**, skills/**]
---

forge builds software factories: pipelines that take an idea for a codebase and carry it to a merged pull request, mostly without you.

## The parts

A **factory** is one assembled, running pipeline. It runs **flows**. A flow is an ordered path of **stations**, and each station is one of two things:

- an **agent** that does work, using **skills** (reusable instructions and tools), or
- a **gate**, where a human or an automated check approves the work before it moves on.

Between its gates a factory runs unattended. The gates are the places the factory stops and asks.

## The example: the develop factory

forge ships one working factory. It is two flows plus one agent that fires after merge.

**Plan flow.** You give it an idea.

1. The architect agent interviews you, one bounded question round at a time, then drafts a plan. Each initiative in it carries a change class (code, docs, config or infra) and acceptance criteria written as given/when/then.
2. **Plan gate.** You review the plan and approve it, or send it back with feedback. Nothing is queued until you approve.
3. The project-manager agent splits each initiative into work items: small, ordered units, each with at least one acceptance criterion and a command that checks it. An initiative criterion that names a test command must be run whole by some work item's command. A set that fails validation goes back to the project manager with every error named, at most twice within the initiative's budget; if it still fails, it is set aside whole, never run partially, and the errors are kept so **Requeue** repairs the set instead of starting over.

**Kickoff gate.** The develop flow does not start by itself. A planned initiative's roadmap card reads KICKOFF until you start it. Starting it first rebases the initiative's branch onto the project's main, so the build includes anything merged while it waited, such as an initiative it depends on. The run page shows the commit it started from. If the rebase conflicts, the run stops before building and names the commit it could not rebase onto and the file git stopped on. A work item you add at this gate names its scope as paths in the initiative's worktree: an existing file, or an existing directory written with a trailing `/`. A file that does not exist yet must also be listed under the files the work item creates. Anything else is refused, naming the entry and the corrected form.

**Develop flow.**

1. **Build.** The developer agent works through the work items in dependency order, one loop per item, each in its own git worktree. A loop repeats until the checks pass or its iteration budget runs out. The checks also require the branch to change at least one path in the item's scope; a scope entry ending in `/` is met by any file under that directory. A work item with a check per criterion runs every check on each pass, and the next attempt is told every check that still fails, with its output. An item that runs out of iterations, or that you stop mid-loop, keeps its branch and every committed iteration; its next run resumes from them.
2. **Integrate.** A planner agent picks how to show the change; the factory checks the plan, captures the evidence, and opens the pull request. For a project that configures a third-party site (`demoMeans.portal`), the evidence is frames of the site itself: each tree runs the project's apply, then each declared page is recorded. A plan that names anything the project did not declare goes back to the planner once, with the error; refused again, the run stops naming both errors, and Resume re-runs the planner. First the full test suite runs on the branch. If it fails, no pull request opens: the factory adds a fix work item that must pass that same suite, and the build step re-runs at once. The roadmap card reads FIX ROUND while the fix is owed, and FIX ROUND · running while it builds.
3. **Review.** forge runs each acceptance criterion that names a test command at the branch head. A read-only agent critiques the diff against the rest and cannot change anything but its findings file. A finding that shows a work item's own criterion unmet is a blocker. Binary files and the demo bundle are listed as not reviewed.
4. **Verdict gate.** You read the findings and approve, which merges, or send back, which re-runs the build. A send-back's scope follows the Kickoff rule, except that a file that does not exist yet is accepted when its directory does. If a send-back round fails without building anything, for example because the kept worktree has uncommitted changes, it halts instead of retrying: the run fails with the reason, the verdict card reads *Round N halted*, and **Requeue** on the run page runs it once you have fixed the worktree. A round whose fix work item fails halts the same way before any demo or review, naming the checks it reached; **Requeue** resumes that item from its kept branch. A later send-back replaces a failed fix work item instead: the new round runs without it. Any other reason a round cannot start, such as a failed fix work item with nothing sent back behind it, reads on the verdict card as *Round N parked*, with the reason.

**Reflection.** Once the merge is confirmed, the reflector agent runs a retrospective: it reviews the run, asks you its questions, and writes what it learned. Reflection never reopens a merged change.

The change class picks the gate profile, such as which checks run and how the demo is captured. It does not change the flow's shape.

## Knowledge compounds

Knowledge is the factory's memory: markdown pages, each citing evidence, kept per project and across runs. Planning agents must read it before they act, so past sizing and known mistakes change the plan. Building and review agents read only the project's own pages: their intent comes from the work items, not from re-deriving it. The reflector writes back what each run taught. `forge brain lint` checks the pages' structure and citations.

## What you can change

Flows, agents, skills and hooks are data: files in the repository that the platform reads. The develop factory is built from them, and you can edit them or assemble your own flow from the same parts. `forge studio lint` validates them.

The platform is what runs them: the daemon (`forge serve`), the flow runner, the work queue, the gates' enforcement, and Studio, the operator surface (`forge studio`).
