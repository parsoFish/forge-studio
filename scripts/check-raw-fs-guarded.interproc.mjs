/**
 * check-raw-fs-guarded.interproc.mjs — shared function-boundary parsing for
 * the SEC-04 def-use lint (scripts/check-raw-fs-guarded.mjs).
 *
 * WHY A SEPARATE MODULE. check-raw-fs-guarded.mjs is already at its file-size
 * baseline (scripts/baselines/file-size.json: 1371 lines); a new capability
 * that needs new code goes in its own file rather than growing the baselined
 * one — the same reasoning ruling 106 applied to the allowlist DATA now
 * applies to this SHARED MECHANISM.
 *
 * `parseFunctions`/`enclosingFunction`/`anchorFor` give the content-keyed
 * allowlist (bead forge-mlk) a stable anchor component beyond the sink's own
 * path expression: the enclosing top-level function's NAME, so two
 * textually-identical sink calls in two different functions don't collide
 * under one allowlist row (an allowlist row matching more than one distinct
 * location is a named error, not a silent widening — see
 * check-raw-fs-guarded.allowlist.mjs's applyAllowlist). The SAME parse also
 * powers the one-level interprocedural taint hop (bead forge-8vfn.5.63,
 * `isParamTaintedViaCallers` below) — one function-boundary pass serves both.
 */

function offsetToLine(starts, off) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= off) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** A parameter that is not a plain identifier (destructured, or led by a
 *  pattern this scanner does not resolve positionally) reports as `null` —
 *  an explicit "cannot resolve", never a guess. */
function simpleParamName(paramText) {
  const t = paramText.replace(/^\.\.\./, '').trim();
  if (!t || t.startsWith('{') || t.startsWith('[')) return null;
  const m = /^[A-Za-z_$][\w$]*/.exec(t);
  return m ? m[0] : null;
}

/** Splits a parameter-list TEXT on top-level commas. Tracks `<...>` depth
 *  alongside `(`/`[`/`{` — safe HERE (never a general expression scanner):
 *  everything between a param list's parens is TYPE syntax, so `<`/`>` are
 *  always generics, never comparisons (`inputs: Record<string, string>` must
 *  not split on its inner comma). */
function splitTopLevel(text) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{' || c === '<') depth += 1;
    else if (c === ')' || c === ']' || c === '}' || c === '>') depth -= 1;
    else if (c === ',' && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  const last = text.slice(start).trim();
  if (last || out.length) out.push(last);
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Find the function BODY's opening `{` starting search at `from` (the char
 * offset right after the parameter list's closing `)`) — NOT simply the
 * first `{`, because a TS return-type annotation can itself contain a
 * top-level object-type brace pair (`): { sessionDir: string } {`) that
 * `indexOf('{', from)` would mistake for the body. Bracket groups NESTED
 * inside `(`/`[`/`<` are skipped as type syntax (unambiguous — a `{` inside
 * `Promise<{ x: string }>` is part of the generic, tracked by depth); a `{`
 * that surfaces at TOP level is a CANDIDATE, resolved by peeking past its
 * balanced close: if another top-level `{` immediately follows, the
 * candidate was itself a return-type object literal and the scan continues;
 * otherwise the candidate is the body. (Two adjacent top-level object-type
 * alternatives in a union return type, `{a}|{b} {`, are not disambiguated —
 * disclosed, not silently guessed at: unseen in this codebase's style.) */
function findBodyOpenBrace(cleaned, from) {
  let pos = from;
  let depth = 0;
  while (pos < cleaned.length) {
    const c = cleaned[pos];
    if (c === '(' || c === '[' || c === '<') { depth += 1; pos += 1; continue; }
    if (c === ')' || c === ']' || c === '>') { depth = Math.max(0, depth - 1); pos += 1; continue; }
    if (c === '{' && depth === 0) {
      let d = 1;
      let p = pos + 1;
      while (p < cleaned.length && d > 0) {
        if (cleaned[p] === '{') d += 1;
        else if (cleaned[p] === '}') d -= 1;
        p += 1;
      }
      let q = p;
      while (q < cleaned.length && /\s/.test(cleaned[q])) q += 1;
      if (cleaned[q] === '{') { pos = q; continue; } // a return-type object literal — keep scanning
      return pos; // confirmed: no further top-level `{` follows — this is the body
    }
    pos += 1;
  }
  return -1;
}

/**
 * Top-level NAMED function declarations (column 0, optional `export`/`async`)
 * — `function NAME(...) { ... }` — from the CLEANED module text (comments and
 * string contents already blanked by the caller's cleanStructure). Returns
 * Map<name, { name, params, bodyStart, bodyEnd, declOpenIdx }>: `params` are
 * ordered simple names, or `null` at a destructured/unresolvable slot (a
 * disclosed miss, never a guess); `bodyStart`/`bodyEnd` are 0-based line
 * indices spanning the `{ ... }` (inclusive); `declOpenIdx` is the char
 * offset right after the declaration's OWN `(`, used to exclude it as a call
 * site (the decl line always matches `NAME(` too). ARROW-const helpers are
 * not matched — this codebase's named helpers use `function NAME`, and a
 * scanner that guessed at arrow bodies would trade a disclosed miss for a
 * silent one.
 */
export function parseFunctions(cleaned, starts) {
  const funcs = new Map();
  const declRe = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  let m;
  while ((m = declRe.exec(cleaned))) {
    const name = m[1];
    const declOpenIdx = m.index + m[0].length;
    let depth = 1;
    let i = declOpenIdx;
    while (i < cleaned.length && depth > 0) {
      if (cleaned[i] === '(') depth += 1;
      else if (cleaned[i] === ')') depth -= 1;
      i += 1;
    }
    const params = splitTopLevel(cleaned.slice(declOpenIdx, i - 1)).map(simpleParamName);
    const braceIdx = findBodyOpenBrace(cleaned, i);
    if (braceIdx === -1) continue;
    let bdepth = 1;
    let j = braceIdx + 1;
    while (j < cleaned.length && bdepth > 0) {
      if (cleaned[j] === '{') bdepth += 1;
      else if (cleaned[j] === '}') bdepth -= 1;
      j += 1;
    }
    funcs.set(name, { name, params, declOpenIdx, bodyStart: offsetToLine(starts, braceIdx), bodyEnd: offsetToLine(starts, j - 1) });
  }
  return funcs;
}

/** The smallest parsed top-level function whose `{ ... }` span contains
 *  `line` (0-based), or null outside all of them. */
export function enclosingFunction(funcs, line) {
  let best = null;
  for (const fn of funcs.values()) {
    if (line < fn.bodyStart || line > fn.bodyEnd) continue;
    if (!best || fn.bodyEnd - fn.bodyStart < best.bodyEnd - best.bodyStart) best = fn;
  }
  return best;
}

/** The content-key anchor component for a sink at `line`: the enclosing named
 *  function (or `<module>` at top level) plus the sink's own normalized path
 *  expression — see check-raw-fs-guarded.allowlist.mjs's module docstring for
 *  the full design (bead forge-mlk). */
export function anchorFor(funcs, line, normalizedPath) {
  const fn = enclosingFunction(funcs, line);
  return `${fn ? fn.name : '<module>'}::${normalizedPath}`;
}
