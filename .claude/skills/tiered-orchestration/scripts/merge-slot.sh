#!/usr/bin/env bash
# merge-slot.sh <pr> <out> — take the slot for MUTATIONS ONLY, wait outside it.
#
# T1 ruling 609 / §15.336. The previous shape held `flock` across the CI wait,
# so every lane's PR mutations serialised behind one lane's checks — 5-8 minutes
# per PR. Lane A measured it from outside (this script's flock holding while D's
# `gh pr create` queued and A queued behind D) rather than working around it.
# 530 puts MUTATIONS under the slot; a create or a merge is milliseconds, and a
# CI wait is neither a mutation nor short.
#
#   [slot: update-branch; record MAIN_AT] → release
#   ci-terminal.sh --wait on the post-update head, OUTSIDE the slot
#   [slot: re-read main; if moved → update-branch + re-wait; else merge] → release
#
# THIRD ATTEMPT ONLY (ruling 635): the slot is HELD across the wait — the
# pre-609 shape, once — so a PR that has already lost the race twice cannot lose
# it a third time. Lane A's #622 threw away three green CI runs to this.
#
# SHARED SCRIPT (ruling 610): all lanes use this one. Launch it `setsid`-detached
# — §15.335: any foreground command outliving 120 s is auto-backgrounded and
# reapable, a `gh` call queued on a lock included.
#
# 550 STILL HOLDS: the wait is on the EXACT post-update-branch head, and the
# merge re-reads that head under the slot before merging. If a sibling's merge
# moves main in between, strict protection refuses the stale head — that is not
# an error to retry blindly, it is a signal to update-branch and wait again, so
# this loops rather than forcing.
#
# §15.296: an empty read is a FAILED READ, never a state — including
# `gh pr list` returning nothing while a PR is demonstrably open. Every head
# read is retried once and REFUSES rather than merging on a head it could not
# read.
set -u
# ---- EXIT CODES (forge-8vfn.7.6.145, T1 ruling 1150) ----
# WHY: every `MARKER=done RESULT=…` refusal below used to `exit 0`, and the
# success path fell off the end at rc 0 whatever the closing `gh pr view` said
# — D's launcher printed `merge-slot rc=0` over a PR that had NOT merged,
# because the MARKER line carries the truth only by convention and a launcher
# keying on the exit code read a refused merge as a merge. Defined ONCE here,
# by name, and used by name at every site below; the MARKER=done RESULT=…
# line's TEXT is unchanged everywhere this campaign already reads it — only
# the exit status changes. The `MERGE_SLOT_CHANGED_ONLY=1` query verb (below)
# is a different contract and keeps its own 0/1/2 untouched.
EXIT_MERGED=0            # STATE=MERGED, re-derived at the close — never assumed from rc=0
EXIT_USAGE=2             # usage / OUT-EXISTS
EXIT_GATE_UNKNOWN=10     # GATE-LOG-UNREADABLE, GATE-EXIT-UNREAD, GATE-CHECKOUT-UNREAD,
                         # GATE-REFUSED-NOT-RED, GATE-RED-UNNAMED, GATE-RED-MULTIPLE,
                         # GATE-RED-NO-ALONE-PROOF, GATE-RED-NOT-A-KNOWN-FLAKE, and the
                         # waiver-fallthrough that reaches none of the named branches
EXIT_PIN=11              # PIN_PRECHECK_REFUSED (both sites), PINS-NOT-ACCOUNTED,
                         # NO-PIN-PRECONDITION, PINNED-PATH-GAINED-SINCE-GATE
EXIT_CI_NOT_GREEN=12     # CI-NOT-GREEN (both sites, incl. the held-slot third attempt)
EXIT_CAP_BREACHED=13     # CAP-BREACHED-AT-MERGE
EXIT_HEAD_MAIN_UNREAD=14 # MAIN_AT-UNREAD, HEAD-UNREAD, MAIN-UNREAD, HEAD-CHANGED
EXIT_STARVED=15          # STARVED
EXIT_UPDATE_CONFLICT=17  # UPDATE-BRANCH-CONFLICT — main cannot be merged into the PR; CI on the stale head is never waited on
EXIT_MERGE_UNVERIFIED=16 # gh pr merge said rc=0 but the closing re-derivation is not
                         # STATE=MERGED
# T1 693/695. THE PIN PRECONDITION LIVES HERE, not in each lane's own gate.
#
# `gate.sh` exits on its STEP LIST only; its pin block prints beside the rc and
# never feeds it, so a gate can be rc=0 / 20-of-20 with a manifest failing in the
# same log — D's `d7d8dba9` was exactly that, and its merge precondition recorded
# green over two failing pins. Worse, a lane whose gate never CALLS `gate.sh`
# prints no pin block at all, and every merge it makes passes a precondition that
# does not exist: measured on M6-C's own wrappers, §15.390.
#
# Every lane already funnels its merges through this script, and a check each
# lane has to remember to run is a check that gets skipped on the night it
# matters — so it is enforced here, once, for everyone. Set `PIN_GATE_LOG` to the
# gate log and optionally `PIN_EXPECT` to the space-separated
# `<manifest>:<path>` failures this PR accounts for.
#
# OPT-IN BY ENVIRONMENT, deliberately: making it mandatory today would refuse
# every in-flight merge from a lane that has not wired its log yet, and a
# precondition introduced as an outage is one that gets removed. It becomes
# mandatory when every lane's gate calls `gate.sh` (695(i)).
# SKILL-COPY MOVE (M7 findings row 37, T1 ruling 1227 B): this script now lives
# in the skill's own scripts dir, invoked from whichever worktree is merging —
# never from its own directory. `HERE` is how it finds its SIBLINGS
# (ci-terminal.sh, pin-precheck.sh), the same idiom `gate.sh`/`lanes.sh` already
# use (`"$HERE/gate-rerun-alone.sh"`, `"$HERE/../lane-protocol.md"`); every OTHER
# path — the campaign directory, the repo the cap check clones from — stays an
# argument, never resolved from this file's own location (§15.148).
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PR="$1"; OUT="$2"
GH() { GH_TOKEN="$(gh auth token --user parsoFish)" gh "$@"; }
# THE MERGE'S CHANGED PATHS (forge-8vfn.7.6.145, T1 1150; D's #790). `gh pr diff
# --name-only` answers HTTP 406 above 300 files — #790 (313 demos/e2e deletions)
# was the first PR in the repo's last forty to cross it, and every re-run
# returns the same 406. The List-files API paginates past the cap. THE
# CROSS-CHECK IS THE POINT: a `--paginate` that dies mid-way returns a PARTIAL
# set that looks complete, and a partial changed set fails exactly as the empty
# one did (T1 909) — quietly, by making a moved manifest look irrelevant. So the
# count is compared against `gh pr view --json changedFiles`, an independent
# reading, and any mismatch refuses. Three outcomes, three exit codes:
#   0 complete · 1 unreadable (gh failed / count unparsable) · 2 incomplete
pr_changed_paths() {          # pr_changed_paths <pr> <outfile>
  local pr="$1" out="$2" n_api n_pr
  local rows; rows="$(mktemp /tmp/merge-slot-rows-XXXXXX)"
  # T1 1275 (C's #868): a rename is ONE files-API row whose SOURCE path sits in
  # previous_filename — the old path is deleted, so it is in the changed set.
  GH api "repos/parsoFish/forge-studio/pulls/$pr/files" --paginate --jq '.[] | [.filename, (.previous_filename // "")] | @tsv' > "$rows" 2>/dev/null || { rm -f "$rows"; return 1; }
  n_pr="$(GH pr view "$pr" --json changedFiles --jq .changedFiles 2>/dev/null)" || { rm -f "$rows"; return 1; }
  case "$n_pr" in ''|*[!0-9]*) rm -f "$rows"; return 1 ;; esac
  n_api="$(grep -c . "$rows")"
  tr '\t' '\n' < "$rows" | grep . > "$out"; rm -f "$rows"
  [ "$n_api" -eq "$n_pr" ] || { CHANGED_MISMATCH="$n_api $n_pr"; return 2; }
  return 0
}
# QUERY VERB (a test seam and a debugging hand): print the changed set and exit,
# writing nothing to <out>. Same three exit codes; a refusal prints its reason.
if [ "${MERGE_SLOT_CHANGED_ONLY:-}" = 1 ]; then
  tmp_q="$(mktemp /tmp/merge-slot-changed-XXXXXX)"
  pr_changed_paths "$PR" "$tmp_q"; q_rc=$?
  case "$q_rc" in
    0) cat "$tmp_q" ;;
    1) echo "RESULT=CHANGED-SET-UNREADABLE — gh could not list PR $PR's files or its changedFiles count" ;;
    2) echo "RESULT=CHANGED-SET-INCOMPLETE — the files API returned ${CHANGED_MISMATCH% *} path(s) but the PR reports ${CHANGED_MISMATCH#* } changed files; a partial set fails like an empty one (T1 909)" ;;
  esac
  rm -f "$tmp_q"; exit "$q_rc"
