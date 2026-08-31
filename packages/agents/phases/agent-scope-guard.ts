/**
 * agent-scope-guard.ts — the shared mechanical write-scope guard for one-shot
 * agent pipelines (demo-agent, adversarial-review).
 *
 * ADR-036's lesson: behavioural rules an agent can read are rules it can route
 * around; only orchestrator-owned checks count. The guard snapshots worktree
 * state before the spawn and diffs after it; any NEW or CHANGED path outside
 * the pipeline's allowed set is a hard scope violation.
 *
 * Two detection layers (adversarial review 2026-07-24, findings #0/#1/#4 —
 * plain `git status --porcelain` was blind to untracked-dir collapse and to
 * gitignored `.forge/` trees, and failed OPEN on git errors):
 *
 *  1. `git status --porcelain -uall` — per-file untracked entries (no
 *     directory collapse) + tracked modifications. Still blind to gitignored
 *     paths by design.
 *  2. A recursive walk of `<worktree>/.forge/` recording `size:mtimeMs` per
 *     file — catches writes/overwrites under `.forge/` even when the whole
 *     tree is gitignored (betterado, trafficGame) and content changes to
 *     already-dirty files the porcelain path-set diff cannot see.
 *
 * Accepted residual (recorded in docs/known-gaps.md §12): overwrites of
 * pre-existing untracked files OUTSIDE `.forge/` (porcelain reports the path
 * in both snapshots; content is not hashed) and writes under other gitignored
 * trees (e.g. node_modules) — neither reaches the PR branch or forge runtime
 * config.
 *
 * Guard integrity fails LOUD: a git-status failure in either snapshot returns
 * `ok: false` and the caller must hard-fail the run — never fail open (silent
 * bypass) or closed (blaming the agent for the orchestrator's own files).
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type ScopeSnapshot =
  | { ok: true; entries: Map<string, string> }
  | { ok: false; error: string };

function walkForgeDir(worktreePath: string, entries: Map<string, string>): void {
  const walk = (rel: string): void => {
    let names: string[];
    try {
      names = readdirSync(join(worktreePath, rel));
    } catch {
      return;
    }
    for (const name of names) {
      const relPath = `${rel}/${name}`;
      try {
        const st = statSync(join(worktreePath, relPath));
        if (st.isDirectory()) walk(relPath);
        else entries.set(relPath, `${st.size}:${st.mtimeMs}`);
      } catch {
        /* raced deletion — skip */
      }
    }
  };
  walk('.forge');
}

/** Snapshot worktree dirt: porcelain -uall path→status + .forge/ file stamps. */
export function takeScopeSnapshot(worktreePath: string): ScopeSnapshot {
  let out: string;
  try {
    out = execFileSync('git', ['status', '--porcelain', '-uall'], {
      cwd: worktreePath,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 60_000,
    });
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string };
    const stderr = err.stderr
      ? typeof err.stderr === 'string'
        ? err.stderr
        : err.stderr.toString('utf8')
      : (err.message ?? 'git status failed');
    return { ok: false, error: stderr.slice(-500) };
  }
  const entries = new Map<string, string>();
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const status = line.slice(0, 2);
    let p = line.slice(3);
    const arrow = p.indexOf(' -> ');
    if (arrow !== -1) p = p.slice(arrow + 4);
    entries.set(p.replace(/^"|"$/g, ''), `git:${status}`);
  }
  walkForgeDir(worktreePath, entries);
  return { ok: true, entries };
}

/**
 * Paths that are NEW or CHANGED in `after` vs `before`, excluding those the
 * caller's `isAllowed` predicate admits. Both snapshots must be ok.
 */
export function scopeViolations(
  before: Extract<ScopeSnapshot, { ok: true }>,
  after: Extract<ScopeSnapshot, { ok: true }>,
  isAllowed: (path: string) => boolean,
): string[] {
  const violations: string[] = [];
  for (const [p, stamp] of after.entries) {
    if (before.entries.get(p) === stamp) continue; // unchanged
    if (isAllowed(p)) continue;
    violations.push(p);
  }
  return violations.sort();
}
