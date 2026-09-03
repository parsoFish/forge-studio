/**
 * Enforcement lock for the spawn marker's one bypass — bead `forge-8vfn.5.50`,
 * ruling 69's condition.
 *
 * THE INVARIANT. `runAgent` resolves its query through `resolveRunQuery`
 * (`./pinned-sdk-query.ts`), which wraps the PRODUCTION query so every child
 * carries this run's marker, and returns an INJECTED query verbatim. Returning
 * an injected query unwrapped is deliberate and load-bearing: it is what keeps
 * the eleven spawn-capture goldens byte-identical, because a capturing stub
 * records the phase's own option bag rather than the runtime's env delta.
 *
 * THE RISK THAT CREATES. `RunContext.queryFn` is documented "test-injection
 * only", and today every production phase honours that — but nothing enforced
 * it. A future phase that started passing a real query would SILENTLY drop the
 * marker from its spawns: no test would fail, no gate would move, and the
 * escape 5.50 closes would quietly reopen for that phase alone. Exactly the
 * declared-data-fails-open class this campaign keeps finding (COMMON §15.28).
 *
 * THE RULE ENFORCED. In every non-test source file under the scanned dirs,
 * each `queryFn:` property whose value is a plain identifier expression must
 * be a PASS-THROUGH of a caller-supplied optional field — `<obj>.queryFn`,
 * `<obj>.sdkQuery`, or the literal `undefined` — and never a concrete query
 * value (an import, a local closure, a module binding). A pass-through can
 * only be defined if some CALLER supplied it, and the caller chain terminates
 * at an optional field production leaves unset; a concrete value is
 * unconditionally injected, which is the shape that silently drops the marker.
 *
 * WHAT THIS DOES NOT CLAIM. It is a structural lint, not a proof: a phase
 * could still default its own optional field to a concrete query
 * (`opts.queryFn ?? somethingReal`) and pass the pass-through. That shape is
 * caught by review, not here — and it would at least be visible at the
 * defaulting site rather than invisible at the spawn. The lock closes the
 * silent case, which is the one that has actually bitten.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FORGE_ROOT } from '@forge/kernel/ids.ts';

// §15.14 / bead `forge-8vfn.5.47`: anchored on kernel's FORGE_ROOT, never on
// `'..'` arithmetic from this file's own location. The previous form was
// correct ONLY at this file's current depth, and the re-bucket into
// `tests/<bucket>/` moves it — at which point a scanner keyed on a wrong root
// walks an EMPTY tree and reports zero findings, which reads as a pass.
const ROOT = FORGE_ROOT;

/** Directories scanned for the pass-through invariant. */
const SCANNED_DIRS = ['orchestrator', 'loops', 'cli', 'packages', 'apps/forge'];

const SOURCE_FILE_RE = /\.(ts|tsx|mts|cts)$/;
const DECLARATION_FILE_RE = /\.d\.(ts|mts|cts)$/;
const TEST_FILE_RE = /\.test\.(ts|tsx|mts|cts)$/;

/**
 * The two files that legitimately name a concrete query in a `queryFn:`
 * position: the seam that DOES the marking, and the adapter's own
 * `opts.queryFn ?? sdkQuery` default — which spawns through `pinnedSdkQuery`
 * and is reached from `runAgent` only via `resolveRunQuery`, so its children
 * are marked by the wrapper above it.
 */
const EXEMPT_FILES = new Set(['packages/agents/pinned-sdk-query.ts', 'packages/agents/ralph/claude-agent.ts']);

/**
 * The allowed value shapes: a pass-through of a caller-supplied optional field
 * (`<obj>.queryFn` / `<obj>.sdkQuery`), the literal `undefined`, or a call to
 * `resolveRunQuery(...)` — the seam that DOES the marking.
 */
const PASS_THROUGH_RE =
  /^(?:undefined|resolveRunQuery\(.*|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.(?:queryFn|sdkQuery))$/;

/**
 * Known concrete injections, each with the reason it is not a 5.50 regression.
 * An entry here is a DISCLOSED unmarked spawn path, not an absolution — adding
 * one means saying, in the PR that adds it, which children lose the marker.
 */
const DISCLOSED_INJECTIONS = new Map([
  [
    'packages/factory/phases/developer-loop.ts: queryFn: tallyingQueryFn',
    "the dev loop hands its own cost-tallying wrapper straight to createClaudeAgent, bypassing runAgent entirely, so a dev-loop Ralph child carries no marker. Closing it is a one-line wrap at that call site in packages/factory — a different package, so a handoff (filed with A1), not something this lane may repoint.",
  ],
]);

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter(
      (e) =>
        e.isFile() &&
        SOURCE_FILE_RE.test(e.name) &&
        !DECLARATION_FILE_RE.test(e.name) &&
        !TEST_FILE_RE.test(e.name),
    )
    .map((e) => join((e as unknown as { parentPath: string }).parentPath, e.name));
}

