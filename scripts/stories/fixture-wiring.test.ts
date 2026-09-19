/**
 * fixture-wiring.test.ts — the SOURCE-ORDER door for the fixture-ground
 * wiring in `run.mjs` / `run-story.mjs` (M7-D, D1 and its fix rounds).
 *
 * WHY A STATIC TEXT CHECK, following `module-wiring.test.ts`'s own precedent:
 * `run.mjs` and `run-story.mjs` boot a bridge, bind the host-global Studio
 * ports and drive a real browser — neither can run inside `npm test`, so a
 * wiring defect in them is invisible to every gate that DOES run there. But
 * ORDERING is not a behavioural question; it is a property of the SOURCE TEXT,
 * answerable by reading it, the same move `module-wiring.test.ts` makes for
 * "does this name resolve".
 *
 * COMMENTS ARE STRIPPED before every match below — the D1 review's finding
 * (I3): "the fixture-wiring run-story door passes if a comment contains
 * `teardownFixtureGround(`, because it uses the first `indexOf`." A mention
 * in a doc comment must never satisfy a door that exists to prove the CODE
 * does the thing the comment claims.
 *
 * FIX ROUND 2, T2 ruling 1 — THE FENCE DOOR MUST GO RED WHEN THE GUARD IS
 * REMOVED. The re-review (`d1-fix1-rereview.md`, I3) mutated `run-story.mjs`
 * two ways — deleted the fence's red block, and neutered its `.ok` check to
 * `if (!fenceVerdict.ok) { void 0; }` — and EVERY pinned door, including the
 * round-1 token-order check this file used to carry, stayed green: that check
 * was satisfied by `run-story.mjs`'s `return 1` for the UNRELATED own-ground
 * undeclared-drift red, which happens to sit after the first `.ok` read in
 * the file. `fenceDoorVerdict` replaces it with a STRUCTURAL requirement: `if
 * (!N.ok)`'s own `{ … }` block, found by brace-matching rather than the next
 * `return 1` anywhere downstream, must itself contain `return 1`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Block comments first (they can span lines and would otherwise swallow a
 *  following line-comment marker), then line comments. Not a general JS/TS
 *  parser — this codebase's own comment style (full-line `//…` and `/** … *​/`
 *  blocks, no `//` inside the string literals near these anchors) is all it
 *  has to survive, and it is verified against the real files below.
 *
 *  KNOWN FRAGILITY (re-review N5, not in this round's scope): a `/*`
 *  appearing inside a `//` line comment elsewhere in these files starts a
 *  "block comment" this regex does not close until the next real `*​/`, which
 *  can eat real code between them. N5's own measurement is that this only
 *  produces FALSE REDS, never a false green — the direction that makes a
 *  door merely fragile, not unsound — and it was checked directly (not
 *  assumed) not to affect any anchor either round touches. Left as
 *  documented debt, out of this round's four pinned items. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const readSource = (file: string) => readFileSync(join(HERE, file), 'utf8');
const readStripped = (file: string) => stripComments(readSource(file));
const indexOfCall = (source: string, name: string) => source.indexOf(`${name}(`);

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
      'batch-level rollback on a later story\'s refusal (I3/M1)',
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

/**
 * T2 ruling 4 — CRASH EVIDENCE SURVIVES. The backstop must tear down ONLY a
 * ground whose story never STARTED (provisioned, then a bridge refusal or
 * throw BEFORE `runStory` was ever entered for it) — a ground whose story
 * DID start and then crashed mid-beat must be LEFT for the operator to
 * inspect (`_architect/<sid>/…` and friends), not deleted by the very
 * teardown that is supposed to be a cleanup, not an evidence-destroyer. This
 * is ruling 356b's class, one level up: "the ground was removed before
 * anything read its own state" (re-review N4).
 *
 * PINNED AS A SOURCE DOOR, not a behavioural test, for the same reason as
 * every other run.mjs/run-story.mjs check here: this cannot be driven
 * through a browser inside `npm test`. Two structural facts, searched for
 * directly rather than assumed:
 *
 *   - a started-ids Set/Map is WRITTEN immediately before `await runStory(`
 *     — "immediately before" so no code can run between marking a story
 *     started and actually starting it, which is what would let a crash
 *     inside `runStory` leave a gap where the story still looks unstarted;
 *   - the backstop's `teardownFixtureGround(` call is GUARDED by reading
 *     that same structure (a `.has(` check) — never unconditional.
 */
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
      'found no .has( between finally and teardownFixtureGround(. Without it, a CRASHED story\'s ground is town ' +
      'down along with an unstarted one\'s, destroying the evidence ruling 356b exists to keep.',
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
      'await release() (N3: "wrap it anyway for the same reason as its neighbour", the reap block above it)',
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
      'fixture run, not only the console (I3/M3)',
  );
});

