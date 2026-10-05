# Getting started — install to first merge

This is the end-to-end path from a fresh checkout to the example develop
factory shipping a merged PR against one of your projects. It assumes you have already followed the
README quickstart: forge is built and linked, `forge init` has run, `FORGE_CLAUDE_CLI` is exported,
and `forge studio` is up with Studio open in a browser at <http://localhost:4124>.

The five steps:

1. [Bring a project under forge](#1-bring-a-project-under-forge)
2. [Preflight until green](#2-preflight-until-green)
3. [Author or reuse a flow](#3-author-or-reuse-a-flow)
4. [Kick off the architect](#4-kick-off-the-architect)
5. [Review and merge](#5-review-and-merge)

The example factory runs unattended between its gates — the plan gate, the
kickoff, the verdict gate and reflection — which are that factory's, declared in
its flow; a factory you build declares its own. Everything else is autonomous.

---

## 1. Bring a project under forge

Projects are **auto-discovered from disk**: any directory under `projects/`
(or `$FORGE_PROJECTS_DIR`, or the `projectsDir` in `forge.config.json`) that
carries a `.forge/project.json` contract file is a managed project. There is no
registry file to edit.

Clone or symlink your project's git repo into `projects/`:

```bash
git clone <url> projects/<id>
# or, to keep the repo where it already lives:
ln -s ~/path/to/repo projects/<id>
```

The directory name becomes the project id (lowercased). The repo **must be a git
repository** — forge develops on branches and hands you a PR.

**Already onboarded?** If the repository already ships a `.forge/project.json`
(the reference project `gitpulse` does), there is nothing to scaffold: clone it
into `projects/<id>`, go straight to step 2, and when preflight is green skip to
step 4.

Then make it satisfy the **forge↔project contract**
([docs/reference/project-contract.md](../reference/project-contract.md)). Two ways:

- **Studio (UI):** Studio → Projects → New. The onboarding form scaffolds
  `.forge/project.json`, idempotent `roadmap.md` + `brain/profile.md` stubs, and
  `git init`s the dir if needed — then reports any preflight clause still red.
- **By hand / for a roadmap-scale onboarding:** run the **`forge-onboard-project`**
  skill, which maps each contract invariant onto your project's shape (UI app,
  HTTP API, library, CLI, monorepo, infra provider) and files a roadmap-scale
  initiative. Copy [`studio/starters/project.json.example`](../../studio/starters/project.json.example)
  to `projects/<id>/.forge/project.json` and fill in every field — it is
  language-agnostic and annotates each contract field.

> `.forge/project.json` is **tracked** config (force-added past the project's
> `.gitignore`), as is `.forge/quality_gate_cmd`. Per-cycle scratch under
> `.forge/work-items/` must stay gitignored — see contract clause C2.

---

## 2. Preflight until green

Preflight checks the project against the contract clauses and **names the
failing one** rather than limping:

```bash
forge preflight <id>
```

Hard clauses (C1 quality gate, C2 scratch hygiene, C4 machine-readable context)
must pass before forge will run a flow. DEPS is hard too: install the
project's dependencies in `projects/<id>` (for a Node project, `npm ci`) before
you kick off, or `forge serve` refuses the claim and the initiative stays
pending until you fix the ground — forge serve re-checks it within five minutes,
no restart needed
([DEPS](../reference/project-contract.md#deps--the-declared-gate-is-runnable-in-the-ground-hard-at-claim-time-and-in-forge-preflight)). Advisory clauses (C5/C6/C8, DEMO,
ARTIFACTS) only warn. Iterate until every hard clause is green. The same verdict
renders live in the Studio project builder (the `ContractReadiness` panel).

### Secrets for a live-acceptance tier

If your project has a live/external acceptance tier (e.g. a Terraform provider
hitting a real API), declare a `testProcess.acceptance` block in `.forge/project.json`
with `requiresEnv` listing every variable a live gate needs. Whether an
initiative must carry a live-acceptance work item is decided by its change
class, not by this block: code, config and infra initiatives must; docs
initiatives are not forced to.

```jsonc
"testProcess": {
  "acceptance": {
    "match": "TF_ACC=1",
    "requiresEnv": ["TF_ACC", "AZDO_ORG_SERVICE_URL", "AZDO_PERSONAL_ACCESS_TOKEN"]
  }
}
```

Put the actual values in a **per-project `secrets.env`** at the project root:

```bash
# projects/<id>/secrets.env  — NEVER commit this
TF_ACC=1
AZDO_ORG_SERVICE_URL=https://dev.azure.com/your-org
AZDO_PERSONAL_ACCESS_TOKEN=...
```

`secrets.env` is gitignored by convention — both at the forge root
(`.gitignore` ignores `secrets.env` and `*.env`, keeping `*.env.example`) and in
the project's own `.gitignore`. The dev-loop sources it when a work item's gate
matches `testProcess.acceptance.match`; if a matching gate runs with one of
`requiresEnv` unset, the dev-loop **errors the gate** rather than recording a
false pass. Verify the file is ignored before you write any secret into it:

```bash
git -C projects/<id> check-ignore secrets.env   # must print: secrets.env
```

---

## 3. Author or reuse a flow

A **flow** is the agent pipeline that builds your project (plan → dev → review →
…). You can reuse a shipped flow or author your own:

- **Reuse:** the out-of-the-box palette ships the two spine flows —
  `forge-architect` (interview → decompose) and `forge-develop` (build →
  review → merge; on merge it automatically dispatches the standalone
  reflector agent run, which captures the brain). Point one at your project
  from Studio.
- **Author:** Studio → Flows → New, composing agents from the library (or build
  your own agents from the starter library first). `forge studio lint` validates
  every flow/agent definition.

---

## 4. Kick off the architect

The architect session ends at the factory's **plan gate**. In Studio, go to **`/architect/new`**,
pick the project, drop an idea, answer the interview, and approve the **PLAN** at the plan gate.

**Where a budget is set.** The same form's **Cost ceiling (USD, optional)**
field caps the architect session: the runner checks it at the start of every
turn. The develop run has its own ceiling, and forge stops dispatching work
once the run's spend reaches it. Set it in the ceiling field beside **Start
development** on the project's roadmap card; left untouched, the ceiling is the
initiative's `cost_ceiling_usd`, or else its `cost_budget_usd` plus 50%. Both
fields are in the initiative's manifest, which the PLAN shows at the plan gate.

**The interview is optional.** A precise idea can go straight to a PLAN with no
interview rounds. The PLAN may arrive with findings from the advisory
completeness critic ([the example factory](../explanation/example-factory.md));
approve the plan as it stands, or revise it with feedback that addresses them.

Approving queues an initiative; `forge serve` claims and plans it into work
items the moment `forge studio` has it live. Then **kick off** from the
project's roadmap in Studio: press **Start development** on the initiative's
card. The develop run then goes autonomously — plan → change → verify →
package — fanning work out across parallel work items.

The **UI is the sole operator surface** ([D-12](../../DECISIONS.md))
— author + run a cycle, review/approve, and recover stuck initiatives all from
`forge studio`; the Recovery screen replaces the old `review`/`requeue` verbs, and new
runs go through the architect flow or `POST /api/initiatives`. The only operator CLI
verbs are `forge init`, `forge studio`, and `forge studio lint`. The scheduler daemon
(`forge serve`) is spawnable for CI/headless use; it is not an operator command.

---

## 5. Review and merge

When the cycle finishes, forge produces a **self-contained, demo-embedded PR**
and stops at the factory's **verdict gate**: inspect the PR's demo (real evidence
— an API response, a rendered page, plan output — not a table of test names),
then either **approve** or **send it back** from the unified
`/artifact/<cycleId>` viewer in Studio. Approving merges the PR: forge runs the
merge itself, so you do not merge it in GitHub. If that merge fails, Studio says
so and you merge the PR on GitHub instead.

Merging fires **closure**, which dispatches the reflector — the factory's
**reflection** gate — where the reflector asks its questions and writes brain themes + a retro + the
cycle archive, so the next cycle is smarter.

---

## Where to go next

- [The forge↔project contract](../reference/project-contract.md) — every invariant, in full.
- The `forge-onboard-project` skill — maps the contract onto any project form and files a roadmap-scale initiative.
- [`studio/starters/project.json.example`](../../studio/starters/project.json.example) — the annotated contract template.
- [CONTRIBUTING.md](../../CONTRIBUTING.md) — the four merge gates and per-seam extension recipes.
