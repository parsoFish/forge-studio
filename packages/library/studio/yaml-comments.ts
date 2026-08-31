/**
 * W8-B5 WI-2(b) (exit row E4, community-28) — YAML comment handling for the
 * registry document. PURE text functions, no filesystem, no YAML parser.
 *
 * THE DEFECT. `js-yaml` has no comment round-trip: `yaml.load` drops comments
 * and `yaml.dump` cannot re-emit them. `serializeCommunityRegistry` dumps a
 * freshly built plain object, so a single Studio "Add item" click destroys all
 * 24 comment lines of curation rationale in
 * `studio/community/registry.yaml`. That is not a bug in one call site — it is
 * a property of the ONE shared serializer, and every writer (CRUD, the agent
 * commit finalizer, the deterministic refresh) inherits it.
 *
 * THE FIX, IN TWO HALVES.
 *
 *   1. `extractLeadingCommentBlock` — capture the file's leading comment block
 *      and re-emit it verbatim above the dump. Deterministic, no dependency,
 *      and it covers the 22 header lines that carry the file's actual
 *      documentation.
 *
 *   2. `findCommentLinesInBlock` — the rest of the class. A comment written
 *      INSIDE `items:` still cannot survive a dump, and half a fix that leaves
 *      the other half silently lossy is the exact defect shape this campaign
 *      has hit repeatedly. So `forge studio lint` REFUSES such a comment,
 *      naming its line. You cannot lose what the linter will not accept.
 *
 * Why not add a comment-preserving YAML library? `package.json` carries
 * `js-yaml` only and a new dependency is an unauthorised park-point here; the
 * leading-block capture is a dozen lines and fully testable, and the lint half
 * makes the residual loss structurally unreachable rather than merely rare.
 */

/** True for a line that is blank or whose first non-space character is `#`. */
function isCommentOrBlank(line: string): boolean {
  const t = line.trimStart();
  return t.length === 0 || t.startsWith('#');
}

/**
 * The file's leading comment block: every line from the top up to (not
 * including) the first line carrying real content, re-joined with `\n` and
 * terminated by a newline. `''` when the file opens with content — never a
 * fabricated header.
 *
 * Trailing blank lines immediately above the first content line are dropped so
 * that `header + dump` is stable under repeated round-trips (a kept trailing
 * blank would accumulate one blank line per write).
 */
export function extractLeadingCommentBlock(text: string): string {
  const lines = text.split('\n');
  let end = 0;
  while (end < lines.length && isCommentOrBlank(lines[end])) end++;
  // A comments-only file has no content line at all; `end` is then the whole
  // file (including the final '' produced by a trailing newline) — trimming
  // the trailing blanks below handles that case too.
  while (end > 0 && lines[end - 1].trim().length === 0) end--;
  if (end === 0) return '';
  return `${lines.slice(0, end).join('\n')}\n`;
}

/** Character-level scan for the first `#` that opens a comment on this line,
 *  respecting single/double-quoted scalars. Returns -1 when there is none.
 *
 *  A `#` only opens a comment at the start of the line's content or after
 *  whitespace (YAML's own rule) — `name: plain#nospace` is a value, not a
 *  comment. */
function commentStartIndex(line: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inDouble) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === '"') inDouble = false;
      continue;
    }
    if (inSingle) {
      // YAML escapes a single quote by doubling it.
      if (c === "'") {
        if (line[i + 1] === "'") i++;
        else inSingle = false;
      }
      continue;
    }
    if (c === '"') {
      inDouble = true;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      continue;
    }
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return i;
  }
  return -1;
}

/**
 * 1-based line numbers of every comment (full-line or trailing) that sits
 * inside the top-level `<blockKey>:` block — i.e. every comment the shared
 * serializer would silently destroy on the next write.
 *
 * The block runs from the line after `^<blockKey>:` to the next line that
 * starts a new top-level key (a non-space first character) or EOF. Comments
 * ABOVE the first content line are the preserved header and are never
 * reported; comments elsewhere at top level are outside this block's scope.
 */
export function findCommentLinesInBlock(text: string, blockKey: string): number[] {
  const lines = text.split('\n');
  const opener = new RegExp(`^${blockKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (opener.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return [];

  const found: number[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    // A new TOP-LEVEL key (or any unindented content) ends the block. A blank
    // or an indented line continues it; an unindented comment after the block
    // is out of scope and also ends it.
    if (line.trim().length > 0 && !/^\s/.test(line)) break;
    if (commentStartIndex(line) !== -1) found.push(i + 1);
  }
  return found;
}
