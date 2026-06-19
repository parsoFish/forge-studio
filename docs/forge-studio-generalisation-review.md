# Forge Studio — Generalisation, Final-Loop & Cruft Review

> **Date:** 2026-06-19 · **Lens:** move Forge Studio from "the operator's forge"
> toward a generalised product any user can install, onboard their own project to,
> author agents + a flow in, and run real work through — with a *contract that
> closes the loop* (docs updated, a new version published, a clear terminal
> handshake).
>
> **Method:** a 7-agent fan-out (betterado · project↔engine coupling · repo cruft ·
> contract-as-spec · install/first-flow UX · final-loop capability · completeness
> critic) plus a dedicated skill-gap explorer. Every finding below carries
> `file:line` evidence; the four headline claims were re-verified by hand.
>
> **Scope note:** the betterado live-money capstone has already run and closed;
> ADR-034 (Studio-aligned contract), the `forge-onboard-project` skill, the
> `release-refine` OOTB flow, and configurable `artifactRoot` already landed. This
> review assesses what that work **left incomplete**, not what to build from zero.

---

## Executive summary

One theme dominates and it is exactly the operator's lens #2: **the final loop is
Forge Studio's weakest surface.** A cycle stops at *"PR merged + reflected."*
Nothing — not the engine, not the contract, not the `ProjectConfig` schema —
updates the project's user-facing docs, bumps a version, writes a changelog, or
cuts a release/tag. Confirmed by hand: `grep -rniE "git tag|npm version|gh
release|changelog" orchestrator/` returns **zero** hits in phase code. The
requirement isn't *incomplete*, it's *absent*, and the gap is invisible because
nothing tracks it.

The second theme is generalisation. The engine *internals* are clean — project
shaping is config-driven from each project's own `.forge/project.json`, and the
~177 `betterado` references in production `.ts` are provenance comments, not
behavioural coupling. But the **OOTB surface ships the operator's personal
projects**, and a single tracked file (`studio/projects.yaml`) both renders three
ghost projects on a fresh clone *and* suppresses the only first-run onramp.

The third theme is that **SWAP** — the third pillar of Studio's AUTHOR/RUN/SWAP
story and a stated differentiation moat — is presentational: the dev-loop
hardcodes the `claude` adapter, the non-Claude adapters are untested, and the
KB-backend seam only feeds a read-only graph viewer.

Fourth: ~115 MB of stray/regenerable cruft, two unused deps, and dangling
`benchmarks/` config give a clean delete-list. betterado itself is a strong
exemplar but leaks (a **blank changelog for its own headline v0.2.0 release**,
demos scattered across two homes, a `demo.shape` mislabeled with an apologetic
comment).

**If you do five things:** (P0) empty `studio/projects.yaml`; (P0) add a
declarable `releaseProcess` to the contract; (P1) wire a post-merge release step +
generalise the OOTB flow; (P1) ship a getting-started doc + a template
`project.json`; (P1) thread `runtime.sdk` so SWAP is real. Everything else is
polish or cleanup.

---

## Verdict by review-lens requirement

| Operator requirement | Status today | Where it breaks |
|---|---|---|
| Install from scratch → working Studio | ⚠️ Builds & launches, but OOTB is broken | `projects.yaml` ghost projects + suppressed onramp (P0) |
| Onboard *your own* project | ⚠️ UI path is incomplete | UI onboard skips C4 artifacts → instant preflight fail; no template; no getting-started doc (P1) |
| Create agents + a flow | ✅ Works (AUTHOR proven by `ui:journey`) | but the demo/flow are betterado-themed (P2) |
| Real work completed | ✅ Works (capstone proved it) | requires operator-tribal secrets knowledge (P2) |
| Finalised work **updates docs** | ❌ Absent | no contract clause, no gate, no step |
| Finalised work **publishes a new version** | ❌ Absent | no engine code, no `ProjectConfig` field |
| **Clear final loop** closing the process | ❌ Stops at merged PR | no terminal "published" handshake |
| **SWAP** runtime/KB backend | ❌ Presentational | dev-loop hardcodes `claude`; KB seam read-only |

