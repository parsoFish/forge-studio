/**
 * sweep-post-stop-logs.mjs — the `_logs/_agent-*` and `_logs/_authoring-*`
 * dirs a STOPPED run strands, born-time scoped.
 *
 * Split out of `sweep.mjs` at the 800-line cap (SPLIT, NEVER BASELINE — T1
 * ruling 492): `sweepCycleArtefacts` there already grew to cover row 146's
 * first three targets (`_queue/*`, `_worktrees`, `_logs/<ts>_INIT-*`); adding
 * this fourth and fifth pushed the file to 874 lines, so this is its own
 * module, the same shape `sweep-agent-logs.mjs` already used for the same cap.
 *
 * WHY THESE TWO FAMILIES. `residue.sh`
 * (`.claude/skills/tiered-orchestration/scripts/residue.sh:68-69`) gates
 * `_logs/_agent-*` (an agent turn, `STANDALONE_RUN_DIR_PREFIX` in
 * `packages/agents/bridge-agents-run-state.ts`) and `_logs/_authoring-*` (an
 * authoring session) exactly as it gates the queue/worktree/cycle-dir targets
 * `sweepCycleArtefacts` already covers. A run stopped by SIGTERM/SIGINT
 * strands these two families the same way it strands the other three —
 * bead `forge-8vfn.8.1.52`, row 146, ruling 1911 ("the guard's gating
 * targets").
 *
 * BIRTH TIME IS THE WHOLE RULE, deliberately narrower than
 * `captureAndSweepAgentLogs` (`sweep-agent-logs.mjs`, story-name-keyed,
 * LEADING-sweep only) and `captureAndClearMintedLogs` (`ground-clear.mjs`,
 * ground-manifest before/after diff plus `loadRegisteredSessionKindIds` —
 * `run-story.mjs`'s own end-of-run evidence rule). Those two decide what a
 * STORY's own verdict may claim as evidence; a post-stop sweep only needs
 * "this run created it, so it goes". The run's own tree is lane-private, so
 * `mtimeMs` against the run's own `sinceMs` is the entire scoping rule — the
 * SAME one `collectAgentRuns` (`reap.mjs`) already uses to attribute a
 * dispatched session to a run.
 *
 * ONE LOOP OVER EVERY PREFIX, not one copy per family: `prefixes` is a list,
 * so `_agent-` and `_authoring-` share one capture-then-clear rather than
 * duplicating it.
 */
import { readdirSync, statSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** `_logs/<prefix><anything>` dirs born in [sinceMs, untilMs]. */
function bornLogDirNames(logsDir, prefix, sinceMs, untilMs) {
  let entries;
  try {
    entries = readdirSync(logsDir, { withFileTypes: true });
  } catch {
    return []; // no _logs/ yet — nothing has been born
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || !e.name.startsWith(prefix)) continue;
    let mtimeMs;
    try {
      mtimeMs = statSync(join(logsDir, e.name)).mtimeMs;
    } catch {
      continue; // gone by the time we looked — nothing left to capture
    }
    if (mtimeMs >= sinceMs && mtimeMs <= untilMs) out.push(e.name);
  }
  return out.sort();
}

/**
 * Capture-then-clear every `_logs/` dir matching any of `prefixes` and born
 * in the window. Same contract as every other clear in this tree: a capture
 * that throws leaves the directory alone, and "cleared" is a re-read, never
 * an inference from a `rmSync` call that did not throw.
 *
 * @returns {{captured: string[], cleared: string[],
 *            refused: {dir: string, reason: string}[], unremoved: string[]}}
 */
export function captureAndClearBornLogDirs(root, { prefixes, sinceMs, untilMs = Date.now(), evidenceDir }) {
  const out = { captured: [], cleared: [], refused: [], unremoved: [] };
  const logsDir = join(root, '_logs');
  for (const prefix of prefixes) {
    for (const name of bornLogDirNames(logsDir, prefix, sinceMs, untilMs)) {
      const from = join(logsDir, name);
      try {
        mkdirSync(evidenceDir, { recursive: true });
        cpSync(from, join(evidenceDir, name), { recursive: true, preserveTimestamps: true });
      } catch (error) {
        out.refused.push({
          dir: name,
          reason: `capture failed (${error.message}) — not removing what was not captured`,
        });
        continue;
      }
      out.captured.push(name);
      try {
        rmSync(from, { recursive: true, force: true });
      } catch {
        /* checked by the re-read below, never trusted from the throw alone */
      }
      if (existsSync(from)) out.unremoved.push(name);
      else out.cleared.push(name);
    }
  }
  return out;
}

/** One line per outcome, in the shape the other clears in this tree print. */
export function describeBornLogDirsClear(result) {
  if (result.captured.length === 0 && result.refused.length === 0) {
    return ['own logs: no _agent-*/_authoring-* dir born in this run\'s window — nothing to clear'];
  }
  const lines = [];
  for (const n of result.captured) lines.push(`own logs: CAPTURED ${n}`);
  for (const n of result.cleared) lines.push(`own logs: CLEARED ${n} — removed, re-read to confirm`);
  for (const n of result.unremoved) {
    lines.push(`own logs: NOT REMOVED ${n} — captured, still present after removal`);
  }
  for (const r of result.refused) lines.push(`own logs: REFUSED ${r.dir} — ${r.reason}`);
  return lines;
}
