/**
 * GitHub-style anchor slug generation for heading text.
 *
 * Pure + deterministic. The rules mirror GitHub's `#`-anchor algorithm closely
 * enough to be useful in a TOC: lowercase, strip punctuation, collapse spaces to
 * hyphens. Duplicate slugs within one document get a numeric suffix (`-1`, `-2`,
 * …) so every TOC link resolves to a distinct anchor.
 *
 * The duplicate-disambiguation is the reason `slugify` is a stateful factory
 * (`createSlugger`) rather than a free function: the same text appearing twice
 * must produce different anchors, which requires remembering what's been seen.
 */

/** Convert one heading's text into its base GitHub-style anchor slug. */
export function slugBase(text: string): string {
  if (typeof text !== 'string') {
    throw new TypeError('slugBase: text must be a string');
  }
  return text
    .trim()
    .toLowerCase()
    // Strip anything that isn't a word char, space, or hyphen (drops `.,:()` etc.).
    .replace(/[^\w\s-]/g, '')
    // Collapse runs of whitespace to single hyphens.
    .replace(/\s+/g, '-')
    // Collapse runs of hyphens.
    .replace(/-+/g, '-')
    // Trim leading/trailing hyphens.
    .replace(/^-+|-+$/g, '');
}

export type Slugger = (text: string) => string;

/**
 * Create a stateful slugger that disambiguates duplicate slugs across calls.
 * The first occurrence of a slug is returned as-is; the second gets `-1`, the
 * third `-2`, and so on — matching GitHub's behaviour for repeated headings.
 */
export function createSlugger(): Slugger {
  const seen = new Map<string, number>();
  return (text: string): string => {
    const base = slugBase(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}
