/**
 * demo-fanin-honesty.ts — post-fan-in truth check on demo.json metadata
 * (refinement plan 2.5; 2026-07-03 stale-demo-metadata +
 * live-evidence-id themes).
 *
 * By the time the unifier's composed gate judges the branch, the demo.json a
 * previous unifier pass authored can describe PRE-fan-in state:
 *
 *  - `diffStat` — mechanical git metadata. Fan-in merges bump it (84 files at
 *    UWI-1 → 172 at UWI-5); a whole agent iteration was burned re-deriving it
 *    by hand. The orchestrator REFRESHES it in place: re-run
 *    `git diff --stat <base>...HEAD`, strip scratch files, rewrite the field
 *    and the derived DEMO.md. Mechanical truth produced by the orchestrator —
 *    the same ownership rule as orchestrated capture (ADR 036). Compared by
 *    files-changed COUNT: insertion counts include demo.json's own content,
 *    so comparing them can never reach a fixed point across refresh commits.
 *
 *  - checkpoint `liveEvidence` ids + the demo's `initiativeId` — IDENTITY
 *    claims. A demo embedding subscription 886543 while the branch's
 *    `.forge/live-evidence/` holds 886548 asserts evidence that does not
 *    match branch state (the send-back case). These are NOT silently fixed:
 *    they fail the demo gate honestly, with the stale and fresh ids named,
 *    so the agent re-renders against branch tip (or the operator sees exactly
 *    what went stale). Refreshing evidence claims for the agent would blur
 *    the line ADR 036 draws — the agent must re-derive its claims from the
 *    orchestrator-produced evidence, not have them laundered at gate time.
 *
 * Parse/schema failures are deliberately OUT of scope — the pr_self_contained
 * gate owns those; this check runs after it, only on a parseable demo.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  collectLiveEvidence,
  renderDemoMarkdown,
  stripScratchFromDiffStat,
  validateDemoModel,
  type DemoModel,
} from '../../cli/demo-model.ts';
import { DEMO_MD_BASENAME } from '../demo-paths.ts';

export type StaleEvidenceRef = { label: string; url: string };

export type DemoFanInResult = {
  /** True when no HONESTY failure was found (a diffStat refresh alone is ok). */
  ok: boolean;
  /** Specific, human-readable staleness reasons. Empty when ok. */
  failures: string[];
  /** demo.json liveEvidence urls that no current `.forge/live-evidence/` file backs. */
  staleEvidence: StaleEvidenceRef[];
  /** The urls the branch's live-evidence files hold right now (the fresh truth). */
  freshEvidenceUrls: string[];
  /** Set when the stored diffStat disagreed with git truth and was rewritten in place. */
  refreshedDiffStat?: { from: string; to: string };
};

/** `N file(s) changed` summary count, or null when the text has no git summary line. */
function filesChangedCount(diffStat: string): number | null {
  const m = /(\d+)\s+files?\s+changed/.exec(diffStat);
  return m ? Number(m[1]) : null;
}

/** The summary line of a diff --stat (its last line), bounded for event text. */
function diffStatSummary(diffStat: string): string {
  const lines = diffStat.trim().split('\n');
  return (lines[lines.length - 1] ?? '').trim().slice(0, 200);
}

/**
 * Re-derive `git diff --stat <base>...HEAD` for the worktree (base = main,
 * else master), scratch-stripped. Null when it cannot be computed (no base
 * branch / git unavailable) — an INDETERMINATE diff must never fail the check.
 */
function deriveFreshDiffStat(worktreePath: string): string | null {
  try {
    const git = (args: string[]): string =>
      execFileSync('git', args, { cwd: worktreePath, stdio: 'pipe', encoding: 'utf8' });
    let base = '';
    try {
      if (git(['rev-parse', '--verify', 'main']).trim().length > 0) base = 'main';
    } catch {
      /* fall through to master */
    }
    if (!base) {
      if (git(['rev-parse', '--verify', 'master']).trim().length > 0) base = 'master';
    }
    if (!base) return null;
    return stripScratchFromDiffStat(git(['diff', '--stat', `${base}...HEAD`]).trim());
  } catch {
    return null;
  }
}

