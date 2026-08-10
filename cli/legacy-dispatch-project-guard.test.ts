/**
 * SEC-06 acceptance pins: the legacy `forge agent run <agent-id> <session-id>
 * --project <name>` dispatch skeleton in `cmdAgentRun` (`cli/agent-run.ts`)
 * must guard an untrusted `--project` value the same way the newer turnSpec
 * road in the same file already does (`runTurnSpecAgent`) — as its OWN
 * guarded path segment against the trusted projects root, never folded into
 * the root itself before any containment check runs. See
 * `cli/studio-path-guard.ts`'s module docstring (the CONTRACT section) for
 * the general root-folding shape this closes: a guard whose `root` parameter
 * is itself untrusted can never fail, because `resolveGuardedPath` performs
 * no identity check on `root` — only on `segments[]`.
 *
 * Drives the real CLI entry point `cmdAgentRun` with agent-id `architect` —
 * the one `AGENT_RUNNERS` entry with `requiresProject: false`, so it is
 * reachable with a caller-supplied `--project` while carrying no `turnSpec`
 * (see `orchestrator/studio/session-kinds.ts`), which is what keeps it on
 * this branch rather than the already-guarded turnSpec road. Runs under
 * `FORGE_ARCHITECT_NO_SPAWN=1` so no real agent turn is ever attempted.
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
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cmdAgentRun, AGENT_RUNNERS } from './agent-run.ts';
import { startBridge } from './ui-bridge.ts';

process.env.FORGE_ARCHITECT_NO_SPAWN = '1';

/** A rejection reason naming the offending shape — mirrors the containment
 *  vocabulary already established by `resolveGuardedPath`'s own `reason`
 *  strings and `runTurnSpecAgent`'s own error text (both `cli/
 *  studio-path-guard.ts` / `cli/agent-run.ts`), not invented wording. */
const CONTAINMENT_RE = /is not a valid project name|unsafe path segment|identity mismatch|containment|escapes/i;

// ---------------------------------------------------------------------------
// Driver — mirrors `cli/agent-run.test.ts`'s own `run()`/`withCwd()` helpers
// (the established house pattern for this file's sibling suite: a sentinel
// thrown from a stubbed `process.exit` returns control without tearing down
// the test runner). ONE disclosed hardening: a real, non-`__exit__` throw is
// captured into `err` instead of propagating out of the test. On the
// unguarded branch this file pins, an escaping `--project` value does not
// stop at a clean `process.exit` today — it proceeds past the (missing)
// guard and into the runner itself, which then throws an unrelated
// "no status.json" error once it can't find a session at the escaped
// location. Both shapes need to be inspectable through the SAME return
// value so one assertion reads as the failing case now and the guarded case
// once the fix lands, without every test needing its own try/catch.
// ---------------------------------------------------------------------------

async function run(args: string[], forgeRoot: string): Promise<{ exitCode: number | null; out: string; err: string }> {
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
    await cmdAgentRun(args, forgeRoot);
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

/** chdir for the duration of `fn`, always restoring. Load-bearing, not
 *  cosmetic: the legacy branch's `resolve('projects', projectArg)` is
 *  cwd-relative, so the fixture forgeRoot must also be the process cwd for
 *  the call, mirroring `cli/agent-run.test.ts`'s own established technique. */
async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(prev);
  }
}

/** One forgeRoot with an empty session-kind registry (avoids the
 *  load-failure stderr noise `findSessionKindDescriptor` prints for a
 *  genuinely MISSING `studio/session-kinds.yaml` — irrelevant to what this
 *  suite pins) plus a real `projects/` directory. */
function setupForgeRoot(): string {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'sec06-legacy-guard-'));
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'session-kinds.yaml'), '[]\n');
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  return forgeRoot;
}

const SID = '2026-08-11T00-00-00-sec06fixture';

// ---------------------------------------------------------------------------
// Cases 1-4 — red-now: each must fail on the unguarded branch and pass once
// an escaping `--project` value is refused before the legacy skeleton ever
// resolves it into a project root.
// ---------------------------------------------------------------------------

