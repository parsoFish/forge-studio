# Forge Refinement Roadmap v2 — post-betterado holistic review (2026-07-10)

**Supersedes** the 2026-07-04 partial-review version (git `b855941`). Rebased on
the full-run evidence: 24/24 initiatives merged, betterado 2.0.0 cut and
live-verified, and the six days of friction the original predated. Evidence
base: [`docs/investigations/2026-07-betterado-holistic-review.md`](./docs/investigations/2026-07-betterado-holistic-review.md)
(+ the five appendix reports beside it). Disposition of every v1 item is in the
[friction-reconciliation report](./docs/investigations/2026-07-holistic-review/friction-reconciliation.md):
34 still-needed · 4 rescoped · 2 invalidated · 2 dropped as adds-mechanism.

**Lens (operator-set, unchanged):** remove guardrails over adding new ones;
tighten and simplify. Of the top-10 changes below, **six delete mechanism**.

---

## 1. The cost verdict (corrected)

Roadmap wave: **$1,134.57 / 24 initiatives** — median **$41.45** (v1 said ≈$20),
range $13.69–$92.26. betterado program all-time: $1,431.36 / 60 attempted. v1's
"$926" is unreproducible (+20.5% low; most plausibly merged-only scoping).
Waste: **$228.28 conservative (20.1%)** to $517.93 broad (45.7%) — and **no
downward trend inside the run**; the mid-run fixes improved outcome quality
(first-pass-authentic evidence), not spend.

Corrected waste classes: PM wasted attempts $30.30 across 16/24 cycles (v1
undercounted 3–4×); unifier waste burns in *iteration* loops ($84.56 single
overrun), crash-restarts cost ≈$0 directly — the cap interrupts iteration
spend; dead-SDKv2 recurrence real per themes but only $10.76 confirmable from
cost data; fabrication rework unquantifiable from cost events.

**Verdict stands, harder:** complexity is not the root. The roots are (a) the
knowledge-flow gap — the planner is the only legal carrier of brain/profile
constraints into the dev loop and doesn't compile them into WI specs — and (b)
missing honesty at failure boundaries. Both are simplification problems. The
~$33–40 first-pass cost per API-surface migration is acceptable; the 20–46%
rework band is the target.

**Protect (do not regress):** front-loaded demo contracts (gallery cycle:
first-pass-authentic evidence), iter-0 `already-complete` guard, decomposition
completeness annotation (30+/30+ type coverage), nonce+artifact binding,
**operator/orchestrator-run gate execution** (ended the fabrication arms race
at round 5 — honest artifacts then passed every forensic gate first try).

## 2. Guardrails to REMOVE (dispositions applied)

| # | Guardrail | Disposition |
|---|---|---|
| G1 | `autoCommitWorktreeIfDirty` commits dirty state on red gates | **keep-cut** — closes the scratch→branch vector; agent commits only after green |
| G2 | `NO_WORK_INDICATORS`/`WORK_HAPPENED_PATTERNS` string heuristics | **keep-cut** — superseded by `requiredPaths` + demo contract; delete |
| G3 | Identical retry of crash-before-first-tool (`tool_use_count===0`) | **keep-cut, validated** — recurred 07-03 and 07-05; escalate to cycle-restart instead |
| G4 | Unbounded unifier resume loop | **keep-cut, top item** — cap ≈3 consecutive same-gate failures → `uwi.gate-failed` event; also treat **gate-timeout ≠ work-failure** (N10) |
| G5 | Failure-classifier full-history first-match scan | **keep-cut, validated** — one stale event masked every later failure again (07-04); window to current phase/attempt |
| G6 | fanOut-forbidden-on-entry-node lint | keep (low) — definition states truth, runtime honors |
| G7 | Per-initiative architect plan-gates in a roadmap wave | **rescoped** — no false-block spam evidenced; folds into 3.2 (batched kickoff), not a standalone cut |
| G8 | `headroom_retrieve` retry spiral in PM | **rescoped** — symptom. Real cut: **pin the agent-env allowlist at the SDK seam** so host proxy wrappers never leak into phase agents (caused the ~50% early max-turns rate) |
| G9 | Hardcoded `gate='review'` for gated runs | keep (low) — derive from flow definition |
| G10 | `parallel golangci-lint` treated as terminal | **keep-cut, validated** — transient class → bounded backoff |

## 3. Phase 0 — Close-out ✅ EXECUTED (2026-07-10, this review campaign)

Done: brain themes + raw archives + profile committed; 07-04 plan baselined;
brain INDEX regenerated; 166 reflection questions triaged (99 artifact-answered,
33 operator-genuine surfaced); 50 reflector re-runs executed (back-filling 10
missing archives + consuming 8 stranded operator answers); review PRs — v1's
0.2 was already OBE (everything merged).

