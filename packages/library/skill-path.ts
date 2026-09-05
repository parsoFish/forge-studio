/**
 * The `skills/` tree layout — the ONE place the literal `skills` directory
 * name is constructed, and the one resolution point every skill lookup and
 * enumeration in the product goes through.
 *
 * MOVED VERBATIM from `packages/agents/skill-path.ts` (M4-library PR 2). Spec
 * §3.1 gives library the Skill kind, and this is that kind's on-disk layout;
 * `agents`, `sessions`, `flows` and `factory` all rank above library
 * (`scripts/check-boundaries.mjs:47`) and may import it. What STAYED in
 * agents is `splitSkillTurnSections`/`loadSkillTurnPrompt` — per-turn prompt
 * composition, which is the per-spawn runtime the spec carves out to agents.
 * What went to `@forge/kernel` is the id vocabulary and the slug guard, which
 * `orchestrator/studio/validate.ts` re-exported to validate projects and KBs (that file is gone; the four validators are package-owned since ruling 159).
 *
 * `skillPath` returns an ABSOLUTE path — use it for direct file reads.
 * `deriveAgentSpec('skills/<name>/SKILL.md')` sites must instead use
 * `skillPathRelative(name)`: its argument is echoed verbatim into
 * `PhaseAgentSpec.skill`, which is root-relative BY CONTRACT, so an absolute
 * path there would leak a worktree-specific filesystem path into the
 * portable, greppable event log.
 *
 * `name` is ALWAYS slug-validated before it touches a path (R3-01-F4,
 * adversarial re-review, Blocker 1): a naive `join(skillsDir(root), name)`
 * lets an unvalidated `name` collapse the join (`'.'` resolves to `skillsDir`
 * itself), escape it (`'..'`, an absolute path), or open an orphan directory
 * `listSkillDirs` never discovers (`'sub/evil'`). The guard is kernel's ONE
 * definition, composed here — never re-implemented.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { FORGE_ROOT, assertSkillSlug } from '@forge/kernel/ids.ts';
import { guardedFile } from '@forge/kernel';

/** The `skills/` directory under a given root (default: the real repo root).
 *  The one place the literal `skills` directory name is constructed. */
export function skillsDir(root: string = FORGE_ROOT): string {
  return join(root, 'skills');
}

/** Absolute path to a named skill's directory: `<root>/skills/<name>`. */
export function skillDir(name: string, root: string = FORGE_ROOT): string {
  assertSkillSlug(name);
  return join(skillsDir(root), name);
}

/** Absolute path to a named skill's `SKILL.md`: `<root>/skills/<name>/SKILL.md`. */
export function skillPath(name: string, root: string = FORGE_ROOT): string {
  assertSkillSlug(name);
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
  assertSkillSlug(name);
  return join('skills', name, 'SKILL.md');
}

/**
 * The CONTAINED form of `skillPath` — the one every READ should use.
 *
 * `skillPath` above composes a LAYOUT: it answers "where would this skill's
 * SKILL.md live", and `assertSkillSlug` makes that answer well-formed. It is
 * not, and never was, a containment check — it validates the id's CHARSET and
 * nothing about the filesystem, so a symlink planted at `skills/<id>`, or a
 * symlinked `SKILL.md` leaf inside an ordinary `skills/<id>/`, is lexically
 * inside `skills/` and resolves anywhere. Several call sites read through
 * `skillPath` and were redirected by exactly that (COMMON §15.19).
 *
 * Returns the guard's own `realPath`, or `null` when the file is missing OR
 * the path escapes — `guardedFile` collapses those two deliberately, so this
 * cannot become an existence oracle across the root.
 *
 * The two live side by side ON PURPOSE: a reader reaching for `skillPath` to
 * open a file meets this one immediately below it.
 */
export function guardedSkillMdPath(name: string, root: string = FORGE_ROOT): string | null {
  assertSkillSlug(name);
  return guardedFile(skillsDir(root), [name, 'SKILL.md'], 'read');
}

/**
 * The generic SKILL.md-bearing-subdirectory walk of ANY directory (used for both
 * the live `skills/` tree and the `studio/starters/agents/` template tree).
 * Returns absolute directory paths, sorted. Absent/unreadable dir ⇒ [].
 *
 * The `SKILL.md` probe rides the containment guard, LEAF INCLUDED.
 * `Dirent.isDirectory()` above already excludes a symlinked DIRECTORY, but
 * `existsSync` FOLLOWS a symlinked LEAF — so an ordinary `skills/<id>/` holding
 * a symlinked `SKILL.md` passed discovery, and every consumer then read the
 * link's target. That is wire-reachable through `GET /api/studio/skills`, which
 * enumerates ids FROM this walk and therefore cannot pre-guard them: the check
 * has to live here. Found by the independent security review of the
 * approve/repin fix, which is why it ships in that fix's own PR.
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
    .filter((n) => guardedFile(dir, [n, 'SKILL.md'], 'read') !== null)
    .map((n) => join(dir, n))
    .sort();
}

/** The skills-tree discovery walk: every skill directory under `<root>/skills/`
 *  that carries a `SKILL.md`. Parameterized by root (default: the real repo). */
export function listSkillDirs(root: string = FORGE_ROOT): string[] {
  return listSkillMdDirs(skillsDir(root));
}
