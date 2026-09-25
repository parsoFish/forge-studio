#!/usr/bin/env bash
# pin-precheck.sh <gate-log> <repo> <campaign> [--expect-pin-fail <manifest>[:<path>] ...]
#
# T1 693(i)/(ii), §15.388: "a check that runs and is not read is a check that
# never ran." `gate.sh` exits on its STEP LIST only (`exit $fail`); its pin block
# prints beside the rc and never feeds it. D's gate on `d7d8dba9` was rc=0, 20/20,
# with `M6-T1.sha256: 2 FAILED of 14` in the same log — and the merge precondition
# recorded green over two failing pins. So the gate's rc is not a merge
# precondition on its own.
#
# ORIGINALLY A's (`m6-a-pin-precheck.sh`), moved here and made path-level at A's
# own request. Two properties are A's and kept verbatim in spirit:
#
#   * AN ABSENT PIN BLOCK REFUSES. It does not pass. That is exactly the shape
#     `forge-e8dn` had, and it is the same family as a `git fetch` that failed
#     while DNS was down and left `git rev-parse parsoFish/main` returning a
#     stale SHA, so `pin-reconcile` ran `old -> old` and printed clean. A failed
#     READ that renders as a pass is the thing this file exists to refuse.
#     (Measured from both sides in one minute on 2026-09-11: a push failed with
#     `Could not resolve host`, succeeded on retry, and `getent hosts` still
#     reported failure afterwards — the resolver answered differently to
#     different callers, so any single lookup read as a fact was a wrong fact.)
#   * The refusal NAMES the manifest and what failed, never "pins failed".
#
# WHAT CHANGED FROM A's VERSION, and why. A's declaration was per-MANIFEST:
# `PIN_ACCOUNTED M6-C: 5 FAILED` passes a SIXTH failure in M6-C just as happily
# as the five the PR knows about. A wholesale "M6-C is expected to fail" is a
# blanket, and a blanket is what `forge-e8dn` and this morning's no-op reconcile
# both were. So declarations are PATHS, and the comparison is a SET DIFFERENCE
# REFUSED IN BOTH DIRECTIONS:
#
#   undeclared failure  → the obvious case; the PR does not account for it.
#   declared-but-clean  → the PR's account of ITSELF is wrong. Worth knowing
#                         before a merge, not after: either the file was already
#                         reconciled by someone else (so the PR's story is stale)
#                         or it never moved (so the declaration was a guess).
#
# WHY IT RE-DERIVES INSTEAD OF PARSING PATHS OUT OF THE LOG: the pin block prints
# COUNTS and never names a path (`gate.sh:201-217`). So the log alone cannot
# support a path-level declaration. This reads the log to prove the block EXISTS
# and to read its counts, then re-derives the failing SET with `sha256sum -c` in
# the tree — and REFUSES if the two disagree, because a count that moved between
# the gate and the merge means the tree moved under the verdict.
set -u

LOG=""; R=""; CAMP=""; EXPECT=""; CHANGED_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --expect-pin-fail) EXPECT="$EXPECT ${2:?--expect-pin-fail needs <manifest>[:<path>]}"; shift 2 ;;
    --changed-paths-file) CHANGED_FILE="${2:?--changed-paths-file needs a path}"; shift 2 ;;
    *) if [ -z "$LOG" ]; then LOG="$1"; elif [ -z "$R" ]; then R="$1"; elif [ -z "$CAMP" ]; then CAMP="$1";
       else echo "PIN_PRECHECK_REFUSED: unexpected argument $1"; exit 2; fi; shift ;;
  esac
done
[ -n "$LOG" ] && [ -n "$R" ] && [ -n "$CAMP" ] || { echo "usage: pin-precheck.sh <gate-log> <repo> <campaign> [--expect-pin-fail <manifest>[:<path>] ...]"; exit 2; }
[ -f "$LOG" ] || { echo "PIN_PRECHECK_REFUSED: no gate log at $LOG"; exit 2; }
grep -q '^== pins ==' "$LOG" || { echo "PIN_PRECHECK_REFUSED: $LOG has no pin block — an absent block is not a clean one (§15.388)"; exit 2; }

