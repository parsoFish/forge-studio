---
title: How forge works
description: The parts of a forge factory and how a piece of work moves through one.
type: explanation
owner: parsoFish
last_verified: 2026-10-06
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
3. The project-manager agent splits each initiative into work items: small, ordered units, each with at least one acceptance criterion and a command that checks it. A set that fails validation is set aside whole, never run partially.

**Kickoff gate.** The develop flow does not start by itself. A planned initiative's roadmap card reads KICKOFF until you start it.

**Develop flow.**

1. **Build.** The developer agent works through the work items in dependency order, one loop per item, each in its own git worktree. A loop repeats until the checks pass or its iteration budget runs out.
2. **Integrate.** A planner agent picks how to show the change; the factory checks the plan, captures the evidence, and opens the pull request.
3. **Review.** A read-only agent critiques the diff against each acceptance criterion. It cannot change anything but its findings file.
4. **Verdict gate.** You read the findings and approve, which merges, or send back, which re-runs the build.

**Reflection.** Once the merge is confirmed, the reflector agent runs a retrospective: it reviews the run, asks you its questions, and writes what it learned. Reflection never reopens a merged change.

The change class picks the gate profile, such as which checks run and how the demo is captured. It does not change the flow's shape.

## Knowledge compounds

Knowledge is the factory's memory: markdown pages, each citing evidence, kept per project and across runs. Planning agents must read it before they act, so past sizing and known mistakes change the plan. Building and review agents read only the project's own pages: their intent comes from the work items, not from re-deriving it. The reflector writes back what each run taught. `forge brain lint` checks the pages' structure and citations.

## What you can change

Flows, agents, skills and hooks are data: files in the repository that the platform reads. The develop factory is built from them, and you can edit them or assemble your own flow from the same parts. `forge studio lint` validates them.

The platform is what runs them: the daemon (`forge serve`), the flow runner, the work queue, the gates' enforcement, and Studio, the operator surface (`forge studio`).
