import { slugify } from './slugify.ts';

export function slugifyMany(inputs: string[]): string[] {
  return inputs.map((s) => slugify(s));
}

export function uniqueSlug(candidate: string, taken: string[]): string {
  if (!taken.includes(candidate)) return candidate;
  for (let n = 2; n < 1_000_000; n++) {
    const proposed = `${candidate}-${n}`;
    if (!taken.includes(proposed)) return proposed;
  }
  throw new Error(`uniqueSlug: exhausted suffix range for ${candidate}`);
}
