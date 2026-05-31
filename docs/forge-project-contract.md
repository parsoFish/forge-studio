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

## The contract families (the interaction seams)

The contract is not a flat checklist — it is the set of guarantees forge needs at
each **seam where it touches the project**. Naming the seams makes onboarding a
guided walk (one family at a time) rather than a clause hunt, and shows where the
contract is still being deepened. There are three seams plus one cross-cutting
conditional:

| Family | The seam | Forge needs the project to guarantee… | Carried by |
|--------|----------|----------------------------------------|------------|
| **Planning** *(architecting)* | The architect + PM read the project to decompose an initiative into features → work items. | **Faithful, machine-readable, fresh planning inputs** — an accurate roadmap + a brain that cites live source, so the planner decomposes the *real* project instead of hallucinating. | **C4**, **BRAIN** |
| **Development** | The unattended loop changes the project and judges + packages each change with no human in the inner loop. | **A truthful done-signal, a hermetic commit, decomposable source, a respected locked core, and a mergeable result.** | **C1**, **C2**, **C3**, **C5**, **C6** |
| **Demo** | The review phase presents the change to the operator for the merge decision. | **The change is *demonstrable*** — the project exposes how it is tested, how a change is captured before→after, and how brand-new behaviour is shown. | *being deepened — see below* |
| **External resources** *(conditional)* | Behaviour can only be verified against a live external system (cloud / DB / 3rd-party API). | **A two-layer verification model** (creds-free in-loop gate + operator-gated live confirmation). | **C7** |

**Demo is the family deepened in the 2026-05-31 round.** It now has its own
invariant (**Demo**, below), a canonical capability skill
([`skills/demo/SKILL.md`](../skills/demo/SKILL.md)) that owns *how* forge runs a
demo / what it must contain / how it maps to the review UI, and a structural
project-side check (the advisory **DEMO** preflight clause). The deeper "does the
before/after actually capture the delta" facet stays hand-verified during
onboarding. The per-project gotchas still live in the project's brain (e.g.
trafficGame's `demo-server-reuse-captures-stale-build`, betterado's
`go-test-harness-demos`).

The planning and development families are the mature ones (every C-clause below
maps to a seam in the table); they are kept as the per-clause invariants because
that is the granularity `forge preflight` checks. The family layer is the *map*;
the C-clauses are the *territory*.

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

### Demo — the project can show its change (the demo family)
*(landed 2026-05-31)* The review phase must be able to show the operator the one
behavioural delta the initiative produced, so the project must expose **how a
change is demonstrated**. This is the project half of the demo contract; the forge
half (what a demo must contain, effort tiers, the UI mapping) is owned by
[`skills/demo/SKILL.md`](../skills/demo/SKILL.md). A project satisfies it by
declaring, in `.forge/project.json`:

- **`demo.shape`** — one of `browser | harness | cli-diff | artifact | none`. This
  is the form-mapping for "demonstrable": a rendered UI a preview server can drive
  (`browser`); a measurement command with scrapable output (`harness`); a CLI
  whose stdout differs (`cli-diff`); a generated file (`artifact`); or an
  infra-only change with no observable surface (`none`, a rationale-only demo).
- **`demo.command`** — required for any shape ≠ `none`: how forge produces the
  before/after.
- **`demo.preview_command`** — required for `browser`: the dev/preview server forge
  serves the built worktree on (never a reused stray dev server — see the
  trafficGame stale-capture lesson).
- A **valid prior state**: running the baseline must not error; the demo frames it
  as *prior behaviour*, never *broken*.

The point: the same gate that *proves* a change (C1) and the demo that *shows* it
are two faces of the same guarantee. A project that can be gated but not
demonstrated leaves the operator approving blind. `forge preflight` checks the
structural part (the `demo` block) as the advisory **DEMO** clause.

## How forge enforces it

`forge preflight <project>` checks C1–C6 + the advisory **DEMO** clause (the
`.forge/project.json` demo block) structurally and **declines** on a hard
failure (C1/C2/C4 hard; C3/C5/C6/DEMO advisory). The deepened facets of C1 (gate
discrimination) and C2 (build-artifact hermeticity), the deeper demo facet (does
the before/after actually capture the delta), and C7 entirely, are **not
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
