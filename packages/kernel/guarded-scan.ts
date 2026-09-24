/**
 * Shared mechanism for a REQUEST-PATH SCAN THAT MUST NOT OPEN EVERY ENTRY ON
 * DISK to answer one request — moved down from `packages/library` (M7-C U2,
 * forge-8vfn.5.16, T2 review of `95cb287f`) so every rank ≥ 1 package
 * imports ONE mechanism instead of each carrying its own copy, mirroring
 * `case-folding-probe.ts`'s own precedent (moved down from `agents`/
 * `library` for the identical reason). This module owns only the
 * mechanism — the domain-specific fold (which events count, what a "fire"
 * means) stays with its caller, e.g. `packages/library/studio/hook-fire-
 * summary.ts`.
 *
 * `packages/agents/bridge-agents-history-rows.ts` keeps its OWN independent
 * mtime-sort copy (`sortEntriesByMtimeDesc`) for now — it shipped in a
 * still-open PR (#834); repointing it to this module is a follow-up once
 * that PR lands, not part of this change.
 */
import { statSync, openSync, readSync, closeSync } from 'node:fs';
import { resolveGuardedPath } from './path-guard.ts';

/** Guarded mtime of one root-relative entry (a directory or a file) —
 *  `resolveGuardedPath` then `statSync(...).mtimeMs`. `null` on rejection,
 *  absence, or a stat race after the guard — never a thrown error. */
export function guardedMtime(root: string, segments: readonly string[]): number | null {
  const guarded = resolveGuardedPath(root, segments);
  if (!guarded.ok || !guarded.exists) return null;
  try {
    return statSync(guarded.realPath).mtimeMs; // guard-terminal: realPath IS the guard's own output
  } catch {
    return null;
  }
}

/** Sorts `entries` newest-first by the injected `mtimeOf` (an entry whose
 *  `mtimeOf` returns `null` sorts LAST — never prioritised over one whose
 *  age is actually known), then keeps the newest `max`. Pure + injectable
 *  so a test can prove a scan's bound with a counting fake rather than a
 *  real, timestamped filesystem. */
export function selectRecentEntries(
  entries: readonly string[],
  mtimeOf: (entry: string) => number | null,
  max: number,
): string[] {
  const rank = (entry: string): number => mtimeOf(entry) ?? -Infinity;
  return entries.slice().sort((a, b) => rank(b) - rank(a)).slice(0, max);
}

/** Guarded read of the last `maxBytes` of a file (or the whole file when
 *  smaller) — the same guard as `guardedReadFile`, then a bounded
 *  positional read off the guard's own realPath. `null` on rejection,
 *  absence, or error. Byte-bounded only: a caller reading line-oriented
 *  content (e.g. JSONL) is responsible for its own truncated-leading-line
 *  tolerance (a parser that already skips a malformed line needs none). */
export function guardedReadFileTail(root: string, segments: readonly string[], maxBytes: number): string | null {
  const guarded = resolveGuardedPath(root, segments);
  if (!guarded.ok || !guarded.exists) return null;
  let fd: number | null = null;
  try {
    const size = statSync(guarded.realPath).size; // guard-terminal: realPath IS the guard's own output
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    if (length === 0) return '';
    fd = openSync(guarded.realPath, 'r');
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, start);
    return buf.toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch { /* ignore */ } }
  }
}