fi
# AN EXISTING <out> IS REFUSED, NOT TRUNCATED (forge-8vfn.7.6.138, T1 1137). A
# misdirected launch (`merge-slot.sh 781 merge-781.log` fired for #785) was
# stopped by two refusals — and had already destroyed PR 781's real merge log,
# leaving a file whose header said pr=781 and whose result said
# PINS-NOT-ACCOUNTED, about a PR that had merged. A log stating the opposite of
# what happened is worse than an absent one. The check runs before the first
# byte is written; an explicit MERGE_SLOT_OVERWRITE_OUT=1 is the only way past.
if [ -s "$OUT" ] && [ "${MERGE_SLOT_OVERWRITE_OUT:-}" != 1 ]; then
  echo "MARKER=done RESULT=OUT-EXISTS — $OUT already holds $(wc -c < "$OUT") bytes (first line: $(head -1 "$OUT" | cut -c1-80)); refusing to truncate another run's record. Name a fresh <out>, or set MERGE_SLOT_OVERWRITE_OUT=1 if this file is yours to destroy." >&2
  exit "$EXIT_USAGE"
fi
: > "$OUT"
# WHOSE MERGE, SINCE WHEN — ANSWERABLE FROM THE ARTIFACT (lane A, folded into
# forge-8vfn.7.6.90 by T1 915). The slot lock is RELEASED during the CI wait by
# design (609), so "is a merge in flight" cannot be answered by the lock, and a
# lane that asked the lock instead of the process overwrote this very file under
# a live run. This line makes the question cheap for anyone: the log's own first
# line names the pid, its worktree, the PR and the start time.
printf 'MERGE-SLOT pid=%s cwd=%s pr=%s started=%s\n' "$$" "$(pwd)" "$PR" "$(date '+%FT%T%z')" >> "$OUT"
# THE PATHS BELOW ARE ALL OVERRIDABLE SO THIS FILE CAN HAVE DOORS AT ALL.
# Precedent, not invention: `gate.sh` takes `FORGE_PROC_LOCKS` and
# `save-instrument.sh` takes `SAVE_INSTRUMENT_PROCDIR` / `SAVE_INSTRUMENT_LOCK`
# for exactly this reason — a guard whose only lock is the REAL one cannot be
# exercised without taking it, and taking the live merge slot in a test is the
# hazard `forge-8vfn.7.6.90` exists to prevent.
#
# SKILL-COPY MOVE: this file used to sit IN the campaign directory it served,
# so a literal here doubled as "this campaign" and nothing forced the two to
# agree. Moved into the skill, a literal would name a SPECIFIC campaign (this
# one) forever, answering a different question for the next one (§15.148 — the
# same reasoning `gate.sh` already applies to its own `CAMP` argument, and the
# same distinction it draws for `FORGE_SUITE_LOCK` being DERIVED from `CAMP`
# rather than named separately). So `MERGE_SLOT_CAMPAIGN_DIR` is the one
# REQUIRED path — refused, by name, if unset — and everything the campaign
# itself owns (the lock, the pin manifests, the known-flakes register) DERIVES
# from it unless independently overridden, exactly as `FORGE_SUITE_LOCK` derives
# from `CAMP` in `gate.sh`. `REPO_FOR_CAPS` is NOT campaign state — it is the
# checkout the cap check clones from — so it stays its own required path with
# no derivation to fall back on.
CAMPAIGN_DIR="${MERGE_SLOT_CAMPAIGN_DIR:?MERGE_SLOT_CAMPAIGN_DIR must name the campaign directory for this run (it holds the merge-slot lock, gate-manifests/, and known-flakes.md); a merge precondition cannot guess it (§15.148)}"
SLOT="${MERGE_SLOT_LOCK:-$CAMPAIGN_DIR/.merge-slot}"
# The object store the cap check clones from. Named, not derived from $PWD:
# this script is invoked from whichever lane worktree is merging, and a
# clone source resolved from the caller answers a different question in
# each checkout (§15.148). Declared here so `set -u` cannot meet it unset.
REPO_FOR_CAPS="${MERGE_SLOT_REPO_FOR_CAPS:?MERGE_SLOT_REPO_FOR_CAPS must name the repo the cap check clones from}"
# SIBLINGS, resolved from THIS file's own directory — never from the campaign,
# never from $PWD. `ci-terminal.sh` and `pin-precheck.sh` ship in the same
# skill scripts dir this file does, so `$HERE` (gate.sh's / lanes.sh's own
# idiom: `"$HERE/gate-rerun-alone.sh"`, `"$HERE/../lane-protocol.md"`) is what
# finds them, whatever campaign or worktree invokes this script.
CI_TERMINAL="${MERGE_SLOT_CI_TERMINAL:-$HERE/ci-terminal.sh}"
PIN_PRECHECK_SH="${MERGE_SLOT_PIN_PRECHECK:-$HERE/pin-precheck.sh}"
# forge-8vfn.7.6.130: where the live pin manifests are, so the
# PINNED-PATH-GAINED-SINCE-GATE check below can be exercised by doors against a
# fixture directory instead of the production one — same seam shape as SLOT /
# REPO_FOR_CAPS / CI_TERMINAL above. Defaults under the required CAMPAIGN_DIR;
# an explicit override still wins.
MANIFEST_DIR="${MERGE_SLOT_MANIFEST_DIR:-$CAMPAIGN_DIR/gate-manifests}"
# Same shape as MANIFEST_DIR: the flake register is this campaign's own state,
# so it defaults under CAMPAIGN_DIR and stays independently overridable.
KNOWN_FLAKES="${MERGE_SLOT_KNOWN_FLAKES:-$CAMPAIGN_DIR/known-flakes.md}"
# TIMING, overridable for the same reason the paths above are: a door suite
# cannot exercise 30-odd shapes through the real production intervals (12s +
# 8s minimum per attempt, up to three attempts) without costing minutes it
# does not need to spend — these numbers are a courtesy to GitHub's API, not
# a correctness requirement the doors' fake `gh`/`ci-terminal` stubs need.
# Defaults are the production values, so an unset environment behaves exactly
# as before.
SLEEP_HEAD_RETRY="${MERGE_SLOT_HEAD_RETRY_SLEEP_SECS:-20}"       # read_head()'s own retry
SLEEP_POST_UPDATE="${MERGE_SLOT_POST_UPDATE_SLEEP_SECS:-12}"     # settle after update-branch, before reading HEAD
SLEEP_MAIN_MOVED="${MERGE_SLOT_MAIN_MOVED_RETRY_SLEEP_SECS:-10}" # backoff before re-attempting on MAIN-MOVED
SLEEP_MERGE_RETRY="${MERGE_SLOT_MERGE_RETRY_SLEEP_SECS:-30}"     # backoff before re-attempting on any other merge refusal
SLEEP_FINAL_SETTLE="${MERGE_SLOT_FINAL_SETTLE_SLEEP_SECS:-8}"    # before the closing re-derivation
PIN_GATE_LOG="${PIN_GATE_LOG:-}"
PIN_EXPECT="${PIN_EXPECT:-}"
GH() { GH_TOKEN="$(gh auth token --user parsoFish)" gh "$@"; }
say() { echo "$(date +%H:%M:%S) $*" >> "$OUT"; }