/**
 * Validate (and where mechanical, refresh) a parseable demo.json against
 * post-fan-in branch reality. Never throws; a missing/unparseable demo.json
 * returns ok (the schema gate owns that failure mode).
 */
export function checkDemoFanInHonesty(args: {
  worktreePath: string;
  demoJsonPath: string;
  initiativeId: string;
}): DemoFanInResult {
  const result: DemoFanInResult = { ok: true, failures: [], staleEvidence: [], freshEvidenceUrls: [] };

  if (!existsSync(args.demoJsonPath)) return result;
  let model: DemoModel;
  try {
    model = JSON.parse(readFileSync(args.demoJsonPath, 'utf8')) as DemoModel;
  } catch {
    return result;
  }
  if (!model || typeof model !== 'object') return result;

  // ── 1. Initiative reference — a demo describing a different initiative is a
  //       stale WI reference, not a rendering slip.
  if (typeof model.initiativeId === 'string' && model.initiativeId.trim() !== '' && model.initiativeId !== args.initiativeId) {
    result.failures.push(
      `demo.json initiativeId "${model.initiativeId}" does not match this cycle's initiative "${args.initiativeId}" — the demo describes different work`,
    );
  }

  // ── 2. diffStat — mechanical git truth, refreshed in place when the
  //       files-changed count diverged (or the stored value has no summary).
  const fresh = deriveFreshDiffStat(args.worktreePath);
  if (fresh !== null && filesChangedCount(fresh) !== null) {
    const stored = typeof model.diffStat === 'string' ? model.diffStat : '';
    const storedCount = filesChangedCount(stored);
    if (storedCount === null || storedCount !== filesChangedCount(fresh)) {
      const from = storedCount === null ? stored.trim().slice(0, 200) : diffStatSummary(stored);
      model = { ...model, diffStat: fresh };
      try {
        writeFileSync(args.demoJsonPath, `${JSON.stringify(model, null, 2)}\n`);
        // Keep the derived artifact consistent with its source when the model
        // is renderable; a schema-invalid model is the pr_self_contained
        // gate's report, not ours.
        if (validateDemoModel(model).length === 0) {
          writeFileSync(join(dirname(args.demoJsonPath), DEMO_MD_BASENAME), renderDemoMarkdown(model));
        }
        result.refreshedDiffStat = { from, to: diffStatSummary(fresh) };
      } catch {
        /* best-effort refresh — an unwritable demo dir surfaces via the gate's own checks */
      }
    }
  }

  // ── 3. liveEvidence identity — every url the demo embeds must be backed by
  //       a CURRENT `.forge/live-evidence/` file (the orchestrator-run
  //       acceptance gate rewrites those each run), and every persisted
  //       evidence file must surface in the demo. `forge demo render` merges
  //       them; a demo missing them was rendered before the current run.
  const freshEvidence = collectLiveEvidence(args.worktreePath);
  if (freshEvidence.length > 0) {
    const freshUrls = new Set(freshEvidence.map((e) => e.url));
    result.freshEvidenceUrls = [...freshUrls];
    const checkpoints = Array.isArray(model.checkpoints) ? model.checkpoints : [];
    const embeddedUrls = new Set<string>();
    for (const cp of checkpoints) {
      const url = cp?.liveEvidence?.url;
      if (typeof url !== 'string' || url.trim() === '') continue;
      embeddedUrls.add(url);
      if (!freshUrls.has(url)) {
        result.staleEvidence.push({ label: typeof cp.label === 'string' ? cp.label : '(unlabelled)', url });
        result.failures.push(
          `checkpoint "${cp.label}" embeds live evidence ${url}, but the branch's .forge/live-evidence/ holds ${[...freshUrls].join(', ')} — the demo asserts a resource from an earlier acceptance run`,
        );
      }
    }
    for (const ev of freshEvidence) {
      if (!embeddedUrls.has(ev.url)) {
        result.failures.push(
          `live evidence "${ev.label ?? ev.url}" (${ev.url}) is persisted on the branch but not represented in demo.json — the demo pre-dates the current acceptance run; re-run \`forge demo render ${args.initiativeId}\` against branch tip`,
        );
      }
    }
  }

  result.ok = result.failures.length === 0;
  return result;
}
