/**
 * halt-watch.ts — the serve loop's view of the one emergency halt (ADR 011).
 *
 * `createHaltWatch` returns one function the tick calls; it reads the record
 * from disk on every call (no cache) and logs only on a transition into halt,
 * a reminder at most once per `HALT_REMINDER_MS` while halted, and the
 * transition out. Never once per tick.
 */
import { resolve } from 'node:path';
import { readHalt, haltPath } from '@forge/kernel';

/** At most one reminder line per interval while the halt stays on. */
export const HALT_REMINDER_MS = 10 * 60_000;

export type HaltWatchDeps = { log: (line: string) => void; now: () => number };

/** `() => boolean`: true while halted. */
export function createHaltWatch(queueRoot: string, deps: HaltWatchDeps): () => boolean {
  let announcedAt: number | null = null;
  return () => {
    const halt = readHalt(queueRoot);
    if (halt === null) {
      if (announcedAt !== null) {
        deps.log('[serve] emergency halt released — claiming again');
        announcedAt = null;
      }
      return false;
    }
    const t = deps.now();
    if (announcedAt === null || t - announcedAt >= HALT_REMINDER_MS) {
      announcedAt = t;
      deps.log(
        `[serve] emergency halt on since ${halt.since ?? 'unknown (record unreadable)'} — claiming nothing; release it from Studio (Release halt) or remove ${haltPath(resolve(queueRoot))}`,
      );
    }
    return true;
  };
}