# Refuse BEFORE the first mutation — an update-branch is already a write.
if [ "$PIN_GATE_LOG" = none ]; then
  # TESTED FIRST, because `none` is a non-empty string: under the `-n` branch
  # below it would be read as the PATH to a gate log and refused as "no gate log
  # at none". My own three-path exercise caught that before this was saved.
  say "PIN_PRECHECK_DECLARED-NONE — this merge states it has no pin precondition (§15.434). The declaration is the record; an unset variable is not."
elif [ -n "$PIN_GATE_LOG" ]; then
  # shellcheck disable=SC2086 — PIN_EXPECT is a deliberate word-split list.
  pin_args=""
  for d in $PIN_EXPECT; do pin_args="$pin_args --expect-pin-fail $d"; done
  # ---- 7.6.86: THE GATE'S VERDICT IS READ, NOT ONLY ITS PIN BLOCK ----
  #
  # This script read the handed gate log for PINS and never for the VERDICT, so
  # a lane that chained `gate.sh && merge-slot.sh` in one command block merged
  # on a red gate — the red was a known flake and CI was independently green, so
  # the content was sound, but that was established AFTERWARDS. The defect is
  # not the missed check: chaining makes the verdict UNREADABLE BY CONSTRUCTION,
  # with no moment at which looking could have changed the outcome (§15.501).
  #
  # A waiver exists because a known load-flake should not cost a re-gate, and it
  # is deliberately hard to satisfy: a waiver that is easy becomes the path
  # everyone takes.
  # `grep -c` PRINTS 0 AND EXITS 1 when nothing matches, so `|| echo 0` yields
  # the two-line string "0\n0" and every later `-gt` dies with "integer
  # expression expected" — measured on the GREEN branch, which then passed by
  # accident because a failed `[` is false. The count is already always printed;
  # the fallback is for an unreadable file, not for a zero match.
  # AND THE LOG ITSELF IS AN INPUT. Unreadable, it yields zero FAIL rows, which
  # reads as a clean gate — the same fail-open one line down, on the file the
  # whole verdict is drawn from.
  if [ ! -r "$PIN_GATE_LOG" ]; then
    say "MARKER=done RESULT=GATE-LOG-UNREADABLE — $PIN_GATE_LOG cannot be read, so this merge has no gate verdict. An unreadable log is not a green one."
    exit "$EXIT_GATE_UNKNOWN"
  fi
  gate_fails="$(grep -cE '^FAIL ' "$PIN_GATE_LOG" 2>/dev/null)"; gate_fails="${gate_fails:-0}"
  gate_exit="$(sed -n 's/^GATE_SH_EXIT=\([0-9]*\)$/\1/p' "$PIN_GATE_LOG" | tail -1)"
  # THE MARKER'S ABSENCE IS NOT "NOT RED" (D's finding, T1 1104; producer #778).
  # Until #778 nothing in gate.sh wrote this line — one lane's wrapper did — so
  # for every other lane `gate_exit` was empty, the refusal branch below could
  # not fire, and the only protection left was the FAIL row count, which a
  # refusal by definition does not produce. Now that gate.sh writes its exit
  # status as its last line on every run path, a log WITHOUT it is a log from a
  # gate.sh older than the producer, or not a gate log at all: UNKNOWN, re-gate.
  if [ -z "$gate_exit" ]; then
    say "MARKER=done RESULT=GATE-EXIT-UNREAD — $PIN_GATE_LOG carries no GATE_SH_EXIT= line. gate.sh writes its exit status as the last line of every run since #778 (T1 1104); a log without it came from an older gate.sh or is not a gate log, and absence is not not-red. Re-gate on current main."
    exit "$EXIT_GATE_UNKNOWN"
  fi
  # A REFUSAL IS NOT A FAILURE, AND IS NOT WAIVABLE (T1 699, applied here by D's
  # question before this shipped). `gate.sh:509-511` exits `$fail` (1) for a real
  # failure and **3** for a refusal with no FAIL row — "a real failure outranks a
  # refusal". The first version of this block tested only `exit != 0`, so a
  # refused `npm test` — a sibling's story run holding the run-lock — printed
  # GATE-RED-UNNAMED and invited the lane to NAME it and waive it through the
  # flake path. A refusal is UNKNOWN: it says the step never ran, so there is no
  # verdict to waive and the only honest answer is to gate again.
  if [ "$gate_fails" -eq 0 ] && [ "${gate_exit:-0}" = 3 ]; then
    say "MARKER=done RESULT=GATE-REFUSED-NOT-RED — the gate exited 3 with no FAIL step: a step was REFUSED and never ran (§15.92, T1 699). That is UNKNOWN, not red, and a waiver cannot apply to a verdict that does not exist. Re-gate."
    exit "$EXIT_GATE_UNKNOWN"
  fi
  if [ "$gate_fails" -gt 0 ] || { [ -n "$gate_exit" ] && [ "$gate_exit" != 0 ]; }; then
    waived=0
    named="${GATE_RED_NAMED:-}"
    # (iv) EXACTLY ONE red step. Two reds refuse regardless of names: a waiver is
    # for the named flake, not for a red suite (T1 895).
    if [ -z "$named" ]; then
      say "MARKER=done RESULT=GATE-RED-UNNAMED — the gate log records $gate_fails FAIL step(s) (GATE_SH_EXIT=${gate_exit:-?}) and nothing names the red. A gate whose verdict is not read is a gate that never ran (§15.501). Set GATE_RED_NAMED=<test> with an alone-rerun line in the log and a known-flakes entry, or fix the red."
      exit "$EXIT_GATE_UNKNOWN"
    elif [ "$gate_fails" -gt 1 ]; then
      say "MARKER=done RESULT=GATE-RED-MULTIPLE — $gate_fails FAIL steps. A waiver names ONE flake; two reds are a red suite and refuse regardless of names (T1 895)."
      exit "$EXIT_GATE_UNKNOWN"
    else
      # (i) THE ALONE-RERUN EVIDENCE LIVES IN THE GATE LOG, NEVER THE ENVIRONMENT.
      # An env var asserting "I ran it alone" is the operator's word; a line in
      # the log is the run's own record.
      alone="$(grep -m1 -E "^ALONE-RERUN ${named} [0-9]+/[0-9]+\$" "$PIN_GATE_LOG" 2>/dev/null || true)"
      # (ii) THE known-flakes ENTRY IS MATCHED BY THE NAMED TEST, and the waiver
      # quotes the matched line's TEXT — never a line number, which moves
      # whenever that file is edited (it moved thirty lines the day this was
      # written).
      kf="$(grep -m1 -F -- "$named" "$KNOWN_FLAKES" 2>/dev/null || true)"
      # forge-8vfn.7.6.89 consumer half (announced T1 1214): since #843 gate.sh
      # performs the rerun and writes this line INSIDE its run, and its EXIT
      # trap writes GATE_SH_EXIT= last — so a line after the final GATE_SH_EXIT=
      # was appended after the run, by a hand, and proves nothing.
      alone_at="$(grep -n -m1 -E "^ALONE-RERUN ${named} [0-9]+/[0-9]+\$" "$PIN_GATE_LOG" 2>/dev/null | cut -d: -f1)"
      exit_at="$(grep -n -E '^GATE_SH_EXIT=' "$PIN_GATE_LOG" 2>/dev/null | tail -1 | cut -d: -f1)"
      if [ -n "$alone" ] && { [ -z "$exit_at" ] || [ "$alone_at" -gt "$exit_at" ]; }; then
        say "MARKER=done RESULT=GATE-RED-ALONE-PROOF-NOT-GATE-WRITTEN — the ALONE-RERUN line for $named sits AFTER the log's final GATE_SH_EXIT= (line $alone_at > $exit_at): it was appended after gate.sh exited, not written by its rerun (7.6.89). Re-gate; gate.sh performs the rerun itself."
        exit "$EXIT_GATE_UNKNOWN"
      fi
      if [ -z "$alone" ]; then
        say "MARKER=done RESULT=GATE-RED-NO-ALONE-PROOF — GATE_RED_NAMED=$named but the gate log carries no \`ALONE-RERUN $named k/k\` line. The rerun's evidence belongs in the run's own record, not in a variable the caller can type."
        exit "$EXIT_GATE_UNKNOWN"
      elif [ -z "$kf" ]; then
        say "MARKER=done RESULT=GATE-RED-NOT-A-KNOWN-FLAKE — GATE_RED_NAMED=$named matches no line naming it in $KNOWN_FLAKES. An unfiled red is a finding, not a flake."
        exit "$EXIT_GATE_UNKNOWN"
      fi
      waived=1
      # Until 7.6.89 this line was lane-appended and the waiver said CLAIMED
      # (lane A, on the announce). gate.sh now performs the rerun and writes
      # it inside the run, and the position check above refuses a line added
      # after GATE_SH_EXIT=, so the waiver reports it as performed.
      say "GATE-RED-WAIVED: $named — alone-rerun PERFORMED by gate.sh inside the run (7.6.89): $(printf '%s' "$alone") · known-flakes.md: $(printf '%s' "$kf" | cut -c1-140)"
    fi
    [ "$waived" -eq 1 ] || exit "$EXIT_GATE_UNKNOWN"
  fi

  # ---- forge-8vfn.7.6.130: has main GAINED a pinned path since the gate's own
  # checkout, AND does THIS PR touch it? (T1 ruling 1118 as amended by 1257.)
  # C's #780 killed at MERGE_SLOT_EXIT=143, D measuring its own #781: A's #779
  # moved three M6-C rows nineteen seconds after D's gate verdict, and the
  # merge landed sound only because the owners reconciled inside seven minutes
  # — luck, not a precondition. That shipped as a refusal on GAIN ALONE, and
  # MEASURED FIVE REFUSALS IN A ROW on T1's own PRs: every sibling PR changes
  # some pinned test under M6-C's own globs (`apps/forge/tests/**`,
  # `apps/studio/tests/regression/**`), so any window longer than a merge
  # interval — including the GATE'S OWN RUNTIME — refused. A precondition every
  # PR trips is not a precondition; it is the thing lanes route around.
  #
  # THE SAME REASONING THE rc=4 BRANCH BELOW ALREADY MAKES (T1 909/915, a few
  # lines down): main moves between a gate and its merge as a matter of course
  # with three lanes merging inside an hour, so blocking on "main moved a
  # pinned path" makes a merge unreachable — rebase, gate for four minutes,
  # find main has moved again, repeat. And it is not what protects the merge
  # anyway: `gh pr update-branch` below brings main INTO the PR, and CI then
  # runs on that post-update head (550) — the bytes that actually land are
  # validated by the thing designed to validate them. What THIS precondition
  # uniquely adds is narrower than "main moved a pinned path since the gate":
  # it is "THIS PR touches a pinned path main ALSO moved since the gate" — a
  # genuine interaction the post-update CI run cannot tell apart from two
  # unrelated touches landing side by side.
  #
  # So a gained pinned path this PR does NOT change is NOTED
  # (`PINNED-PATH-GAINED-SINCE-GATE (noted, not refused)`), naming the path,
  # and the loop continues; only a gained pinned path THIS PR'S OWN changed set
  # also touches refuses. Answering "does this PR touch it" needs the PR's own
  # changed set, so that is now computed FIRST (7.6.80, moved up) and the
  # gained-path loop runs after it, using `grep -Fxq -- "$p" "$pin_changed"`.
  #
  # GATE-CHECKOUT-UNREAD and the unreadable-diff refusal are UNCHANGED by this
  # amendment: neither depends on the PR's own changed set, both still refuse
  # on read failure alone (§15.504 — unknown never resolves toward proceeding),
  # and both still run before update-branch, ahead of everything else here.
  #
  # Logic PORTED from `m6-d-merge-preflight.sh` (T1 1121) rather than
  # re-invented: read GATE_CHECKOUT= from the gate log, three-dot diff it
  # against parsoFish/main FROM MAIN'S SIDE — `<gate-head>...main` is what MAIN
  # gained since the gate and never this branch's own changes; two-dot would
  # list this PR's own diff back at it and refuse every merge that touches a
  # pinned file, which is not the question. Extended with the `.globs` match
  # `pin-precheck.sh` already carries (below), since a manifest here can pin a
  # pattern as well as a literal path, and porting only the literal half would
  # silently narrow the precondition this bead exists to widen.
  GATE_CHECKOUT="$(sed -n 's/^GATE_CHECKOUT=\([0-9a-f]\{8,\}\)$/\1/p' "$PIN_GATE_LOG" | tail -1)"
  if [ -z "$GATE_CHECKOUT" ]; then
    say "MARKER=done RESULT=GATE-CHECKOUT-UNREAD — $PIN_GATE_LOG carries no GATE_CHECKOUT= line, so the tree the gate judged is unknown. Unknown is not safe (§15.504); re-gate rather than skip this precondition."
    exit "$EXIT_GATE_UNKNOWN"
  fi
  gained="$(git -C "$REPO_FOR_CAPS" diff --name-only "${GATE_CHECKOUT}...parsoFish/main" 2>/dev/null)"; gained_rc=$?
  if [ "$gained_rc" -ne 0 ]; then
    say "MARKER=done RESULT=PIN_PRECHECK_REFUSED — could not diff ${GATE_CHECKOUT}...parsoFish/main in $REPO_FOR_CAPS (three-dot, from main's side) to check for a pinned path main gained since the gate; an unreadable diff is not a clean one. Nothing merged; re-run."
    exit "$EXIT_PIN"
  fi
  pinned_owner() {              # pinned_owner <path> -> owning manifest name(s) on stdout, rc 1 if none
    local path="$1" man mname hit=""
    for man in "$MANIFEST_DIR"/*.sha256; do
      [ -f "$man" ] || continue
      mname="$(basename "$man" .sha256)"
      if awk '{ p=$2; sub(/^\*/,"",p); if (p != "") print p }' "$man" 2>/dev/null | grep -Fxq -- "$path"; then
        hit="$hit $mname"; continue
      fi
      if [ -f "${man%.sha256}.globs" ]; then
        while IFS= read -r pattern; do
          case "$pattern" in ''|'#'*) continue ;; esac
          (cd "$REPO_FOR_CAPS" && eval "ls -1 -d -- $pattern" 2>/dev/null || true) | grep -Fxq -- "$path" && { hit="$hit $mname"; break; }
        done < "${man%.sha256}.globs"
      fi
    done
    [ -n "$hit" ] || return 1
    printf '%s' "${hit# }"
  }

  # 7.6.80: THE MERGE'S CHANGED PATHS — MOVED UP (7.6.130's amendment): "does
  # THIS PR touch it" cannot be answered without them, so they are computed
  # here, ahead of the gained-path loop below and still ahead of
  # `pin-precheck.sh`, which compares only the manifests this merge DECLARES or
  # TOUCHES. From the List-files API, cross-checked against changedFiles
  # (7.6.145), because this precheck runs BEFORE update-branch and there is no
  # post-update head yet.
  pin_changed="$(mktemp /tmp/merge-slot-changed-XXXXXX)"
  # FAILING OPEN ON THE GUARD'S OWN INPUT (T1 909). The first version was
  # `… || : > "$pin_changed"`, written as the cautious choice and doing the
  # opposite: when `gh` fails — DNS flapped twice tonight, an absent token, a
  # rate limit — the file is EMPTY, the relevant set is empty, every moved
  # manifest reads as a harmless sibling and the precheck PROCEEDS. A precheck
  # that cannot compute its relevant set has no verdict to give. §15.504:
  # green · red · UNKNOWN are three states and UNKNOWN never resolves toward
  # proceeding.
  pr_changed_paths "$PR" "$pin_changed"; changed_rc=$?
  if [ "$changed_rc" -eq 1 ]; then
    rm -f "$pin_changed"
    say "MARKER=done RESULT=PIN_PRECHECK_REFUSED — gh could not list PR $PR's files (List-files API) or read its changedFiles count, so the merge's changed paths are unknown and the relevant set cannot be computed. An empty set would read every moved manifest as a harmless sibling. Nothing merged; re-run."
    exit "$EXIT_PIN"
  elif [ "$changed_rc" -eq 2 ]; then
    rm -f "$pin_changed"
    say "MARKER=done RESULT=PIN_PRECHECK_REFUSED — CHANGED-SET-INCOMPLETE: the files API returned ${CHANGED_MISMATCH% *} path(s) but PR $PR reports ${CHANGED_MISMATCH#* } changed files; a partial set fails exactly like an empty one (T1 909). Nothing merged; re-run."
    exit "$EXIT_PIN"
  fi
  say "changed paths handed to pin-precheck: $(wc -l < "$pin_changed")"

  gained_n=0; pinned_n=0
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    gained_n=$((gained_n+1))
    owners="$(pinned_owner "$p")" || continue
    pinned_n=$((pinned_n+1))
    if grep -Fxq -- "$p" "$pin_changed"; then
      say "MARKER=done RESULT=PINNED-PATH-GAINED-SINCE-GATE — main gained $p (manifest $owners) since the gate's checkout $GATE_CHECKOUT; re-gate on a tree containing parsoFish/main"
      rm -f "$pin_changed"
      exit "$EXIT_PIN"
    fi
    say "PINNED-PATH-GAINED-SINCE-GATE (noted, not refused) — main gained $p (manifest $owners) since $GATE_CHECKOUT; this PR does not change it"
  done <<<"$gained"
  say "pinned-path-since-gate: $gained_n path(s) main gained since ${GATE_CHECKOUT}, $pinned_n pinned by $MANIFEST_DIR, none touched by this PR"

  # shellcheck disable=SC2086
  pin_out="$("$PIN_PRECHECK_SH" "$PIN_GATE_LOG" "$(pwd)" "$CAMPAIGN_DIR" --changed-paths-file "$pin_changed" $pin_args 2>&1)"; pin_rc=$?
  rm -f "$pin_changed"
  printf '%s\n' "$pin_out" >> "$OUT"
  # rc=4 is "I CANNOT TELL", and it must not block. It means the only non-OK
  # pins are UNREADABLE ACROSS SKEW — another lane's manifest, in a tree that
  # does not contain that manifest's `head=`. With three lanes merging inside an
  # hour, main moves between a gate and its merge as a matter of course, so
  # blocking on rc=4 makes a merge impossible to reach: rebase, gate for four
  # minutes, find main has moved, repeat. Measured twice tonight on one PR.
  #
  # And it is not what protects the merge anyway. `gh pr update-branch` below
  # brings main INTO the PR, and CI then runs on that post-update head (550) —
  # so the bytes that actually land are validated by the thing designed to
  # validate them. What this precondition uniquely adds is "does THIS PR change
  # a pinned file without declaring it", and that is rc=3, which still blocks.
  #
  # rc=2 (no pin block, or a REFUSED step) blocks too: those say the gate did not
  # produce a verdict at all, which no later step recovers.
  if [ "$pin_rc" -eq 4 ]; then
    say "PIN_PRECHECK_UNREADABLE — skew only, no undeclared drift; update-branch + CI on the post-update head is the guard for what merges (550). Proceeding."
  elif [ "$pin_rc" -ne 0 ]; then
    say "MARKER=done RESULT=PINS-NOT-ACCOUNTED (pin-precheck rc=$pin_rc)"
    exit "$EXIT_PIN"
  fi
