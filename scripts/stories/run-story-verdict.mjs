/**
 * run-story-verdict.mjs — the containment verdict: every reason a run goes
 * RED regardless of its beats, decided from state `runStory` already
 * computed by the time this runs.
 *
 * PURE MOVE out of `run-story.mjs` (bead `forge-8vfn.8.1.32`) — the block is
 * a natural seam: every input below (`ownGroundDrift`, `trailing`, `fence`,
 * `realFence`, `forkGrounds`, `row`, `spendHalt`, `galleryRegenFailure`) is
 * fully computed by the time it runs, and this does nothing but read them,
 * print, and decide the exit code. It needs no import from anywhere else in
 * this repo.
 *
 * Row 191 (bead `forge-8vfn.8.5.29`), T1 ruling 1973en — THE LAST LINE MUST
 * BE FINAL. A costed S1 run's log printed `S1: green — 11/11 beats green`
 * at :4627 (that line used to be printed by `run-story.mjs` BEFORE this
 * function ever ran), then `S1: CONTAINMENT FAILURE — … The run is RED
 * regardless of its beats.` at :4639 from inside here, and exited 1 — and a
 * reader (T1) took the green line as the verdict, because it was the ONLY
 * line shaped like a per-story verdict (`${id}: ${status} — N/M beats
 * green`); the containment line that actually decided the exit code uses
 * different words and never restates that shape. So every branch below —
 * not only the clean fallthrough at the end — now ends by calling
 * `printFinal` with the status IT is actually returning, as the LAST thing
 * it prints before `return`. A reader who trusts only the last line shaped
 * like a verdict now reads the true one, and it can never disagree with the
 * exit code because both come from the same branch.
 */
