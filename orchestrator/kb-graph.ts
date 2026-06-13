/**
 * KB graph builder — pure FS reads.
 *
 * Builds a per-KB graph from the brain filesystem:
 *   - Index nodes: INDEX.md + category index files (patterns.md etc.)
 *   - Theme nodes: themes/*.md (gray-matter frontmatter)
 *   - Raw nodes: _raw/**\/*.md, capped to newest 80
 *
 * Edges from:
 *   - related_themes[] frontmatter array
 *   - [[wiki-link]] mentions in theme bodies (resolved within this kb)
 *   - INDEX node → each theme (so the graph is connected)
 *
 * No external tool dependency — reads the brain FS directly.
 */

import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { execSync } from 'node:child_process';
// gray-matter has no usable types; treated as any for parsing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import matter from 'gray-matter';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type KbLayer = 'index' | 'theme' | 'raw' | 'guidance';

export type KbNode = {
  id: string;
  title: string;
  layer: KbLayer;
  category?: string;
  updatedAt?: string;
};

export type KbEdge = { from: string; to: string };

export type KbGraph = { nodes: KbNode[]; edges: KbEdge[] };

export type KbNodeArticle = {
  id: string;
  title: string;
  layer: KbLayer;
  category?: string;
  body: string;
  inbound: { id: string; title: string }[];
  outbound: { id: string; title: string }[];
  touchedBy?: string;
};

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/** Category index file names that live in the kb root dir. */
const CATEGORY_INDEX_FILES: Record<string, string> = {
  'patterns.md': 'patterns',
  'antipatterns.md': 'antipatterns',
  'decisions.md': 'decisions',
  'operations.md': 'operations',
  'reference.md': 'reference',
};

/** Max raw nodes to include (cap to newest N by mtime). */
const RAW_NODE_CAP = 80;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the absolute path to the kb's brain directory. */
function resolveKbDir(forgeRoot: string, kbId: string): string {
  const brainRoot = resolve(forgeRoot, 'brain');
  const kbDir = join(brainRoot, kbId);
  if (!existsSync(join(kbDir, 'kb.yaml'))) {
    throw new Error(`Unknown kbId: "${kbId}" — no brain/${kbId}/kb.yaml found`);
  }
  return kbDir;
}

/** Convert a filesystem path to a stable slug id. Uses the filename without .md. */
function fileToSlug(filePath: string): string {
  return basename(filePath, '.md');
}

/** Walk a directory recursively, returning all .md files sorted by mtime desc. */
function walkMdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];

  function walk(current: string): void {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = join(current, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile() && e.name.endsWith('.md')) {
        results.push(full);
      }
    }
  }

  walk(dir);
  // Sort by mtime descending (newest first)
  return results.sort((a, b) => {
    try {
      return statSync(b).mtimeMs - statSync(a).mtimeMs;
    } catch {
      return 0;
    }
  });
}

/**
 * Lenient frontmatter parser — mirrors brain-lint.ts:parseTheme.
 * Tries gray-matter first; on YAML failure (e.g. unquoted `:` in a description
 * field) falls back to a regex line-by-line extractor so we can still get the
 * `category` and other scalar fields from themes that gray-matter would reject.
 *
 * Additionally, after gray-matter succeeds, we SUPPLEMENT its output with a
 * line-by-line regex scan of the raw frontmatter block for the known scalar
 * fields (category, title, created_at, updated_at). gray-matter silently folds
 * multi-line description values that contain embedded `: ` sequences (e.g.
 * "Fix: always pass --dir"), swallowing the subsequent `category:` line into
 * the description value. The line-regex scan is immune to this because it only
 * captures the first-line value of each key and ignores continuation lines.
 */

/** Fields to recover via line-regex scan when gray-matter silently folds them. */
const SCALAR_FIELDS_TO_RECOVER = ['category', 'title', 'created_at', 'updated_at'] as const;