else
  # T1 ruling 750, bead `forge-8vfn.7.6.34` (§15.434). THE PRECONDITION WAS
  # INVERTED: passing a gate log could HARD-BLOCK you at rc 2/3, and passing
  # nothing skipped the check entirely. So the lane that wired its log as
  # 693/695 asked was the only lane that could be stopped, and the workaround
  # for any refusal was to unset one environment variable.
  #
  # Measured on M6-C at 01:15 on 2026-09-11: #669 was refused rc=2 while a
  # merge with no `PIN_GATE_LOG` at all would have sailed through with no pin
  # precondition whatsoever. A gate whose strict mode is optional and whose lax
  # mode is the default rewards omission and punishes compliance.
  #
  # It refuses rather than warning, and it is NOT an outage, because the escape
  # above exists and is one word. That is deliberate: this script's own header
  # warns, three lines above the code this replaces, that "a precondition
  # introduced as an outage is one that gets removed".
  say "MARKER=done RESULT=NO-PIN-PRECONDITION — PIN_GATE_LOG is unset, so nothing checked whether this PR changes a pinned file without declaring it (§15.390). Pass the gate log, or pass PIN_GATE_LOG=none to state on the record that this merge needs no pin precondition (§15.434)."
  exit "$EXIT_PIN"
fi

