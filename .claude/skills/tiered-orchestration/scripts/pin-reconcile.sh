#!/usr/bin/env bash
# pin-reconcile.sh — rehash the pin entries a merge touched, and say what changed.
#
#   pin-reconcile.sh <repo> <campaign-dir> <manifest-glob> <from-sha> <to-sha> "<label>"
#     e.g. pin-reconcile.sh ~/forge ~/forge/_1.0 'M5-*' 61491050 b2d1c640 'harness #401 (PR 1)'
#
# §15.105: a pin goes stale at a SIBLING lane's merge, not only at its owner's. Whoever merges
# something under `scripts/` or `tests/stories/` invalidates every live manifest that names the
# files it touched — so this runs after every merge, over every live manifest, not only the
# merging lane's. It rehashes ONLY the entries the merge touched: it never re-globs and never
# adds a path, because a re-glob silently adopts whatever appeared since the pin was taken.
#
# It appends one amendment line per pin touched to that pin's newest `amend-*.md`, and prints
# FAILED before → after so the number is read from the command's output and never written into
# the record before the command has printed it (§15.105 again — T1 once mis-read that count).
# Backups: `<manifest>.pre-<to>`.
#
# Every path is an argument. A tool that resolves its inputs from its own location answers a
# different question in each checkout (§15.148).
set -euo pipefail

# 7.6.49 (745/781/792). THE GLOB IS A DETECTION SCOPE; `FORGE_LANE` IS THE
# WRITE SCOPE. When 7.6.30 taught this script to write `head=` and `manifest=`
# on every manifest it verifies, the glob argument silently stopped meaning
# "which manifests do I look at" and started meaning "which manifests do I
# rewrite" — and three lanes each reached for a habitual `M6-*` without anyone
# re-deriving it. A's post-merge sweep wrote all fourteen; C's `M6-*` advanced
# `head=` on M6-D and M6-T1. Every one of those claims happened to be true,
# which is exactly why nothing caught it.
#
# So: detection stays wide (§15.105 — a pin goes stale at a SIBLING's merge, and
# a lane must still LEARN that), and writes are bounded to the manifests whose
# `owner=` is the invoking lane. Everything else is printed with the path and the
# sha it WOULD have written, and the run exits 3 so a refusal cannot pass for a
# clean sweep.
LANE="${FORGE_LANE:-}"
SWEEP=0
if [ "${4:-}" = "--sweep" ] || [ "${7:-}" = "--sweep" ]; then SWEEP=1; fi
R="${1:?repo root}"; CAMP="${2:?campaign dir}"; GLOB="${3:?manifest glob, e.g. 'M5-*'}"
FROM="${4:?from sha}"; TO="${5:?to sha}"; LABEL="${6:?label}"
G="$CAMP/gate-manifests"
if [ -z "$LANE" ]; then
  echo "pin-reconcile.sh: REFUSING — FORGE_LANE is not set." >&2
  echo "  This script WRITES .counts, and a caller that has not said who it is cannot be" >&2
  echo "  checked against owner=. Set FORGE_LANE to your lane's manifest owner (e.g." >&2
  echo "  FORGE_LANE=M6-A). An unchecked write is the defect this refusal exists for." >&2
  exit 2
fi
if [ "$SWEEP" = 1 ] && [ "$LANE" != "T1" ]; then
  echo "pin-reconcile.sh: REFUSING — --sweep writes every owner's manifest and is T1's only (FORGE_LANE=$LANE)." >&2
  exit 2
fi
[ -d "$G" ] || { echo "pin-reconcile.sh: no gate-manifests dir: $G" >&2; exit 2; }

# Bead forge-8vfn.6.9.2 (ruling 258). §15.169 says to reconcile only from a tree asserted AT the
# to-sha, and it fired on its own author: a confident `0 -> 0` produced from the MERGE'S PARENT,
# for a merge that changed five pinned files. The rehash below reads `sha256sum` of the WORKING
# TREE, so a tree one commit behind hashes the old bytes and prints a clean verdict for a pin it
# has just made wrong. A rule that lives only in prose is decoration; this puts it in the script.
# A SHORT to-sha is accepted when it names this very commit — the operator writes `a63322a2`.
HEAD_SHA=$(git -C "$R" rev-parse HEAD 2>/dev/null || true)
case "$HEAD_SHA" in
  "$TO"*) ;;
  *)
    echo "pin-reconcile.sh: REFUSING — the tree at $R is HEAD $HEAD_SHA, not the to-sha $TO." >&2
    echo "  This script rehashes the WORKING TREE, so reconciling from anywhere else records the" >&2
    echo "  wrong bytes and prints a clean verdict for a pin it just made wrong (§15.169)." >&2
    echo "  Advance that tree to $TO and re-run." >&2
    exit 2
    ;;
