/**
 * KbBackend — the pluggable knowledge-base seam (ADR-027 §4, ADR-031 subsumption).
 *
 * A backend is bound to one `kbId` and exposes the read/query operations the
 * bridge (and, in a later pass, the planners) need. Today the only
 * implementation is `FilesystemKbBackend`, which reads `brain/<kbId>/` directly
 * (the historical behaviour). The point of the seam is that a graph-memory
 * backend — Zep (M8-C), Mem0, Cognee, Letta — can implement the SAME interface
 * over its own store, and `getKbBackend()` selects it from the `kb.yaml`
 * descriptor. This is the "subsume the best memory layer" flywheel made
 * concrete: the brain's backend becomes swappable, not hardcoded to the
 * filesystem.
 *
 * Scope note: the brain's *planning-context* read (PM/reflector load the brain
 * navigation index via `loadBrainIndex`, a separate module) is NOT yet routed
 * through this interface — that reroute is the next surface (see ADR-027
 * amendment). This module covers the per-KB graph / article / guidance / search
 * operations that `kb-graph.ts` provides.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  buildKbGraph,
  getKbNodeArticle,
  listPendingGuidance,
  deleteGuidanceFile,
  type KbGraph,
  type KbNodeArticle,
  type PendingGuidance,
} from './kb-graph.ts';
import { loadKbDescriptor } from './studio/registry.ts';

/** A single search hit over KB nodes. `score` is backend-defined (higher = better). */
export type KbSearchHit = {
  id: string;
  title: string;
  layer: string;
  score: number;
};

/**
 * The pluggable knowledge-base contract. Every backend is bound to one kbId.
 * A second implementation (e.g. ZepKbBackend) must satisfy this interface; the
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
   * Free-text search over the KB. A graph-memory backend (Zep/Mem0) does this
   * semantically — its native strength; the filesystem default does cheap title
   * substring ranking (see below). The seam is what lets a planner ask the brain
   * a question without knowing which backend answers.
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
 * Resolve the KbBackend for a kbId by reading its `kb.yaml` descriptor.
 *
 * Backend-selection seam: a future `backend:` field on the descriptor routes to
 * a registered non-filesystem backend here (M8-C registers ZepKbBackend keyed on
 * it). Today every kb resolves to the filesystem backend. Throws on an unknown
 * kbId (no `brain/<kbId>/kb.yaml`) — same contract as the underlying functions.
 */
export function getKbBackend(forgeRoot: string, kbId: string): KbBackend {
  const kbYamlPath = join(resolve(forgeRoot, 'brain', kbId), 'kb.yaml');
  if (!existsSync(kbYamlPath)) {
    throw new Error(`Unknown kbId: "${kbId}" — no brain/${kbId}/kb.yaml found`);
  }
  // Round-trips the descriptor (validates it parses) and is the hook point where
  // a `backend:` field would select a non-FS implementation (M8-C).
  loadKbDescriptor(kbYamlPath);
  return new FilesystemKbBackend(forgeRoot, kbId);
}
