/**
 * Lineage derivation — the artifact-readiness map, the run's PR link, and the
 * gate note: "what documents/links has this run produced." Split out of
 * run-model-derive.ts (bead forge-8vfn.15; see that file's doc comment for
 * the full seam map).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { EventLogEntry } from '@forge/kernel';
import type { RunStatus, Run } from './run-view-types.ts';

// ---------------------------------------------------------------------------
// Artifact detection
// ---------------------------------------------------------------------------

export function deriveArtifacts(
  logDir: string,
  root: string,
  runStatus: RunStatus,
  initiativeId: string,
  hasReflectionEvents = false,
): Run['artifactsReady'] {
  const artifacts: Run['artifactsReady'] = {};
  const artifactsDir = join(logDir, 'artifacts');
  const mode = (runStatus === 'gated') ? 'gate' : 'view';

  // plan: PLAN.html in artifacts/
  if (existsSync(join(artifactsDir, 'PLAN.html'))) {
    artifacts['plan'] = 'view'; // plan is always view-only
  }

  // work-items: work-items-snapshot/ non-empty
  const wiSnapshotDir = join(logDir, 'work-items-snapshot');
  if (existsSync(wiSnapshotDir)) {
    try {
      const files = readdirSync(wiSnapshotDir).filter((f) => f.endsWith('.md'));
      if (files.length > 0) artifacts['work-items'] = 'view';
    } catch { /* ignore */ }
  }

  // pr: pr-description.md. New cycles mirror it into artifacts/ (same dir the
  // bridge route serves from); accept the legacy cycle-log-root location too so
  // older frozen logs still resolve.
  if (
    existsSync(join(artifactsDir, 'pr-description.md')) ||
    existsSync(join(logDir, 'pr-description.md'))
  ) {
    artifacts['pr'] = mode;
  }

  // demo: artifacts/demo.json
  if (existsSync(join(artifactsDir, 'demo.json'))) {
    artifacts['demo'] = mode;
  }

  // verdict: the cycle's own artifacts/verdict.json — the durable artifact
  // `writeVerdictJson` writes on every operator approve/send-back (ADR-027)
  // and the file the /artifact viewer itself renders. W7-B7 (artifact-plan-11):
  // this used to be detected ONLY via `<initiativeId>.verdict-response.md` in
  // a queue dir — a file nothing writes any more — so the verdict trail chip
  // read "Not yet produced" on every run, merged ones included.
  if (existsSync(join(artifactsDir, 'verdict.json'))) {
    artifacts['verdict'] = 'view';
  } else {
    // Legacy fallback: <initiativeId>.verdict-response.md in any queue dir
    // (walk up) so frozen pre-ADR-027 logs still resolve.
    // R4-11-F1: `merged` included — a confirmed-merge manifest sits there
    // briefly between closure's two terminal moves (→merged, then merged→done
    // in the same sweep), and the verdict response written at approval time
    // still needs to resolve during that window.
    const verdictFile = `${initiativeId}.verdict-response.md`;
    const queueRoot = join(resolve(root), '_queue');
    for (const state of ['done', 'merged', 'failed', 'ready-for-review', 'pending', 'in-flight']) {
      if (existsSync(join(queueRoot, state, verdictFile))) {
        artifacts['verdict'] = 'view';
        break;
      }
    }
  }

  // reflection: present when reflector events exist in the event log
  if (hasReflectionEvents) {
    artifacts['reflection'] = 'view';
  }

  return artifacts;
}

// ---------------------------------------------------------------------------
// PR link derivation
// ---------------------------------------------------------------------------

/**
 * W7-B7 (artifact-plan-17): the run's PR URL, derived from its own
 * `reviewer.pr-opened` event (`openPrInline` records `metadata.url` verbatim
 * when `gh pr create` succeeds). Latest wins — a requeue that re-opened the
 * PR names the live one. Honestly absent (`undefined`) when no such event
 * exists or the recorded url is not a string (`reviewer.pr-open-failed`
 * writes `url: null`). Derive-don't-store: nothing new is persisted.
 */
export function findPrUrl(events: readonly EventLogEntry[]): string | undefined {
  let url: string | undefined;
  for (const e of events) {
    if (e.message !== 'reviewer.pr-opened') continue;
    const u = e.metadata?.url;
    if (typeof u === 'string' && u.length > 0) url = u;
  }
  return url;
}

// ---------------------------------------------------------------------------
// Gate note
// ---------------------------------------------------------------------------

export function findGateNote(logDir: string): string {
  const prPath = join(logDir, 'pr-description.md');
  if (existsSync(prPath)) {
    try {
      const content = readFileSync(prPath, 'utf8');
      const match = content.match(/^#+ (.+)/m);
      if (match) return match[1].trim();
    } catch { /* ignore */ }
  }
  return 'Awaiting operator verdict';
}
