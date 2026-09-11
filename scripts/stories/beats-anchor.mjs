/**
 * 718(1) — where a channel wait starts LOOKING, which is not always where it
 * starts WAITING.
 *
 * `makeAgentChannelDoor` searches `_logs/` for a dispatch dir born since a
 * moment the caller supplies, and until now that moment was always the wait's
 * own start. That is correct for a press that dispatches its own work: nothing
 * born earlier can belong to it.
 *
 * It is wrong for a beat that WATCHES work another beat started, and S10 run 11
 * measured the cost. Beat 7 pressed `scheduler-start`; the daemon claimed the
 * initiative and had its cycle dir on disk at `13:21:29.798`, **449 ms before
 * beat 7's own green** and so before beat 8 pressed at all. Beat 8's door found
 * nothing born since its press — correctly — and printed `nothing under _logs/
 * was created by this press`, which asserts more than the door knows. The cycle
 * it could not see reached `cycle.end` sixty seconds before the beat gave up.
 *
 * So a beat may NAME the earlier press whose work it is watching, and the search
 * window opens there instead.
 *
 * THE BOUND DOES NOT MOVE. Only the search window does. An anchor that also
 * moved the deadline would let a beat inherit another beat's elapsed time and
 * silently shorten its own budget — a bound is a statement about how long THIS
 * step may take, and nothing about where its evidence begins.
 */

/**
 * The millisecond the channel search should start from.
 *
 * @param {{for?: string, anchor?: string}|null} wait the beat's declared wait
 * @param {Map<string, number>} pressedAt press handle → the ms it was pressed
 * @param {number} waitStartedMs when THIS wait began — the default and the bound's origin
 * @returns {number}
 */
export function resolveAnchorMs(wait, pressedAt, waitStartedMs) {
  const anchor = wait?.anchor;
  if (anchor === undefined || anchor === null) return waitStartedMs;

  const at = pressedAt.get(anchor);
  if (at === undefined) {
    // REFUSE, NEVER FALL BACK. A silent fallback to the wait's start restores
    // exactly the defect this exists to fix, and does it invisibly: the beat
    // reds `no-channel` again and the verdict is indistinguishable from a real
    // one. A story that names a press no beat performs is a story with a typo,
    // and a typo that degrades into the old behaviour is the worst outcome.
    throw new Error(
      `[stories] wait anchor "${anchor}": no beat pressed it before this wait — ` +
      `an anchor must name a press this story has already performed ` +
      `(pressed so far: ${[...pressedAt.keys()].join(', ') || 'none'})`,
    );
  }
  if (at > waitStartedMs) {
    // Not reachable by ordinary authoring — a press cannot happen after a wait
    // that follows it — so this is a re-entered or re-ordered story, and the
    // window it asks for has not opened yet. Searching from the future finds
    // nothing and reads as "the product did nothing".
    throw new Error(
      `[stories] wait anchor "${anchor}" was pressed AFTER this wait began ` +
      `(${at} > ${waitStartedMs}) — the search window has not opened`,
    );
  }
  return at;
}
