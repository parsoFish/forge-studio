/**
 * ZepKbBackend — a real graph/temporal-memory backend for the KbBackend seam
 * (ADR-027 §4, ADR-031 subsumption; M8-C "KB seam proof").
 *
 * This is the second concrete KbBackend after FilesystemKbBackend. It proves the
 * flywheel thesis: the brain's backend is swappable, and the best-in-class memory
 * layer (here Zep, a temporal knowledge-graph service) plugs into the SAME
 * interface the filesystem default satisfies.
 *
 * ── What comes from Zep vs the filesystem ───────────────────────────────────
 *   search(query)     → Zep `graph.search` (its native strength: semantic +
 *                       temporal graph retrieval over edges/nodes).
 *   buildGraph()      → Zep graph nodes/edges → KbGraph (the UI view).
 *   getNodeArticle()  → a Zep node + the edges incident on it → KbNodeArticle.
 *
 *   listPendingGuidance() / deleteGuidanceFile()
 *                     → DELEGATED to a composed FilesystemKbBackend. Zep has no
 *                       `_guidance` concept — guidance notes are human-authored
 *                       files awaiting an ingest pass, which is a filesystem
 *                       concern by design. Ingestion (writing facts INTO Zep)
 *                       and guidance stay file-based; only search/graph reads
 *                       come from Zep.
 *
 * ── Sync interface over an async store ──────────────────────────────────────
 * The KbBackend contract is synchronous (buildGraph/getNodeArticle/search return
 * values, not promises) but the Zep SDK is async. We bridge this honestly with a
 * primed snapshot: callers (the bridge) invoke `await prime()` once at resolve
 * time to pull the graph from Zep; the synchronous interface methods then read
 * that in-memory snapshot. `prime()` is the seam's async escape hatch — it is
 * NOT part of the KbBackend interface, so the backend stays a drop-in. Before
 * priming, the graph methods return an empty graph and search returns []; this
 * is the documented cold state, not an error.
 *
 * `search()` additionally serves live results out of a per-query cache that
 * `primeSearch(query)` (async) populates — a planner that wants a live semantic
 * answer awaits primeSearch first, then reads search() synchronously. This keeps
 * the hot interface sync while giving Zep's real semantic search a path through.
 *
 * ── Dep + creds gating ──────────────────────────────────────────────────────
 * `@getzep/zep-cloud` is NOT a forge dependency and there are NO creds in CI.
 * `isZepAvailable()` resolves true ONLY when both the dep imports AND the
 * required env var (`ZEP_API_KEY`) is set. The SDK is imported through a STRING
 * variable so tsc never tries to resolve the absent module. The Zep boundary is
 * typed with the minimal local interfaces below, not `any` sprawl.
 *
 * ── Construction seam (for testing without live creds) ──────────────────────
 * The constructor accepts an optional pre-built `ZepGraphClient`. The contract
 * test injects a fake in-memory client; production resolves the real client via
 * `createZepGraphClient()` (dynamic import + apiKey from env).
 *
 * Sources (researched, not hallucinated):
 *   - Client construction: https://www.npmjs.com/package/@getzep/zep-cloud
 *       `import { ZepClient } from "@getzep/zep-cloud";
 *        new ZepClient({ apiKey })`
 *   - graph.search request/results shape:
 *       https://help.getzep.com/sdk-reference/graph/search
 *       (request: { query, graphId?, userId?, scope?, limit?, reranker? };
 *        results: { edges?: EntityEdge[], nodes?: EntityNode[], episodes? })
 *   - graph.node.get / node.getByGraphId / edge.getByGraphId signatures + the
 *     EntityNode {uuid,name,summary,labels,createdAt} and
 *     EntityEdge {uuid,name,fact,sourceNodeUuid,targetNodeUuid,createdAt} shapes:
 *       https://github.com/getzep/zep-js (reference.md)
 */

import { FilesystemKbBackend } from '../kb-backend.ts';
import type { KbBackend, KbSearchHit } from '../kb-backend.ts';
import type { KbGraph, KbNode, KbEdge, KbNodeArticle, PendingGuidance } from '../kb-graph.ts';

// ---------------------------------------------------------------------------
// Minimal local typing of the Zep boundary (NOT `any`).
// Mirrors @getzep/zep-cloud's EntityNode / EntityEdge / GraphSearchResults as
// documented in the SDK reference (see header). We type only the fields we read.
// ---------------------------------------------------------------------------

/** Env var that must be set for the Zep backend to be usable. */
export const ZEP_API_KEY_ENV = 'ZEP_API_KEY';
/** npm package the backend dynamically imports (string-variable import seam). */
export const ZEP_PACKAGE = '@getzep/zep-cloud';