esac

# ONE WRITER FOR BOTH FIELDS, because they go stale together and for the same
# reason. `head=` is "the sha this manifest was last verified 0-FAILED against"
# and `manifest=` is "the digest of the .sha256 this line describes" (680).
# Before 7.6.30 the first was written only on a manifest this run REHASHED and
# the second was written by nobody at all, so a `.counts` could name an old sha,
# certify a file that no longer existed, or both — and `.counts` is an input to
# the `PIN_MANIFESTS` fingerprint, so each stale field hands the next lane a
# mismatch caused by the reconcile itself.
# OWNERSHIP AND TREE IDENTITY, CHECKED BEFORE ANY WRITE.
#
# `owner=`: 745's narrow-write rule. `--sweep` (T1 only) bypasses it.
#
# `tree=`: ruling 793, from D's case. The tool writes `head=` from the repo it
# RUNS IN and left `tree=` as it was, so a cross-lane reconcile produced
# `tree=/home/parso/forge-m6-d head=da33ac5b` — asserting D's tree was clean at a
# sha it never held. A's M6-A read TRUE under the identical broken step, because
# the named checkout happened to sit at that sha. THE DEFECT PRODUCES TRUE AND
# FALSE RECORDS INDISTINGUISHABLY, so this refuses rather than warns: a record
# that is accidentally right is not a record anyone can rely on.
#
# Echoes the reason; the caller decides whether to skip or to stop.
may_write() {
  local counts="$1" n="$2" f="$3"
  local owner tree
  owner=$(head -1 "$counts" | grep -oE 'owner=[^ ]+' | cut -d= -f2)
  tree=$(head -1 "$counts" | grep -oE 'tree=[^ ]+' | cut -d= -f2)
  if [ "$SWEEP" != 1 ] && [ "$owner" != "$LANE" ]; then
    echo "  $n: REFUSED — owner=${owner:-<none>}, not $LANE. Would have written head=${TO:0:8} manifest=$(sha256sum "$f" | cut -c1-16)" >&2
    return 1
  fi
  if [ -n "$tree" ] && [ "$tree" != "$R" ]; then
    # 7.6.57 (ruling 806) — THE OWNER MAY REPAIR ITS OWN STALE `tree=`.
    #
    # 793's refusal is right about a stranger's tree and wrong about your own.
    # Dogfooding 7.6.49 a minute after it went live: `M6-A.counts` still carried
    # `tree=/home/parso/forge` from the wrapper era (730), so A's own reconcile
    # from A's own worktree was blocked and the ONLY route left was a hand edit
    # of the field the tool exists to own — which is the class of fix this whole
    # instrument removes. Every `.counts` written in that era carries the same
    # latent block.
    #
    # Rewriting is safe HERE and nowhere else, because the rehash this run
    # performed happened in `$R`: the owner is not asserting a verification
    # someone else's checkout did, it is recording the one it just did. A
    # non-owner reaching here is the 793 case untouched — including T1's
    # `--sweep`, where `owner != LANE` by construction and the tree genuinely is
    # not the owner's.
    if [ "$owner" = "$LANE" ]; then
      echo "  $n: tree= REPAIRED — $tree -> $R (owner=$LANE rehashing in its own repo, 7.6.57)"
    else
      echo "  $n: REFUSED — tree=$tree is not the repo this run rehashes ($R); writing head= here would assert a verification that checkout never performed (793). Would have written head=${TO:0:8} manifest=$(sha256sum "$f" | cut -c1-16)" >&2
      return 1
    fi
  fi
  return 0
}

