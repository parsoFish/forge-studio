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

// =============================================================================
// THE ONE-LEVEL INTERPROCEDURAL HOP (bead forge-8vfn.5.63).
//
// THE GAP. check-raw-fs-guarded.mjs's def-use walk (findBinding/
// identIsTainted) is bounded to ONE function: when a sink's governing
// identifier is an UNRESOLVED name (a function PARAMETER, not a local
// `const`/`let`), the walk falls back to the curated bare-taint list and
// gives up. A sink moved verbatim into a same-module helper —
// `route(body) { return helper(body.project); }` /
// `function helper(arg) { readFileSync(join(root, arg)); }` — is exactly
// that shape: `arg` is unresolved INSIDE `helper`, and nothing about
// `helper`'s own definition names it as request-derived, so the sink goes
// dark even though every call site hands it a tainted value (measured live:
// hook-runtime.ts's readFileSync(scriptPath), retired from the allowlist as
// a documented blind spot when the read moved into a private
// prepareHookRun step).
//
// THE FIX. Given an unresolved parameter NAME and the line it is read at:
// find the enclosing top-level function, find every OTHER call site of that
// function in the SAME module, and ask (via `identIsTaintedAt`, supplied by
// the CALLER at call time — see "NO BACK-IMPORT" below) whether the
// argument at that parameter's position is tainted WHERE IT IS WRITTEN.
// Recursion into a SECOND hop is explicitly disabled by the caller (a
// second hop is the sibling ratchet's caller-count remit, not this lint's).
//
// SAME-MODULE, TOP-LEVEL, POSITIONAL PARAMETERS ONLY (disclosed limits, same
// spirit as the file this serves): a destructured parameter can't be
// resolved positionally and is skipped (`null` at its slot in
// parseFunctions — never a guess); an ARROW-const helper is not a parsed
// function boundary; a cross-file call is out of scope (bead 5.63's
// "if cheap" qualifier — a real cross-package call graph is not cheap, so
// it is not attempted).
//
// NO BACK-IMPORT. This module never imports from check-raw-fs-guarded.mjs.
// `argAt`/`governingIdents` are small, pure text utilities DUPLICATED here
// (not re-exported-and-reimported) so the two files keep an ACYCLIC
// dependency edge: check-raw-fs-guarded.mjs imports FROM here, never the
// reverse. `identIsTaintedAt` — the caller's OWN def-use taint check — is
// passed in as a plain function value at call time, for the same reason.
// =============================================================================

/** Path-combinator names — kept in lockstep with check-raw-fs-guarded.mjs's
 *  own PATH_HELPERS; a bare call to one of these is scaffolding, not a
 *  taint-carrying helper name, when listing a call argument's governing
 *  idents. */
const PATH_HELPERS = new Set(['join', 'resolve', 'dirname', 'basename', 'normalize', 'relative']);

/** Balanced-paren extraction of the argument at `index` (0-based) in a call
 *  whose `(` is the character just before `open`, over the CLEANED module
 *  text. Mirrors check-raw-fs-guarded.mjs's own `argAt` (duplicated, not
 *  imported — see the section header). */
function argAt(cleaned, open, index) {
  let depth = 0;
  let i = open;
  const n = cleaned.length;
  let argIdx = 0;
  let start = i;
  for (; i < n; i++) {
    const c = cleaned[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break;
      depth -= 1;
    } else if (c === ',' && depth === 0) {
      if (argIdx === index) return cleaned.slice(start, i).trim();
      argIdx += 1;
      start = i + 1;
    }
  }
  if (argIdx !== index) return '';
  return cleaned.slice(start, i).trim();
}

/** Governing identifiers of an expression — a request-derived MEMBER
 *  (`body.project`) or bare name, never a bare helper call. Mirrors
 *  check-raw-fs-guarded.mjs's own `governingIdents` (duplicated — see
 *  section header). */
function governingIdents(expr) {
  const out = [];
  const re = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(\()?/g;
  let m;
  while ((m = re.exec(expr))) {
    const full = m[1];
    const isCall = m[2] === '(';
    const head = full.split('.')[0];
    if (isCall && !full.includes('.')) continue;
    if (isCall && PATH_HELPERS.has(head)) continue;
    out.push({ full, head });
  }
  return out;
}

/** Every OTHER call site of `fn.name(` in the module (excluding its own
 *  declaration), each with the balanced-paren argument-list open offset and
 *  the 0-based line the CALL sits on. */
function findCallSites(cleaned, fn, starts) {
  const re = new RegExp(`(?<![.\\w$])${fn.name}\\s*\\(`, 'g');
  const sites = [];
  let m;
  while ((m = re.exec(cleaned))) {
    const openIdx = m.index + m[0].length;
    if (openIdx === fn.declOpenIdx) continue;
    sites.push({ openIdx, line: offsetToLine(starts, m.index) });
  }
  return sites;
}

/**
 * THE ONE-LEVEL HOP. Is `paramName`, read at `line` (0-based) inside the
 * enclosing top-level function, tainted because SOME call site elsewhere in
 * the module passes a request-derived argument at that parameter's
 * position? Returns the hit `{ fnName, paramName, argExpr, callerLine }` (a
 * truthy diagnostic, not just a boolean — callers use it to name the
 * ORIGINAL request source in a finding's `why`) or `null`.
 * `identIsTaintedAt(full, head, line)` is the CALLER's own def-use taint
 * check, invoked here ONLY at the call site's own line — never recursed
 * into a second hop, which is what makes this "one level" (the caller is
 * responsible for passing a version of itself with further hops disabled).
 * Memoized per (function, param index) on `ctx.cache` so a helper with
 * several sinks over the same param pays for the caller scan once.
 */
export function isParamTaintedViaCallers(paramName, line, ctx, identIsTaintedAt) {
  const { cleaned, starts, funcs, cache } = ctx;
  const fn = enclosingFunction(funcs, line);
  if (!fn) return null;
  const idx = fn.params.indexOf(paramName);
  if (idx === -1) return null;
  const cacheKey = `${fn.name}\u0000${idx}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  let hit = null;
  for (const site of findCallSites(cleaned, fn, starts)) {
    const argExpr = argAt(cleaned, site.openIdx, idx);
    if (!argExpr) continue;
    for (const id of governingIdents(argExpr)) {
      if (identIsTaintedAt(id.full, id.head, site.line)) { hit = { fnName: fn.name, paramName, argExpr, callerLine: site.line }; break; }
    }
    if (hit) break;
  }
  cache.set(cacheKey, hit);
  return hit;
}

/** A fresh per-module interprocedural context — one `parseFunctions` pass, a
 *  memoization cache shared by every sink the module's `analyzeModule` scans
 *  (both for anchor computation and, when wired, the taint hop above). */
export function buildInterprocContext(cleaned, starts) {
  return { cleaned, starts, funcs: parseFunctions(cleaned, starts), cache: new Map() };
}
