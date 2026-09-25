/**
 * check-raw-fs-guarded.destructure.mjs — destructuring-declaration binding
 * parser for check-raw-fs-guarded.mjs's `findBinding` (bead forge-8vfn.5.63).
 *
 * Split out of check-raw-fs-guarded.mjs to respect the 800-line file-size
 * baseline (scripts/baselines/file-size.json) — same reason
 * check-raw-fs-guarded.allowlist.mjs and check-raw-fs-guarded.interproc.mjs
 * are separate modules, not sections of the main file.
 *
 * THE BUG THIS REPLACES. `findBinding` used to match a destructured
 * declaration (`const { runId } = body;`) with a regex fenced by `[^=;]*` on
 * both sides of the bound name — excluding `=` from the whole pattern span.
 * That works for a defaultless pattern, but a LATER property carrying a
 * default value (`const { id, env = process.env } = input;`) puts an `=`
 * inside the SAME pattern, so the fence broke the match for `id` too — an
 * EARLIER, perfectly ordinary, defaultless name read as UNRESOLVED (as if it
 * were an unbound function parameter) purely because a sibling had a
 * default. Measured live: packages/library/studio/hook-runtime.ts's
 * `const { forgeRoot, id, logger, initiativeId, parentEnv = process.env,
 * timeoutMs = HOOK_SPAWN_TIMEOUT_MS } = input` — `initiativeId` (on
 * check-raw-fs-guarded.mjs's REQUEST_TAINT_BARE list) then fell through to
 * the bare-taint fallback instead of resolving to `input`, mis-tainting two
 * sinks that were actually guarded (see check-raw-fs-guarded.allowlist.mjs's
 * removed hook-runtime.ts:199/:326 rows for the full account).
 *
 * THE FIX. A small tokenizer over the pattern's braces: balanced-bracket
 * scan to find where the pattern ENDS (so an interior `=` no longer matters),
 * then a top-level comma split, then per item a top-level-colon rename check
 * and a default-value strip, recursing into nested sub-patterns. Handles
 * shorthand (`a`), default (`a = expr`, expr may itself carry `,`/`()`),
 * rename (`a: b`), rename+default (`a: b = expr`), nested (`a: { ... }`),
 * array elision (`[, a]`), and rest (`...a`) — and, unlike the regex it
 * replaces, correctly does NOT bind a rename's KEY (`a` in `{ a: b }`) as a
 * name, since that was never itself the bound variable.
 *
 * Known limit (documented, not fixed — this is a small tokenizer, not a full
 * JS parser): a default expression containing a top-level `?:` ternary would
 * misread its `:` as a rename separator. Not a shape any module in this
 * scanner's scope uses.
 */

/** Index of the bracket matching the OPEN bracket at `line[start]` (a `{` or
 *  `[`) — a single depth counter over `(`/`[`/`{` and their closes, same
 *  technique as check-raw-fs-guarded.mjs's own `argAt` (real JS source can't
 *  mismatch bracket TYPES, so one counter is enough). Returns -1 if
 *  unterminated on this line (a destructure spanning multiple lines — out of
 *  scope, same as the regex this replaces: `findBinding` only ever looks at
 *  one line at a time). */
function matchingClose(line, start) {
  let depth = 0;
  for (let i = start; i < line.length; i++) {
    const c = line[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Top-level (depth-0 within `text`) comma split — tracks `(`/`[`/`{` nesting
 *  so a default value's own call args (`x = f(a, b)`) or a nested
 *  sub-pattern's commas don't split early. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Index of a `:` at depth 0 within `item` (a rename's separator), or -1.
 *  Depth-tracked so a nested pattern's own `:` (`a: { b: c } `) isn't taken
 *  for the outer rename. */
function topLevelColon(item) {
  let depth = 0;
  for (let i = 0; i < item.length; i++) {
    const c = item[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ':' && depth === 0) return i;
  }
  return -1;
}

/** Bound names bind through the VALUE side of a destructuring item — a
 *  shorthand/rename target (`a`, possibly with a default `a = expr`) or a
 *  nested sub-pattern (`{ ... }` / `[ ... ]`). Collects into `names`. */
function collectValueNames(value, names) {
  if (value.startsWith('{') || value.startsWith('[')) {
    for (const n of destructuredNames(value)) names.add(n);
    return;
  }
  const eq = value.indexOf('='); // the LHS of a default can't itself contain
  // `=`, so the first `=` in a colon-free value IS the default separator.
  const bound = (eq === -1 ? value : value.slice(0, eq)).trim();
  if (/^[A-Za-z_$][\w$]*$/.test(bound)) names.add(bound);
}

/** Every NAME actually BOUND by a destructuring pattern (`pattern` is the
 *  text strictly from its outer `{`/`[` through the matching close). Exported
 *  for direct unit testing; `findDestructureBinding` below is what
 *  check-raw-fs-guarded.mjs actually calls. */
export function destructuredNames(pattern) {
  const inner = pattern.slice(1, -1); // strip the outer [ or {
  const names = new Set();
  for (const rawItem of splitTopLevel(inner)) {
    let item = rawItem.trim();
    if (!item) continue; // array elision: `[, a]`
    if (item.startsWith('...')) item = item.slice(3).trim();
    const colon = topLevelColon(item);
    if (colon !== -1) {
      collectValueNames(item.slice(colon + 1).trim(), names); // before `:` is a KEY, never a bound name
    } else {
      collectValueNames(item, names);
    }
  }
  return names;
}

/** A destructuring declaration on ONE line binding `name` — `const {..} =
 *  rhs;` / `const [..] = rhs;`. Returns `{ rhs }` or null. Only the FIRST
 *  `const`/`let [`/`{` on the line is tried. */
export function findDestructureBinding(line, name) {
  const openM = /(?:const|let)\s*([[{])/.exec(line);
  if (!openM) return null;
  const openIdx = openM.index + openM[0].length - 1;
  const closeIdx = matchingClose(line, openIdx);
  if (closeIdx === -1) return null; // unterminated on this line — not our shape
  const asgnM = /^\s*=\s*(.+?);?\s*$/.exec(line.slice(closeIdx + 1));
  if (!asgnM) return null;
  const pattern = line.slice(openIdx, closeIdx + 1);
  if (!destructuredNames(pattern).has(name)) return null;
  return { rhs: asgnM[1].trim() };
}
