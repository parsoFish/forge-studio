/**
 * halt-record.mjs — a story run never starts on a halted ground and never
 * leaves a halt behind.
 *
 * The emergency halt (D-03) is one record, `_queue/halt.json`, that the
 * product reads on every claim: while it exists `forge serve` claims nothing
 * and every agent dispatch is refused. A run that starts on a ground carrying
 * one would see every beat that waits on a claim time out for a reason no
 * beat names, so the runner refuses before it boots anything. A run that pulls
 * the halt itself (S10's halt beats) and then goes red mid-episode would hand
 * the next run that same silent wedge, so the teardown clears it on every
 * path — green, red, or an operator stop.
 *
 * `run.mjs` runs under plain `node` and cannot import `packages/kernel/
 * halt.ts`; `halt-record.test.ts` binds `HALT_RECORD` to the product's own
 * `haltPath` so the two cannot name different files.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** The halt record, relative to the run's own worktree. */
export const HALT_RECORD = join('_queue', 'halt.json');

/** The `since` a halt record names, or `null` when it names none or is unreadable. */
function haltSince(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return typeof parsed?.since === 'string' ? parsed.since : null;
  } catch {
    return null;
  }
}

/**
 * Does this tree already carry a halt record? Any record refuses — the
 * product reads an unreadable record as halted too.
 *
 * @param {string} root the run's own worktree
 * @returns {{ok: boolean, reason: string}}
 */
export function preexistingHaltVerdict(root) {
  const path = join(root, HALT_RECORD);
  if (!existsSync(path)) {
    return Object.freeze({ ok: true, reason: `no ${HALT_RECORD} — no emergency halt on this ground` });
  }
  const since = haltSince(path);
  return Object.freeze({
    ok: false,
    reason:
      `an emergency halt is already on (${HALT_RECORD}${since === null ? '' : `, since ${since}`}) — ` +
      'forge serve claims nothing and every agent dispatch is refused while it exists, so every beat ' +
      'that waits on a claim would time out. Release it in Studio (Release halt) or remove ' +
      `${HALT_RECORD}, then re-run.`,
  });
}

/**
 * Remove a halt record this run left behind. The preflight refused any record
 * that existed before the run, so one present here is the run's own.
 *
 * @param {string} root the run's own worktree
 * @returns {{ok: boolean, lines: string[]}}
 */
export function clearRunHalt(root) {
  const path = join(root, HALT_RECORD);
  if (!existsSync(path)) return Object.freeze({ ok: true, lines: Object.freeze([]) });
  const since = haltSince(path);
  try {
    rmSync(path);
  } catch (err) {
    return Object.freeze({
      ok: false,
      lines: Object.freeze([
        `[stories] teardown: COULD NOT clear the emergency halt this run left (${HALT_RECORD}): ` +
          `${err?.message ?? err} — the next run on this ground refuses until it is removed`,
      ]),
    });
  }
  return Object.freeze({
    ok: true,
    lines: Object.freeze([
      `[stories] teardown: cleared the emergency halt this run left (${HALT_RECORD}` +
        `${since === null ? '' : `, since ${since}`})`,
    ]),
  });
}
