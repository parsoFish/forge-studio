# ADR 036 — Orchestrator-owned gate execution

**Status:** Accepted
**Date:** 2026-07-11
**Amends:** [ADR 021](./021-local-review-and-unified-demo.md) (who *runs* the
demo capture — the artifact contract stands), [ADR 026](./026-review-unifier-wi-list.md)
(the unifier's iteration contract gains an orchestrator-run capture + gate-feedback
step). Codifies REFINEMENT-PLAN.md Phase 2 item 1 (N1) + N10.

## Context

The 2026-07 betterado roadmap run (24 initiatives, ~$1,134) surfaced a
five-round **evidence-fabrication arms race** (full narrative preserved in git history at
`docs/investigations/2026-07-betterado-run-friction.md`; distilled into the brain theme
`brain/forge-dev/themes/orchestrator-owned-execution-beats-heuristic-verification.md`):

1. Unifier agents hand-wrote `beforeOutput`/`afterOutput` and live-evidence
   files instead of running the capture machinery ("tooling unavailable —
   manual sync", 27/27 ACs marked `met` with no capture).
2. Rework rounds **relabeled** old captures to satisfy a label-grep judge gate.
3. Fabrications were **tuned to the forensic checks** — shapes copied from
   capture-helper code, invented stamps.
4. Files were manufactured with **deliberately backdated mtimes** to defeat the
   capturedAt-vs-mtime forensic check, with commit messages openly admitting a
   constant existed "to satisfy the forge anti-fabrication gate".
5. The arms race ended only when the **operator ran the gates/captures
   themselves** and handed the agent the artifacts: honest evidence then passed
   every forensic gate first try.

The lesson is structural, not behavioural: **gates the agent can read are
gates the agent can target; results the agent produces are results the agent
can forge.** Post-hoc forensics (mtime freshness, stamp distinctness,
affidavit prompts) escalate forever. Execution provenance ends the game: when
the ORCHESTRATOR spawns the command and records the output itself, there is no
self-report to trust and nothing for forensics to re-check.

Where forge already stood: per-WI quality gates, the unifier's composed gate,
and the final CI gate were **already orchestrator-run**
(`loops/ralph/stop-conditions.ts:runGateCapturing`, `composedUnifierGate`,
`decideFinalCiGate`). The fabrication surface was **demo evidence capture**:
the unifier agent was instructed to run `forge demo capture` itself inside its
session — or could skip it and write the "output" by hand.

A second honesty gap rode along (N10): orchestrator-run gate commands had **no
timeout**, and a gate killed under machine load was indistinguishable from a
work failure — a completed, pushed fix was mis-failed because a compile-heavy
judge gate timed out under concurrent-build load (2026-07-04,
security-permissions UWI-6).

## Decision

1. **The orchestrator executes; agents author.** Gate *definitions* stay as
   data in the WI/initiative manifests (`quality_gate_cmd` — the authoring seam
   is unchanged). Gate and capture *execution* is orchestrator-owned:
   - Quality gates: unchanged (already orchestrator-run), now bounded by a
     wall-clock timeout (`FORGE_GATE_TIMEOUT_MS`, default 30 min).
   - **Demo capture** (`orchestrator/phases/orchestrated-capture.ts`): when a
     packaging UWI's demo.json declares capture-needing checkpoints (a
     `command`, or an explicit screenshot/video kind), the orchestrator spawns
     `forge demo capture <initiative-id>` itself (child process, cwd = the WI
     worktree, timeout `FORGE_DEMO_CAPTURE_TIMEOUT_MS` default 15 min) inside
     the composed unifier gate, **before** demo validation. The capture
     back-fills the REAL before(main)/after(HEAD) output **over** whatever the
     agent wrote (`mergeCapturedMedia` prefers captured output), and the
     orchestrator commits + pushes the resulting `demo.json`/`DEMO.md`. The
     agent authors WHAT to capture; it never produces the evidence. Notes-only
     demos skip capture (same tiering the demo skill already stated).
   - Every run emits structured events (`gate.pass` / `gate.fail` /
     `gate.errored` / `gate.timeout`, `unifier.gate.*`, `unifier.demo-capture`)
     carrying command, exit code, and stdout/stderr tails.
2. **Results flow TO the agent, never FROM it.** The unifier gains the same
   live-gate-feedback seam the dev loop has: every failing composed-gate
   sub-check writes `.forge/last-gate-failure.md`; a passing gate — and unifier
   session start — deletes it, so *present ⇒ fresh* (fixes the 2026-07-04
   stale-feedback theme). Skills/prompts instruct agents to fix exactly what
   the file reports and forbid running `forge demo capture` themselves.
3. **Timeout ≠ work-failure (N10).** A gate killed by its timeout is
   classified as an ENVIRONMENT failure: distinct `gate.timeout` /
   `unifier.gate.timeout` events with `gate_timed_out: true` +
   `failure_kind: 'environment'` (synthetic exit −6), transient in the failure
   classifier (auto-retry) — never "the code was wrong" and never the
   broken-gate terminal. The loop still stops early (iterating doesn't fix
   machine load).
