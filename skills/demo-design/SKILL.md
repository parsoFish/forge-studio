---
name: demo-design
description: Forge-owned generator skill that reads a project's demoProcess + its actual code and generates per-project demo machinery (a repo skill and/or CI step and/or test) committed into the project repo. Run when an operator saves a project's demoProcess in Studio. The generator PRODUCES; the project's own toolchain EXECUTES the generated artifact. Operators customize by editing the generated files (committed repo files) and by editing this generator skill.
phase: onboarding
surface: operator-triggered
model: claude-sonnet-4-6
---

# Demo-design — the forge demo-machinery generator

## What this skill is

This skill generates the **project-side demo machinery** that the unifier phase
later executes to produce `demo.json` + `DEMO.md`. It is the F5 generator —
forge-owned, run once per project when the operator configures `demoProcess`,
producing committed files the project's own toolchain can execute.

**Boundary:**
- **This skill PRODUCES** — it writes generated files into the project repo.
- **The project's toolchain EXECUTES** — the generated skill/step/test is
  committed to the project repo and invoked by the unifier.
- **Operators customize** by editing the generated files (they are ordinary
  committed repo files) or by editing this generator skill (a normal forge skill).

This is NOT a hard-coded per-type mapping. The generator reads the project's
actual code and `demoProcess`, technically assesses the right evidence form, and
produces appropriate machinery — no project-type enumeration.

## When to run

This skill runs **when an operator saves a project's `demoProcess` in Studio**
(triggered via the Studio project page → PUT `/api/studio/projects/:id` when
`demoProcess` is present). It can also be invoked directly:

```
forge run skill demo-design --project <project-id>
```

## Step 1 — Read the demoProcess (the operator's intent)

Read `.forge/project.json` and extract `demoProcess`. These typed steps ARE the
operator's specification of the demo:
- **`capture`** steps — what before/after evidence to record.
- **`verify`** steps — what assertion makes the evidence non-trivial.
- **`present`** steps — how the evidence is surfaced in the PR/demo.

If `demoProcess` is absent or empty, surface an error: "demoProcess must have
≥1 capture and ≥1 verify step before demo-design can run."

## Step 2 — Assess the project's code (detection without hard-coding)

Read the project's actual code to technically assess the right evidence form.
The evidence form is NOT driven by a project-type enum — it is derived from
what the code actually exposes. Use this decision tree:

### Evidence-form decision tree

**Ask four questions about the project's code:**

1. **Does the project have a renderable UI surface?**
   Look for: a `package.json` with `preview` or `serve` scripts, a `next.config.*`,
   Vite/webpack config, a `public/` or `dist/` dir pattern, any `*.html` entry
   point. Also check the `preview_command` field in `.forge/project.json` if present.
   → If YES: evidence form is **portal/browser screenshot** (OPPORTUNISTICALLY —
     only when a working preview command exists and a headless browser is available).

2. **Does the project have a measurement command that emits stable scalar output?**
   Look for: a `Makefile` with a `bench` target, a `go test -bench` invocation,
   a `benchmark` npm script, a dedicated metrics runner referenced in `demoProcess`
   verify steps. The command must emit parseable before/after numbers.
   → If YES (and answer to Q1 is NO): evidence form is **harness metrics**
     (run before/after, diff stable lines).

3. **Does the project call a live external API or provision real resources?**
   Look for: provider SDK imports (`hashicorp/go-plugin`, `azure-sdk-for-go`,
   `aws-sdk-go`, `google.golang.org/api`), resource-lifecycle patterns (create →
   read → update → delete), acceptance test files (`*_test.go` with `TF_ACC`,
   `*.acceptance.ts`), the `acceptance_gate` field in `.forge/project.json`.
   → If YES (and no UI surface): evidence form is **live external API round-trip**
     (provision → GET → idempotency-replan → destroy, with portal screenshot
     opportunistically when a portal URL can be derived).

4. **Default: JSON-diff / notes-only evidence**
   The project has no UI surface, no measurement command, and no live external
   calls — or the operator's `demoProcess` only uses `verify` and `present` steps
   with no external dependency.
   → Evidence form: **JSON-diff or notes-only** (run the quality gate, capture
     its output + `git diff --stat`, write a checkpoint with `beforeNote` /
     `afterNote`).

**Never hard-code project types.** A project whose `package.json` has a `preview`
script AND calls a REST API can have BOTH browser screenshots AND live evidence.
Follow the evidence.

## Step 3 — Generate the demo machinery

Based on the assessed evidence form, generate the appropriate files under
`<artifactRoot>/skills/<slug>/` in the project repo. The slug should be
descriptive: `demo-runner`, `live-demo`, `ui-demo`, etc. — NOT `ado-demo`
unless this is the betterado project.

