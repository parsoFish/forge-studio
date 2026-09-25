/**
 * fixture-wiring.test.ts — the SOURCE-ORDER door for the fixture-ground
 * wiring in `run.mjs` / `run-story.mjs` (M7-D, bead `forge-1rk5.1`).
 *
 * WHY A STATIC TEXT CHECK, following `module-wiring.test.ts`'s own precedent:
 * `run.mjs` and `run-story.mjs` boot a bridge, bind the host-global Studio
 * ports and drive a real browser — neither can run inside `npm test`, so a
 * wiring defect in them is invisible to every gate that DOES run there. But
 * ORDERING is not a behavioural question; it is a property of the SOURCE TEXT,
 * answerable by reading it, the same move `module-wiring.test.ts` makes for
 * "does this name resolve".
 *
 * COMMENTS ARE STRIPPED before every match below: a mention of
 * `teardownFixtureGround(` in a doc comment must never satisfy a door that
 * exists to prove the CODE does the thing the comment claims.
 *
 * Three instruments make the doors precise:
 *
 *   1. `stripComments` is STRING/TEMPLATE/REGEX-AWARE. Two blind regexes run
 *      over the raw source in sequence (block comments, then line comments)
 *      would read the `/*` in a `// … projects/*` remark as the start of a
 *      block comment and swallow real code up to the next `*​/` anywhere
 *      later in the file. This is a one-pass scanner that tracks whether it
 *      is inside a string, a template literal (including `${ … }`
 *      interpolation, which is CODE and can itself contain comments/strings/
 *      nested templates), or a regex literal, and only treats `//`/`/* *​/`
 *      as comments OUTSIDE all of those.
 *   2. The fence door's mutation-proofness is a TEST IN ITS OWN RIGHT:
 *      mutants (a) delete the if-block, (b) neuter it to `if (false)`, and
 *      (c) replace the `realGroundFenceVerdict(` call itself with a stub
 *      `{ ok: true, moved: [] }`. All three are built from the REAL file's
 *      own text via EXACT anchor replacement (`replaceAnchor`), which THROWS
 *      if its anchor is not found — a refactor that moves or renames this
 *      code reds the test outright, rather than the mutant quietly reducing
 *      to a no-op that "passes" without ever having mutated anything.
 *   3. `fenceDoorVerdict`'s failure text says EXACTLY what failed:
 *      `locateFenceGuard` returns a distinct, accurate reason for each of the
 *      three ways it can fail — no declaration, no matching `if`, or a
 *      condition not immediately followed by a `{ … }` block.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── A string/template/regex-aware comment stripper ─────────────────────────
//
// A one-pass scanner, not two blind regexes. It tracks four literal kinds
// that can contain comment-LOOKING text which must never be treated as a
// comment: '...' / "..." strings, `...` template literals (whose `${ … }`
// interpolations are CODE, tracked via a depth stack so they can nest to any
// depth and themselves contain comments, strings or further templates), and
// /…/ regex literals (disambiguated from division by the classic heuristic:
// a `/` starts a regex unless the last significant character already emitted
// is a value — an identifier/number character, `)` or `]`).
//
// Comments themselves are still dropped entirely (not replaced with
// whitespace) — the same output shape the old two-regex version produced,
// so every existing anchor-search door below is unaffected by this swap.

function stripComments(source: string): string {
  const n = source.length;
  let i = 0;
  let out = '';
  let braceDepth = 0;
  // One entry per currently-open `${` interpolation, holding the braceDepth
  // at which it was opened — lets a `}` tell whether it closes an
  // interpolation (return to template text) or an ordinary code block.
  const templateOpenDepths: number[] = [];

  function prevSignificant(): string {
    for (let j = out.length - 1; j >= 0; j -= 1) {
      if (!/\s/.test(out[j])) return out[j];
    }
    return '';
  }
  function looksLikeRegexStart(): boolean {
    const p = prevSignificant();
    return p === '' || !/[A-Za-z0-9_$)\]]/.test(p);
  }
  function consumeQuoted(quote: string) {
    out += source[i];
    i += 1;
    while (i < n && source[i] !== quote) {
      if (source[i] === '\\' && i + 1 < n) {
        out += source.slice(i, i + 2);
        i += 2;
        continue;
      }
      out += source[i];
      i += 1;
    }
    if (i < n) {
      out += source[i];
      i += 1;
    }
  }
  // Consumes template TEXT starting right after either the opening ` or a
  // `${ … }`'s closing `}`. Returns when the template closes (` found) or
  // when a NEW `${` opens (pushing state; the main loop resumes in CODE mode).
  function consumeTemplateBody() {
    while (i < n) {
      if (source[i] === '\\' && i + 1 < n) {
        out += source.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (source[i] === '`') {
        out += source[i];
        i += 1;
        return;
      }
      if (source[i] === '$' && source[i + 1] === '{') {
        out += '${';
        i += 2;
        templateOpenDepths.push(braceDepth);
        braceDepth += 1;
        return;
      }
      out += source[i];
      i += 1;
    }
  }

  while (i < n) {
    const c = source[i];
    const c2 = i + 1 < n ? source[i + 1] : '';

    if (c === '/' && c2 === '/') {
      i += 2;
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && c2 === '*') {
      const commentStart = i;
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      if (i < n) {
        i += 2; // consumed the closing */
      } else {
        // Unterminated block comment: never silently swallow to EOF — keep
        // the raw, unstrippable text rather than guessing.
        out += source.slice(commentStart, n);
      }
      continue;
    }
    if (c === '\'' || c === '"') {
      consumeQuoted(c);
      continue;
    }
    if (c === '`') {
      out += c;
      i += 1;
      consumeTemplateBody();
      continue;
    }
    if (c === '/' && looksLikeRegexStart()) {
      let j = i + 1;
      let inClass = false;
      let closed = -1;
      while (j < n) {
        const cj = source[j];
        if (cj === '\n') break;
        if (cj === '\\') {
          j += 2;
          continue;
        }
        if (cj === '[') {
          inClass = true;
          j += 1;
          continue;
        }
        if (cj === ']') {
          inClass = false;
          j += 1;
          continue;
        }
        if (cj === '/' && !inClass) {
          closed = j;
          break;
        }
        j += 1;
      }
      if (closed !== -1) {
        let end = closed + 1;
        while (end < n && /[a-z]/i.test(source[end])) end += 1; // flags
        out += source.slice(i, end);
        i = end;
        continue;
      }
      // No closing `/` before a newline or EOF — not a real regex literal
      // (one cannot contain a raw newline); fall through and treat this `/`
      // as an ordinary character below.
    }
    if (c === '{') {
      braceDepth += 1;
      out += c;
      i += 1;
      continue;
    }
    if (c === '}') {
      if (
        templateOpenDepths.length > 0 &&
        templateOpenDepths[templateOpenDepths.length - 1] === braceDepth - 1
      ) {
        templateOpenDepths.pop();
        braceDepth -= 1;
        out += '}';
        i += 1;
        consumeTemplateBody();
        continue;
      }
      braceDepth -= 1;
      out += c;
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const readSource = (file: string) => readFileSync(join(HERE, file), 'utf8');
const readStripped = (file: string) => stripComments(readSource(file));
const indexOfCall = (source: string, name: string) => source.indexOf(`${name}(`);

// ── Unit tests for the stripper itself ──────────────────────────────────────

test('stripComments: strips // and /* */ in ordinary code, keeping newlines where // comments were', () => {
  assert.equal(stripComments('a();\n// a remark\nb();\n'), 'a();\n\nb();\n');
  assert.equal(stripComments('a(); /* inline */ b();'), 'a();  b();');
  assert.equal(stripComments('a();\n/* spans\nseveral\nlines */\nb();\n'), 'a();\n\nb();\n');
});

test('stripComments: comment-like text inside a string is never stripped', () => {
  assert.equal(
    stripComments("const url = 'http://localhost:4124'; // real comment\n"),
    "const url = 'http://localhost:4124'; \n",
  );
  assert.equal(
    stripComments('const s = "/* not a comment */ and // not one either"; // real\n'),
    'const s = "/* not a comment */ and // not one either"; \n',
  );
  // Escaped quote inside the string must not end it early.
  assert.equal(stripComments('const s = \'it\\\'s // fine\'; // real\n'), 'const s = \'it\\\'s // fine\'; \n');
});

test('stripComments: comment-like text inside a template literal, including inside ${…} interpolation, is never stripped', () => {
  const src = 'const s = `path is ${a}/${b} not a comment // still not, nor /* this */`;\n// real comment\n';
  const stripped = stripComments(src);
  assert.ok(
    stripped.includes('`path is ${a}/${b} not a comment // still not, nor /* this */`'),
    `template body must survive intact. Got:\n${stripped}`,
  );
  assert.ok(!stripped.includes('real comment'), `the trailing real comment must still be stripped. Got:\n${stripped}`);
});

test('stripComments: a comment INSIDE a ${…} interpolation is a real comment and IS stripped, and the template resumes after it', () => {
  const src = 'const s = `before ${x /* real comment in code */ + 1} after`;\n';
  const stripped = stripComments(src);
  assert.ok(stripped.includes('`before ${x  + 1} after`'), `Got:\n${stripped}`);
  assert.ok(!stripped.includes('real comment in code'), `Got:\n${stripped}`);
});

test('stripComments: comment-like text inside a regex literal is never stripped, and division is never mistaken for a regex', () => {
  const src = "const re = /http:\\/\\/example/; // a real comment\nconst n = a / b; // also real\n";
  const stripped = stripComments(src);
  assert.ok(stripped.includes('/http:\\/\\/example/'), `regex literal must survive intact. Got:\n${stripped}`);
  assert.ok(!stripped.includes('a real comment'), `Got:\n${stripped}`);
  assert.ok(stripped.includes('const n = a / b;'), `plain division must survive as code, not be read as a regex. Got:\n${stripped}`);
  assert.ok(!stripped.includes('also real'), `Got:\n${stripped}`);
});

test('stripComments: a /* inside a // comment does not start swallowing code — synthetic reproduction', () => {
  const src =
    'const keep = snapshotRealGrounds(a); // a remark about projects/* and other things\n' +
    'const also = snapshotRealGrounds(b); /* harmless note */\n';
  const stripped = stripComments(src);
  assert.equal(
    (stripped.match(/snapshotRealGrounds\(/g) ?? []).length,
    2,
    `both calls must survive stripping — the old stripper's "/*" inside "projects/*" would have swallowed ` +
      `everything up to the next "*/" here. Got:\n${stripped}`,
  );
});

test('stripComments: a /* … */ appended to a // … projects/* remark, in multi-line source with a later */, keeps every call after it', () => {
  // A synthetic source shaped like the fence's own code: a call, a `//`
  // remark whose text contains `projects/*`, code after it, and a JSDoc
  // `*/` further down — the shape in which a block-first stripper swallows
  // the second call. The mutation appends `/* harmless note */` to the remark
  // via the same exact-anchor-or-throw discipline as the mutation test below.
  const anchorLine = '  // a FIXTURE run must never move a REAL ground: every `projects/*`';
  const source = [
    'const realBefore = snapshotRealGrounds(listBefore);',
    anchorLine,
    'runTheBeats();',
    'const realAfter = snapshotRealGrounds(listAfter);',
    '/** a later doc comment */',
    'function later() {}',
    '',
  ].join('\n');
  const mutated = replaceAnchor(source, anchorLine, `${anchorLine} /* harmless note */`);

  for (const [label, text] of [['unmutated', source], ['mutated', mutated]]) {
    const count = (stripComments(text).match(/snapshotRealGrounds\(/g) ?? []).length;
    assert.equal(
      count,
      2,
      `${label}: expected both snapshotRealGrounds( calls to survive stripping — found ${count}. A regression ` +
        'here means the swallow-to-the-next-*/ bug is back.',
    );
  }
});

test('comment-stripping does not eat real code — sanity check on this door\'s own instrument', () => {
  // If this ever failed it would mean `stripComments` is silently deleting
  // anchors the checks below depend on, which would make every RED below a
  // false one. `sweepStoryResidue(` and `probeBridgeIdentity(` both exist in
  // real code in run.mjs; both must still be found after stripping.
  const stripped = readStripped('run.mjs');
  assert.ok(indexOfCall(stripped, 'sweepStoryResidue') !== -1);
  assert.ok(indexOfCall(stripped, 'probeBridgeIdentity') !== -1);
});

// ── run.mjs ──────────────────────────────────────────────────────────────

test('run.mjs: provisionFixtureGrounds (the BATCH function, not the singular in a loop) runs AFTER the leading residue sweep and BEFORE the bridge identity probe', () => {
  const source = readStripped('run.mjs');
  const sweepAt = indexOfCall(source, 'sweepStoryResidue');
  const bridgeAt = indexOfCall(source, 'probeBridgeIdentity');
  const provisionAt = indexOfCall(source, 'provisionFixtureGrounds');

  assert.ok(sweepAt !== -1, 'sweepStoryResidue( must appear in run.mjs — this door\'s own anchor moved');
  assert.ok(bridgeAt !== -1, 'probeBridgeIdentity( must appear in run.mjs — this door\'s own anchor moved');
  assert.ok(
    provisionAt !== -1,
    'run.mjs never calls provisionFixtureGrounds( (the batch form) — a loop over the singular has no ' +
      'batch-level rollback on a later story\'s refusal',
  );
  assert.ok(provisionAt > sweepAt, `provisionFixtureGrounds( (at ${provisionAt}) must run AFTER sweepStoryResidue( (at ${sweepAt})`);
  assert.ok(provisionAt < bridgeAt, `provisionFixtureGrounds( (at ${provisionAt}) must run BEFORE probeBridgeIdentity( (at ${bridgeAt})`);
});

test('run.mjs: the finally block tears down any fixture ground still standing — a bridge refusal or throw after provisioning must not leave it behind', () => {
  const source = readStripped('run.mjs');
  const finallyAt = source.indexOf('finally');
  const teardownAt = indexOfCall(source, 'teardownFixtureGround');

  assert.ok(finallyAt !== -1, 'run.mjs must have its abort-backstop finally block — this door\'s own anchor moved');
  assert.ok(teardownAt !== -1, 'run.mjs never calls teardownFixtureGround( — a provisioned ground could be left behind forever');
  assert.ok(teardownAt > finallyAt, `teardownFixtureGround( (at ${teardownAt}) must run inside the finally block (starts at ${finallyAt})`);
});

test('run.mjs: the abort backstop tears down ONLY grounds whose story never started — a started story\'s ground is LEFT for evidence, named', () => {
  const source = readStripped('run.mjs');

  const runStoryAt = source.indexOf('await runStory(');
  assert.ok(runStoryAt !== -1, 'run.mjs never awaits runStory( — this door\'s own anchor moved');
  const beforeRunStory = source.slice(Math.max(0, runStoryAt - 200), runStoryAt);
  assert.ok(
    /\.(add|set)\(/.test(beforeRunStory),
    'expected a started-story-ids Set/Map write (.add( or .set() immediately before await runStory( — found ' +
      `no such call in the 200 characters before it. Context: ${JSON.stringify(beforeRunStory)}`,
  );

  const finallyAt = source.indexOf('finally');
  const teardownAt = indexOfCall(source, 'teardownFixtureGround');
  assert.ok(teardownAt > finallyAt, 'teardownFixtureGround( must run inside the finally block');
  const guardWindow = source.slice(finallyAt, teardownAt);
  assert.ok(
    /\.has\(/.test(guardWindow),
    'expected the backstop\'s teardown to be guarded by a .has( check against the started-ids structure — ' +
      'found no .has( between finally and teardownFixtureGround(. Without it, a CRASHED story\'s ground is torn ' +
      'down along with an unstarted one\'s, destroying the evidence a crashed story leaves behind.',
  );

  assert.match(
    source,
    /LEFT for evidence/,
    'run.mjs never prints "LEFT for evidence" — a started story\'s ground must be named as deliberately kept, ' +
      'not silently left standing indistinguishably from a bug',
  );
});

test('run.mjs: the fixture-ground backstop sits inside its OWN try { … } catch that cannot prevent the lock release that follows it', () => {
  const source = readStripped('run.mjs');
  const teardownAt = indexOfCall(source, 'teardownFixtureGround');
  const releaseAt = source.indexOf('await release()');
  assert.ok(teardownAt !== -1, 'run.mjs never calls teardownFixtureGround(');
  assert.ok(releaseAt !== -1, 'run.mjs never awaits release() — this door\'s own anchor moved');
  assert.ok(releaseAt > teardownAt, 'await release() must run AFTER the fixture-ground backstop — the lock is always released last');

  const tryAt = source.lastIndexOf('try {', teardownAt);
  assert.ok(
    tryAt !== -1,
    'expected a try { … } wrapping the fixture-ground backstop — a throw inside it must not be able to skip ' +
      'await release() (the same reason as the reap block above it)',
  );
  const tryBraceStart = source.indexOf('{', tryAt);
  const tryBraceEnd = matchingBraceEnd(source, tryBraceStart);
  assert.ok(
    tryBraceEnd !== -1 && tryBraceEnd > teardownAt,
    'the backstop\'s teardownFixtureGround( call must be textually INSIDE its own wrapping try block, not a ' +
      'try that belongs to an earlier, unrelated step (such as the reap above it)',
  );

  const afterTry = source.slice(tryBraceEnd + 1).trimStart();
  assert.match(afterTry, /^catch\b/, `the backstop's try block must be followed immediately by its own catch — found: ${JSON.stringify(afterTry.slice(0, 60))}`);
  const catchBraceStart = source.indexOf('{', tryBraceEnd + 1);
  const catchBraceEnd = matchingBraceEnd(source, catchBraceStart);
  assert.ok(catchBraceEnd !== -1, 'unmatched braces in the backstop\'s catch block');
  assert.ok(
    releaseAt > catchBraceEnd,
    'await release() must run AFTER the backstop\'s own catch block closes — a failure the backstop could not ' +
      'contain must still reach the lock release, or a stuck host lock outlives the run that broke it',
  );
});

// ── run-story.mjs — doors unchanged this round ─────────────────────────────

test('run-story.mjs: teardownFixtureGround runs AFTER the LAST classifyOwnGroundDrift call', () => {
  const source = readStripped('run-story.mjs');
  const lastDriftAt = source.lastIndexOf('classifyOwnGroundDrift(');
  const teardownAt = indexOfCall(source, 'teardownFixtureGround');

  assert.ok(lastDriftAt !== -1, 'classifyOwnGroundDrift( must appear in run-story.mjs — this door\'s own anchor moved');
  assert.ok(teardownAt !== -1, 'run-story.mjs never calls teardownFixtureGround(');
  assert.ok(teardownAt > lastDriftAt, `teardownFixtureGround( (at ${teardownAt}) must run AFTER the last classifyOwnGroundDrift( call (at ${lastDriftAt})`);
});

test('run-story.mjs: snapshotRealGrounds is called at least twice — once before the run, once after', () => {
  const source = readStripped('run-story.mjs');
  const count = (source.match(/snapshotRealGrounds\(/g) ?? []).length;
  assert.ok(count >= 2, `expected snapshotRealGrounds( at least twice — found ${count}`);
});

test('run-story.mjs: .summary is logged, teardown follows the LAST ownGroundManifest re-read, and the verdict\'s evidence reaches the artifact', () => {
  const source = readStripped('run-story.mjs');

  const verdictAt = source.indexOf('realGroundFenceVerdict(');
  assert.ok(verdictAt !== -1, 'run-story.mjs never calls realGroundFenceVerdict( (outside comments)');

  const summaryAt = source.indexOf('.summary', verdictAt);
  assert.ok(summaryAt !== -1, 'the verdict\'s .summary must be logged after it is computed — a fence nobody prints is a fence nobody reads');

  const lastOwnGroundAt = source.lastIndexOf('ownGroundManifest(');
  const teardownFixtureAt = indexOfCall(source, 'teardownFixtureGround');
  assert.ok(lastOwnGroundAt !== -1, 'ownGroundManifest( must appear in run-story.mjs — this door\'s own anchor moved');
  assert.ok(teardownFixtureAt !== -1, 'run-story.mjs never calls teardownFixtureGround(');
  assert.ok(
    teardownFixtureAt > lastOwnGroundAt,
    `teardownFixtureGround( (at ${teardownFixtureAt}) must run AFTER the LAST ownGroundManifest( call ` +
      `(at ${lastOwnGroundAt}) — tearing the fixture down before the own-ground re-read would make that ` +
      're-read see an empty directory',
  );

  assert.ok(
    source.includes('realGrounds'),
    'run-story.mjs never mentions realGrounds — the fence verdict\'s evidence must reach story.json for a ' +
      'fixture run, not only the console',
  );
});

test('run-story.mjs: realGrounds carries ONLY moved into the artifact — hashed and trees stay on the console only (forge-8vfn.26 class)', () => {
  const source = readStripped('run-story.mjs');
  const verdictAt = source.indexOf('realGroundFenceVerdict(');
  assert.ok(verdictAt !== -1, 'run-story.mjs never calls realGroundFenceVerdict( (outside comments)');

  const assignAt = source.indexOf('realGrounds = {', verdictAt);
  assert.ok(
    assignAt !== -1,
    'expected a `realGrounds = { … }` object-literal assignment after the fence verdict is computed — the ' +
      '`let realGrounds = null;` declaration alone does not carry the evidence into the artifact',
  );
  const braceStart = source.indexOf('{', assignAt);
  const braceEnd = matchingBraceEnd(source, braceStart);
  assert.ok(braceEnd !== -1, 'unmatched braces in the realGrounds assignment');
  const objectLiteral = source.slice(braceStart, braceEnd + 1);

  assert.doesNotMatch(
    objectLiteral,
    /\bhashed\s*:/,
    `realGrounds must not carry hashed — it counts this host's worktrees, not the product (forge-8vfn.26). Found: ${objectLiteral}`,
  );
  assert.doesNotMatch(
    objectLiteral,
    /\btrees\s*:/,
    `realGrounds must not carry trees — same reason. Found: ${objectLiteral}`,
  );
  assert.match(objectLiteral, /\bmoved\s*:/, `realGrounds must carry moved. Found: ${objectLiteral}`);
});

// ── THE MUTATION-PROOF FENCE DOOR ───────────────────────────────────────────
//
// Capture the variable `N` bound by `const N = realGroundFenceVerdict(`,
// require the literal statement `if (!N.ok)`, and require THAT statement's
// OWN `{ … }` block — found by counting braces to its matching `}`, not by
// searching past it — to itself contain `return 1`. A `return 1` anywhere
// else in the file, however close, cannot satisfy this.

/** The index of `source`'s matching `}` for the `{` at `openIndex`, or -1. */
function matchingBraceEnd(source: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The index of `source`'s matching `)` for the `(` at `openIndex`, or -1. */
function matchingParenEnd(source: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Replace the FIRST occurrence of `anchor` with `replacement`.
 * THROWS if the anchor is not found, rather than returning `source`
 * unchanged: a mutation test built on a silent no-op would keep "passing"
 * forever, having stopped proving anything the moment a refactor renamed or
 * moved the code it targets. Fail loudly instead, so THAT test reds and
 * says why.
 */
function replaceAnchor(source: string, anchor: string, replacement: string): string {
  const at = source.indexOf(anchor);
  if (at === -1) {
    throw new Error(`replaceAnchor: anchor not found — ${JSON.stringify(anchor)}`);
  }
  return source.slice(0, at) + replacement + source.slice(at + anchor.length);
}

/**
 * The span `[start, end)` of a call expression `calleeAnchor(...)` — from the
 * start of `calleeAnchor` (which must end in `(`) through its balanced
 * closing `)`. THROWS if the anchor, or a balanced close for it, cannot be
 * found — same loud-failure discipline as `replaceAnchor`.
 */
function findCallSpan(source: string, calleeAnchor: string): { start: number; end: number } {
  if (!calleeAnchor.endsWith('(')) {
    throw new Error(`findCallSpan: calleeAnchor must end in "(" — got ${JSON.stringify(calleeAnchor)}`);
  }
  const start = source.indexOf(calleeAnchor);
  if (start === -1) {
    throw new Error(`findCallSpan: anchor not found — ${JSON.stringify(calleeAnchor)}`);
  }
  const openParen = start + calleeAnchor.length - 1;
  const closeParen = matchingParenEnd(source, openParen);
  if (closeParen === -1) {
    throw new Error(`findCallSpan: no balanced closing ) for ${JSON.stringify(calleeAnchor)}`);
  }
  return { start, end: closeParen + 1 };
}

interface FenceGuardLocation {
  N: string;
  conditionStart: number;
  conditionEnd: number;
  braceStart: number;
  braceEnd: number;
}

/**
 * Find `const N = realGroundFenceVerdict(` and the `if (!N.ok) { … }`
 * statement that follows it, in ALREADY COMMENT-STRIPPED source. Returns
 * EITHER the location, OR `{ error }` naming EXACTLY which of the three
 * checks failed — never one generic message for all three, and never a
 * claim this function does not actually verify (the old message said the
 * block was required "immediately after" the DECLARATION; what is actually
 * required is that the block sit immediately after its OWN condition,
 * wherever in the file that condition is).
 */
function locateFenceGuard(strippedSource: string): FenceGuardLocation | { error: string } {
  const declMatch = /const\s+(\w+)\s*=\s*realGroundFenceVerdict\(/.exec(strippedSource);
  if (declMatch === null) {
    return { error: 'no `const N = realGroundFenceVerdict(` declaration found anywhere in the file' };
  }
  const N = declMatch[1];
  const ifMatch = new RegExp(`if\\s*\\(\\s*!\\s*${N}\\.ok\\s*\\)`).exec(strippedSource);
  if (ifMatch === null) {
    return { error: `found \`const ${N} = realGroundFenceVerdict(\`, but no \`if (!${N}.ok)\` anywhere in the file` };
  }
  const conditionStart = ifMatch.index;
  const conditionEnd = conditionStart + ifMatch[0].length;
  const braceStart = strippedSource.indexOf('{', conditionEnd);
  if (braceStart === -1 || strippedSource.slice(conditionEnd, braceStart).trim() !== '') {
    return {
      error:
        `found \`if (!${N}.ok)\`, but its condition is not immediately followed by a { … } block ` +
        '(only whitespace is allowed between the condition and the opening brace — a brace-less single-statement if does not count)',
    };
  }
  const braceEnd = matchingBraceEnd(strippedSource, braceStart);
  if (braceEnd === -1) {
    return { error: `found \`if (!${N}.ok) {\`, but its block's braces never balance to a matching }` };
  }
  return { N, conditionStart, conditionEnd, braceStart, braceEnd };
}

/** The door itself: does `source` contain a `const N = realGroundFenceVerdict(`
 *  whose `if (!N.ok) { … }` block itself contains `return 1`? Parametrised on
 *  SOURCE TEXT (not a fixed file) so the SAME instrument can be pointed at
 *  the real file, or at a mutated copy, from a test. */
function fenceDoorVerdict(source: string): { ok: boolean; reason: string } {
  const stripped = stripComments(source);
  const loc = locateFenceGuard(stripped);
  if ('error' in loc) {
    return { ok: false, reason: loc.error };
  }
  const block = stripped.slice(loc.braceStart, loc.braceEnd + 1);
  if (!/\breturn\s+1\b/.test(block)) {
    return {
      ok: false,
      reason:
        `found \`if (!${loc.N}.ok) { … }\`, but its own block does not contain a \`return 1\` — found: ` +
        `${JSON.stringify(block.length > 160 ? `${block.slice(0, 160)}…` : block)}`,
    };
  }
  return { ok: true, reason: `if (!${loc.N}.ok) { … return 1 … } found, guarding the run's exit code` };
}

function fenceDoorVerdictForFile(path: string) {
  return fenceDoorVerdict(readFileSync(path, 'utf8'));
}

test('run-story.mjs: if (!N.ok) { … return 1 … } — the fence\'s red must sit INSIDE its own guard, not a nearby unrelated return', () => {
  const v = fenceDoorVerdictForFile(join(HERE, 'run-story.mjs'));
  assert.equal(
    v.ok,
    true,
    `${v.reason}\n\nThe FIRST return 1 after the ` +
      'FIRST .ok in this file belongs to the unrelated own-ground undeclared-drift red — this door refuses that ' +
      'coincidence and requires the return to be structurally INSIDE the .ok check\'s own block.',
  );
});

test('the fence door\'s own instrument: GREEN on a correctly-shaped guard, RED when its condition is malformed or its block is empty', () => {
  // Positive and negative controls built from SYNTHETIC, fully-controlled
  // source — proof the checker itself can pass, before it is ever pointed at
  // a real or mutated file.
  const good = 'const fenceVerdict = realGroundFenceVerdict(a, b);\nif (!fenceVerdict.ok) {\n  log();\n  return 1;\n}\n';
  assert.equal(fenceDoorVerdict(good).ok, true);

  const noReturn = 'const fenceVerdict = realGroundFenceVerdict(a, b);\nif (!fenceVerdict.ok) {\n  log();\n}\n';
  assert.equal(fenceDoorVerdict(noReturn).ok, false, 'a block with no return 1 must be RED');

  const noDecl = 'if (!fenceVerdict.ok) {\n  return 1;\n}\n';
  assert.equal(fenceDoorVerdict(noDecl).ok, false, 'with no `const N = realGroundFenceVerdict(`, N cannot be bound at all');

  const braceless = 'const fenceVerdict = realGroundFenceVerdict(a, b);\nif (!fenceVerdict.ok) return 1;\n';
  assert.equal(fenceDoorVerdict(braceless).ok, false, 'a brace-less if has no block for the requirement to find');
});

/**
 * The door's mutation-proofness, pinned as a test in its own right: a door
 * guarding a refusal ships with its mutation transcript, and here that
 * transcript is executable, not prose.
 *
 * Three mutants of the REAL `run-story.mjs`, each built via EXACT anchor
 * replacement (never a hand-typed guess, never a fuzzy regex substitution
 * that could silently match the wrong thing or nothing at all):
 *
 *   (a) DELETE  — the whole `if (!N.ok) { … }` statement removed.
 *   (b) NEUTER  — `if (!N.ok)` replaced with `if (false)`.
 *   (c) STUB    — the `realGroundFenceVerdict(` CALL ITSELF (found by
 *       balanced-paren matching, so its actual argument list never has to be
 *       guessed) replaced with a hand-written verdict object literal,
 *       `{ ok: true, moved: [] }`.
 *
 * Mutant (c) pins why `run-story.mjs` makes exactly ONE
 * `realGroundFenceVerdict(` call. With two bindings under one name, stubbing
 * only the gating call would leave the door green while the run's exit code
 * stopped reflecting reality: the door binds `N` from the FIRST declaration
 * and never checks that the `if` it finds reads the SAME call. With one call,
 * stubbing it removes the `const N = realGroundFenceVerdict(` the door needs,
 * so `locateFenceGuard` cannot bind `N` at all.
 *
 * All three mutants must be RED; the real, unmutated file must be GREEN.
 */
test('the fence door is a mutation-proof gate: RED on (a) deleted, (b) neutered and (c) stubbed guards, GREEN on the real file', () => {
  const real = readStripped('run-story.mjs');

  const realVerdict = fenceDoorVerdict(real);
  assert.equal(realVerdict.ok, true, `the real, unmutated file must be GREEN: ${realVerdict.reason}`);

  const loc = locateFenceGuard(real);
  if ('error' in loc) {
    throw new Error(`this test's own precondition failed — could not locate the real guard: ${loc.error}`);
  }

  const conditionText = real.slice(loc.conditionStart, loc.conditionEnd);
  // The FULL CONTIGUOUS span from the condition through its block's closing
  // `}` — sliced as ONE piece, not `conditionText` and the block text
  // concatenated separately, which would silently drop whatever sits BETWEEN
  // them (here, the single space in `if (!realFence.ok) {`) and make the
  // anchor fail to match anything in `real` at all.
  const guardText = real.slice(loc.conditionStart, loc.braceEnd + 1);

  // (a) DELETE — remove `if (!N.ok) { … }` (condition + its own block) entirely.
  const deleted = replaceAnchor(real, guardText, '');
  const deletedVerdict = fenceDoorVerdict(deleted);
  assert.equal(deletedVerdict.ok, false, `(a) deleting the if block must be RED, got GREEN: ${deletedVerdict.reason}`);

  // (b) NEUTER — the exact captured condition text, replaced with `if (false)`.
  const neutered = replaceAnchor(real, conditionText, 'if (false)');
  const neuteredVerdict = fenceDoorVerdict(neutered);
  assert.equal(neuteredVerdict.ok, false, `(b) neutering !N.ok to false must be RED, got GREEN: ${neuteredVerdict.reason}`);

  // (c) STUB — the realGroundFenceVerdict( CALL (callee through its balanced
  // closing paren, whatever its actual arguments are) replaced with a
  // hand-written verdict.
  const span = findCallSpan(real, 'realGroundFenceVerdict(');
  const stubbed = real.slice(0, span.start) + '{ ok: true, moved: [] }' + real.slice(span.end);
  const stubbedVerdict = fenceDoorVerdict(stubbed);
  assert.equal(stubbedVerdict.ok, false, `(c) stubbing the realGroundFenceVerdict( call must be RED, got GREEN: ${stubbedVerdict.reason}`);
});

test('replaceAnchor and findCallSpan FAIL LOUDLY when their anchor is not found, rather than silently producing a no-op mutant', () => {
  assert.throws(() => replaceAnchor('const x = 1;', 'NOPE_NOT_HERE', 'y'), /anchor not found/);
  assert.throws(() => findCallSpan('const x = 1;', 'notACall('), /anchor not found/);
  assert.throws(() => findCallSpan('foo(bar', 'foo('), /no balanced closing \)/);
});

// Finding row 75 × D1 (the #906 rebase): `reapCensusAndSweep` REFUSES the
// trailing sweep while a writer from this run is still alive. The fixture
// ground's teardown is an `rmSync` of `projects/<project>`, so it must honour the
// same refusal — tearing a ground down under a live writer is the exact race
// the census exists to close. Refused → the ground stays as evidence and the
// next run's leading sweep removes it.
test('the fixture-ground teardown is gated on the trailing census being empty', () => {
  const src = stripComments(readSource('run-story.mjs'));
  const call = src.indexOf('teardownFixtureGround(ROOT');
  assert.ok(call > 0, 'teardownFixtureGround is called');
  const guard = src.lastIndexOf('trailing.census.empty', call);
  assert.ok(guard > 0 && call - guard < 400, 'the teardown call sits inside a trailing.census.empty guard');
});
