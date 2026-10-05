/**
 * Where a demo session's files live on disk, and how a generation is snapshotted.
 *
 * Split out of `demo-builder.ts` by the M4 row-37 affordance carve: that file
 * took the kind's two generic-affordance arms and would have crossed the
 * 800-line cap. This is the seam nothing else crosses — the kind directory, the
 * per-generation snapshot layout (R4-16) and the three guarded readers/writers
 * that walk it. `bridge-studio-demo.ts` and `packages/sessions/studio/session-transcript.ts`
 * already imported the layout constants; they now name this module instead.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { guardedFile, guardedReadDir, sessionDirSegments, type SessionHome } from '@forge/kernel';
import type { ModelTier } from '@forge/agents';

/** R4-16 — session-dir-relative home for per-generation snapshots
 *  (`<sessionDir>/generations/<n>/`), NEVER the project repo (D4: the
 *  derivation may not read outside sessionDir, and project-repo history would
 *  commit intermediate generations onto the project's forge-studio branch). */
export const GENERATIONS_DIRNAME = 'generations';
/** The two files a generation snapshots — exactly the pair `runGenerateStep`
 *  verifies (D5): the reviewable sample and the proposed demo declaration
 *  (bead forge-mfv5.2.8) — plus the metadata file recording what drove it. */
export const GENERATION_DEMO_FILENAME = 'DEMO.html';
export const GENERATION_DECLARATION_FILENAME = 'demo-process.json';
export const GENERATION_META_FILENAME = 'meta.json';

/** The kind-dir under `<logsRoot>/_sessions/<project>/` that holds demo-builder sessions. */
export const DEMO_KIND_DIR = '_demo';


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The generation numbers that DO have a `generations/<n>/` dir on disk —
 *  used only to name what's available in the R4-16 fail-closed lock error.
 *  Best-effort: a missing/unreadable `generations/` dir yields []. */
export function listExistingGenerationNumbers(home: SessionHome, sessionId: string): number[] {
  // SEC-04 leaf: the generations/ dir readdir routed through the guard.
  const names = guardedReadDir(home.logsRoot, [...sessionDirSegments(home.project, DEMO_KIND_DIR, sessionId), GENERATIONS_DIRNAME]);
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
export function guardedGenerationWritePath(logsRoot: string, segs: readonly string[], what: string): string {
  const p = guardedFile(logsRoot, segs, 'write');
  if (p === null) {
    throw new Error(`demo-builder runner: ${what} write failed containment (symlinked/escaping leaf) — refusing to write.`);
  }
  mkdirSync(dirname(p), { recursive: true });
  return p;
}


// ---------------------------------------------------------------------------
// Paths (project-repo-relative) and the session-dir state contract — facts
// about where a demo session's bytes live, which both step modules stand on.
// ---------------------------------------------------------------------------
export const DEMO_REL_DIR = '.forge/demo';
/** Where the generate turn's write pass authors its proposed demo declaration
 *  — the `demoProcess` steps, as a JSON array (bead forge-mfv5.2.8). A draft
 *  only: the step moves it into the generation snapshot and removes it from
 *  the repo, so `.forge/project.json` stays the one declared source and a lock
 *  is the only thing that writes it there. */
export const DEMO_DECLARATION_REL_PATH = '.forge/demo/demo-process.json';
/** The reviewable sample the ground pass renders by running the declaration. */
export const DEMO_HTML_REL_PATH = '.forge/demo/DEMO.html';
export const DEMO_LOCK_REL_PATH = '.forge/demo/demo.lock.json';
/** Where each locked demo is snapshotted so previous demos stay viewable. */
export const DEMO_HISTORY_REL_DIR = '.forge/demo/history';
/** Forge-root-relative path to the base stylesheet the agent inlines. */
export const FORGE_DEMO_CSS_REL_PATH = 'studio/demo/forge-demo.css';

export type DemoBuilderPhase =
  | 'briefing'
  | 'generating'
  | 'awaiting-review'
  | 'locking'
  | 'locked'
  | 'abandoned';

export type DemoBuilderStatus = {
  session_id: string;
  project: string;
  /** Absolute path to the project's git repo (where .forge/demo/ is written). */
  project_repo_path: string;
  phase: DemoBuilderPhase;
  /**
   * `create` — no locked demo yet, build one. `update` — a declaration is
   * already locked; the operator's brief is change-notes and the agent revises
   * the declared steps rather than rebuilding them. Absent ⇒ `create`.
   */
  mode?: 'create' | 'update';
  /**
   * When set, the agent revises ONLY the declared steps bound to this
   * demo-element kind (a "smaller chunk") and carries every other step over
   * unchanged, so the operator can perfect one element's steps before the
   * whole declaration. Absent ⇒ the whole declaration.
   */
  targetElement?: string;
  /** 1-based generate-turn counter. */
  iteration: number;
  /** The operator's look-and-feel guidance / change-notes (persisted to `prompt.md`). */
  prompt: string;
  updated_at: string;
  /**
   * R4-16 — the generation number the operator chose to lock, DECLARED here
   * and ENFORCED by `runLockStep` (D6): naming a generation with no
   * readable snapshot fails the lock loudly (declared-data-fails-open is the
   * antipattern this guards against — it must never silently lock the
   * latest). Absent ⇒ lock the newest generation on disk; either way
   * `demo.lock.json.generation` records the generation actually locked.
   */
  selectedGeneration?: number;
  /**
   * ADR-043 §3 amendment (2026-08-15, wave-6 kickoff model-tier seam): an
   * operator-chosen model tier, validated by the bridge's `/api/demo-builder/
   * start` route against `demoBuilderAgentSpec` (now `strategy:range` — see
   * the SKILL.md runtime block) before it is ever persisted here. Absent ⇒
   * unchanged default behavior (`DEMO_BUILDER_MODEL`).
   */
  modelTier?: ModelTier;
  /**
   * W7-C2 (sessions-kinds-36) — the permanent pointer at what this session
   * produced, written once at lock success and read back by the
   * session-shell route on every GET (`finalized` on the wire). `demo` names
   * the project whose `demoProcess` and `.forge/demo/demo.lock.json` were
   * written. Absent until
   * the session locks.
   */
  finalized?: { kind: string; id: string };
};

export type RunDemoBuilderTurnResult = {
  phase: DemoBuilderPhase;
  wrote: string[];
  /** Present after a generate turn — absolute path to the produced DEMO.html. */
  demoPath?: string;
  /** Present after lock — absolute path to demo.lock.json. */
  lockPath?: string;
};
