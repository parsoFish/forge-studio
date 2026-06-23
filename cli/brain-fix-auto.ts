/**
 * Deterministic AUTO-tier lint fixers — the real work behind the guided
 * lint-resolution UI's "Apply N auto-fixes" button (and the long-dead
 * `brain lint --fix` stub).
 *
 * Every fixer is SURGICAL + idempotent: it clears one finding-kind without
 * destroying curated content (category indexes carry hand-authored sub-headings
 * + descriptions, so we insert/dedupe a single link line rather than regenerate).
 * No LLM, no prompts — safe to run from the bridge. Fixers that would move files
 * (`category.mis-routed`) are gated on a clean git worktree.
 *
 * Handled kinds: frontmatter.date-order, frontmatter.missing-date,
 * index.not-listed, index.duplicate, orphan, category.mis-routed.
 */

import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

import matter from 'gray-matter';
import type { Finding } from './brain-lint.ts';

const CATEGORY_TO_INDEX_FILE: Record<string, string> = {
  pattern: 'patterns.md',
  antipattern: 'antipatterns.md',
  decision: 'decisions.md',
  operation: 'operations.md',
  reference: 'reference.md',
};
const CATEGORY_TO_BRAIN_SUBDIR: Record<string, string> = {
  pattern: 'cycles',
  antipattern: 'cycles',
  operation: 'cycles',
  decision: 'forge-dev',
  reference: 'forge-dev',
};
const AUTO_LINK_HEADING = '### Auto-linked (re-file under a curated heading when convenient)';

export type AutoFixResult = {
  applied: Array<{ kind: string; file: string; detail: string }>;
  skipped: Array<{ kind: string; file: string; reason: string }>;
};

type ParsedTheme = { data: Record<string, unknown>; content: string };

function parseTheme(file: string): ParsedTheme | null {
  try {
    const { data, content } = matter(readFileSync(file, 'utf8'));
    return { data: data as Record<string, unknown>, content };
  } catch {
    return null;
  }
}

/** True when the git worktree at forgeRoot has no staged/unstaged changes. */
function worktreeClean(forgeRoot: string): boolean {
  try {
    const out = execFileSync('git', ['-C', forgeRoot, 'status', '--porcelain'], { encoding: 'utf8' });
    return out.trim() === '';
  } catch {
    return false;
  }
}

/** The category index path for a theme's category, or null. */
function categoryIndexPath(forgeRoot: string, category: string): string | null {
  const file = CATEGORY_TO_INDEX_FILE[category];
  const sub = CATEGORY_TO_BRAIN_SUBDIR[category];
  if (!file || !sub) return null;
  return join(forgeRoot, 'brain', sub, file);
}

/** The canonical link line for a theme in its category index. */
function linkLine(slug: string, description: string): string {
  const desc = description.replace(/\s+/g, ' ').trim();
  return desc ? `- [\`${slug}\`](./themes/${slug}.md) — ${desc}` : `- [\`${slug}\`](./themes/${slug}.md)`;
}

/** Slugs already linked in an index body (one per `themes/<slug>.md` occurrence). */
function linkedSlugs(body: string): string[] {
  const slugs: string[] = [];
  const re = /\(\.?\.?\/?(?:themes\/)([a-zA-Z0-9._-]+?)(?:\.md)?\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) slugs.push(m[1]);
  return slugs;
}

/** Insert the theme's link line into its category index exactly once (idempotent). */
function ensureLinked(forgeRoot: string, themeFile: string): { ok: boolean; detail: string } {
  const parsed = parseTheme(themeFile);
  if (!parsed) return { ok: false, detail: 'theme unparseable' };
  const category = String(parsed.data.category ?? '');
  const indexPath = categoryIndexPath(forgeRoot, category);
  if (!indexPath || !existsSync(indexPath)) return { ok: false, detail: `no category index for "${category}"` };
  const slug = basename(themeFile, '.md');
  const body = readFileSync(indexPath, 'utf8');
  if (linkedSlugs(body).includes(slug)) return { ok: true, detail: 'already linked' };
  const line = linkLine(slug, String(parsed.data.description ?? ''));
  let next: string;
  if (body.includes(AUTO_LINK_HEADING)) {
    next = body.replace(AUTO_LINK_HEADING, `${AUTO_LINK_HEADING}\n\n${line}`);
  } else {
    next = `${body.replace(/\n+$/, '')}\n\n${AUTO_LINK_HEADING}\n\n${line}\n`;
  }
  writeFileSync(indexPath, next);
  return { ok: true, detail: `linked into ${relative(forgeRoot, indexPath)}` };
}

