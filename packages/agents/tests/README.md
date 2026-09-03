# `packages/agents/tests/` — what goes in which bucket

Four buckets, one rule each. The rule is written down because a bucket layout
that is only a preference decays into "wherever the last person put it", and
because a mis-bucketed test is a small lie about what that test is for.

| bucket | the rule | how to tell |
|---|---|---|
| `unit/` | one module, exercised directly | the file imports one subject and asserts on its return values |
| `integration/` | more than one module driven together, or a real subprocess / real worktree | it dispatches, spawns, or drives a runner end to end |
| `contract/` | a declared contract the rest of the repo must keep | it scans a tree, enumerates call sites, or asserts parity between two things that must agree |
| `regression/` | a specific named defect, pinned so it cannot return | the header names its bead, and the test was red before the fix |

`contract.test.ts` stays at the package root, deliberately: it is the public
door's own test (ruling 31), it is named by `SPEC.md` §1, and exit row 6's
proving command expects to find exactly that one file outside this directory.

## `test-fixtures/` — the one place a helper is shared, not duplicated

Everywhere else in this package a small helper is DUPLICATED into each file
that needs it, with the reason written beside it: a `.test.ts` that exports a
helper becomes an import target for other tests and starts constraining what it
may assert. Twelve lines is the cheaper side of that trade, and
`regression/failure-classifier.rate-limit.test.ts` set the precedent.

`test-fixtures/` is the exception, and it takes a real argument to open it. The
one module in it — `interactive-runner-log-observer.ts` — is 268 lines used by
all four clusters of the file it came out of, and one of those clusters
(`regression/agent-run-log-observer.test.ts`) tests the log walker as its
SUBJECT, carrying beads `forge-q1z` and `forge-1im` in its own comments. Three
duplicated copies of a 162-line walker is the signal that a seam is wrong, not
a smaller file; a subject with its own tests wants its own module.

Two rules, so the exception stays one:

- **Only test files may import it.** `scripts/check-owner.mjs`'s
  `NOT_PRODUCTION` regex excludes `.test.*` files AND anything under
  `test-fixtures/`, so a module here is test support by the repo's own
  definition and does not count toward the package's production LOC cap (T1
  ruling 94, 2026-09-04). A PRODUCTION importer would break that reading — it
  would make package code depend on a file the cap does not count. Every
  importer must itself match `NOT_PRODUCTION`.
- **The bead comments live with the code they describe.** When a defect's
  mechanism moves here, its `forge-*` provenance moves with it, or the next
  reader finds a hardened reader with no record of what it was hardened
  against.

Anything smaller than that walker gets duplicated. This directory is not a
general dumping ground for shared helpers.

## Two things a mover has to know

**Anchors.** Files here are two levels below the package root. Anything that
needs the repo root imports `FORGE_ROOT` from `@forge/kernel/ids.ts` — never
`'..'` counted from `import.meta.url`, which is correct at exactly one depth
and wrong at every other (COMMON §15.14). `tests/regression/anchor-depth.test.ts`
holds that proof, including the correction that the failure is a loud `ENOENT`
rather than the silent pass the sweep first assumed.

**Paths inside guards.** A guard that names another file by a literal path is
coupled to every move. `tests/contract/hook-dispatch-coverage.test.ts` locates
the lock it depends on by that lock's own defining symbol instead — and asserts
there is exactly ONE, so the check notices a deletion and a duplicate, not just
a rename. Its first version searched for the bare token and found itself
quoting it, which inverted the result; the comment there records that, because
the next person to write a scanner in this directory will reach for the same
shortcut.
