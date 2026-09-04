---
name: adversarial-containment-review
description: Attack path-handling code that turns caller-supplied input into filesystem or git operations. Use when reviewing or writing any route, CLI, or worker that resolves a request-derived path, when hardening a containment guard, or after a containment fix lands. Includes the escape-shape catalogue and the ratchet pattern that closes the class.
---

# Adversarial Containment Review

From the forge wave-5 campaign: **~20 live-reproduced escapes across ~10 route families**, three P0s, found across six initiatives — most of them *after* a systematic audit already existed. Discovery stayed luck-driven until the class was closed mechanically.

## The headline finding

> **The guard existed and was exactly as documented; the call sites simply never called it.**

Seven route families showed this in one small initiative. Not a missing guard — an uncalled one, frequently with a *sibling route two hundred lines away* already fixed and carrying a comment explaining why. **Before writing a new guard, grep for the existing one and check every call site.**

## Escape-shape catalogue

Attempt every shape. Each was live somewhere:

| Shape | Note |
|---|---|
| Directory symlink | The classic; a lexical `startsWith` never catches it |
| **File** symlink, directory real | Guarding the directory misses it entirely |
| Cross-object alias | `slug → another valid object` passes any "somewhere under root" check — **assert identity, not membership** |
| Hardlinked leaf | `realpath` is structurally blind to it; needs `nlink === 1` |
| `..`-normalization | `join()` folds `..` before comparison; also produces false rejections on legitimate names like `..foo` |
| Escape-and-return | Numerically round-trips to a legitimate target; still illegitimate as a declared path |
| **Root-folding** | Untrusted value folded into `root` instead of passed as a segment — `realRoot` is already the escaped path, so the comparison is *tautological and can never fail* |
| Percent-encoded traversal | Only reachable via a **raw** request; the normal client normalizes it away first |
| Empty string | A validator returning "not invalid" for `''` while `??` never substitutes for it — the empty string gets persisted |
| **TOCTOU symlink swap** | A staged entry swapped for a symlink *between* the guard's check and the copy's read — every guard reports ok, the copy exfiltrates. Needs `O_NOFOLLOW` on open **plus** `fstat nlink === 1` (batch E, `copyStagingToLibrary`) |
| Destination-side race | The **symmetric** race at the write end: pre-place a symlink where the guarded copy will create its output. Found by attacking the source-side fix; closed with `O_EXCL\|O_NOFOLLOW`. Residual: `O_NOFOLLOW` guards only the final path component |

## Guard shape that works

- **Identity after realpath**, per segment, including nested tails — not prefix containment.
- **`nlink === 1`** on the leaf where a write occurs.
- **Untrusted ids arrive as their own path segments, never folded into the root.** Write this as a contract in the guard's docstring; it is the precondition the next caller will otherwise break.
- **Validating a root does not validate what you write beneath it.** Every path actually written needs checking, not just the directory that was verified.
- **Guard the paths you WRITE, not the paths you merely probe for existence.** A containment verdict on an idempotent "already there, skip" probe produces a false rejection that breaks legitimate workflows — and an error message naming an attack that did not occur is worse than the hole for the operator hitting it.
- **Separate the check from the write.** Phase 1: resolve and check every path the operation will touch, with zero side effects. Phase 2: write. Moving a *writing* operation earlier does not create fail-before-write — it only changes which artifact gets orphaned.

## Two questions that find most of it

**"Can this guard ever return false?"** Construct the input that makes it fail. If you cannot, it is decorative. One shipped guard's comparison was tautological for any input; an ordinary well-formed request served attacker-chosen content through it.

**"What else reaches this sink — and what else observes this state?"**
- *Sinks*: sweep every caller, including siblings a module's own documentation names. One module's docstring called itself a sibling of a tracked module; the audit tracked one and missed the other, which turned out to re-enter a full work cycle against attacker-chosen paths.
- *Observing surfaces* (the mirror, and rarer): a phantom entry survived four review rounds because every test checked one listing and none checked the other. **Sweep for other surfaces that observe the state you claim to have cleaned up.**

## Attack the fix, not just the defect

**Seven times in one campaign a containment fix shipped its own containment bug**, four consecutively on one initiative. Mandatory: after a guard lands, attack the guard. Specifically look for
- a fresh `..`-normalization bug inside the new comparison,
- over-strict rejection of legitimate names (`..foo`, in-repo hardlinks, `.` path components),
- a leaked handle or half-completed side effect on the new throw path,
- **the same defect one layer down** — and if two successive fixes reopen it, stop: the class is misdiagnosed.

## Close the class, don't chase it

Per-finding fixes do not scale, and an audit document alone still leaves discovery luck-driven. Build a **ratchet**: enumerate the fs/process sinks reachable from your request surface, allowlist what an audit has classified, and **fail when a new unguarded sink appears**. Wire it into CI with a failure message telling the author what to do (call a guard, or add a justified audit row).

Explicitly *not* general static analysis. State what it provably cannot cover — dataflow (constant vs request-derived), aliased or namespace imports, promise-based APIs, a guard gutted behind an unchanged call count. In the campaign it fired three times on its own author's diff, which is the evidence that it works on live changes rather than on its own fixtures.

## Rating honestly

Rank on measured reachability, not on shape. Distinguish:
- **wire-reachable** from **structurally impossible** (values `JSON.parse` can never produce are not a live surface — but say so, and note the precondition that would make them one);
- **fails-closed false rejection** from **write outside the root**;
- a **race** from an ordinary unrelated failure — and if no test in the diff exercises the race, say that plainly rather than letting a "verified" tag imply coverage it doesn't have.
