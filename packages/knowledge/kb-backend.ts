/**
 * KbBackend — the pluggable knowledge-base seam (ADR-027 §4).
 *
 * A backend is bound to one `kbId` and exposes the read/query operations the
 * bridge (and, in a later pass, the planners) need. The only implementation is
 * `FilesystemKbBackend`, which reads `brain/<kbId>/` directly. The seam is kept
 * deliberately small: it is the SAME interface a future graph-memory backend
 * (Mem0, Cognee, Letta, …) would implement over its own store, selected from
 * the `kb.yaml` descriptor — but no such backend ships today (a first attempt,
 * Zep, was removed; extra backends are revisited later).
 *
 * Scope note (SPEC.md §4 as amended by H8): this seam is the **per-knowledge-base**
 * read/write surface — graph, article, guidance, search, and the containment,
 * placement, descriptor and fresh-theme resolution the lint and health passes
 * need. Cross-brain navigation (`loadBrainIndex`, the planner's index prefix)
 * reads all three brains at once and is bound to no single kbId; it sits ABOVE
 * this seam by design and is deliberately not an operation here.
 *
 * The lint and health modules RECEIVE a backend rather than constructing one
 * (`kb-lint-summary.ts`'s optional `backend` parameter, `kb-health.ts`'s
 * `KbHealthDeps.resolveBackend`). That direction is load-bearing: it is what
 * lets this module stay free of any import from them, so the seam cannot close
 * a cycle. The backend answers "where/what is this KB"; it never performs the
 * lint.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { pathUnderDir, resolveKbBrainDir } from './brain-paths.ts';
import { isForgeBrainDir } from './brain-lint.ts';

import {
  buildKbGraph,
  getKbNodeArticle,
  listPendingGuidance,
  deleteGuidanceFile,
  type KbGraph,
  type KbNodeArticle,
  type PendingGuidance,
} from './kb-graph.ts';

/**
 * Where a KB sits in the brain layout. `'forge'` = one of the two forge
 * sub-wikis the ADR 018 category→sub-wiki routing rules govern; `'project'` =
 * a central per-project brain under `brain/projects/` (ADR 035); `'other'` =
 * any other top-level KB. A per-KB consumer asks for this instead of comparing
 * directory paths itself — which is how a caller once came to hardcode the two
 * forge sub-wikis and report `n/a` for four checks that scan a project brain
 * perfectly well.
 */
export type KbPlacement = 'forge' | 'project' | 'other';

/**
 * Index pages inside a `themes/` dir — navigation, not themes. A fresh-theme
 * count that included them would report content the reflector never wrote.
 */
const THEME_INDEX_FILES = new Set([
  'README.md',
  'patterns.md',
  'antipatterns.md',
  'operations.md',
  'decisions.md',
  'reference.md',
]);

/** A single search hit over KB nodes. `score` is backend-defined (higher = better). */
export type KbSearchHit = {
  id: string;
  title: string;
  layer: string;
  score: number;
};

/**
 * The pluggable knowledge-base contract. Every backend is bound to one kbId.
 * A future second implementation must satisfy this interface; the
 * `kb-backend.test.ts` contract test is the admission gate (mirrors the
 * RuntimeAdapter conformance suite, ADR-029).
 */
export interface KbBackend {
  /** The kb this backend is bound to. */
  readonly kbId: string;
  /** Build the node/edge graph for the UI view. */
  buildGraph(): KbGraph;
  /** Fetch a single node's article (body + inbound/outbound edges), or null. */
  getNodeArticle(nodeId: string): KbNodeArticle | null;
  /** List pending human-guidance notes awaiting ingest. */
  listPendingGuidance(): PendingGuidance[];
  /** Delete a consumed guidance note. Returns true if it was deleted. */
  deleteGuidanceFile(filePath: string): boolean;
  /**
   * Free-text search over the KB. A future graph-memory backend (Mem0/…) would
   * do this semantically; the filesystem default does cheap title substring
   * ranking (see below). The seam is what lets a planner ask the brain a
   * question without knowing which backend answers.
   */
  search(query: string, limit?: number): KbSearchHit[];

  // --- resolution + containment (H8) -------------------------------------
  // What the lint and health passes need from a KB. Each answers a question
  // ABOUT this KB; none of them performs a lint, and none hands back the
  // store's root — a caller that had the root could read around the seam,
  // which is the bypass this group exists to remove.

  /**
   * Is `file` — absolute, or relative to the forge root — part of THIS KB?
   * The scoping question behind every per-KB read AND every per-KB write, so
   * the two can never drift. A name-prefix sibling (`alpha-two` next to
   * `alpha`) must answer false: the substring form of this test was a live
   * cross-KB WRITE defect.
   */
  contains(file: string): boolean;

  /**
   * Is `file` one of this KB's OWN theme documents — in its themes dir itself,
   * not merely somewhere under the KB? A per-check consumer asks this to tell
   * whether a whole-tree scan actually opened anything of this KB's before it
   * reports a verdict; the wider `contains` answer would let a check claim it
   * inspected a KB it never read.
   */
  ownsTheme(file: string): boolean;

  /** Where this KB sits in the brain layout (ADR 018 / ADR 035). */
  placement(): KbPlacement;

  /**
   * This KB's descriptor path, or null when it has none. Resolved per call,
   * never cached: a KB can lose its `kb.yaml` while a backend is held, and a
   * stale path would be handed to the descriptor loader.
   */
  descriptorPath(): string | null;

