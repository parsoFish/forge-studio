/**
 * Decompose-completeness check — R4-05-T4 (F6), NON-BLOCKING by explicit
 * operator decision (2026-07-17).
 *
 * The delivery gate (elsewhere) catches under-*delivery* (WIs planned but
 * not built); it cannot see under-*planning* — scope stated in the
 * initiative body but never decomposed into a work item at all (the
 * betterado residue: "core 2/7 WIs"). This module is the deterministic,
 * orchestrator-side check that flags that gap. It is a PURE function with
 * no I/O — `runOnePmPass` (`project-manager.ts`) calls it on the pass's
 * SUCCESS path and emits the `plan.completeness` event; this module never
 * throws and never gates anything.
 *
 * ## Body format (verified against the real corpus, not invented)
 *
 * The architect SKILL (`skills/architect/SKILL.md`) mandates the initiative
 * body carry "vision + GWT acceptance criteria" — Given/When/Then blocks,
 * or EARS notation as an alternative — with NO single pinned syntax. The
 * PM's own test suite (`project-manager-contract.test.ts`,
 * `cycle-pm-hallucination.test.ts`, `pm-turn-economy.test.ts`) exercises the
 * primary real shape: one or more comma-joined prose sentences under a
 * `## Acceptance criteria` heading —
 *   "Given a user is authenticated, when they request /api/health, then
 *   the response is 200."
 * — one sentence per stated unit, blank-line separated. `extractStatedUnits`
 * also recognises two secondary shapes that are equally real elsewhere in
 * this codebase: a multi-line Gherkin block (Given/When/Then each on their
 * own line, no commas) and the YAML-keyed `given:`/`when:`/`then:` triplet
 * (the shape `cli/architect-plan.ts`'s PLAN.html renderer already parses).
 *
 * ## Conservative-by-design
 *
 * This flag surfaces on the operator's attention strip (a later PR), so a
 * false positive is real cost. Three deliberate guards:
 *  1. An empty/unparseable body (no GWT/EARS shape found at all) returns
 *     `statedUnits: 0, flagged: false` — no guessing.
 *  2. The `### Not in scope` section (mandatory per the architect SKILL) is
 *     stripped before extraction — GWT-shaped phrasing describing what is
 *     deliberately NOT built must never count as an uncovered stated unit.
 *  3. Coverage matching is deliberately LENIENT (a low token-overlap bar) —
 *     when in doubt, a unit counts as covered. A unit with no significant
 *     content words (below the token-length/stopword floor) is treated as
 *     trivially covered rather than flagged.
 */

import type { WorkItem } from '../work-item.ts';

export type DecomposeCompletenessResult = {
  /** Count of GWT/EARS-shaped scope units found in the initiative body. */
  statedUnits: number;
  /** `statedUnits - uncovered.length`. */
  coveredUnits: number;
  /** The stated-unit texts with zero plausible WI coverage. */
  uncovered: string[];
  /** `true` iff `uncovered.length > 0`. NON-BLOCKING — advisory only. */
  flagged: boolean;
};

/**
 * Deterministic, pure completeness check. Never throws — a body that
 * doesn't parse into any recognisable scope unit yields the "nothing to
 * check" zero-result rather than an error.
 */
