/**
 * halt.ts — the one emergency halt record (ADR 011).
 *
 * `<queueRoot>/halt.json` (`{ since, actor }`) present means halted, absent
 * means not. Every check reads the file, so the halt holds across a Studio
 * restart, a `forge serve` respawn and a reboot. A record that cannot be read
 * or parsed reads as halted: the brake fails closed.
 *
 * Kernel so the queue claim (flows) and the dispatch claim (kernel) read the
 * same record.
 */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type HaltRecord = { since: string | null; actor: string | null };

/** The queue root under a forge root: the one resolver the dispatch claim, the
 *  bridge and (through `getPaths`) `forge serve` all name the same directory by. */
export function forgeQueueRoot(forgeRoot: string): string {
  return resolve(forgeRoot, '_queue');
}

/** The record's location under a queue root. */
export function haltPath(queueRoot: string): string {
  return join(queueRoot, 'halt.json');
}

/** `null` when not halted; the record when halted. A present record that cannot
 *  be read or parsed is `{ since: null, actor: null }` (halted). */
export function readHalt(queueRoot: string): HaltRecord | null {
  let raw: string;
  try {
    raw = readFileSync(haltPath(queueRoot), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return { since: null, actor: null };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { since: null, actor: null };
    const { since, actor } = parsed as Record<string, unknown>;
    if (typeof since !== 'string' || Number.isNaN(Date.parse(since))) return { since: null, actor: null };
    return { since, actor: typeof actor === 'string' ? actor : null };
  } catch {
    return { since: null, actor: null };
  }
}

/** Halt, atomically. A second press keeps the first record, `since` unchanged;
 *  an unreadable record is replaced by a valid one. */
export function writeHalt(queueRoot: string, actor: string): HaltRecord {
  const existing = readHalt(queueRoot);
  if (existing !== null && existing.since !== null) return existing;
  const record: HaltRecord = { since: new Date().toISOString(), actor };
  mkdirSync(queueRoot, { recursive: true });
  const tmp = `${haltPath(queueRoot)}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(record)}\n`);
  renameSync(tmp, haltPath(queueRoot));
  return record;
}

/** Release the halt. Absent is a no-op; any other failure throws. */
export function releaseHalt(queueRoot: string): void {
  try {
    unlinkSync(haltPath(queueRoot));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