### What to generate (one or more of)

#### A. A project skill (`<artifactRoot>/skills/<slug>/SKILL.md`)
A Claude Code skill the unifier agent loads to produce `demo.json`. It must:
- State the evidence form and why (from Step 2 reasoning).
- Give the concrete commands the unifier runs (e.g. `go test -run TestAcc -v ./...`).
- State what to capture (before/after values, specific JSON fields, screenshot labels).
- Include the `demoProcess` steps verbatim so the unifier can tick them off.
- Reference `skills/demo/SKILL.md` for the demo.json contract (the forge half).
- For **live-external** evidence: include the exhaustive-config discipline (every
  configurable option exercised with a non-default value), the round-trip proof
  requirement (GET every written field), the idempotency gate (re-plan → no changes),
  and clean destroy. Encode these as hard gates the demo must pass.
- For **portal/browser** evidence: include the preview command invocation, which
  checkpoint labels map to which screenshots, and the `forge demo capture` step.
- For **harness metrics**: include the measurement command, which output lines are
  stable scalars, and the `metrics[]` format for `demo.json`.

#### B. A CI step (`.github/workflows/demo.yml` or similar) — OPTIONAL
Only when the evidence form involves a live external call AND the project has a
CI workflow. In that case, generate a CI step that runs the demo command with
the credentials env var (e.g. `TF_ACC=1`) so demo evidence can be regenerated
in CI. This is optional and only makes sense for projects with live-external evidence.

#### C. A test hook (`*_demo_test.go`, `demo.test.ts`, etc.) — OPTIONAL
When the verify step in `demoProcess` names a specific test, generate a thin
test wrapper that the generated skill can invoke to capture concrete pass/fail
evidence (name + result) into `demo.json`'s `testEvidence[]`. Only generate
this when the `demoProcess` verify steps reference a named test.

### Generation contract (what you MUST write into every generated skill)

The generated `SKILL.md` MUST include:

```
## Demo contract (must satisfy skills/demo/SKILL.md)

demo.json MUST carry:
- `title` — one-line essence of the change.
- `essence` — prior → new behaviour (2–3 sentences).
- `checkpoints[]` — ≥1, each with `label`, `caption`, `beforeNote`, `afterNote`.
- [evidence-specific sections based on the form]
- `acEvaluations[]` — one entry per demoProcess verify step, with `verdict` and
  concrete `evidence` (never "see code").

Run `forge demo render <initiative-id>` after writing demo.json to derive DEMO.md.
```

### Where to write the generated files

- Project-owned skill: `<project-root>/<artifactRoot>/skills/<slug>/SKILL.md`
- CI step (if generated): `<project-root>/.github/workflows/demo.yml`
- Test hook (if generated): alongside the project's existing tests, in the same
  directory as the tests referenced in `demoProcess` verify steps.

Commit all generated files into the project repo (not forge's repo).

## Step 4 — Update the project config

After generating the skill, add the skill slug to `skills` in
`.forge/project.json` so the unifier agent composes it automatically:

```json
{
  "skills": ["<generated-slug>"]
}
```

Also surface the generated skill path in `instructions` so the PM knows about it.

## Step 5 — Validate and report

Run `forge preflight <project>` to confirm the DEMO clause now passes (it checks
that `demoProcess` has ≥1 capture + ≥1 verify step — the structural check). The
deeper "does the generated skill actually produce good evidence" is verified
during the first real cycle.

Report to the operator:
- What evidence form was assessed and why (the reasoning from Step 2).
- What files were generated (paths).
- Whether any CI step or test hook was generated.
- The preflight DEMO clause result.
- The next step: "Run a cycle — the unifier will load the generated skill and
  produce demo.json evidence."

## The betterado ado-demo skill is a generated example

`projects/terraform-provider-betterado/forge/skills/ado-demo/SKILL.md` is the
canonical example of what this generator produces for a **live-external** project.
It was authored by hand for the betterado capstone; future runs of this generator
against betterado would produce equivalent machinery. Study it for the exhaustive
live-test discipline (apply → GET round-trip → idempotent re-plan → portal
screenshot → clean destroy).

## Done when

- The generated skill exists at `<artifactRoot>/skills/<slug>/SKILL.md` in the
  project repo, committed.
- The evidence form is documented in the generated skill with the reasoning.
- The `demoProcess` steps are encoded in the generated skill as the execution
  contract.
- The skill slug is listed in `.forge/project.json` `skills`.
- `forge preflight <project>` DEMO clause passes.
- The operator understands what the generated skill will do on the first cycle.