Operator input resolved (2026-07-10): **SDK v2.38.1→v2.40.1 bump ACCEPTED**
(ratified as-is in betterado). **Docs-only acceptance gates** — delegated
call: no orchestrator skip mechanism; fix is authoring-side (Phase 2.12).
The 5 open-ended catch-alls: closed, no action. Decomposition-sizing
questions: ignored per operator.

## 4. Phase 1 — Honest instruments

All v1 items survive; two additions from this review. One PR each:

1. **Failure-classifier windowing** — G5.
2. **Gate-node derivation** — G9.
3. **Flow-swap flicker unification** — the three compounding run-list defects
   (`forge-ui/app/flows/[id]/page.tsx` + `orchestrator/run-model.ts:224-280`).
4. **Per-WI cost attribution** — bucket `cost_usd` by `metadata.work_item_id`
   in `run-model-derive.ts`. Prerequisite for Phase-4 parallel WIs.
5. **WI dependency DAG layout** — apply existing `dep-layout.ts` topo pass to
   the WI sub-graph.
6. **Roadmap page rework** — real titles, dependency-ordered serpentine,
   eligible-to-start highlighting, manifest-derived active links.
7. **fanOut truth** — G6.
8. **NEW: cost-rollup double-count fix** — `cli/metrics.ts per_skill` and
   `run-model-derive.ts::buildNodeMeta()` double/triple-count (audit §3);
   Studio's phase-hex cost badges have overstated all along. Align to the
   correct `aggregate()` per-phase rule.
9. **NEW: reflector-loss visibility** — nothing diffs `_queue/done/` against
   the archive set; 10 initiatives silently lost reflection. A `forge brain
   lint`-style check (instrument, not guardrail).
10. **NEW: reflector question re-emission** (found by the 07-10 rerun batch —
   50/50 clean): the reflector emits its standard 4-question template on
   *every* pass, including questions already answered via `user-feedback.md`
   — so the open-question count in Studio regenerates after each rerun even
   though answers WERE consumed into archives. Fix is a reflector-skill
   prompt clause (skip questions the feedback file already answers), zero
   new mechanism. Also: one rerun mis-routed a `decision`-category theme
   into `brain/cycles/themes/` (caught by `checkCategoryScope`, moved by
   hand) — the category→brain routing rule belongs in the reflector prompt
   too, same clause.

## 5. Phase 2 — Engine honesty (orchestrator hot path)

Reordered; N1 first — it deletes the most mechanism.

1. **N1 — Orchestrator-owned gate execution for live evidence.** The
   orchestrator runs the committed runner/gates and hands agents read-only
   artifacts. Supersedes the entire forensic-escalation ladder (mtime
   forensics, regen-clobber protection = N5/N12 resolved by construction).
   The settled answer from fabrication round 5; codify it.
2. **Unifier loop cap + `uwi.gate-failed` event** — G4+N10 (top waste item:
   $84.56 + $15.34 + ≥6 affected cycles).
3. **Crash-before-first-tool → no identical retry** — G3.
4. **Transient-lint classification** — G10; plus **N9: rate-limit →
   environment-failure** (stop the drain re-claiming doomed manifests on a
   5-minute loop).
5. **Demo fan-in honesty** — re-derive diff/version at startup; validate
   liveEvidence ids every re-prep pass; **N3: demo-path single source of
   truth** (recurred at the literal last cycle).
6. **Ralph commit discipline** — G1+G2, demo contract as the deterministic
   replacement; **N2: nonce+producibility folded into the demo contract**.
7. **Send-back gate-script-body API (N8)** — reviewer send-backs carry an
   executable gate body; ship **one hardened gate template** (errexit-exempt
   `! grep` asserts fixed in the template — N4; explicitly **not a lint**).
8. **N6 — post-merge main CI + conflict-marker check** — broken main shipped
   undetected for a day.
9. **N7 — requeue infers resume position from worktree/branch state** —
   removes the operator dance and the destroy-per-WI-work failure mode.
10. **Reflector pipeline honesty** — consume-feedback-before-regenerating,
    `output_refs` must reflect actual writes (phantom retro), fix the
    H1-title-as-question parse leak.
11. **PM turn economy** — env-pin at the SDK seam (G8 rescoped),
    write-WIs-incrementally, emit partial graph near exhaustion (large-package
    starvation persisted to 07-05).
12. **Gate-fit for docs-only initiatives** (operator-delegated call, 07-10):
    no skip flag in the orchestrator. Architect/PM authoring clause — gates
    must match the deliverable type (docs-only → build/link-check/render
    gates, never demo/test-evidence gates). Prompt-level, zero mechanism.

## 6. Phase 3 — Design-phase consolidation

**Update ADRs first.** One change from v1: **3.3 leads; 3.1 waits for its
evidence.**

