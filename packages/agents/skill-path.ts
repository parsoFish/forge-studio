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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

/**
 * W7-A4 — the ONE id rule for projects and knowledge bases: the id IS the
 * on-disk directory name, case-preserving, matched exactly (see
 * `orchestrator/studio/validate.ts` for the full contract + the reserved-id
 * and reason helpers). Defined in this leaf for the same cycle reason as
 * SLUG_RE; `PROJECT_ID_RE`/`KB_ID_RE` are named aliases of one predicate so
 * a project and the KB bound to it can never disagree about legality.
 */
export const EXACT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
export const PROJECT_ID_RE = EXACT_ID_RE;
export const KB_ID_RE = EXACT_ID_RE;
/** Length cap shared by every project/KB id validator (one path segment). */
export const MAX_EXACT_ID_LENGTH = 128;

/**
 * Ids the UI reserves as static route segments (`/projects/new`, `/agents/new`,
 * `/flows/new`, `/skills/new`, `/hooks/new`, `/knowledge/new`). An object
 * literally named `new` would be permanently shadowed by the builder that lives
 * at that path (W7-A4, projects-30 / crosscut-20), so every create route refuses
 * it — case-insensitively, since slugs are lowercased at creation and a
 * case-preserving KB id `New` would still sit next to the static segment.
 */
export const RESERVED_OBJECT_IDS: ReadonlySet<string> = new Set(['new']);

export function isReservedId(id: string): boolean {
  return RESERVED_OBJECT_IDS.has(id.toLowerCase());
}

/** Hard cap on a skill id's length. Without this, a charset-valid but
 *  absurdly long id sails past the regex guard and dies later as a raw
 *  `ENAMETOOLONG` from `mkdir`/`writeFileSync` — an opaque OS error instead
 *  of an actionable validation message naming the actual limit. */
export const MAX_SKILL_ID_LENGTH = 100;

/** The slug rule as PLAIN PROSE + the bare pattern source (no leading `/`):
 *  `sanitizeError` (cli/bridge-studio.ts) redacts every `/…` token from
 *  bridge error strings, and a RegExp literal's own `/^…$/` was being eaten
 *  into `[path]:-[a-z0-9]+)*$/` on the wire (walkthrough library-13). */
export const SLUG_RULE_TEXT = `a single lowercase-kebab path segment matching ${SLUG_RE.source} (lowercase letters, digits and hyphens); no "/", "\\", ".", or ".."`;

/** Reject any `name` that is not a bare slug component — no `/`, `\`, `.`,
 *  `..`, or empty string can ever reach a path join past this point — and no
 *  id longer than `MAX_SKILL_ID_LENGTH` characters. `noun` names the object
 *  kind in the message (skill / hook / connection / community item) — the
 *  same rule guards every file-package id, so the caller supplies the word
 *  the operator will read (library-13: a hooks route used to say "invalid
 *  skill id"). Additive-optional (ADR 042: disclose-not-park). */
