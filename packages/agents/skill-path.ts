/**
 * Per-turn skill sections (R4-23, ADR-024) — the per-spawn half of what used
 * to be one 373-line `skill-path` module.
 *
 * M4-library PR 2 split that module three ways, because it was three things
 * wearing one name:
 *   - the id vocabulary and the ONE slug guard  → `@forge/kernel/ids.ts`
 *     (`orchestrator/studio/validate.ts` re-exported them to validate PROJECTS
 *     and KNOWLEDGE BASES, so they were never any one kind's);
 *   - the `skills/` tree layout                 → `@forge/library/skill-path.ts`
 *     (spec §3.1 gives library the Skill kind, and that is its on-disk shape);
 *   - per-turn prompt composition               → HERE, which is the
 *     "per-spawn runtime" spec §3.1 carves out to agents.
 *
 * Both moved groups are RE-EXPORTED below so this module's ~60 existing
 * importers — including `orchestrator/` and `cli/`, whose rows are baselined
 * against `agents` — need no edit. The re-export is a legal `agents → library`
 * / `agents → kernel` edge (PACKAGE_RANK: agents 3, library 2, kernel 1) over
 * code that genuinely MOVED; it is a transition affordance the wave-3 agents
 * lane may delete by repointing those importers, not a shim that greens a
 * boundary row while the code stays put.
 */
import { readFileSync } from 'node:fs';

import { skillPath } from '@forge/library/skill-path.ts';

/** The id vocabulary and the one slug guard — definition in `@forge/kernel`. */
export * from '@forge/kernel/ids.ts';
/** The `skills/` tree layout — definition in `@forge/library`. */
export * from '@forge/library/skill-path.ts';


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
 *  the same process (see AT-5 in `packages/agents/skill-turn-prompt.test.ts`). */
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
