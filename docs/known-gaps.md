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

The M4 flow edit-lock produces false-negatives for flows **other than the seeded
cycle flows** until the run-model stamps the real `flowId` (`orchestrator/run-model.ts`
`FLOW_ID`). **Latent** — the lock is fully effective for the shipped seed flows
(`forge-architect`/`forge-develop`/`forge-reflect`); it surfaces only when a second,
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
   projects invisible to `INDEX.md`); new projects get no `kb` binding in
   `project.json` (ContractReadiness shows unbound).
4. **Architect+PM collapse** (§6 item 4) — still deferred per plan; needs
   post-refinement cycle evidence before committing.
5. **Watch SIGKILL mystery** — 4 occurrences mid-dev-loop, suspected WSL2
   memory pressure; self-heal absorbs it, not root-caused.
6. **PM never populates a WI `domain` field** — constraint selectors currently
   match `manifest.<field>` globs or `all` only (ADR 037 as-built note).
7. **e2e-journey cleanup gap:** the creation-seam KB seed writes
   `brain/projects/<journey-demo-project>/` + a raw cycle archive during the
   AUTHOR section, and the harness cleanup sweep doesn't remove either (one
   seeded brain dir + one raw archive were left behind this session, removed by
   hand). Add both to the sweep.
8. **Untracked `forge-ui/.demo-shots/verify/<handle>/` gate artifacts**
   (summaries + videos) — decide keep/commit/clean (currently absent; tree was
   clean at close).

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
