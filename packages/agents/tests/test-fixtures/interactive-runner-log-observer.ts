/**
 * The turnSpec-run observation harness — a REAL fixture module, not a test.
 *
 * WHY THIS IS A MODULE AND NOT A DUPLICATED BLOCK. Everywhere else in this
 * package a small helper is duplicated rather than exported, because a
 * `.test.ts` that exports a helper becomes an import target and starts
 * constraining what it may assert. This is the one place that trade goes the
 * other way: `agent-run.test.ts` was 1,226 lines and had to split, and its
 * shared block is 268 lines used by all four of its clusters — three copies of
 * a 162-line log walker is exactly the signal that a seam is wrong, and one of
 * the clusters (forge-q1z / forge-1im) tests this walker as its SUBJECT. A
 * subject with its own tests wants its own module. It lives under
 * `test-fixtures/`, which `scripts/check-owner.mjs`'s NOT_PRODUCTION regex
 * excludes from the production set — so it is test support by the repo's own
 * definition, not package production code (T1 ruling 94, 2026-09-04).
 *
 * WHAT IS IN HERE, and the beads it carries.
 *
 * `run` / `withCwd` — the cmdAgentRun driver. Mirrors the `run()` helper in
 * `integration/agent-run-dispatch.test.ts` exactly (the established house
 * pattern for stubbing process.exit + console): a sentinel thrown from the
 * exit stub returns control without tearing down the test runner. The chdir
 * wrapper always restores.
 *
 * `setupTurnspecFixture` + its yaml — one forgeRoot, one turnSpec-only
 * descriptor (no `AGENT_RUNNERS` entry) with a single `step: noop` phase,
 * plus a turnSpec-LESS "architect" row sharing an id with a real
 * `AGENT_RUNNERS` key (AT-5's fixture). Loaded through the REAL
 * `loadSessionKinds` parse path rather than a hand-built descriptor object.
 *
 * The log walk — `walkEventJsonLines` and the three `*IfPresent` readers.
 * **forge-1im** lives here: a path GONE at read time is outside the
 * baseline-scoped world this walk inspects, so `existsSync` + `readFileSync`
 * was a TOCTOU against sibling test processes sharing the real `_logs/`. The
 * readers tolerate ONLY ENOENT/ENOTDIR ("the path is gone") and rethrow
 * everything else, so the hardening cannot decay into a silent swallow —
 * `readdirIfPresent` is deliberately NARROWER (ENOENT only), because a
 * `_logs` that exists but is not a directory is a real broken-repo fault the
 * pre-fix code threw on, and tolerating it would have been a regression
 * introduced by the fix. `regression/agent-run-log-observer.test.ts` pins all
 * of that.
 *
 * `snapshotLogs` + `assertNoInteractiveRunnerSkillEvent` — **forge-q1z**: the
 * assertion is SCOPED to a baseline snapshot taken immediately before the
 * invocation under test, not a blanket walk of every `_logs/` directory that
 * happens to exist. A file that SHRANK below its snapshotted size has
 * unknowable provenance and is re-scanned from byte 0 rather than trusted at a
 * stale offset.
 *
 * `findInteractiveRunnerStartEvent` — locates the ONE spine-emitted `start`
 * event by CONTENT (`skill: 'interactive-runner'`), never by directory NAME:
 * the spine's cycleId `_<descriptor.id>-<sessionId>` is indistinguishable from
 * a bespoke runner's own directory for any id the two share, so only the
 * event's `skill` field can still tell "the spine ran" from "the bespoke
 * runner with the same kind id ran".
 */

import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cmdAgentRun } from '../../agent-run.ts';
import { writeSessionStatus } from '@forge/sessions/interactive-session.ts';

// ---------------------------------------------------------------------------
// cmdAgentRun driver — mirrors cli/agent-run-dispatch.test.ts's own `run()`
// helper exactly (the established house pattern for stubbing process.exit +
// console in this file's sibling test suite): a sentinel thrown from the
// process.exit stub returns control immediately without tearing down the
// test runner.
// ---------------------------------------------------------------------------

export async function run(args: string[], forgeRoot: string): Promise<{ exitCode: number | null; out: string; err: string }> {
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
    if (!/^__exit__/.test((e as Error).message)) throw e;
  } finally {
    process.exit = origExit;
    console.log = origLog;
    console.error = origErr;
  }
  return { exitCode, out: out.join('\n'), err: err.join('\n') };
}

/** chdir for the duration of `fn`, always restoring — see the file header for
 *  why this is load-bearing rather than cosmetic. */
export async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(prev);
  }
}

// ---------------------------------------------------------------------------
// Fixture — one forgeRoot, one turnSpec-only descriptor (no AGENT_RUNNERS
// entry) with a single step:noop phase, plus a turnSpec-LESS "architect" row
// sharing an id with a real AGENT_RUNNERS key (AT-5's fixture). Loaded
// through the REAL loadSessionKinds parse path (studio/session-kinds.ts),
// mirroring orchestrator/interactive-runner.test.ts's own fixture-design
// precedent, rather than a hand-built descriptor object.
// ---------------------------------------------------------------------------

