/**
 * Forge Studio KB (Knowledge Base) bridge routes (M5).
 *
 * Extracted from bridge-studio.ts to keep both modules under 800 LOC.
 * Imports shared helpers from bridge-studio.ts — no duplication, no circular
 * import (this module imports FROM bridge-studio, not vice versa).
 *
 * Routes:
 *   GET  /api/studio/kbs                        → { kbs: KbWithCounts[] }
 *   GET  /api/studio/kbs/resolve-node/:nodeId   → { kbId: string }
 *   GET  /api/studio/kbs/:id/nodes/:nodeId      → { node: KbNodeArticle }
 *   GET  /api/studio/kbs/:id                    → { kb, graph, health }
 *   POST /api/studio/kbs                        → create a new KB
 *   POST /api/studio/kbs/:id/guidance           → append guidance to a KB
 *
 * Returns false for non-matching URLs (passthrough to next handler).
 * Never throws — all errors caught, returned as 4xx/5xx JSON.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, openSync, closeSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve, sep } from 'node:path';
import yaml from 'js-yaml';

import { loadKbDescriptor } from '../orchestrator/studio/registry.ts';
import { resolveKbBrainDir } from '../orchestrator/brain-paths.ts';
import { SLUG_RE } from '../orchestrator/studio/validate.ts';
import { getKbBackend } from '../orchestrator/kb-backend.ts';
import { runBrainLint, resolutionCounts, applyAutoFixesUntilStable, type Finding } from './brain-lint.ts';
import { regenerateBrainIndex } from './brain-index.ts';
import { isDryBridge, refuseDryBridge } from './dry-bridge.ts';
import {
  sendJson,
  allowedOrigin,
  sanitizeError,
  readJson,
  pathOnly,
  SAFE_ID_RE,
  type StudioContext,
} from './bridge-studio.ts';

// ---------------------------------------------------------------------------
// KBs with layer counts
// ---------------------------------------------------------------------------

type KbWithCounts = {
  id: string;
  name: string;
  scope: string;
  desc: string;
  path: string;
  counts: { index: number; themes: number; raw: number };
};

function countLayerFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((f) => !f.startsWith('.')).length;
  } catch {
    return 0;
  }
}

/** Sub-directory names of a dir (empty on any error). */
function subDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Walk brain/ for kb.yaml files and enrich each with layer counts.
 *
 * Scans every direct sub-directory of brain/ (the top-level brains — cycles,
 * forge-dev) AND every sub-directory of brain/projects/ (the central per-project
 * brains, ADR 035 — gitpulse, mdtoc, …). Without the second pass, project brains
 * are invisible in Studio's KB graph even though the reflector writes to them.
 */
export function loadKbDescriptors(forgeRoot: string): KbWithCounts[] {
  const brainRoot = join(resolve(forgeRoot), 'brain');
  if (!existsSync(brainRoot)) return [];

  const result: KbWithCounts[] = [];
  const pushFrom = (kbDir: string): void => {
    const kbYamlPath = join(kbDir, 'kb.yaml');
    if (!existsSync(kbYamlPath)) return;
    try {
      const kb = loadKbDescriptor(kbYamlPath);
      const counts = {
        index: existsSync(join(kbDir, 'INDEX.md')) ? 1 : 0,
        themes: countLayerFiles(join(kbDir, 'themes')),
        raw: countLayerFiles(join(kbDir, '_raw')),
      };
      result.push({ ...kb, counts });
    } catch {
      // Skip unreadable kb.yaml
    }
  };

  // Top-level brains: brain/<id>/kb.yaml (brain/projects has no kb.yaml of its
  // own, so it is naturally skipped here).
  for (const d of subDirs(brainRoot)) pushFrom(join(brainRoot, d));
  // Central per-project brains: brain/projects/<id>/kb.yaml (ADR 035).
  const projectsRoot = join(brainRoot, 'projects');
  for (const d of subDirs(projectsRoot)) pushFrom(join(projectsRoot, d));

  return result;
}

// ---------------------------------------------------------------------------
// Lint-resolution helpers (the guided-resolution UI)
// ---------------------------------------------------------------------------

/** Keep only findings whose file belongs to this kb's brain dir (matches the
 *  lint route's historical filter; the kbId substring also covers the central
 *  per-project path brain/projects/<kbId>/). */
