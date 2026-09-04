---
name: immutable-gates
description: Make acceptance tests the agent cannot weaken, and prove a test measures what it claims. Use when an agent both writes code and runs the tests that judge it, when pinning acceptance criteria before implementation, or when a test suite is green but trust in it is low.
---

# Immutable Gates

From the forge wave-5 campaign: ~1,000 acceptance tests pinned across 18 merged PRs, zero red merges, and — more usefully — a catalogue of the ways a green test lies.

## The mechanism

1. **Acceptance tests land BEFORE the implementation**, written by a dedicated agent that does not implement.
2. **Record a pin SHA and a manifest of the whole test world** — not just test files: the runner config, `package.json` globs, journey/beat registries, fixture helpers, CI config. Anything that can silently de-register a test belongs in the manifest.
3. **Restore from the pin before judging**: in a clean worktree on the candidate branch, `git checkout <pin> -- $(cat manifest)`. Worker edits to the test world are *overwritten*, not policed. Expect an empty diff; explain any that isn't.
4. **Red→green proof**: the tests must be RED at base and GREEN on the candidate. A test that never went red proves nothing.
5. **The orchestrator runs every gate itself.** A worker's pass/fail claim is not evidence.
6. Only the test-writer amends tests; amendments re-pin and are recorded.

## Why a green test lies — the catalogue

Each of these was caught live. They are the reason the discipline exists.

**Characterization vs acceptance.** *If a test would look identical had the implementation been wrong, it is characterization, not acceptance.* Occurred seven times. When a test is green on arrival, it must name **which wrong implementation it kills**, or it is decoration.

**The tests pin the defect.** A test can encode the bug as the contract. One suite asserted a declared secret grant scored *lower* severity than an undeclared one — the security model inverted, with the tests holding it in place. When a review finds a design inverted, the tests are usually complicit.

**The test is on the wrong surface.** A headline feature was **completely non-functional on the product's real save path** while thousands of unit tests passed — they constructed inputs directly, where the defect (introduced by the *client's* serialization) cannot exist. **Any claim about round-trip, idempotence or fidelity needs at least one test driving the real client path.**

**Client-side normalization masks a server-side hole.** A path-traversal route returned 200 with attacker content, but only under a **raw** request — the normal client stripped `..` before it left the process. Path-shaped route params need wire-level tests.

**Passing by accident.** An escape test that 404s because no file was planted at the target — not because containment worked. When a test passes, ask *which mechanism* produced the pass. Prove it by **swapping the pre-fix code back in**: if the test still passes without the fix, the fix is not what protects it.

**Accidentally-safe production code.** Four symlink shapes were blocked by unrelated `existsSync` idempotency checks that knew nothing about symlinks. Keep them as regression locks, but **name the accident explicitly** and make them pass for the right reason after the fix.

**The fixture that dies when the bug is fixed.** A test that manufactures its fixture *through the code path under test* breaks the moment that path is fixed — a false negative caused by success. Plant gap-pinning fixtures directly.

**A guard widened to fit the fixture.** The inverse failure: production containment loosened until a test's convenient path passed. Fixtures must mirror production shape.

**The environment fakes the pass.** Two tests passed only because the test process's `cwd` was unrelated to the temp root, so a lexical pre-filter fired before the real invariant was ever exercised. `chdir` to the realistic location and watch them fail.

**Wall-clock is a leak detector.** A guard throwing past a `setInterval` left 15/15 green while process exit took 185s instead of 0.38s. Assertions cannot see a leaked handle; elapsed time can. Record wall-clock on every run.

**A missing import passes red tests for the wrong reason.** An undefined identifier throws into the very `try/catch` the fix relies on, so every negative test still "passes" — only the positive control catches it. Verify with authoritative `tsc`/build, never the editor's diagnostics. (`tsc | head; echo $?` reports the *pipe's* status.)

## Claims discipline

**Failure-behaviour claims are execution-only, and verified per claim.** "Fails closed" / "refuses" / "does not write" / "already guarded" cannot be established by reading — reading tells you what a function intends; only execution tells you what the caller does with the throw. In the campaign, a single audit document carried a false failure-behaviour claim in **seven consecutive rounds**, four written by orchestrators. A row-level "verified" tag does not certify every sentence in the row.

Verify prose claims by measurement before they enter a PR body: three claims in one PR were wrong (a branch-internal file described as a deletion, 947 lines called 948, 7 of 16 called 8).

## Placement

- Trust, pipeline, registry and **security** semantics → the test home your CI actually runs. Never put a security assertion solely somewhere CI doesn't reach.
- View-state → the component-level runner.
- User-story closure and DOM contracts → the end-to-end journey suite.

Check what CI runs before trusting placement: one suite ran in neither CI nor the default test glob, so an entire tier of acceptance tests executed nowhere.

## Assertion strength

- Assert the **artifact**, not the status code: an escape test asserts the outside file is byte-unchanged, not merely that the response was 4xx.
- Assert **indistinguishability** when closing an oracle: two requests differing only in whether a path exists must return byte-identical responses (id-normalized).
- Assert the **call record**, not just the outcome, when the defect is "this was invoked with a poisoned value".
- Pin **per-element isolation** before the fix lands, so a guard cannot be implemented as a collection-wide abort.
- **Measure the boundary before choosing a magic number** — bisect the actual limit rather than picking one that sounds large.
- A deliberately-green gap-pin must **document its own expiry condition**.
