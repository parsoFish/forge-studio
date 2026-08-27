---
title: "A pin that reads the checkout's git history is environment-shaped"
description: "F5's ancestry pin for the baseline-stamp refusal derived its 'older ancestor' from the repository's real history: green on every full-history worktree, red on CI's depth-1 clone where the oldest reachable commit IS HEAD. The hermetic form builds its own scratch repo. Asking the follow-up — does shallow break the CLI too? — found two real gate defects the pin alone never showed."
category: antipattern
keywords:
  - ci-vs-local
  - hermetic-tests
  - shallow-clone
  - baseline
  - immutable-gates
related_themes: [2026-08-28-scope-filters-reship-the-class-a-sound-audit-catches, 2026-08-22-verifier-without-a-repro-produces-agreement]
created_at: "2026-08-28"
updated_at: "2026-08-28"
---

## What happened

Wave 8's F5 lane made `check-baseline-shrinks` refuse a `main@<sha>` stamp
that resolves but is not an ancestor of the comparison base. Its pin used the
checkout's own history for the negative case. T1's local gate run: green. The
lane's: green. CI `build-and-test`: `fixture precondition: HEAD must differ from
the older ancestor sha` — expected and actual the same commit. CI's job is a
depth-1 clone; the oldest reachable commit is HEAD.

The fix was structural: the test builds its own git repository (two commits,
a detached non-ancestor) and copies the two scripts under test into it, so
`FORGE_ROOT` resolves inside the fixture. Proven red in a
`git clone --depth 1` of the lane tree before (41/42) and green after (44/44);
T1 repeated the shallow-clone repro independently before merging.

The follow-up question the brief asked — *does shallow break the CLI, not just
the test?* — found two real defects: in a shallow checkout the bounded fetch
made the sha **resolve** while the grafted history still answered "not an
ancestor", so a legitimate stamp was refused with a message blaming the
operator; and `git fetch --no-tags --depth=1 origin <ref>` on a **full** clone
creates `.git/shallow`, so the CI job given `fetch-depth: 0` had re-shallowed
itself and would have refused every legitimate regeneration.

## The rule

- A test that touches git builds the repository it tests. Never `HEAD~N`,
  never `rev-list | tail -1`, never "some commit that exists here".
- When a gate reads history, the environment's history depth is an input —
  name it in the gate's own limits section, and pin the shallow case.
- A CI-only red is a finding about the *shape* of the test before it is a
  finding about the code. Diagnose from the CI log; do not re-run locally and
  call green a refutation.