---

## 1 · The final loop — the headline gap (P0–P1)

The cycle's real terminal sequence (traced end-to-end): `review` opens a PR and
**stops** → operator merges in GitHub → `closure.ts` confirms `MERGED`,
fast-forwards local main, prunes the branch, moves the manifest to `done/` →
`runReflector` writes brain themes. That closes the **learning loop** and the
**git-hygiene loop**. The **product-release loop is entirely absent.**

Tellingly, betterado's *own* `CLAUDE.md:95–107` carries a complete release runbook
(`make docs` → bump `PROVIDER_VERSION.txt` → `git tag` + push → GoReleaser →
Terraform Registry) — but it is a **human runbook with zero forge wiring**. No
closure/finalize/reflector/flow step invokes it, and `ProjectConfig` has no field
to even *declare* it. So betterado shipped `v0.2.0` (tag + version bump exist) with
its `CHANGELOG.md` `## Unreleased` section **empty** and the whole headline feature
set undocumented.

### 1.1 No declarable release/publish process *(contract-gap · P0 · M)*
`ProjectConfig` / `project-config.schema.json` declare `demo`, `quality_gate_cmd`,
`ci_gate`, `acceptance_gate`, `demoProcess`, `artifactRoot`, `sweep`, `baselines` —
**no** `releaseProcess` / `versionFile` / `changelogPath` / `release_cmd`.
- *Evidence:* `docs/schemas/project-config.schema.json` (no release key);
  `orchestrator/project-config.ts` (grep `release|publish|version|finalize` → only
  demo/artifact fields); `projects/terraform-provider-betterado/CLAUDE.md:95–107`
  (release runbook unreferenced by any phase).
- *Action:* add an optional, typed `releaseProcess` clause analogous to
  `demoProcess` — steps the post-merge step runs (`docs-regen` → `version-bump` →
  `changelog` → `tag`/`release`) plus a `versionFile` pointer. Invariant-not-recipe:
  the project declares its version file + tag format; forge runs the project's own
  command verbatim (so e.g. tfplugindocs' guide-restore quirk is encoded by the
  project, not forge). Optional ⇒ libraries with nothing to publish stay flow-ready.

### 1.2 No post-merge release step in the engine *(final-loop · P0 · L)*
`closure.ts:219–272` (confirmed-merge branch) does only `alignLocalToRemote` +
`terminalMove('done')`; `finalize-merged.ts:70–88` runs `closure → reflector →
writeCycleReport`. Nothing touches docs/version/changelog/tag.
- *Action:* add an opt-in post-merge release step (downstream of the
  confirmed-merge signal closure already owns), gated on §1.1's declared process.
  Must be idempotent and never fire on a partial/unconfirmed merge. Keep the actual
  push-the-tag act operator-gated, mirroring C6's no-auto-merge posture — forge
  produces the *artifacts* (version bump + changelog entry) in-PR; the human cuts
  the release.

### 1.3 No contract invariant requiring doc-currency *(contract-gap · P1 · M)*
The contract enumerates C1–C9 + DEMO/ARTIFACTS/BRAIN but has **zero** clause that a
behaviour-changing change must update the docs describing it. `DEMO` requires
*showing* the change to a reviewer, not *documenting* it in-repo. betterado's
`ci_gate` (`make test && golangci-lint && terrafmt-check`) has no docs-sync check,
so a cycle can ship a new resource with stale published docs — the exact
flagged-open symptom in operator memory.
- *Evidence:* `docs/forge-project-contract.md:286–297` (DEMO ≠ doc-update);
  betterado `ci_gate` has no docs check; `skills/developer-unifier/SKILL.md:88–93`
  gate list has no docs-current check.
