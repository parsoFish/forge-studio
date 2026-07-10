# Holistic review — the betterado roadmap run (2026-07-01 → 2026-07-10)

**What this is.** The full-scope retrospective of forge's largest run to date: the
24-initiative betterado roadmap (16 framework migrations, 7 new API surfaces, 1
mux-free cutover). It builds on the partial review of 2026-07-04
(`REFINEMENT-PLAN.md` as originally committed, `b855941`) and reconciles it against
the six days of run evidence that postdate it. It is the evidence base for
REFINEMENT-PLAN v2.

**Method.** Five scoped subagent audits over the primary artifacts (event logs,
queue manifests, brain themes, the friction log, the betterado repo + live ADO),
synthesized here. Full reports in [`2026-07-holistic-review/`](./2026-07-holistic-review/):

| Report | Scope | Model |
|---|---|---|
| [`cost-autopsy.md`](./2026-07-holistic-review/cost-autopsy.md) (+ [`cost-ledger.csv`](./2026-07-holistic-review/cost-ledger.csv)) | per-cycle cost from `events.jsonl`, waste re-tally, $926 reconciliation | sonnet |
| [`outcomes-ledger.md`](./2026-07-holistic-review/outcomes-ledger.md) | 24-row initiative→PR→version ledger; readiness patch items B1–H2 | sonnet |
| [`friction-reconciliation.md`](./2026-07-holistic-review/friction-reconciliation.md) | friction taxonomy; disposition of every plan item; new post-07-04 classes | opus |
| [`endstate-audit.md`](./2026-07-holistic-review/endstate-audit.md) | betterado static audit + live ADO verification | opus |
| [`reflection-triage.md`](./2026-07-holistic-review/reflection-triage.md) | 166-question backlog triage; unreflected-cycle census | sonnet |

---

## 1. Outcomes: the roadmap shipped, whole

