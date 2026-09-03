/**
 * SEC-07 acceptance pins: `cmdAgentDispatch` (`cli/agent-run.ts`) must route an
 * untrusted `--project` value through the shared containment guard as its OWN
 * segment under the trusted projects root, never fold it into the root before
 * any containment check runs. See `cli/studio-path-guard.ts`'s CONTRACT and the
 * already-guarded pattern in `cmdAgentRun` (same file) for the shape this
 * mirrors.
 *
 * The real sink these tests pin: the value `cmdAgentDispatch` builds into
 * `project.repoPath` becomes the spawned agent's working directory downstream
 * (`opts.project?.repoPath` → `workdir` in `orchestrator/agent-dispatch.ts`).
 * The invariant every escaping case asserts is therefore: the spawned agent's
 * working directory can never resolve outside the projects root — EITHER the
 * guard refused before any dispatch (exit 2 + a containment message, nothing
 * captured), OR the captured `repoPath` realpaths to a location strictly
 * inside the projects root.
 *
 * A fake `dispatch` is injected to CAPTURE what would have been spawned without
 * ever launching a real agent turn. `FORGE_ARCHITECT_NO_SPAWN=1` is belt-and-
 * suspenders on top of that.
 *
 * PUBLIC-REPO NOTE: neutral naming throughout — these describe what the guard
 * REJECTS (a traversal-shaped name, a symlinked name whose identity does not
 * match its expected location), not any onward path.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  realpathSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { cmdAgentDispatch } from '../../agent-dispatch-cmd.ts';
import { defaultConfigPath, loadConfig, resolveProjectsDir } from '@forge/kernel';

process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
// resolveProjectsDir honours FORGE_PROJECTS_DIR first; a stray value in the
// ambient env would point the computed projects root somewhere other than the
// fixture's own `projects/`. Clear it so the root is `<forgeRoot>/projects`,
// matching where each fixture plants its dirs and exactly what the fix will
// compute via resolveProjectsDir(resolve(forgeRoot), loadConfig(...)).
delete process.env.FORGE_PROJECTS_DIR;

/** A rejection reason naming the offending shape — mirrors the containment
 *  vocabulary already established by `resolveGuardedPath`'s own `reason`
 *  strings and `cmdAgentRun`'s own error text. */
const CONTAINMENT_RE = /is not a valid project name|unsafe path segment|identity mismatch|containment|escapes/i;

/** A slug that is NOT a standalone band agent (demo-agent / adversarial-review),
 *  so the dispatch reaches the injected `dispatch` seam rather than the
 *  band-agent standalone pipeline. */
const SLUG = 'some-agent';
const RUN_ID = 'sec07-fixture-run';

type Captured = { project?: { name: string; repoPath: string } } | null;

/** Injected dispatch: captures the opts (the real spawn sink) and returns a
 *  suppressed result so `cmdAgentDispatch` prints its summary and returns
 *  cleanly, with no real agent turn. */
function makeDeps(sink: { captured: Captured }) {
  return {
    dispatch: (async (opts: { slug: string; runId: string; project?: { name: string; repoPath: string } }) => {
      sink.captured = opts as Captured;
      return { slug: opts.slug, runId: opts.runId, result: { suppressed: true, costUsd: 0 } };
    }) as never,
  };
}

/** Drive `cmdAgentDispatch`, stubbing `process.exit`/console so a refusal's
 *  `process.exit(2)` returns control (via a sentinel throw) rather than
 *  tearing down the runner. Mirrors the SEC-06 sibling suite's `run()`. */
async function run(
  args: string[],
  forgeRoot: string,
  deps: ReturnType<typeof makeDeps>,
): Promise<{ exitCode: number | null; out: string; err: string }> {
  const origExit = process.exit;
  const origLog = console.log;
  const origErr = console.error;
  let exitCode: number | null = null;
  const out: string[] = [];
  const err: string[] = [];
  process.exit = ((code?: number) => { exitCode = code ?? 0; throw new Error(`__exit__${exitCode}`); }) as typeof process.exit;
  console.log = (...a: unknown[]) => { out.push(a.join(' ')); };
  console.error = (...a: unknown[]) => { err.push(a.join(' ')); };
  try {
    await cmdAgentDispatch(args, forgeRoot, deps);
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    if (!/^__exit__/.test(msg)) err.push(msg);
  } finally {
    process.exit = origExit;
    console.log = origLog;
    console.error = origErr;
  }
  return { exitCode, out: out.join('\n'), err: err.join('\n') };
}

