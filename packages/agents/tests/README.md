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