- *Action:* add **C10 "Documentation parity"** — advisory by default, HARD when the
  project declares a `docs_gate_cmd` (e.g. `tfplugindocs validate` / `make
  docs-check`) folded into `ci_gate`. Fold doc-regen into §1.2's release step as its
  first typed action.

### 1.4 No terminal "published" handshake / release record *(final-loop · P1–P2)*
The only terminal artifact is `verdict.json` (approve/send-back) — it closes
*review*, not *delivery*. The history convention (`history/<id>/` =
plan/demo/verdict) is **advisory and unenforced** (ADR-034 itself flags: "forge
cannot enforce that a project's agents actually write `history/<id>/plan.md` …
silently skips it"). There is no `released`/`published` terminal state — closure's
end event is `{outcome:'merged'}`, `FinalizeStatus` has no `published` value.
- *Action:* define a named finalisation handshake — DONE only when *merged + docs
  updated + version bumped + changelog + history committed*. Promote the history
  write from advisory to a post-merge structural check (the gap ADR-034 names).
  Write a small `release.json` (version, tag, URL, timestamp) and stamp the shipped
  version on the cycle report + a terminal event, so the UI/brain can show "shipped
  as vX.Y.Z" and the loop visibly closes at *published*, not *merged*.

### 1.5 The `release-refine` OOTB flow is misnamed and stops at review *(final-loop · P1 · M)*
The flagship bare-minimum flow is named **release**-refine but its 4 nodes are
`pm → dev[fanOut] → unifier → review(gate:verdict)` and its goal is *"Take a seeded
refinement initiative to a merged PR."* It does **no** release/version/docs work,
**drops both the architect and the reflector**, and auto-approves the verdict. So a
fresh user's canonical "bare-minimum" flow teaches that *finalisation = merge* and
delivers neither the learning loop nor the release loop. ("refine" refers to a
release-substrate *roadmap*, i.e. betterado's domain — not cutting a software
release.)
- *Evidence:* `studio/flows/release-refine/flow.yaml` (4 nodes, ends at review);
  `README.md` ("drops the architect … and the reflector"); commit `34b7442`.
- *Action:* either rename honestly (`refine-to-pr`) **or** — better for the
  north-star — add a terminal release node (and restore a reflect node) so the
  bare-minimum flow demonstrates work-done → docs-updated → version-published →
  loop-closed. Depends on §1.1/§1.2 landing first.

### 1.6 Onboarding skill has no finalisation mapping; gap untracked *(contract-gap · P2–P3)*
`forge-onboard-project/SKILL.md` claims to work "for any form — UI app, HTTP API,
library, CLI, monorepo, infra provider" but its 12 steps never map the project's
docs/versioning/publish surface (grep `readme|changelog|version|publish|release` →
0). And the finalisation gap isn't in `docs/known-gaps.md`, so the spec reads as if
"merged PR" is the complete terminal.
- *Action:* add an onboarding step mapping the publish surface onto §1.1's fields
  (npm publish / cargo / pip / GoReleaser-tag / container push). Until the hooks
  land, add a known-gaps entry + a one-line contract scope note so the boundary is
  honest.

---

## 2 · Generalisation: from "operator's forge" to "anyone's Studio"

The engine is decoupled; the **shipped surface** is not. Fix order matters — items
are tagged.

### 2.1 `studio/projects.yaml` ships the operator's three personal projects *(generalisation · P0 · S)* — **the linchpin**
The file is **git-tracked** (`git check-ignore` → exit 1, verified) and hardcodes
`terraform-provider-betterado`, `trafficgame`, `claude-harness`. But `projects/*`
is gitignored, so on a fresh clone those dirs **don't exist** → the Studio library
renders three ghost project cards with broken paths. `validateProjectsRegistry`
checks ids/slugs only, not path existence, so lint stays green and the breakage is
silent. Flagged independently by **three** agents.
- *Evidence:* `studio/projects.yaml` (3 entries, verified); `git ls-files
  projects/` → only `.gitkeep` + `README.md`; `cli/bridge-studio.ts:251–262`
  loads it as the registry; `orchestrator/studio/validate.ts:488` no path check.
- *Action:* ship `projects.yaml` with `projects: []` (validates clean; lint only
  errors on a *missing* file) and gitignore the operator's populated copy the way
  `forge.config.json` is handled (`projects.yaml.example` tracked, `projects.yaml`
  ignored). Add a preflight/lint warning when a registered project's path doesn't
  resolve. *Watch:* `e2e-journey.mjs:185–189` snapshots & restores this file —
  verify it still passes with an empty seed.

### 2.2 The first-run onramp is suppressed by the pre-populated registry *(generalisation · P0 · S)*
The "Welcome to Forge Studio" panel + the 4-step orientation + the "Create your
first agent →" CTA render **only** when `agents.length === 0 && flows.length === 0
&& projects.length === 0` (`forge-ui/app/page.tsx:97`, verified). With 3 shipped
projects it *never* shows — the single best OOTB guidance is dead on arrival.
(Note: `studio/flows/` ships 5 flows, so `flows.length` may already be non-zero —
the gate likely needs softening regardless.)
- *Action:* §2.1 restores `projects.length`; additionally relax the gate to fire
  when there are no *valid path-resolving* projects (so a user mid-onboard still
  sees guidance), and reconsider the `flows.length === 0` term given seeded flows.

### 2.3 Onboarding a fresh project is half-wired *(generalisation · P1)*
- **UI onboard skips the C4-HARD artifacts** *(M)*. `POST /api/studio/projects`
  (`bridge-studio-writes.ts:205–273`) writes only `.forge/project.json` + the
  registry append — no `roadmap.md`, no `<artifactRoot>/brain/profile.md`, no
  `git init`, no `AGENTS.md` (yet the default `instructions` string literally says
  "See AGENTS.md", `:250`). So a UI-onboarded project **fails `forge preflight` on
  C4 immediately** with no in-product explanation; the UI path and the
  `forge-onboard-project` skill path are disjoint. *Action:* either scaffold C4
  stubs (idempotent) or surface the failing clauses inline + hand off to the skill;
  add form helper text that the path must be an existing git repo.
- **No template `.forge/project.json`** *(S)*. The only real one is betterado's
  (richly ADO-specific). `forge.config.json` has a `.example` sibling;
  `.forge/project.json` does not. *Action:* ship an annotated
  `studio/starters/project.json.example` (every field a commented placeholder,
  language-agnostic defaults) and have the onboard skill scaffold it.
- **No getting-started doc** *(M)*. There is no getting-started / onboarding /
  tutorial anywhere in `docs/` (find → empty). `README.md:37–67` jumps from `forge
  studio` straight to `forge enqueue <project> <spec>` without ever saying how
  `<project>` comes to exist. README/CONTRIBUTING/operator-journey have **zero**
  references to "onboard" or the skill. *Action:* add `docs/getting-started.md`
  covering clone-into-`projects/` (or UI onboard) → run skill / `forge preflight`
  until green → author or reuse a flow → `/architect/new` → approve PLAN → review →
  merge. Link the skill + contract from the README.
- **No secrets guidance for a self-provided project** *(P2 · M)*. `.env.example`
  covers only forge-level creds. The per-project `secrets.env` convention
  (gitignored, mapped from `acceptance_gate.requires_env`, worktree→main fallback)
  is operator-tribal knowledge. *Action:* document it in getting-started; emphasise
  gitignore-and-verify-by-exit-code.

### 2.4 De-betterado-ing the defaults *(generalisation · P2)*
- **Agent prompt strings** *(S)*. Generic, config-driven builders inline betterado
  examples a non-TF project inherits verbatim: `project-manager.ts:355` hardcodes
  *"a live TF_ACC acceptance test"* in the generic acc-gate-violation message;
  `dev-invocation.ts:126` lists `azuredevops/…` as the relative-path example;
  `gate-recipes.ts:67` Go trap uses `./azuredevops/internal/service/foo/`. Pure
  string changes — derive wording from `accGate.requires_env`, use neutral paths.
- **`release-refine` README + `ui:journey` are betterado-grounded** *(M)*. The flow
  `.yaml` is correctly `project: null`, but the README explains every node "where
  betterado provides it," and `e2e-journey.mjs:63` hardcodes
  `PROJECT = 'terraform-provider-betterado'` (25 refs) — so the flagship
  *"watch it run"* video a fresh user generates is betterado-themed. *Action:*
  rewrite the README to map nodes to *contract clauses* (betterado as one labelled
  example); parameterise `PROJECT`/`IDEA` (default to a neutral built-in) or ship a
  second neutral journey. Keep betterado as the live-money `verify:cycle` tier, not
  the default demo. *Watch:* `ui:journey` doubles as the DOM-as-metrics regression
  harness — don't weaken its assertions.
- **No non-provider worked example in the contract** *(M)*. The spec's only
  end-to-end worked example is the TF provider, leaving the generic
  library/CLI/UI path under-illustrated. *Action:* add a library/CLI worked example
  (`quality_gate_cmd` = unit suite, `demoProcess` = cli-diff capture+verify, no C7,
  npm/cargo version).

### 2.5 SWAP is presentational, not load-bearing *(generalisation · P1–P2)* — *surfaced by the critic*
- **The dev-loop never threads `runtime.sdk` — every agent hardcodes `claude`**
  *(P1 · M)*. `makeAgentWithTelemetry` defaults `sdkId = 'claude'`
  (`developer-loop.ts:152`, verified) and `getAdapter(sdkId).createAgent` (`:165`)
  is the only selection point — but all three call sites (`:351, :1429, :1549`)
  omit the arg. The agent def's `runtime.sdk` is read for storage/derivation only,
  never into the hot path. So provisioning `GEMINI_API_KEY` makes the picker
  *selectable* but selecting Gemini has **zero runtime effect**. The SWAP leg (and
  the second-adapter moat) is presentational. *Action:* thread `runtime.sdk` at all
  three sites (default `claude` only when unset); add a test that a non-claude def
  routes to its adapter; until then label the picker as roadmap.
- **SDK-id vocab drift — a landmine under the above fix** *(contract-gap · P2 · S)*.
  Registry/adapter ids are `claude` (`registry.ts:27`, `claude/index.ts:25`) but
  the agent-def writer defaults `runtime.sdk` to **`claude-code`**
  (`bridge-studio-writes.ts:151`). `getAdapter('claude-code')` throws "Unknown
  adapter id." Masked *only* because the dev-loop ignores `runtime.sdk` today — the
  moment §2.5 lands, every UI-authored agent throws. *Action:* unify on one id, in
  lockstep with the threading fix.
- **gemini + aider adapters have zero conformance coverage** *(P2 · M)*. The
  registry names `conformance.ts` as the admission gate, but `conformance.test.ts`
  runs only `example` + `claude`; the two real 553/485-line adapters become live
  the moment their dep+creds exist, never proven against the contract. *Action:*
  add both to the conformance suite via their dep-absent/mock path.
- **The KbBackend seam only feeds the read-only graph viewer** *(P2 · L)*. The only
  production callers of `getKbBackend` are the Studio graph-VIEW endpoints;
  `getKbBackendAsync` (the only Zep-capable constructor) has **zero** production
  callers; the reflector writes brain themes as plain markdown, bypassing the seam.
  So swapping a KB to Zep changes only what the knowledge *tab renders*, not where
  forge stores/retrieves knowledge. *Action:* either route reflector writes +
  planner reads through `getKbBackendAsync(kbId)` (makes the seam load-bearing) or
  scope the SWAP claim down to "graph-viewer backend" in docs/UI so it isn't
  oversold.

> **Reconciled non-problems (critic):** secrets handling is already generic
> (`secrets.env` keyed off `acceptance_gate.requires_env`, not ADO-specific) and
> there is **no single-active-project assumption** (the scheduler routes per
> manifest). No work needed there beyond the §2.3 docs follow-through.

---

## 3 · betterado project refinement

betterado is a strong contract exemplar (clean two-gate model, four
`standing_work_item_acs`, an excellent self-contained `demo/standing/` with
committed REST evidence). Two of the three operator-flagged-open items are
**resolved** by the capstone: the stale `environment{}` construct is gone from
examples + docs (everything uses `stages`), and the permissions acceptance test now
asserts all 13 ReleaseManagement ACL keys live (no longer "4 of N"). Remaining:

| # | Finding | Bucket | Pri | Effort |
|---|---|---|---|---|
| 3.1 | **`CHANGELOG.md` blank for its own headline `v0.2.0`** — tag + `PROVIDER_VERSION.txt` bump exist, but `## Unreleased` is empty and the whole capstone feature set is undocumented; the project's release runbook has no changelog step (`grep -c CHANGELOG .forge/project.json` = 0). Backfill it; generalises into §1.1. | contract-gap | P1 | S |
| 3.2 | **Demos in two inconsistent homes** — `project.json` sets `artifactRoot:"forge"` (demos → `forge/history/<id>/`) but the unifier/demo skill still hardcode `demo/<id>/` (`unifier-invocation.ts:141,151`; `skills/demo/SKILL.md:40,194`; `developer-unifier/SKILL.md:34,83`). On disk: identical duplicates + orphans. Make the seam `artifactRoot`-aware, then de-dup (keep `demo/standing/`). | contract-gap | P1 | M |
| 3.3 | **`demo.shape:"harness"` is wrong** — its own `$shape_comment` admits betterado isn't a harness project and "the shape vocab needs a live-external option (tracked in known-gaps)." The live capability is fully built. Add a `live-external` shape value and retire the apologetic comment. | generalisation | P2 | M |
| 3.4 | **`quality_gate_cmd` duplicated** — a `.forge/quality_gate_cmd` sidecar *and* a `project.json` key hold the same command; preflight reads only the sidecar (`preflight.ts:554–557`), so the json copy can silently drift. Pick one; document the canonical location. | refine-betterado | P2 | S |
| 3.5 | **Empty stale Brain-3 skeleton** `brain/terraform-provider-betterado-brain/` at the forge root (untracked, empty `themes/`+`_raw/`) — the real Brain 3 lives in-project. Delete. *(= cruft D5.)* | delete-cruft | P2 | S |
| 3.6 | **Example comments still say "Environment N"** though the block was renamed to `stages` — cosmetic narration drift; fix on next `make docs`. | refine-betterado | P3 | S |
| 3.7 | **Project-local scratch** — `dist/` 409 M, `graphify-out/` 43 M, `_architect/` 1.4 M (all gitignored, stale). Add a `make clean`/sweeper. Don't touch `demo/standing/` tfstate (it's the handle to live resources). | delete-cruft | P3 | S |
| 3.8 | **Stale `standing-demo-release` id 1** — unverifiable from the repo (only live id 2 is referenced); confirm via REST against the live org before any destructive cleanup. | refine-betterado | P3 | S |

