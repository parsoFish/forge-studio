#!/usr/bin/env bash
# review-base.sh — print the range a security review must read, or REFUSE.
#
# `forge-8vfn.7.6.69`, T1 ruling 926. The bundled `security-review` skill shells
# `git diff origin/HEAD...` and this repo's remote is `parsoFish`, so the skill
# aborted for every lane — measured: the string is compiled into the Claude Code
# binary (18 occurrences) and appears in no editable file, so it is not ours to
# fix and the review had to become ours instead.
#
# THE SAME DEFECT ONE LEVEL DOWN IS THE THING TO AVOID HERE (926 says so): a
# replacement that hardcodes `parsoFish` is the identical bug with a different
# name in it. The remote is DERIVED, and when it cannot be derived this REFUSES
# rather than guessing — a review that silently reads the wrong range reports
# "no findings" about code nobody looked at, which is worse than not running.
set -u

die() { echo "REFUSING: $*" >&2; exit 2; }

# 1. The branch's own upstream, which is the truth when there is one.
remote="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null | cut -d/ -f1)"

# 2. A worktree on a detached HEAD has no upstream — the lanes' normal state
#    during a gate. One remote is unambiguous; several are not, and picking one
#    would be a guess wearing a derivation's clothes.
if [ -z "$remote" ]; then
  n="$(git remote | grep -c .)"
  case "$n" in
    0) die "this repository has no remote, so there is no published base to diff against" ;;
    1) remote="$(git remote)" ;;
    *) die "$n remotes ($(git remote | tr '\n' ' ')) and no upstream on this HEAD — name the base yourself:
  review-base.sh <remote>/<branch>   (or check out a branch that tracks one)" ;;
  esac
fi

# 3. The remote's default branch. `refs/remotes/<r>/HEAD` is what the bundled
#    skill assumed exists; it often does not, because it is only written by
#    `clone` or an explicit `set-head`. So its absence is NORMAL and must not be
#    an error — but neither may it silently become `main`, so the fallback is
#    checked to EXIST before it is used, and which one was used is printed.
# `${x#"$prefix"}`, NOT `sed "s#^$remote/##"` — found by this skill's own first
# review of itself. A remote name is a refname, and refnames may contain `#`:
# `git remote add 'a#b'` is accepted, and the sed then reads `s#^a#b/##`, whose
# `#` delimiters fall in the wrong places. It does not error — it prints
# `b/#b/main`, a garbage branch that refuses two lines later with "is the remote
# fetched?", which is a true-looking answer to the wrong question. Parameter
# expansion strips a LITERAL prefix and has no interpreter to confuse.
branch="$(git symbolic-ref --quiet --short "refs/remotes/$remote/HEAD" 2>/dev/null)"
branch="${branch#"$remote/"}"
via='remote HEAD'
if [ -z "$branch" ]; then
  for cand in main master; do
    if git rev-parse --verify --quiet "refs/remotes/$remote/$cand" >/dev/null; then
      branch="$cand"; via="fallback: $remote/HEAD is unset, $remote/$cand exists"; break
    fi
  done
fi
[ -n "$branch" ] || die "cannot tell which branch is $remote's default: $remote/HEAD is unset and neither $remote/main nor $remote/master exists"

base="$(git merge-base "$remote/$branch" HEAD 2>/dev/null)" \
  || die "no merge base between $remote/$branch and HEAD — is the remote fetched?"
[ -n "$base" ] || die "no merge base between $remote/$branch and HEAD"

# THE WORKING TREE IS PART OF THE ANSWER, and leaving it out was a vacuous pass
# by construction — found by running this on its own change before committing it.
# CLAUDE.md says to review BEFORE committing, so the commits between the base and
# HEAD are usually NOT the change under review: on a freshly branched worktree
# `$base..HEAD` is empty and the whole diff is staged. Reporting `FILES=0` there
# would render an empty checklist over a real change and call it clean, which is
# the exact failure this file exists to refuse in every other direction.
#
# So all three are counted and printed separately. A reviewer needs to know WHICH
# of them carried the change, and a total alone cannot say.
# A `git diff` that FAILS prints nothing, and nothing counts as zero — so a
# broken range would read as "no change to review". That is the fallback species
# in the file whose whole purpose is refusing it, so each count checks that git
# actually ran. (`grep -c .` exits 1 on zero matches after printing `0`, which is
# why `|| true` is correct there and not a silencer.)
# `count_of` SETS A VARIABLE and is called in the PARENT shell — it is not used
# inside `$( )`, and that is the whole point. The first fix put `die` inside a
# command substitution, where `exit 2` ends the SUBSHELL and the script sails on
# with an empty count: a guard that cannot stop its own caller, which is the
# fourth guard tonight to fail that way. Its own door caught it.
count_of() {
  local out
  out="$(git diff --name-only "$@")" || return 1
  REPLY="$(printf '%s\n' "$out" | grep -c . || true)"
}
count_of "$base..HEAD" || die "\`git diff --name-only $base..HEAD\` failed — a diff that could not run is not an empty diff"
committed="$REPLY"
count_of --cached || die "\`git diff --cached --name-only\` failed — a diff that could not run is not an empty diff"
staged="$REPLY"
count_of || die "\`git diff --name-only\` failed — a diff that could not run is not an empty diff"
unstaged="$REPLY"
# THE FOURTH PLACE A CHANGE HIDES (A, T1 1003 — `forge-8vfn.7.6.104`): a NEW file not yet
# `git add`ed is in NONE of the three diffs above. Measured on 7.6.73: `FILES=8` for a change
# touching 12; the four absentees were the new files — and a brand-new file is exactly where a
# new sink most likely lives. Counted AND NAMED, because no diff will ever show them and the
# reviewer has to open each one. Ignored files are excluded on purpose: they will never be
# committed, and a review item that cannot ship is noise wearing a finding's clothes.
untracked_list="$(git ls-files --others --exclude-standard)" \
  || die "\`git ls-files --others --exclude-standard\` failed — a listing that could not run is not an empty listing"
untracked="$(printf '%s\n' "$untracked_list" | grep -c . || true)"
files=$(( committed + staged + unstaged + untracked ))

echo "REMOTE=$remote"
echo "BRANCH=$branch"
echo "VIA=$via"
echo "BASE=$base"
echo "RANGE=$base..HEAD"
echo "COMMITTED=$committed"
echo "STAGED=$staged"
echo "UNSTAGED=$unstaged"
echo "UNTRACKED=$untracked"
[ -z "$untracked_list" ] || printf '%s\n' "$untracked_list" | while IFS= read -r u; do [ -n "$u" ] && echo "UNTRACKED_FILE=$u"; done
echo "FILES=$files"
