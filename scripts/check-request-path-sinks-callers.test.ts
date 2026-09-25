/**
 * check-request-path-sinks-callers.test.ts — TDD contract for the
 * CALLER-COUNT DIMENSION, split out of check-request-path-sinks.test.ts
 * under the 800-line cap alongside its source module
 * (check-request-path-sinks-callers.mjs). No behaviour change — every case
 * here is unchanged from its prior home, only the file it lives in.
 *
 * 7.6.68 exercises the three ways a call site can name a designated
 * function (direct / aliased / namespace-qualified) against a synthetic
 * throwaway tree. SEC-04 (bd forge-ebj step 2) exercises the caller-count
 * dimension end-to-end through runCheck() against a synthetic fixture
 * repo, and the registry's own completeness.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { countDesignatedCallers, DESIGNATED_UNGUARDED_FUNCTIONS } from './check-request-path-sinks-callers.mjs';
import { findReachableModules, analyze, runCheck } from './check-request-path-sinks.mjs';

// =============================================================================
// 7.6.68 — the designated-caller ratchet and the three ways to name a call
// =============================================================================
//
// MEASURED AGAINST THE REAL CHECK BEFORE ANY OF THIS WAS WRITTEN, by adding a
// caller to a real reachable module and running it:
//
//     writeSessionStatus(dir, …)                       FAIL rc=1   caught
//     import { writeSessionStatus as X }; X(dir, …)     rc=0        EVADED
//     import * as NS; NS.writeSessionStatus(dir, …)     rc=0        EVADED
//
// The matcher matched the CALL-SITE NAME, and an import renames the call site.
// `(?<![.\w$])` excludes dotted calls by design, so the namespace form was
// doubly invisible. Neither evasion needs intent — `import { X as Y }` is what
// people write for a name collision (§15.534).

/** One reachable file whose body is `body`, in a throwaway tree. */
function callerFixture(body: string): string {
  const root = mkdtempSync(join(tmpdir(), 'sinks-caller-'));
  mkdirSync(join(root, 'cli'), { recursive: true });
  mkdirSync(join(root, 'orchestrator'), { recursive: true });
  writeFileSync(join(root, 'orchestrator/interactive-session.ts'),
    'export function writeSessionStatus(d: string, s: object) { return d + JSON.stringify(s); }\n');
  writeFileSync(join(root, 'cli/ui-bridge.ts'), body);
  return root;
}

function callerCountFor(body: string): number {
  const root = callerFixture(body);
  try {
    const rows = countDesignatedCallers(root, ['cli/ui-bridge.ts']);
    return rows.filter((r: { sink: string }) => r.sink.startsWith('writeSessionStatus')).reduce(
      (n: number, r: { count: number }) => n + r.count, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('7.6.68: a DIRECT call is counted (the case that already worked)', () => {
  assert.equal(callerCountFor(
    "import { writeSessionStatus } from '../orchestrator/interactive-session.ts';\n" +
    'export function h(d: string) { return writeSessionStatus(d, {}); }\n'), 1);
});

test('7.6.68: an ALIASED import is counted — the rename that evaded it', () => {
  // `import { X as Y }` is what someone writes to resolve a collision, not to
  // hide. Before this, the call site read `writeStatus(` and the matcher — which
  // looks for the literal designated name — never saw it. rc=0, silent.
  assert.equal(callerCountFor(
    "import { writeSessionStatus as writeStatus } from '../orchestrator/interactive-session.ts';\n" +
    'export function h(d: string) { return writeStatus(d, {}); }\n'), 1);
});

test('7.6.68: a NAMESPACE import is counted — doubly invisible before', () => {
  // `(?<![.\w$])` excludes dotted calls BY DESIGN, so `NS.writeSessionStatus(`
  // could not match even by accident.
  assert.equal(callerCountFor(
    "import * as S from '../orchestrator/interactive-session.ts';\n" +
    'export function h(d: string) { return S.writeSessionStatus(d, {}); }\n'), 1);
});

test('7.6.68: a file that calls nothing designated stays at zero', () => {
  // THE NEGATIVE CONTROL, and it is not ceremony: the widened matcher now
  // builds regexes from every import in the file, so a file importing an
  // UNRELATED symbol — or a namespace whose module declares no designated
  // function — must still count zero. Without this, "counts everything" would
  // pass all three doors above.
  //
  // IT CARRIES AN ALIASED IMPORT OF AN UNRELATED SYMBOL ON PURPOSE, and the
  // mutation pass is why. Dropping the `imported === name` test — so every
  // aliased import binds to every designated name — left this door GREEN when
  // its body had no alias to mis-bind; only the real-repository baseline door
  // caught it. A negative control that cannot see the over-match direction is
  // not a control for it.
  assert.equal(callerCountFor(
    "import * as Other from '../orchestrator/interactive-session.ts';\n" +
    "import { readFileSync as rf } from 'node:fs';\n" +
    "export function h(d: string) { return Other.somethingElse(d) + rf(d); }\n"), 0);
});

// =============================================================================
// Group 3 — SEC-04 caller-count dimension (the systemic hole this ratchet has)
//
// The ratchet keys on (file, RAW-SINK, count). A NEW file that only *calls* an
// already-unguarded shared function in a DIFFERENT module — e.g.
// `readSessionStatus(join(root, reqProject, sid))` — introduces the exact SEC-04
// defect while emitting ZERO raw-sink rows of its own, so the ratchet stays
// green. bd forge-ebj step 2 asks for a caller-count dimension: count callers of
// a designated set of unguarded functions (readSessionStatus / writeSessionStatus
// and the bare-join builders architectSessionDir / instructionsSessionDir /
// projectBrainSessionDir / demoSessionDir), and fail when a NEW reachable caller
// appears.
// =============================================================================

/** Fixture: apps/forge/ui-bridge.ts (entry) imports a def module that DEFINES the
 *  designated shared fns (with real raw sinks tracked in ITS file), and also
 *  imports a `new-caller.ts` that does NOT exist yet (addNewCaller plants it).
 *  Returns the fixture root. */
function makeCallerFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'sinks-caller-fixture-'));
  mkdirSync(join(root, 'cli'), { recursive: true });
  mkdirSync(join(root, 'orchestrator'), { recursive: true });

  // Entry: import edges only (re-export lines carry no `(` → never counted as
  // callers themselves). The '../orchestrator/new-caller.ts' target is absent at
  // baseline time; the walker skips missing targets, so it is NOT baselined.
  writeFileSync(
    join(root, 'cli/ui-bridge.ts'),
    [
      "import { readSessionStatus, instructionsSessionDir } from '../orchestrator/session-def.ts';",
      "import { handleNew } from '../orchestrator/new-caller.ts';",
      'export { readSessionStatus, instructionsSessionDir, handleNew };',
      '',
    ].join('\n')
  );

  // The def module: DEFINES the designated fns; its raw fs sinks (existsSync,
  // readFileSync) are the tracked rows that populate the baseline.
  writeFileSync(
    join(root, 'orchestrator/session-def.ts'),
    [
      "import { existsSync, readFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      'export function instructionsSessionDir(projectRoot, sessionId) {',
      "  return join(projectRoot, '_instructions', sessionId);",
      '}',
      'export function readSessionStatus(sessionDir) {',
      "  const p = join(sessionDir, 'status.json');",
      '  if (!existsSync(p)) return null;',
      "  return JSON.parse(readFileSync(p, 'utf8'));",
      '}',
      '',
    ].join('\n')
  );

  return root;
}

