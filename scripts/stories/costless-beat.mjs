/**
 * costless-beat.mjs — findings row 61: a beat's own `costless: true`,
 * enforced.
 *
 * Split out of `run-story.mjs`'s beat loop rather than baselined: adding this
 * feature inline took that file to 825 of the 800-line hard cap, and the cap
 * exists to be friction at exactly this moment rather than a number raised to
 * fit whatever landed last. The seam is the whole feature — everything a
 * costless declaration needs beyond the two values `run-story.mjs` already
 * holds (`ROOT`, `startedMs`) lives here, so the loop keeps only the one line
 * that decides whether to skip the real-spawn probe and stall door, which
 * cannot move: both are built from `page`/`bindings` the loop alone has.
 *
 * TWO READINGS, NEVER THE DECLARATION — the same shape `spendCeilingVerdict`
 * already uses for the story's own ceiling, applied to one beat's own window.
 * `costlessSpendUsd` takes ONE reading (before or after, the caller decides
 * which); `applyCostlessGuard` compares two of them via `costlessBeatVerdict`
 * (`spend.mjs`) and reddens the beat's own verdict on measured growth. A beat
 * that declared costless and dispatched something anyway is RED regardless of
 * what its own `expect` judged, because the declaration is itself a claim
 * about the product and this is where it is checked.
 */
import { summariseRunSpend, costlessBeatVerdict } from './spend.mjs';
import { collectSpendDirs, readRunEvents } from './run-observe.mjs';

/**
 * ONE measured spend reading for this run, at the instant it is called.
 *
 * Read even when the story is not itself a costed one: a `costless`
 * declaration is the BEAT's own assertion, independent of the story's ground.
 *
 * @param {string} root the worktree
 * @param {number} startedMs this run's own start
 * @param {boolean} realSpawn `story.ground?.realSpawn === true`
 * @returns {number|null} `summariseRunSpend`'s `usd` — null means UNMEASURED
 */
export function costlessSpendUsd(root, startedMs, realSpawn) {
  return summariseRunSpend({
    realSpawn,
    events: collectSpendDirs(root, startedMs).map(readRunEvents),
  }).usd;
}

/**
 * Redden a beat's own verdict when its `costless: true` declaration did not
 * hold — never otherwise: `costlessBeatVerdict` returns `ok: true` on an
 * unchanged or UNMEASURED reading, and this passes the verdict through
 * untouched in either case.
 *
 * @param {Readonly<object>} verdict the verdict `driveBeat` already returned
 * @param {number|null} beforeUsd this beat's `costlessSpendUsd` reading, taken before it ran
 * @param {number|null} afterUsd the same reading, taken after
 * @returns {Readonly<object>}
 */
export function applyCostlessGuard(verdict, beforeUsd, afterUsd) {
  const v = costlessBeatVerdict(beforeUsd, afterUsd);
  if (v.ok) return verdict;
  return Object.freeze({
    ...verdict,
    status: 'red',
    failures: Object.freeze([...verdict.failures, v.reason]),
  });
}
