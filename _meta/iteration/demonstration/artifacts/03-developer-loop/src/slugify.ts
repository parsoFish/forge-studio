/**
 * Options for the slugify function.
 */
export type SlugifyOptions = {
  separator?: string;
  maxLength?: number;
};

/**
 * Convert a string into a URL-friendly slug.
 *
 * Transformation pipeline (in order):
 * 1. Unicode NFD normalisation
 * 2. Strip combining marks (Unicode category Mn)
 * 3. Lower-case
 * 4. Collapse runs of non-alphanumeric characters to a single separator (default: "-")
 * 5. Trim leading/trailing separators
 * 6. Truncate to maxLength (if specified), trimming trailing separator after truncation
 * 7. Return result (empty string for empty/whitespace-only input)
 *
 * @param input - The string to slugify.
 * @param options - Optional options object with separator and maxLength.
 * @returns The slugified string.
 */
export function slugify(input: string, options?: SlugifyOptions): string {
  if (input.length === 0) {
    return '';
  }

  const separator = options?.separator !== undefined ? options.separator : '-';
  const maxLength = options?.maxLength;

  // Escape separator for use in regex (handle special regex chars)
  const escapedSep = separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Build the regex pattern for non-alphanumeric runs
  const nonAlphanumPattern = /[^a-z0-9]+/g;

  let result = input
    // Step 1: Unicode NFD normalisation — decomposes accented characters into base + combining marks
    .normalize('NFD')
    // Step 2: Strip combining marks (Mn = Mark, Nonspacing)
    .replace(/\p{Mn}/gu, '')
    // Step 3: Lower-case
    .toLowerCase()
    // Step 4: Collapse runs of non-alphanumeric characters to a single separator
    .replace(nonAlphanumPattern, separator);

  // Step 5: Trim leading/trailing separators (only if separator is non-empty)
  if (separator !== '') {
    const trimPattern = new RegExp(`^(${escapedSep})+|(${escapedSep})+$`, 'g');
    result = result.replace(trimPattern, '');
  }

  // Step 6: Truncate to maxLength if specified
  if (maxLength !== undefined && result.length > maxLength) {
    result = result.slice(0, maxLength);
    // Re-trim trailing separator after truncation (only if separator is non-empty)
    if (separator !== '') {
      const trailPattern = new RegExp(`(${escapedSep})+$`);
      result = result.replace(trailPattern, '');
    }
  }

  return result;
}