/**
 * Extract the raw frontmatter block (between the first two `---` lines) and
 * build a map of scalar key→value via line regex. Continuation/folded lines
 * (lines that are not themselves `key: value`) are ignored — which is exactly
 * what we want for category/dates.
 */
function extractFrontmatterLineFields(raw: string): Record<string, string> {
  const lines = raw.split('\n');
  if (lines[0]?.trim() !== '---') return {};
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end < 0) return {};
  const fields: Record<string, string> = {};
  for (let i = 1; i < end; i++) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.+)$/.exec(lines[i]);
    if (m) fields[m[1]] = m[2].trim();
  }
  return fields;
}

function parseMd(raw: string): { data: Record<string, unknown>; content: string } {
  try {
    const { data, content } = matter(raw) as { data: Record<string, unknown>; content: string };

    // Supplement gray-matter's output with a line-regex scan of the raw
    // frontmatter block for the known scalar fields.  gray-matter silently
    // folds multi-line description values that contain embedded `: ` sequences
    // (e.g. "Fix: always pass --dir"), swallowing the subsequent `category:`
    // line.  The line-regex scan is immune to this because it only captures the
    // first-line value of each key.
    const lineFields = extractFrontmatterLineFields(raw);
    for (const field of SCALAR_FIELDS_TO_RECOVER) {
      const current = data[field];
      const isMissing =
        current === undefined || current === null || (typeof current === 'string' && current === '');
      if (isMissing && lineFields[field]) {
        data[field] = lineFields[field];
      }
    }

    return { data, content };
  } catch {
    // Fallback: split on first two `---` delimiters
    const lineFields = extractFrontmatterLineFields(raw);
    const lines = raw.split('\n');
    if (lines[0]?.trim() !== '---') return { data: {}, content: raw };
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') { end = i; break; }
    }
    if (end < 0) return { data: {}, content: raw };
    return { data: lineFields as Record<string, unknown>, content: lines.slice(end + 1).join('\n') };
  }
}

/** Extract [[slug]] links from markdown body. */
function extractWikiLinks(body: string): string[] {
  const slugs: string[] = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const slug = m[1].trim();
    if (slug) slugs.push(slug);
  }
  return slugs;
}

