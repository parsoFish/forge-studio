/**
 * composeProjectSkills (ADR 024 item 90) — fold a project's declared skills
 * (`@forge/projects/preflight-skills.ts`'s `loadDeclaredSkills`) into an
 * agent's system prompt, so `.forge/project.json`'s `skills[]` reaches every
 * agent that runs on the project instead of being a preflight-only fact
 * (`checkSkills`) nothing else ever reads.
 *
 * Pure: returns a NEW string (or `undefined`), never mutates `systemPrompt`
 * or `skills`. An empty list is a no-op — the prompt comes back
 * byte-identical (including `undefined` staying `undefined`) so every
 * existing spawn-capture golden fixture for a non-project-bound run is
 * unaffected.
 */

import type { DeclaredSkill } from '@forge/projects/preflight-skills.ts';

export type { DeclaredSkill };

const SECTION_HEADING = '## Project skills (declared in .forge/project.json)';

export function composeProjectSkills(
  systemPrompt: string | undefined,
  skills: readonly DeclaredSkill[],
): string | undefined {
  if (skills.length === 0) return systemPrompt;
  const body = skills.map((s) => `### ${s.id}\n\n${s.text.trim()}`).join('\n\n');
  const section = `${SECTION_HEADING}\n\n${body}`;
  return systemPrompt !== undefined ? `${systemPrompt}\n\n${section}` : section;
}