---

## 4 · Cruft & dead-code delete-list

~115 MB of stray/regenerable content. None breaks the build; all muddy the tree and
the OOTB story. Honour the preserve-intent rule on the flagged items.

| # | Item | Why | Pri | Risk / verify |
|---|---|---|---|---|
| 4.1 | **Unused deps `blessed-contrib`, `globby`** (`package.json:35–36`) | Zero imports (TUI is gone; globby superseded by fs) | P2 | build+test green after removal |
| 4.2 | **`tsconfig.json` + `.gitignore` point at deleted `benchmarks/`** (`tsconfig:25,34–37`; `.gitignore:36–51`) | `benchmarks/` removed 2026-05-25; globs match nothing | P2 | no-op for tsc |
| 4.3 | **Orphaned worktree** `_worktrees/INIT-2026-06-16-…` (52 M) | Not in `git worktree list`; stale `.git` | P2 | `git worktree prune` then `rm -rf`; confirm no active cycle |
| 4.4 | **`_lint-before.txt` / `_lint-after.txt`** (tracked, 55 K) | One-off 2026-05-23 audit dump; superseded by live `forge brain lint` | P2 | `git rm` |
| 4.5 | **`mockups/`** (2 M, untracked, **not** gitignored) | Referenced as canonical design source by 5 forge-ui comments yet never committed → dangling on a fresh clone | P2 | **decide with operator:** commit it, or gitignore+delete & strip the 5 comments |
| 4.6 | **Two committed `verify/` demo galleries** (`forge-ui/.demo-shots/verify/`, 7.8 M PNG) | Per-cycle disposable evidence committed to git | P3 | `git rm` + gitignore `verify/`; keep the canonical e2e gallery |
| 4.7 | **`headroom_memory.db`** (root, not gitignored) | External headroom-proxy artifact; no forge reader | P3 | delete + gitignore `*.db` |
| 4.8 | **Empty `brain/<name>-brain/` scaffolds** (claude-harness + betterado) | Studio "create KB" left empty dirs; real Brain 3 is in-project | P3 | delete (= 3.5) |
| 4.9 | **Root `graphify-out/`** (9.3 M, stale) | Pre-restructure orphan; live graphs are under `brain/*/graphify-out/`; `.gitignore` even has a catch-all for it | P3 | `rm -rf` |
| 4.10 | **Dead scaffolds `slugifier` + `trafficGame`** | Not live projects; `slugifier` referenced nowhere; `trafficGame` leaks only via `projects.yaml` | P3 | remove from `projects.yaml` (folds into §2.1); delete dirs if unused |
| 4.11 | **`ts-prune` → 239 unused exports** | Heavily polluted by barrel re-exports + `.mjs`/CLI dynamic wiring | P3 | **do not bulk-delete**; treat as a review worklist; optionally one-shot `knip` |
| 4.12 | **11 docs reference removed `benchmarks/`** | Mostly intentional ADR/phase history | P3 | add a "removed 2026-05-25, see ADR-022" note where phase docs describe it as active |