set_counts_fields() {
  local counts="$1" manifest_file="$2" to8="$3"
  local d; d=$(sha256sum "$manifest_file" | cut -c1-16)
  # D (796): the script has always backed up `<manifest>.sha256` and never the
  # `.counts`, so "what did this field say before" was a RECONSTRUCTION — two
  # lanes rebuilt a prior `head=` from a stale gate log and a command's stdout,
  # and one got it wrong. Now it is a read.
  cp "$counts" "$counts.pre-${to8}"
  # 793: `tree=` is set in the SAME edit as `head=`, from the repo doing the
  # rehash, so the pair is right by construction instead of by coincidence.
  # WRITTEN WHEN ABSENT, not only rewritten when present — and that is the half
  # that carries weight. While the 793 refusal stands, a `.counts` that HAS a
  # `tree=` can only be written when it already equals `$R`, so rewriting it is
  # a no-op (mutation-tested: removing the rewrite changes nothing). A `.counts`
  # with NO `tree=` passes the refusal — there is nothing to contradict — and
  # would otherwise keep a `head=` with no record of which checkout verified it.
  if grep -q 'tree=[^ ]*' "$counts"; then
    sed -i "s#tree=[^ ]*#tree=${R}#" "$counts"
  else
    printf '%s tree=%s\n' "$(head -1 "$counts")" "$R" > "$counts.tmp"
    tail -n +2 "$counts" >> "$counts.tmp"; mv "$counts.tmp" "$counts"
  fi
  if grep -q 'head=[0-9a-f]\{7,40\}' "$counts"; then
    sed -i "s/head=[0-9a-f]\{7,40\}/head=${to8}/" "$counts"
  else
    printf '%s head=%s\n' "$(head -1 "$counts")" "$to8" > "$counts.tmp"
    tail -n +2 "$counts" >> "$counts.tmp"; mv "$counts.tmp" "$counts"
  fi
  # WRITTEN WHEN ABSENT, not only refreshed when present: six of the campaign's
  # fourteen manifests carried no `manifest=` at all, and a fix that only
  # refreshed an existing field would have left them unprovable.
  if grep -q 'manifest=[0-9a-f]\{16\}' "$counts"; then
    sed -i "s/manifest=[0-9a-f]\{16\}/manifest=${d}/" "$counts"
  else
    printf '%s manifest=%s\n' "$(head -1 "$counts")" "$d" > "$counts.tmp"
    tail -n +2 "$counts" >> "$counts.tmp"; mv "$counts.tmp" "$counts"
  fi
  # 7.6.57 (T1 824) — `paths=` IS RECOMPUTED, not carried. The tool never
  # touched it, so after T1 added two rows to a `.sha256` by hand the field read
  # `paths=23` against 25 real rows — a count describing an earlier version of
  # the file it sits beside, and nothing failed. It is derived here from the
  # same file `manifest=` hashes, in the same edit, so the two cannot disagree.
  local np; np=$(grep -c . "$manifest_file")
  if grep -q 'paths=[0-9]\{1,\}' "$counts"; then
    sed -i "s/paths=[0-9]\{1,\}/paths=${np}/" "$counts"
  else
    printf '%s paths=%s\n' "$(head -1 "$counts")" "$np" > "$counts.tmp"
    tail -n +2 "$counts" >> "$counts.tmp"; mv "$counts.tmp" "$counts"
  fi
}

# 7.6.85 (T1 891, from C's hazard report) — REFUSE A DIRTY PATH THIS RUN WILL READ.
#
# Everything below reads the WORKING TREE: `sha256sum -c` for a manifest this
# merge did not touch, `sha256sum` for the entries it did. So a path that is both
# PINNED and DIRTY records a hash for bytes main does not hold — a wrong pin that
# READS CLEAN. Nothing downstream catches it: `sha256sum -c` passes against the
# same dirty tree and fails only in a clean checkout, where it reads as a
# sibling lane's drift rather than as this run's error.
#
# C ran A's #703 reconcile at porcelain 11 and nothing wrong was written — but
# only because none of the eleven dirty paths happened to be among the rehashed
# ones. That is luck, and luck is not a precondition (891).
#
# SCOPE IS THE PINNED PATHS, NOT THE REPO. Residue elsewhere is not this tool's
# business and refusing on it would make the tool unusable in a working lane —
# every gate leaves story artifacts behind. Checked ONCE, up front, before any
# `.counts` is touched, so a refusal leaves every manifest byte-identical.
dirty_check=$(mktemp); trap 'rm -f "$T" "$dirty_check"' EXIT
for f in "$G"/$GLOB.sha256; do
  [ -f "$f" ] || continue
  awk '{print $2}' "$f" | sed 's#^\*##' >> "$dirty_check"