/** Get the git last-author for a file. Returns undefined on failure. */
function gitLastAuthor(filePath: string): string | undefined {
  try {
    const out = execSync(`git log -1 --format=%an -- "${filePath}"`, {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// buildKbGraph
// ---------------------------------------------------------------------------

export function buildKbGraph(forgeRoot: string, kbId: string): KbGraph {
  const kbDir = resolveKbDir(forgeRoot, kbId); // throws on unknown kbId

  const nodes: KbNode[] = [];
  const edges: KbEdge[] = [];

  // Track node ids for dedup + edge resolution
  const nodeIds = new Set<string>();

  function addNode(node: KbNode): void {
    if (!nodeIds.has(node.id)) {
      nodeIds.add(node.id);
      nodes.push(node);
    }
  }

  // ---- INDEX node (the kb root) -------------------------------------------
  const kbIndexId = `${kbId}-index`;
  addNode({ id: kbIndexId, title: 'INDEX', layer: 'index' });

  // ---- Category index nodes -----------------------------------------------
  const categoryIndexIds: string[] = [];
  for (const [filename, label] of Object.entries(CATEGORY_INDEX_FILES)) {
    const indexPath = join(kbDir, filename);
    if (!existsSync(indexPath)) continue;
    const indexId = `${kbId}-index-${label}`;
    addNode({ id: indexId, title: label.charAt(0).toUpperCase() + label.slice(1), layer: 'index' });
    categoryIndexIds.push(indexId);
    // Edge: kb INDEX → category index
    edges.push({ from: kbIndexId, to: indexId });
  }

  // ---- Theme nodes --------------------------------------------------------
  const themesDir = join(kbDir, 'themes');
  const themeFiles: string[] = [];
  if (existsSync(themesDir)) {
    try {
      const entries = readdirSync(themesDir);
      for (const f of entries) {
        if (f === 'README.md' || !f.endsWith('.md')) continue;
        themeFiles.push(join(themesDir, f));
      }
    } catch {
      // unreadable themes dir
    }
  }

  // Store theme id → frontmatter for edge resolution later
  const themeData = new Map<
    string,
    { related_themes?: string[]; body: string; category?: string; updatedAt?: string; title: string }
  >();

  for (const tf of themeFiles) {
    const slug = fileToSlug(tf);
    let parsed: { data: Record<string, unknown>; content: string } | null = null;
    try {
      const raw = readFileSync(tf, 'utf8');
      parsed = parseMd(raw);
    } catch {
      // skip unreadable file
    }

    const title = (parsed?.data.title as string | undefined) || slug;
    const category = parsed?.data.category as string | undefined;
    const updatedAt = parsed?.data.updated_at as string | undefined;
    const relatedThemes = Array.isArray(parsed?.data.related_themes)
      ? (parsed!.data.related_themes as string[])
      : [];
    const body = parsed?.content ?? '';

    addNode({ id: slug, title, layer: 'theme', category, updatedAt });
    themeData.set(slug, { related_themes: relatedThemes, body, category, updatedAt, title });
  }

  // ---- Raw nodes (capped to newest RAW_NODE_CAP) --------------------------
  const rawDir = join(kbDir, '_raw');
  const rawFiles = walkMdFiles(rawDir);

  // Cap to newest 80 — capped flag logged in comment above RAW_NODE_CAP const
  const cappedRawFiles = rawFiles.length > RAW_NODE_CAP ? rawFiles.slice(0, RAW_NODE_CAP) : rawFiles;

  for (const rf of cappedRawFiles) {
    const slug = fileToSlug(rf);
    // Avoid id collision with theme slugs by prefixing with 'raw:'
    const rawId = `raw:${slug}`;
    let title = slug;
    try {
      const raw = readFileSync(rf, 'utf8');
      const parsed = parseMd(raw);
      const sourceTitle = parsed.data.source_title as string | undefined;
      if (sourceTitle) title = sourceTitle;
    } catch {
      // keep slug as title
    }
    addNode({ id: rawId, title, layer: 'raw' });
  }

  // ---- Guidance nodes from _guidance/*.md --------------------------------
  // Pending human guidance notes render as amber-diamond nodes until consumed
  // by the next brain-ingest pass (which deletes them).
  const guidanceDir = join(kbDir, '_guidance');
  if (existsSync(guidanceDir)) {
    let guidanceEntries: string[];
    try {
      guidanceEntries = readdirSync(guidanceDir).filter((f) => f.endsWith('.md'));
    } catch {
      guidanceEntries = [];
    }
    for (const filename of guidanceEntries) {
      const guidancePath = join(guidanceDir, filename);
      const guidanceNodeId = `guidance-${basename(filename, '.md')}`;
      let guidanceTargetNode: string | undefined;
      try {
        const raw = readFileSync(guidancePath, 'utf8');
        const parsed = parseMd(raw);
        guidanceTargetNode = parsed.data.target_node as string | undefined;
      } catch {
        // skip unreadable guidance file
        continue;
      }
      // KbNode does not carry body — the body is returned by getKbNodeArticle.
      addNode({
        id: guidanceNodeId,
        title: 'guidance',
        layer: 'guidance',
      });
      // If target_node is set and the target exists, add an edge (dashed amber link)
      if (guidanceTargetNode && typeof guidanceTargetNode === 'string') {
        // edge is added after all nodes are registered — defer it
        edges.push({ from: guidanceNodeId, to: guidanceTargetNode });
      }
    }
  }

  // ---- Edges from theme → related_themes + wiki-links ---------------------
  for (const [fromId, data] of themeData) {
    // related_themes edges
    for (const relSlug of data.related_themes ?? []) {
      if (nodeIds.has(relSlug)) {
        edges.push({ from: fromId, to: relSlug });
      }
    }

    // [[wiki-link]] edges
    for (const linkSlug of extractWikiLinks(data.body)) {
      if (nodeIds.has(linkSlug) && linkSlug !== fromId) {
        // Avoid duplicate edges
        const exists = edges.some((e) => e.from === fromId && e.to === linkSlug);
        if (!exists) {
          edges.push({ from: fromId, to: linkSlug });
        }
      }
    }
  }

  // ---- INDEX → themes (ensures INDEX isn't an orphan) --------------------
  // Connect via category index → themes of that category, or directly if no
  // category index present for a theme.
  const themesByCat = new Map<string, string[]>();
  for (const [tId, data] of themeData) {
    const cat = data.category ?? '__none__';
    if (!themesByCat.has(cat)) themesByCat.set(cat, []);
    themesByCat.get(cat)!.push(tId);
  }

  // Map category label → categoryIndexId
  const catLabelToIndexId = new Map<string, string>();
  for (const [, label] of Object.entries(CATEGORY_INDEX_FILES)) {
    catLabelToIndexId.set(label, `${kbId}-index-${label}`);
  }
  // Also map plural category → index label (pattern→patterns, antipattern→antipatterns etc.)
  const catToLabel: Record<string, string> = {
    pattern: 'patterns',
    antipattern: 'antipatterns',
    decision: 'decisions',
    operation: 'operations',
    reference: 'reference',
  };

  for (const [cat, themeIds] of themesByCat) {
    const label = catToLabel[cat];
    const catIndexId = label ? catLabelToIndexId.get(label) : undefined;

    for (const tId of themeIds) {
      if (catIndexId && nodeIds.has(catIndexId)) {
        // category-index → theme
        edges.push({ from: catIndexId, to: tId });
      } else {
        // No category index for this theme → connect directly from kb INDEX
        edges.push({ from: kbIndexId, to: tId });
      }
    }
  }

  // Drop dangling edges (both nodes must exist)
  const validEdges = edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

  return { nodes, edges: validEdges };
}

// ---------------------------------------------------------------------------
// getKbNodeArticle
// ---------------------------------------------------------------------------

export function getKbNodeArticle(
  forgeRoot: string,
  kbId: string,
  nodeId: string,
): KbNodeArticle | null {
  const kbDir = resolveKbDir(forgeRoot, kbId); // throws on unknown kbId

  // Build the graph to resolve inbound/outbound edges
  const graph = buildKbGraph(forgeRoot, kbId);
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  const node = nodeMap.get(nodeId);
  if (!node) return null;

  // Resolve inbound (nodes that have an edge TO this node)
  const inbound: { id: string; title: string }[] = graph.edges
    .filter((e) => e.to === nodeId)
    .map((e) => ({ id: e.from, title: nodeMap.get(e.from)?.title ?? e.from }));

  // Resolve outbound (nodes this node points to)
  const outbound: { id: string; title: string }[] = graph.edges
    .filter((e) => e.from === nodeId)
    .map((e) => ({ id: e.to, title: nodeMap.get(e.to)?.title ?? e.to }));

  // Determine the file path for this node
  let filePath: string | null = null;
  let body = '';

  if (node.layer === 'guidance') {
    // guidance node id is 'guidance-<filename-without-.md>'
    const slug = nodeId.startsWith('guidance-') ? nodeId.slice('guidance-'.length) : nodeId;
    const candidate = join(kbDir, '_guidance', `${slug}.md`);
    if (existsSync(candidate)) filePath = candidate;
  } else if (node.layer === 'theme') {
    const candidate = join(kbDir, 'themes', `${nodeId}.md`);
    if (existsSync(candidate)) filePath = candidate;
  } else if (node.layer === 'raw') {
    // raw node ids are prefixed with 'raw:'
    const slug = nodeId.startsWith('raw:') ? nodeId.slice(4) : nodeId;
    const rawDir = join(kbDir, '_raw');
    const candidate = join(rawDir, `${slug}.md`);
    if (existsSync(candidate)) filePath = candidate;
  } else if (node.layer === 'index') {
    // Could be INDEX.md or a category index file
    const indexMd = join(kbDir, 'INDEX.md');
    if (existsSync(indexMd)) {
      filePath = indexMd;
    } else {
      // category index: id is `<kbId>-index-<label>`
      const prefix = `${kbId}-index-`;
      if (nodeId.startsWith(prefix)) {
        const label = nodeId.slice(prefix.length);
        // Map label back to filename
        const filename = Object.entries(CATEGORY_INDEX_FILES).find(([, l]) => l === label)?.[0];
        if (filename) {
          const candidate = join(kbDir, filename);
          if (existsSync(candidate)) filePath = candidate;
        }
      }
    }
  }

  if (filePath) {
    try {
      const raw = readFileSync(filePath, 'utf8');
      body = parseMd(raw).content;
    } catch {
      body = '';
    }
  }

  // touchedBy: git last-author or updatedAt
  let touchedBy: string | undefined;
  if (filePath) {
    touchedBy = gitLastAuthor(filePath) ?? node.updatedAt;
  }

  return {
    id: nodeId,
    title: node.title,
    layer: node.layer,
    category: node.category,
    body,
    inbound,
    outbound,
    touchedBy,
  };
}

// ---------------------------------------------------------------------------
// consumeGuidance — list pending guidance files for brain-ingest to process
// ---------------------------------------------------------------------------

export type PendingGuidance = {
  /** Absolute path to the guidance .md file */
  file: string;
  /** The guidance text (body after frontmatter) */
  text: string;
  /** Optional target node slug from frontmatter.target_node */
  targetNode?: string;
};

/**
 * List all pending guidance files in `brain/<kbId>/_guidance/*.md`.
 *
 * Called by the brain-ingest skill to discover what human guidance notes
 * are waiting to be incorporated. The skill reads each note, incorporates
 * it into the appropriate theme, then calls `deleteGuidanceFile` to remove
 * the consumed file.
 *
 * Returns an empty array if no _guidance/ dir or no pending files.
 * Throws on unknown kbId (unknown brain dir).
 */
export function listPendingGuidance(forgeRoot: string, kbId: string): PendingGuidance[] {
  const kbDir = resolveKbDir(forgeRoot, kbId); // throws on unknown kbId
  const guidanceDir = join(kbDir, '_guidance');
  if (!existsSync(guidanceDir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(guidanceDir).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }

  const result: PendingGuidance[] = [];
  for (const filename of entries) {
    const filePath = join(guidanceDir, filename);
    try {
      const raw = readFileSync(filePath, 'utf8');
      const parsed = parseMd(raw);
      const text = parsed.content.trim();
      const targetNode = parsed.data.target_node as string | undefined;
      result.push({ file: filePath, text, targetNode });
    } catch {
      // skip unreadable file
    }
  }
  return result;
}

/**
 * Delete a consumed guidance file.
 *
 * Called by the brain-ingest skill after it has incorporated a guidance note
 * into the appropriate theme. Validates the path stays within the _guidance
 * directory before deleting.
 *
 * Returns true if the file was deleted, false if it was already gone.
 */
export function deleteGuidanceFile(forgeRoot: string, kbId: string, filePath: string): boolean {
  const kbDir = resolveKbDir(forgeRoot, kbId); // throws on unknown kbId
  const guidanceDir = join(kbDir, '_guidance');
  const resolvedFile = resolve(filePath);
  const resolvedGuidanceDir = resolve(guidanceDir);

  // Path-guard: the file must be inside _guidance/
  if (!resolvedFile.startsWith(resolvedGuidanceDir + '/')) {
    throw new Error(`deleteGuidanceFile: path traversal — "${filePath}" is not under _guidance/`);
  }

  if (!existsSync(resolvedFile)) return false;
  rmSync(resolvedFile);
  return true;
}