read_head() {
  local h
  for _ in 1 2; do
    h="$(GH pr view "$PR" --json headRefOid --jq .headRefOid 2>/dev/null)"
    case "$h" in [0-9a-f][0-9a-f]*) printf '%s' "$h"; return 0 ;; esac
    sleep "$SLEEP_HEAD_RETRY"
  done
  return 1
}

# A's amendment: re-check MAIN'S SHA, not the PR's `mergeStateStatus`. `BEHIND`
# is derived and can lag, and a stale `CLEAN` is the same lie in a friendlier
# voice — a green check belongs to a COMMIT, not to a pull request.
# THE BASE A GREEN IS MEASURED ON IS A PROPERTY OF THE HEAD (T1 ruling 611,
# §15.339). Reading main a second time after the update-branch flock releases is
# a race: a sibling merging in that window makes the answer the SIBLING's main
# while this PR's head was updated onto the older one, so step 4 compares equal,
# `gh pr merge` is refused BEHIND by strict protection, and the re-wait branch
# recovers — never a wrong merge, but the guard did not catch what it exists to
# catch. Measured by lane A on #610.
#
# SO IT IS RECORDED, NOT DERIVED (forge-8vfn.7.6.111, T1 1040). The previous
# `base_of` read `.parents[1].sha // .parents[0].sha` of the tested head, on the
# assumption that a merge commit's second parent is the main side. That holds
# for ONE `gh pr update-branch` and fails at the second merge shape — a lane
# that merged main itself, which 1021/1028 now makes every lane do — and then
# `parents[1]` is a BRANCH commit. Measured on T1's `fac22c7b`, whose
# `.parents[1]` is `627458ff`, a "Merge branch 'main' into m6/t1-…". `now = BASE`
# could then never be true, so MAIN-MOVED fired on every attempt for a race that
# did not exist, the loop burned all three, and the third HELD the slot across a
# CI wait. Reproduced in `_1.0/tests/merge-slot-doors.sh` before this was changed:
# two MAIN-MOVED lines and three attempts with main never moving.
#
# The fallback was a second wrong answer — on a non-merge head it yields the
# branch's own previous commit — and `base_of` never refused a structurally
# wrong sha, so it failed open into something that read like a measurement.
#
# This file's own header has said `record MAIN_AT` since it was written. The
# capture happens INSIDE the update-branch slot, immediately after the update,
# so nothing can land between the update and the reading of what it updated onto.
# BOUNDED, so an unbounded wait becomes a reportable event instead of a hang.
# A measured the loop converging in ONE iteration (#608: C's #607 landed mid-gate,