done
if [ -s "$dirty_check" ]; then
  dirty=$(cd "$R" && sort -u "$dirty_check" | tr '\n' '\0' | xargs -0 --no-run-if-empty git status --porcelain -- 2>/dev/null || true)
  if [ -n "$dirty" ]; then
    echo "pin-reconcile.sh: REFUSING — these PINNED paths are dirty in $R, and this run would hash them:" >&2
    printf '%s\n' "$dirty" | sed 's/^/    /' >&2
    echo "  A path that is both pinned and dirty records a hash for bytes main does not hold — a wrong" >&2
    echo "  pin that reads CLEAN, because sha256sum -c passes against this same dirty tree and fails" >&2
    echo "  only in a clean checkout, where it reads as a sibling's drift (7.6.85)." >&2
    echo "  Commit, restore or stash them and re-run. Nothing has been written." >&2
    exit 4
  fi
fi

T=$(mktemp); trap 'rm -f "$T"' EXIT
ownerless=""
refused=""
git -C "$R" diff --name-only "$FROM" "$TO" > "$T"
found=0
for f in "$G"/$GLOB.sha256; do
  [ -f "$f" ] || continue
  found=1
  n=$(basename "$f" .sha256)
  touched=$(awk '{print $2}' "$f" | sed 's#^\*##' | grep -Fxf "$T" || true)
  counts="${f%.sha256}.counts"
  if [ -z "$touched" ]; then
    # T1 ruling 762. A manifest this merge did not touch was previously SKIPPED
    # ENTIRELY — never verified, never advanced — so "nothing to rewrite" and
    # "not checked" were recorded identically. A's M6-A at #668 sat at
    # `head=106ca1c4` while verifying clean at `eabc0152`, and every lane's skew
    # test reads that field. Verify it; advance only if it is actually clean.
    if [ -f "$counts" ]; then
      untouched_fail=$(cd "$R" && sha256sum -c --quiet "$f" 2>&1 | grep -c FAILED || true)
      if [ "$untouched_fail" = "0" ]; then
        if ! may_write "$counts" "$n" "$f"; then refused="$refused $n"; continue; fi
        set_counts_fields "$counts" "$f" "${TO:0:8}"
        echo "  $n: head= -> ${TO:0:8} (untouched by this merge, verified 0 FAILED against this tree)"
      else
        echo "  $n: head= NOT advanced — untouched by this merge but FAILED $untouched_fail against this tree"
      fi
    fi
    continue
  fi
  cp "$f" "$f.pre-${TO:0:8}"
  # Count FAILED lines, never `grep -vc ': OK$'` — that also counts the WARNING line (§15.105).
  before=$(cd "$R" && sha256sum -c --quiet "$f" 2>&1 | grep -c FAILED || true)
  for p in $touched; do
    if [ -f "$R/$p" ]; then
      h=$(cd "$R" && sha256sum "$p" | cut -d' ' -f1)
      awk -v p="$p" -v h="$h" '{ q=$2; sub(/^\*/,"",q); if (q==p) print h "  " p; else print }' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
    else
      echo "  $n: $p DELETED by the merge — entry left in place (the gate reads it as missing, which is the honest state)"
    fi
  done
  after=$(cd "$R" && sha256sum -c --quiet "$f" 2>&1 | grep -c FAILED || true)
  # T1 ruling 707 — ADVANCE `head=` IN THE SAME EDIT THAT REHASHES.
  #
  # A manifest whose `.sha256` was rehashed while its `.counts` still names an
  # older sha describes a tree it does not describe, and EVERY lane's skew test
  # reads that field: C's precheck named M6-D's `agent-dispatch-containment.test.ts`
  # as C's drift for exactly this reason. Only manifests this run rehashed are
  # touched — a `head=` advanced on a manifest nobody verified is the same lie
  # pointing the other way.
  #
  # `head=` means "last verified 0-FAILED against", so it is written ONLY when
  # the rehash actually reached zero. A manifest still failing (a pinned path the
  # merge DELETED, left in place above) records why instead.
  if [ "$after" = "0" ]; then
    if [ -f "$counts" ]; then
      if ! may_write "$counts" "$n" "$f"; then refused="$refused $n"; continue; fi
      set_counts_fields "$counts" "$f" "${TO:0:8}"
    else
      # REFUSES rather than creating one. The old branch wrote an OWNERLESS
      # `.counts` and said so in its own comment — "`owner` is not knowable from
      # this script and is left to the lane" — which made a record nobody is
      # accountable for, indistinguishable from a complete one. Everything the
      # lane needs is printed so it need not recompute anything.
      # REFUSES PER MANIFEST, NOT PER RUN. The first draft did `exit 2` here,
      # which the pre-existing suite caught: it abandons the manifests already
      # reconciled in this loop and never reaches the ones after it, so one
      # ownerless `.counts` would silently leave the rest of the campaign
      # unreconciled. The refusal is recorded, this manifest is skipped, and the
      # run still exits non-zero at the end — so the operator sees EVERY
      # manifest that needs an owner, in one pass.
      echo "pin-reconcile.sh: REFUSING to create $counts — it would have no owner=." >&2
      echo "  A .counts with no owner is a record no lane is accountable for, and it reads" >&2
      echo "  exactly like a complete one. The lane that owns this manifest writes it:" >&2
      echo "    paths=$(grep -c . "$f") manifest=$(sha256sum "$f" | cut -c1-16) head=${TO:0:8} tree=$R owner=<LANE>" >&2
      ownerless="$ownerless $n"
      continue
    fi
    echo "  $n: head= -> ${TO:0:8} (rehashed to 0 FAILED against this tree)"
  else
    [ -f "$counts" ] || printf 'paths=%s tree=%s\n' "$(grep -c . "$f")" "$R" > "$counts"
    grep -q 'head-not-advanced' "$counts" || \
      printf '# head= NOT advanced to %s: still FAILED %s after the rehash (a pinned path the merge\n# deleted, or bytes this tree does not hold). head-not-advanced=%s\n' \
        "${TO:0:8}" "$after" "${TO:0:8}" >> "$counts"
    echo "  $n: head= NOT advanced — still FAILED $after after the rehash"
  fi
  # `sort -V`, never `ls | tail -1`. Lexically `amend-9.md` beats `amend-18.md`,
  # so every amendment past the ninth landed in the ninth file: measured on the
  # live campaign before this fix, 40 reconcile lines had accumulated in
  # `M6-A.amend-9.md` and 76 in `M6-C.amend-9.md`. M6-B/M6-D/M6-T1 looked fine
  # only because none had yet reached ten files, which is why it stayed
  # invisible for twenty-three amendments.
  log=$(ls "$G"/"$n".amend-*.md 2>/dev/null | sort -V | tail -1 || true); [ -n "$log" ] || log="$G/$n.amend-1.md"
  printf '\n## Amendment (at `%s`, §15.105, pin-reconcile.sh) after %s: %s rehashed — FAILED %s → %s.\n' \
    "${TO:0:8}" "$LABEL" "$(echo "$touched" | tr '\n' ' ')" "$before" "$after" >> "$log"
  echo "$n: [$(echo "$touched" | tr '\n' ' ')] FAILED $before → $after"
done
# A run that matched no manifest is a distinct outcome, not silence (§15.92).
[ "$found" = 1 ] || { echo "pin-reconcile.sh: no manifest matched $G/$GLOB.sha256" >&2; exit 2; }
# Every other manifest was reconciled; these are the ones a lane must claim.
if [ -n "$refused" ]; then
  echo "pin-reconcile.sh: $(echo $refused | wc -w) manifest(s) NOT written (owner= is not $LANE, or tree= names another checkout):$refused" >&2
  echo "  Each is named above with the head= and manifest= it would have carried. Detection was wide;" >&2
  echo "  writing is bounded to $LANE's own manifests (745/781/793). Their owners reconcile them." >&2
  exit 3
fi
if [ -n "$ownerless" ]; then
  echo "pin-reconcile.sh: $(echo $ownerless | wc -w) manifest(s) have no .counts and were NOT created:$ownerless" >&2
  echo "  Everything else in this run reconciled. Write each .counts with its owner= and re-run." >&2
  exit 3
fi