export function checkDecomposeCompleteness(
  body: string,
  items: ReadonlyArray<WorkItem>,
): DecomposeCompletenessResult {
  const units = extractStatedUnits(body);
  if (units.length === 0) {
    return { statedUnits: 0, coveredUnits: 0, uncovered: [], flagged: false };
  }

  const wiCorpora = items.map((item) => tokenize(workItemText(item)));
  const uncovered = units.filter((unit) => !isCovered(tokenize(unit), wiCorpora));

  return {
    statedUnits: units.length,
    coveredUnits: units.length - uncovered.length,
    uncovered,
    flagged: uncovered.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Bounded (non-catastrophic) match of a GWT unit — comma-joined prose,
 * multi-line Gherkin block, or YAML `given:`/`when:`/`then:` triplet — or an
 * EARS `WHEN … THE SYSTEM SHALL …` unit. The `{1,200}?` gaps are lazy AND
 * capped so the scan can never run away across the whole document; the
 * trailing lookahead stops each unit at the first sentence/paragraph/heading
 * boundary (or end of body).
 */
const STATED_UNIT_RE =
  /\bgiven\b[\s\S]{1,200}?\bwhen\b[\s\S]{1,200}?\bthen\b[\s\S]{1,200}?(?=[.!?]|\n\s*\n|\n#{1,6}\s|$)|\bwhen\b[\s\S]{1,150}?\bthe system shall\b[\s\S]{1,200}?(?=[.!?]|\n\s*\n|\n#{1,6}\s|$)/gi;

/** Strip fenced code blocks so embedded YAML/JSON samples are never mistaken for prose ACs. */
function stripCodeFences(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '');
}

/**
 * Strip the mandatory `### Not in scope` section (architect SKILL) before
 * extraction — guards against a GWT-shaped "this is NOT done" sentence there
 * being counted as a stated (and therefore guaranteed-uncovered) unit.
 */
function stripNotInScopeSection(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const isHeading = /^#{1,6}\s+/.test(trimmed);
    if (isHeading && /not in scope/i.test(trimmed)) {
      skipping = true;
      continue;
    }
    if (isHeading && skipping) skipping = false; // reached the next section
    if (!skipping) out.push(line);
  }
  return out.join('\n');
}

/** Extract the body's stated GWT/EARS scope units, deduped, in document order. */
function extractStatedUnits(rawBody: string): string[] {
  const body = stripNotInScopeSection(stripCodeFences(rawBody));
  const units: string[] = [];
  const seen = new Set<string>();
  STATED_UNIT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STATED_UNIT_RE.exec(body))) {
    const text = m[0].trim().replace(/\s+/g, ' ');
    if (text.length > 0 && !seen.has(text)) {
      seen.add(text);
      units.push(text);
    }
    if (m[0].length === 0) STATED_UNIT_RE.lastIndex++; // safety: never infinite-loop on a zero-width match
  }
  return units;
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/** Minimum content-word length — filters incidental short words without a large stopword list. */
const MIN_TOKEN_LEN = 4;

/** GWT/EARS structural keywords + common function words, excluded so they never inflate overlap. */
const STOPWORDS = new Set([
  'given', 'when', 'then', 'that', 'this', 'with', 'from', 'into', 'have',
  'will', 'shall', 'should', 'their', 'there', 'which', 'where', 'been',
  'being', 'were', 'what', 'also', 'such', 'than', 'only', 'more', 'most',
  'some', 'each', 'after', 'before', 'while', 'about', 'above', 'below',
  'under', 'over', 'both', 'same', 'very', 'just', 'once', 'here', 'system',
]);

/** Lenient token-overlap bar — deliberately low; see module doc §Conservative-by-design. */
const COVERAGE_RATIO_THRESHOLD = 0.34;
const COVERAGE_MIN_OVERLAP = 2;

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((t) => t.length >= MIN_TOKEN_LEN && !STOPWORDS.has(t)),
  );
}

function workItemText(item: WorkItem): string {
  const acText = item.acceptance_criteria.map((ac) => `${ac.given} ${ac.when} ${ac.then}`).join(' ');
  return `${acText} ${item.body} ${item.files_in_scope.join(' ')}`;
}

/**
 * A unit with no significant content words (below the token floor) is
 * treated as trivially covered — nothing meaningful to check, so it must
 * not become a false-positive flag. Otherwise: covered if ANY work item's
 * token set shares at least `COVERAGE_MIN_OVERLAP` significant tokens, or
 * at least `COVERAGE_RATIO_THRESHOLD` of the unit's tokens — whichever
 * fires first. Deliberately lenient (see module doc).
 */
function isCovered(unitTokens: Set<string>, wiCorpora: ReadonlyArray<Set<string>>): boolean {
  if (unitTokens.size === 0) return true;
  for (const wiTokens of wiCorpora) {
    let overlap = 0;
    for (const t of unitTokens) if (wiTokens.has(t)) overlap++;
    if (overlap >= COVERAGE_MIN_OVERLAP || overlap / unitTokens.size >= COVERAGE_RATIO_THRESHOLD) {
      return true;
    }
  }
  return false;
}