1. **Contract-compiler stage (was 3.3) — the proven, highest-leverage change.**
   Decomposition compiles profile + brain constraints into every WI body:
   file-deletion lists (graph-identity deleted all 4,423 dead lines "for the
   first time in 8 cycles" when specs named them), deregistration checklists,
   API-shape/fixture rules, sizing ≤4–5 resources/WI, per-WI
   provider-registration serialization. The `framework-migration-checklist`
   theme is the template. Ship as `wi-spec-compiler` skill.
2. **Plan-everything-before-kickoff** (was 3.2, +G7): decompose all initiatives
   up front; one roadmap-level PLAN gate; batched dependency-eligible kickoff
   from the roadmap page.
3. **Completeness critic at FINALIZE** (was 3.4, validated — the completeness
   annotation forced full 30-type coverage; PR #47 caught the gap it exists to
   catch). Ship as `architect-completeness-critic` skill.
4. **One design agent** (was 3.1) — **rescoped: after 1–3 land.** Collapsing
   architect+PM is justified only once the compiled-spec pipeline proves out;
   don't restructure agents on the same evidence that fixes their contract.
   Roster hygiene stands: cull the unwired `code-reviewer`, place
   `release-finalizer` deliberately.
5. **Architect page redesign** (low) — current UI patterns; file/image inputs.

## 7. Phase 4 — Ralph conformance + parallel work items

Conformance rows (updated): no-commit-on-red → Phase 2.6; gate-failure
re-injection → verify the live-gate-feedback fix end-to-end (the 07-10
demo-path false-negative says the loop isn't closed); spec lint → ship
`ralph-spec-lint` **inside the decomposition stage** (planner-side check, not a
runtime guardrail); distinct git identity — cheap, do it; sandbox for
unattended runs — top of `docs/known-gaps.md`, own workstream; iteration cap ✅
keep as financial governor.

**Parallel WI execution** unchanged in substance: per-WI worktrees, ready-layer
dispatch replacing the serial loop in `developer-loop.ts`, concurrency-safe
`wiOutcomes`. Sequenced after Phase 1.4 (per-WI cost) + Phase 3.1
(trustworthy specs).

## 8. Phase 5 — Platform pillars + skills (pruned)

- KB pillar: **seed a project KB on new-project creation** (kept).
- OOTB skills catalog: **deferred — adds-mechanism** without demonstrated pull;
  revisit when a second managed project demands it.
- Skills, consolidated (v1's six → four): `wi-spec-compiler` (Phase 3),
  `architect-completeness-critic` (Phase 3), `ralph-spec-lint` (Phase 4,
  planner-side), `project-scoped-review` (Phase 6 — codifies what this
  review's end-state audit did by hand). Cut: `reflection-triage` (backlog
  cleared; Phase 2.10 fixes the defects that created it) and `cost-autopsy`
  (a review-time analysis, not a standing skill — this campaign ran it from a
  prompt; the ledger method is documented in the audit report).

## 9. Phase 6 — Validation (rebuilt)

1. **Retrospective A/B — already in evidence, documented** (review §4): the
   front-loaded-contract cohort (gallery #66 first-pass-authentic,
   graph-identity, 30+/30+ completeness, new-package-7wi zero gate failures)
   vs the early cohort's 2–4 rework rounds. This is the baseline against which
   post-refinement cycles are judged.
2. **Forward validation: the betterado auth initiative** — P0 from the
   [end-state audit](./docs/investigations/2026-07-holistic-review/endstate-audit.md)
   (wire non-PAT auth into framework `Configure()`; drafted with ACs, ~3–4
   WIs). First post-refinement real cycle. P1 (protocol manifest `["6.0"]` +
   v2.0.1) rides along — betterado is not publicly usable until both land.
3. **Standing harnesses:** `verify:cycle` (mdtoc routine tier) + `ui:journey`
   after each phase merge.

The rest of the betterado backlog (P2–P6: SDKv2 excision from the binary, acc
test factory migration, CHANGELOG hygiene, doc phantoms, org residue) is
project work, tracked in the end-state audit — **not forge plan items**.

## 10. Sequencing

```
Phase 0 (close-out)        — ✅ done 2026-07-10 (this campaign)
Phase 1 (instruments)      — 9 small PRs, independent, parallelizable
Phase 2 (engine honesty)   — N1 first; after/alongside Phase 1
Phase 3 (design consol.)   — ADRs first; 3.1 (contract-compiler) leads; agent-collapse last
Phase 4 (ralph + parallel) — needs 1.4 + 3.1
Phase 5 (pillars + skills) — skills land with their consuming phase
Phase 6 (validation)       — betterado auth cycle vs the §9.1 baseline
```

Fix instruments before engine, simplify before restructuring, validate on real
cycles. Six of the top-10 changes are deletions; keep it that way.