function scopeFindingsToKb(findings: Finding[], kbId: string): Finding[] {
  const brainDir = `brain/${kbId}`;
  return findings.filter((f) => !f.file || f.file.includes(brainDir) || f.file.includes(kbId));
}

/** Spawn ONE detached `forge brain fix` agent turn; events stream to
 *  _logs/_brainfix-<runId>/events.jsonl. Mirrors spawnArchitectTurn. */
function spawnBrainFix(
  forgeRoot: string,
  p: { kbId: string; file: string; check: string; kind: string; fixHint?: string; message: string; runId: string },
): void {
  const logDir = join(forgeRoot, '_logs', `_brainfix-${p.runId}`);
  mkdirSync(logDir, { recursive: true });
  const stderrFd = openSync(join(logDir, 'stderr.log'), 'a');
  const argv = [
    '--experimental-strip-types', 'orchestrator/cli.ts', 'brain', 'fix',
    '--kb', p.kbId, '--file', p.file, '--check', p.check, '--kind', p.kind,
    '--run-id', p.runId, '--message', p.message,
  ];
  if (p.fixHint) argv.push('--hint', p.fixHint);
  const proc = spawn(process.execPath, argv, { cwd: forgeRoot, detached: true, stdio: ['ignore', 'ignore', stderrFd] });
  closeSync(stderrFd);
  proc.unref();
}

/** Read a brain-fix run's terminal state from its event log. */
function readBrainFixState(forgeRoot: string, runId: string): { state: 'running' | 'cleared' | 'not-cleared' | 'failed'; cleared: boolean } {
  const evPath = join(forgeRoot, '_logs', `_brainfix-${runId}`, 'events.jsonl');
  if (!existsSync(evPath)) return { state: 'running', cleared: false };
  let raw: string;
  try { raw = readFileSync(evPath, 'utf8'); } catch { return { state: 'running', cleared: false }; }
  for (const line of raw.split('\n').reverse()) {
    if (!line.trim()) continue;
    let ev: { event_type?: string; message?: string; metadata?: { cleared?: boolean } };
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.event_type === 'end' || ev.message?.startsWith('brain-fix.end')) {
      const cleared = ev.metadata?.cleared === true;
      return { state: cleared ? 'cleared' : 'not-cleared', cleared };
    }
    if (ev.event_type === 'error' || ev.message === 'brain-fix.crashed') {
      return { state: 'failed', cleared: false };
    }
  }
  return { state: 'running', cleared: false };
}

// ---------------------------------------------------------------------------
// KB health computation
// ---------------------------------------------------------------------------

type KbHealth = {
  layerBalance: { index: number; theme: number; raw: number };
  orphans: number;
  linkDensity: number;
  staleness: { staleRawCount: number; staleThemeCount: number };
  lintFlags: number;
  lintErrors: number;
};

/**
 * Build the health object for a single KB by:
 *   1. Using the pre-computed layer counts from KbWithCounts.
 *   2. Running runBrainLint(scope:'full') and filtering findings to this kb's dir.
 *   3. Deriving orphans (nodes with degree 0), link density (edges/nodes),
 *      and staleness (nodes with updated_at older than 30 days).
 */
function buildKbHealth(
  forgeRoot: string,
  kbId: string,
  graph: import('../orchestrator/kb-graph.ts').KbGraph,
  _counts: { index: number; themes: number; raw: number },
): KbHealth {
  const { nodes, edges } = graph;

  // Layer balance from graph node counts (more accurate than the raw dir count)
  const layerBalance = {
    index: nodes.filter((n) => n.layer === 'index').length,
    theme: nodes.filter((n) => n.layer === 'theme').length,
    raw: nodes.filter((n) => n.layer === 'raw').length,
  };

  // Orphans: nodes with degree 0 (no inbound AND no outbound edges)
  const degree = new Map<string, number>();
  for (const n of nodes) degree.set(n.id, 0);
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const orphans = nodes.filter((n) => (degree.get(n.id) ?? 0) === 0).length;

  // Link density
  const linkDensity = nodes.length > 0 ? edges.length / nodes.length : 0;

  // Staleness: themes/raw with updatedAt older than 30 days
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let staleThemeCount = 0;
  let staleRawCount = 0;
  for (const n of nodes) {
    if (!n.updatedAt) continue;
    const ts = new Date(n.updatedAt).getTime();
    if (!isNaN(ts) && ts < thirtyDaysAgo) {
      if (n.layer === 'theme') staleThemeCount++;
      else if (n.layer === 'raw') staleRawCount++;
    }
  }

  // Run brain-lint and filter findings to this kb's directory
  let lintFlags = 0;
  let lintErrors = 0;
  try {
    const kbDir = resolve(forgeRoot, 'brain', kbId);
    const { findings } = runBrainLint({ cwd: forgeRoot, scope: 'full' });
    const kbFindings = findings.filter((f) => f.file.startsWith(kbDir));
    lintFlags = kbFindings.filter((f) => f.category === 'flag' || f.category === 'auto-fix').length;
    lintErrors = kbFindings.filter((f) => f.category === 'error').length;
  } catch {
    // Non-fatal: lint failure doesn't break the health response
  }

  return { layerBalance, orphans, linkDensity, staleness: { staleRawCount, staleThemeCount }, lintFlags, lintErrors };
}

