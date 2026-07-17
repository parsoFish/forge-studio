# R8 — Distribution & release

> Mission: forge studio as a shippable product — packaging and install,
> versioning and release cadence for forge itself, OSS/community posture, and
> the upkeep of public-facing docs and positioning. Scope: the repo's
> product-shell surfaces (`bin/`, packaging config, `docs/getting-started.md`,
> community-health files, the perishable strategy docs). Minted 2026-07-17 by
> the coverage review: the operator-deferred S10 packaging item and the
> version-policy/positioning threads had no roadmap home. **This roadmap is
> deliberately thin and operator-paced** — most of it is gated on
> distribution ambition decisions only the operator can make.

**Status vocabulary:** implemented | in-progress | planned | deferred. All
initiatives in this file are planned/deferred as of 2026-07-17. **Unwaved.**

## As-built baseline (implemented)

### R8-B1 Install & operator entry

Five-step install→first-merge path (`docs/getting-started.md`); operator CLI
surface deliberately collapsed to `forge init | forge studio | forge studio
lint` (ADR-031); projects auto-discovered from disk (no registry file);
Node-source checkout is the only install form — **no packaged artifact
exists** (the refinement-roadmap S10 item, operator-deferred, is R8-01).

### R8-B2 Versioning & release discipline

`CHANGELOG.md` keep-a-changelog discipline; standing policy (memory,
operator): **forge-studio stays 0.x.y** — bump minor/patch as work ships —
until the operator explicitly cuts v1.0.0 (baseline 0.1.0; currently 0.6.0).
Managed-project releases are a different thing entirely (C10/release-finalizer,
R1-04-F2 — not this roadmap).

### R8-B3 OSS posture

AGPL-3.0 (relicensed during the Studio M-arc); community-health files + CI
(S6, PRs #19–#26 campaign); `CONTRIBUTING.md`, `SECURITY.md`,
`CODE_OF_CONDUCT.md`; `docs/licensing-and-dependencies.md`.

### R8-B4 Positioning corpus

`docs/forge-studio-market-and-differentiation.md` — self-flagged perishable
(dated 2026-06-14; §10: re-check figures before external publication);
differentiation thesis = intersection moat + modularity-as-subsumption
flywheel, with the shipped-second-adapter proof outstanding (R2-06-F4) and
the north-star reframe annotation landing via R5-07-F8.

## Planned initiatives

### R8-01 Packaging (the deferred S10)

- **Status:** planned  ·  **Wave:** unsequenced — **OPEN DESIGN MARKER:
  operator direction pending** (target audience and install form are
  ambition decisions: personal tool vs installable OSS product)
- **Depends on:** — (soft: R5-01/R5-02 — a distributed artifact must ship
  with the safety seams on by default)
- **Context:** The refinement roadmap's S10 ("packaging operator-deferred",
  memory `project_forge_refinement_roadmap`) — the one item of that campaign
  never closed. Everything today assumes a source checkout + nvm Node.
- **Features:**
  - **R8-01-F1 Install-form decision + artifact.** Decide the form (npm
    package / npx runner / container / release tarball), then ship it:
    versioned artifact, dependency story, `forge init` first-run UX from a
    clean machine. ACs: documented install on a machine without the repo
    checked out reaches the Studio library page; getting-started rewritten
    against it.
  - **R8-01-F2 Config & secrets surface for installs.** Where
    `forge.config.json`, per-project `secrets.env`, and creds live in an
    installed (non-checkout) layout; harness/env guards behave identically.
    ACs: verify-cycle mdtoc tier runnable from an installed forge.
- **Session sizing:** ~2 sessions after the operator's form decision.
- **Out of scope:** managed-project release machinery (R1-04); marketing
  launch (R8-03).

### R8-02 Version & release cadence for forge itself

- **Status:** planned  ·  **Wave:** unsequenced (cheap; ride any release)
- **Depends on:** —
- **Context:** The 0.x policy lives only in operator memory; 1.0 criteria
  don't exist anywhere.
- **Features:**
  - **R8-02-F1 Policy codified.** The 0.x-until-operator-cuts-1.0 policy +
    bump conventions land in `CONTRIBUTING.md`/`CHANGELOG.md` header. ACs:
    policy readable in-repo; matches practice since 0.1.0.
  - **R8-02-F2 1.0 criteria proposal.** A drafted, operator-gated definition
    of what 1.0 means (candidate ingredients the corpus already suggests:
    R4-10 successor flow proven by verify:cycle; R2-06-F4 cross-adapter
    proof; R8-01 installable artifact; zero critical known-gaps). ACs:
    criteria drafted in this file; explicitly awaiting operator verdict —
    the cut itself is never automated.
- **Session sizing:** ≤1 session.
- **Out of scope:** the actual 1.0 cut (operator-only, by standing policy).

### R8-03 Public docs & positioning upkeep

- **Status:** planned  ·  **Wave:** unsequenced
- **Depends on:** — (R5-07-F8 lands the reframe annotations first)
- **Context:** The market doc is perishable by design; the differentiation
  claims have maintenance rules ("stop saying / start saying", §10 re-check
  before publication) but no owner; the docs split (operator vs contributor,
  Diátaxis-labelled) exists but has no publication decision.
- **Features:**
  - **R8-03-F1 Positioning refresh cadence.** Each externally-visible
    milestone (R2-06-F4 second-adapter proof, R8-01 packaging) triggers a
    dated market-doc refresh: figures re-checked, claims re-graded against
    §3.4's four qualifiers, the E3 portfolio claim updated against R4-11-F4
    reality. ACs: refresh checklist in the doc's header; one refresh
    executed on the next milestone.
  - **R8-03-F2 Docs-site decision.** Decide whether operator docs publish
    beyond the repo (site vs README-first), and if so the minimal mechanism.
    ACs: decision recorded; if "site", it builds from the existing Diátaxis
    split without forking content.
- **Session sizing:** ≤1 session + per-milestone refreshes.
- **Out of scope:** blog/personal essays (operator-owned, out of repo).

## Deferred

### R8-D1 Community & ecosystem enablement

Contribution pathways beyond the health files: external skill/plugin
authorship as a supported channel (ties R3-01-F4's marketplace posture +
ADR-024's skills-as-plugins north star), issue triage norms, external
adapter contributions against the ADR-029 conformance suite. **Re-entry
condition:** the operator decides forge courts external contributors (an
ambition call, not a technical one) — until then the AGPL + health files
posture stands as-is.

## Change log

- 2026-07-17 — Roadmap minted by the coverage review (packaging S10,
  version policy, and positioning upkeep had no roadmap home). Seeded from
  recorded material only: the S10 deferral, the 0.x version-policy memory,
  the market doc's own perishability rules, ADR-031's CLI collapse.
  Deliberately thin; every ambition decision is marked operator-pending.
