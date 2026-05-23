/**
 * brain-index-hub — Stage 4 of brain-refinement-2026-05-23.
 *
 * Replaces (or adds) a "## All themes (wikilink hub)" section in brain/INDEX.md
 * listing every theme as [[slug]] grouped by sub-wiki. Creates a single
 * high-degree hub node so future LLM-backed graphify passes (Stage 5) have
 * a structural anchor to connect themes through.
 *
 * Idempotent. Reruns produce the same output.
 *
 * Run: `node --experimental-strip-types scripts/brain-index-hub.ts`
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const FORGE = '/home/parso/forge';
const INDEX = join(FORGE, 'brain/INDEX.md');

function listThemes(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith('.md') && n !== 'README.md')
    .map((n) => basename(n, '.md'))
    .sort();
}

function build(): string {
  const lines: string[] = [];
  lines.push('## All themes (wikilink hub)');
  lines.push('');
  lines.push('A wikilink-style hub block listing every theme — gives the graph a');
  lines.push('high-degree connector node so LLM-backed semantic extraction (C20-C22)');
  lines.push('can route cross-cluster relationships through INDEX. Maintained by');
  lines.push('`scripts/brain-index-hub.ts`.');
  lines.push('');

  // forge themes
  const forgeSlugs = listThemes(join(FORGE, 'brain/forge/themes'));
  lines.push('### forge/themes/');
  lines.push('');
  lines.push(forgeSlugs.map((s) => `[[${s}]]`).join(' · '));
  lines.push('');

  // projects
  const projectsDir = join(FORGE, 'brain/projects');
  const projects = readdirSync(projectsDir)
    .filter((n) => {
      try {
        return statSync(join(projectsDir, n)).isDirectory();
      } catch { return false; }
    })
    .sort();

  for (const proj of projects) {
    const tdir = join(projectsDir, proj, 'themes');
    const slugs = listThemes(tdir);
    if (slugs.length === 0) continue;
    lines.push(`### projects/${proj}/themes/`);
    lines.push('');
    lines.push(slugs.map((s) => `[[${s}]]`).join(' · '));
    lines.push('');
  }

  return lines.join('\n');
}

function main() {
  const raw = readFileSync(INDEX, 'utf8');
  const hubBlock = build();
  const marker = '\n## All themes (wikilink hub)\n';

  let out: string;
  if (raw.includes(marker)) {
    // Replace existing block — until next H2 or EOF
    const startIdx = raw.indexOf(marker) + 1; // keep leading newline
    const after = raw.slice(startIdx + marker.length - 1);
    const next = after.search(/\n##\s+/);
    const trailing = next === -1 ? '' : after.slice(next);
    out = raw.slice(0, startIdx) + hubBlock + trailing;
  } else {
    // Append at end with separating newline
    const trimmed = raw.replace(/\s+$/, '');
    out = `${trimmed}\n\n${hubBlock}\n`;
  }

  writeFileSync(INDEX, out, 'utf8');
  console.log(`INDEX.md updated with ${(hubBlock.match(/\[\[/g) ?? []).length} wikilinks.`);
}

main();
