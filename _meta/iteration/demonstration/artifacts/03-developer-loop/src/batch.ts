import { slugify } from './slugify.ts';

/**
 * Slugify an array of strings, preserving order.
 *
 * @param inputs - The strings to slugify.
 * @returns An array of slugified strings in the same order as the input.
 */
export function slugifyMany(inputs: string[]): string[] {
  return inputs.map((input) => slugify(input));
}

/**
 * Return a slug that is not in the `taken` set.
 *
 * If `slug` is free (not in `taken`), returns it as-is.
 * Otherwise tries `slug-2`, `slug-3`, … until a free variant is found.
 * The suffix separator is always a hyphen (`-`).
 * The `taken` lookup is case-sensitive and exact.
 *
 * @param slug  - The desired base slug.
 * @param taken - Array of already-used slugs.
 * @returns A slug that is not in `taken`.
 */
export function uniqueSlug(slug: string, taken: string[]): string {
  const takenSet = new Set(taken);

  if (!takenSet.has(slug)) {
    return slug;
  }

  let counter = 2;
  while (takenSet.has(`${slug}-${counter}`)) {
    counter++;
  }

  return `${slug}-${counter}`;
}