---

## 5 · Skills worth adding

The skill gaps map almost one-to-one onto the final-loop hole. betterado already
carries 5 project-local skills (`ado-api-explorer`, `ado-browser-inspector`,
`ado-demo`, `resource-scaffolder`, `schema-refactor`), so the betterado proposals
below are genuine *gaps*, not re-treads.

### Forge-cycle-general (close the final loop)
| Skill | What it does | Pri | Why |
|---|---|---|---|
| **release-orchestrator** | Post-reflection: read the project's declared `releaseProcess`, compute semver from AC categories, run docs-regen + version-bump + changelog + tag/release, commit back | P1 | The missing §1.2 step made executable; the single biggest lever |
| **doc-updater** | Per-WI/initiative: detect changed API/schema/examples, run the project's doc tool (tfplugindocs/jsdoc/sphinx), commit | P1 | §1.3 doc-parity, enforced at dev time not post-merge drift |
| **changelog-semver** | Compute the semver bump + generate a changelog entry from initiative title + AC categories | P1 | §3.1 + generic; betterado's blank changelog is the proof |
| **pr-changelog** | Parse the unifier's PR body + ACs into categorised changelog bullets | P2 | Pairs with changelog-semver; reuses existing PR-body output |
| **dep-update** | Detect dependency-update WIs, run the lang's update tool, commit lockfile deltas, re-gate | P2 | Recurring cross-project hygiene |