- **24/24 initiatives merged** (PRs #43–#68, two unrelated hotfixes interleaved).
  Queue fully drained — `pending/`, `in-flight/`, `ready-for-review/`, `failed/`
  all empty.
- **Version arc:** v1.0.5 (pre-roadmap) → v1.2.0 (07-02) → v1.22.0 (07-05) →
  **v2.0.0 (07-10)**. The 2.0.0 release is genuinely cut **on origin**: signed
  GitHub Release, full GoReleaser matrix (15 platform zips + SHA256SUMS + GPG
  sig), all 4 CI gates green. (An earlier "no 2.0.0 tag" finding was a stale
  local clone — worth remembering when auditing managed projects locally.)
- **All five pre-kickoff readiness patch items landed** with direct evidence:
  B1 orphans registered in `framework_provider.go`; B2 permissions consolidated
  under `internal/service/permissions/`; B3 test-plan API shipped (PR #63, 7
  framework-native resource/DS pairs); H1 confirmed — pure framework `main.go`,
  zero SDKv2 registrations; H2 confirmed — import-only project acc test.
- **Scope integrity: 21/24 clean.** Three deltas, all recovered before the end
  of the run: dashboard-extension dropped its headline resource twice under PM
  max-turns (recovered pre-merge); serviceendpoint shipped knowingly incomplete
  and was finished *inside* mux-free-cutover; mux-free-cutover absorbed that
  work despite its manifest claiming "no resource additions".
- **Ledger hygiene defects** (forge, not betterado): the new-api-notification
  archive still says "not merged / sent back" while git shows PR #57 merged and
  tagged — archives are not refreshed after late fixes; 2 of 24 initiatives
  (pipelines-v2, test) have no reflection archive at all.

## 2. Betterado end state: release-grade except two edges

Live tier ran clean: **5/5 ADO REST GETs (HTTP 200)** across shipped surfaces
(release definition, notification subscriptions, processes, service endpoints,
projects) and **2/2 live acceptance tests passed** with no project creation.
Bonus finding: the org's ~1000 soft-deleted-project backlog has purged — 4
projects remain, so live acc capacity is fully back.

**Registry verdict: NOT usable-publishable yet**, despite the signed release and
100% docs coverage (201/201 shipped types documented). Two must-fixes, both
"cutover finished the runtime but not the edges":

1. **P0 — non-PAT auth is dead.** Framework `Configure()` reads 2 of 19
   declared auth attributes; AAD/OIDC/MSI/CLI fields are accepted and silently
   ignored; the full implementation sits orphaned in dead `provider.go`; empty
   PAT fails silently. A follow-up initiative is drafted in the end-state
   report (goal, 6 ACs, ~3–4 WIs).
2. **P1 — protocol manifest breaks every install.**
   `terraform-registry-manifest.json` declares `["5.0"]` against a
   protocol-6-only binary — Terraform's handshake fails on install. One-line
   fix + v2.0.1.

Remainder of the backlog (P2–P6): excise SDKv2 from the binary (still linked
via live helpers; ~3,113 LOC pure-dead the cutover sweep missed), migrate
SDKv2-factory acc tests, CHANGELOG release-cut hygiene (duplicate `[1.3.0]`,
no headers 1.4.0→2.0.0, `[Unreleased]` still describes the deleted mux),
7 phantom doc pages + stale README `environment{}`, org `test-acc-*` process
residue. **These are betterado work items, not forge plan items.**

## 3. Cost: the 07-04 verdict was directionally right, numerically wrong

Correct aggregation rule (validated against live `cli/metrics.ts::aggregate()`):
for phases with iteration events, sum iteration-event cost only; otherwise sum
all events including terminal `error` events. "End-events-only" — the rule the
07-04 plan implicitly trusted — still overcounts (dev-loop's phase-rollup `end`
restates the per-WI sum).

| Figure | 07-04 plan | Corrected |
|---|---|---|
| Roadmap wave (24 cycles) | — | **$1,134.57** (median $41.45, range $13.69–$92.26) |
| betterado as-of 07-04 | ≈$926 / 53 initiatives | **$1,115.85 / 54** (+20.5%; $926 most plausibly scoped to the 44 *merged* only — unconfirmed) |
| betterado program, all-time | — | $1,431.36 / 60 initiatives attempted |
| All projects, all `_logs` | — | $1,470.68 |
| Median per initiative | ≈$20 | **$41.45** (2×) |
| serviceendpoint | $59.76 | **$79.90** (validated; $59.76 unreproducible) |
| Waste | itemized ad hoc | **$228.28 conservative (20.1%)** / $517.93 broad (45.7%) |

Waste-class corrections against the plan's §1 table:

- **PM wasted attempts: undercounted 3–4×** — $30.30 across 16 of 24 cycles,
  not "~$7–10 across 5 themes".
- **Unifier restart loops: the plan conflated two things.** Crash-restart
  bursts cost ≈$0 directly (the process dies before spending); the money burns
  in *iteration* loops — a single $84.56 unifier overrun (07-05) plus $15.34.
  The fix (loop cap + gate-failed event) stands; the mechanism it interrupts is
  iteration spend, not crash spend. Pattern present in ≥6 cycles, not 2.
- **Dead-SDKv2 recurrence:** only 1 of the claimed 7 cycles is confirmable from
  cost data ($10.76, serviceendpoint) — the class is real (themes prove
  recurrence) but its dollar attribution was estimated, not measured.
- **Evidence-fabrication rework:** not quantifiable from cost events at all;
  its cost lives in rounds, not line items.

**Trend: no clean improvement inside the run.** The last wave to complete
(07-05: core, workitemtrackingprocess, taskagent) contains 3 of the 5 most
expensive cycles and 2 of the 3 highest-rework cycles. The single clean data
point is mux-free-cutover (0% rework) — N=1. The mid-run fixes (gate feedback,
contracts) show no visible step-change in cost; their value shows up in
*outcome* quality (§4's cohort comparison), not in spend. Per-initiative cost
for full API-surface migrations sits at ≈$33–40 first-pass; the 20–46% rework
band is the improvement target.

**New instrument defect surfaced by this audit:** `cli/metrics.ts` `per_skill`
and `orchestrator/run-model-derive.ts::buildNodeMeta()` (~line 145 — feeds
Studio's live phase-hex cost badges) **double/triple-count** cost.
`total_cost_usd`/`per_phase` from `aggregate()` are correct. The UI has been
overstating phase cost all along. → REFINEMENT-PLAN v2 Phase 1.

**Is "complexity is not the root" still true?** Yes — with a harder edge. The
waste is still itemizable with specific causes (knowledge-flow gap, dishonest
failure boundaries), not diffuse complexity overhead. But at a corrected 20.1%
minimum waste and a flat cost trend, the plan's "the baseline is reasonable"
framing was too comfortable: the baseline is *acceptable*; the rework band is
not, and it did not fix itself.

## 4. Friction: 8 classes; the plan survives ~83% intact

Full taxonomy + per-entry status in the friction-reconciliation report. Arcs:

| Class | Arc |
|---|---|
| A. Unifier restart/resume/loop-cap | **got worse** — no cap ever landed; $84.56 single overrun |
| B. Knowledge-flow gap / re-derivation | persisted to end *by design* — dev-loop brainReads=0 is correct (ADR-010); the PM never compiled constraints into specs |
| C. Evidence-fabrication arms race | escalated 5 rounds, then **resolved 07-05** by operator-run gate execution — honest artifacts passed every forensic gate first try |
| D. PM turn-budget/decomposition | split — proxy-tax cause fixed 07-02; genuine large-package starvation persisted |
| E. Gate false-negatives/classification lies | persisted; new sub-class weekly, incl. at the literal last cycle (07-10) |
| F. Demo-contract path/provenance | partially resolved (nonce+producibility); path SSOT still open |
| G. UI/observability | mixed — bridge cache fixed in-run; roadmap page open |
| H. Infra/lifecycle | mostly resolved **by mechanism-removal** (merge-base guard deleted, fail-loud auto-discover, env scrub) |

**Disposition of every 07-04 plan item** (G1–G10 + all phase items + skills):
**34 still-needed · 4 needs-rescope (G7, G8, 2.6, 3.1) · 2 invalidated (0.2,
6.1) · 2 adds-mechanism-where-simpler-exists (OOTB skills catalog, cost-autopsy
skill)**. Validated-by-recurrence: G3 (crash-retry recurred twice), G5 (the
classifier lie masked two more failures), G10, and above all **3.3 the
contract-compiler** — graph-identity deleted all dead files "for the first time
in 8 cycles" exactly when the WI specs named them.

**Two mandatory corrections to the plan:**

1. **Phase 6.1 is dead.** The 3 held initiatives (taskagent,
   workitemtrackingprocess, mux-free-cutover) all ran unrefined and merged.
   Its replacement already exists *in the data*: the front-loaded-contract
   cohort (gallery #66 first-pass-authentic; graph-identity; the
   completeness-annotated 30+/30+ decompositions; new-package-7wi zero gate
   failures) against the early un-annotated cohort needing 2–4 rework rounds.
   Forward validation moves to the next real roadmap — the betterado auth
   follow-up is the natural first post-refinement cycle.
2. **The plan predates the anti-fabrication resolution.** The settled answer is
   **N1 — orchestrator-owned gate execution**: the orchestrator runs the
   committed runner and hands the agent read-only artifacts. This *deletes*
   mechanism (the whole forensic-escalation ladder, mtime forensics,
   regen-clobber protections) rather than adding it. It supersedes the plan's
   entire "add forensic checks" posture and goes in at the top of Phase 2.

**New post-07-04 classes** (verdicts, delete-mechanism-first): N1 (top,
supersedes arms race), N2 nonce+producibility into the demo *contract*, N3
demo-path single-source-of-truth (recurred at the final cycle), N4
errexit-exempt gate asserts — **as a hardened template in the send-back
gate-script-body API (N8), explicitly not a lint** (a lint is a guardrail we
refuse), N6 post-merge main CI + conflict-marker check (broken main shipped
undetected for a day), N7 requeue infers resume position from worktree state
(removes an operator dance), N9 rate-limit → environment-failure classification
(stops the 5-min drain re-claiming doomed manifests forever), N10
gate-timeout ≠ work-failure (folds into the G4 cap). Resolved by N1: N5
regen-clobbers, N12 mtime-untrustworthy. Residual/authoring only: N11
zombie-ralph, N13 judge-criteria leak.

## 5. Reflection debt: cleared as part of this review

- 166 questions across 42 cycles triaged: **99 artifact-answered** with
  citations, 33 operator-genuine (2 were pseudo-questions from a parse defect).
- 8 cycles held *genuine operator answers that a buggy rerun regenerated
  questions over without consuming* — feedback-not-consumed is a real forge
  defect, now itemized.
- 10 done initiatives had **no reflection archive at all** (6 never invoked, 2
  budget-exhausted — one with a phantom `output_refs` claiming a retro that
  doesn't exist — 1 orphaned by a Studio restart, 1 hard-crashed). Reflector
  loss is silent; nothing diffs `done/` against the archive set.
- **50 reflector re-runs executed** (sequential, per-cycle explicit) as part of
  this campaign, consuming the answers and back-filling the archives.
- Four reflector-pipeline defects for v2: feedback-not-consumed reruns, phantom
  `output_refs`, H1-title-as-question parse leak, silent reflector loss (needs
  a done-vs-archive diff check — an *instrument*, not a guardrail).

**Operator-genuine questions, by topic** (full list in the triage report):
decomposition sizing (16 — largely answered in aggregate by the §4 cohort
evidence: sizing goes wrong when specs aren't compiled, and the 3.3
contract-compiler + completeness critic are the systemic answer), forge-fix
prioritisation (10 — answered by REFINEMENT-PLAN v2's top-10), 2 policy calls
that remain genuinely operator's (SDK v2.38.1→v2.40.1 bump acceptance; whether
acceptance gates should skip docs-only initiatives), 5 open-ended catch-alls.

## 6. Verdict

The run proved the thesis: a full product roadmap, decomposed and executed
autonomously, shipped whole — 24/24, release-grade, live-verified. The waste
(20–46%) and the friction log point at two roots the 07-04 plan already named
— the knowledge-flow gap and dishonest failure boundaries — plus one it
couldn't have known: honesty is cheaper to *architect in* (orchestrator-owned
gates) than to police in. The refinement direction is overwhelmingly
**deletion**: of the top-10 changes, six remove mechanism outright. Betterado
itself needs two small edges (auth wiring, protocol manifest) before the 2.0.0
release is publicly usable — the natural forward-validation cycle for the
refined forge.