/** Remove duplicate link lines for a slug in its category index, keeping the first. */
function dedupeLinks(forgeRoot: string, themeFile: string): { ok: boolean; detail: string } {
  const parsed = parseTheme(themeFile);
  if (!parsed) return { ok: false, detail: 'theme unparseable' };
  const indexPath = categoryIndexPath(forgeRoot, String(parsed.data.category ?? ''));
  if (!indexPath || !existsSync(indexPath)) return { ok: false, detail: 'no category index' };
  const slug = basename(themeFile, '.md');
  const needle = `themes/${slug}.md`;
  const lines = readFileSync(indexPath, 'utf8').split('\n');
  let seen = false;
  const kept = lines.filter((l) => {
    if (l.includes(needle)) {
      if (seen) return false;
      seen = true;
    }
    return true;
  });
  if (kept.length === lines.length) return { ok: true, detail: 'no duplicates' };
  writeFileSync(indexPath, kept.join('\n'));
  return { ok: true, detail: `deduped in ${relative(forgeRoot, indexPath)}` };
}

/** Clamp/stamp the theme's frontmatter dates from file mtime. */
function fixDates(themeFile: string, kind: string): { ok: boolean; detail: string } {
  const raw = (() => { try { return readFileSync(themeFile, 'utf8'); } catch { return null; } })();
  if (raw === null) return { ok: false, detail: 'unreadable' };
  let parsed;
  try { parsed = matter(raw); } catch { return { ok: false, detail: 'unparseable frontmatter — agent-tier' }; }
  const data = parsed.data as Record<string, unknown>;
  let mtimeIso: string;
  try { mtimeIso = new Date(statSync(themeFile).mtimeMs).toISOString(); } catch { mtimeIso = new Date(0).toISOString(); }

  if (kind === 'frontmatter.missing-date') {
    if (!data.created_at) data.created_at = mtimeIso;
    if (!data.updated_at) data.updated_at = String(data.created_at ?? mtimeIso);
  } else {
    // date-order: clamp updated_at up to created_at (the later of the two is the truth).
    const c = new Date(String(data.created_at)).getTime();
    const u = new Date(String(data.updated_at)).getTime();
    if (!Number.isNaN(c) && !Number.isNaN(u) && c > u) data.updated_at = String(data.created_at);
  }
  writeFileSync(themeFile, matter.stringify(parsed.content, data));
  return { ok: true, detail: `dates fixed (${kind})` };
}

/** git mv a mis-routed theme into the sub-wiki its category belongs to + relink. */
function fixMisRouted(forgeRoot: string, themeFile: string): { ok: boolean; detail: string } {
  if (!worktreeClean(forgeRoot)) {
    return { ok: false, detail: 'git worktree not clean — commit/stash first (file move gated for safety)' };
  }
  const parsed = parseTheme(themeFile);
  if (!parsed) return { ok: false, detail: 'unparseable' };
  const category = String(parsed.data.category ?? '');
  const expectedSub = CATEGORY_TO_BRAIN_SUBDIR[category];
  if (!expectedSub) return { ok: false, detail: `no routing for "${category}"` };
  const dest = join(forgeRoot, 'brain', expectedSub, 'themes', basename(themeFile));
  if (existsSync(dest)) return { ok: false, detail: 'destination already exists' };
  try {
    execFileSync('git', ['-C', forgeRoot, 'mv', relative(forgeRoot, themeFile), relative(forgeRoot, dest)], { encoding: 'utf8' });
  } catch (err) {
    return { ok: false, detail: `git mv failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  ensureLinked(forgeRoot, dest);
  return { ok: true, detail: `moved to brain/${expectedSub}/themes/` };
}

/**
 * Apply every AUTO-tier fix for the given findings. Idempotent: a second run
 * produces no changes. Non-auto findings are ignored. Returns what changed +
 * what was skipped (e.g. a mis-route blocked by a dirty worktree).
 */
export function applyAutoFixes(forgeRoot: string, findings: Finding[]): AutoFixResult {
  const applied: AutoFixResult['applied'] = [];
  const skipped: AutoFixResult['skipped'] = [];
  for (const f of findings) {
    if (f.resolution !== 'auto') continue;
    const kind = f.kind ?? 'unknown';
    let r: { ok: boolean; detail: string };
    switch (kind) {
      case 'index.not-listed':
      case 'orphan':
        r = ensureLinked(forgeRoot, f.file); break;
      case 'index.duplicate':
        r = dedupeLinks(forgeRoot, f.file); break;
      case 'frontmatter.date-order':
      case 'frontmatter.missing-date':
        r = fixDates(f.file, kind); break;
      case 'category.mis-routed':
        r = fixMisRouted(forgeRoot, f.file); break;
      default:
        r = { ok: false, detail: `no auto-fixer for kind "${kind}"` };
    }
    if (r.ok) applied.push({ kind, file: f.file, detail: r.detail });
    else skipped.push({ kind, file: f.file, reason: r.detail });
  }
  return { applied, skipped };
}