export const TURNSPEC_ONLY_ID = 'turnspec-only-fixture-kind';
export const KIND_DIR = '_fixturekind';

export const FIXTURE_SESSION_KINDS_YAML = `
- id: ${TURNSPEC_ONLY_ID}
  agent: project-brain-builder
  title: Fixture turnSpec kind (R4-22 WI-5, T3)
  legacyRoutes: []
  stages: [contract]
  defaultStage: contract
  artifact:
    kind: markdown-draft
    label: Fixture artifact
  turnSpec:
    kindDir: ${KIND_DIR}
    style: agent
    phases:
      - { phase: p1, step: noop }
- id: architect
  agent: architect
  title: Architect (fixture, deliberately carries NO turnSpec)
  legacyRoutes: []
  stages: [roadmap]
  defaultStage: roadmap
  artifact:
    kind: roadmap-draft
    label: Fixture roadmap draft
`;

export type TurnspecFixture = {
  forgeRoot: string;
  projectArg: string;
  projectRoot: string;
  sessionId: string;
  sessionDir: string;
};

export function setupTurnspecFixture(): TurnspecFixture {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'r422-wi5-agentrun-'));
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'session-kinds.yaml'), FIXTURE_SESSION_KINDS_YAML);

  const projectArg = 'fixtureproj';
  // cwd-relative, matching cmdAgentRun's existing `resolve('projects',
  // projectArg)` convention — see file header. The test chdirs into
  // `forgeRoot` before invoking cmdAgentRun, so this is also exactly where
  // `resolve(forgeRoot, 'projects', projectArg)` would land.
  const projectRoot = join(forgeRoot, 'projects', projectArg);
  const sessionId = '2026-08-11T00-00-00-wi5fixture';
  const sessionDir = join(projectRoot, KIND_DIR, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus(sessionDir, { session_id: sessionId, phase: 'p1', updated_at: new Date(0).toISOString() });

  return { forgeRoot, projectArg, projectRoot, sessionId, sessionDir };
}

/** R4-22 F4 amendment (replaces the former `assertNoInteractiveLogDir`,
 *  which discriminated "did the spine run" by a `_interactive-<id>-*`
 *  directory-NAME prefix). LOCATES the ONE `runInteractiveTurn`-emitted
 *  "start" event, ANYWHERE under `<forgeRoot>/_logs/`, matching `sessionId`
 *  + `sessionKind` by CONTENT — `skill: 'interactive-runner'`
 *  (`packages/sessions/interactive-runner.ts`'s `RUNNER_SKILL`, stamped on
 *  every event the spine emits and on NO event any bespoke runner emits: they
 *  stamp 'architect-runner' / 'instructions-runner' / 'demo-builder-runner' /
 *  'project-brain-builder' — see each one's own `skill:` literal).
 *
 *  Deliberately does NOT assume any directory NAME: the spine's cycleId is
 *  `_<descriptor.id>-<sessionId>` (pinned by AT-a/AT-b and the co-location
 *  ratchet), INDISTINGUISHABLE from a bespoke runner's own directory for any
 *  id the two share (architect/instructions/project-brain) — only the event's
 *  own `skill` field can still tell "the spine ran" from "the bespoke runner
 *  with the same kind id ran". Returns `undefined` if no matching event
 *  exists anywhere. */
/** Shared walk (extracted so findInteractiveRunnerStartEvent's find-one and
 *  assertNoInteractiveRunnerSkillEvent's assert-none below cannot silently
 *  drift apart on what counts as "every event under _logs/"): yields every
 *  raw JSONL line from every `<forgeRoot>/_logs/<dir>/events.jsonl`,
 *  alongside its parsed form (`undefined` if the line failed to
 *  `JSON.parse`) and the events.jsonl path it came from. */
/** Opaque to callers (forge-q1z): per events.jsonl, existed-at-snapshot + byte size. */
export type LogBaseline = Map<string, { existed: boolean; size: number }>;

/** forge-1im. A path that is GONE at read time is, by definition, outside the
 *  baseline-scoped world this walk inspects — the same exclusion the former
 *  `if (!existsSync(p)) continue;` intended, spelled race-free.
 *
 *  WHY THIS IS NEEDED. AT-2 walks the REAL repo root (see its own comment: the
 *  legacy fast-fail paths never touch the filesystem, so there is nothing to
 *  isolate into a tmp fixture), and `_logs/` under the real root is shared with
 *  every sibling test process `node --test` runs concurrently. `existsSync(p)`
 *  followed by `readFileSync(p)` is a TOCTOU: a sibling that removes a `_logs/`
 *  entry between the check and the read makes the read throw ENOENT and
 *  false-fails a test with no regression behind it. That is bead forge-1im.
 *
 *  WHY NOT "just isolate the dispatch into a tmp root" — the structural cure
 *  considered first, and REJECTED: AT-2 exists to assert that the REAL
 *  `studio/session-kinds.yaml` does not route these four ids to the interactive
 *  spine. Re-pointing it at a fixture root would make it assert about the
 *  fixture's config instead of the shipped one — a strictly WEAKER test. And the
 *  observation surface cannot be moved either: `runInteractiveTurn` writes to
 *  `resolve(forgeRoot, '_logs')` (orchestrator/interactive-runner.ts:249), so
 *  `ROOT/_logs` is the only place a real violation could ever appear.
 *
 *  NOT a retry and NOT a widened tolerance: nothing is re-attempted, and ONLY
 *  ENOENT/ENOTDIR (the path is gone) is tolerated. Every other error still
 *  throws, so this hardening can never decay into a silent swallow — pinned by
 *  its own test below. */
