/**
 * Options for the slugify function.
 */
export type SlugifyOptions = {
  separator?: string;   // default: "-"
  maxLength?: number;   // positive integer; cap output length
};

/**
 * Converts a string into a URL-safe slug.
 *
 * Transform pipeline (in order):
 * 1. NFD-normalise the input string.
 * 2. Strip Unicode combining marks (category Mn) from the NFD result.
 * 3. Lowercase the result.
 * 4. Replace any character that is not [a-z0-9] with the separator.
 * 5. Collapse runs of consecutive separators to a single separator.
 * 6. Trim leading and trailing separators.
 * 7. If maxLength is a positive integer, truncate and re-trim trailing separators.
 * 8. Return the result. Empty input → empty string.
 */
export function slugify(input: string, options?: SlugifyOptions): string {
  if (input === '') return '';

  const separator = options?.separator ?? '-';
  const maxLength = options?.maxLength;

  // Escape separator for use in a regex
  const escapedSep = separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  let result = input
    // Step 1: NFD normalise (decomposes accented chars into base + combining marks)
    .normalize('NFD')
    // Step 2: Strip Unicode combining marks (Mn = Mark, Nonspacing)
    .replace(/\p{Mn}/gu, '')
    // Step 3: Lowercase
    .toLowerCase()
    // Step 4: Replace non-alphanumeric characters with the separator
    .replace(/[^a-z0-9]/g, separator)
    // Step 5: Collapse consecutive separators into one
    .replace(new RegExp(`${escapedSep}{2,}`, 'g'), separator)
    // Step 6: Trim leading and trailing separators
    .replace(new RegExp(`^${escapedSep}+|${escapedSep}+$`, 'g'), '');

  // Step 7: Apply maxLength if it is a positive integer
  if (typeof maxLength === 'number' && maxLength > 0) {
    result = result.slice(0, maxLength);
    // Re-trim any trailing separator after truncation
    result = result.replace(new RegExp(`${escapedSep}+$`, 'g'), '');
  }

  return result;
}
