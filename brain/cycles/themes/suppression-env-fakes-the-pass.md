---
title: The suppression env fakes the pass — when the environment decides the result
description: A family of false greens where the environment, not the code, produces the verdict — a gate run without CI's env is not the same gate; tests that inherit a precondition from ambient env instead of establishing it; an orphan process serving a stale build; and the exit-0-means-nothing shapes (backgrounded launchers, a library module with no CLI entry, exit codes read through a pipe).
category: antipattern
keywords:
  - suppression-env
  - FORGE_ARCHITECT_NO_SPAWN
  - gate-fidelity
  - environment-independence
  - establish-your-precondition
  - exit-code-through-a-pipe
  - orphan-process
  - vacuous-green
  - postcondition-before-exit-code
created_at: 2026-08-08
updated_at: 2026-08-08
related_themes:
  - declared-data-fails-open
  - quality-gate-cmd-must-assert-new-work
  - 2026-07-11-pm-gate-vacuous-pass-new-function-name
  - env-leak-must-be-fixed-at-spawn-seam-not-launcher
  - 2026-06-06-live-acc-gate-misses-lint-ci-gate-net
---

# The suppression env fakes the pass

Every instance below reduces to one sentence: **the environment produced the verdict, not the code.** The tell is uniform — a green that cannot go red, because the branch under test was never reached, the process under test was never the one running, or the exit code read was never the job's.

Batch C hit four structurally different shapes, and one initiative recorded three of them: *"the harness's spawn-suppression faking a pass; the uid-1001 orphan; now CI's env absent from the gate … not one bug shape — it is a whole family"* (`_wave5/ledger.md` L9696–9700).

## Instances

| Shape | Instance | Ledger |
|---|---|---|
| The gate was not the same gate | `.github/workflows/ci.yml:34` sets `FORGE_ARCHITECT_NO_SPAWN: "1"` for the whole test job; both T2 gate blocks ran `npm test` **without** it. Lane α measured the blast radius (3836 tests, exactly one divergent failure) and stated the rule: *"the gate must run under CI's environment, or it is not the same gate."* Lane β hit it as PR CI-red at 3935/3937 against a local 3937/3937 on the same SHA and adopted α's rule mid-initiative. **Found independently by BOTH lanes** — a measurement of the gate contract, not bad luck. | L9555–9567, L9667–9700 |
| Inheriting a precondition instead of establishing it | Under the suppression env `runAgent` short-circuits before the injected `queryFn`, so no run can reach `done`. `orchestrator/run-agent-ceiling.test.ts` calls `withoutSpawnSuppressionEnv()` **15 times**; `cli/ui-bridge-agent-run-ceiling.test.ts` called it **zero** — *"the tests inherit their precondition from ambient env instead of establishing it, so they pass on a dev machine and cannot pass in CI."* The same seam nearly faked a pass twice more: round-1 ceiling tests driving `runAgent()` directly would have gone green for the wrong reason (L6659–6668), and in batch A the only AT touching a connection-install route ran under a file-global suppression flag, so *"it only ever reached the SUPPRESSED branch, where `ok:true` is always correct. The executor branch had zero coverage"* (L2583–2592). | L9677–9686 |
| An orphan process answers for the build | A `ui:journey` run hit a shell ceiling (exit 143); the naive retry would have run against an **orphaned `next-server` (pid 570981)** still alive with its ports released. `kill` was insufficient — `kill -9` cleared it, ports were verified free, and only then was a clean baseline taken. *"One clean baseline beats two retries."* | L9354–9366 |
| Exit 0 that means nothing (×4 positions) | A `nohup … &` inside a backgrounded call reported *"completed exit 0"* for the **launcher** while the job ran 40 more minutes, and the `until ! pgrep -f "scripts/e2e-journey.mjs"` waiters matched their own argv so they could never exit (L5775–5783). `node cli/studio-lint.ts` → **exit 0, zero bytes**, because it is a library module with no CLI entry; the real entry `node bin/forge.mjs studio lint` prints a real tally (L13084–13091). The `tsc \| head; echo $?` trap fired twice, once caught by a T2 who had been stating the rule to every worker all session. | L8508–8516, L11466–11471 |
| Vacuous green from a surface that does not exist | Seven green-on-arrival containment ATs all passed *"because the route does not exist and 404s for everything"* — an escape test passing because nothing was there. The fix is an **indistinguishability** assertion (traversal-shaped slug returns bytes identical to a well-formed-but-unknown slug), red against all three wrong implementations rather than none. | L12295–12308 |
| A checker reaching none of the code it appears to cover | `tsc --noEmit --listFiles \| grep -c forge-ui/components` → **0**: the root tsconfig includes only `orchestrator/ cli/ loops/ skills/`, so every accepted "tsc exit 0" said nothing about the client half. Separately `parity:stories`, `ui:deadpaths` and `ui:journey` *"appear in no CI job at all — they are gate-only"* (L11219–11221). | L10334–10345 |

## Rules for a planner

1. **Tests establish their own preconditions.** Never read a precondition from ambient env. If a suppression or dry-run flag can change the branch taken, the test sets or unsets it explicitly, in-file.
2. **Acceptance is environment-INDEPENDENCE, never "green now."** The bar is green **both** ways, with and without the flag — applied repeatedly in batch C (L10175, L10187, L11759–11760). *"A fix verified one way is the same defect with a different sign"* (L9688–9694).
3. **Gates export CI's env and record it.** Every gate log states the env it ran under (minimum `FORGE_ARCHITECT_NO_SPAWN=1`, matching `.github/workflows/ci.yml:34`) and publishes which checker reaches which paths. A gate whose coverage is unstated is a gate whose coverage is unknown.
4. **Read a postcondition before you read an exit code.** Assert non-trivial output (byte size or an expected token) first; zero output from a linter is a failure regardless of status. Never read `$?` through a pipe; never `pgrep -f` a pattern your own argv can contain; never treat a backgrounded launcher's exit as the job's.
5. **After any killed run, presume contamination** — sweep orphans, verify ports free, take one clean baseline. Do not retry into a stale process.

## Sources

- [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) — line 34 sets `FORGE_ARCHITECT_NO_SPAWN: "1"` for the whole test job; the env a gate must mirror.
- [`orchestrator/run-agent-ceiling.test.ts`](../../../orchestrator/run-agent-ceiling.test.ts) — the `withoutSpawnSuppressionEnv()` pattern, applied 15 times.
- [`cli/ui-bridge-agent-run-ceiling.test.ts`](../../../cli/ui-bridge-agent-run-ceiling.test.ts) — the sibling that inherited the precondition and could not pass in CI.
- [`cli/studio-lint.ts`](../../../cli/studio-lint.ts) — a library module with no CLI entry; invoked directly it exits 0 with no output.
- `_wave5/ledger.md` (gitignored campaign state) — all `L…` citations above; batch C is the region after `# ============ BATCH C ============`.

## See also

- [[declared-data-fails-open]] — the sibling class: the *data* is declared and enforced nowhere.
- [[quality-gate-cmd-must-assert-new-work]] — a gate command that exits 0 having executed nothing.
- [[2026-07-11-pm-gate-vacuous-pass-new-function-name]] — the same vacuous-pass shape at decomposition time.
- [[env-leak-must-be-fixed-at-spawn-seam-not-launcher]] — fix env defects at the shared spawn seam, not per launcher.
- [[2026-06-06-live-acc-gate-misses-lint-ci-gate-net]] — a local gate whose net differs from CI's.
