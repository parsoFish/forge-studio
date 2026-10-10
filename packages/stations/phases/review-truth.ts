/**
 * What the review may claim about the head it names — bead forge-mfv5.1.30 (gitweave I1 round 2, 1d228b1:
 * a green D-20 fix read MISSED by declared-file presence; round-1 findings false at the head republished).
 * The facts here are the git record and the gate runner's exit code.
 */

import { makeQualityGateFromCmd, resolveGateTimeoutMs, type GateRunInfo } from '@forge/agents';

import { runnableSpan } from './decompose-completeness.ts';

type Git = (args: string[]) => { ok: boolean; out: string };
const WI_MERGE = /^wi\((.+)\): merge$/; // the subject `mergeWiIntoCycle` writes
const lines = (s: string): string[] => s.split('\n').filter(Boolean);

/** Files each work item's recorded `wi(<id>): merge` commits on `base..HEAD` changed — deletions and both sides of a rename count. Null when git cannot say. */
export function recordedDeliveries(git: Git, base: string): Map<string, string[]> | null {
  const log = git(['log', '--first-parent', '--merges', '--format=%H %s', `${base}..HEAD`]);
  if (!log.ok) return null;
  const out = new Map<string, string[]>();
  for (const [sha, ...subject] of lines(log.out).map((l) => l.split(' '))) {
    const id = WI_MERGE.exec(subject.join(' '))?.[1];
    if (id === undefined) continue;
    const files = git(['diff', '--name-only', '--no-renames', `${sha}^1`, sha!]);
    if (!files.ok) return null;
    out.set(id, [...(out.get(id) ?? []), ...lines(files.out)]);
  }
  return out;
}

/** True when a work item delivered between `sha` and HEAD (or `sha` is no longer an ancestor) — a record judged at `sha` judged a tree that is gone. */
export function deliveredSince(git: Git, sha: string): boolean {
  if (!git(['merge-base', '--is-ancestor', sha, 'HEAD']).ok) return true;
  const log = git(['log', '--first-parent', '--merges', '--format=%s', `${sha}..HEAD`]);
  return !log.ok || lines(log.out).some((s) => WI_MERGE.test(s));
}

/** A criterion's commands: the D-47 rule on WHEN, else THEN (where the review-fix compiler puts the operator's command — WI-7); null for prose or a span needing a shell. */
export function criterionCommands(ac: { when: string; then: string }): string[][] | null {
  const span = runnableSpan(ac.when) ?? runnableSpan(ac.then);
  if (span === null || /["'|<>$*?\\(){}]/.test(span)) return null;
  const segs = span.split(/&&|;/).map((s) => s.trim()).filter(Boolean); // EVERY segment must itself be a runner: `pytest && rm -rf x` runs nothing
  return segs.every((s) => runnableSpan(`\`${s}\``) !== null) ? segs.map((s) => s.split(/\s+/)) : null;
}

/** Run a criterion's commands at the head through the per-WI gate runner (D-15): MET on exit 0, else MISSED with the output tail. */
export function runCriterion(worktreePath: string, initiativeId: string, headSha: string, cmds: string[][]): { verdict: 'met' | 'missed'; evidence: string } {
  for (const cmd of cmds) {
    let info: GateRunInfo | undefined;
    makeQualityGateFromCmd(worktreePath, cmd, (i) => { info = i; }, { timeoutMs: resolveGateTimeoutMs(), initiativeId })();
    if (info?.passed !== true) {
      const tail = `${info?.stdoutTail ?? ''}${info?.stderrTail ?? ''}`.slice(-1200);
      return { verdict: 'missed', evidence: `\`${cmd.join(' ')}\` exited ${info?.exitCode} at ${headSha.slice(0, 12)} (run by the orchestrator): ${tail}` };
    }
  }
  return { verdict: 'met', evidence: `${cmds.map((c) => `\`${c.join(' ')}\``).join(', ')}: exit 0 at ${headSha.slice(0, 12)} (run by the orchestrator, not judged by a review agent)` };
}