### betterado-specific (Terraform/Go/ADO domain)
| Skill | What it does | Pri | Why |
|---|---|---|---|
| **tfplugindocs-gen** | On schema change, run `make docs`, restore `docs/guides/`, commit | P1 | Standing AC "Registry docs current" is unenforced; the §1.3 instance |
| **tf-acceptance-test-author** | Generate a `TestAcc<Resource>_complete` (non-default fixtures, UUID names, read-back, `CaptureLiveEvidence`) and register it | P2 | `resource-scaffolder` does CRUD but not the acc-test; recurring manual work |
| **ado-release-explorer** | Release-API-focused (`vsrm` host) specialization of `ado-api-explorer` documenting the Release-specific gotchas | P2 | Release API is betterado's distinguishing surface |
| **breaking-change-detector** | Diff resource schema before/after, flag breaking changes (required-added / removed / type-changed), surface in changelog | P2 | Provider stability; machine-checkable where review is manual today |

---

## 6 · Prioritized action plan

Sequenced; dependencies noted. Each line is independently shippable as one PR.

**P0 — unblock the generalised story (do first)**
1. Empty `studio/projects.yaml` (+ `.example` + gitignore + path-resolve lint warning). *(§2.1; restores §2.2 onramp.)*
2. Add the optional `releaseProcess` clause to `ProjectConfig` + schema + contract doc. *(§1.1; gates everything in §1.)*

