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

### 1. M4 flow edit-lock false-negative (latent) — resolved 2026-07-17 (S8/DEC-3)

The M4 flow edit-lock produces false-negatives for flows **other than the seeded
cycle flows** until the run-model stamps the real `flowId` (`orchestrator/run-model.ts`
`FLOW_ID`). **Latent** — the lock is fully effective for the shipped seed flows
(`forge-architect`/`forge-develop`/`forge-reflect`); it surfaces only when a second,
operator-authored flow is actually run.

**Struck 2026-07-17 (R5-07-F1):** fixed by S8/DEC-3 — the forge-cycle default
flow id was retired, and every manifest writer (`orchestrator/manifest.ts`,
`flow-runner.ts`, `architect-runner.ts`, `enqueue-develop-run.ts`) now requires
a real `flow_id`; `run-model.ts`'s `FALLBACK_FLOW_ID = 'unknown'` applies only
to pre-S8 manifests, never to a live operator-authored flow. Verification
test: **R5-04-F1** (`docs/roadmaps/R5-hardening-operability.md`).

### 2. Architect hex shows `$0.00` cost — correct out-of-cycle accounting, not a gap (clarified 2026-07-16)

The architect phase hex legitimately renders `$0.00`. Real cycles meter the
architect turn entirely **out-of-cycle** — only its wall-clock duration is
metered in-cycle — confirmed against the archived cycle corpus, e.g.
`_queue/done/INIT-2026-07-11-cli-sort-flag.md` (`architect_cost_usd: 0`,
`architect_duration_ms: 239486`). The 2026-07-16 journey rebuild
(`scripts/journeys/flows-run.mjs`) asserts this directly: on the
`/flows/forge-architect` slice the architect hex is asserted at
`data-status="complete"` (**not** `data-phase-cost-usd > 0` — that assertion
was removed because it no longer matched reality), while the PM hex on the
same slice is only asserted *present*, not on its cost. Cost `> 0` is
correctly asserted where it really does accrue in-cycle: the develop-flow
phase hexes (`/flows/forge-develop`) and the gated engine run
(`expectPhaseCost` calls in `flows-run.mjs`). This is not a forge defect —
the entry is kept only as a correction against its own prior wording, which
incorrectly framed `$0.00` as an "observability gap" and claimed the harness
asserted cost `> 0` on the architect hex itself; neither was accurate.

### 3. brain-ingest haiku R1 A/B follow-up

`brain-ingest` was flipped sonnet→haiku (model-tier economy). The flip is
shipped but its **theme-quality regression check (R1) is unrun**. Validate via a
**standalone** brain-ingest A/B — sonnet vs haiku on one archived cycle under
`brain/_raw/cycles/`, theme diff + Opus/operator sign-off — the next time
brain-ingest is invoked manually. This is **not** a `verify:cycle`.

### 4. Post-Phase-5 refinement follow-ups (2026-07-12)

Non-blocking items left open when refinement Phases 3–5 closed to main at 0.5.0
(the deterministic cores shipped; these are the deferred long-tails):

1. **wi-spec-compiler LLM assist pass** (ADR 037 item 3) — the deterministic
   core is live; the sonnet judgment skill is unbuilt.
2. **Raise `FORGE_DEV_WI_CONCURRENCY` default** (from 1) after a multi-cycle
   soak proves the concurrent dispatcher stable (Phase 4 step 10).
3. **Wave-3 KB-seam loose ends:** `forge-onboard-project` skill doesn't mention
   `kb.yaml`; a legacy local `<artifactRoot>/brain/profile.md` stub is still
   written beside the central seed (superfluous post-seam); `forge brain index
   --write` still walks the pre-ADR-035 LOCAL project-brain layout (seeded
   projects invisible to `INDEX.md`) — *resolved 2026-07-17 (R5-07-F1):* PR #26
   (`464eabd`) walks the ADR-035 central `brain/projects/` layout instead; new
   projects get no `kb` binding in `project.json` (ContractReadiness shows
   unbound).
4. **Architect+PM collapse** (§6 item 4) — still deferred per plan; needs
   post-refinement cycle evidence before committing. — *superseded 2026-07-17
   (R5-07-F6):* this question (collapse architect+PM into one phase) is
   superseded by the **Q2-B architect/plan split** (`docs/roadmaps/README.md`
   §1; `docs/roadmaps/R4-ootb-suite.md` R4-04) — the roadmap direction adds a
   **new plan agent alongside** the architect rather than collapsing the two;
   architect-flow retirement is a separate, deferred future initiative
   (R4-D1).
