/**
 * Where a demo session's files live on disk, and how a generation is snapshotted.
 *
 * Split out of `demo-builder.ts` by the M4 row-37 affordance carve: that file
 * took the kind's two generic-affordance arms and would have crossed the
 * 800-line cap. This is the seam nothing else crosses — the kind directory, the
 * per-generation snapshot layout (R4-16) and the three guarded readers/writers
 * that walk it. `bridge-studio-demo.ts` and `studio/session-transcript.ts`
 * already imported the layout constants; they now name this module instead.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { guardedFile, guardedReadFile, guardedReadDir } from '@forge/kernel';

/** R4-16 — session-dir-relative home for per-generation snapshots
 *  (`<sessionDir>/generations/<n>/`), NEVER the project repo (D4: the
 *  derivation may not read outside sessionDir, and project-repo history would
 *  commit intermediate generations onto the project's forge-studio branch). */
export const GENERATIONS_DIRNAME = 'generations';
/** The two files a generation snapshots — exactly the pair `runGenerateStep`
 *  already verifies (D5) — plus the metadata file recording how to restore
 *  them. */
export const GENERATION_DEMO_FILENAME = 'DEMO.html';
export const GENERATION_SKILL_FILENAME = 'SKILL.md';
export const GENERATION_META_FILENAME = 'meta.json';

/** The kind-dir under a project root that holds demo-builder sessions. */
export const DEMO_KIND_DIR = '_demo';


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** R4-16 — the subset of a generation's meta.json the lock-step restore
 *  needs. Fails CLOSED (returns null) on ANY shape violation: missing file,
 *  unreadable, not JSON, or a missing/non-string `skillRelPath` (the field
 *  the restore writes the skill back to — load-bearing). */
type GenerationSnapshotMeta = { readonly skillRelPath: string };

export function readGenerationSnapshotMeta(projectRoot: string, sessionId: string, n: number): GenerationSnapshotMeta | null {
  // SEC-04 leaf: route the meta.json read through the guard (leaf included) so a
  // symlinked meta.json under generations/<n>/ collapses to null.
  const raw = guardedReadFile(projectRoot, [DEMO_KIND_DIR, sessionId, GENERATIONS_DIRNAME, String(n), GENERATION_META_FILENAME]);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const rec = parsed as Record<string, unknown>;
  if (typeof rec.skillRelPath !== 'string' || rec.skillRelPath.length === 0) return null;
  return { skillRelPath: rec.skillRelPath };
}

/** The generation numbers that DO have a `generations/<n>/` dir on disk —
 *  used only to name what's available in the R4-16 fail-closed lock error.
 *  Best-effort: a missing/unreadable `generations/` dir yields []. */
export function listExistingGenerationNumbers(projectRoot: string, sessionId: string): number[] {
  // SEC-04 leaf: the generations/ dir readdir routed through the guard.
  const names = guardedReadDir(projectRoot, [DEMO_KIND_DIR, sessionId, GENERATIONS_DIRNAME]);
  if (names === null) return [];
  return names
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
}

/**
 * SEC-04 leaf: resolve a guarded WRITE path for a session-dir leaf (leaf
 * included), mkdir its parent, and return it — throwing (fail closed, the
 * runner contract) if the leaf escapes. Returns the path (not the write) so the
 * caller keeps its Buffer/string write for byte-identical snapshots.
 */
export function guardedGenerationWritePath(projectRoot: string, segs: readonly string[], what: string): string {
  const p = guardedFile(projectRoot, segs, 'write');
  if (p === null) {
    throw new Error(`demo-builder runner: ${what} write failed containment (symlinked/escaping leaf) — refusing to write.`);
  }
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

