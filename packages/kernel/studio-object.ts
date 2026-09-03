/**
 * The generic studio-object loader — reading a frontmatter document, and
 * nothing about what one means.
 *
 * §4 M4 gives the agents lane "registry loaders split from the registry
 * module". `orchestrator/studio/registry.ts` fused two jobs: reading a
 * `SKILL.md`-shaped file, and knowing what fields make it a valid object of
 * one particular kind. Fusing them is why every kind that wanted the first
 * carried a private copy of it — the same `readFileSync` + `matter(raw, {})`
 * pair appears in a dozen modules across five packages.
 *
 * This module owns ONLY the reading half. The shape comes from a validator the
 * CALLER passes in, so kernel never learns whether an object needs a `runtime`
 * block or a list of stations — and `./studio-object.test.ts` asserts that
 * against this file's own source, because a generic loader that quietly learns
 * one kind's vocabulary stops being generic and the commit that does it looks
 * harmless line by line.
 *
 * The cache opt-out is load-bearing, not stylistic. `gray-matter` memoises by
 * content, so two files with identical bytes come back holding the SAME `data`
 * object; a caller that normalises its own copy would silently mutate the
 * other file's. Passing `{}` opts out. The reason travelled here as a comment
 * on the call it replaces, and comments rot, so it is pinned by a test that
 * mutates one document and reads the other.
 */
import { readFileSync } from 'node:fs';

import matter from 'gray-matter';

/** One parsed document: its frontmatter, its body, and where it came from. */
export type FrontmatterDoc = {
  /** Parsed frontmatter. Always a plain object — a document whose frontmatter
   *  is a scalar or a list never reaches a caller. */
  data: Record<string, unknown>;
  /** The body below the frontmatter, verbatim. */
  content: string;
  /** The path it was read from — carried so a validator's error can name it. */
  path: string;
};

/**
 * Read and parse one document, or `null` when there is nothing usable to read.
 *
 * `null` covers both "no such file" and "the frontmatter is not an object",
 * because every predicate built on this treats the two identically: a file
 * that cannot be read is not one of mine, and neither is a file whose
 * frontmatter is a bare scalar. A caller that needs to tell them apart should
 * `stat` the path itself; a caller that needs the failure to be loud should
 * use {@link loadStudioObject}, which throws and names the path.
 */
export function readFrontmatter(path: string): FrontmatterDoc | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  let parsed: { data: unknown; content: string };
  try {
    parsed = matter(raw, {}); // `{}` opts out of the parse cache — see the module doc
  } catch {
    return null;
  }
  if (parsed.data == null || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) return null;
  return { data: parsed.data as Record<string, unknown>, content: parsed.content, path };
}

/**
 * Read one document and hand it to `validate`, which returns the shaped value.
 *
 * Throws — naming the path — when the document cannot be read or parsed into
 * an object. A bare `ENOENT` from deep inside a loader makes the caller guess
 * which of a hundred files it was.
 *
 * The validator's own error passes through UNWRAPPED. It knows what was wrong
 * with the document and has already said so; re-wrapping would bury the one
 * sentence a caller needs behind a generic one.
 */
export function loadStudioObject<T>(path: string, validate: (doc: FrontmatterDoc) => T): T {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`${path}: cannot read file — ${(err as Error).message}`);
  }
  let parsed: { data: unknown; content: string };
  try {
    parsed = matter(raw, {});
  } catch (err) {
    throw new Error(`${path}: cannot parse frontmatter — ${(err as Error).message}`);
  }
  if (parsed.data == null || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
    throw new Error(`${path}: frontmatter is not an object`);
  }
  return validate({ data: parsed.data as Record<string, unknown>, content: parsed.content, path });
}
