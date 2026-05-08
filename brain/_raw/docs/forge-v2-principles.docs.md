---
source_type: docs
source_url: PRINCIPLES.md
source_title: Forge v2 — Principles (5 user-stated principles)
ingested_at: 2026-05-04T17:55:00Z
ingested_by: brain-ingest (Pass A, batch 3)
cycle_id: pass-a-bootstrap
---

# Forge v2 — Five Principles

These are the five user-stated principles that gate every decision in forge v2.

## 1. Avoid hand-rolling solutions

> Avoid hand rolling solutions at all cost if there are existing solutions that fill the requirements of a component in the forge architecture, and wherever possible plug into solutions that are already heavily in use such as claude, github copilot, etc. The prime example is the agentic loop, solutions like hermes or ralph loops must be utilised over a hand rolled solution that tries to implement the same function. These solutions are at this stage battle tested and likely more powerful than any solution I could come up with on my own given the community support and attention and this sort of ideal holds true for any componentry. I think my idea is powerful in hanging other powerful ideas together, not in building the entire thing from scratch.

Codified by ADRs 001 (Claude Agent SDK), 002 (Ralph loop pattern), 003 (skills as agents), 006 (gh CLI + worktrees).

## 2. Simplicity is key

> Simplicity is key and is powerful, I have seen some incredible solutions built entirely out of only a handful of skills, agent personas, and some scripts or tools that those agents know how to utilise well.

Codified by ADRs 003 (skills), 007 (markdown artifacts), 009 (minimal config). The non-goals section of every ADR is also load-bearing here: every "no" defends this principle.

## 3. Phase isolation with fast feedback

> Isolation of forge phases to enable focused work on any individual phase. Each phase should have clear success signals that allow agents to work on a phase and prove their changes are making a meaningful impact. The brain for example should be able to be asked questions before and after updates and noticeable increase in quality, accuracy, or speed of response are observed. The architect similarly should be able to be given sample ideas that will result in a roadmap that can be judged on core metrics for improvement after changes. The feedback loop for agents must be present throughout each component of forge and must enable the fastest feedback possible to allow rapid iteration with benchmarked results to allow an agent to know if its making meaningful and productive change.

Codified by ADR 005 (phase isolation with per-phase benchmarks). Every phase doc names its benchmark suite.

## 4. Brain-first research

> All components must use the brain as a first source of knowledge but must also be able to research further as required when the brain is unable to provide necessary details or information.

Codified by ADR 010 (brain-first). Every `SKILL.md` mandates `brain-query` as first action. `brain-query` logs gaps for the next ingest pass — a self-improving loop.

## 5. Logging, metrics, and visualisation

> All components must clearly log actions, inputs, and outputs in order to allow for reflection at the end of a cycle. Iterations of agentic loops must be tracked, and basically any valuable metric you can think of should be tracked. This should also be utilised to enable monitoring of the forge cycles as they are running with some form of visualisation of the agents at work.

Codified by ADR 008 (JSONL event log). `orchestrator/logging.ts`, `metrics.ts`, `visualise.ts`, `monitor/`.
