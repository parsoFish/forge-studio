# Forge — known gaps & hardening backlog

> **Status: operator-driven backlog, NOT forge initiatives.** Forge is not
> self-hosted (we don't run forge cycles against forge itself right now), so
> these are notes for a human (or a future Claude session) to pick up directly
> — not manifests for the queue.
>
> This is a **living doc**: append findings here so they survive across fresh
> sessions instead of being deferred and forgotten. Date each entry; strike or
> move items when resolved.

## Why this doc exists (2026-05-29)

Most gaps trace to the same root cause: **forge has been built across many fresh
Claude sessions**, each with no memory of the last. The pattern that produces
drift is "fix the code, defer the cleanup, lose the context at session end" —
which accumulates into half-removed features, contradictory brain themes, and
stale metadata. A living gaps doc + a session-boundary reconcile habit is the
cheapest counter.

> **History:** this doc once carried ~80% of forge's hardening backlog. The vast
> majority of those items are now **resolved** (the gate-≠-CI cluster, the
> demo/live-evidence gaps, the resume/merge-boundary items superseded by
> [ADR 026](./decisions/026-review-unifier-wi-list.md), the Studio pipeline
> observability pass, the betterado onboarding findings, and more). The resolved
> history lives in **git** and in **[`brain/forge-dev/themes/`](../brain/forge-dev/themes/)**;
> only the genuinely-open items are kept below.

---

## Open items

### 1. M4 flow edit-lock false-negative (latent)

The M4 flow edit-lock produces false-negatives for **non-forge-cycle** flows
until the run-model stamps the real `flowId` (`orchestrator/run-model.ts`
`FLOW_ID`). **Latent** — no non-forge-cycle runs exist today, and the lock is
fully effective for the forge-cycle flow. Surfaces only when a second
operator-authored flow is actually run.

### 2. Architect hex shows `$0.00` cost in `ui:journey` (architect cost-observability gap)

The architect phase hex renders `$0.00` in the `ui:journey` walkthrough because
the seeded architect events carry no cost rollup to the hex. Pre-existing (fails
on the pre-observability baseline too) and the **only remaining `ui:journey`
DOM-as-metrics failure**. It is a real architect cost-observability gap — the
architect's live cost/output tracking is thinner than the other phases' (see the
architect-observability operator notes). Independent of any single branch's
roadmap.

### 3. brain-ingest haiku R1 A/B follow-up

`brain-ingest` was flipped sonnet→haiku (model-tier economy). The flip is
shipped but its **theme-quality regression check (R1) is unrun**. Validate via a
**standalone** brain-ingest A/B — sonnet vs haiku on one archived cycle under
`brain/_raw/cycles/`, theme diff + Opus/operator sign-off — the next time
brain-ingest is invoked manually. This is **not** a `verify:cycle`.

---

## Strengths worth preserving (don't regress these)

- The **dual-boundary gate works as designed** — the unifier catches a red
  full-suite baseline the scoped per-WI gates can't see. Nothing ships red.
- **Brain-path SSOT** holds up end-to-end through real reflections; `forge brain
  lint` stays at 0 errors.
- **Worktree-preservation → salvage works** — the premise resume depends on.
- **The reflector is genuinely sharp** — it independently identifies real gaps
  during reflection (only as good as its inputs, but consistently surfacing the
  right ones).
- **Dogfooding catches real integration bugs** that green unit tests miss.