/** chdir for the duration of `fn`, always restoring. Load-bearing: the
 *  unguarded branch's `resolve('projects', projectArg)` is cwd-relative, so
 *  the fixture forgeRoot must also be the process cwd for the call. */
async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(prev);
  }
}

function setupForgeRoot(): string {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'sec07-dispatch-guard-'));
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  return forgeRoot;
}

/** The projects root the fix will compute — the same SSOT
 *  (`resolveProjectsDir`) the guarded `cmdAgentRun` road already uses. */
function projectsRootOf(forgeRoot: string): string {
  return resolveProjectsDir(resolve(forgeRoot), loadConfig(defaultConfigPath(forgeRoot)));
}

/** CORE invariant: a dispatch that happened must carry a `repoPath` whose
 *  realpath is strictly inside the projects root. `captured === null` (guard
 *  refused before dispatch) is contained by construction. FAILS (red) if a
 *  dispatch happened with an out-of-root realpath. */
function assertRepoPathContained(captured: Captured, projectsRoot: string): void {
  if (captured === null) return;
  assert.ok(captured.project, 'a dispatch that happened must carry a project binding to inspect');
  const realRepo = realpathSync(captured.project.repoPath);
  const realRoot = realpathSync(projectsRoot);
  const rel = relative(realRoot, realRepo);
  // Segment-boundary escape test: a bare `..` or a `..` first SEGMENT escapes;
  // a name that merely starts with the two dots (e.g. `..foo`) does NOT.
  const escapes = rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel);
  const contained = realRepo === realRoot || !escapes;
  assert.ok(
    contained,
    `the spawned agent's working directory escaped the projects root — realpath ${realRepo} is not inside ${realRoot}`,
  );
}

/** IDENTITY invariant (for the cross-object alias case): a dispatch that
 *  happened must carry a `repoPath` whose realpath equals its EXPECTED
 *  in-root location `<realProjectsRoot>/<name>` — an in-root name whose
 *  symlink redirects to a DIFFERENT in-root object is an identity mismatch. */
function assertRepoPathIdentity(captured: Captured, projectsRoot: string, expectedName: string): void {
  if (captured === null) return;
  assert.ok(captured.project, 'a dispatch that happened must carry a project binding to inspect');
  const expected = join(realpathSync(projectsRoot), expectedName);
  const actual = realpathSync(captured.project.repoPath);
  assert.equal(
    actual, expected,
    `dispatched repoPath identity ${actual} ≠ expected ${expected} — a name aliasing a different in-root object must be refused`,
  );
}

// ---------------------------------------------------------------------------
// Cases 1-4 — red-now: each must fail on the unguarded branch and pass once an
// escaping `--project` value is refused before it is resolved into a repoPath.
// ---------------------------------------------------------------------------

