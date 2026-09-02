/**
 * Plain composable skills (skills/<slug>/SKILL.md with NO runtime block) —
 * library's own Skill kind, split out of `orchestrator/studio/registry.ts`
 * (M4 library-by-kind carve, PR 3 / Part 2).
 *
 * MOVED VERBATIM — `listPlainSkills` (registry.ts:300-324 on the pre-carve
 * head). The Agent kind (SKILL.md WITH a `runtime` block — `isStudioAgent`,
 * `loadAgentDefinition`, `listAgentDefinitions`) is a different kind (spec
 * §3.1 gives it to `agents`) and stays in `registry.ts`.
 */

import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import matter from 'gray-matter';

import { listSkillDirs } from '../skill-path.ts';
import { skillTrustState } from './skill-trust.ts';

/** Plain composable skills (skills/<slug>/SKILL.md with NO runtime block AND not
 *  library:false) — the filesystem half of the unified skill library (R3-01-F2).
 *  Studio agents (runtime-bearing) are the agent roster, not palette skill chips;
 *  a plain skill opting out with library:false is hidden from the palette too.
 *  R3-01-F3/F4: a `draft` or `needs-review` skill is ALSO excluded — this is the
 *  palette enforcement point for the trust pipeline (skillTrustState); do not
 *  add a second, divergent copy of this rule anywhere else. */
export function listPlainSkills(forgeRoot: string): { id: string; name: string; desc?: string }[] {
  const out: { id: string; name: string; desc?: string }[] = [];
  for (const dir of listSkillDirs(forgeRoot)) {
    const skillMdPath = join(dir, 'SKILL.md');
    try {
      const { data } = matter(readFileSync(skillMdPath, 'utf8'));
      const d = (data ?? {}) as Record<string, unknown>;
      if ('runtime' in d) continue;                     // runtime block ⇒ a studio agent, not a plain skill
      if (d['library'] === false) continue;             // library:false ⇒ plain skill opted out of the palette (R3-01-F2)
      const id = basename(dir);
      if (skillTrustState(forgeRoot, id) !== 'ready') continue; // draft/needs-review ⇒ not palette-visible (R3-01-F3/F4)
      const name = typeof d['name'] === 'string' && d['name'] ? d['name'] as string : id;
      const desc = typeof d['description'] === 'string' ? d['description'] as string : undefined;
      out.push({ id, name, desc });
    } catch { /* unreadable/malformed ⇒ skip */ }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