**P1 — close the loop + finish onboarding + make SWAP real**
3. Post-merge release step in the closure chain, gated on `releaseProcess`. *(§1.2; needs #2.)*
4. C10 doc-parity clause + fold doc-regen into the release step. *(§1.3.)*
5. Generalise/rename the `release-refine` flow (+ optional terminal release node). *(§1.5; needs #2/#3.)*
6. `docs/getting-started.md` + `project.json.example` + UI onboard scaffolds-or-surfaces C4. *(§2.3.)*
7. Thread `runtime.sdk` into the dev-loop **+ unify the `claude`/`claude-code` id in the same PR**. *(§2.5; the id drift is a landmine if split.)*
8. Backfill betterado `CHANGELOG.md` v0.2.0 + add a changelog step to its release runbook. *(§3.1.)*
9. `release-orchestrator` + `doc-updater` + `changelog-semver` skills. *(§5; pair with #3/#4.)*

**P2 — de-betterado the defaults + harden SWAP + betterado polish**
10. Neutralise betterado strings in generic prompts; generalise the flow README + parameterise `ui:journey`. *(§2.4.)*
11. `artifactRoot`-aware demo seam + de-dup betterado demos. *(§3.2.)*
12. `live-external` demo shape; `quality_gate_cmd` single-source. *(§3.3, §3.4.)*
13. gemini/aider conformance coverage; decide KbBackend seam (wire vs scope-down). *(§2.5.)*
14. Cruft sweep: unused deps, benchmarks tsconfig, orphaned worktree, lint dumps, verify galleries, `mockups/` decision. *(§4.1–4.6.)*

**P3 — polish + hygiene**
15. Library/CLI worked example in the contract; onboarding finalisation step; known-gaps entry. *(§1.6, §2.4.)*
16. Remaining cruft (headroom.db, brain skeletons, root graphify-out, dead scaffolds, ts-prune worklist, benchmarks doc notes). *(§4.7–4.12.)*
17. betterado cosmetics + live id-1 verification + README test-count. *(§3.6, §3.8, §2.4.)*

---

## Appendix · provenance

Produced by a parallel fan-out: 6 scoped explorers (betterado · project↔engine
coupling · repo cruft · contract-as-spec · install/first-flow UX · final-loop
capability) + a completeness critic + a skill-gap explorer, over forge `7f9f33d`.
Headline P0/P1 claims (`projects.yaml` tracking, the onramp gate, the dev-loop
adapter default, the absence of any release code in orchestrator phases) were
re-verified by hand before publication.
