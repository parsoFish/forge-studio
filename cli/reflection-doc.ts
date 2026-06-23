/**
 * reflection-doc.ts — parse a reflector-written retro.md into the structured
 * ReflectionDoc shape consumed by the M4 artifact viewer (ReflectionRenderer).
 *
 * The agent writes a free-form retro.md with these sections (not all always
 * present):
 *   ## Self-reflection
 *   ### Patterns observed  (or  ### Observation N — ...)
 *   ### Quality signal     (→ went-well items)
 *   ### Cost + iteration   (→ stats, not surfaced in doc)
 *   ## User questions
 *   ## User feedback
 *
 * Mapping to ReflectionDoc:
 *   wentWell        ← "Quality signal" bullet points + any explicit "went well" phrases
 *   friction        ← "AP" (antipattern) bullets + any "failed" / "friction" observations
 *   lessons         ← pattern paragraphs (P1, P2, … / Observation N), each trimmed to
 *                     one sentence; target = the first matching fresh-theme slug
 *   inconsistencies ← empty (the reflector does not produce these)
 *
 * Target matching: a lesson's `target` is set to the slug from freshThemeSlugs[]
 * whose slug text appears (lowercased, hyphen-to-space) in the lesson text.
 * This is a best-effort heuristic — the reflector names themes after the
 * pattern they codify, so slug keywords reliably appear in the pattern prose.
 *
 * Pure function — no filesystem access. Caller is orchestrator/phases/reflector.ts
 * which calls writeReflectionDoc() after the agent exits.
 */

/** Mirror of forge-ui/components/studio/artifact/ReflectionRenderer.tsx types. */
export type ReflectionLesson = {
  text: string;
  /** KB node slug — the theme the lesson links to (→ /knowledge?id=<target>). */
  target?: string;
};