export function assertSkillSlug(name: string, noun: string = 'skill'): void {
  if (name.length > MAX_SKILL_ID_LENGTH) {
    throw new Error(
      `invalid ${noun} id "${name.slice(0, 40)}…" — ${name.length} characters exceeds the ${MAX_SKILL_ID_LENGTH}-character length limit for a ${noun} id`,
    );
  }
  if (!SLUG_RE.test(name)) {
    throw new Error(
      `invalid ${noun} id "${name}" — must be ${SLUG_RULE_TEXT}`,
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

// ---------------------------------------------------------------------------
// R4-23 — per-turn skill sections (ADR-024 artifact migration)
// ---------------------------------------------------------------------------
//
// A `SKILL.md` may carry named per-turn sections, each introduced by an
// HTML-comment marker on its own line: `<!-- turn: <id> -->` (id shape
// `[a-z0-9][a-z0-9-]*`). Everything before the first marker is the shared
// `base` (frontmatter + identity/contract prose); everything from a marker
// to the next marker (or EOF) is that turn's section body. Marker lines
// themselves are machine punctuation — they never appear in `base` or in any
// section body, so the composed prompt reads as ordinary prose.
//
// This lets a runner that drives a multi-turn agent (interview, draft, ...)
// keep exactly ONE copy of that agent's task instructions — in `SKILL.md`,
// the single source of intent (ADR-024) — instead of duplicating a
// hand-written prose prompt in TypeScript alongside it.

/** Matches a turn-marker line in isolation: `<!-- turn: <id> -->`, optionally
 *  padded with whitespace inside the comment or trailing the line. */
const TURN_MARKER_RE = /^<!--\s*turn:\s*([a-z0-9][a-z0-9-]*)\s*-->\s*$/;

/** A line that LOOKS like a turn marker (has `<!--` ... `turn:` ... `-->` on
 *  one line) but does not match `TURN_MARKER_RE` — e.g. an uppercase or
 *  underscore id. Used only to make a "no turn sections" / "no turn X"
 *  fail-loud message diagnosable: without this, an operator staring at "no
 *  turn markers" has no clue a malformed one sits two lines away. */
const NEAR_MISS_MARKER_RE = /<!--\s*turn:[^>]*-->/;

/** A fenced-code-block delimiter line (```` ``` ```` or `~~~`, optionally
 *  indented and/or followed by a language tag). Markdown-authors sometimes
 *  document the turn-marker SYNTAX inside a fence (e.g. to show an example in
 *  prose) — a marker written there is example text, not a real section
 *  boundary, so marker parsing is suspended while inside a fence. */
const FENCE_TOGGLE_RE = /^\s*(`{3,}|~{3,})/;

/** Drop trailing blank (whitespace-only) lines so composing `base + '\n\n' +
 *  section` never accumulates run-away blank lines between them. */
function joinTrimmingTrailingBlankLines(lines: string[]): string {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') end--;
  return lines.slice(0, end).join('\n');
}

/** Lines in `text` that look like a turn marker but don't match the strict
 *  marker shape — named verbatim in a fail-loud message so a malformed
 *  marker is diagnosable rather than silently invisible. */
function findNearMissMarkers(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  const found: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (NEAR_MISS_MARKER_RE.test(trimmed) && !TURN_MARKER_RE.test(trimmed)) {
      found.push(trimmed);
    }
  }
  return found;
}

/**
 * Pure split of a `SKILL.md` text into its shared preamble (`base`) and any
 * named `<!-- turn: id -->` sections. Exported for direct tests.
 *
 * A doc with NO turn markers at all yields `{ base: text, turns: new Map() }`
 * — `base` is returned byte-for-byte (no trimming), since there is nothing to
 * split off; callers (see `loadSkillTurnPrompt`) treat an empty `turns` map
 * as "this skill has not been migrated to turn sections" and fail loud rather
 * than silently treating the whole doc as one anonymous section.
 */
export function splitSkillTurnSections(text: string): { base: string; turns: Map<string, string> } {
  // CRLF-safe line split: `\r\n` (and a lone `\r`) are consumed as the line
  // separator here, so no line — base or section — ever carries a trailing
  // `\r` into the composed prompt (R2-AT-7).
  const lines = text.split(/\r\n|\r|\n/);
  const turns = new Map<string, string>();
  const baseLines: string[] = [];
  let currentId: string | null = null;
  let currentLines: string[] = [];
  let sawMarker = false;
  let inFence = false;

  const flushCurrentSection = () => {
    if (currentId !== null) {
      // R2-AT-4: a repeated `<!-- turn: x -->` must be refused, never
      // silently last-write-wins over the first section's content.
      if (turns.has(currentId)) {
        throw new Error(
          `splitSkillTurnSections: duplicate turn id "${currentId}" — this SKILL.md declares ` +
            `<!-- turn: ${currentId} --> more than once. Each turn id must be unique.`,
        );
      }
      turns.set(currentId, joinTrimmingTrailingBlankLines(currentLines));
    }
  };

  for (const line of lines) {
    // A fence delimiter is ordinary content either way — push it to whichever
    // bucket is currently open — but it toggles fence state FIRST so a marker
    // documented inside the fence (R2-AT-5) is never parsed as a boundary.
    if (FENCE_TOGGLE_RE.test(line)) {
      inFence = !inFence;
      if (currentId === null) baseLines.push(line);
      else currentLines.push(line);
      continue;
    }
    const marker = inFence ? null : TURN_MARKER_RE.exec(line);
    if (marker) {
      sawMarker = true;
      flushCurrentSection();
      currentId = marker[1];
      currentLines = [];
    } else if (currentId === null) {
      baseLines.push(line);
    } else {
      currentLines.push(line);
    }
  }
  flushCurrentSection();

  if (!sawMarker) {
    return { base: text, turns: new Map() };
  }
  return { base: joinTrimmingTrailingBlankLines(baseLines), turns };
}

/** Cache of default-path reads, keyed by the RESOLVED ABSOLUTE path. An
 *  explicit `skillPromptPath` override (the runners' test/DI seam) is never
 *  read from or written into this cache — each override read must reflect
 *  exactly the fixture it names, independent of any other fixture read in
 *  the same process (see AT-5 in `orchestrator/skill-turn-prompt.test.ts`). */
const defaultPathSkillCache = new Map<string, string>();

/**
 * The composed per-turn skill prompt: the skill's `base` preamble + a blank
 * line + the named turn section's body.
 *
 * FAILS LOUD — never falls back — when the file is unreadable, when it
 * carries zero turn sections, or when `turnId` is not among the sections it
 * does carry. Every runner-private `loadSkillPrompt` this replaces used to
 * fail OPEN: `catch { return 'You are the forge <x> agent.' }`. That was
 * survivable back when the skill file was only a shared preamble and the
 * real task instructions lived in a hand-written TypeScript prompt appended
 * after it — a missing/unreadable skill just lost some flavour text. After
 * the R4-23 migration the TASK INSTRUCTIONS live in `SKILL.md` itself (one
 * turn section per step), so a fail-open fallback here would silently launch
 * an agent with NO task at all and no signal that anything went wrong — the
 * declared-data-fails-open antipattern. Throwing with the skill name, the
 * requested turn id, and (for an unknown id) the ids that ARE available
 * turns a silent no-op agent run into an immediate, diagnosable crash.
 */
export function loadSkillTurnPrompt(args: {
  /** Skill dir slug, e.g. `'instructions-creator'`. Named in every thrown message. */
  name: string;
  /** The turn section to select, e.g. `'interview'` / `'draft'`. */
  turnId: string;
  /** Test/DI override (the runners' existing field) — bypasses the default
   *  `skills/<name>/SKILL.md` lookup AND its cache entirely. */
  skillPromptPath?: string;
  /** Forge root; defaults to `FORGE_ROOT` (this module's real repo root). */
  root?: string;
}): string {
  const { name, turnId, skillPromptPath, root } = args;
  const isDefaultPath = skillPromptPath === undefined;
  const resolvedPath = skillPromptPath ?? skillPath(name, root);

  let text: string;
  if (isDefaultPath && defaultPathSkillCache.has(resolvedPath)) {
    text = defaultPathSkillCache.get(resolvedPath)!;
  } else {
    try {
      text = readFileSync(resolvedPath, 'utf8');
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `loadSkillTurnPrompt: could not read skill "${name}" (turn "${turnId}") at ${resolvedPath}: ${reason}`,
      );
    }
    if (isDefaultPath) defaultPathSkillCache.set(resolvedPath, text);
  }

  const { base, turns } = splitSkillTurnSections(text);
  if (turns.size === 0) {
    // R2-AT-6: a marker-LIKE line (wrong id shape — uppercase, underscore, …)
    // is not silently indistinguishable from "no marker at all" — name it, so
    // the operator isn't told "no turns available" while one sits two lines
    // away, malformed.
    const nearMiss = findNearMissMarkers(text);
    const nearMissNote = nearMiss.length
      ? ` Found a marker-like line that does not match the required <!-- turn: <id> --> shape: ${nearMiss.join('; ')}.`
      : '';
    throw new Error(
      `loadSkillTurnPrompt: skill "${name}" (${resolvedPath}) carries no <!-- turn: ... --> sections — ` +
        `requested turn "${turnId}".${nearMissNote} Add turn markers to the skill before driving it per-turn.`,
    );
  }
  const section = turns.get(turnId);
  if (section === undefined) {
    const available = [...turns.keys()].sort().join(', ');
    const nearMiss = findNearMissMarkers(text);
    const nearMissNote = nearMiss.length
      ? ` Found a marker-like line that does not match the required <!-- turn: <id> --> shape: ${nearMiss.join('; ')}.`
      : '';
    throw new Error(
      `loadSkillTurnPrompt: skill "${name}" (${resolvedPath}) has no turn "${turnId}" — available turns: ${available}.${nearMissNote}`,
    );
  }
  return `${base}\n\n${section}`;
}