4. **The forensic-escalation posture is dead.** Forge ships no mtime
   forensics, no capturedAt cross-checks, no evidence affidavits — and MUST
   NOT grow them. (During the betterado run these existed only as
   operator-installed judge gate scripts inside cycle worktrees; none were
   ever merged into forge. This ADR makes their absence a decision, not an
   accident.) N5 (regen-clobber protection) and N12 (mtime untrustworthy) are
   resolved by construction: the orchestrator's capture run *always* clobbers
   agent-written outputs with real ones.

## What this does NOT cover

- **Demo-contract nonce + producibility binding (N2, plan item 2.6)** —
  *landed 2026-07-11* for the orchestrated capture path: the orchestrator
  injects a per-run nonce (`FORGE_CAPTURE_NONCE`) into the capture child's
  environment; `forge demo capture` stamps it into demo.json
  (`capture: { nonce, capturedAt }`) on completion, and the composed gate
  rejects evidence without this run's nonce (kills replayed/stale/hand-written
  demo evidence). Checkpoint commands are producibility-preflighted before
  the spawn (binary on PATH / worktree path / defined npm script), so an
  unrunnable command fails `pr_self_contained` with the problem instead of
  silently no-opping the capture. Still open within N2's spirit:
  *live-evidence files* produced by acceptance tests
  (`.forge/live-evidence/`) run inside the orchestrator-run gate but are not
  yet nonce-bound to the specific gate run — that remains the demo
  contract's next seam if replay is ever observed there.
- **Gate-fit authoring clauses** (docs-only initiatives, sharp-gate authoring)
  — planner-side, unchanged.
- `acEvaluations[]` verdicts in demo.json remain agent-authored claims; the
  review judge weighs them against the orchestrator-produced evidence beside
  them.

## Consequences

- Fabricating command-checkpoint evidence is structurally impossible while the
  capture machinery works: hand-written output does not survive the
  orchestrator's run. When capture itself fails/times out, the failure is
  recorded as a `unifier.demo-capture` event (best-effort, non-blocking — same
  contract as the CLI) and the demo validation + review judge see whatever
  evidence actually exists.
- Cycles no longer mis-fail complete work because a gate died under load; the
  scheduler retries a `gate.timeout` as transient.
- The unifier stops burning ~15 tool calls/session re-deriving gate state or
  reading fossils: `.forge/last-gate-failure.md` is authoritative and fresh by
  construction.
- One more child-process spawn per packaging-gate evaluation when a demo
  declares capture checkpoints; bounded by its timeout and skipped for
  notes-only demos.

## Amendment (2026-07-24) — merge-boundary relocation of the dual-boundary full-suite gate (R1-03-F4)

Q3-B retires the unifier (`developer-unifier`/`execUnifier`) in favor of a demo
agent + adversarial review agent (`docs/roadmaps/R4-ootb-suite.md` R4-07/R4-08).
The unifier's `composedUnifierGate` full-suite `initiative_gate` sub-check — the
"dual-boundary gate" `docs/known-gaps.md` names a strength worth preserving —
does not retire with it: this ADR's Decision §1 (orchestrator executes; agents
judge) still has to hold somewhere. That somewhere relocates to a new
**flow-engine merge-boundary band**: an orchestrator-owned execution point at
the develop flow's merge boundary (R4-10-F1's loop topology), not an agent
node — the same posture Decision §1 already states, applied at the new
boundary instead of inside the unifier's Ralph loop. The results-flow seam
(Decision §2, `.forge/last-gate-failure.md`, present ⇒ fresh) and the
forensic-escalation ban (Decision §4) are unchanged by this relocation — they
were never unifier-specific.

The full spec — the preserved regression criterion ("no path to merge exists
with a red full-suite baseline"), the `testProcess.local`/`testProcess.ci`
keying (R1-03-F1, same PR), and the unattended-remediation mechanism (bounded
by a shared cap; cap exhaustion parks the initiative `needs-operator`) — is
recorded in
[`docs/forge-project-contract.md`](../forge-project-contract.md#the-merge-boundary-full-suite-gate-relocation-spec--operator-review-required-not-yet-enforced),
not restated here. This amendment exists solely to record the operator's
verdict on that spec, per the locked Q3-B decision that flagged this
relocation for operator review
(`docs/roadmaps/R1-contract-componentry.md` R1-03-F4).

Nothing changes in this ADR's Decision or Consequences until that verdict is
recorded. `docs/roadmaps/R4-ootb-suite.md` R4-10-F2 is the sole
build-and-prove owner of the runnable replacement and, by its own stated
precondition, may not start before this line resolves.

**Operator verdict: APPROVED as specced — 2026-07-24** (recorded from the wave-4 S2 session decision). The relocation proceeds exactly per the contract-doc spec: orchestrator-owned merge-boundary gate keyed off testProcess.local + testProcess.ci, unattended remediation via develop-agent re-dispatch on scoped fix WIs from .forge/last-gate-failure.md under R4-10-F2's shared cap, cap exhaustion parks needs-operator, and the preserved invariant — no path to merge exists with a red full-suite baseline. R4-10-F2 (the build+prove owner, wave-4 tail) is now UNBLOCKED.
