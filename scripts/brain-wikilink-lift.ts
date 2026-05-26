/**
 * brain-wikilink-lift — Stage 4 of brain-refinement-2026-05-23.
 *
 * For every theme under brain/cycles/themes/ and brain/projects/<name>/themes/:
 *  - Read frontmatter.related_themes
 *  - Reconcile against any inline links found in body ## Related / ## See also
 *  - Write a normalised ## See also section using [[slug]] wikilink form,
 *    preserving the original one-line description where available
 *  - Replace any [Theme: X](./y.md) inline markdown links inside the section
 *    with [[y]] wikilinks
 *
 * Idempotent — running twice produces the same output.
 *
 * Output: writes files in place. Prints a summary table.
 *
 * Run: `node --experimental-strip-types scripts/brain-wikilink-lift.ts`
 *      `node --experimental-strip-types scripts/brain-wikilink-lift.ts --dry-run`
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname, relative } from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import matter from 'gray-matter';

type ThemeMeta = {
  path: string;
  slug: string;
  title: string;
  description: string;
  relatedFromFrontmatter: string[];
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (s.isFile() && p.endsWith('.md') && !p.endsWith('/README.md')) out.push(p);
  }
  return out;
}

function findThemes(forgeRoot: string): string[] {
  const forgeThemes = walk(join(forgeRoot, 'brain/cycles/themes'));
  const projectsDir = join(forgeRoot, 'brain/projects');
  const projectThemes: string[] = [];
  for (const proj of readdirSync(projectsDir)) {
    const tdir = join(projectsDir, proj, 'themes');
    try {
      if (statSync(tdir).isDirectory()) walk(tdir, projectThemes);
    } catch { /* no themes dir */ }
  }
  return [...forgeThemes, ...projectThemes];
}

function loadMeta(path: string): ThemeMeta | null {
  const raw = readFileSync(path, 'utf8');
  let parsed;
  try {
    parsed = matter(raw);
  } catch {
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = parsed.data as any;
  const slug = basename(path, '.md');
  const title = (data?.title as string) ?? slug;
  const description = (data?.description as string) ?? '';
  const fm = data?.related_themes;
  const relatedFromFrontmatter = Array.isArray(fm)
    ? fm.map((s) => String(s).trim()).filter(Boolean)
    : [];
  return { path, slug, title, description, relatedFromFrontmatter };
}

/**
 * Strip the existing ## Related / ## See also section if present and return
 * the body without it. Returns { stripped, descByOrigSlug } where
 * descByOrigSlug maps any author-provided slug → its inline description so
 * we can preserve the per-link blurb when rewriting.
 */
function stripRelatedBlock(body: string): {
  stripped: string;
  descBySlug: Record<string, string>;
} {
  const descBySlug: Record<string, string> = {};

  // Match the LAST occurrence of ## Related or ## See also and everything
  // until the next H2 or EOF.
  const headingRe = /\n##\s+(Related|See also|See Also)\s*\n/i;
  const m = body.match(headingRe);
  if (!m) return { stripped: body, descBySlug };

  const startIdx = m.index!;
  const afterHeading = body.slice(startIdx + m[0].length);
  // Stop at the next ## heading (any) or EOF
  const next = afterHeading.search(/\n##\s+/);
  const blockBody = next === -1 ? afterHeading : afterHeading.slice(0, next);
  const trailing = next === -1 ? '' : afterHeading.slice(next);

  // Extract descriptions from existing bullet lines
  // Patterns we support:
  //   - [Theme: Foo](./slug.md) — description
  //   - [[slug]] — description
  for (const line of blockBody.split('\n')) {
    const mdLink = line.match(/\[Theme:[^\]]+\]\(\.\/([\w.\-]+?)\.md\)\s*[—\-:]\s*(.+?)\s*$/);
    if (mdLink) {
      descBySlug[mdLink[1]] = mdLink[2].trim();
      continue;
    }
    const wikiLink = line.match(/\[\[([\w.\-]+)\]\]\s*[—\-:]\s*(.+?)\s*$/);
    if (wikiLink) {
      descBySlug[wikiLink[1]] = wikiLink[2].trim();
      continue;
    }
  }

  const stripped = body.slice(0, startIdx) + trailing;
  return { stripped, descBySlug };
}

function buildSeeAlsoBlock(slugs: string[], descBySlug: Record<string, string>, titleBySlug: Record<string, string>): string {
  if (slugs.length === 0) return '';
  const lines = ['## See also', ''];
  for (const slug of slugs) {
    const blurb = descBySlug[slug];
    const title = titleBySlug[slug];
    if (blurb) {
      lines.push(`- [[${slug}]] — ${blurb}`);
    } else if (title && title !== slug) {
      lines.push(`- [[${slug}]] — ${title.toLowerCase()}.`);
    } else {
      lines.push(`- [[${slug}]]`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function dedupePreserveOrder<T>(arr: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const x of arr) {
    if (!seen.has(x)) { seen.add(x); out.push(x); }
  }
  return out;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const forgeRoot = '/home/parso/forge';
  const themes = findThemes(forgeRoot);
  const metas = themes.map(loadMeta).filter((m): m is ThemeMeta => m !== null);

  const titleBySlug: Record<string, string> = {};
  for (const m of metas) titleBySlug[m.slug] = m.title;

  let touched = 0;
  let unchanged = 0;
  const report: Array<{ slug: string; before: number; after: number }> = [];

  for (const m of metas) {
    const raw = readFileSync(m.path, 'utf8');
    const parsed = matter(raw);
    const body = parsed.content;

    const { stripped, descBySlug } = stripRelatedBlock(body);

    // Union of frontmatter + previously linked slugs (filter to slugs we
    // actually know about so we never link to a non-existent theme).
    const knownSet = new Set(metas.map((x) => x.slug));
    const candidates = dedupePreserveOrder([
      ...m.relatedFromFrontmatter,
      ...Object.keys(descBySlug),
    ]).filter((s) => knownSet.has(s) && s !== m.slug);

    const seeAlso = buildSeeAlsoBlock(candidates, descBySlug, titleBySlug);

    // Trim trailing whitespace from stripped body, then attach the see-also
    // block (if any) with a single blank line separator.
    let newBody = stripped.replace(/\s+$/, '');
    if (seeAlso) newBody = `${newBody}\n\n${seeAlso}`;
    else newBody = `${newBody}\n`;

    // Re-serialise with original frontmatter intact
    const newRaw = matter.stringify(newBody, parsed.data);

    if (newRaw === raw) {
      unchanged++;
      continue;
    }
    if (!dryRun) writeFileSync(m.path, newRaw, 'utf8');
    touched++;
    const beforeRelatedCount = (body.match(/\[Theme:[^\]]+\]\(\.\/[\w.\-]+\.md\)|\[\[[\w.\-]+\]\]/g) ?? []).length;
    const afterRelatedCount = candidates.length;
    report.push({ slug: m.slug, before: beforeRelatedCount, after: afterRelatedCount });
  }

  console.log(`themes scanned: ${metas.length}`);
  console.log(`touched:        ${touched}`);
  console.log(`unchanged:      ${unchanged}`);
  console.log(`dry-run:        ${dryRun ? 'YES' : 'no'}`);
  // Print top-10 biggest delta (added cross-refs)
  report.sort((a, b) => (b.after - b.before) - (a.after - a.before));
  console.log('\nTop 10 cross-ref deltas (after - before):');
  for (const r of report.slice(0, 10)) {
    console.log(`  ${r.before.toString().padStart(2)} → ${r.after.toString().padStart(2)}  ${r.slug}`);
  }
}

main();
