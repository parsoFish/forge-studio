# Getting started — install to first merge

This is the end-to-end path from a fresh checkout to forge shipping a merged PR
against one of your projects. It assumes you have already built forge
(`npm install && npm run build && npm link`) and can run `forge --help`.

The five steps:

1. [Bring a project under forge](#1-bring-a-project-under-forge)
2. [Preflight until green](#2-preflight-until-green)
3. [Author or reuse a flow](#3-author-or-reuse-a-flow)
4. [Kick off the architect](#4-kick-off-the-architect)
5. [Review and merge](#5-review-and-merge)

Forge runs unattended **between** three deliberate human moments — architect,
review, reflect. Everything else is autonomous.

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

Then make it satisfy the **forge↔project contract**
([docs/forge-project-contract.md](./forge-project-contract.md)). Two ways:

- **Studio (UI):** Studio → Projects → New. The onboarding form scaffolds
  `.forge/project.json`, idempotent `roadmap.md` + `brain/profile.md` stubs, and
  `git init`s the dir if needed — then reports any preflight clause still red.
- **By hand / for a roadmap-scale onboarding:** run the **`forge-onboard-project`**
  skill, which maps each contract invariant onto your project's shape (UI app,
  HTTP API, library, CLI, monorepo, infra provider) and files a roadmap-scale
  initiative. Copy [`studio/starters/project.json.example`](../studio/starters/project.json.example)
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
must pass before forge will run a flow. Advisory clauses (C3/C5/C6/C8, DEMO,
ARTIFACTS) only warn. Iterate until every hard clause is green. The same verdict
renders live in the Studio project builder (the `ContractReadiness` panel).

### Secrets for a live-acceptance tier

If your project has a live/external acceptance tier (e.g. a Terraform provider
hitting a real API), declare an `acceptance_gate` block in `.forge/project.json`
with `requires_env` listing every variable a live gate needs:

```jsonc
"acceptance_gate": {
  "match": "TF_ACC=1",
  "required": true,
  "requires_env": ["TF_ACC", "AZDO_ORG_SERVICE_URL", "AZDO_PERSONAL_ACCESS_TOKEN"]
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
matches `acceptance_gate.match`; if a matching gate runs with one of
`requires_env` unset, the dev-loop **errors the gate** rather than recording a
false pass. Verify the file is ignored before you write any secret into it:

```bash
git -C projects/<id> check-ignore secrets.env   # must print: secrets.env
```

---

## 3. Author or reuse a flow

A **flow** is the agent pipeline that builds your project (plan → dev → review →
…). You can reuse a shipped flow or author your own:

- **Reuse:** the out-of-the-box palette ships `forge-cycle` (the full forge
  pipeline) plus `forge-cycle-with-review`, `knowledge-ingest`, `release-refine`,
  and `security-scan`. Point one at your project from Studio.
- **Author:** Studio → Flows → New, composing agents from the library (or build
  your own agents from the starter library first). `forge studio lint` validates
  every flow/agent definition.

---

## 4. Kick off the architect

The architect is the first human moment. In Studio, go to **`/architect/new`**,
drop an idea, answer the interview, and approve the **PLAN** at the plan gate.
Approving queues an initiative; the scheduler (`forge serve`) picks it up and
runs the flow autonomously — plan → change → verify → package — fanning work out
across parallel work items.

You can also drive a cycle from the CLI for recovery/CI:

```bash
forge serve [--once]            # run the unattended scheduler
forge enqueue <id> "<spec>"     # drop an initiative into the queue directly
forge cycle <init-id>           # run one initiative end-to-end in the foreground
```

---

## 5. Review and merge

When the cycle finishes, forge produces a **self-contained, demo-embedded PR**
and stops. This is the second human moment: inspect the PR's demo (real evidence
— an API response, a rendered page, plan output — not a table of test names),
then either **approve** (merge it in GitHub) or **send it back** from the
`/review/<cycleId>` screen in Studio.

Merging fires **closure**, which runs the third human moment — **reflection** —
where the reflector asks its questions and writes brain themes + a retro + the
cycle archive, so the next cycle is smarter.

---

## Where to go next

- [The forge↔project contract](./forge-project-contract.md) — every invariant, in full.
- The `forge-onboard-project` skill — maps the contract onto any project form and files a roadmap-scale initiative.
- [`studio/starters/project.json.example`](../studio/starters/project.json.example) — the annotated contract template.
- [CONTRIBUTING.md](../CONTRIBUTING.md) — the four merge gates and per-seam extension recipes.