# The cap check's body. Kept apart from the loop so the loop reads as the merge
# protocol and this reads as one measurement.
cap_check_head() {
  local pr="$1" head="$2" tmp got out src rc=0
  tmp="$(mktemp -d /tmp/merge-slot-caps-XXXXXXXX)" || { echo "CAPS=UNCHECKED reason=mktemp-failed"; return 0; }
  # The head lands on the remote at `update-branch` and may not be here yet.
  # Fetch the PR's own ref, never a bare SHA (servers refuse tip-SHA wants) —
  # and only when the object is genuinely absent, so a head already in this
  # store costs no round trip.
  if ! git -C "$REPO_FOR_CAPS" cat-file -e "$head^{commit}" 2>/dev/null; then
    if ! GH_TOKEN="$(gh auth token --user parsoFish)" git -C "$REPO_FOR_CAPS" fetch -q parsoFish "refs/pull/$pr/head" 2>/dev/null; then
      rm -rf "$tmp"; echo "CAPS=UNCHECKED reason=fetch-failed pr=$pr"; return 0
    fi
    got="$(git -C "$REPO_FOR_CAPS" rev-parse FETCH_HEAD 2>/dev/null)"
    if [ "$got" != "$head" ]; then
      rm -rf "$tmp"; echo "CAPS=UNCHECKED reason=fetched-head-is-not-the-head-asked-for asked=$head got=${got:-unread}"; return 0
    fi
  fi
  # `--shared` gives the clone an `alternates` pointer into the source's object
  # store instead of its own copy, which is why this costs milliseconds rather
  # than a full clone of the repo. The cost of that: the clone is only valid
  # while the SOURCE's object store is, and the failure mode of a gc underneath
  # it is silent object corruption rather than an error (D, on the announce).
  # Safe here because the clone never outlives this function — `rm -rf` on every
  # exit path, measured at 0 residue — and nothing gcs that repo mid-merge. If
  # this ever becomes long-lived, drop `--shared` rather than adding a guard.
  if ! git clone --shared -q --no-checkout "$REPO_FOR_CAPS" "$tmp/t" 2>/dev/null; then
    rm -rf "$tmp"; echo "CAPS=UNCHECKED reason=clone-failed"; return 0
  fi
  if ! git -C "$tmp/t" checkout -q "$head" 2>/dev/null; then
    rm -rf "$tmp"; echo "CAPS=UNCHECKED reason=checkout-failed head=$head"; return 0
  fi
  for s in check-file-size check-package-caps; do
    out="$(cd "$tmp/t" && node "scripts/$s.mjs" 2>&1)"; src=$?
    if [ $src -eq 0 ]; then
      echo "CAPS $s=PASS"
    else
      rc=1
      echo "CAPS $s=FAIL rc=$src"
      echo "$out" | tail -8
    fi
  done
  rm -rf "$tmp"
  echo "CAPS_RC=$rc"
}