/**
 * T2 ruling 2 (`forge-8vfn.26` class, re-review N1) — `realGrounds` (the
 * object that reaches `story.json`, via `result`) must carry ONLY `moved`.
 * `hashed`/`trees` are facts about THIS HOST's worktree layout, not the
 * product; committing them makes a clean fixture run's `story.json` diff
 * against a stranger's checkout with a different worktree count.
 *
 * Scoped to the OBJECT LITERAL of the `realGrounds = { … }` ASSIGNMENT (found
 * by brace-matching, same technique as the fence door above), never the
 * whole file — `fenceVerdict.hashed`/`.trees` still exist and are read for
 * the CONSOLE summary line elsewhere in this function, unchanged this round,
 * and a whole-file substring search would false-red on that.
 */
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

// ── T2 ruling 1 — THE MUTATION-PROOF FENCE DOOR ────────────────────────────
//
// Replaces the round-1 token-order check ("realGroundFenceVerdict( … .ok …
// return 1", satisfied by the FIRST `return 1` anywhere after the FIRST
// `.ok`, wherever either occurs) with a STRUCTURAL one: capture the variable
// `N` bound by `const N = realGroundFenceVerdict(`, require the literal
// statement `if (!N.ok)`, and require THAT statement's OWN `{ … }` block —
// found by counting braces to its matching `}`, not by searching past it —
// to itself contain `return 1`. A `return 1` anywhere else in the file,
// however close, cannot satisfy this.

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

interface FenceGuardLocation {
  N: string;
  conditionStart: number;
  conditionEnd: number;
  braceStart: number;
  braceEnd: number;
}

/** Find `const N = realGroundFenceVerdict(` and the `if (!N.ok) { … }`
 *  statement that follows it, in ALREADY COMMENT-STRIPPED source. `null`
 *  when either the declaration or the exact `if (!N.ok)` shape is absent, or
 *  the condition is not immediately followed by a `{ … }` block (whitespace
 *  only between them — a brace-less single-statement `if` does not count:
 *  the ruling's own words are "whose block (up to its matching `}`)"). */
