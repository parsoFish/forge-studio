# Principles

These are the five user-stated principles that gate every decision in forge. They are reproduced verbatim from the prompt that initiated the forge scaffold, with brief commentary linking each to the ADR that codifies it.

---

## 1. Avoid hand-rolling solutions

> Avoid hand rolling solutions at all cost if there are existing solutions that fill the requirements of a component in the forge architecture, and wherever possible plug into solutions that are already heavily in use such as claude, github copilot, etc. The prime example is the agentic loop, solutions like hermes or ralph loops must be utilised over a hand rolled solution that tries to implement the same function. These solutions are at this stage battle tested and likely more powerful than any solution I could come up with on my own given the community support and attention and this sort of ideal holds true for any componentry. I think my idea is powerful in hanging other powerful ideas together, not in building the entire thing from scratch.

**Codified by:**
- [D-01](./DECISIONS.md)
- [SPEC §1](./SPEC.md)
- [D-02](./DECISIONS.md)

---

## 2. Simplicity is key

> Simplicity is key and is powerful, I have seen some incredible solutions built entirely out of only a handful of skills, agent personas, and some scripts or tools that those agents know how to utilise well.

**Codified by:**
- [SPEC §1](./SPEC.md)
- [SPEC §3](./SPEC.md)

The rejected-alternatives rows (R-xx) in [`DECISIONS.md`](./DECISIONS.md) are also load-bearing here: every "no" defends this principle.

---

## 3. Phase isolation with fast feedback

> Isolation of forge phases to enable focused work on any individual phase. Each phase should have clear success signals that allow agents to work on a phase and prove their changes are making a meaningful impact. The brain for example should be able to be asked questions before and after updates and noticeable increase in quality, accuracy, or speed of response are observed. The architect similarly should be able to be given sample ideas that will result in a roadmap that can be judged on core metrics for improvement after changes. The feedback loop for agents must be present throughout each component of forge and must enable the fastest feedback possible to allow rapid iteration with benchmarked results to allow an agent to know if its making meaningful and productive change.

**Codified by:**
- [D-08](./DECISIONS.md) (the phase-isolation decision stands; the earlier per-phase `benchmarks/` realization was retired 2026-05-25 in favour of real-cycle outcomes)
- The phase-isolation decision stands; the synthetic per-phase benchmark suites were removed 2026-05-25. Phase quality is now judged on real merged cycles (brain themes accumulate the evidence).
- Each station's success signals are recorded in [`apps/docs/src/content/docs/how-forge-works.md`](apps/docs/src/content/docs/how-forge-works.md).

---

## 4. Brain-first research

> All components must use the brain as a first source of knowledge but must also be able to research further as required when the brain is unable to provide necessary details or information.

**Codified by:**
- [SPEC §4](./SPEC.md)
- The principle holds where it earns its keep: the **planner**
  (architect / project-manager) and the **reflector** read the brain.
  The **dev-loop and reviewer do not** — their intent is wholly in the
  work items the planner authored, so "research further" for them means
  reading the WI, not the brain. Rationale:
  [`brain/forge-dev/themes/brain-read-policy.md`](./brain/forge-dev/themes/brain-read-policy.md).
- The `brain-query` skill logs gaps so the next ingest pass can fill them — a self-improving loop.

---

## 5. Logging, metrics, and visualisation

> All components must clearly log actions, inputs, and outputs in order to allow for reflection at the end of a cycle. Iterations of agentic loops must be tracked, and basically any valuable metric you can think of should be tracked. This should also be utilised to enable monitoring of the forge cycles as they are running with some form of visualisation of the agents at work.

**Codified by:**
- [SPEC §3](./SPEC.md)
- [`packages/kernel/logging.ts`](./packages/kernel/logging.ts) — central event-log writer with documented schema
- [`packages/flows/metrics.ts`](./packages/flows/metrics.ts) — aggregations (cost, iterations, duration)
- Forge Studio's **Monitor** pillar ([`apps/studio/app/monitor/`](./apps/studio/app/monitor/)) — the live view of flow runs, agent runs, sessions and the scheduler, derived from the same event log