// ---------------------------------------------------------------------------
// KB scope allowed values
// ---------------------------------------------------------------------------

const KB_SCOPES_ALLOWED = ['project', 'flow', 'agent-integration'] as const;
type KbScopeAllowed = typeof KB_SCOPES_ALLOWED[number];

// ---------------------------------------------------------------------------
// Guidance size cap
// ---------------------------------------------------------------------------

const GUIDANCE_MAX_BYTES = 8 * 1024; // 8 KiB

// ---------------------------------------------------------------------------
// Unified KB route handler (GET + POST)
// ---------------------------------------------------------------------------

/**
 * Handle all Forge Studio KB routes (read and write).
 *
 * Returns true if the route was handled (even on error), false for unknown URLs.
 * Never throws — all errors caught, returned as JSON.
 *
 * @param req    - Incoming request (used for origin check)
 * @param res    - Server response
 * @param ctx    - Minimal context: forgeRoot + logsRoot
 * @param rawUrl - Full URL including query string
 * @param method - HTTP method string
 */
export async function handleStudioKbRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- GET /api/studio/kbs (list) -----------------------------------------
  if (url === '/api/studio/kbs' && method === 'GET') {
    try {
      const kbs = loadKbDescriptors(ctx.forgeRoot);
      sendJson(res, 200, { kbs }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- GET /api/studio/kbs/resolve-node/:nodeId ---------------------------
  // Must be matched BEFORE /api/studio/kbs/:id (resolve-node would be captured as a kb id).
  const resolveNodeMatch = url.match(/^\/api\/studio\/kbs\/resolve-node\/(.+)$/);
  if (resolveNodeMatch && method === 'GET') {
    try {
      const nodeId = decodeURIComponent(resolveNodeMatch[1]);
      // NODE_ID_RE: allow alphanumeric, dash, underscore, colon, dot
      const NODE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/;
      if (!NODE_ID_RE.test(nodeId)) {
        sendJson(res, 400, { error: 'invalid node id' }, origin);
        return true;
      }
      const kbs = loadKbDescriptors(ctx.forgeRoot);
      let foundKbId: string | null = null;
      for (const kb of kbs) {
        try {
          const graph = getKbBackend(ctx.forgeRoot, kb.id).buildGraph();
          if (graph.nodes.some((n) => n.id === nodeId)) {
            foundKbId = kb.id;
            break;
          }
        } catch {
          // skip unreadable KB
        }
      }
      if (!foundKbId) {
        sendJson(res, 404, { error: 'node not found' }, origin);
        return true;
      }
      sendJson(res, 200, { kbId: foundKbId }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- GET /api/studio/kbs/:id/nodes/:nodeId (node article) ---------------
  // Must be matched before /api/studio/kbs/:id (more specific path).
  const kbNodeMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/nodes\/([^/]+)$/);
  if (kbNodeMatch && method === 'GET') {
    try {
      const kbId = decodeURIComponent(kbNodeMatch[1]);
      const nodeId = decodeURIComponent(kbNodeMatch[2]);

      // Slug-guard both ids (SLUG_RE covers typical slugs; nodeIds may have
      // 'raw:' prefix — use a slightly broader guard for nodeId).
      if (!SLUG_RE.test(kbId)) {
        sendJson(res, 400, { error: 'invalid kb id' }, origin);
        return true;
      }
      // Node ids: allow alphanumeric, dash, underscore, colon, dot (for raw: prefixed ids)
      const NODE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/;
      if (!NODE_ID_RE.test(nodeId)) {
        sendJson(res, 400, { error: 'invalid node id' }, origin);
        return true;
      }

      // Path-guard: kbId must not escape brain/
      const brainBase = resolve(ctx.forgeRoot, 'brain');
      const kbDir = resolve(brainBase, kbId);
      if (!kbDir.startsWith(brainBase + sep)) {
        sendJson(res, 400, { error: 'path traversal detected' }, origin);
        return true;
      }

      let article;
      try {
        article = getKbBackend(ctx.forgeRoot, kbId).getNodeArticle(nodeId);
      } catch (err) {
        // Unknown kbId → 404
        const msg = String(err);
        if (msg.includes('Unknown kbId')) {
          sendJson(res, 404, { error: `unknown kb: ${kbId}` }, origin);
          return true;
        }
        throw err;
      }

      if (!article) {
        sendJson(res, 404, { error: `unknown node: ${nodeId}` }, origin);
        return true;
      }

      sendJson(res, 200, { node: article }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- GET /api/studio/kbs/:id (single kb — graph + health) ---------------
  const kbGetMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)$/);
  if (kbGetMatch && method === 'GET') {
    try {
      const kbId = decodeURIComponent(kbGetMatch[1]);

      // Slug-guard before any fs operation
      if (!SLUG_RE.test(kbId)) {
        sendJson(res, 400, { error: 'invalid kb id' }, origin);
        return true;
      }

      // Path-guard: kbId must not escape brain/
      const brainBase = resolve(ctx.forgeRoot, 'brain');
      const kbDir = resolve(brainBase, kbId);
      if (!kbDir.startsWith(brainBase + sep)) {
        sendJson(res, 400, { error: 'path traversal detected' }, origin);
        return true;
      }

      // Resolve the kb descriptor (finds by walking brain/ for kb.yaml)
      const kbs = loadKbDescriptors(ctx.forgeRoot);
      const kb = kbs.find((k) => k.id === kbId);
      if (!kb) {
        sendJson(res, 404, { error: `unknown kb: ${kbId}` }, origin);
        return true;
      }

      // Build the per-kb graph from the brain filesystem
      let graph;
      try {
        graph = getKbBackend(ctx.forgeRoot, kbId).buildGraph();
      } catch (err) {
        const msg = String(err);
        if (msg.includes('Unknown kbId')) {
          sendJson(res, 404, { error: `unknown kb: ${kbId}` }, origin);
          return true;
        }
        throw err;
      }

      // Health: run brain-lint + derive metrics for this kb
      const health = buildKbHealth(ctx.forgeRoot, kbId, graph, kb.counts);

      // Drop 'path' from the KB response (client Kb type doesn't carry it)
      const { path: _path, ...kbPublic } = kb;
      sendJson(res, 200, { kb: kbPublic, graph, health }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- POST /api/studio/kbs (create a new KB) (M5-4) ---------------------
  if (url === '/api/studio/kbs' && method === 'POST') {
    try {
      // 1. Parse request body
      let body: unknown;
      try {
        body = await readJson(req);
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' }, origin);
        return true;
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        sendJson(res, 400, { error: 'body must be a JSON object' }, origin);
        return true;
      }
      const b = body as Record<string, unknown>;

      // 2. Validate id (slug-guard blocks path traversal)
      const id = typeof b['id'] === 'string' ? b['id'].trim() : '';
      if (!id) {
        sendJson(res, 400, { error: 'id is required' }, origin);
        return true;
      }
      if (!SLUG_RE.test(id)) {
        sendJson(res, 400, { error: 'invalid kb id — must match [a-z][a-z0-9]*(-[a-z0-9]+)*' }, origin);
        return true;
      }

      // 3. Validate name + desc (non-empty strings)
      const name = typeof b['name'] === 'string' ? b['name'].trim() : '';
      if (!name) {
        sendJson(res, 400, { error: 'name is required and must be non-empty' }, origin);
        return true;
      }
      const desc = typeof b['desc'] === 'string' ? b['desc'].trim() : '';
      if (!desc) {
        sendJson(res, 400, { error: 'desc is required and must be non-empty' }, origin);
        return true;
      }

      // 4. Validate scope enum
      const scope = typeof b['scope'] === 'string' ? b['scope'] : '';
      if (!KB_SCOPES_ALLOWED.includes(scope as KbScopeAllowed)) {
        sendJson(res, 400, { error: `scope must be one of: ${KB_SCOPES_ALLOWED.join(', ')}` }, origin);
        return true;
      }

      // 5. Path-guard: resolved kb dir must stay under brain/
      const brainBase = resolve(ctx.forgeRoot, 'brain');
      const kbDir = resolve(brainBase, id);
      if (!kbDir.startsWith(brainBase + sep)) {
        sendJson(res, 400, { error: 'path traversal detected' }, origin);
        return true;
      }

      // 6. Reject if already exists (409)
      if (existsSync(kbDir)) {
        sendJson(res, 409, { error: `kb already exists: ${id}` }, origin);
        return true;
      }

      // 7. Scaffold: mkdir brain/<id>/ + brain/<id>/themes/ + brain/<id>/_raw/
      mkdirSync(join(kbDir, 'themes'), { recursive: true });
      mkdirSync(join(kbDir, '_raw'), { recursive: true });

      // 8. Write brain/<id>/kb.yaml safely via js-yaml (prevents YAML injection)
      const kbYamlPath = join(kbDir, 'kb.yaml');
      const kbYamlContent = yaml.dump({ id, name, scope, desc }, { lineWidth: 120, quotingType: '"', forceQuotes: false });
      writeFileSync(kbYamlPath, kbYamlContent, 'utf8');

      // 9. Verify loadKbDescriptor can round-trip it
      loadKbDescriptor(kbYamlPath);

      sendJson(res, 200, { ok: true, id }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- DELETE /api/studio/kbs/:id (R1-5) — remove a knowledge base --------
  const kbDeleteMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)$/);
  if (kbDeleteMatch && method === 'DELETE') {
    try {
      const id = decodeURIComponent(kbDeleteMatch[1]);
      if (!SLUG_RE.test(id)) {
        sendJson(res, 400, { error: 'invalid kb id' }, origin);
        return true;
      }
      // Guard the forge-owned core brains (the three-brain model) from deletion.
      if (id === 'cycles' || id === 'forge-dev') {
        sendJson(res, 403, { error: `the forge-owned brain "${id}" cannot be deleted` }, origin);
        return true;
      }
      const dir = resolveKbBrainDir(ctx.forgeRoot, id);
      if (!dir || !existsSync(dir)) {
        sendJson(res, 404, { error: `unknown kb: ${id}` }, origin);
        return true;
      }
      const brainBase = resolve(ctx.forgeRoot, 'brain');
      if (!resolve(dir).startsWith(brainBase + sep)) {
        sendJson(res, 400, { error: 'path traversal detected' }, origin);
        return true;
      }
      rmSync(dir, { recursive: true, force: true });
      sendJson(res, 200, { ok: true, id }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- POST /api/studio/kbs/:id/guidance (M5-3) -------------------------
  const guidanceMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/guidance$/);
  if (guidanceMatch && method === 'POST') {
    try {
      const kbId = decodeURIComponent(guidanceMatch[1]);

      // 1. Slug-guard kbId before any fs operation (blocks path traversal)
      if (!SLUG_RE.test(kbId)) {
        sendJson(res, 400, { error: 'invalid kb id' }, origin);
        return true;
      }

      // 2. Path-guard: kbId must not escape brain/
      const brainBase = resolve(ctx.forgeRoot, 'brain');
      const kbDir = resolve(brainBase, kbId);
      if (!kbDir.startsWith(brainBase + sep)) {
        sendJson(res, 400, { error: 'path traversal detected' }, origin);
        return true;
      }

      // 3. Resolve kb (must have a kb.yaml — use loadKbDescriptors to find it)
      const kbs = loadKbDescriptors(ctx.forgeRoot);
      const kb = kbs.find((k) => k.id === kbId);
      if (!kb) {
        sendJson(res, 404, { error: `unknown kb: ${kbId}` }, origin);
        return true;
      }

      // 4. Parse request body
      let body: unknown;
      try {
        body = await readJson(req);
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' }, origin);
        return true;
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        sendJson(res, 400, { error: 'body must be a JSON object' }, origin);
        return true;
      }
      const b = body as Record<string, unknown>;

      // 5. Validate text (non-empty)
      const text = typeof b['text'] === 'string' ? b['text'].trim() : '';
      if (!text) {
        sendJson(res, 400, { error: 'text is required and must be non-empty' }, origin);
        return true;
      }

      // 5b. Guidance length cap (Fix #2)
      if (Buffer.byteLength(text, 'utf8') > GUIDANCE_MAX_BYTES) {
        sendJson(res, 400, { error: 'guidance text too large' }, origin);
        return true;
      }

      // 6. Validate targetNode if present (SLUG_RE + path guard)
      const targetNodeRaw = b['targetNode'];
      let targetNode: string | undefined;
      if (targetNodeRaw !== undefined && targetNodeRaw !== null && targetNodeRaw !== '') {
        if (typeof targetNodeRaw !== 'string') {
          sendJson(res, 400, { error: 'targetNode must be a string' }, origin);
          return true;
        }
        // Node ids may have 'raw:' prefix — allow alphanumeric, dash, underscore, colon, dot
        const NODE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/;
        if (!NODE_ID_RE.test(targetNodeRaw)) {
          sendJson(res, 400, { error: 'invalid targetNode — must be a valid node id' }, origin);
          return true;
        }
        targetNode = targetNodeRaw;
      }

      // 7. Build the _guidance dir path and guard it stays under brain/<kb>/
      const guidanceDir = join(kbDir, '_guidance');
      const guardedGuidanceDir = resolve(guidanceDir);
      if (!guardedGuidanceDir.startsWith(kbDir + sep) && guardedGuidanceDir !== kbDir) {
        sendJson(res, 400, { error: 'path traversal detected in guidance dir' }, origin);
        return true;
      }

      // 8. Mkdir _guidance/ if absent
      if (!existsSync(guidanceDir)) {
        mkdirSync(guidanceDir, { recursive: true });
      }

      // 9. Build filename: ISO-timestamp slug (e.g. 2026-06-13T14-30-00-000Z.md)
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${ts}.md`;
      const filePath = join(guidanceDir, filename);

      // Path-guard the resolved file path
      if (!resolve(filePath).startsWith(guardedGuidanceDir + sep)) {
        sendJson(res, 400, { error: 'path traversal detected in guidance file' }, origin);
        return true;
      }

      // 10. Write frontmatter + body
      const frontmatterLines = [
        '---',
        `created_at: "${new Date().toISOString()}"`,
        ...(targetNode ? [`target_node: "${targetNode}"`] : []),
        '---',
        '',
        text,
      ];
      writeFileSync(filePath, frontmatterLines.join('\n'), 'utf8');

      sendJson(res, 200, { ok: true, file: `brain/${kbId}/_guidance/${filename}` }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- POST /api/studio/kbs/:id/bootstrap (P3) — give a new brain real content --
  const bootstrapMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/bootstrap$/);
  if (bootstrapMatch && method === 'POST') {
    try {
      const kbId = decodeURIComponent(bootstrapMatch[1]);
      if (!SLUG_RE.test(kbId)) { sendJson(res, 400, { error: 'invalid kb id' }, origin); return true; }
      const brainBase = resolve(ctx.forgeRoot, 'brain');
      const kbDir = resolve(brainBase, kbId);
      if (!kbDir.startsWith(brainBase + sep) || !existsSync(kbDir)) {
        sendJson(res, 404, { error: 'unknown kb (create it first)' }, origin); return true;
      }
      let body: unknown;
      try { body = await readJson(req); } catch { body = {}; }
      const b = (body ?? {}) as Record<string, unknown>;
      const name = typeof b['name'] === 'string' && b['name'].trim() ? b['name'].trim() : kbId;
      const summary = typeof b['summary'] === 'string' ? b['summary'].trim() : '';

      // Seed a real profile node (Brain-3 convention) so the brain isn't an empty
      // single node — a readable starting point cycles then build on.
      const profilePath = resolve(kbDir, 'profile.md');
      if (!existsSync(profilePath)) {
        writeFileSync(profilePath, [
          `# ${name}`,
          '',
          summary || '_Project knowledge base. Populated as cycles run and the reflector ingests learnings._',
          '',
          '## Themes',
          '',
          '_(none yet — the reflector adds a theme per durable learning)_',
          '',
          '## Known failure modes',
          '',
          '_(none recorded yet)_',
          '',
        ].join('\n'), 'utf8');
      }
      const result = regenerateBrainIndex({ cwd: ctx.forgeRoot });
      sendJson(res, 200, { ok: true, seeded: ['profile.md'], result }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- GET /api/studio/kbs/:id/fix-agent/:runId — agent-fix run state ----
  const fixStatusMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/fix-agent\/([^/]+)$/);
  if (fixStatusMatch && method === 'GET') {
    const runId = decodeURIComponent(fixStatusMatch[2]);
    if (!SAFE_ID_RE.test(runId)) { sendJson(res, 400, { error: 'invalid run id' }, origin); return true; }
    sendJson(res, 200, { ok: true, runId, ...readBrainFixState(ctx.forgeRoot, runId) }, origin);
    return true;
  }

  // ---- POST /api/studio/kbs/:id/maintenance (K3) — manual brain maintenance --
  const maintMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/maintenance$/);
  if (maintMatch && method === 'POST') {
    try {
      const kbId = decodeURIComponent(maintMatch[1]);
      if (!SLUG_RE.test(kbId)) { sendJson(res, 400, { error: 'invalid kb id' }, origin); return true; }
      let body: unknown;
      try { body = await readJson(req); } catch { sendJson(res, 400, { error: 'invalid JSON body' }, origin); return true; }
      const op = (body as Record<string, unknown>)?.['op'];

      if (op === 'lint') {
        const { findings } = runBrainLint({ cwd: ctx.forgeRoot, scope: 'full' });
        const scoped = scopeFindingsToKb(findings, kbId);
        // `ok: true` so the UI's studioPost (which gates success on data.ok, like
        // the sibling `index` op) treats a successful lint as success, not failure.
        sendJson(res, 200, { op: 'lint', ok: true, findings: scoped, total: scoped.length, counts: resolutionCounts(scoped) }, origin);
        return true;
      }
      if (op === 'fix-auto') {
        // Apply every deterministic AUTO-tier fix for this kb to a FIXED POINT —
        // one click drains the whole auto tier (re-lints between rounds), no
        // repeat clicks. Scoped to this kb's findings.
        const brainDir = `brain/${kbId}`;
        const inKb = (f: Finding): boolean => !f.file || f.file.includes(brainDir) || f.file.includes(kbId);
        const result = applyAutoFixesUntilStable(ctx.forgeRoot, { filter: inKb });
        sendJson(res, 200, { op: 'fix-auto', ok: true, applied: result.applied, skipped: result.skipped, rounds: result.rounds, remaining: result.remaining, counts: resolutionCounts(result.remaining) }, origin);
        return true;
      }
      if (op === 'fix-agent') {
        if (isDryBridge()) {
          refuseDryBridge(res, origin, {
            route: '/api/studio/kbs/:id/maintenance (op=fix-agent)', method, action: 'spawn-agent', logsRoot: ctx.logsRoot,
          });
          return true;
        }
        // Dispatch ONE agent-tier fix turn. Body carries the finding + (for a
        // user-decided finding) the operator's decision folded into fixHint.
        const b = body as Record<string, unknown>;
        const file = typeof b.file === 'string' ? b.file : '';
        const check = typeof b.check === 'string' ? b.check : '';
        const kind = typeof b.kind === 'string' ? b.kind : '';
        const fixHint = typeof b.fixHint === 'string' ? b.fixHint : undefined;
        const message = typeof b.message === 'string' ? b.message : '';
        if (!file || !check || !kind) { sendJson(res, 400, { error: 'fix-agent requires file, check, kind' }, origin); return true; }
        // Path-guard: the target file MUST be under brain/ (no traversal).
        const abs = resolve(file);
        if (abs !== file || !abs.startsWith(resolve(ctx.forgeRoot, 'brain') + sep)) {
          sendJson(res, 400, { error: 'file must be an absolute path under brain/' }, origin); return true;
        }
        const runId = `${kbId}-${Date.now().toString(36)}`;
        try {
          spawnBrainFix(ctx.forgeRoot, { kbId, file: abs, check, kind, fixHint, message, runId });
        } catch (err) {
          sendJson(res, 500, { error: `failed to dispatch agent fix: ${sanitizeError(err)}` }, origin); return true;
        }
        sendJson(res, 200, { op: 'fix-agent', ok: true, runId }, origin);
        return true;
      }
      if (op === 'index') {
        const result = regenerateBrainIndex({ cwd: ctx.forgeRoot });
        sendJson(res, 200, { op: 'index', ok: true, result }, origin);
        return true;
      }
      sendJson(res, 400, { error: 'op must be one of: lint | fix-auto | fix-agent | index' }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}