export function readIfPresent(p: string): Buffer | null {
  try {
    return readFileSync(p);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw err;
  }
}

/** Same race, same rule, for the directory listing itself — but NARROWER on
 *  purpose: **ENOENT only**. A `_logs` that is absent is a gone path and lists
 *  as empty; a `_logs` that EXISTS but is not a directory (ENOTDIR) is a real,
 *  broken-repo fault, and the pre-fix code threw on it (`existsSync` answers
 *  true for a plain file, then `readdirSync` throws). Tolerating ENOTDIR here
 *  would have been a behaviour regression — a swallow introduced by the very
 *  fix meant to remove a false failure. Pinned by this file's forge-1im test. */
export function readdirIfPresent(p: string): string[] {
  try {
    return readdirSync(p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/** Same race, same rule, for the snapshot's stat. */
export function statSizeIfPresent(p: string): number | null {
  try {
    return statSync(p).size;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw err;
  }
}

export function* walkEventJsonLines(forgeRoot: string, baseline?: LogBaseline): Generator<{
  eventsPath: string;
  line: string;
  parsed: Record<string, unknown> | undefined;
}> {
  const logsRoot = join(forgeRoot, '_logs');
  for (const entry of readdirIfPresent(logsRoot)) {
    const eventsPath = join(logsRoot, entry, 'events.jsonl');
    const buf = readIfPresent(eventsPath);
    if (buf === null) continue;
    const prior = baseline?.get(eventsPath);
    // Buffer.prototype.subarray clamps rather than throwing when start >
    // length — a file that SHRANK below its snapshotted size has unknowable
    // provenance, so re-scan it from byte 0 instead of trusting a stale offset.
    const startByte = prior?.existed && buf.length >= prior.size ? prior.size : 0;
    const lines = buf.subarray(startByte).toString('utf8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      let parsed: Record<string, unknown> | undefined;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        parsed = undefined;
      }
      yield { eventsPath, line, parsed };
    }
  }
}

export function findInteractiveRunnerStartEvent(
  forgeRoot: string,
  sessionId: string,
  sessionKind: string,
): Record<string, unknown> | undefined {
  for (const { parsed } of walkEventJsonLines(forgeRoot)) {
    if (!parsed) continue;
    if (parsed.event_type !== 'start' || parsed.skill !== 'interactive-runner') continue;
    const metadata = parsed.metadata as Record<string, unknown> | undefined;
    if (metadata?.session_id === sessionId && metadata?.session_kind === sessionKind) return parsed;
  }
  return undefined;
}

/** No event ANYWHERE under `<forgeRoot>/_logs/` carries `skill:
 *  'interactive-runner'` — proves `runInteractiveTurn` was never invoked at
 *  all (any session/kind). STRICTLY STRONGER than the directory-name-prefix
 *  check it replaces (`_interactive-<id>-*`) — see
 *  `findInteractiveRunnerStartEvent`'s doc above for why a dir-name
 *  discriminator alone stops working once the spine's directory name
 *  collides with a legacy runner's own. */
/** Snapshot (forge-q1z) — take right before the invocation under test. */
export function snapshotLogs(forgeRoot: string): LogBaseline {
  const baseline: LogBaseline = new Map();
  const logsRoot = join(forgeRoot, '_logs');
  // forge-1im: same TOCTOU as the walk — a sibling test process can remove a
  // `_logs/` entry between this readdir and this stat.
  for (const entry of readdirIfPresent(logsRoot)) {
    const eventsPath = join(logsRoot, entry, 'events.jsonl');
    const size = statSizeIfPresent(eventsPath);
    baseline.set(eventsPath, { existed: size !== null, size: size ?? 0 });
  }
  return baseline;
}

export function assertNoInteractiveRunnerSkillEvent(forgeRoot: string, baseline: LogBaseline, msg: string): void {
  for (const { eventsPath, line, parsed } of walkEventJsonLines(forgeRoot, baseline)) {
    if (!parsed) continue;
    assert.notEqual(
      parsed.skill,
      'interactive-runner',
      `${msg} — found a skill:'interactive-runner' event in ${eventsPath}: ${line}`,
    );
  }
}
