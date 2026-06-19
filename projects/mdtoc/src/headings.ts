/**
 * Heading extraction from Markdown source.
 *
 * Pure: takes raw markdown text, returns an ordered, immutable list of the
 * ATX headings (`#`..`######`) found in it. Fenced code blocks are skipped so a
 * `# comment` inside a ```` ``` ```` block is never mistaken for a heading.
 *
 * No mutation of the input; a fresh array of frozen records is returned.
 */

export type Heading = {
  /** Heading level, 1..6 (number of leading `#`). */
  readonly level: number;
  /** The heading text with the leading `#`s and surrounding whitespace stripped. */
  readonly text: string;
  /** 1-based source line the heading was found on (useful for diagnostics). */
  readonly line: number;
};

const ATX_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^(\s*)(```+|~~~+)/;

/**
 * Extract all ATX headings from `markdown`, in document order. Content inside
 * fenced code blocks (``` or ~~~) is ignored. Returns a frozen array of frozen
 * headings — callers never mutate the parse result.
 */
export function extractHeadings(markdown: string): readonly Heading[] {
  if (typeof markdown !== 'string') {
    throw new TypeError('extractHeadings: markdown must be a string');
  }
  const headings: Heading[] = [];
  const lines = markdown.split(/\r?\n/);
  let fenceMarker: string | null = null;

  lines.forEach((raw, idx) => {
    const fence = FENCE.exec(raw);
    if (fence) {
      const marker = fence[2][0]; // ` or ~
      if (fenceMarker === null) {
        fenceMarker = marker;
        return;
      }
      if (fenceMarker === marker) {
        fenceMarker = null;
      }
      return;
    }
    if (fenceMarker !== null) return; // inside a code fence — skip

    const m = ATX_HEADING.exec(raw);
    if (!m) return;
    headings.push(
      Object.freeze({
        level: m[1].length,
        text: m[2].trim(),
        line: idx + 1,
      }),
    );
  });

  return Object.freeze(headings);
}
