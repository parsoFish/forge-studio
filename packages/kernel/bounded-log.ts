/**
 * A small, per-key JSON-array log with bounded retention — generic
 * infrastructure for "the last N things that happened for id X", so a
 * caller does not hand-roll its own read-modify-write JSON file (forge-
 * 6gv.8.1, library-33: the hook test-fire run log). Guarded via path-
 * guard.ts's helpers; `T` is opaque JSON to this module — never inspected.
 */
import { guardedReadFile, guardedWriteFile } from './path-guard.ts';

/** Every entry for this key, NEWEST FIRST, or `[]` when the log has never
 *  been written, is unreadable, is not valid JSON, or does not hold a JSON
 *  array — corruption reads as "nothing recorded yet", never a throw. */
export function readBoundedLog<T>(root: string, segments: readonly string[]): T[] {
  const raw = guardedReadFile(root, segments);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/** Prepend `entry`, keep at most `max` (oldest falls off), write back.
 *  Returns the new array, or `null` if containment rejected the path — the
 *  write never happened, and the caller decides how to report that (same
 *  no-throw contract as `guardedWriteFile`). */
export function appendBoundedLog<T>(root: string, segments: readonly string[], entry: T, max: number): T[] | null {
  const next = [entry, ...readBoundedLog<T>(root, segments)].slice(0, max);
  const written = guardedWriteFile(root, segments, JSON.stringify(next));
  return written === null ? null : next;
}

/** `[dir, "<id>.json"]` — the one segment derivation every bounded-log
 *  reader/writer for a namespace shares, so two call sites cannot drift. */
export function boundedLogSegments(dir: string, id: string): string[] {
  return [dir, `${id}.json`];
}

/** Truncate `s` to `maxChars`, appending a marker when cut — the shared
 *  bound for content a bounded log stores (e.g. captured process output). */
export function truncateTail(s: string, maxChars: number): string {
  return s.length > maxChars ? `${s.slice(0, maxChars)}…(truncated)` : s;
}