  /** This KB's own theme documents modified at or after `sinceMs`, index pages excluded. */
  freshThemeFiles(sinceMs: number): string[];
}

/**
 * Default backend: reads `brain/<kbId>/` from disk by delegating to the existing
 * `kb-graph.ts` functions. Zero behaviour change vs calling those directly.
 */
export class FilesystemKbBackend implements KbBackend {
  readonly kbId: string;
  private readonly forgeRoot: string;

  constructor(forgeRoot: string, kbId: string) {
    this.forgeRoot = forgeRoot;
    this.kbId = kbId;
  }

  buildGraph(): KbGraph {
    return buildKbGraph(this.forgeRoot, this.kbId);
  }

  getNodeArticle(nodeId: string): KbNodeArticle | null {
    return getKbNodeArticle(this.forgeRoot, this.kbId, nodeId);
  }

  listPendingGuidance(): PendingGuidance[] {
    return listPendingGuidance(this.forgeRoot, this.kbId);
  }

  deleteGuidanceFile(filePath: string): boolean {
    return deleteGuidanceFile(this.forgeRoot, this.kbId, filePath);
  }

  /**
   * Title substring ranking over the graph's nodes. Cheap (one graph build, no
   * per-node body reads) and deterministic — the honest floor for a filesystem
   * KB. A semantic backend overrides this with embedding/graph search.
   */
  search(query: string, limit = 20): KbSearchHit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const graph = this.buildGraph();
    const hits: KbSearchHit[] = [];
    for (const node of graph.nodes) {
      if (node.title.toLowerCase().includes(q)) {
        hits.push({ id: node.id, title: node.title, layer: node.layer, score: 1 });
      }
    }
    return hits.slice(0, limit);
  }

  // --- resolution + containment (H8) -------------------------------------
  // Every one of these resolves the brain dir per call through the SAME
  // `resolveKbBrainDir` guard the rest of the package uses, and none exposes
  // it. A KB whose descriptor disappears simply stops resolving.

  /** This KB's guarded on-disk root, or null when it no longer resolves. */
  private dir(): string | null {
    return resolveKbBrainDir(this.forgeRoot, this.kbId);
  }

  contains(file: string): boolean {
    const dir = this.dir();
    return dir !== null && pathUnderDir(this.forgeRoot, dir, file);
  }

  ownsTheme(file: string): boolean {
    const dir = this.dir();
    if (dir === null || !file) return false;
    return dirname(resolve(this.forgeRoot, file)) === join(dir, 'themes');
  }

  placement(): KbPlacement {
    const dir = this.dir();
    if (dir === null) return 'other';
    if (isForgeBrainDir(this.forgeRoot, dir)) return 'forge';
    if (dirname(dir) === join(this.forgeRoot, 'brain', 'projects')) return 'project';
    return 'other';
  }

  descriptorPath(): string | null {
    const dir = this.dir();
    if (dir === null) return null;
    const p = join(dir, 'kb.yaml');
    return existsSync(p) ? p : null;
  }

  freshThemeFiles(sinceMs: number): string[] {
    const dir = this.dir();
    if (dir === null) return [];
    const themesDir = join(dir, 'themes');
    if (!existsSync(themesDir)) return [];
    const out: string[] = [];
    for (const name of readdirSync(themesDir)) {
      if (!name.endsWith('.md') || THEME_INDEX_FILES.has(name)) continue;
      const p = join(themesDir, name);
      try {
        if (statSync(p).mtimeMs >= sinceMs) out.push(p);
      } catch {
        /* unreadable entry — not fresh */
      }
    }
    return out;
  }
}

/**
 * Resolve the KbBackend for a kbId. The filesystem backend is the only
 * implementation today; the seam is preserved for a future graph-memory backend
 * routed off the `kb.yaml` `backend:` field. Throws on an unknown kbId (no
 * `brain/<kbId>/kb.yaml`) — same contract as the underlying functions.
 */
export function getKbBackend(forgeRoot: string, kbId: string): KbBackend {
  if (!resolveKbBrainDir(forgeRoot, kbId)) {
    throw new Error(
      `Unknown kbId: "${kbId}" — no brain/${kbId}/kb.yaml or brain/projects/${kbId}/kb.yaml found`,
    );
  }
  return new FilesystemKbBackend(forgeRoot, kbId);
}

/**
 * Non-throwing backend resolution. The per-KB lint and health passes are given
 * a candidate list of kbIds and must SKIP the ones that do not resolve — the
 * same answer `resolveKbBrainDir` returning null used to give them directly.
 * `getKbBackend` keeps throwing, so no existing caller's contract moved.
 */
export function tryGetKbBackend(forgeRoot: string, kbId: string): KbBackend | null {
  return resolveKbBrainDir(forgeRoot, kbId) ? new FilesystemKbBackend(forgeRoot, kbId) : null;
}

/**
 * Async backend resolution — the production entry point. Kept async (and as a
 * distinct symbol callers depend on) so a future graph-memory backend can be
 * routed here without changing call sites; today it resolves the filesystem
 * backend, behaviour-identical to getKbBackend().
 */
export async function getKbBackendAsync(
  forgeRoot: string,
  kbId: string,
  // Retained for signature stability with callers; unused while the filesystem
  // backend is the only implementation.
  _env: NodeJS.ProcessEnv = process.env,
): Promise<KbBackend> {
  return getKbBackend(forgeRoot, kbId);
}