/** A Zep graph node (EntityNode subset we consume). */
export interface ZepEntityNode {
  uuid: string;
  name?: string;
  summary?: string;
  labels?: string[];
  createdAt?: string;
}

/** A Zep graph edge (EntityEdge subset we consume). */
export interface ZepEntityEdge {
  uuid: string;
  name?: string;
  fact?: string;
  sourceNodeUuid?: string;
  targetNodeUuid?: string;
  createdAt?: string;
  score?: number;
}

/** The subset of graph.search results we consume. */
export interface ZepGraphSearchResults {
  edges?: ZepEntityEdge[];
  nodes?: ZepEntityNode[];
}

/** graph.search request (the documented fields we set). */
export interface ZepGraphSearchQuery {
  query: string;
  graphId?: string;
  userId?: string;
  scope?: 'edges' | 'nodes' | 'episodes';
  limit?: number;
  reranker?: string;
}

/**
 * The narrow Zep surface this backend depends on. The real `ZepClient.graph`
 * satisfies this; the contract test supplies a fake. Defining our own minimal
 * interface (rather than importing Zep's types) keeps tsc green with the dep
 * absent and documents exactly which Zep calls we make.
 */
export interface ZepGraphClient {
  search(req: ZepGraphSearchQuery): Promise<ZepGraphSearchResults>;
  node: {
    get(uuid: string): Promise<ZepEntityNode>;
    getByGraphId(graphId: string, req?: Record<string, unknown>): Promise<ZepEntityNode[]>;
  };
  edge: {
    getByGraphId(graphId: string, req?: Record<string, unknown>): Promise<ZepEntityEdge[]>;
  };
}

/** Options for constructing a ZepKbBackend. */
export interface ZepKbBackendOptions {
  /** The kbId this backend is bound to (e.g. "cycles"). */
  kbId: string;
  /**
   * The Zep graph this kb's memory lives under. Maps a forge kbId → a Zep
   * graphId. Defaults to the kbId itself.
   */
  zepGraphId?: string;
  /** Forge repo root — used by the composed FS backend for guidance ops. */
  forgeRoot: string;
  /**
   * The Zep graph client. Production passes the real `client.graph`; tests
   * inject a fake. When omitted, the backend is in the "not primed, no client"
   * cold state and graph/search return empty until a client is supplied via a
   * later construction (production resolves it through `createZepGraphClient`).
   */
  client?: ZepGraphClient;
}

// ---------------------------------------------------------------------------
// Mapping helpers: Zep shapes → forge KB shapes
// ---------------------------------------------------------------------------

/** A Zep node maps to a KbNode in the 'theme' layer (a fact-cluster entity). */
function nodeToKbNode(n: ZepEntityNode): KbNode {
  return {
    id: n.uuid,
    title: n.name && n.name.length > 0 ? n.name : n.uuid,
    layer: 'theme',
    updatedAt: n.createdAt,
  };
}

/** A Zep edge maps to a KbEdge (source → target). Drops dangling endpoints. */
function edgeToKbEdge(e: ZepEntityEdge): KbEdge | null {
  if (!e.sourceNodeUuid || !e.targetNodeUuid) return null;
  return { from: e.sourceNodeUuid, to: e.targetNodeUuid };
}

// ---------------------------------------------------------------------------
// Dep + creds gating + real client construction
// ---------------------------------------------------------------------------

/**
 * Resolve the env API key. Centralised so the gate and the constructor agree.
 * Returns undefined when unset/empty (fail-fast at the boundary).
 */
function readApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const v = env[ZEP_API_KEY_ENV];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Whether the Zep backend is usable: the dep imports AND the API key is set.
 * Dep is imported through a STRING VARIABLE so tsc does not try to resolve the
 * (absent) module. Returns false on any failure — never throws.
 */
export async function isZepAvailable(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!readApiKey(env)) return false;
  try {
    const pkg = ZEP_PACKAGE;
    const mod = (await import(pkg)) as unknown;
    return mod != null && typeof mod === 'object' && 'ZepClient' in (mod as Record<string, unknown>);
  } catch {
    return false;
  }
}

/** Minimal shape of the dynamically-imported module (just the ctor we use). */
interface ZepModule {
  ZepClient: new (opts: { apiKey: string }) => { graph: ZepGraphClient };
}

/**
 * Build the real Zep graph client from env creds. Throws (fail-fast) if the dep
 * is absent or the key is unset — callers should gate on `isZepAvailable` first.
 * The dynamic import goes through a string variable so tsc/CI never resolve the
 * module. NOT exercised in CI (no dep, no creds) — see the liveGap note.
 */
