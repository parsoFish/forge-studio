/**
 * Seam F4 (operator item 81, ADR-039 generalisation) — read an agent
 * definition's OWN `SKILL.md` text.
 *
 * Every band binding (PM/dev-loop/reflector/adversarial-review) used to read
 * a hardcoded canonical path (`skillPath('project-manager')` etc.) for its
 * system prompt, regardless of which def the executing flow node actually
 * declared. That meant a second factory's own agent, put on a band station
 * via its own `composition.guards`/`loopStrategy: 'ralph'` declaration,
 * silently ran under the CANONICAL agent's identity instead of its own.
 *
 * `loadAgentSkillText` is the one place a band binding reads the text: always
 * from the passed-in def's own resolved `path` (`AgentDefinition.path` —
 * absolute, set at load time by `loadAgentDefinition`/the F1 multi-root
 * `skillPath`), never from a constant. No fallback (CLAUDE.md: no
 * fallbacks) — a def whose own file cannot be read throws, naming the def
 * and the path, rather than silently substituting any other SKILL.md.
 */
import { readFileSync } from 'node:fs';

import type { AgentDefinition } from '@forge/contracts';

export function loadAgentSkillText(def: AgentDefinition): string {
  try {
    return readFileSync(def.path, 'utf8');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`agent "${def.slug}" declares no readable SKILL.md at ${def.path}: ${detail}`);
  }
}
