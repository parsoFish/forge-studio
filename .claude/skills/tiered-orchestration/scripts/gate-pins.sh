#!/usr/bin/env bash
# gate-pins.sh — the `== pins ==` block, split out of gate.sh at its 800-line
# cap (T1 1260). SOURCED by gate.sh, at the same point, never executed on its
# own: it reads and mutates gate.sh's own variables in place ($R, $CAMP,
# $fail, $refused, $EXPECTED_PIN_FAILS, $gate_main, …) — `source`, not `exec`,
# is what keeps them the SAME variables rather than a subshell's copies.

# NAMED, never silent — this script's own line 13 (§15.92). A pins section that
# simply does not appear is indistinguishable from one that found nothing wrong,
# which is exactly how `forge-e8dn` survived two full gates.
echo "== pins =="
if [ -z "$CAMP" ]; then
  echo "SKIP no campaign dir was named — there are no manifests to check, and this gate wrote its logs to a temp dir"
elif [ ! -d "$CAMP/gate-manifests" ]; then
  echo "SKIP $CAMP has no gate-manifests/ — no manifests to check"
else
  # WHICH MANIFESTS THIS VERDICT IS ABOUT (`forge-8vfn.7.6.32`, T1 738).
  # Measured 2026-09-11: M6-C amended `M6-C.sha256` fourteen seconds after a
  # lane's `pin-precheck` read this block, and the precheck reported two
  # undeclared failures that re-derived `OK` on a direct check seconds later.
  # Neither instrument was wrong; each was correct about a different instant.
  # `pin-precheck` already guards the TREE moving between here and the merge —
  # nothing carried the identity of the MANIFESTS forward, so its `:145`
  # diagnosis blamed a tree that had not moved.
  #
  # The asymmetry is the reason this matters: that instance printed a loud false
  # REFUSAL. An amendment that ADDED rows instead of rehashing them would have
  # produced `PIN_PRECHECK_OK` against a manifest already disagreeing with the
  # tree, and the merge would have gone through on it.
  #
  # SCOPE: `*.sha256` AND `*.counts`, and the second half is not obvious. The
  # verdict is computed from `.sha256`, so a first draft covered only that —
  # but `pin-precheck.sh:107` reads `${m%.sha256}.counts` for `head=`, and
  # `:129` uses `head=` to choose rc 4 (unreadable across skew, proceeds loudly)
  # over rc 3 (undeclared drift, blocks). Opposite outcomes at the merge slot.
  # `.globs` and `amend-*.md` stay out, measured: nothing in this block or in
  # `pin-precheck` reads them (grep, both files, zero hits). If this block ever
  # grows a `pin-glob-check` call, `.globs` reaches the log and this line must
  # widen with it.
  echo "PIN_MANIFESTS=$(sha256sum "$CAMP"/gate-manifests/*.sha256 "$CAMP"/gate-manifests/*.counts 2>/dev/null | sha256sum | cut -c1-16)"
  # 7.6.80 (T1 879) — AND ONE PER MANIFEST, over the same two files each.
  #
  # The aggregate answers "did anything move", which is the right question for
  # a log and the wrong one for a merge: any lane's reconcile moves it, so
  # `pin-precheck` refuses every merge whose gate finished first. Measured on
  # three consecutive merges in one evening, and in all of them the refusing
  # lane's OWN manifest was untouched. A merge's pin precondition is about the
  # manifests it declares and touches; the precheck cannot compare that subset
  # against a single number, so the subset has to be printed.
  #
  # The aggregate STAYS. It is still the one-line answer, and a log carrying
  # only it must stay readable until every lane's gate emits these.
  for pin_m in "$CAMP"/gate-manifests/*.sha256; do
    [ -e "$pin_m" ] || continue
    pin_name="$(basename "$pin_m" .sha256)"
    echo "PIN_MANIFEST $pin_name=$(sha256sum "$pin_m" "${pin_m%.sha256}.counts" 2>/dev/null | sha256sum | cut -c1-16)"
  done
  # SKEW MAKES A **FAILED** COUNT AMBIGUOUS -- IT DOES NOT INVALIDATE A CLEAN ONE
  # (T1 ruling 684, correcting this block's first draft; §15.381 credited to M6-C).
  # `sha256sum -c` verifies HASHES, so `0 FAILED` from a tree AHEAD of the pin is a
  # true statement -- the pinned bytes still hold here. Only a NON-ZERO count is
  # unreadable across skew, because a MISSING or DIFF line can be a file the pin
  # predates rather than drift. The first draft SKIPPED on any skew and threw the
  # real verification away with the ambiguous one.
  #
  # MEASURED, and reported wrongly before it was understood: this block printed
  # `M6-C.sha256: 13 FAILED of 198` from a tree one merge behind, and it went
  # upward as a sibling lane's drift. C's tree was 0 FAILED / 0 MISSING; seven of
  # the nine were files that did not exist in this checkout yet.
  #
  # THE NO-`head=` BRANCH IS NOT DECORATION. Only three of the campaign's fourteen
  # `.counts` carry `head=`; a check keyed on it that stayed QUIET for the other
  # eleven would rebuild `forge-e8dn` eleven manifests over.
  head_now="$(git -C "$R" rev-parse HEAD 2>/dev/null || echo '')"
  short="${head_now:0:8}"
  # A FAILED count the lane did not declare fails the gate (693(ii), §15.388):
  # D's gate was rc=0, 20/20, with `M6-T1.sha256: 2 FAILED of 14` in the same
  # log. Declarations are matched by MANIFEST or by `MANIFEST:path`, so a lane
  # can account for one amended file without blanketing the whole manifest.
  # 7.6.97 — A SIBLING'S STALE PIN IS NOT THIS GATE'S RED.
  #
  # `gate.sh` verifies EVERY manifest against the checkout, and §15.105 makes a
  # pin stale the moment a SIBLING merges. With three lanes merging every few
  # minutes the window in which all manifests agree with newest main is shorter
  # than one gate run, so a lane's gate goes red on another lane's pin while
  # every one of its own steps passes — D twice in six minutes (953: C's
  # `reap.test.ts`; 954: A's #726 six files, four minutes after C reconciled).
  # The merge slot already separates this case (7.6.80's `PIN_SIBLING_MOVED` —
  # reported, not refused); the gate did not.
  #
  # THREE CONDITIONS, ALL REQUIRED, and each is there to keep a different thing
  # red:
  #   owner != this lane   — my own stale pin is mine to reconcile, not to excuse
  #   path not in the diff — a path this PR touches must be DECLARED (7.6.43)
  #   bytes == main's      — the change is a merge on main, NOT tampering here
  # A row failing any one of them stays a red UNDECLARED. The third is the one
  # that makes this safe: "a sibling owns it" alone would excuse an edit made in
  # this tree to a file this lane does not own.
  #
  # THIS IS THE BACKSTOP, NEVER THE CHANNEL (T1 956). 954's rule is that a
  # merging lane forwards `pin-reconcile`'s own `REFUSED — owner=X …` line to
  # each owner at merge time; this classification covers the window between that
  # merge and that message, and a reported row is not a reason to stop sending.
  #
  # UNSET `FORGE_LANE` TURNS THE CLASSIFICATION OFF AND SAYS SO. Without a lane
  # identity there is no `owner != mine` to test, and a feature that quietly
  # stopped classifying would print exactly the same clean pin block as one that
  # found no stale siblings (§15.504). `pin-reconcile.sh` refuses outright for
  # the same reason; a gate cannot refuse, so it announces.
  sibling_stale_n=0
  pr_diff_paths="|"
  pr_diff_ok=0
  if [ -n "${gate_main:-}" ] && git -C "$R" rev-parse --verify --quiet parsoFish/main >/dev/null 2>&1; then
    if pr_diff_list="$(git -C "$R" diff --name-only parsoFish/main..HEAD 2>/dev/null)"; then
      pr_diff_ok=1
      while IFS= read -r pr_f; do
        [ -n "$pr_f" ] && pr_diff_paths="$pr_diff_paths$pr_f|"
      done <<< "$pr_diff_list"
    fi
  fi
  if [ -z "${FORGE_LANE:-}" ]; then
    echo "  PIN_SIBLING_STALE classification OFF: FORGE_LANE is unset, so this gate cannot tell a sibling's stale pin from drift in this tree — every FAILED row below stays UNDECLARED"
  elif [ "$pr_diff_ok" -eq 0 ]; then
    echo "  PIN_SIBLING_STALE classification OFF: this PR's diff against parsoFish/main could not be computed, and a row cannot be excused without knowing whether this PR touched it"
  fi

  manifest_owner() {
    local c="$CAMP/gate-manifests/$1.counts"
    [ -f "$c" ] || return 1
    grep -o 'owner=[^ ]*' "$c" | head -1 | cut -d= -f2
  }

  # True only when all three hold. Every `return 1` here is a row that stays red.
  sibling_stale() {
    local man="$1" p="$2" owner main_blob here_blob
    [ -n "${FORGE_LANE:-}" ] || return 1
    [ "$pr_diff_ok" -eq 1 ] || return 1
    owner="$(manifest_owner "$man")" || return 1
    [ -n "$owner" ] || return 1
    [ "$owner" != "$FORGE_LANE" ] || return 1
    case "$pr_diff_paths" in *"|$p|"*) return 1 ;; esac
    main_blob="$(git -C "$R" rev-parse --verify --quiet "parsoFish/main:$p" 2>/dev/null)" || return 1
    here_blob="$(cd "$R" && git hash-object -- "$p" 2>/dev/null)" || return 1
    [ -n "$main_blob" ] && [ "$main_blob" = "$here_blob" ]
  }

  # 7.6.144 (D, T1 1146): the OWN-lane twin of sibling_stale — same two byte
  # conditions, owner == this lane. Such a row is this lane's manifest running
  # BEHIND main (a merge landed on a path it pins), not a change this PR made.
  # gate.sh had no word for it and called it UNDECLARED, printing the
  # --expect-pin-fail remedy — a claim about the PR's diff that the diff
  # contradicts; obeying it wrote false 925 declarations. It stays RED (the
  # manifest is behind; the slot's precheck would refuse anyway) but the remedy
  # is reconcile, never declare.
  own_stale() {
    local man="$1" p="$2" owner main_blob here_blob
    [ -n "${FORGE_LANE:-}" ] || return 1
    [ "$pr_diff_ok" -eq 1 ] || return 1
    owner="$(manifest_owner "$man")" || return 1
    [ "$owner" = "$FORGE_LANE" ] || return 1
    case "$pr_diff_paths" in *"|$p|"*) return 1 ;; esac
    main_blob="$(git -C "$R" rev-parse --verify --quiet "parsoFish/main:$p" 2>/dev/null)" || return 1
    here_blob="$(cd "$R" && git hash-object -- "$p" 2>/dev/null)" || return 1
    [ -n "$main_blob" ] && [ "$main_blob" = "$here_blob" ]
  }

  pin_fail() {
    local man="$1" manifest="$2" undeclared=0 p
    case " $EXPECTED_PIN_FAILS " in *" $man "*) echo "  declared: every failure in $man is accounted for by this PR"; return 0 ;; esac
    while IFS= read -r p; do
      [ -n "$p" ] || continue
      case " $EXPECTED_PIN_FAILS " in
        *" $man:$p "*) echo "  declared: $man:$p"; continue ;;
      esac
      if sibling_stale "$man" "$p"; then
        echo "  PIN_SIBLING_STALE $man:$p — matches main ${gate_main:-unknown}; owner $(manifest_owner "$man") owes a reconcile"
        sibling_stale_n=$((sibling_stale_n + 1))
      elif own_stale "$man" "$p"; then
        echo "  PIN_OWN_STALE $man:$p — matches main ${gate_main:-unknown} and this PR does not touch it: your manifest is BEHIND main — reconcile $man to main (pin-reconcile FROM=head), do not declare (7.6.144)"; undeclared=1
      else
        # 7.6.110 (A, T1 1036): the line carries its REMEDY, as PIN_SIBLING_STALE carries its
        # owner — A spent a full twenty-step gate learning that a declaration is owner-independent.
        echo "  UNDECLARED: $man:$p — this PR changed a pinned path and did not say so; declare it with --expect-pin-fail $man:$p (a declaration is the PR's claim about its own diff — your own lane's rows included)"; undeclared=1
      fi
    done < <(cd "$R" && sha256sum -c "$manifest" 2>/dev/null | sed -n 's/^\(.*\): FAILED$/\1/p')
    [ "$undeclared" -eq 0 ] || fail=1
  }
  # 7.6.43 — A DECLARATION THAT NAMES NOTHING REFUSES.
  #
  # C's case (773): `--expect-pin-fail M6-C:tests/stories/S7.story.mjs` was
  # accepted in silence although only `M1-C-S7` pins that path, and it surfaced
  # only because a REAL undeclared failure happened to sit beside it. A
  # declaration is the PR's claim about ITSELF, and `--expect-pin-fail` is the
  # flag that turns a red gate green — so a claim matching nothing must not be
  # indistinguishable from one that matched.
  #
  # THE MESSAGE NAMES WHICH OF THREE, because a refusal that catches only the
  # third leaves two more ways to write a declaration that looks like cover:
  #   1. the manifest does not exist at all
  #   2. the path is pinned by no manifest anywhere (a typo)
  #   3. manifest and path are both real but WRONG PAIR  <- C's, and the worst,
  #      since a reader checking either half in isolation finds it
  for decl in $EXPECTED_PIN_FAILS; do
    [ -n "$decl" ] || continue
    dman="${decl%%:*}"
    if [ ! -f "$CAMP/gate-manifests/$dman.sha256" ]; then
      echo "  declaration names nothing: $decl — no manifest named '$dman' in $CAMP/gate-manifests"
      refused=1; continue
    fi
    [ "$decl" = "$dman" ] && continue          # manifest-level, and it exists
    dpath="${decl#*:}"
    if awk '{ q=$2; sub(/^\*/,"",q); print q }' "$CAMP/gate-manifests/$dman.sha256" \
         | grep -Fxq "$dpath"; then continue; fi
    holder=""
    for other in "$CAMP"/gate-manifests/*.sha256; do
      [ -f "$other" ] || continue
      if awk '{ q=$2; sub(/^\*/,"",q); print q }' "$other" | grep -Fxq "$dpath"; then
        holder="$holder $(basename "$other" .sha256)"
      fi
    done
    if [ -n "$holder" ]; then
      echo "  declaration names nothing: $decl — '$dman' does not pin that path;$holder does. Wrong pair."
    else
      echo "  declaration names nothing: $decl — no manifest pins '$dpath' at all (typo?)"
    fi
    refused=1
  done

  for m in "$CAMP"/gate-manifests/*.sha256; do
    [ -f "$m" ] || continue
    counts="${m%.sha256}.counts"
    pinned=""
    [ -f "$counts" ] && pinned="$(grep -o 'head=[0-9a-f]\{7,40\}' "$counts" | head -1 | cut -d= -f2)"
    # Count FAILED lines only: `grep -vc ': OK$'` also counts sha256sum's WARNING line (§15.105).
    n="$(cd "$R" && sha256sum -c "$m" 2>&1 | grep -cE ': FAILED|No such file')"
    total="$(wc -l < "$m")"
    man="$(basename "$m" .sha256)"
    # SKEW IS AN ANCESTRY QUESTION, NOT A STRING ONE (M6-C, verified on a real
    # tree: HEAD `82bb8bf4` is a DESCENDANT of pin `df473067`, so it contains
    # every pinned commit and can answer perfectly — and a prefix match called
    # it skew). With the rc riding on this, a prefix match would refuse a lane
    # one commit ahead and hand it advice it has already followed.
    readable=1
    if [ -n "$pinned" ] && ! git -C "$R" merge-base --is-ancestor "$pinned" HEAD 2>/dev/null; then readable=0; fi
    if [ -z "$pinned" ]; then
      echo "$man.sha256: $n FAILED of $total — tree at ${short:-unknown} (no head= in $(basename "$counts") — skew unknown)"
      [ "$n" -gt 0 ] && pin_fail "$man" "$m" || true
    elif [ "$n" -gt 0 ] && [ "$readable" -eq 0 ]; then
      echo "$man.sha256: $n FAILED of $total — tree at $short; last verified at $pinned — skew: reconcile from a tree at $pinned or later before reading these as drift (§15.381)"
    else
      echo "$man.sha256: $n FAILED of $total — tree at ${short:-unknown}; last verified at $pinned"
      [ "$n" -gt 0 ] && pin_fail "$man" "$m" || true
    fi
  done
fi
# 7.6.97: COUNTED SEPARATELY so a reader sees how many siblings are stale rather
# than inferring it from the absence of reds. Zero prints too — a count that
# appears only when non-zero cannot be told from one nobody took.
if [ -n "${sibling_stale_n:-}" ]; then
  echo "PIN_SIBLING_STALE_COUNT=$sibling_stale_n"
fi