function locateFenceGuard(strippedSource: string): FenceGuardLocation | null {
  const declMatch = /const\s+(\w+)\s*=\s*realGroundFenceVerdict\(/.exec(strippedSource);
  if (declMatch === null) return null;
  const N = declMatch[1];
  const ifMatch = new RegExp(`if\\s*\\(\\s*!\\s*${N}\\.ok\\s*\\)`).exec(strippedSource);
  if (ifMatch === null) return null;
  const conditionStart = ifMatch.index;
  const conditionEnd = conditionStart + ifMatch[0].length;
  const braceStart = strippedSource.indexOf('{', conditionEnd);
  if (braceStart === -1 || strippedSource.slice(conditionEnd, braceStart).trim() !== '') return null;
  const braceEnd = matchingBraceEnd(strippedSource, braceStart);
  if (braceEnd === -1) return null;
  return { N, conditionStart, conditionEnd, braceStart, braceEnd };
}

/** The door itself: does `source` contain a `const N = realGroundFenceVerdict(`
 *  whose `if (!N.ok) { … }` block itself contains `return 1`? Parametrised on
 *  SOURCE TEXT (not a fixed file) so the SAME instrument can be pointed at
 *  the real file, or at a mutated copy, from a test (T2 ruling 1: "parametrise
 *  the door's source path so the test can be pointed at a file"). */
function fenceDoorVerdict(source: string): { ok: boolean; reason: string } {
  const stripped = stripComments(source);
  const loc = locateFenceGuard(stripped);
  if (loc === null) {
    return {
      ok: false,
      reason: 'no literal `if (!N.ok) { … }` block found immediately after a `const N = realGroundFenceVerdict(` assignment',
    };
  }
  const block = stripped.slice(loc.braceStart, loc.braceEnd + 1);
  if (!/\breturn\s+1\b/.test(block)) {
    return {
      ok: false,
      reason:
        `the if (!${loc.N}.ok) block does not itself contain a return 1 — found: ` +
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
    `${v.reason}\n\nThe re-review's own mutation (d1-fix1-rereview.md, I3) found the FIRST return 1 after the ` +
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
 * MUTATION TRANSCRIPT — T2 ruling 1: "a door guarding a refusal ships with
 * its mutation transcript" (M7-COMMON §6.5).
 *
 * Built from `run-story.mjs`'s OWN current text — never a hand-typed guess at
 * what the eventual fix will look like — by locating today's `const N =
 * realGroundFenceVerdict(` / `if (!N.ok) …`.
 *
 * TODAY'S SHAPE IS ITSELF BRACE-LESS — `if (!fenceVerdict.ok) realGroundMoved
 * = fenceVerdict.moved;`, no `{ }` at all — which is EXACTLY the shape this
 * whole door exists to refuse (there is no block for `return 1` to live
 * inside, so the door above is red for an even more direct reason than "the
 * block lacks a return"). So step (0) below MECHANICALLY wraps the existing
 * statement in `{ …; return 1; }` — the minimal realistic correction — to
 * build a "corrected" copy of the REAL file; steps (a) and (b) then mutate
 * THAT corrected copy:
 *
 *   (0) CORRECTED — the brace-less statement wrapped in `{ …; return 1; }`;
 *   (a) DELETED — the whole `if (!N.ok) { … }` statement removed;
 *   (b) NEUTERED — `if (!N.ok)` replaced with `if (false)`.
 *
 * (0) must be GREEN; (a) and (b) must both be RED. This proves the
 * instrument discriminates a present guard from an absent or gutted one —
 * independent of whether `run-story.mjs` itself is fixed yet (the test just
 * above already pins that, separately, against the real, unmutated file).
 */
test('MUTATION TRANSCRIPT: the fence door is GREEN on a corrected copy of run-story.mjs and RED on both a deleted and a neutered guard', () => {
  const stripped = readStripped('run-story.mjs');
  const declMatch = /const\s+(\w+)\s*=\s*realGroundFenceVerdict\(/.exec(stripped);
  assert.ok(declMatch !== null, 'expected to find `const N = realGroundFenceVerdict(` in run-story.mjs today');
  const N = declMatch[1];
  const ifMatch = new RegExp(`if\\s*\\(\\s*!\\s*${N}\\.ok\\s*\\)`).exec(stripped);
  assert.ok(ifMatch !== null, `expected to find \`if (!${N}.ok)\` in run-story.mjs today`);
  const conditionEnd = ifMatch.index + ifMatch[0].length;

  // (0) CORRECTED — wrap today's brace-less controlled statement in braces
  // and append `return 1;`. `indexOf(';', …)` is enough here because the
  // real statement (`realGroundMoved = fenceVerdict.moved`) contains no
  // nested `;`, `{` or `}` of its own — verified by the assertion right
  // after, which would fail loudly rather than silently mis-slice if that
  // ever stopped being true.
  const stmtEnd = stripped.indexOf(';', conditionEnd);
  assert.ok(stmtEnd !== -1, 'expected the brace-less statement to end in a semicolon');
  const corrected =
    `${stripped.slice(0, conditionEnd)} { ${stripped.slice(conditionEnd, stmtEnd + 1)} return 1; }${stripped.slice(stmtEnd + 1)}`;
  const correctedVerdict = fenceDoorVerdict(corrected);
  assert.equal(correctedVerdict.ok, true, `(0) corrected must be GREEN: ${correctedVerdict.reason}`);

  // Re-locate the guard IN THE CORRECTED COPY, which now has real braces, to
  // build the two mutants from a properly-shaped baseline.
  const correctedStripped = stripComments(corrected);
  const loc = locateFenceGuard(correctedStripped);
  assert.ok(loc !== null, 'expected the corrected copy to have a locatable if (!N.ok) { … } block');
  const at = loc as FenceGuardLocation;

  const deleted = correctedStripped.slice(0, at.conditionStart) + correctedStripped.slice(at.braceEnd + 1);
  const deletedVerdict = fenceDoorVerdict(deleted);
  assert.equal(deletedVerdict.ok, false, `(a) the if block deleted must be RED: got ok=${deletedVerdict.ok}`);

  const neutered = `${correctedStripped.slice(0, at.conditionStart)}if (false)${correctedStripped.slice(at.conditionEnd)}`;
  const neuteredVerdict = fenceDoorVerdict(neutered);
  assert.equal(neuteredVerdict.ok, false, `(b) !N.ok neutered to false must be RED: got ok=${neuteredVerdict.ok}`);
});
