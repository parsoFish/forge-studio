import { slugify } from './slugify.ts';

/**
 * Maps slugify over an array of input strings, preserving order.
 * Empty strings in the input produce empty strings in the output (not dropped).
 */
export function slugifyMany(inputs: string[]): string[] {
  return inputs.map((input) => slugify(input));
}

/**
 * Returns slug unchanged if it is not in taken.
 * Otherwise appends -N where N is the smallest integer >= 2
 * such that slug-N is not in taken.
 * Uses exact string matching (case-sensitive, no normalization).
 */
export function uniqueSlug(slug: string, taken: string[]): string {
  if (!taken.includes(slug)) {
    return slug;
  }
  let n = 2;
  while (taken.includes(`${slug}-${n}`)) {
    n += 1;
  }
  return `${slug}-${n}`;
}
