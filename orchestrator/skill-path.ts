/**
 * The single shared skill-path resolver (R3-01-F1). Before this module, ~40
 * production sites hardcoded `skills/<name>/SKILL.md` path construction and two
 * independent readdir walks discovered the skills tree. Every skill lookup AND
 * enumeration now routes through here, so the physical `skills/` layout is a
 * one-place change (the known-gaps §6 precondition — the move itself is a
 * separate decision, NOT taken here).
 *
 * `skillPath` returns an ABSOLUTE path — use it for direct file reads
 * (`readFileSync`, `existsSync`, ...). `deriveAgentSpec('skills/<name>/SKILL.md')`
 * sites must instead use `skillPathRelative(name)`: its argument is echoed
 * verbatim into `PhaseAgentSpec.skill`, which is root-relative BY CONTRACT
 * (see `orchestrator/phase-agent.ts`) — an absolute path there would leak a
 * worktree-specific filesystem path into the portable, greppable event log.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** The forge repo root — the parent of `orchestrator/`. */
export const FORGE_ROOT = resolve(import.meta.dirname, '..');

/** The `skills/` directory under a given root (default: the real repo root).
 *  The one place the literal `skills` directory name is constructed. */
export function skillsDir(root: string = FORGE_ROOT): string {
  return join(root, 'skills');
}

/** Absolute path to a named skill's directory: `<root>/skills/<name>`. */
export function skillDir(name: string, root: string = FORGE_ROOT): string {
  return join(skillsDir(root), name);
}

/** Absolute path to a named skill's `SKILL.md`: `<root>/skills/<name>/SKILL.md`. */
export function skillPath(name: string, root: string = FORGE_ROOT): string {
  return join(skillsDir(root), name, 'SKILL.md');
}

/**
 * Root-relative path to a named skill's `SKILL.md`: `skills/<name>/SKILL.md`
 * — always relative, regardless of root. This is the string form
 * `deriveAgentSpec` requires: its `skill` argument is echoed verbatim into
 * `PhaseAgentSpec.skill`, which is root-relative BY CONTRACT (see
 * `orchestrator/phase-agent.ts` — it flows into event-log `agent_skill`
 * attribution, so it must stay a portable, greppable relative path, never an
 * absolute filesystem path). Use `skillPath()` (absolute) for direct file
 * reads instead.
 */
export function skillPathRelative(name: string): string {
  return join('skills', name, 'SKILL.md');
}

/**
 * The generic SKILL.md-bearing-subdirectory walk of ANY directory (used for both
 * the live `skills/` tree and the `studio/starters/agents/` template tree).
 * Returns absolute directory paths, sorted. Absent/unreadable dir ⇒ [].
 */
export function listSkillMdDirs(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  return names
    .map((n) => join(dir, n))
    .filter((d) => existsSync(join(d, 'SKILL.md')))
    .sort();
}

/** The skills-tree discovery walk: every skill directory under `<root>/skills/`
 *  that carries a `SKILL.md`. Parameterized by root (default: the real repo). */
export function listSkillDirs(root: string = FORGE_ROOT): string[] {
  return listSkillMdDirs(skillsDir(root));
}
