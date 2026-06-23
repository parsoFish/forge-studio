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
 * Scope note: the brain's *planning-context* read (PM/reflector load the brain
 * navigation index via `loadBrainIndex`, a separate module) is NOT yet routed
 * through this interface — that reroute is the next surface (see ADR-027
 * amendment). This module covers the per-KB graph / article / guidance / search
 * operations that `kb-graph.ts` provides.
 */

import { resolveKbBrainDir } from './brain-paths.ts';

import {
  buildKbGraph,
  getKbNodeArticle,
  listPendingGuidance,
  deleteGuidanceFile,
  type KbGraph,
  type KbNodeArticle,
  type PendingGuidance,
} from './kb-graph.ts';

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