export type ReflectionDoc = {
  wentWell?: string[];
  friction?: string[];
  lessons?: ReflectionLesson[];
  inconsistencies?: string[];
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a retro.md string into a ReflectionDoc.
 *
 * @param raw             Content of retro.md as written by the reflector agent.
 * @param freshThemeSlugs Slugs (no .md extension) of themes written this cycle,
 *                        used to populate lesson.target. Pass [] if unavailable.
 */
export function parseRetroMd(raw: string, freshThemeSlugs: string[] = []): ReflectionDoc {
  const sections = splitTopLevelSections(raw);

  const lessons  = extractLessons(sections, freshThemeSlugs);
  const wentWell = extractWentWell(sections);
  const friction = extractFriction(sections);

  return {
    wentWell:        wentWell.length  > 0 ? wentWell  : undefined,
    friction:        friction.length  > 0 ? friction  : undefined,
    lessons:         lessons.length   > 0 ? lessons   : undefined,
    inconsistencies: undefined,
  };
}

// ---------------------------------------------------------------------------
// Section splitting
// ---------------------------------------------------------------------------

type Section = { heading: string; level: number; body: string };

/**
 * Split the raw markdown into a flat list of {heading, level, body} objects.
 * We look for `##` and `###` headings only — `#` is the document title and
 * `####` is rare prose nesting that we don't want to split on.
 */
function splitTopLevelSections(raw: string): Section[] {
  const out: Section[] = [];
  // Split on lines that start a ## or ### heading.
  const chunks = raw.split(/^(?=#{2,3} )/m);
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    const firstNl = chunk.indexOf('\n');
    if (firstNl === -1) continue;
    const headingLine = chunk.slice(0, firstNl).trim();
    const body = chunk.slice(firstNl + 1);
    const m = headingLine.match(/^(#{2,3})\s+(.+)$/);
    if (!m) continue;
    out.push({ heading: m[2].trim(), level: m[1].length, body });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lesson extraction — Pattern / Observation paragraphs
// ---------------------------------------------------------------------------

/**
 * Patterns (P1, P2, AP1, …) and Observations (Observation N) are the core
 * lesson carriers. Each ### section that looks like a pattern/observation
 * becomes one ReflectionLesson.
 *
 * We also extract inline "**P1 — …**" bold-label paragraphs from longer
 * sections (some retros list multiple patterns in one ###).
 */
function extractLessons(sections: Section[], slugs: string[]): ReflectionLesson[] {
  const out: ReflectionLesson[] = [];
  const seen = new Set<string>();

  function add(text: string): void {
    const trimmed = firstSentence(text);
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push({ text: trimmed, target: matchTarget(trimmed, slugs) });
  }

  for (const s of sections) {
    // Section headings that are themselves pattern labels
    if (isPatternHeading(s.heading)) {
      // Use the heading text as the lesson label, body as detail.
      const label = cleanPatternLabel(s.heading);
      const detail = s.body.trim().split(/\n\n/)[0]?.trim() ?? '';
      add(label + (detail ? ` — ${detail}` : ''));
      continue;
    }

    // Current format (reflector SKILL Stage-1): "### Patterns / antipatterns"
    // with "- **label**: detail" bullets — the core lesson carrier.
    if (/patterns?\s*\/\s*antipatterns?|^antipatterns?$/i.test(s.heading)) {
      for (const e of extractBoldLabelBullets(s.body)) add(e);
      continue;
    }

    // Legacy "### Patterns observed" / "### Observations" — body has inline entries
    if (isPatternContainerHeading(s.heading)) {
      const entries = extractInlinePatternEntries(s.body);
      for (const e of entries) add(e);
      continue;
    }

    // Any ### section whose body has inline bold-pattern lines
    const inlineEntries = extractInlinePatternEntries(s.body);
    for (const e of inlineEntries) add(e);
  }

  return out;
}

/**
 * A heading is a pattern/observation if it looks like:
 *   "Observation 1 — ..."   "P1 — ..."   "AP1 — ..."
 */
function isPatternHeading(h: string): boolean {
  return /^(Observation\s+\d+|P\d+|AP\d+)\s*[—–-]/i.test(h);
}

function isPatternContainerHeading(h: string): boolean {
  return /patterns?\s+observed|observations?/i.test(h);
}

function cleanPatternLabel(h: string): string {
  // "Observation 3 — Vendor patch required …" → full heading text (already readable)
  return h.replace(/^(Observation\s+\d+|P\d+|AP\d+)\s*[—–-]\s*/i, '').trim();
}

/**
 * Scan a body for inline bold-labelled pattern lines:
 *   "**P1 — Resume-already-complete …**"
 *   "**Lesson**: any ADO numeric …"
 *
 * Returns the text after the label (the description).
 */
function extractInlinePatternEntries(body: string): string[] {
  const out: string[] = [];
  // Match **P1 — …** or **AP1 — …** or **Lesson**: … patterns
  const re = /\*\*(P\d+|AP\d+)\s*[—–-]\s*([^*]+)\*\*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const text = m[2].trim();
    if (text) out.push(text);
  }
  // Also match standalone "**Lesson**: <text>" paragraphs (no trailing **)
  const lessonRe = /\*\*Lesson\*\*:\s*(.+?)(?:\n\n|\n(?=\s*\n)|\n(?=#{2,})|$)/gs;
  while ((m = lessonRe.exec(body)) !== null) {
    const text = m[1].replace(/\s+/g, ' ').trim();
    if (text) out.push(text);
  }
  return out;
}

/**
 * Scan a body for the CURRENT retro bullet form — a bold-labelled list item:
 *   "- **Excellent TDD execution**: each WI followed red→green …"
 *   "1. **`git add` retry antipattern**: occurred in all 4 WIs …"
 * (the reflector SKILL Stage-1 format: `### Repeated actions` / `### Roadblocks
 * / wedges` / `### Patterns / antipatterns` with `- **label**: detail` bullets).
 * Returns "label — detail" (or just the label when there is no detail).
 */
function extractBoldLabelBullets(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:[-*]|\d+\.)\s+\*\*(.+?)\*\*\s*[:—–-]?\s*(.*)$/);
    if (!m) continue;
    const label = m[1].replace(/`/g, '').trim();
    const detail = m[2].replace(/`/g, '').trim();
    const text = detail ? `${label} — ${detail}` : label;
    if (text) out.push(text);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Went-well extraction
// ---------------------------------------------------------------------------

/**
 * "Went well" items come from:
 *   1. A "Quality signal" section — bullet points and "green" statements
 *   2. Explicit positive outcomes in other sections (heuristic)
 */
function extractWentWell(sections: Section[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const s of sections) {
    if (!/quality\s+signal|went[\s-]+well|outcome|delivery/i.test(s.heading)) continue;
    // Extract bullet points
    for (const line of s.body.split(/\r?\n/)) {
      const m = line.match(/^\s*[-*]\s+(.+)$/);
      if (!m) continue;
      const text = m[1].replace(/\*\*/g, '').trim();
      if (!text || seen.has(text)) continue;
      // Skip lines that read like friction/failure items
      if (/fail|error|crash|missing|problem|gap|wrong/i.test(text)) continue;
      seen.add(text);
      out.push(firstSentence(text));
    }
    // Extract standalone "green" sentences (e.g. "All 5 ACs met.")
    for (const para of s.body.split(/\n\n+/)) {
      const clean = para.replace(/\*\*/g, '').trim();
      if (!clean || seen.has(clean)) continue;
      if (/all \d+ ACs? (met|green|pass)|tests?.*green|\d+ tests? green|no regressions/i.test(clean)) {
        const t = firstSentence(clean);
        if (t && !seen.has(t)) { seen.add(t); out.push(t); }
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Friction extraction
// ---------------------------------------------------------------------------

/**
 * Friction items come from antipattern sections (AP1, AP2, …) and from
 * observation paragraphs that contain clear failure signals.
 */
function extractFriction(sections: Section[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  function add(text: string): void {
    const t = firstSentence(text);
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  }

  for (const s of sections) {
    // Current format (reflector SKILL Stage-1): "### Repeated actions" and
    // "### Roadblocks / wedges" — wasteful repeats + stalls, both friction. Their
    // bullets use the "- **label**: detail" form ("_(none observed)_" yields none).
    if (/repeated\s+actions|roadblocks|wedges/i.test(s.heading)) {
      for (const e of extractBoldLabelBullets(s.body)) add(e);
      continue;
    }

    // Sections that explicitly describe friction
    if (/friction|antipattern|AP\d+/i.test(s.heading) && isPatternHeading(s.heading)) {
      const label = cleanPatternLabel(s.heading);
      const detail = s.body.trim().split(/\n\n/)[0]?.trim() ?? '';
      add(label + (detail ? ` — ${detail}` : ''));
      continue;
    }

    // Inline AP entries within any body
    const apRe = /\*\*(AP\d+)\s*[—–-]\s*([^*]+)\*\*/g;
    let m: RegExpExecArray | null;
    while ((m = apRe.exec(s.body)) !== null) {
      add(m[2].trim());
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Target matching — best-effort slug lookup
// ---------------------------------------------------------------------------

/**
 * Given the lesson text and the list of freshly-written theme slugs, find the
 * best-matching slug. Strategy:
 *   1. Convert the slug to readable form (hyphens → spaces).
 *   2. Check whether that readable form's significant words all appear in the
 *      lesson text (case-insensitive). Short slugs (< 3 words) require all
 *      words to match; longer slugs require ≥ 50 % of words to match.
 *   3. Return the slug with the highest word-match ratio, or undefined.
 */
function matchTarget(lessonText: string, slugs: string[]): string | undefined {
  if (slugs.length === 0) return undefined;

  const haystack = lessonText.toLowerCase();

  let bestSlug: string | undefined;
  let bestRatio = 0;

  for (const slug of slugs) {
    // Strip date prefixes (2026-06-07-...) for matching
    const withoutDate = slug.replace(/^\d{4}-\d{2}-\d{2}-/, '');
    const words = withoutDate.split('-').filter((w) => w.length > 2);
    if (words.length === 0) continue;
    const matchedWords = words.filter((w) => haystack.includes(w.toLowerCase()));
    const ratio = matchedWords.length / words.length;
    const threshold = words.length < 3 ? 1.0 : 0.5;
    if (ratio >= threshold && ratio > bestRatio) {
      bestRatio = ratio;
      bestSlug = slug;
    }
  }

  return bestSlug;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Return the first sentence from a text block. Sentences end at `.`, `!`, or
 * `?` followed by whitespace or end-of-string. Falls back to the full trimmed
 * text if no sentence boundary is found (prevents truncating short items).
 */
function firstSentence(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const m = clean.match(/^.{15,}?[.!?](?=\s|$)/);
  return m ? m[0].trim() : clean;
}
