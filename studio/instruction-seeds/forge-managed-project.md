---
id: forge-managed-project
title: Forge-managed project contract
kind: project-shape
appliesTo: [forge-managed]
scope: project
provenance: "docs/forge-project-contract.md (ADR-034 — the forge↔project contract, two faces one verdict)"
---

## Forge-managed project contract

The shape any project must take to be driven autonomously by forge. Mirrors the
contract clauses in `docs/forge-project-contract.md` (ADR-034) — reference these
clauses in AGENTS.md rather than restating them.

### Face A — Studio object fields (what the project declares)
- **northStar** (≤140 chars) — the one-line purpose.
- **instructions** — a human-owned AGENTS.md at the repo root (clause C8), the
  single source of agent instructions; forge never auto-writes it without an
  explicit operator confirm.
- **demoProcess** — ≥1 capture step + ≥1 verify step (the cycle produces visual
  evidence, not just a passing test-name list).
- **skills** — ≥1 bound skill slug.
- **kb** — a bound knowledge-base id.

### Face B — Operational clauses (checked by `forge preflight`)
- **C1 (HARD) — a truthful, discriminating done-signal:** one quality-gate
  command that fails before the work and passes only when it's correct.
- **C2 (HARD) — hermetic commit capture:** build artifacts are gitignored; each
  iteration's diff is clean.
- **C4 (HARD) — machine-readable planning inputs:** a `roadmap.md` / structured
  initiative the plan agent can decompose.
- **C5 (advisory) — locked core / untouchables:** the constraints agents must
  never violate (e.g. "never edit a test to pass", "the human owns git history").

A project that satisfies the hard clauses runs unattended; the advisory clauses
surface as warnings the operator resolves.