export async function createZepGraphClient(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ZepGraphClient> {
  const apiKey = readApiKey(env);
  if (!apiKey) {
    throw new Error(`ZepKbBackend: ${ZEP_API_KEY_ENV} is not set`);
  }
  const pkg = ZEP_PACKAGE;
  const mod = (await import(pkg)) as ZepModule;
  if (typeof mod?.ZepClient !== 'function') {
    throw new Error(`ZepKbBackend: ${ZEP_PACKAGE} did not export ZepClient`);
  }
  const client = new mod.ZepClient({ apiKey });
  return client.graph;
}

// ---------------------------------------------------------------------------
// ZepKbBackend
// ---------------------------------------------------------------------------

const SEARCH_DEFAULT_LIMIT = 20;

export class ZepKbBackend implements KbBackend {
  readonly kbId: string;
  // Explicit field declarations (no TS parameter properties — node strip-types).
  private readonly zepGraphId: string;
  private readonly client: ZepGraphClient | null;
  /** Composed FS backend handles guidance (Zep has no _guidance concept). */
  private readonly fsBackend: FilesystemKbBackend;
  /** Primed snapshot of the Zep graph (cold until prime()). */
  private graphSnapshot: KbGraph;
  /** Node uuid → Zep node, for getNodeArticle without a re-fetch. */
  private readonly nodeIndex: Map<string, ZepEntityNode>;
  /** Edges keyed for inbound/outbound resolution in getNodeArticle. */
  private edgeSnapshot: ZepEntityEdge[];
  /** Per-query primed search results (lower-cased query → hits). */
  private readonly searchCache: Map<string, KbSearchHit[]>;

  constructor(opts: ZepKbBackendOptions) {
    if (!opts.kbId || opts.kbId.length === 0) {
      throw new Error('ZepKbBackend: kbId is required');
    }
    if (!opts.forgeRoot || opts.forgeRoot.length === 0) {
      throw new Error('ZepKbBackend: forgeRoot is required');
    }
    this.kbId = opts.kbId;
    this.zepGraphId = opts.zepGraphId ?? opts.kbId;
    this.client = opts.client ?? null;
    this.fsBackend = new FilesystemKbBackend(opts.forgeRoot, opts.kbId);
    this.graphSnapshot = { nodes: [], edges: [] };
    this.nodeIndex = new Map();
    this.edgeSnapshot = [];
    this.searchCache = new Map();
  }

  // ── async escape hatches (NOT part of the KbBackend interface) ────────────

  /**
   * Pull the graph from Zep and cache it for the synchronous interface methods.
   * Idempotent; safe to call again to refresh. No-op (leaves the empty cold
   * snapshot) when no client is configured.
   */
  async prime(): Promise<void> {
    if (!this.client) return;
    const [zepNodes, zepEdges] = await Promise.all([
      this.client.node.getByGraphId(this.zepGraphId),
      this.client.edge.getByGraphId(this.zepGraphId),
    ]);

    const nodes: KbNode[] = [];
    this.nodeIndex.clear();
    const known = new Set<string>();
    for (const n of zepNodes) {
      if (known.has(n.uuid)) continue;
      known.add(n.uuid);
      nodes.push(nodeToKbNode(n));
      this.nodeIndex.set(n.uuid, n);
    }

    this.edgeSnapshot = zepEdges.slice();
    const edges: KbEdge[] = [];
    for (const e of zepEdges) {
      const mapped = edgeToKbEdge(e);
      // Keep only edges whose endpoints are present in the node set.
      if (mapped && known.has(mapped.from) && known.has(mapped.to)) {
        edges.push(mapped);
      }
    }

    this.graphSnapshot = { nodes, edges };
  }

  /**
   * Run a live Zep semantic search and cache the hits so the synchronous
   * `search(query)` can return them. Returns the hits too, for async callers.
   * No-op returning [] when no client is configured.
   */
  async primeSearch(query: string, limit = SEARCH_DEFAULT_LIMIT): Promise<KbSearchHit[]> {
    const q = query.trim();
    if (!q || !this.client) return [];
    const results = await this.client.search({
      query: q,
      graphId: this.zepGraphId,
      scope: 'edges',
      limit,
    });
    const hits = this.resultsToHits(results, limit);
    this.searchCache.set(q.toLowerCase(), hits);
    return hits;
  }

  /**
   * Map Zep search results → KbSearchHit[]. Edges (facts) are Zep's primary
   * search unit; we project each fact-edge onto its source node so a hit is a
   * navigable graph node. Falls back to returned nodes when no edges came back.
   */
  private resultsToHits(results: ZepGraphSearchResults, limit: number): KbSearchHit[] {
    const hits: KbSearchHit[] = [];
    const seen = new Set<string>();
    for (const e of results.edges ?? []) {
      const targetUuid = e.sourceNodeUuid ?? e.targetNodeUuid;
      if (!targetUuid || seen.has(targetUuid)) continue;
      seen.add(targetUuid);
      const node = this.nodeIndex.get(targetUuid);
      hits.push({
        id: targetUuid,
        title: e.fact && e.fact.length > 0 ? e.fact : (node?.name ?? e.name ?? targetUuid),
        layer: 'theme',
        score: typeof e.score === 'number' ? e.score : 1,
      });
    }
    for (const n of results.nodes ?? []) {
      if (seen.has(n.uuid)) continue;
      seen.add(n.uuid);
      hits.push({
        id: n.uuid,
        title: n.name && n.name.length > 0 ? n.name : n.uuid,
        layer: 'theme',
        score: 1,
      });
    }
    return hits.slice(0, limit);
  }

  // ── KbBackend interface (synchronous; reads the primed snapshot) ──────────

  /** The primed Zep graph as a KbGraph. Empty until prime() (documented cold). */
  buildGraph(): KbGraph {
    // Return a defensive copy so callers cannot mutate the cached snapshot.
    return {
      nodes: this.graphSnapshot.nodes.map((n) => ({ ...n })),
      edges: this.graphSnapshot.edges.map((e) => ({ ...e })),
    };
  }

  /**
   * Resolve a node + its incident edges from the primed snapshot. Returns null
   * when the node is not in the snapshot (unknown id or not yet primed).
   */
  getNodeArticle(nodeId: string): KbNodeArticle | null {
    const node = this.nodeIndex.get(nodeId);
    if (!node) return null;

    const titleOf = (uuid: string): string => {
      const n = this.nodeIndex.get(uuid);
      return n?.name && n.name.length > 0 ? n.name : uuid;
    };

    const inbound: { id: string; title: string }[] = [];
    const outbound: { id: string; title: string }[] = [];
    for (const e of this.edgeSnapshot) {
      if (e.targetNodeUuid === nodeId && e.sourceNodeUuid) {
        inbound.push({ id: e.sourceNodeUuid, title: titleOf(e.sourceNodeUuid) });
      }
      if (e.sourceNodeUuid === nodeId && e.targetNodeUuid) {
        outbound.push({ id: e.targetNodeUuid, title: titleOf(e.targetNodeUuid) });
      }
    }

    return {
      id: node.uuid,
      title: node.name && node.name.length > 0 ? node.name : node.uuid,
      layer: 'theme',
      body: node.summary ?? '',
      inbound,
      outbound,
      touchedBy: node.createdAt,
    };
  }

  /** Guidance is a filesystem concern — delegate verbatim to the FS backend. */
  listPendingGuidance(): PendingGuidance[] {
    return this.fsBackend.listPendingGuidance();
  }

  /** Guidance is a filesystem concern — delegate verbatim to the FS backend. */
  deleteGuidanceFile(filePath: string): boolean {
    return this.fsBackend.deleteGuidanceFile(filePath);
  }

  /**
   * Synchronous search over Zep results primed via `primeSearch`. A blank query
   * returns []. With no primed result for the query, returns [] (the caller
   * should `await primeSearch(query)` first for a live semantic answer) — this
   * keeps the hot interface sync while routing through Zep's real strength.
   */
  search(query: string, limit = SEARCH_DEFAULT_LIMIT): KbSearchHit[] {
    const q = query.trim();
    if (!q) return [];
    const cached = this.searchCache.get(q.toLowerCase());
    if (!cached) return [];
    return cached.slice(0, limit);
  }
}

/**
 * Factory: build a production ZepKbBackend with the real client from env creds.
 * Gates on `isZepAvailable` first; throws if unavailable. The bridge calls
 * `await backend.prime()` after this to warm the snapshot.
 */
export async function createZepKbBackend(opts: {
  kbId: string;
  forgeRoot: string;
  zepGraphId?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<ZepKbBackend> {
  const env = opts.env ?? process.env;
  if (!(await isZepAvailable(env))) {
    throw new Error(
      `ZepKbBackend unavailable: install ${ZEP_PACKAGE} and set ${ZEP_API_KEY_ENV}`,
    );
  }
  const client = await createZepGraphClient(env);
  return new ZepKbBackend({
    kbId: opts.kbId,
    forgeRoot: opts.forgeRoot,
    zepGraphId: opts.zepGraphId,
    client,
  });
}