/** Plant the NEW reachable caller: it CALLS the designated `readSessionStatus`
 *  on a bare-joined request-derived path, but has NO raw fs sink of its own
 *  (`readSessionStatus` and `join` are not in SINK_NAMES). */
function addNewCaller(root: string): void {
  writeFileSync(
    join(root, 'orchestrator/new-caller.ts'),
    [
      "import { readSessionStatus } from './session-def.ts';",
      "import { join } from 'node:path';",
      'export function handleNew(root, reqProject, sid) {',
      '  return readSessionStatus(join(root, reqProject, sid));',
      '}',
      '',
    ].join('\n')
  );
}

test('caller-count ratchet: a NEW file that only CALLS a designated unguarded fn (no raw sink of its own) FAILS', () => {
  const root = makeCallerFixture();
  const baselinePath = join(root, 'baseline.txt');
  try {
    // Baseline captured while only the entry + def module exist (new caller absent).
    assert.equal(runCheck({ root, baselinePath, write: true }), 0);
    assert.equal(runCheck({ root, baselinePath }), 0, 'sanity: clean immediately after --write');

    addNewCaller(root);

    // --- preconditions FIRST (false-negative discipline) ---
    const reachable = findReachableModules(root);
    assert.ok(
      reachable.includes('orchestrator/new-caller.ts'),
      'the new caller must be reachable from the bridge entry',
    );
    const { rows } = analyze(root);
    assert.ok(
      !rows.some((r) => r.file === 'orchestrator/new-caller.ts'),
      'the new caller must emit NO per-file raw-sink row — so a FAIL cannot come from an accidental raw sink, only from the caller-count dimension',
    );
    assert.ok(
      rows.some((r) => r.file === 'orchestrator/session-def.ts'),
      'fixture sanity: the def module contributes tracked raw-sink rows to the baseline',
    );

    // The caller-count dimension must trip exit 1.
    assert.equal(
      runCheck({ root, baselinePath }),
      1,
      'a new reachable caller of a designated unguarded fn must fail the ratchet',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('caller-count ratchet: the designated-unguarded-fn registry is present and complete', () => {
  const designated: Record<string, unknown> = DESIGNATED_UNGUARDED_FUNCTIONS;
  assert.ok(
    designated,
    'expected a DESIGNATED_UNGUARDED_FUNCTIONS export naming the shared fns whose callers the ratchet must count',
  );
  const names = new Set<string>(Object.keys(designated));
  for (const fn of [
    'readSessionStatus',
    'writeSessionStatus',
    'architectSessionDir',
    'instructionsSessionDir',
    'projectBrainSessionDir',
    'demoSessionDir',
  ]) {
    assert.ok(names.has(fn), `DESIGNATED_UNGUARDED_FUNCTIONS must designate ${fn}`);
  }
});