# DID THE YARDSTICK MOVE? (`forge-8vfn.7.6.32`, T1 738/740.) This file guards the
# TREE moving between the gate and the merge — it re-derives the failing set and
# refuses when the count disagrees with the log. Nothing guarded the MANIFESTS
# moving, and the consequence was not a missing check but a WRONG DIAGNOSIS:
# `:145` below says "the tree moved", and on 2026-09-11 the tree had not moved at
# all. M6-C amended `M6-C.sha256` fourteen seconds after this script read the pin
# block, so the re-derivation ran against a different denominator than the log's
# numerator. Two instruments, each correct about a different instant.
#
# That is the THIRD time this file has been right that something was wrong and
# wrong about WHAT — skew read as drift (695), behind-main read as undeclared
# drift (707), a manifest edit read as a tree edit (738). Each time the verdict
# survived and the REMEDY was wrong, which costs someone a wrong investigation.
# So this is a DISCRIMINATOR, not a fourth message that reads like the others.
#
# THE ASYMMETRY IS WHY IT IS WORTH A GUARD. The measured instance printed a false
# REFUSAL — loud, self-correcting, costs a re-gate. Had the amendment ADDED rows
# rather than rehashed them, this script would have printed PIN_PRECHECK_OK
# against a manifest that already disagreed with the tree, and the merge would
# have gone through. This file's own header names that as the thing it exists to
# refuse: a failed READ that renders as a pass.
#
# AN ABSENT FINGERPRINT REFUSES, exactly as an absent pin block does. A gate log
# from before `gate.sh` learned to print it is not a clean log; it is one that
# cannot answer. Every lane re-gates once, and that is the correct price.
pin_manifests_now() { sha256sum "$CAMP"/gate-manifests/*.sha256 "$CAMP"/gate-manifests/*.counts 2>/dev/null | sha256sum | cut -c1-16; }
LOG_FP="$(sed -n 's/^PIN_MANIFESTS=\([0-9a-f]\{16\}\)$/\1/p' "$LOG" | head -1)"
if [ -z "$LOG_FP" ]; then
  echo "PIN_PRECHECK_REFUSED: $LOG carries no PIN_MANIFESTS= line — it predates the manifest fingerprint, so it cannot say which manifests its pin block measured. Re-gate (forge-8vfn.7.6.32)."
  exit 2
fi

# ---- 7.6.80: THE RELEVANT SET, NOT THE WHOLE BOX (T1 879) ----
#
# The aggregate fingerprint is one number over EVERY manifest, so any lane's
# reconcile moved it and this refused every merge whose gate finished first.
# Measured on three consecutive merges in one evening — and in all three the
# refusing lane's OWN manifest was untouched. The refusal was correct by its
# own rule and the rule was too wide: a merge's pin precondition is about the
# manifests it DECLARES or TOUCHES.
#
# A manifest outside that set that moved is reported and does not block.
manifest_fp() { sha256sum "$1" "${1%.sha256}.counts" 2>/dev/null | sha256sum | cut -c1-16; }

# PER-MANIFEST LINES ARE REQUIRED — NO AGGREGATE FALLBACK. A log that predates
# them cannot say which manifest moved, and falling back to the aggregate would
# silently restore the starvation this exists to end.
if ! grep -qE '^PIN_MANIFEST [^ ]+=[0-9a-f]{16}$' "$LOG"; then
  echo "PIN_PRECHECK_REFUSED: $LOG carries no per-manifest PIN_MANIFEST lines — it predates forge-8vfn.7.6.80, so it cannot say WHICH manifest moved and this check will not fall back to the aggregate. Re-gate."
  exit 2
fi

# The merge's changed paths. A caller that knows the PR hands them in with
# `--changed-paths-file` (a file, so a large diff cannot overflow a command
# line). A caller that does not gets them DERIVED — never defaulted to empty.
#
# WHY (forge-8vfn.7.6.106). An empty `CHANGED` is not a neutral value here: it
# makes `manifest_is_relevant` return 1 for every manifest the PR does not name
# in `--expect-pin-fail`, so every moved manifest reads as a harmless sibling
# and this check proceeds. D ran exactly that — the flag was never passed,
# `CHANGED` was "", and this file reported that the PR "does not touch" the two
# paths that were its entire diff. The default was silence and silence read as
# a pass, which is what the header refuses for an unreadable diff file.
#
# AND AN EMPTY FILE IS THE SAME HOLE WITH A FILENAME IN FRONT OF IT. `merge-slot`
# already guards this input (T1 909) — but on `gh pr diff`'s EXIT STATUS, not on
# its CONTENT: "gh failed" refuses, "gh succeeded and produced zero lines"
# proceeds, and the next line prints `changed paths handed to pin-precheck: 0`,
# a zero displayed and not enforced. So the emptiness is refused HERE, in the
# only party that knows an empty relevant set is meaningless, rather than in the
# caller that happens to produce it. Fixing only the absent case would leave a
# guard that is leaky in one place instead of two, and a guard like that READS
# as fixed — the remaining hole gets harder to find, because the fix hides it.
#
# THE TWO REFUSALS STAY DISTINCT. "I could not derive" and "you handed me an
# empty diff" are different operator actions — fix the environment versus fix
# the caller — and collapsing them would be the two-facts-one-word species in
# the file that exists to prevent it.
#
# INERT TODAY, AND THE DOORS ARE THE ENTIRE CONTRACT: `merge-slot.sh` always
# passes the flag, so the derivation path below has no live consumer. It is kept
# because it is a REFUSAL, not a convenience — its value is not what it does
# when called, it is that the next caller (a lane running this by hand to debug
# a stuck slot) cannot get a clean verdict out of an unknown diff. A speculative
# convenience earns its keep when something uses it; a speculative refusal earns
# its keep the first time somebody does the wrong thing, and that is the case
# nobody can schedule.
CHANGED=""
if [ -n "$CHANGED_FILE" ]; then
  [ -f "$CHANGED_FILE" ] || { echo "PIN_PRECHECK_REFUSED: --changed-paths-file $CHANGED_FILE does not exist — an unreadable diff is not an empty one"; exit 2; }
  CHANGED="$(cat "$CHANGED_FILE")"
  [ -n "$(printf '%s' "$CHANGED" | tr -d '[:space:]')" ] || { echo "PIN_PRECHECK_REFUSED: --changed-paths-file $CHANGED_FILE exists and is EMPTY — no merge changes zero paths, and an empty relevant set makes every moved manifest read as a harmless sibling. Whatever produced that file reported success and wrote nothing; fix the caller."; exit 2; }
else
  # DERIVED, AND EVERY AMBIGUITY RESOLVES TOWARD INCLUDING THE PATH. Overstating
  # the set makes more manifests relevant — stricter. Understating is the defect
  # above. So the committed diff against the merge base is UNIONED with the
  # working tree's own changes rather than assuming the caller is clean.
  # `--name-only` throughout, deliberately: `status --porcelain` renders a rename
  # as `R  old -> new`, and a path is not a thing to parse an arrow out of.
  # `--no-renames` (T1 1275, C's #868): a `git mv` is a delete of the old path
  # plus an add — with rename detection on, --name-only names the new path only
  # and a pin on the old one reads as untouched.
  git -C "$R" rev-parse --git-dir >/dev/null 2>&1 || { echo "PIN_PRECHECK_REFUSED: no --changed-paths-file, and $R is not a readable git work tree — the changed set cannot be derived. (This fires before the repo-readability check below, so an unreadable $R reaches this message first.) An underived diff is not an empty one; pass --changed-paths-file."; exit 2; }
  git -C "$R" rev-parse --verify --quiet parsoFish/main >/dev/null 2>&1 || { echo "PIN_PRECHECK_REFUSED: no --changed-paths-file, and parsoFish/main does not resolve in $R — there is no base to diff against, so the changed set cannot be derived. Fetch it, or pass --changed-paths-file."; exit 2; }
  cp_base="$(git -C "$R" merge-base parsoFish/main HEAD 2>/dev/null)" || cp_base=""
  [ -n "$cp_base" ] || { echo "PIN_PRECHECK_REFUSED: no --changed-paths-file, and \`git merge-base parsoFish/main HEAD\` found no common ancestor in $R — the changed set cannot be derived."; exit 2; }
  cp_committed="$(git -C "$R" diff --no-renames --name-only "$cp_base" HEAD 2>/dev/null)" || { echo "PIN_PRECHECK_REFUSED: no --changed-paths-file, and \`git diff --name-only $cp_base HEAD\` failed in $R — the changed set cannot be derived."; exit 2; }
  cp_worktree="$(git -C "$R" diff --no-renames --name-only HEAD 2>/dev/null)" || { echo "PIN_PRECHECK_REFUSED: no --changed-paths-file, and \`git diff --name-only HEAD\` failed in $R — the working tree's own changes cannot be read, so the derived set would understate the diff."; exit 2; }
  cp_untracked="$(git -C "$R" ls-files --others --exclude-standard 2>/dev/null)" || { echo "PIN_PRECHECK_REFUSED: no --changed-paths-file, and \`git ls-files --others\` failed in $R — untracked additions cannot be read, so the derived set would understate the diff."; exit 2; }
  CHANGED="$(printf '%s\n%s\n%s\n' "$cp_committed" "$cp_worktree" "$cp_untracked" | grep -v '^[[:space:]]*$' | sort -u)"
  [ -n "$CHANGED" ] || { echo "PIN_PRECHECK_REFUSED: no --changed-paths-file, and the derived changed set is EMPTY — this tree is identical to its merge base with parsoFish/main ($(git -C "$R" rev-parse --short=8 "$cp_base")). No merge changes zero paths, and an empty relevant set makes every moved manifest read as a harmless sibling."; exit 2; }
  echo "PIN_PRECHECK_NOTE: no --changed-paths-file; DERIVED $(printf '%s\n' "$CHANGED" | grep -c .) changed path(s) — \`diff --name-only\` against $(git -C "$R" rev-parse --short=8 "$cp_base") (merge-base with parsoFish/main), unioned with the working tree's own modifications and untracked files"
fi

# EXPANDED IN THE REPO, exactly as `pin-glob-check` does it — `cd "$R" && ls -1 -d`
# under `globstar`. MEASURED, because the obvious shortcut is wrong in BOTH
# directions: bash's `[[ $p == $glob ]]` treats `*` as crossing `/` (so
# `scripts/stories/*.test.ts` would match a nested file that pathname expansion
# never matches) AND requires `**/` to consume a directory (so
# `apps/studio/tests/regression/**/*.test.ts` would MISS a file sitting directly
# in that directory — one of the four paths amendment 34 had to adopt). A
# precheck that disagreed with the glob checker in both directions would be
# worse than the aggregate it replaces.
# THE REPO IS AN INPUT TOO. Every glob is expanded inside it; if it cannot be
# read, every expansion comes back empty and every manifest reads as claiming
# nothing — so a moved manifest would be waved through as a sibling. Checked
# once, loudly, rather than silently per pattern (§15.504).
[ -d "$R" ] && [ -r "$R" ] || { echo "PIN_PRECHECK_REFUSED: repo $R is not a readable directory — no glob can be expanded, so no manifest can be shown to claim any changed path"; exit 2; }

manifest_is_relevant() {
  local man="$1" mname="$2" cpath
  case " $EXPECT " in *" $mname:"*|*" $mname "*) return 0 ;; esac
  [ -n "$CHANGED" ] || return 1
  while IFS= read -r cpath; do
    [ -n "$cpath" ] || continue
    manifest_claims_path "$man" "$cpath" && return 0
  done <<EOF
$CHANGED
EOF
  return 1
}

manifest_claims_path() {
  local man="$1" path="$2" pattern
  awk '{ p=$2; sub(/^\*/,"",p); if (p != "") print p }' "$man" | grep -Fxq -- "$path" && return 0
  [ -f "${man%.sha256}.globs" ] || return 1
  while IFS= read -r pattern; do
    case "$pattern" in ''|'#'*) continue;; esac
    (cd "$R" && eval "ls -1 -d -- $pattern" 2>/dev/null || true) | grep -Fxq -- "$path" && return 0
  done < "${man%.sha256}.globs"
  return 1
}

# T1 1293 — A MOVED MANIFEST REFUSES ONLY ON THE ROWS THIS MERGE OWNS. The gate
# records one fingerprint per manifest, and M6-C (~390 rows) is reconciled after
# every sibling merge, so comparing whole-manifest fingerprints voided every gate
# longer than a merge interval (D's #830/#831 refused for rows they never touched):
# the 7.6.130 shape one file over. So when a relevant manifest moved, the rows for
# the paths this merge TOUCHES are verified against THIS tree: a row that still
# matches the bytes the gate verified is untouched by the move, whatever else the
# reconcile rewrote. A DECLARED row is left to the declared-row check below (it
# must still fail). A whole-manifest declaration keeps every row this merge's and
# refuses as before. (Recovering the gate-time manifest from `.pre-` backups was
# tried first and measured unrecoverable for most real gates: a head=-only
# reconcile rewrites `.counts` with no backup.)
owned_rows_verify() {              # owned_rows_verify <man> <mname> -> 0 when every touched, undeclared row still verifies in $R
  local man="$1" mname="$2" d cpath row bad=0
  for d in $EXPECT; do [ "$d" = "$mname" ] && return 1; done
  while IFS= read -r cpath; do
    [ -n "$cpath" ] || continue
    manifest_claims_path "$man" "$cpath" || continue
    case " $EXPECT " in *" $mname:$cpath "*) continue ;; esac
    row="$(awk -v p="$cpath" '{ q=$2; sub(/^\*/,"",q); if (q == p) print }' "$man")"
    [ -n "$row" ] || continue
    (cd "$R" && printf '%s\n' "$row" | sha256sum -c --quiet >/dev/null 2>&1) || { echo "  touched row no longer verifies here: $cpath"; bad=1; }
  done <<<"$CHANGED"
  return "$bad"
}

pin_relevant_refused=0
for man in "$CAMP"/gate-manifests/*.sha256; do
  [ -f "$man" ] || continue
  mname="$(basename "$man" .sha256)"
  log_one="$(sed -n "s/^PIN_MANIFEST ${mname}=\([0-9a-f]\{16\}\)$/\1/p" "$LOG" | head -1)"
  now_one="$(manifest_fp "$man")"
  if [ -z "$log_one" ]; then
    # UNKNOWN IS NOT A PASS (§15.504). A manifest the gate never measured has no
    # verdict. If this merge neither declares nor touches it that is harmless and
    # reported; if it DOES, proceeding would merge against a manifest nobody
    # checked — the same fail-open as an empty relevant set, one manifest down.
    if manifest_is_relevant "$man" "$mname"; then
      echo "PIN_PRECHECK_REFUSED: $mname is not in the gate's pin block at all — it did not exist when the gate ran — and THIS merge declares or touches it. There is no verdict to rely on. Re-gate."
      pin_relevant_refused=1
    else
      echo "PIN_SIBLING_ABSENT $mname — not measured by this gate, and this merge neither declares it nor touches a path it claims"
    fi
    continue
  fi
  [ "$log_one" = "$now_one" ] && continue

  # It moved. Is it THIS merge's business?
  relevant=0
  manifest_is_relevant "$man" "$mname" && relevant=1

  if [ "$relevant" -eq 1 ]; then
    if owned_rows_verify "$man" "$mname"; then
      echo "PIN_SIBLING_MOVED $mname ($log_one → $now_one) — manifest moved on untouched rows — noted; every row this merge touches still verifies in this tree, and its declared rows are checked below"
      continue
    fi
    echo "PIN_PRECHECK_REFUSED: $mname changed between the gate and this precheck ($log_one → $now_one) and THIS merge declares or touches it — the gate's pin block is a verdict about a manifest that no longer exists. Re-gate; do NOT paste the old numbers."
    pin_relevant_refused=1
  else
    echo "PIN_SIBLING_MOVED $mname ($log_one → $now_one) — another lane reconciled it mid-gate; this merge neither declares it nor touches a path it claims, so it is reported and not refused (forge-8vfn.7.6.80)."
  fi
done
[ "$pin_relevant_refused" -eq 0 ] || exit 2

NOW_FP="$(pin_manifests_now)"

# 699 ADDENDUM, D's half: A REFUSED STEP STILL PRINTS A PIN BLOCK. `gate.sh`
# records a lock refusal as `REFUSED  <step>  (0s) — <holder>` and carries on to
# the pins, so a precondition reading only the pin block would record green over
# a gate whose `npm test` NEVER EXECUTED. The pins are true; the gate is not a
# verdict about this tree's tests.
#
# The property, once: A REFUSAL, A MISSING FILE AND A ZERO COUNT MUST EACH BE
# DISTINGUISHABLE FROM A PASS. Every failure this file has caught is one of the
# three collapsing into the fourth — an absent pin block reading as clean, a
# stale `git rev-parse` after a failed fetch reading as a SHA, an empty `gh` read
# reading as "no checks", a `kill(pid, 0)` on a zombie reading as "running".
if grep -q '^REFUSED ' "$LOG"; then
  echo "PIN_PRECHECK_REFUSED: $LOG contains a REFUSED step — the gate did not run, so its pin block is not a verdict about this tree:"
  grep '^REFUSED ' "$LOG" | sed 's/^/  /'
  exit 2
fi
[ -d "$CAMP/gate-manifests" ] || { echo "PIN_PRECHECK_REFUSED: $CAMP has no gate-manifests/"; exit 2; }

# BEHIND MAIN IS ITS OWN ANSWER, and it is the commonest one. A manifest's
# `head=` is a CLAIM about which tree it describes, and nothing verifies it — a
# reconcile that rehashes the bytes but leaves `head=` at an older sha makes the
# skew test above answer "no skew" for a tree that is simply behind. Measured:
# M6-D pinned main's current bytes while carrying `head=c1a751ea`, so a branch
# three merges back was told it had undeclared DRIFT in another lane's file.
#
# The verdict was right (these bytes differ from the pin) and the REMEDY was
# wrong ("reconcile it, or declare it" — neither, when the fix is to rebase). So
# check the tree against MAIN once, up front, and say which situation the reader
# is in before naming any path.
BEHIND=""
if git -C "$R" rev-parse --verify --quiet parsoFish/main >/dev/null 2>&1; then
  git -C "$R" merge-base --is-ancestor parsoFish/main HEAD >/dev/null 2>&1 || BEHIND="$(git -C "$R" rev-parse --short=8 parsoFish/main)"
fi
[ -n "$BEHIND" ] && echo "PIN_PRECHECK_NOTE: this tree does NOT contain parsoFish/main ($BEHIND). A pin that differs here may be a file main has moved since, not drift you introduced — rebase and re-run before reconciling or declaring anything below."

# 7.6.101 — ONE CLASSIFIER. TWO CHECKERS ON ONE QUESTION MEANS TEACHING ONE AND
# THE OTHER BECOMES THE DEFECT (§15.531).
#
# 7.6.97 taught `gate.sh` to classify a FAILED pin row as `PIN_SIBLING_STALE`
# when the manifest is not the gating lane's, the path is not in the PR's diff,
# and the checkout's bytes equal main's. It did not teach THIS file, which
# re-derives the same question — so on D's gate the two disagreed in the same
# run: five rows classified and `GATE_RC=0`, then `pin-precheck` refusing all
# five. `grep -c PIN_SIBLING_STALE` here was 0.
#
# THE REMEDY IT OFFERED WAS THE WORSE HALF: "declare it with --expect-pin-fail
# M6-C:…" told D to make a false claim about their own PR — the laundering three
# rulings had already refused, arriving as a tool's default suggestion.
#
# SO THIS CONSUMES THE CLASSIFICATION RATHER THAN LEARNING IT. Teaching this file
# the three conjuncts would give two implementations of one rule, and the next
# divergence would be subtler than this one BECAUSE BOTH WOULD BE NEARLY RIGHT —
# they would agree everywhere except the edges, which is where nobody looks and
# where the answer matters. The gate log is already this file's input; the
# verdict is already written in it.
#
# WHAT IT STILL CHECKS ITSELF, because it is a different question. "Whose drift
# is this" is the gate's; "is that verdict still current" is this file's — the
# tree can move between the gate and the merge (§15.381). So an excused row is
# re-verified byte-equal to main HERE, and when that fails the message says
# WHICH of the two refused it, because `PIN_PRECHECK_REFUSED` meaning two
# different things is how the next investigation goes wrong.
SIBLING_STALE=""
if [ -n "$LOG" ] && [ -f "$LOG" ]; then
  SIBLING_STALE="$(sed -n 's/^[[:space:]]*PIN_SIBLING_STALE \([^[:space:]]*\).*/\1/p' "$LOG" | sort -u | tr '\n' ' ')"
fi

manifest_owner() {
  local c="$CAMP/gate-manifests/$1.counts"
  [ -f "$c" ] || return 1
  grep -o 'owner=[^ ]*' "$c" | head -1 | cut -d= -f2
}

# Still equal to main's bytes RIGHT NOW — the gate said so at gate time, and the
# tree may have moved since. Re-verified, never re-classified.
still_matches_main() {
  local p="$1" main_blob here_blob
  git -C "$R" rev-parse --verify --quiet parsoFish/main >/dev/null 2>&1 || return 1
  main_blob="$(git -C "$R" rev-parse --verify --quiet "parsoFish/main:$p" 2>/dev/null)" || return 1
  here_blob="$(cd "$R" && git hash-object -- "$p" 2>/dev/null)" || return 1
  [ -n "$main_blob" ] && [ "$main_blob" = "$here_blob" ]
}

rc=0
declared_seen=""
for m in "$CAMP"/gate-manifests/*.sha256; do
  [ -f "$m" ] || continue
  man="$(basename "$m" .sha256)"
  # The failing SET, re-derived. `grep -vc ': OK$'` would also count sha256sum's
  # WARNING line (§15.105), so match the failure shapes explicitly.
  actual="$( (cd "$R" && sha256sum -c "$m" 2>&1) | sed -n 's/^\(.*\): FAILED$/\1/p; s/^sha256sum: \(.*\): No such file or directory$/\1/p' | sort -u )"
  n_actual="$(printf '%s' "$actual" | grep -c . || true)"

  # The sha this manifest was last verified at, when it records one. Only some
  # `.counts` carry `head=`; without it skew is unknown and the set is read as-is
  # rather than excused — a check that stayed QUIET for every manifest lacking
  # the field would rebuild `forge-e8dn` one manifest at a time.
  counts="${m%.sha256}.counts"
  pinned_head=""
  [ -f "$counts" ] && pinned_head="$(grep -o 'head=[0-9a-f]\{7,40\}' "$counts" | head -1 | cut -d= -f2)"

  # SKEW MAKES A NON-ZERO SET UNREADABLE -- IT DOES NOT INVALIDATE AN EMPTY ONE
  # (T1 684 / §15.381, and the first version of THIS file had the defect it
  # describes). `sha256sum -c` verifies HASHES, so an empty failing set from a
  # tree AHEAD of the pin is a true statement: the pinned bytes still hold here.
  # A NON-EMPTY set from a tree that does not contain the pin's `head=` cannot be
  # told apart from drift, because a MISSING or DIFF line may simply be a file
  # the pin predates.
  #
  # MEASURED THIS AFTERNOON, TWICE, IN BOTH DIRECTIONS. A reported "M6-C 13
  # FAILED of 198" from a tree one merge behind and sent it upward as my drift;
  # my tree was 0/0 and seven of the nine were files that did not exist in A's
  # checkout yet. Then I did the same thing to T1 — "M6-T1 2 FAILED in my tree" —
  # when my tree simply predated T1's reconcile of M6-T1, which verifies 0 at
  # main. Naming skew as drift sends the wrong lane to fix a file that is fine.
  #
  # It still REFUSES: unreadable is not clean. What changes is the diagnosis and
  # the remedy, and the exit code, so a caller can tell "this PR has an
  # unaccounted change" from "this tree cannot answer the question".
  if [ "$n_actual" -gt 0 ] && [ -n "$pinned_head" ] && ! git -C "$R" merge-base --is-ancestor "$pinned_head" HEAD 2>/dev/null; then
    echo "PIN_PRECHECK_SKEW: $man has $n_actual non-OK from a tree that does not contain $pinned_head, the sha it was last verified at — skew and drift are indistinguishable from here (§15.381). Advance this tree to $pinned_head or later and re-run; do NOT report these as another lane's drift."
    [ "$rc" -eq 0 ] && rc=4
    continue
  fi

  # THE DISAGREEMENT CHECK RUNS ONLY ONCE SKEW IS RULED OUT, and that ordering is
  # a bug this file shipped with. On its first real merge it printed BOTH
  # "the tree moved between the gate and the merge" AND "this is skew" for the
  # same manifest — two refusals for one fact, the first of which invites the
  # reader to go looking for a race that did not happen. When a tree does not
  # contain a manifest's `head=`, a differing count is EXPECTED and says nothing;
  # only a tree that DOES contain it can have the log and the bytes disagree in a
  # way worth acting on.
  n_log="$(sed -n "s/^${man}\.sha256: \([0-9][0-9]*\) FAILED of .*/\1/p" "$LOG" | head -1)"
  # T1 1293: a COUNT that moved is not a refusal on its own. A reconcile of rows
  # this merge does not own changes the count (D's #830/#831 refused for exactly
  # that); every row that fails NOW is still accounted one by one below, and every
  # declared row must still fail (the loop after this one) — the two checks that
  # speak for the rows this merge owns.
  if [ -n "$n_log" ] && [ "$n_log" != "$n_actual" ]; then
    echo "PIN_PRECHECK_NOTE: $man — the gate log says $n_log FAILED, this tree says $n_actual: the manifest moved between the gate and this merge; noted, not refused — each failing row is accounted below and each declared row must still fail (T1 1293)"
  fi

  for p in $actual; do
    case " $EXPECT " in
      *" $man:$p "*) echo "PIN_ACCOUNTED $man:$p — declared by this PR"; declared_seen="$declared_seen $man:$p" ;;
      *)
        # The gate already classified this row as another lane's stale pin.
        case " $SIBLING_STALE " in
          *" $man:$p "*)
            if still_matches_main "$p"; then
              echo "PIN_ACCOUNTED $man:$p — PIN_SIBLING_STALE in the gate log (owner $(manifest_owner "$man" || echo unknown) owes a reconcile); re-verified byte-equal to parsoFish/main here, so the gate's verdict is still current"
              declared_seen="$declared_seen $man:$p"
              continue
            fi
            # 7.6.101: WHICH check refused, named. The gate excused this row and
            # THIS file is overriding it on its own question — skew, not
            # classification — and a reader must not have to guess which.
            echo "PIN_PRECHECK_REFUSED: $man:$p was PIN_SIBLING_STALE at gate time but its bytes NO LONGER equal parsoFish/main — the tree moved between the gate and this merge (§15.381), so the gate's verdict is stale. This is the SKEW check refusing, not the classification. Re-gate on a current tree."
            rc=3
            continue ;;
        esac
        # 7.6.101: the remedy depends on WHOSE row it is, and `--expect-pin-fail`
        # is only ever right for a path in this PR's OWN diff. Offering it
        # unconditionally is what told D to declare another lane's file.
        own_diff=0
        case "
$CHANGED
" in *"
$p
"*) own_diff=1 ;; esac
        owner="$(manifest_owner "$man" || echo unknown)"
        if [ -n "$BEHIND" ]; then
          echo "PIN_PRECHECK_REFUSED: $man:$p FAILED, and this tree is BEHIND parsoFish/main ($BEHIND) — rebase first; neither reconciling nor declaring is the fix while the tree is behind"
        elif [ "$own_diff" -eq 1 ]; then
          echo "PIN_PRECHECK_REFUSED: $man:$p FAILED and this PR CHANGES that path without declaring it — declare it with --expect-pin-fail $man:$p, or reconcile it if the change is already on main"
        else
          echo "PIN_PRECHECK_REFUSED: $man:$p FAILED and this PR does not touch that path — owner $owner owes a reconcile; wait for it or ask T1. DO NOT declare another owner's row: --expect-pin-fail is a claim about THIS PR's own diff (925)."
        fi
        rc=3 ;;
    esac
  done
done

# The other direction: a declaration that did not come true.
for d in $EXPECT; do
  case "$d" in *:*) ;; *) echo "PIN_PRECHECK_REFUSED: --expect-pin-fail $d names a manifest with no path — declare paths, not manifests (a blanket passes the failure you did not foresee)"; rc=3; continue ;; esac
  # A DECLARATION NAMES A ROW THIS PR CHANGED — forge-8vfn.7.6.126 (T1 1113, C's
  # gate 777). A deriver that compared against a stale local `parsoFish/main`
  # after `update-branch` listed ANOTHER LANE's row as this PR's; the row really
  # was FAILED (the manifest was behind main), so it was accounted as "declared
  # by this PR" and a real exit 0 rested on a claim that was false. §15.566
  # fixes the derivers; this is the belt on the instrument that consumed the
  # claim, so the failure is an ERROR for every lane rather than a longer list
  # whose extra entries look legitimate. The changed set is exactly the input
  # this file already refuses to run without.
  d_path="${d#*:}"
  case "
$CHANGED
" in *"
$d_path
"*) ;;
    *) echo "PIN_PRECHECK_REFUSED: $d was declared as an expected pin failure but this PR does NOT change $d_path — a declaration names a row this PR changed; a list carrying another lane's row was derived against a stale base (§15.566, 7.6.126). Re-derive against a FETCHED parsoFish/main and re-gate."; rc=3; continue ;;
  esac
  case " $declared_seen " in
    *" $d "*) ;;
    *) echo "PIN_PRECHECK_REFUSED: $d was declared as an expected pin failure and did NOT fail — the PR's account of itself is wrong; either it was already reconciled or the declaration was a guess"; rc=3 ;;
  esac
done

[ "$rc" -eq 0 ] && echo "PIN_PRECHECK_OK: every manifest in $CAMP agrees with $LOG, and every failure is declared at path level [PIN_MANIFESTS (sha256+counts) $LOG_FP]"
[ "$rc" -eq 4 ] && echo "PIN_PRECHECK_UNREADABLE: no undeclared drift found, but at least one manifest could not be read across skew — advance the tree and re-run [PIN_MANIFESTS (sha256+counts) $LOG_FP]"
exit $rc
