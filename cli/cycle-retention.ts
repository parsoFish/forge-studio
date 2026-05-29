/**
 * S6A — cycle archive retention tiering.
 *
 * Plan 01's `brain-lint --scope cleanup-dry-run` reads `retention` from each
 * cycle-archive's frontmatter to decide which archives to keep verbatim,
 * which to summarise, and which to never touch. This module is the single
 * source of truth for the heuristic that picks the tier.
 *
 * Per docs/planning/2026-05-20-refinement/06-reflect.md §"Cycle archiving /
 * retention tagging" + S6A-DECISIONS.md "Retention tagging — heuristic":
 *
 *   load-bearing   — cycle produced ≥ 1 antipattern theme, OR saw any wedge
 *                    / recovery / error event, OR any reviewer send-back.
 *   interesting    — non-routine but no antipattern (≥ 2 themes written,
 *                    OR a `decision` theme, OR ≥ 1 send-back).
 *   routine        — minimal clean cycle, no new themes beyond a single
 *                    pattern confirmation.
 *
 * The orchestrator (not the agent) owns the heuristic — the reflector writes
 * a placeholder `retention: <auto>` and the orchestrator post-processes the
 * archive to populate the correct tier + `cited_by` list.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { EventLogEntry } from '../orchestrator/logging.ts';
import { cyclesThemesDir, projectThemesDir } from '../orchestrator/brain-paths.ts';

export type RetentionTag = 'load-bearing' | 'interesting' | 'routine';

/** Minimal theme shape used by the heuristic. */
export type ThemeMeta = {
  /** Absolute path to the theme file the reflector wrote. */
  path: string;
  /** Frontmatter `category` value (one of pattern/antipattern/decision/operation/reference, or null when missing). */
  category: string | null;
};

/**
 * Compute the retention tier for a cycle from its event log entries +
 * the themes the reflector wrote in this pass.
 */
export function assignRetention(
  events: EventLogEntry[],
  themesWritten: ThemeMeta[],
): RetentionTag {
  const hasAntipattern = themesWritten.some((t) => t.category === 'antipattern');
  if (hasAntipattern) return 'load-bearing';

  let sendBacks = 0;
  let hasError = false;
  let hasWedge = false;
  let hasRecovery = false;
  for (const ev of events) {
    if (ev.event_type === 'error') hasError = true;
    if (ev.message === 'reviewer.verdict.send-back') sendBacks += 1;
    if (typeof ev.message === 'string' && ev.message.includes('wedge-recovery')) {
      hasRecovery = true;
    }
    if (ev.message === 'ralph.end') {
      const sr = ev.metadata?.['stop_reason'];
      if (sr === 'wedged' || sr === 'iteration-budget') hasWedge = true;
    }
  }

  if (hasError || hasWedge || hasRecovery || sendBacks >= 1) {
    // Single send-back is operator pain (the dev-loop slipped); promote.
    return 'load-bearing';
  }

  const hasDecision = themesWritten.some((t) => t.category === 'decision');
  if (themesWritten.length >= 2 || hasDecision) {
    return 'interesting';
  }

  return 'routine';
}

/**
 * Scan theme files in the cycle's project + forge namespaces and return the
 * subset whose body or frontmatter references this cycle id (`cycles/_raw/
 * <id>.md` OR `_logs/<id>/...`). Used to populate `cited_by` on the cycle
 * archive.
 *
 * The reflector writes themes during the pass we're closing; this function
 * is called AFTER the agent exits, so the themes are on disk.
 *
 * Restricted to **themes written or modified after `sinceMs`** so we count
 * the current cycle's writes, not historical references. Callers pass the
 * reflector-start timestamp.
 */
export function collectCitedBy(opts: {
  forgeRoot: string;
  projectName: string;
  cycleId: string;
  sinceMs: number;
}): string[] {
  const { forgeRoot, projectName, cycleId, sinceMs } = opts;
  const cited: string[] = [];

  const candidateDirs = [
    projectThemesDir(forgeRoot, projectName),
    cyclesThemesDir(forgeRoot),
  ];

  for (const dir of candidateDirs) {
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of entries) {
      if (!file.endsWith('.md')) continue;
      const full = resolve(dir, file);
      let body: string;
      let mtimeMs: number;
      try {
        const st = statSync(full);
        mtimeMs = st.mtimeMs;
        if (mtimeMs < sinceMs) continue;
        body = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      if (
        body.includes(`cycles/_raw/${cycleId}`) ||
        body.includes(`_logs/${cycleId}/`) ||
        body.includes(`Cycle ${cycleId}`) ||
        body.includes(cycleId)
      ) {
        // Store as forge-rooted path for portability.
        const rel = full.startsWith(forgeRoot + '/')
          ? full.slice(forgeRoot.length + 1)
          : full;
        cited.push(rel);
      }
    }
  }

  return cited.sort();
}

/**
 * Read a cycle archive's frontmatter and surgically update (or insert) the
 * `retention` and `cited_by` fields. Preserves all other fields, comments,
 * and body. Idempotent — re-running with the same inputs is a no-op.
 *
 * If the archive does not exist or lacks frontmatter, returns false (caller
 * decides whether to emit a warning event).
 */
export function patchArchiveFrontmatter(
  archivePath: string,
  retention: RetentionTag,
  citedBy: string[],
): boolean {
  if (!existsSync(archivePath)) return false;
  const raw = readFileSync(archivePath, 'utf8');
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) return false;
  const fmEnd = raw.indexOf('\n---', 4);
  if (fmEnd === -1) return false;
  const fmBlock = raw.slice(4, fmEnd);
  const rest = raw.slice(fmEnd + 4); // skip "\n---"

  const lines = fmBlock.split(/\r?\n/);
  const out: string[] = [];
  let sawRetention = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^retention:/.test(line)) {
      out.push(`retention: ${retention}`);
      sawRetention = true;
      i += 1;
      continue;
    }
    if (/^cited_by:/.test(line)) {
      // Skip the existing cited_by line + any subsequent list-item lines.
      i += 1;
      while (i < lines.length && /^\s*-\s/.test(lines[i])) i += 1;
      continue;
    }
    out.push(line);
    i += 1;
  }
  if (!sawRetention) out.push(`retention: ${retention}`);

  // Append cited_by block.
  if (citedBy.length === 0) {
    out.push('cited_by: []');
  } else {
    out.push('cited_by:');
    for (const c of citedBy) out.push(`  - ${c}`);
  }

  const newRaw = '---\n' + out.join('\n').replace(/\n+$/, '') + '\n---' + rest;
  writeFileSync(archivePath, newRaw);
  return true;
}
