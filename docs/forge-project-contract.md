# The forge↔project contract (architecture & design)

> **What this is.** The set of properties **any** project must expose for forge
> to develop it unattended — independent of its form (UI app, HTTP API, library,
> CLI, monorepo, infra provider). This is the conceptual design; the *decision*
> is [ADR-017](./decisions/017-forge-project-contract.md), the *enforcement* is
> [`cli/preflight.ts`](../cli/preflight.ts) (`forge preflight <project>`), and the
> *origin* is the brain theme `forge-project-onboarding-contract` (trafficGame
> arc). This doc generalises those into form-agnostic invariants and records the
> two clauses the 2026-05-31 betterado run deepened plus the one it added.

## Why a contract exists

Forge runs a project as an **unattended loop**: plan → change → verify → package →
review → merge, fanning work out across parallel work items between human
interaction points. There is no human in the inner loop. Every guarantee a human
would normally provide — "this change is done," "this PR contains only what I
meant," "these two tasks won't collide" — must instead be **structurally true of
the project**. The contract is exactly that set of guarantees. A project that
doesn't provide them doesn't fail loudly; it fails *subtly* (false "done," PRs
full of junk, colliding WIs, hallucinated plans), which is worse. So forge
**declines** a project that doesn't meet the hard clauses rather than limp.

The contract is **about invariants, not recipes.** "A truthful done-signal" is the
invariant; a Playwright component test, an HTTP contract test, a `go test`, and a
pytest unit are all just *how* different project forms satisfy it. Onboarding =
mapping each invariant onto the project's form.

## The invariants

### C1 — A truthful done-signal (the quality gate)
Forge has no human judging each iteration, so **the gate is the judgment.** It
must therefore be a *faithful oracle*, which is more than "a test command":

- **Fast, deterministic, green at HEAD** — it runs every iteration (≈≤10s; a
  bloated end-to-end suite breaks the per-iteration loop — the original C1).
- **Discriminating** *(deepened 2026-05-31)* — it must **fail before the work
  exists and pass only when the acceptance criteria are met.** Three ways a gate
  silently stops discriminating, all observed:
  - *Hollow*: already green before the agent does anything (forge flags
    `gate-too-loose` at iter-0). Happens when the gate isn't scoped to the unit of
    change (e.g. a whole-package gate where the package already has tests).
  - *False-pass*: exits 0 without running the new work (a filter that matches
    nothing; a runner that reports success on an empty selection).
  - *Poisoned*: the runner's output mixes a "nothing to run" signal from an
    unrelated sibling into a multi-target run, so forge reads no-work even though
    the real target passed.
  - **Design rule:** scope the gate to the *unit of change* so empty ⇒ fail and
    real-work ⇒ pass. Any-form mapping: UI → a render/interaction test for the new
    component; API → a request/response (contract) test for the new endpoint;
    library/CLI → a unit test for the new function; monorepo → a gate scoped to
    the touched package, never a repo-wide wildcard.

### C2 — Hermetic change capture (clean PRs)
*(broadened 2026-05-31: "scratch hygiene" → "PR hermeticity")* Forge commits with
`git add -A` and assembles a PR with **no human curating the file list.** So the
repo must be configured so the only things that *can* enter a commit are
intentional source edits. Everything else must be excluded, and required config
tracked:

- **Forge scratch** ignored: `.forge/` runtime, `AGENT.md`, `PROMPT.md`,
  `fix_plan.md` (the original C2).
- **Build artifacts & generated outputs** ignored *(added 2026-05-31)*: compiled
  binaries, bundler/`dist` output, coverage, knowledge-graph caches. A renamed,
  un-ignored provider binary committed a 35 MB blob into a betterado PR via
  `git add -A`. This is the general failure: *anything a build/tool writes into
  the tree will be committed unless ignored.*
- **Tracked config inside ignored dirs** must be force-added and protected: e.g.
  `.forge/project.json` lives under the ignored `.forge/` and must survive both
  the ignore and forge's own `.forge/`-scratch stripping.
- Invariant: `git status` after a clean build shows **nothing but intended
  source.** If a tool can dirty the tree, ignore its output during onboarding.

### C3 — Conflict-free decomposability
Forge fans work out across parallel WIs; god-files and tangled boundaries make
those WIs collide at merge. The source must sit under the project's own size norm
with clear module seams. Any-form mapping: a 1,700-LOC component, a fat
controller, or a monolithic resource file each force serialization; extract before
fanning out.

### C4 — Faithful planning inputs (machine-readable intent)
Forge's planners read the project's **roadmap + brain** to decompose. These must
be present, accurate, and queryable, or the planner hallucinates (or, worse,
invents an unrelated plan). The brain is the project's *encoded conventions and
history*; a stale brain (citing renamed files, a superseded workflow) actively
misleads. Onboarding includes **priming and correcting** the brain, not just
checking it exists.

### C5 — Declared untouchables (locked core)
The project must declare what forge may **not** change — git ownership, "never
edit tests to pass," calibrated thresholds, generated files — and forge must
honour them (forge moved to commit-not-reset to honour git ownership). Any-form
mapping: list the load-bearing invariants and the files/dirs forge must treat as
read-only.

### C6 — A satisfiable merge model
Forge must be able to produce a PR the operator can merge without stacking /
auto-merge hazards. Post-Phase-6 forge satisfies this by not auto-merging (the
operator merges); the project supplies a remote.

### C7 — An external-resource model *(new dimension, 2026-05-31)*
*Conditional — applies only to projects whose behaviour can only be verified
against a live external system* (cloud, database, third-party API; e.g. an infra
provider). For these, C1's "truthful done-signal" splits into two layers, and the
project must define both:

- **In-loop layer**: a fast, creds-free gate (mocks / fakes / in-process harness)
  that the unattended loop runs every iteration. This is the C1 gate.
- **Confirmation layer**: a live gate or operator-run harness that exercises real
  resources, with a strict discipline — **creds supplied out-of-band** (gitignored
  file → env vars; never committed), **isolation + self-cleanup** (create →
  confirm via the real API → destroy; prefixed/randomized names; sweep for
  orphans), and a clear statement of which runs in-loop vs operator-gated.
- Note: API/PAT-style creds typically authenticate the *API* but not an
  interactive web console, so machine evidence is API responses; screenshots of
  authenticated UIs are best-effort.

## How forge enforces it

`forge preflight <project>` checks C1–C6 structurally and **declines** on a hard
failure (C1/C2/C4 hard; C3/C5/C6 advisory). The deepened facets of C1 (gate
discrimination) and C2 (build-artifact hermeticity), and C7 entirely, are **not
yet machine-checked** — they're in the hardening backlog
([docs/known-gaps.md](./known-gaps.md), 2026-05-31). Until then, onboarding must
verify them by hand (run the gate on a clean tree and confirm it *fails*; build
and confirm `git status` is clean).

## The point: roadmap-scale, not single-WI

Meeting the contract is what makes the *intended* operating mode work: the operator
hands forge a **roadmap-scale, multi-feature** initiative and forge decomposes it.
A project that doesn't meet the contract tempts the operator to shrink scope to
compensate (single-WI initiatives) — that's a smell, not the target. Fix the
contract gap instead.

## See also
- [ADR-017](./decisions/017-forge-project-contract.md) — the decision.
- [`cli/preflight.ts`](../cli/preflight.ts) — the enforcement (C1–C6).
- brain `forge-dev/themes/forge-project-onboarding-contract.md` — origin (trafficGame).
- [docs/known-gaps.md](./known-gaps.md) §2026-05-31 — the not-yet-enforced facets.