/** Blank line and block comments, preserving line structure. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, lead: string) => lead);
}

test('5.50 LOCK: no production file injects a CONCRETE queryFn — an injected query is returned unwrapped and would carry no spawn marker', () => {
  const offenders: string[] = [];
  const passThroughs: string[] = [];
  const disclosed: string[] = [];

  for (const dirName of SCANNED_DIRS) {
    for (const absPath of collectSourceFiles(join(ROOT, dirName))) {
      const rel = relative(ROOT, absPath).split('\\').join('/');
      if (EXEMPT_FILES.has(rel)) continue;
      const source = stripComments(readFileSync(absPath, 'utf8'));
      // Property position only (`queryFn: <expr>`), never a type annotation
      // (`queryFn: QueryFn` in a type literal reads identically, so the value
      // pattern below is what separates them — a bare capitalised type name is
      // neither a pass-through nor a call, and is filtered by the type check).
      for (const m of source.matchAll(/\bqueryFn:\s*([^,;)}\n]+)/g)) {
        const raw = (m[1] ?? '').trim();
        // A VARIABLE DECLARATION with a type annotation (`const queryFn:
        // QueryFn = …`) reads identically to a property but injects nothing
        // into a spawn call — it declares the local a runner then passes on.
        const before = source.slice(Math.max(0, m.index - 12), m.index);
        if (/\b(?:const|let|var)\s+$/.test(before)) continue;
        // A type annotation in an interface/type literal: a bare identifier
        // that is not a member expression. Those declare the field; they do
        // not inject a value.
        if (/^[A-Z][\w$]*$/.test(raw)) continue;
        if (PASS_THROUGH_RE.test(raw)) {
          passThroughs.push(`${rel}: ${raw}`);
          continue;
        }
        const key = `${rel}: queryFn: ${raw}`;
        if (DISCLOSED_INJECTIONS.has(key)) {
          disclosed.push(key);
          continue;
        }
        offenders.push(key);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'a production call site injects a concrete queryFn. `resolveRunQuery` returns an injected query VERBATIM (deliberately — it is what keeps the spawn-capture goldens byte-identical), so those spawns carry no FORGE_AGENT_RUN_MARKER and a leaked child of that run is unsweepable. Pass the value through an optional field production leaves undefined, or mark the spawn explicitly.',
  );

  // A lock that matched nothing would pass forever. The pass-through census
  // proves the scanner reaches the real call sites.
  assert.ok(
    passThroughs.length >= 5,
    `the scanner found only ${passThroughs.length} queryFn pass-throughs — it is no longer reaching the phase call sites: ${JSON.stringify(passThroughs)}`,
  );

  // Every disclosed exception must still EXIST. One that has gone stale is a
  // path someone fixed (or moved) without retiring its waiver, and a waiver
  // nobody can see the subject of is how a real injection later hides behind
  // an entry that no longer means anything.
  assert.deepEqual(
    [...DISCLOSED_INJECTIONS.keys()].filter((k) => !disclosed.includes(k)),
    [],
    'a disclosed queryFn injection no longer exists — delete its entry rather than leaving a waiver with no subject',
  );
});

test('5.50 LOCK positive control: a planted concrete injection IS detected', () => {
  // The detector, applied to a synthetic source, must flag the exact shape the
  // lock exists to prevent — otherwise the assertion above passes vacuously.
  const planted = "const t = runAgent(def, { runId, workdir, prompt, queryFn: pinnedStreamQuery });";
  const matches = [...stripComments(planted).matchAll(/\bqueryFn:\s*([^,;)}\n]+)/g)].map((m) => (m[1] ?? '').trim());
  assert.deepEqual(matches, ['pinnedStreamQuery']);
  assert.equal(PASS_THROUGH_RE.test('pinnedStreamQuery'), false, 'a bare module binding must NOT read as a pass-through');
  assert.equal(PASS_THROUGH_RE.test('opts.queryFn'), true);
  assert.equal(PASS_THROUGH_RE.test('deps.sdkQuery'), true);
  assert.equal(PASS_THROUGH_RE.test('undefined'), true);
});
