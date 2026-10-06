/**
 * verify-cycle-merge-landed.mjs — the "manifest landed in merged/ or done/"
 * half of verify-cycle's "cycle reached merge" check (bead forge-8vfn.30.5).
 *
 * INCIDENT. The architect minted an initiative id an earlier run had already
 * left in `_queue/done/`. The old check (`existsSync` on `<id>.md`) accepted
 * that STALE manifest three minutes into the new run, wrote gate FAIL, and the
 * teardown then left the real cycle running. A bare id match proves nothing;
 * the manifest must belong to the cycle this run started:
 *
 *   - its frontmatter `cycle_id` equals the cycle this run discovered after
 *     its own plan gate (no known cycle id = fail closed), AND
 *   - its mtime is not older than this run's start (a rename across queue
 *     states preserves mtime, and the architect wrote it after the start).
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function cycleIdOf(raw) {
  const m = raw.match(/^cycle_id:\s*(.+)$/m);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

/** True iff `<initiativeId>.md` sits in `queuePaths.merged` or `.done`, was
 *  written at/after `runStartMs`, and carries `cycleId`. Never throws. */
export function manifestLandedForRun({ queuePaths, initiativeId, cycleId, runStartMs }) {
  if (!cycleId) return false;
  for (const dir of [queuePaths.merged, queuePaths.done]) {
    const file = join(dir, `${initiativeId}.md`);
    try {
      if (statSync(file).mtimeMs < runStartMs) continue;
      if (cycleIdOf(readFileSync(file, 'utf8')) === cycleId) return true;
    } catch {
      continue; // absent/unreadable in this state dir
    }
  }
  return false;
}