5. **Watch SIGKILL mystery** — 4 occurrences mid-dev-loop, suspected WSL2
   memory pressure; self-heal absorbs it, not root-caused.
6. **PM never populates a WI `domain` field** — constraint selectors currently
   match `manifest.<field>` globs or `all` only (ADR 037 as-built note).
7. **e2e-journey cleanup gap** — *resolved 2026-07-14:* `cleanFirstProject` now
   also removes the onboarding-seeded `brain/projects/<slug>/` Brain-3 KB (the demo
   overhaul's onboard beats seed it via `seedProjectBrain`). (Any leftover raw
   cycle archive would come from a real cycle, not the emulated journey — see item 10.)
8. **Untracked `demos/verify/<handle>/` gate artifacts**
   (summaries + videos) — decide keep/commit/clean (currently absent; tree was
   clean at close).
9. **e2e-journey demo overhaul — deferred tails (2026-07-14) — *resolved 2026-07-16:***
   - The **demo-builder** flow (`/demo/[sessionId]`, per-element regeneration) is
     now in the journey set: `scripts/journeys/demo-builder.mjs` covers brief →
     generate → lock in 3 beats, plus a tracked
     `demos/e2e/clips/demo-generate.webm` long-tail clip.
   - The **`CLAUDE.md` "forge-ui DOM-as-metrics convention" section** has been
     reconciled against the live `forge-ui/` tree (this pass, S5) — every stale
     `/dashboard`-era attribute (`data-conn-state`, `data-phase-hex`, `data-wi-hex`,
     `agent-graph`, `pipeline-tree`, `scheduler-banner`, `data-cost-badge`,
     `data-page="architect-session"`, `escalation-id` — all confirmed **0
     occurrences** in `forge-ui/`) is gone, replaced by a per-route inventory
     (library, `/flows/[id]`, `/artifact`, `/agents/[id]`, `/projects[/id]`,
     `/architect/new` + `/interview`, `/instructions/[sid]`, `/project-brain/[sid]`,
     `/demo/[sid]`, `/knowledge[/new]`, `/recovery`, `/skills`) plus the shared
     status vocabularies (`WiStatus`, `PhaseStatus`, `RunStatus`, roadmap status,
     `HexKind`), and the harness paragraph rewritten for the 11-journey model.
10. **`ui:journey` can trigger a REAL cycle if a scheduler is active (harness-isolation
    hazard, 2026-07-14)** — *resolved 2026-07-16:* the walkthrough seeds queue
    manifests (`pending`/`in-flight`) to emulate a cycle. If a **`forge serve`
    scheduler/daemon is running concurrently** (`FORGE_ARCHITECT_NO_SPAWN=1` does NOT
    stop the daemon — it only guards architect/reflector spawns), it could **claim a
    seeded manifest, run a real cycle to release-finalize, and commit**
    (`chore(release): finalise …`) onto the working branch — observed twice (a stray
    forge `0.5.1` + an mdtoc `0.1.1` release; both untangled by hand). A second,
    related residue defect was found alongside it: the emulated approve→merge beat
    runs the **real, deterministic** release-finalize path against `projects/mdtoc`
    (tracked *inside* the forge repo, no nested `.git`), which leaves
    `projects/mdtoc/{CHANGELOG.md,package.json,package-lock.json}` modified **and
    staged** in the forge index after every green run — with a live scheduler this
    escalates to an actual commit+push.
    **Fix:** `scripts/lib/journey-daemon-guard.mjs` (`assertNoLiveDaemon`) runs as the
    first statement in `main()`, before any cleanup or seeding — it refuses to
    proceed if `_logs/daemon/forge.pid` names a live pid, or if `_queue/{pending,
    in-flight}` already has stray manifest(s) sitting in it. Set
    `FORGE_E2E_AUTOKILL_DAEMON=1` to have the guard `SIGTERM` a live daemon instead of
    refusing (escape hatch for scripted/CI runs, not the default). The `finally`
    cleanup block in `e2e-journey.mjs` now also `git restore --staged` +
    `git checkout --` the `projects/<PROJECT>` subtree after every run, so the
    release-finalize residue doesn't linger in the working tree (best-effort,
    non-fatal like the other cleanups).
    **Recurrence + second trigger path (2026-07-16):** with NO daemon alive, the
    walkthrough's real `approve-and-merge` click hit the bridge's verdict-approve
    handler, whose `runReleaseFinalize` call is an **in-process SDK agent turn**
    (`cli/ui-bridge.ts` wiring; `cli/bridge-studio-runs.ts` approve branch) —
    structurally outside `FORGE_ARCHITECT_NO_SPAWN`, which only guards `spawn()`
    sites. A real finalizer ran ($0.58), and because the seeded `worktree_path`
    was a plain dir inside the forge repo, its git ops bubbled up to forge's own
    `.git` and **committed + pushed** a stray `chore(release): finalise 0.5.1`
    (reverted). **Harness fix:** the run now (a) strips `releaseProcess` from the
    grounding project's `.forge/project.json` for the run's duration (finalize
    exits at its `hasReleaseProcess` opt-in gate before any SDK call; restored
    verbatim in cleanup), and (b) `git init`s the seeded review worktree as a
    standalone no-remote sandbox so residual `git`/`gh` ops cannot escape.
    **Open platform hardening (needs a future code change, out of the cleanup
    campaign's scope):** the bridge exposes three real-agent trigger surfaces no
    env guard covers — the in-process `runReleaseFinalize` in verdict-approve
    (plus the real `gh pr merge` beside it), `spawnBrainFix`
    (`cli/bridge-studio-kbs.ts`, KB lint-resolution route), and
    `POST /api/scheduler/start` (boots the real daemon). A harness-mode seam
    (extend the `FORGE_ARCHITECT_NO_SPAWN` contract to ALL real-agent/real-git
    paths, or a first-class `FORGE_DRY_BRIDGE=1`) is the proper fix.
11. **UI-created skills are invisible to the agent builder's palette (2026-07-17,
    found by the S5b demo rebuild):** `CatalogPalette` sources skill chips
    exclusively from `studio/catalog.yaml`'s static `community-skills` list, and
    `POST /api/studio/skills` (the `/skills/new` builder) never registers the new
    skill into `catalog.yaml` — so a skill an operator just authored cannot be
    dragged into an agent's skill drop-zone. This broke the demo's intended
    artifact throughline (create a skill → compose it into an agent); the journey
    substitutes the catalog-listed `handoff` skill and narrates the limitation
    honestly. **Fix candidates:** the skills builder registers into
    `catalog.yaml` on create, or the palette unions catalog entries with live
    `skills/*/SKILL.md` discovery.

