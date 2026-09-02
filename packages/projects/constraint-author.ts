/**
 * authorConstraintBlocks (R4-02-F5) — the onboarding agent authors a project's
 * locked-core constraints as a LIVE `forge:constraint` block (ADR-037) in the
 * CENTRAL profile.md, so the plan agent (R4-05-F3) injects them verbatim into
 * every matching work item's spec.
 *
 * `buildProfileMd`'s seeded stub carries only an HTML-escaped, inert EXAMPLE —
 * a fresh onboard produces zero live clauses. This fills the source side: read
 * the project's declared constraints (a CONSTRAINTS.md, or a Locked-core /
 * Constraints / Never-do section of CLAUDE.md / AGENTS.md), wrap them in one
 * `applies_to: all` block, upsert it under a stable marker section, and VALIDATE
 * the whole profile via `parseConstraintBlocks` before writing — a malformed or
 * duplicate-id block fails loudly here, not silently at the next plan run.
 *
 * When the project declares no constraints source it is a no-op (authored: []):
 * an untagged profile still compiles under the ADR-037 default.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { projectBrainDir } from '@forge/kernel';
import { parseConstraintBlocks } from './constraint-blocks.ts';

/** Heading that delimits the section this authorer owns — replaced wholesale on
 *  each run so re-authoring is idempotent (no duplicate ids, no accretion). */
const LIVE_MARKER = '## Live constraints (authored by onboarding)';

export type ConstraintAuthorResult = {
  profilePath: string;
  /** Ids authored into profile.md ([] when the project declares no constraints). */
  authored: string[];
  /** Where the constraints came from (repo-relative), or null. */
  source: string | null;
};

/** Extract a project's constraints text: a dedicated CONSTRAINTS.md, else the
 *  Locked-core / Constraints / Never-do section of CLAUDE.md / AGENTS.md. */
export function extractConstraintsSource(projectDir: string): { text: string; source: string } | null {
  const dedicated = join(projectDir, 'CONSTRAINTS.md');
  if (existsSync(dedicated)) {
    const text = readFileSync(dedicated, 'utf8').trim();
    if (text) return { text, source: 'CONSTRAINTS.md' };
  }
  for (const file of ['CLAUDE.md', 'AGENTS.md']) {
    const p = join(projectDir, file);
    if (!existsSync(p)) continue;
    const section = extractSection(readFileSync(p, 'utf8'));
    if (section) return { text: section, source: `${file} (constraints section)` };
  }
  return null;
}

/** The first heading matching locked/constraints/never, up to the next
 *  same-or-higher heading. Returns null when no such section exists. */
function extractSection(md: string): string | null {
  const lines = md.split('\n');
  const startIdx = lines.findIndex((l) => /^#{1,6}\s+(locked|constraints?|never\b)/i.test(l));
  if (startIdx < 0) return null;
  const level = lines[startIdx].match(/^#+/)?.[0].length ?? 1;
  const out: string[] = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^#+/);
    if (m && m[0].length <= level) break; // next same/higher heading ends the section
    out.push(lines[i]);
  }
  const text = out.join('\n').trim();
  return text || null;
}

export function authorConstraintBlocks(input: {
  projectDir: string;
  forgeRoot: string;
  project: string;
}): ConstraintAuthorResult {
  const profilePath = join(projectBrainDir(input.forgeRoot, input.project), 'profile.md');
  const existing = existsSync(profilePath) ? readFileSync(profilePath, 'utf8') : '';
  // Everything the authorer owns lives under LIVE_MARKER — strip it so re-runs
  // replace rather than accrete; operator-authored blocks above it are kept.
  const before = existing.includes(LIVE_MARKER)
    ? existing.slice(0, existing.indexOf(LIVE_MARKER)).trimEnd()
    : existing.trimEnd();

  const src = extractConstraintsSource(input.projectDir);
  if (!src) {
    // Nothing to tag. Validate the (unchanged) profile compiles, then no-op.
    parseConstraintBlocks(before, profilePath);
    return { profilePath, authored: [], source: null };
  }

  const id = `${input.project}-locked-core`;
  const block = [`<!-- forge:constraint id: ${id} applies_to: all -->`, src.text, '<!-- /forge:constraint -->'].join('\n');
  const next = `${before}\n\n${LIVE_MARKER}\n\n${block}\n`;
  // Validate the WHOLE resulting profile BEFORE writing — a malformed authored
  // block, or a duplicate id colliding with an operator block, throws here.
  parseConstraintBlocks(next, profilePath);
  writeFileSync(profilePath, next, 'utf8');
  return { profilePath, authored: [id], source: src.source };
}
