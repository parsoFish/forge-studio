/**
 * Lightweight English stemmer + tokeniser for benchmark keyword matching.
 *
 * Not a full Porter implementation — handles the common suffixes that show up
 * in our keyword/answer pairs (`-s`, `-es`, `-ies`, `-ing`, `-ed`, `-ly`) and
 * leaves short / technical tokens alone. Kept in-repo as ~30 lines so we don't
 * pull in a dependency for one fixture-scoring concern.
 */

const STOPWORDS = new Set([
  'a', 'an', 'the',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'of', 'to', 'in', 'on', 'for', 'with', 'by', 'at', 'as', 'from', 'into',
  'and', 'or', 'but', 'if', 'then', 'else',
  'this', 'that', 'these', 'those',
  'it', 'its', 'we', 'our', 'us', 'you', 'your',
  'do', 'does', 'did', 'has', 'have', 'had',
  'so', 'such',
]);

export function simpleStem(word: string): string {
  const w = word.toLowerCase();
  if (w.length <= 3) return w;
  // Porter step 1a — plural normalisation (sequence-sensitive; no standalone -es rule).
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('ss')) return w;
  if (w.endsWith('s') && w.length > 3) return w.slice(0, -1);
  // Common verb-form normalisation.
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('ly') && w.length > 4) return w.slice(0, -2);
  return w;
}

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\w%]+/g) ?? [];
}

export function contentTokens(text: string): string[] {
  return tokenize(text).filter((t) => !STOPWORDS.has(t)).map(simpleStem);
}
