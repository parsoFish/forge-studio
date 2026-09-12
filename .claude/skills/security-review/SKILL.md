---
name: security-review
description: Use before committing any change that touches authentication, external input, a filesystem or network sink, an API surface, or a spawn/exec path. Derives the review range from this repo's own remote and refuses rather than guessing.
---

# Security review — this repo's, on this repo's remote

`forge-8vfn.7.6.69`, T1 ruling 926. The bundled skill of the same name shells
`git diff origin/HEAD...`; this repo's remote is `parsoFish`, so it aborted for
every lane, every time. The string is compiled into the Claude Code binary — 18
occurrences, zero in any editable file — so the fix is not ours to make and the
review is ours to own instead.

Two things about that failure shape the rules below. It aborted **loudly**,
which is the only reason it cost time rather than findings. And on both
occasions the forced hand review ran, it found a real defect: four destructive
`rmSync` bypasses with a missing length cap (`7.6.55a`), and a `progressKey`
shape the descendant selector could not use, reported to the operator as *"the
key never appeared"* (`7.6.77`). **This review earns its place; it is not
ceremony.**

## 1. Get the range — never assume it

```bash
bash .claude/skills/security-review/scripts/review-base.sh
```

It prints `REMOTE`, `BRANCH`, `VIA`, `BASE`, `RANGE`, then `COMMITTED`,
`STAGED`, `UNSTAGED` and their total `FILES`; it exits 2 with `REFUSING:` when
it cannot derive the range. **A refusal is not a pass.** If it refuses, say so
and stop; do not substitute a range you picked yourself.

It derives the remote from the branch's upstream, falls back to the sole remote
when a detached HEAD has none (the lanes' normal state mid-gate), and refuses
when several remotes are configured and nothing says which. It never hardcodes a
remote name — that would be this bead's own defect with a different string in
it.

Then read **all three**, because this review runs BEFORE the commit and the
change is usually not in the range yet:

```bash
git diff "$BASE..HEAD"    # commits on this branch   (COMMITTED)
git diff --cached         # staged, not yet committed (STAGED)
git diff                  # not yet staged           (UNSTAGED)
```

Reading only the first is how this skill nearly shipped its own vacuous pass:
run on a freshly branched worktree it reported `FILES=0` over a change that was
entirely staged. **`FILES=0` means there is nothing to review anywhere** — say
that as the outcome. Any non-zero count is work you have to read, wherever it
sits.

## 2. What to look for, in this repo's terms

Work the diff, not the checklist: each item below names a sink this repository
actually has.

**External input reaching a boundary.** Story files (`tests/stories/*.mjs`), HTTP
route params and bodies under `apps/studio`, CLI arguments, anything read from
`_queue/` or `_logs/`. Validate at the boundary and **fail closed**. A value
that is validated and then dropped is worse than one never validated: the author
believes it is working (`7.6.82`).

**Path segments.** Any value that becomes part of a filesystem path needs the
session-id guard shape from `scripts/lib/journey-assertions.mjs`: a charset
allowlist, a length cap, and an explicit refusal of stringified nullish
(`'null'`, `'undefined'`, `'NaN'`). Check traversal (`..`), absolute paths, and
URL-encoded forms of both.

**Interpolation into an interpreter.** Selectors (`[data-${k}]` —
`beats-page.mjs`'s `SAFE_KEY` is the allowlist), shell command lines, SQL, regex
built from input. Ask whether the value could be *partially* honoured: a key
read by name on one path and through a selector on another is the `7.6.77`
finding, where the two disagreed silently.

**Destructive filesystem calls.** `rmSync`, `unlinkSync`, `writeFileSync` onto a
computed path, `mv`/`cp` in a script. Every one must route through a guarded
helper rather than take a raw path. Four bypasses shipped this way in `7.6.55a`.

**Spawn and exec.** Argument arrays, never a concatenated string. Environment
allowlists. Never pass a token in argv.

**Secrets.** Nothing from `secrets.env`, no tokens, no keys in a diff, a log
line, a test fixture, or an error message. `gh` is invoked as
`GH_TOKEN="$(gh auth token --user parsoFish)"` per command.

**Guards that fail open.** A check that returns "allowed" when its input is
absent, unreadable or malformed. An unreadable input must never resolve toward
proceeding (§15.504). This is the single most common finding in this campaign.

## 3. Report

State each finding as: the sink, the input that reaches it, and the concrete
path from one to the other. A finding without a reachable path is a
possibility, not a finding — say which you have.

Finish with one of exactly these, and never with silence:

- `SECURITY REVIEW: <n> finding(s)` followed by them;
- `SECURITY REVIEW: no findings over <FILES> file(s) in <RANGE>` — only when the
  range was derived, not assumed;
- `SECURITY REVIEW: NOT RUN — <the refusal>`.

The third is a legitimate outcome. A review that cannot establish what it is
reviewing has to say so, because the alternative reads identically to a clean
one, and §15.333's hand-review requirement exists precisely because nobody could
tell those two apart from the output.