test('rejects an absolute --project value (the repoPath would land outside the projects root)', async () => {
  const forgeRoot = setupForgeRoot();
  const outside = mkdtempSync(join(tmpdir(), 'sec07-abs-outside-'));
  try {
    assert.ok(existsSync(outside), 'fixture precondition: the absolute escape target must exist so existsSync passes on the unguarded branch');
    const sink = { captured: null as Captured };
    const r = await withCwd(forgeRoot, () => run([SLUG, '--run-id', RUN_ID, '--project', outside], forgeRoot, makeDeps(sink)));
    // CORE invariant — red now: on the unguarded branch a dispatch happens with
    // repoPath === the outside absolute path (escapes).
    assertRepoPathContained(sink.captured, projectsRootOf(forgeRoot));
    // Refusal shape the fix adds.
    assert.equal(r.exitCode, 2, `an absolute --project value must be refused with exit 2 — got exit(${r.exitCode}), stderr: ${r.err}`);
    assert.match(r.err, CONTAINMENT_RE, `expected a containment refusal, got: ${r.err}`);
    assert.equal(sink.captured, null, 'no dispatch may happen for a refused --project value');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('rejects a ".." --project value (the repoPath would resolve to the projects root parent)', async () => {
  const forgeRoot = setupForgeRoot();
  try {
    const sink = { captured: null as Captured };
    const r = await withCwd(forgeRoot, () => run([SLUG, '--run-id', RUN_ID, '--project', '..'], forgeRoot, makeDeps(sink)));
    assertRepoPathContained(sink.captured, projectsRootOf(forgeRoot));
    assert.equal(r.exitCode, 2, `a ".." --project value must be refused with exit 2 — got exit(${r.exitCode}), stderr: ${r.err}`);
    assert.match(r.err, CONTAINMENT_RE, `expected a containment refusal, got: ${r.err}`);
    assert.equal(sink.captured, null, 'no dispatch may happen for a refused --project value');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('rejects a --project value whose directory identity does not match its expected in-root location (symlink out of root)', async (t) => {
  const forgeRoot = setupForgeRoot();
  const outside = mkdtempSync(join(tmpdir(), 'sec07-symlink-outside-'));
  const SENTINEL_CONTENT = 'sec07-sentinel-untouched';
  const sentinelPath = join(outside, 'sentinel.txt');
  writeFileSync(sentinelPath, SENTINEL_CONTENT);
  const symlinkPath = join(forgeRoot, 'projects', 'evil');
  try {
    try {
      symlinkSync(outside, symlinkPath, 'dir');
    } catch {
      t.skip('symlink creation unavailable in this environment');
      rmSync(forgeRoot, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
      return;
    }
    // Fixture preconditions, asserted before reading any verdict.
    assert.equal(readFileSync(sentinelPath, 'utf8'), SENTINEL_CONTENT, 'fixture precondition: sentinel content as planted');
    assert.equal(existsSync(join(outside, '_architect')), false, 'fixture precondition: no _architect subtree at the escape target yet');
    assert.ok(existsSync(symlinkPath), 'fixture precondition: the symlinked project name must resolve (existsSync passes on the unguarded branch)');

    const sink = { captured: null as Captured };
    const r = await withCwd(forgeRoot, () => run([SLUG, '--run-id', RUN_ID, '--project', 'evil'], forgeRoot, makeDeps(sink)));
    // CORE invariant — red now: the captured repoPath realpaths OUTSIDE the
    // projects root (the symlink resolves to `outside`).
    assertRepoPathContained(sink.captured, projectsRootOf(forgeRoot));
    // Refusal shape the fix adds (identity mismatch).
    assert.equal(r.exitCode, 2, `a symlinked --project value must be refused with exit 2 — got exit(${r.exitCode}), stderr: ${r.err}`);
    assert.match(r.err, CONTAINMENT_RE, `expected a containment refusal (identity mismatch), got: ${r.err}`);
    assert.equal(sink.captured, null, 'no dispatch may happen for a refused --project value');
    // Artifact-level: the refusal happened before anything touched the target.
    assert.equal(readFileSync(sentinelPath, 'utf8'), SENTINEL_CONTENT, 'the sentinel must be byte-unchanged after a refused call');
    assert.equal(existsSync(join(outside, '_architect')), false, 'no _architect/ dir may appear at the symlink target after a refused call');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('rejects a --project value that aliases a DIFFERENT in-root object via a symlink (identity mismatch, still under the root)', async (t) => {
  const forgeRoot = setupForgeRoot();
  mkdirSync(join(forgeRoot, 'projects', 'legit'), { recursive: true });
  const symlinkPath = join(forgeRoot, 'projects', 'evil');
  try {
    try {
      symlinkSync(join(forgeRoot, 'projects', 'legit'), symlinkPath, 'dir');
    } catch {
      t.skip('symlink creation unavailable in this environment');
      rmSync(forgeRoot, { recursive: true, force: true });
      return;
    }
    assert.ok(existsSync(symlinkPath), 'fixture precondition: the aliasing symlink must resolve (existsSync passes on the unguarded branch)');

    const sink = { captured: null as Captured };
    const r = await withCwd(forgeRoot, () => run([SLUG, '--run-id', RUN_ID, '--project', 'evil'], forgeRoot, makeDeps(sink)));
    // CORE invariant — red now: the captured repoPath realpaths to
    // `projects/legit`, NOT its expected `projects/evil` identity. (This alias
    // stays UNDER the root, so a plain containment check would not catch it —
    // the identity check is what does.)
    assertRepoPathIdentity(sink.captured, projectsRootOf(forgeRoot), 'evil');
    // Refusal shape the fix adds.
    assert.equal(r.exitCode, 2, `an aliasing --project value must be refused with exit 2 — got exit(${r.exitCode}), stderr: ${r.err}`);
    assert.match(r.err, CONTAINMENT_RE, `expected a containment refusal (identity mismatch), got: ${r.err}`);
    assert.equal(sink.captured, null, 'no dispatch may happen for a refused --project value');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Regression locks — GREEN before AND after the fix. Not red→green pins; each
// kills a specific wrong implementation.
// ---------------------------------------------------------------------------

// Lock, not a pin: an explicitly empty `--project ""` is falsy, so
// `cmdAgentDispatch`'s `projectArg ? … : undefined` diverts it to
// `project: undefined` — the same shape a genuinely omitted `--project` takes.
// The fix routes only the truthy `if (projectArg)` case through the guard and
// leaves this condition unchanged, so no dispatch is refused and no repoPath
// is resolved. Kills a fix that mishandles empty (e.g. resolving "" into the
// projects root itself and dispatching against it).
test('regression lock: an empty --project dispatches with project:undefined and is never treated as a containment escape', async () => {
  const forgeRoot = setupForgeRoot();
  try {
    const sink = { captured: null as Captured };
    const r = await withCwd(forgeRoot, () => run([SLUG, '--run-id', RUN_ID, '--project', ''], forgeRoot, makeDeps(sink)));
    assert.ok(sink.captured, 'an empty --project must still reach dispatch (it is falsy, so no project binding is built)');
    assert.equal(sink.captured!.project, undefined, 'an empty --project must produce project:undefined, not a resolved path');
    assert.doesNotMatch(r.err, CONTAINMENT_RE, `an empty --project must never trip a containment refusal — got: ${r.err}`);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('regression lock: an ordinary existing project name is dispatched with an in-root repoPath (kills an over-strict fix that rejects normal names)', async () => {
  const forgeRoot = setupForgeRoot();
  mkdirSync(join(forgeRoot, 'projects', 'realproj'), { recursive: true });
  try {
    const sink = { captured: null as Captured };
    const r = await withCwd(forgeRoot, () => run([SLUG, '--run-id', RUN_ID, '--project', 'realproj'], forgeRoot, makeDeps(sink)));
    assert.doesNotMatch(r.err, CONTAINMENT_RE, `an ordinary project name must never trip the containment refusal — got: ${r.err}`);
    assert.ok(sink.captured, 'an ordinary project name must reach dispatch');
    assertRepoPathContained(sink.captured, projectsRootOf(forgeRoot));
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('regression lock: a name starting with ".." but containing no separator ("..foo") is accepted (kills a fix that over-rejects legitimate "..foo"-shaped names)', async () => {
  const forgeRoot = setupForgeRoot();
  mkdirSync(join(forgeRoot, 'projects', '..foo'), { recursive: true });
  try {
    const sink = { captured: null as Captured };
    const r = await withCwd(forgeRoot, () => run([SLUG, '--run-id', RUN_ID, '--project', '..foo'], forgeRoot, makeDeps(sink)));
    assert.doesNotMatch(r.err, CONTAINMENT_RE, `"..foo" is a legitimate, contained name (no separator) and must never trip the containment refusal — got: ${r.err}`);
    assert.ok(sink.captured, '"..foo" must reach dispatch');
    assertRepoPathContained(sink.captured, projectsRootOf(forgeRoot));
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
