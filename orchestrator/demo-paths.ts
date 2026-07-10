/**
 * demo-paths.ts — the ONE source of truth for where the tracked demo bundle
 * lives (refinement plan 2.5 / N3).
 *
 * The unifier authors `demo.json` (+ the derived `DEMO.md`) at the project's
 * artifactRoot-resolved demo dir; every other actor — the composed unifier
 * gate, the orchestrated capture commit, the PR-open prerequisite, the flow
 * artifact guard, the cycle snapshot, `forge demo render/capture`, the UWI
 * scope/prose strings — must resolve the SAME path through this module.
 * Computing it in more than one place is exactly how the 2026-07-05 false
 * negative happened: the unifier wrote `forge/history/<id>/demo/demo.json`
 * (artifactRoot-resolved) while a consumer looked at `demo/<id>/demo.json`,
 * so pr-open failed "missing" seconds after a clean packaging commit.
 *
 * The rel-dir rule:
 *   artifactRoot "." (legacy/default) → `demo/<initiativeId>`
 *   artifactRoot "<root>"            → `<root>/history/<initiativeId>/demo`
 *
 * `artifactRoot` is read from the WORKTREE's own `.forge/project.json`
 * (`readArtifactRoot`, brain-paths.ts) — the branch being judged is the truth,
 * not the main checkout. The composed unifier gate previously read it from the
 * project repo path while every other site read the worktree; the composed
 * helpers below close that divergence by taking the worktree path directly.
 */

import { join, resolve } from 'node:path';

import { readArtifactRoot } from './brain-paths.ts';

/** Canonical basename of the structured demo the unifier authors (ADR 021). */
export const DEMO_JSON_BASENAME = 'demo.json';

/** Canonical basename of the derived PR-facing markdown (F4: the single demo output). */
export const DEMO_MD_BASENAME = 'DEMO.md';

/**
 * The WORKTREE-relative tracked-demo dir for an initiative — the in-PR demo
 * the unifier authors (committed on the branch), not the post-merge archive.
 * The path-escape guard `readArtifactRoot` applies means the segment is
 * always clean.
 */
export function projectDemoRelDir(initiativeId: string, artifactRoot = '.'): string {
  const root = artifactRoot.trim();
  if (root === '' || root === '.') return `demo/${initiativeId}`;
  return `${root}/history/${initiativeId}/demo`;
}

/** Rel demo dir with artifactRoot resolved from the worktree's `.forge/project.json`. */
export function worktreeDemoRelDir(worktreePath: string, initiativeId: string): string {
  return projectDemoRelDir(initiativeId, readArtifactRoot(worktreePath));
}

/** Absolute demo dir under the worktree. */
export function worktreeDemoDir(worktreePath: string, initiativeId: string): string {
  return resolve(worktreePath, worktreeDemoRelDir(worktreePath, initiativeId));
}

/** Absolute path of the structured `demo.json` under the worktree. */
export function worktreeDemoJsonPath(worktreePath: string, initiativeId: string): string {
  return join(worktreeDemoDir(worktreePath, initiativeId), DEMO_JSON_BASENAME);
}

/** Rel path of `demo.json` — for prompts, WI scope ceilings, and event text. */
export function worktreeDemoJsonRelPath(worktreePath: string, initiativeId: string): string {
  return `${worktreeDemoRelDir(worktreePath, initiativeId)}/${DEMO_JSON_BASENAME}`;
}

/** Absolute path of the derived `DEMO.md` under the worktree. */
export function worktreeDemoMdPath(worktreePath: string, initiativeId: string): string {
  return join(worktreeDemoDir(worktreePath, initiativeId), DEMO_MD_BASENAME);
}