export function containmentVerdict({
  story, ownGroundDrift, trailing, fence, realFence, forkGrounds, row, spendHalt, galleryRegenFailure, hostHead,
}) {
  const printFinal = (status) => console.log(
    `[stories] ${story.id}: ${status} — ${row.greenBeats}/${row.beats} beats green`,
  );

  // Ruling 309(b) — an escape into a tree this run does not own reds the run
  // even when every beat is green. S1 run 5 was the reverse of this: a run that
  // wrote into the main checkout and reported `fence: clean`, because nothing
  // looked. A containment failure is not a footnote on a green verdict.
  // Ruling 340 / bead `forge-8vfn.6.11.34`: growth in a tree where ANOTHER
  // process was working is named in full and is NOT fatal — attribution by
  // time window cannot tell a concurrent lane's own writes from this run's,
  // and a funded run must not go red on a reading nobody can make.
  // A named ground in a tree this run does not own is not somewhere another
  // lane is incidentally working — it is the operator's copy of the very repo
  // this run was told to leave alone. Ruling 340's live-process softening does
  // NOT apply to it, deliberately: this is RED regardless of the beats.
  // T1 1694 — a merge closure this run's log claimed and could not verify is never waved through (§6.15).
  if (ownGroundDrift.mergeAlignmentFailure !== null) {
    console.error(`[stories] ${story.id}: ${ownGroundDrift.mergeAlignmentFailure}`);
    printFinal('red');
    return 1;
  }
  if (ownGroundDrift.undeclared.length > 0) {
    console.error(
      `[stories] ${story.id}: CONTAINMENT FAILURE — ${ownGroundDrift.undeclared.length} change(s) in ` +
      `projects/${story.ground?.project} that nothing this run minted accounts for (named above). ` +
      'The run is RED regardless of its beats.',
    );
    printFinal('red');
    return 1;
  }

  // `forge-8vfn.7.6.139` — A DECLARATION THAT MATCHED NOTHING IS RED, not a note.
  //
  // 7.6.136 reported it and stayed green, which is §15.539's dead glob exactly:
  // a licence that cannot match cannot fail, so it stops protecting and stops
  // complaining in the same instant, and nothing distinguishes a live
  // declaration from a fossil.
  //
  // THIS IS ONLY UNAMBIGUOUS BECAUSE THE PREMISE IS CHECKED AT THE START. Until
  // `groundPinVerdict` moved into the runner, "unmatched because the product
  // stopped doing what the story says" and "unmatched because the ground was
  // already migrated" were one state — and reddening both would have failed
  // every idempotent re-run. The start-of-run refusal makes the second
  // unreachable, so what is left here is the first, and it deserves a red.
  if ((ownGroundDrift.unmatchedDeclarations ?? []).length > 0) {
    console.error(
      `[stories] ${story.id}: DECLARATION UNMATCHED — ${ownGroundDrift.unmatchedDeclarations.length} ` +
      `ground change(s) this story DECLARES its product makes did not happen (named above). The ground was ` +
      'at its declared pin when this run started, so the product stopped doing what the story says — or the ' +
      'story still describes behaviour that has since changed. The run is RED regardless of its beats.',
    );
    printFinal('red');
    return 1;
  }
  // `forge-8vfn.7.6.123`. THE NARROW GATE, and the narrowness is the point.
  //
  // Red when a session THIS RUN MINTED is still in the ground after the clear
  // captured it and removed it. That is a removal that did not take — the same
  // failure `fence.reappeared` exists for — and it is always achievable to
  // avoid, so it is a gate that can be passed.
  //
  // What this deliberately does NOT do is red on "the ground hash moved". A
  // develop run that commits into its ground moves that hash as its actual
  // product, and failing on it would fail every real run: ruling 594, and its
  // own words, "a gate that cannot be passed is not a gate". The drift is
  // reported either way; only the survival of a minted dir is fatal.
  if (ownGroundDrift.clear.unremoved.length > 0) {
    console.error(
      `[stories] ${story.id}: CONTAINMENT FAILURE — ${ownGroundDrift.clear.unremoved.length} session(s) this run ` +
      `minted are STILL in projects/${story.ground?.project} after being captured and removed ` +
      `(${ownGroundDrift.clear.unremoved.join(', ')}). The next run will refuse on the ground hash. ` +
      'The run is RED regardless of its beats.',
    );
    printFinal('red');
    return 1;
  }
  // Finding row 75 (T1 rulings 1258, 1332) — a census that never settled means
  // the trailing sweep above was REFUSED, not merely skipped: something this
  // run dispatched was still alive and this run cannot say it is not still
  // writing into `_queue/`, `_worktrees/` or this run's own ground. Silence
  // here is exactly the failure this census exists to close, so it is fatal
  // rather than a note.
  if (!trailing.census.empty) {
    console.error(
      `[stories] ${story.id}: CONTAINMENT FAILURE — the trailing sweep was refused: ${trailing.census.reason} ` +
      '(named above). The run is RED regardless of its beats.',
    );
    printFinal('red');
    return 1;
  }
  // The re-read half of the same finding: a writer OUTSIDE the census — no
  // ancestry through anything this run dispatched — recreated a path the
  // sweep reported CLEARED. Never a silent CLEARED for a path that came back.
  if (trailing.reappearedArtefacts.length > 0) {
    console.error(
      `[stories] ${story.id}: CONTAINMENT FAILURE — ${trailing.reappearedArtefacts.length} artefact(s) this ` +
      `run's trailing sweep cleared reappeared after being re-read (${trailing.reappearedArtefacts.join(', ')}, ` +
      'named above). The run is RED regardless of its beats.',
    );
    printFinal('red');
    return 1;
  }
  // T1 ruling 1332 — `fence.reappeared` NAMED a removal that did not stick and
  // stopped there; "never a silent CLEARED" is a sentence printed, not
  // enforced, until it also ends the run.
  if (fence.reappeared.length > 0) {
    console.error(
      `[stories] ${story.id}: CONTAINMENT FAILURE — ${fence.reappeared.length} path(s) this run removed ` +
      `reappeared when re-read (${fence.reappeared.join(', ')}, named above). The run is RED regardless of ` +
      'its beats.',
    );
    printFinal('red');
    return 1;
  }
  // Row 188 (bead forge-8vfn.8.5.25), T1 ruling 1973dz — HEAD moved on the
  // tree running this story: a COMMITTED escape, which the porcelain fence
  // above cannot see by construction (S1's onboarding agent committed
  // 72ed93fa2 onto the lane's own branch and the fence printed `clean`). Red
  // whether or not the clear could undo it — it ran, named above, in
  // `host-head.mjs`.
  if (hostHead.red) {
    console.error(
      `[stories] ${story.id}: CONTAINMENT FAILURE — ${hostHead.summary} (named above). ` +
      'The run is RED regardless of its beats.',
    );
    printFinal('red');
    return 1;
  }
  if (fence.groundEscapes.length > 0) {
    console.error(
      `[stories] ${story.id}: CONTAINMENT FAILURE — projects/${story.ground?.project} CHANGED in ` +
      `${fence.groundEscapes.length} worktree(s) this run does not own (files named above). ` +
      'The run is RED regardless of its beats.',
    );
    printFinal('red');
    return 1;
  }
  // M7-D — a fixture run that moved a real ground, or could not hash one, is
  // RED regardless of its beats. The gate sits after `writeStoryJson` so the
  // run's `story.json` has recorded the `realGrounds` evidence first.
  if (!realFence.ok) {
    console.error(
      `[stories] ${story.id}: CONTAINMENT FAILURE — ${realFence.moved.length} real ground(s) moved and ` +
      `${realFence.unreadable.length} could not be hashed during this fixture run (named above as REAL GROUND ` +
      'MOVED / UNREADABLE). The run is RED regardless of its beats.',
    );
    printFinal('red');
    return 1;
  }
  const thisRun = fence.escapes.filter((e) => e.owner === 'this-run'); // T1 ruling 1225 — no-owner is not evidence of authorship
  const escaped = thisRun.reduce((n, e) => n + e.paths.length, 0);
  if (escaped > 0) {
    console.error(
      `[stories] ${story.id}: CONTAINMENT FAILURE — ${escaped} path(s) written into ` +
      `${thisRun.length} worktree(s) this run's own ancestry (named above). The run is RED ` +
      'regardless of its beats.',
    );
    printFinal('red');
    return 1;
  }
  // T1 ruling 1350 — a fork case's own ground, judged like the base ground above.
  if (forkGrounds.redReason !== null) {
    console.error(`[stories] ${story.id}: ${forkGrounds.redReason}`);
    printFinal('red');
    return 1;
  }

  // `forge-8vfn.8.5.17` (row 181) — a gallery-regen failure is folded in
  // here rather than thrown from inside `runStory`: `regenerateGalleryForRun`
  // never throws (see its header, gallery.mjs), so without this gate a
  // genuinely foreign untracked target would silently stop aborting the
  // batch AND stop reddening the run that hit it. Never this story's own
  // artefacts — those are always exempt — only a leftover no story in this
  // invocation produced.
  if (galleryRegenFailure !== null) {
    console.error(
      `[stories] ${story.id}: GALLERY REGEN FAILED — ${galleryRegenFailure}. The run is RED regardless of its beats.`,
    );
    printFinal('red');
    return 1;
  }

  printFinal(row.status === 'green' && spendHalt === null ? 'green' : 'red');
  return (row.status === 'green' && spendHalt === null) ? 0 : 1;
}