test('rejects an absolute --project value on the legacy dispatch branch (parity with the interactive road)', async () => {
  assert.equal(AGENT_RUNNERS.architect?.requiresProject, false, 'fixture precondition: architect must not require --project up front');
  const forgeRoot = setupForgeRoot();
  const outside = mkdtempSync(join(tmpdir(), 'sec06-abs-outside-'));
  try {
    assert.ok(existsSync(outside), 'fixture precondition: the absolute escape target must exist (existsSync must be able to pass)');
    const r = await withCwd(forgeRoot, () => run(['architect', SID, '--project', outside], forgeRoot));
    assert.equal(r.exitCode, 2, `an absolute --project value must be refused with exit 2 — got exit(${r.exitCode}), stderr: ${r.err}`);
    assert.match(r.err, CONTAINMENT_RE, `expected a containment refusal, got: ${r.err}`);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('rejects a ".." --project value on the legacy dispatch branch', async () => {
  const forgeRoot = setupForgeRoot();
  try {
    const r = await withCwd(forgeRoot, () => run(['architect', SID, '--project', '..'], forgeRoot));
    assert.equal(r.exitCode, 2, `a ".." --project value must be refused with exit 2 — got exit(${r.exitCode}), stderr: ${r.err}`);
    assert.match(r.err, CONTAINMENT_RE, `expected a containment refusal, got: ${r.err}`);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('rejects a --project value whose directory identity does not match its expected location on the legacy dispatch branch', async (t) => {
  const forgeRoot = setupForgeRoot();
  const outside = mkdtempSync(join(tmpdir(), 'sec06-symlink-outside-'));
  const SENTINEL_CONTENT = 'sec06-sentinel-untouched';
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

    const r = await withCwd(forgeRoot, () => run(['architect', SID, '--project', 'evil'], forgeRoot));
    assert.equal(r.exitCode, 2, `a symlinked --project value must be refused with exit 2 — got exit(${r.exitCode}), stderr: ${r.err}`);
    assert.match(r.err, CONTAINMENT_RE, `expected a containment refusal (identity mismatch), got: ${r.err}`);

    // Artifact-level proof, not just the status code: the refusal happened
    // BEFORE any read/write reached the escape target.
    assert.equal(readFileSync(sentinelPath, 'utf8'), SENTINEL_CONTENT, 'the sentinel must be byte-unchanged after a refused call');
    assert.equal(existsSync(join(outside, '_architect')), false, 'no _architect/ dir may appear at the symlink target after a refused call');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

// Regression lock, not a red→green pin: an explicitly passed empty
// `--project ""` is falsy, so the legacy branch's `if (projectArg)` check
// never routes it into the guarded/unguarded path resolution at all — it is
// diverted whole to architect's `findSessionProject` auto-discovery
// fallback, the SAME branch a genuinely omitted `--project` takes. That is
// not a containment escape: `resolve('projects', '')` is just the in-root
// `projects/` root itself, and auto-discovery only ever returns a real
// in-root project directory or exits 2 — it can never produce an
// out-of-root `projectRoot`. This lock must therefore read GREEN both
// BEFORE and AFTER the minimal SEC-06 fix (which routes only the
// `if (projectArg)` branch through `resolveGuardedPath` and leaves that
// condition itself unchanged). Assert the safe path was actually taken —
// exit 2 via auto-discovery's "no project found" message — rather than
// asserting the absence of a containment refusal, which would also be true
// of an unrelated crash. Deliberately NOT demanded here: turning an
// explicitly empty `--project` into a hard containment refusal. That is a
// separate hygiene concern (reject explicit-empty distinctly from omitted)
// and is out of scope for this one-concern containment fix — a possible
// follow-up, not a gap in this pin.
test('regression lock: an empty --project is diverted to safe auto-discovery and never yields an out-of-root project root', async () => {
  const forgeRoot = setupForgeRoot();
  try {
    const r = await withCwd(forgeRoot, () => run(['architect', SID, '--project', ''], forgeRoot));
    assert.equal(r.exitCode, 2, `an empty --project value must be safely refused via auto-discovery with exit 2 — got exit(${r.exitCode}), stderr: ${r.err}`);
    assert.match(
      r.err, /no project found/i,
      `expected the safe auto-discovery refusal (proving "" was never resolved as a path), got: ${r.err}`,
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Regression locks — must stay green before AND after the fix. These prove
// the guard is not a blunt instrument: an ordinary project name, and a name
// that merely STARTS WITH ".." without a separator (a legitimate, contained
// name per `cli/studio-path-guard.ts`'s own documented `isSafeSegment`
// precedent), must both sail past the guard step untouched.
// ---------------------------------------------------------------------------

test('regression lock: an ordinary existing project name is accepted past the guard step (kills an over-strict fix that rejects normal project names)', async () => {
  const forgeRoot = setupForgeRoot();
  mkdirSync(join(forgeRoot, 'projects', 'realproj'), { recursive: true });
  try {
    const r = await withCwd(forgeRoot, () => run(['architect', SID, '--project', 'realproj'], forgeRoot));
    assert.doesNotMatch(
      r.err, CONTAINMENT_RE,
      `an ordinary project name must never trip the containment refusal — got exit(${r.exitCode}), stderr: ${r.err}`,
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('regression lock: a name starting with ".." but containing no separator is accepted past the guard step (kills a fix that over-rejects legitimate "..foo"-shaped names)', async () => {
  const forgeRoot = setupForgeRoot();
  mkdirSync(join(forgeRoot, 'projects', '..foo'), { recursive: true });
  try {
    const r = await withCwd(forgeRoot, () => run(['architect', SID, '--project', '..foo'], forgeRoot));
    assert.doesNotMatch(
      r.err, CONTAINMENT_RE,
      `"..foo" is a legitimate, contained name (no separator) and must never trip the containment refusal — got exit(${r.exitCode}), stderr: ${r.err}`,
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Bridge regression lock — `POST /api/architect/start` already guards its
// own request-supplied `project` field via `guardedSessionDir`
// (`cli/ui-bridge.ts`) before any mkdir/write/spawn, independent of the
// legacy CLI-dispatch fix this file otherwise pins. Included here because it
// is the call-site family the SEC-06 sweep names as the OTHER way an
// untrusted project value reaches the CLI (a detached `orchestrator/cli.ts
// <verb> run <sid> --project <project>` spawn) — this test proves the value
// is already sanitized before that spawn is even considered. GREEN ON
// ARRIVAL (measured, not assumed — see the test-writer's report): kills a
// bridge that forwards an unvalidated `body.project` straight through to the
// CLI without ever calling `guardedSessionDir` first.
// ---------------------------------------------------------------------------

test('regression lock: POST /api/architect/start rejects a traversal-shaped project and never decodes a percent-encoded body value into one', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'sec06-bridge-guard-'));
  const projectsRoot = join(forgeRoot, 'projects');
  mkdirSync(projectsRoot, { recursive: true });
  mkdirSync(join(forgeRoot, '_queue', 'pending'), { recursive: true });
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'flows'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  const { url, close } = await startBridge({ forgeRoot, port: 0 });
  try {
    // Raw traversal riding in the JSON body.
    const rawRes = await fetch(`${url}/api/architect/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      body: JSON.stringify({ project: '../../etc', idea: 'sec-06 contract probe' }),
    });
    const rawText = await rawRes.text();
    assert.ok(rawRes.status >= 400 && rawRes.status < 500, `a traversal-shaped project must be rejected 4xx — got ${rawRes.status}: ${rawText}`);
    assert.equal(existsSync(join(forgeRoot, 'etc')), false, 'a "../../etc" project must never create anything outside projectsRoot');

    // Percent-encoded literal. The wire mechanics differ from a URL path
    // segment: `body.project` is a JSON string VALUE, never decoded by
    // `readJson`. MEASURED (not assumed): the running route treats
    // "..%2f..%2fetc" as one literal, oddly-named-but-CONTAINED directory
    // segment rather than a decoded "../../etc" traversal. The invariant
    // pinned here is what must stay true regardless of status code: nothing
    // is ever created OUTSIDE projectsRoot, and IF the literal segment is
    // accepted, its on-disk location is verified to be strictly inside
    // projectsRoot — proving the value was never run through a decode step.
    const encRes = await fetch(`${url}/api/architect/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      body: JSON.stringify({ project: '..%2f..%2fetc', idea: 'sec-06 contract probe' }),
    });
    const encText = await encRes.text();
    assert.equal(
      existsSync(join(forgeRoot, 'etc')),
      false,
      `a percent-encoded project value must never decode into a real traversal — got ${encRes.status}: ${encText}`,
    );
    assert.ok(encRes.status >= 200 && encRes.status < 500, `expected a definite 2xx/4xx verdict, got ${encRes.status}: ${encText}`);
    if (encRes.status >= 200 && encRes.status < 300) {
      const sid = (JSON.parse(encText) as { sessionId?: string }).sessionId;
      assert.ok(sid, `expected a sessionId on a 2xx response — got: ${encText}`);
      assert.ok(
        existsSync(join(projectsRoot, '..%2f..%2fetc', '_architect', sid!)),
        'if accepted, the literal "..%2f..%2fetc" segment must have been created strictly INSIDE projectsRoot, proving no decode occurred',
      );
    }
  } finally {
    await close();
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