# update-branch, re-wait, merged), so three is slack, not optimism.
for attempt in 1 2 3; do
  say "=== attempt $attempt of 3 ==="

  # ---- SLOT: update-branch (a mutation, milliseconds) + RECORD MAIN_AT ----
  # The sha is written to a file rather than captured from stdout: this block's
  # stdout is the log, and mixing a value into a log is how a value gets parsed
  # back out later.
  main_at_f="$(mktemp /tmp/merge-slot-mainat-XXXXXX)"; ub_f="$(mktemp /tmp/merge-slot-ub-XXXXXX)"
  flock -w 2400 "$SLOT" env PR="$PR" MAIN_AT_FILE="$main_at_f" UB_FILE="$ub_f" bash -c '
    GH_TOKEN="$(gh auth token --user parsoFish)" gh pr update-branch "$PR" > "$UB_FILE" 2>&1; tail -2 "$UB_FILE"
    GH_TOKEN="$(gh auth token --user parsoFish)" gh api repos/parsoFish/forge-studio/commits/main --jq .sha > "$MAIN_AT_FILE" 2>/dev/null
  ' >> "$OUT" 2>&1
  MAIN_AT="$(cat "$main_at_f" 2>/dev/null)"; rm -f "$main_at_f"
  # T1 1275: a conflicting update-branch leaves the PR on its OLD head, and the
  # CI wait below would then wait out 2400 s on a head that can never merge (A
  # lost three PRs that way). Named, and before any wait.
  if grep -q 'Cannot update PR branch due to conflicts' "$ub_f"; then
    rm -f "$ub_f"
    say "MARKER=done RESULT=UPDATE-BRANCH-CONFLICT — gh pr update-branch $PR could not merge main into the PR (conflicts). Merge parsoFish/main into the branch locally, resolve, re-gate; no CI was waited on."
    exit "$EXIT_UPDATE_CONFLICT"
  fi
  rm -f "$ub_f"
  # REFUSE, WITH ITS OWN WORD. `MAIN-UNREAD` already means "the re-read inside
  # the merge slot failed"; two causes under one word is the species this
  # campaign keeps paying for, so a failed CAPTURE says where it happened.
  case "$MAIN_AT" in
    [0-9a-f][0-9a-f]*) ;;
    *) say "MARKER=done RESULT=MAIN_AT-UNREAD — could not read main's sha inside the update-branch slot, so there is no base to compare against later. An unread base is not an unchanged one; nothing merged, re-run."
       exit "$EXIT_HEAD_MAIN_UNREAD" ;;
  esac
  say "slot released after update-branch; MAIN_AT=$MAIN_AT"
  sleep "$SLEEP_POST_UPDATE"

  if ! HEAD="$(read_head)"; then
    say "HEAD UNREAD after two attempts — refusing to merge on a head I could not read"
    say "MARKER=done RESULT=HEAD-UNREAD"; exit "$EXIT_HEAD_MAIN_UNREAD"
  fi
  say "HEAD=$HEAD  MAIN_AT=$MAIN_AT"

  # ---- THE CAP CHECK ON THE POST-UPDATE HEAD (7.6.31, re-landed) ----
  # A gate measures the branch as the lane gated it. `update-branch` then
  # merges main underneath it, and the caps are a property of the RESULT — a
  # file main grew past 800 lines while the branch sat in the queue breaches
  # on the merged head and on nobody's gate. This is the only place that tree
  # exists before it is main.
  #
  # A CLONE, NOT `git worktree add` (§15.470, T1 828). `worktree add`
  # REGISTERS the tree, and every worktree-scanning instrument on this box then
  # sees it: the ground fence (`ground-hash.mjs:116`), the story residue scan
  # (`sweep.mjs:333`), and `pin-reconcile.sh --sweep`. The first false-reds a
  # funded run with a path the reader does not own; the last would WRITE a pin
  # hash from a tree nobody owns. The first version of this shipped and did
  # exactly that within seven minutes. A clone is a separate repository and
  # appears in none of those lists.
  #
  # AND NOT A SPARSE CHECKOUT (T1 828 again): `projects/mdtoc` is TRACKED — 21
  # files — so excluding it would drop exactly those from `check-file-size`'s
  # population and the check would stop measuring what CI measures.
  #
  # THE PROPERTY IS THE IDENTITY OF THE TWO COUNTS, NOT EITHER COUNT (A, on
  # the announce). The clone and the worktree must report the SAME
  # `check-file-size` population; the number itself moves every time any lane
  # adds a file — it moved by one while this instrument was being acked — so a
  # literal here would rot into a comment that reads precise and is wrong.
  # Verified equal at save time, and re-verifiable at any time by running
  # `node scripts/check-file-size.mjs` in both and comparing the two lines.
  #
  # EVERY FAILURE TO MEASURE SAYS "UNCHECKED" AND NEVER BLOCKS. A merge refused
  # because a scratch clone failed is an outage; a silent green is worse than
  # both, so the reason is always named.
  #
  # FAILING OPEN IS RIGHT *HERE* AND IS NOT A GENERAL LICENCE (D, on the
  # announce). This check is an OPTIMISATION — CI catches every breach it
  # catches, so its true positive saves a CI round while a false positive would
  # cost a merge. A check whose true positive PREVENTS A BAD MERGE must fail
  # closed instead; do not cite this block as precedent for one.
  #
  # AND THE LANE MUST REPORT IT (A's condition). A `CAPS=UNCHECKED` line in this
  # log is reported in that merge'"'"'s OUTCOME, the way `PIN_PRECHECK_DECLARED-NONE`
  # is. Otherwise "the check ran and found nothing" and "the check never ran"
  # read the same in the record, which is the fail-safe-to-useless shape that
  # made the first draft'"'"'s undefined `$REMOTE` dangerous rather than merely
  # broken.
  caps_out="$(cap_check_head "$PR" "$HEAD")"
  say "$caps_out"
  case "$caps_out" in
    *CAPS_RC=1*)
      say "MARKER=done RESULT=CAP-BREACHED-AT-MERGE — the post-update head breaches a cap that no gate measured. SPLIT, NEVER BASELINE (492): split on this head, re-gate, merge that."
      exit "$EXIT_CAP_BREACHED" ;;
  esac


  # ---- THE THIRD ATTEMPT HOLDS THE SLOT ACROSS THE WAIT (T1 ruling 635) ----
  # Splitting the hold stopped one lane's CI serialising every other lane, and
  # it worked: holds went from 5-8 minutes to milliseconds. But it also means a
  # PR can lose the race indefinitely, and lane A's #622 did — three green CI
  # runs, main moving under each one (#621, #623, #624). Three greens thrown
  # away is worse for everyone than one six-minute hold.
  #
  # So the first two attempts keep the split, and the third takes the pre-609
  # shape ONCE: hold from update-branch through the wait to the merge, so
  # nothing can land underneath it. Starvation then resolves itself instead of
  # becoming a park, and the cost is bounded at one CI run's worth of hold, on
  # the rare PR that has already lost twice.
  if [ "$attempt" -eq 3 ]; then
    say "third attempt — HOLDING the slot across the CI wait so this cannot lose the race again (635)"
    # CI_TERMINAL is passed EXPLICITLY, like PR and HEAD: `env` builds the
    # child's environment from what it is given, so a variable this script
    # merely assigned is NOT there. The doors caught this as `line 3: :
    # command not found` — an unset path expanding to nothing and the shell
    # trying to run the empty string, which is exactly the "failed read renders
    # as something else" shape, one layer down.
    HELD_RESULT="$(flock -w 2400 "$SLOT" env PR="$PR" HEAD="$HEAD" CI_TERMINAL="$CI_TERMINAL" bash -c '
      GH() { GH_TOKEN="$(gh auth token --user parsoFish)" gh "$@"; }
      "$CI_TERMINAL" --wait "$PR" "$HEAD" 2400
      [ $? -eq 0 ] || { echo "CI-NOT-GREEN under the held slot"; exit 0; }
      out="$(GH pr merge "$PR" --merge 2>&1)"; rc=$?
      # AN EMPTY BODY IS NOT A SUCCESS MESSAGE (7.6.70). `gh pr merge` prints
      # nothing on some successful merges, so this line rendered as
      # `merge rc=0 ::` — a trailing colon and silence, which reads as "the
      # merge said nothing" and is indistinguishable from "the command was
      # never reached". It misled the same reader twice in one session, who
      # both times had to re-derive MERGED from `gh pr view`. Re-deriving is
      # right regardless (§: an empty read is a FAILED READ, never a state) —
      # but the log should not be the thing that makes it necessary.
      [ -n "$out" ] || out="(no output from gh pr merge — expected on a successful merge; re-derive the state from gh pr view, never from this line)"
      echo "merge rc=$rc :: $out"
    ')"
    say "slot released after the held third attempt"
    printf '%s\n' "$HELD_RESULT" >> "$OUT"
    # forge-8vfn.7.6.145: THIS SITE TOO. The held-slot subshell's own exit
    # status used to be discarded — `break` ran unconditionally, whatever the
    # subshell printed — so a CI that never went green under the held slot
    # still fell through to the closing `gh pr view` with no refusal at all.
    case "$HELD_RESULT" in
      *"CI-NOT-GREEN under the held slot"*)
        say "MARKER=done RESULT=CI-NOT-GREEN"; exit "$EXIT_CI_NOT_GREEN" ;;
      *"rc=0"*) ;;
      # Cap 3 (610). The held third attempt is the LAST one: if even it did not
      # merge, the lane parks to T1 with this PR number and T1 orders a merge
      # window — a bounded loss is a reportable event, a hang is not. This line
      # used to sit at the bottom of the loop, where attempt 3 (always held,
      # 635) could never reach it, so STARVED was unreachable and a held merge
      # that failed fell through to the closing re-derivation unnamed.
      *) say "THREE attempts without converging — PARK to T1 with PR $PR"; say "MARKER=done RESULT=STARVED"; exit "$EXIT_STARVED" ;;
    esac
    break
  fi

  # ---- OUTSIDE THE SLOT: the CI wait ----
  # `ci-terminal.sh` is given the EXACT post-update head, and returns
  # HEAD_MISMATCH(3) if the run it read belongs to another commit — that is the
  # "a green check belongs to a COMMIT, not to a pull request" guard (610(1)),
  # enforced by the tool rather than restated here.
  "$CI_TERMINAL" --wait "$PR" "$HEAD" 2400 >> "$OUT" 2>&1
  CI=$?; say "CI_RC=$CI"
  if [ "$CI" -ne 0 ]; then say "MARKER=done RESULT=CI-NOT-GREEN"; exit "$EXIT_CI_NOT_GREEN"; fi

  # ---- SLOT: merge (a mutation, milliseconds) ----
  RESULT="$(flock -w 2400 "$SLOT" env PR="$PR" HEAD="$HEAD" MAIN_AT="$MAIN_AT" bash -c '
    GH() { GH_TOKEN="$(gh auth token --user parsoFish)" gh "$@"; }
    after="$(GH pr view "$PR" --json headRefOid --jq .headRefOid 2>/dev/null)"
    case "$after" in [0-9a-f][0-9a-f]*) ;; *) echo "HEAD-UNREAD"; exit 0 ;; esac
    [ "$after" = "$HEAD" ] || { echo "HEAD-MOVED $HEAD -> $after"; exit 0; }
    now="$(GH api repos/parsoFish/forge-studio/commits/main --jq .sha 2>/dev/null)"
    case "$now" in [0-9a-f][0-9a-f]*) ;; *) echo "MAIN-UNREAD"; exit 0 ;; esac
    # 550: the green belongs to a head that was tested ON THIS BASE. If a sibling
    # merged since, that green is about a tree that no longer exists.
    [ "$now" = "$MAIN_AT" ] || { echo "MAIN-MOVED $MAIN_AT -> $now"; exit 0; }
    out="$(GH pr merge "$PR" --merge 2>&1)"; rc=$?
    # Same as the held-slot site above (7.6.70): silence is not a message.
    [ -n "$out" ] || out="(no output from gh pr merge — expected on a successful merge; re-derive the state from gh pr view, never from this line)"
    echo "merge rc=$rc :: $out"
  ')"
  say "slot released after merge attempt"
  printf '%s\n' "$RESULT" >> "$OUT"

  case "$RESULT" in
    *"rc=0"*) break ;;
    # THREE CAUSES HAD ONE RESULT WORD, AND THE WORD NAMED ONE OF THEM
    # (7.6.111, C ruling as owner). `HEAD-MOVED`, `HEAD-UNREAD` and
    # `MAIN-UNREAD` all reported `RESULT=HEAD-CHANGED`, so "I could not read
    # main" reached the operator as "the head changed" — a thing that did not
    # happen, stated as fact. Found by this bead's own door 4, which went red
    # against the unfixed script for THIS defect rather than for the missing
    # `MAIN_AT-UNREAD` it was aimed at: leaving it would have left a red-first
    # result whose observed reason was not the reason the bead claims.
    #
    # The two HEAD causes genuinely are one fact — the head this verdict belongs
    # to is not the head that is there — so they keep the shared word.
    *MAIN-UNREAD*) say "not merging on a base I could not read"; say "MARKER=done RESULT=MAIN-UNREAD — the re-read of main inside the merge slot failed. Not the same as main having MOVED, and not the same as the capture failing (MAIN_AT-UNREAD); nothing merged, re-run."; exit "$EXIT_HEAD_MAIN_UNREAD" ;;
    *HEAD-MOVED*|*HEAD-UNREAD*) say "not merging on a head I could not trust"; say "MARKER=done RESULT=HEAD-CHANGED"; exit "$EXIT_HEAD_MAIN_UNREAD" ;;
    *MAIN-MOVED*) say "a sibling merged since my green — update-branch and wait again (550)"; sleep "$SLEEP_MAIN_MOVED" ;;
    *)
      # Strict protection refusing a stale base is the 550 case, not a transient:
      # update-branch and wait again rather than forcing.
      say "merge refused — re-running update-branch and re-waiting (550: never merge a head CI did not test)"
      sleep "$SLEEP_MERGE_RETRY"
      ;;
  esac
done

sleep "$SLEEP_FINAL_SETTLE"
# forge-8vfn.7.6.145: `gh pr merge` reporting rc=0 is not a merge — it is a
# claim, and the ONLY verdict this script trusts is the CLOSING re-derivation.
# D's launcher printed rc=0 over a PR that had not merged because the code
# used to fall off the end here regardless of what this line found.
FINAL_STATE="$(GH pr view "$PR" --json state,mergedAt,mergeCommit --jq '"STATE=\(.state) mergedAt=\(.mergedAt) MERGE_SHA=\(.mergeCommit.oid)"' 2>&1)"
printf '%s\n' "$FINAL_STATE" >> "$OUT"
case "$FINAL_STATE" in
  STATE=MERGED*)
    say "MARKER=done"
    exit "$EXIT_MERGED" ;;
  *)
    say "MARKER=done RESULT=MERGE-UNVERIFIED — the merge call returned rc=0 but the closing re-derivation of PR $PR is not STATE=MERGED; gh pr view read: $FINAL_STATE"
    exit "$EXIT_MERGE_UNVERIFIED" ;;
esac
