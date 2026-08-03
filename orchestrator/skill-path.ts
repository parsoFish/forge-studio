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
 *
 * `name` is ALWAYS slug-validated before it touches a path (R3-01-F4,
 * adversarial re-review, Blocker 1): a naive `join(skillsDir(root), name)`
 * lets an unvalidated `name` collapse the join (`'.'` resolves to `skillsDir`
 * itself), escape it (`'..'`, an absolute path), or open an orphan directory
 * `listSkillDirs` never discovers (`'sub/evil'`). Every current and future
 * caller of `skillDir`/`skillPath`/`skillPathRelative` inherits the guard —
 * this module is the one resolution point, so it is the one place the check
 * belongs.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The slug shape shared across every studio object id (agents, flows,
 * artifacts, KBs, skills, ...). Defined HERE — this module is a true leaf
 * (only `node:fs`/`node:path`) — and re-exported from
 * `orchestrator/studio/validate.ts` for its 20+ existing call sites.
 *
 * This definition used to live in `validate.ts` and be imported back into
 * this file, closing a `skill-path → validate → registry → skill-path`
 * cycle (registry.ts imports this module; validate.ts imports registry.ts).
 * It worked only because every cyclic import was consumed inside function
 * bodies, never at module top level — one future eager top-level call would
 * have reintroduced a TDZ crash for whichever module became the process
 * entry. Moving the definition to this leaf module removes the cycle
 * entirely rather than relying on that fragile invariant.
 */
export const SLUG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Hard cap on a skill id's length. Without this, a charset-valid but
 *  absurdly long id sails past the regex guard and dies later as a raw
 *  `ENAMETOOLONG` from `mkdir`/`writeFileSync` — an opaque OS error instead
 *  of an actionable validation message naming the actual limit. */
export const MAX_SKILL_ID_LENGTH = 100;

/** Reject any `name` that is not a bare slug component — no `/`, `\`, `.`,
 *  `..`, or empty string can ever reach a path join past this point — and no
 *  id longer than `MAX_SKILL_ID_LENGTH` characters. */
export function assertSkillSlug(name: string): void {
  if (name.length > MAX_SKILL_ID_LENGTH) {
    throw new Error(
      `invalid skill id "${name.slice(0, 40)}…" — ${name.length} characters exceeds the ${MAX_SKILL_ID_LENGTH}-character length limit for a skill id`,
    );
  }
  if (!SLUG_RE.test(name)) {
    throw new Error(
      `invalid skill id "${name}" — must match ${SLUG_RE} (a single lowercase-kebab path segment; no "/", "\\", ".", or "..")`,
    );
  }
}

/** The forge repo root — the parent of `orchestrator/`. */
export const FORGE_ROOT = resolve(import.meta.dirname, '..');

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
