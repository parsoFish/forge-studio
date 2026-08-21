/**
 * The ONE lenient theme-frontmatter parser (W7 FIX-B-KB).
 *
 * Extracted VERBATIM from cli/brain-lint.ts's private `parseTheme` so the
 * lint checks and the deterministic fixers (cli/brain-fix-auto.ts) share a
 * single parse derivation. They used to disagree: brain-lint fell back to a
 * regex extractor on YAML failure (an unquoted `:` in a description is a
 * real, common theme shape), while brain-fix-auto's own strict copy returned
 * null — so `ensureLinkedAt` refused to link the very theme the lint side
 * had just flagged as missing its link, and consolidate could never clear
 * the finding. (The module split matters: brain-lint.ts value-imports
 * brain-fix-auto.ts, so the shared helper must live in a leaf module both
 * can import without a cycle.)
 *
 * gray-matter is always called WITH an options object (`{}`): it only
 * caches when called with none, and it stores the file object in that cache
 * BEFORE the YAML parse runs — a parse that THROWS leaves a poisoned
 * `data: {}` entry behind, and every later no-options parse of the
 * byte-identical content silently returned empty frontmatter instead of
 * throwing (order-dependent lint results; the wave-7 kb-maintain
 * "not-cleared" regression).
 */

import { readFileSync } from 'node:fs';

import matter from 'gray-matter';

export type ParsedThemeFile = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
  content: string;
  raw: string;
};

/**
 * Decode one fallback scalar. An inline `[a, b]` flow list becomes a REAL
 * string array — matching what gray-matter would have produced for the same
 * line (`keywords`/`related_themes` are exactly this shape). Leaving it as a
 * raw string made every `Array.isArray(...)` tolerance clause downstream
 * silently SKIP the field (`danglingEdgeFindings` skipped seeded dangling
 * edges — the kb-drain false-green). Entries are trimmed, surrounding
 * single/double quotes stripped, empties dropped (`[]` → []). Everything
 * else stays the raw trimmed string.
 */
function decodeFallbackValue(value: string): string | string[] {
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (inner === '') return [];
    return inner
      .split(',')
      .map((entry) => entry.trim().replace(/^['"]|['"]$/g, '').trim())
      .filter((entry) => entry !== '');
  }
  return value;
}

/**
 * Lenient frontmatter parse of raw theme text. Tries gray-matter first
 * (cache-bypassing, see module header); on YAML failure falls back to a
 * regex line-by-line extractor that captures `key: value` pairs without
 * YAML-spec strictness (inline `[a, b]` lists still decode to real arrays —
 * see `decodeFallbackValue`). This means callers can still surface
 * frontmatter findings (missing fields, bad category) — and still apply
 * deterministic index-link fixes — on themes gray-matter would reject;
 * failing-closed would hide the very class of violations lint exists to find.
 */
export function parseThemeRaw(raw: string): ParsedThemeFile {
  try {
    const { data, content } = matter(raw, {});
    return { data, content, raw };
  } catch {
    // Fallback: split on first two `---` lines.
    const lines = raw.split('\n');
    if (lines[0]?.trim() !== '---') {
      return { data: {}, content: raw, raw };
    }
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        end = i;
        break;
      }
    }
    if (end < 0) {
      return { data: {}, content: raw, raw };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: Record<string, any> = {};
    for (let i = 1; i < end; i++) {
      const line = lines[i];
      const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
      if (m) {
        data[m[1]] = decodeFallbackValue(m[2].trim());
      }
    }
    const content = lines.slice(end + 1).join('\n');
    return { data, content, raw };
  }
}

/** `parseThemeRaw` over a file's bytes; null only when the READ fails (the
 *  parse itself never fails — the fallback always produces a result). */
export function parseThemeFile(file: string): ParsedThemeFile | null {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  return parseThemeRaw(raw);
}
