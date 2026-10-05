// How long a page stays trusted after its `last_verified` date (R22).
export const PAGE_TYPES = /** @type {const} */ (['guide', 'how-to', 'reference', 'explanation']);

const WINDOW_DAYS = Object.freeze({ guide: 120, 'how-to': 120, reference: 180, explanation: 180 });
const DAY_MS = 24 * 60 * 60 * 1000;

export function windowDays(type) {
  const days = WINDOW_DAYS[type];
  if (days === undefined) throw new Error(`freshness: unknown page type ${JSON.stringify(type)}`);
  return days;
}

/** True when `lastVerified` is older than the type's window at `now`. */
export function isStale(type, lastVerified, now) {
  if (!(lastVerified instanceof Date) || Number.isNaN(lastVerified.getTime())) {
    throw new Error('freshness: last_verified is not a valid date');
  }
  return now.getTime() - lastVerified.getTime() > windowDays(type) * DAY_MS;
}