### 4b. Demo/UI-journey refinement backlog — operator review of PR #24 (2026-07-17)

> The operator closed PR #24 (the clips-first S5 rebuild) with these notes recorded
> for later refinement. Sync mechanism: the `journey-sync` skill
> (`.claude/skills/journey-sync/`) + the CLAUDE.md DOM-convention rule now make
> journey maintenance part of every UI-touching change.

**Platform / product features (need design, future sessions):**

1. **Skills need first-class management.** The skill-create surface exposed that
   there is no clear way to view the skill library, no consistent entry point for
   creating skills, and skills should break out into their own library item.
   (Operator will detail their view in a future session; pairs with item 11 above —
   UI-created skills invisible to the catalog palette.)
2. **Create-KB must mandate a scope at creation** — without one the KB can't know
   what information to seed on or how it should generate new information over time.
3. **KB scoping model rework.** The "cycles" (forge-cycle) brain is likely a scope
   that no longer makes sense. The clearer delineation: `forge-dev` stays unique
   (it sits outside forge's operational cycles); every OTHER KB should be linked to
   either a specific FLOW or a specific PROJECT. This also sharpens what item 2's
   mandatory scope means.
4. **Recovery tab: candidate for full removal** — fold stuck-cycle recovery into
   the roadmap surface instead of a standalone tab.
5. **Flow artifact-set cleanup.** The artifacts generated through a flow are messy;
   now the componentry is implemented, reduce the artifact possibilities and
   solidify what gets presented.

**Demo/clip refinements (next demo pass):**

6. **Mouse visibility**: show a cursor or highlight click events in clips; ensure
   all typing appears progressively (no instant fills) across every clip.
7. **Advanced options must always be showcased** in clips wherever a surface has them.
8. **skill-edit clip doesn't show a skill being edited** — it shows the
   build-an-agent page (a symptom of feature 1: no skill-editing surface exists).
9. **pbrain-generate clip goes static** once it reaches the build-project-brain
   screen and never shows a seeded brain (the static frames do show it).
10. **Sticky-header artifacts in full-page screenshots** — header bars/UI elements
    shift into the middle of several frames (example:
    `demos/e2e/frames/24-a4-1-project-dirty.png`). Likely `fullPage` capture vs
    sticky positioning; needs a capture-time fix (scroll-to-top or header unstick).
11. **Deeper text descriptions in the gallery** per demoed item — the combination
    of text + images + video should make it obvious to any agent working on forge
    what should be shown, the story beats, and when video/images drift out of sync
    with the text description of the functionality. (The gallery narrations are the
    seed of this; expand into per-item functional descriptions.)
12. **Add a clip of the first run through my-first-flow.**
13. **run-plan-gate's PLAN.html is dated** — it doesn't match the plans recent real
    forge cycles produce (the initiative breakdown shown to the user). Re-ground
    the seeded PLAN.html on a recent real architect session.
14. **hex-detail frames show nothing happening** (no logs in the drawer). Good clip
    candidate: the phase drawer with realistic log lines streaming.
15. **The review-section demo evidence is hand-crafted and dated** — re-sync the
    seeded demo comparison to an actual demo artifact from the betterado cycles.

### 5. betterado framework-auth-parity + protocol-manifest release (P0/P1 — carried from the retired REFINEMENT-PLAN)

> Project work on `terraform-provider-betterado`, tracked here because it is the
> forward-validation cycle the refinement roadmap pointed at — not a forge change.
> The full drafted brief (ACs + WI split) lives in git history at
> `docs/investigations/2026-07-holistic-review/auth-initiative-brief.md` +
> `endstate-audit.md` §4–§5 (removed in the S2 cruft purge).

- **P0 — framework auth parity.** The pure-plugin-framework provider's `Configure()`
  is **PAT-only**; the 17 advertised AAD/OIDC/MSI/CLI auth attributes are silently
  ignored, and the working `aztfauth` credential resolution is stranded in the
  deleted-from-service SDKv2 `provider.go:GetAuthProvider`. Port that resolution into
  a framework-native path callable from `framework_provider.go:Configure()`, read all
  17 attributes (not the current 2), preserve the `AZDO_*` env fallbacks, and replace
  the silent `return` on missing PAT with a fail-fast Configure diagnostic. ~3–4 WIs.
  Live proof (cheapest): a read/import acc test passes with PAT unset + `use_cli`; must
  NOT create a project. betterado 2.0.0 is not publicly usable until this lands.
- **P1 (rides along).** `terraform-registry-manifest.json` `protocol_versions`
  `["5.0"]`→`["6.0"]`; cut **v2.0.1**; `terraform init` against the release binary
  completes the handshake.
- The rest of the betterado backlog (P2–P6: SDKv2 excision from the binary, acc-test
  factory migration, CHANGELOG hygiene, doc phantoms, ADO org residue) is project work
  tracked in the git-preserved end-state audit — **not forge plan items**.

### 6. `skills/` physical role-subfolder move — deferred (2026-07-13, campaign S4)

The production-repo cleanup considered physically splitting `skills/` into
`skills/cycle|system|project/`. **Deferred — the physical move is not a clean change,
and the legibility goal it served is already met without it.**

- **Blast radius:** ~35 `.ts`/`.mjs` files hardcode literal skill paths
  (`deriveAgentSpec('skills/<name>/SKILL.md')`, `resolve(FORGE_ROOT,'skills',<name>,'SKILL.md')`)
  — each phase runner resolves its own skill by a hardcoded string, with **no shared
  resolver** to change in one place. `orchestrator/studio/registry.ts:listAgentDefinitions`
  additionally requires skills as **flat** direct children (`readdirSync(skillsDir)` +
  `join(skillsDir, entry, 'SKILL.md')`), so the move also needs a real discovery-behaviour
  change on the hot path.
- **No clean split criterion:** the `library` frontmatter flag (the intended
  cycle=`true` / system=`false` divider) is set on only 7 of 24 skills (1 `true`, 6
  `false`, 17 unset) — the three-way role split has no mechanical rule today.
- **Legibility already delivered without moving:** `skills/README.md` groups all 24 by
  role (S1), and the scope READMEs + `docs/repo-map.md` (S3) place `skills/` in Scope 2.

**Revisit only after introducing a single shared skill-path resolver** (e.g. a
`skillPath(name)` helper every runner + `registry.ts` route through). Once resolution is
centralised, the physical move becomes a one-place change that can ride the full gate +
`ui:journey` safely. Until then the flat layout + roles-table is the simplest thing that
works — moving 35 hot-path files for a cosmetic reorg would grow the capped orchestrator
surface and risk a skill mis-pathing that only surfaces at real-cycle time.

### 7. Dry-bridge seam (R5-01) whole-branch-review follow-up tail (2026-07-17)

R5-01 shipped (roadmap R5-B8); a multi-lens adversarial whole-branch review +
security review confirmed no Critical/High and landed the must-fixes, routing a
cheap-but-real residue tail here. Each owned by a roadmap ID; the roadmap entry
is authoritative for how/when.

- **`isDryBridge` silently false for near-miss values** (`FORGE_DRY_BRIDGE=true|yes|"1 "`
  all read as OFF, running every real-acting route live). One-time stderr warning /
  event in `startBridge` when the var is set non-empty but `!== '1'`. `cli/dry-bridge.ts`. *(R5)*
- **`post-run-boundary` porcelain parsing** mishandles git-quoted paths and `' -> '`
  rename separators — fails in the safe direction (false violation) but a non-ASCII/space
  filename under an exempted prefix would spuriously red every run. Switch capture to
  `git status --porcelain -z` (NUL-split) + a quoted-path test. `scripts/lib/post-run-boundary.mjs`. *(R7)*
- **Boundary check fires outside any beat** → dropped from `demos/e2e/results.json` and the
  gallery (exit-code contract still holds, but the tracked artifact reads all-green on a
  boundary violation, against the every-check-traces-to-a-beat rule). Route it through a
  synthetic epilogue beat. `scripts/lib/journey-runtime.mjs` / `scripts/e2e-journey.mjs`. *(R7)*
- **`defaultGhPrList` spawnSync has no timeout** — a network-hung `gh` freezes the harness
  synchronously at baseline capture. Add `timeout: 30_000` + route the error through the
  existing null-degrade path. `scripts/lib/post-run-boundary.mjs`. *(R5)*
- **exempt-local enqueue + pre-existing live daemon = real cycle under dry mode** — a
  manifest written by a `FORGE_DRY_BRIDGE=1` bridge becomes a real cycle in the hands of a
  daemon started outside the bridge (only `ui:journey`'s `assertNoLiveDaemon` covers it
  today). Extend the exempt-local rows' reason strings to state the caveat; optionally
  advise/refuse when `daemonState` reports live under dry mode. `cli/dry-bridge.ts`. *(R5)*
- **Drift-guard scanner precision limits** — two-value gates collapse to method `'*'`
  (matching any table method), `MATCH_ASSIGN_RE` requires inline regex literals,
  DELETE-encoded-as-`POST … (delete)`. A legit refactor (named regex constant, braced
  gate, arrow handler) either reds with a misleading "stale table entry?" message or
  silently loosens matching. Document all shapes in the known-limits header; extend the
  direction-2 offender message to name scanner-shape breakage. `cli/dry-bridge-coverage.test.ts`. *(R7)*
- **Manifest `cycle_id` unvalidated → `createLogger` path resolution** (pre-existing root
  cause, not a regression; this branch added one more call site exercising it). A
  maliciously-crafted `cycle_id` (`../`) would write logs outside `ctx.logsRoot`; today's
  exploitability is low (manifests are forge-authored). Add a `cycle_id` format check to
  `validateManifest()` mirroring `INITIATIVE_ID_PATTERN`. `orchestrator/manifest.ts`. *(R5)*
  **Update (R2-01-F1, 2026-07-18):** `orchestrator/run-agent.ts`'s `runAgent` — a new
  `createLogger` call site whose trust boundary widens as F4/R2-04 wire less-trusted
  callers — now validates `ctx.runId` against a safe-single-path-segment regex and throws
  before any I/O, closing this gap for that one call site (fixture-tested in
  `run-agent.test.ts`). The manifest-driven `cycle_id` path above remains open.
- **F3 boundary check fires outside any beat → absent from `demos/e2e/results.json`**
  (2026-07-18). The post-run boundary `check()` runs in the runner's `finally`, not inside a
  beat, so `journey-runtime.mjs` logs `onCheck fired with no active beat` and drops it from
  the tracked results/gallery — though it *does* drive the non-zero exit correctly. Route it
  through a synthetic epilogue beat so a real boundary violation traces to a named check like
  every other. `scripts/lib/journey-runtime.mjs` / `scripts/e2e-journey.mjs`. *(R7)*
- **Operational constraint — do NOT perform remote PR/git operations during a `ui:journey`
  run** (2026-07-18). F3's boundary check compares *global* open-PR state before/after the
  run, so merging/closing any PR (even an unrelated one) mid-run trips a `pr-state-changed`
  violation and reds the journey. Same discipline class as "never run against a live daemon"
  / "commit before running." Not a code bug — the check is working as designed; document in
  the harness runbook and consider narrowing the PR check to only PRs the harness could have
  acted on if the false-positive proves annoying in practice. *(R6/R7)*

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
