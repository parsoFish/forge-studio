/**
 * Acceptance tests for the LEAF primitives in packages/sessions/session-readability.ts
 * (wave-8 F6 — "a linked session must be readable").
 *
 * The module under test does not exist yet — this file is RED at branch base
 * (ERR_MODULE_NOT_FOUND on the `./session-readability.ts` import is the
 * expected red), mirroring the header convention already used at the top of
 * packages/sessions/bridge-studio-sessions.test.ts.
 *
 * SCOPE (T2 module-split course-correction, 2026-08-28): `session-
 * readability.ts` must stay an import LEAF — node:*, `./studio-path-guard.ts`,
 * and `../orchestrator/**` only — so it can never validate a project id
 * against `invalidProjectReason` (packages/sessions/bridge-studio-sessions.ts, which itself
 * pulls `SAFE_ID_RE` from cli/bridge-studio.ts and `KB_SEEDING_ANCHOR_PREFIX`
 * from packages/knowledge/bridge-studio-kbs.ts — importing either into the leaf would create
 * the bridge module graph's first import cycle). This file therefore covers
 * ONLY the pure derivations and the guarded log-dir resolution:
 *   - `sessionLogDirName`, `parseGuardedEventsJsonl` (the MOVED-verbatim
 *     helper from cli/ui-bridge.ts's private `parseGuardedEventsJsonl`)
 *   - `deriveLegacySessionPhase` (pure) — last metadata.phase string
 *   - `deriveLegacySessionProject` (pure, RAW — NOT a validator: returns the
 *     first metadata.project string verbatim, unrejected; validating it
 *     against the ".kb-"/".community-registry" carve-out rules is
 *     `resolveReadableSession`'s job, covered in
 *     packages/sessions/session-readability-resolve.test.ts, not this pure function's)
 *   - `resolveLegacySession({ logsRoot, kind, sessionId })` — the guarded
 *     read of `<logsRoot>/_<kind>-<sessionId>/events.jsonl`, returning
 *     `{ok:true, logDir, phase, projectFromLog}` or `{ok:false}`. ALL of this
 *     file's containment attacks (symlinked log dir, symlinked events.jsonl
 *     leaf, hardlinked events.jsonl leaf, a sessionId embedding ".."/"/")
 *     target this function.
 *
 * The higher-level composition (`resolveReadableSession` / `sessionIsReadable`,
 * which live on packages/sessions/bridge-studio-sessions.ts per the same course-correction)
 * is covered separately in packages/sessions/session-readability-resolve.test.ts.
 *
 * Containment tests plant a SECRET MARKER outside the guarded root and assert
 * on the ARTIFACT (the marker never appears anywhere in the returned value,
 * and the outside file is byte-unchanged) — not just the pass/fail verdict.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync, linkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  sessionLogDirName,
  parseGuardedEventsJsonl,
  deriveLegacySessionPhase,
  deriveLegacySessionProject,
  resolveLegacySession,
} from './session-readability.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let root: string;
let logsRoot: string;

const KIND = 'architect';

const SID_NORMAL = '2026-08-01T10-00-00-normal';
const SID_EMPTY = '2026-08-01T10-00-00-empty';
const SID_SYMLINK_DIR = '2026-08-01T10-00-00-symlinkdir';
const SID_SYMLINK_LEAF = '2026-08-01T10-00-00-symlinkleaf';
const SID_HARDLINK = '2026-08-01T10-00-00-hardlink';

const SECRET_MARKER_DIR = 'TOP-SECRET-F6-LEAF-SYMLINKDIR-MARKER-1101';
const SECRET_MARKER_LEAF = 'TOP-SECRET-F6-LEAF-SYMLINKLEAF-MARKER-1102';
const SECRET_MARKER_HARDLINK = 'TOP-SECRET-F6-LEAF-HARDLINK-MARKER-1103';

let outsideSymlinkDirEventsPath: string;
let outsideSymlinkLeafPath: string;
let outsideHardlinkSourcePath: string;

function writeEventsJsonl(dir: string, lines: Array<Record<string, unknown>>): void {
  mkdirSync(dir, { recursive: true });
  const body = lines.map((l) => JSON.stringify(l)).join('\n');
  writeFileSync(join(dir, 'events.jsonl'), body.length > 0 ? `${body}\n` : '', 'utf8');
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'session-readability-leaf-'));
  logsRoot = join(root, '_logs');
  mkdirSync(logsRoot, { recursive: true });

  // A genuine legacy log dir: three events, two DIFFERENT phases (so "last
  // wins" is observable) and one metadata.project.
  writeEventsJsonl(join(logsRoot, sessionLogDirName(KIND, SID_NORMAL)), [
    { event_id: 'e1', metadata: { session_id: SID_NORMAL, phase: 'briefing' } },
    { event_id: 'e2', metadata: { session_id: SID_NORMAL, phase: 'drafting', project: 'normal-project' } },
    { event_id: 'e3', metadata: { session_id: SID_NORMAL, phase: 'awaiting-verdict' } },
  ]);

  // An EMPTY (0-byte) events.jsonl — still "present".
  mkdirSync(join(logsRoot, sessionLogDirName(KIND, SID_EMPTY)), { recursive: true });
  writeFileSync(join(logsRoot, sessionLogDirName(KIND, SID_EMPTY), 'events.jsonl'), '', 'utf8');

  // Escape 1: the log dir `_<kind>-<sid>` is a SYMLINK to a directory OUTSIDE
  // logsRoot that contains an events.jsonl full of a secret marker.
  const outsideDirForSymlinkDir = join(root, '_outside-symlinkdir');
  mkdirSync(outsideDirForSymlinkDir, { recursive: true });
  outsideSymlinkDirEventsPath = join(outsideDirForSymlinkDir, 'events.jsonl');
  writeFileSync(outsideSymlinkDirEventsPath, `${JSON.stringify({ metadata: { phase: SECRET_MARKER_DIR, project: SECRET_MARKER_DIR } })}\n`, 'utf8');
  symlinkSync(outsideDirForSymlinkDir, join(logsRoot, sessionLogDirName(KIND, SID_SYMLINK_DIR)));

  // Escape 2: the log dir is REAL, but events.jsonl inside it is a SYMLINK to
  // a file OUTSIDE logsRoot.
  const symlinkLeafDir = join(logsRoot, sessionLogDirName(KIND, SID_SYMLINK_LEAF));
  mkdirSync(symlinkLeafDir, { recursive: true });
  outsideSymlinkLeafPath = join(root, '_outside-symlinkleaf-secret.jsonl');
  writeFileSync(outsideSymlinkLeafPath, `${JSON.stringify({ metadata: { phase: SECRET_MARKER_LEAF, project: SECRET_MARKER_LEAF } })}\n`, 'utf8');
  symlinkSync(outsideSymlinkLeafPath, join(symlinkLeafDir, 'events.jsonl'));

  // Escape 3: events.jsonl is a HARDLINK to a file outside logsRoot. Kept
  // inside the SAME tmp root (`root`) so the hardlink is legal even when
  // `/tmp` and this root live on different filesystems.
  const hardlinkDir = join(logsRoot, sessionLogDirName(KIND, SID_HARDLINK));
  mkdirSync(hardlinkDir, { recursive: true });
  outsideHardlinkSourcePath = join(root, '_outside-hardlink-secret.jsonl');
  writeFileSync(outsideHardlinkSourcePath, `${JSON.stringify({ metadata: { phase: SECRET_MARKER_HARDLINK, project: SECRET_MARKER_HARDLINK } })}\n`, 'utf8');
  linkSync(outsideHardlinkSourcePath, join(hardlinkDir, 'events.jsonl'));
});

after(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// deriveLegacySessionPhase
// ---------------------------------------------------------------------------

test('AT-F6-01: deriveLegacySessionPhase — [] -> \'\'', () => {
  assert.equal(deriveLegacySessionPhase([]), '');
});

test('AT-F6-02: deriveLegacySessionPhase — no event carries a string phase -> \'\'', () => {
  assert.equal(deriveLegacySessionPhase([{ metadata: {} }, { metadata: { phase: 7 } }, {}]), '');
});

test('AT-F6-03: deriveLegacySessionPhase — returns the LAST metadata.phase string across events', () => {
  const events = [
    { metadata: { phase: 'briefing' } },
    { metadata: { phase: 'drafting' } },
    { metadata: { phase: 'awaiting-verdict' } },
  ];
  assert.equal(deriveLegacySessionPhase(events), 'awaiting-verdict');
});

test('AT-F6-04: deriveLegacySessionPhase — ignores a non-string metadata.phase and keeps the last STRING one', () => {
  const events = [
    { metadata: { phase: 'drafting' } },
    { metadata: { phase: 42 } },
    { metadata: { phase: null } },
  ];
  assert.equal(deriveLegacySessionPhase(events), 'drafting');
});

test('AT-F6-05: deriveLegacySessionPhase — a trailing event with no metadata at all does not blank out an earlier valid phase', () => {
  const events = [{ metadata: { phase: 'analyzing' } }, { some: 'field' }];
  assert.equal(deriveLegacySessionPhase(events), 'analyzing');
});

// ---------------------------------------------------------------------------
// deriveLegacySessionProject — PURE, RAW (no validation at this layer)
// ---------------------------------------------------------------------------

test('AT-F6-06: deriveLegacySessionProject — [] -> \'\'', () => {
  assert.equal(deriveLegacySessionProject([]), '');
});

test('AT-F6-07: deriveLegacySessionProject — no event carries a project at all -> \'\'', () => {
  assert.equal(deriveLegacySessionProject([{ metadata: {} }, {}]), '');
});

test('AT-F6-08: deriveLegacySessionProject — returns the FIRST metadata.project string across events, verbatim', () => {
  const events = [
    { metadata: { project: 'demoproj' } },
    { metadata: { project: 'otherproj' } },
  ];
  assert.equal(deriveLegacySessionProject(events), 'demoproj');
});

test('AT-F6-09: deriveLegacySessionProject — a non-string metadata.project is skipped, the next candidate wins', () => {
  const events = [
    { metadata: { project: 42 } },
    { metadata: { project: 'demoproj' } },
  ];
  assert.equal(deriveLegacySessionProject(events), 'demoproj');
});

test('AT-F6-10: deriveLegacySessionProject is RAW, not a validator — a traversal-shaped "../../etc" is returned VERBATIM, unrejected (validation is resolveReadableSession\'s job, not this pure function\'s)', () => {
  assert.equal(deriveLegacySessionProject([{ metadata: { project: '../../etc' } }]), '../../etc');
});

// ---------------------------------------------------------------------------
// sessionLogDirName
// ---------------------------------------------------------------------------

test('AT-F6-11: sessionLogDirName builds "_<kind>-<sessionId>" verbatim', () => {
  assert.equal(sessionLogDirName('architect', '2026-08-01T10-00-00'), '_architect-2026-08-01T10-00-00');
});

// ---------------------------------------------------------------------------
// parseGuardedEventsJsonl
// ---------------------------------------------------------------------------

test('AT-F6-12: parseGuardedEventsJsonl — an absent entry is null', () => {
  assert.equal(parseGuardedEventsJsonl(logsRoot, 'does-not-exist-at-all'), null);
});

test('AT-F6-13: parseGuardedEventsJsonl — a guard-rejected entry (a symlinked dir escaping logsRoot) collapses to the SAME null as absent — no oracle', () => {
  assert.equal(parseGuardedEventsJsonl(logsRoot, sessionLogDirName(KIND, SID_SYMLINK_DIR)), null);
});

test('AT-F6-14: parseGuardedEventsJsonl — parses real JSONL lines from a genuine log dir', () => {
  const parsed = parseGuardedEventsJsonl(logsRoot, sessionLogDirName(KIND, SID_NORMAL));
  assert.ok(Array.isArray(parsed), `expected an array, got: ${JSON.stringify(parsed)}`);
  assert.equal(parsed!.length, 3);
});

// ---------------------------------------------------------------------------
// resolveLegacySession
// ---------------------------------------------------------------------------

test('AT-F6-15: resolveLegacySession — a genuine log dir with real events -> ok:true, phase = LAST, projectFromLog = FIRST (raw)', () => {
  const result = resolveLegacySession({ logsRoot, kind: KIND, sessionId: SID_NORMAL });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('unreachable');
  assert.equal(result.phase, 'awaiting-verdict');
  assert.equal(result.projectFromLog, 'normal-project');
  assert.equal(result.logDir, join(logsRoot, sessionLogDirName(KIND, SID_NORMAL)));
});

test('AT-F6-16: resolveLegacySession — an EMPTY (0-byte) events.jsonl still counts as present -> ok:true, phase \'\', projectFromLog \'\'', () => {
  const result = resolveLegacySession({ logsRoot, kind: KIND, sessionId: SID_EMPTY });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('unreachable');
  assert.equal(result.phase, '');
  assert.equal(result.projectFromLog, '');
});

test('AT-F6-17: resolveLegacySession — no log dir at all -> ok:false', () => {
  const result = resolveLegacySession({ logsRoot, kind: KIND, sessionId: 'sid-with-no-fixture-anywhere' });
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// Containment attacks — LOAD-BEARING: assert the artifact, not just the verdict
// ---------------------------------------------------------------------------

test('AT-F6-18: containment — the log dir is a SYMLINK to a directory outside logsRoot carrying a secret marker -> ok:false, marker never surfaces, outside file byte-unchanged', () => {
  const beforeBytes = readFileSync(outsideSymlinkDirEventsPath, 'utf8');
  const result = resolveLegacySession({ logsRoot, kind: KIND, sessionId: SID_SYMLINK_DIR });
  assert.equal(result.ok, false, 'a symlinked log dir must never resolve as readable');
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET_MARKER_DIR), 'the secret marker must never appear in the returned value');
  assert.equal(readFileSync(outsideSymlinkDirEventsPath, 'utf8'), beforeBytes, 'the outside file must be byte-unchanged');
});

test('AT-F6-19: containment — events.jsonl inside a REAL log dir is a SYMLINK to a file outside logsRoot -> ok:false, marker never surfaces, outside file byte-unchanged', () => {
  const beforeBytes = readFileSync(outsideSymlinkLeafPath, 'utf8');
  const result = resolveLegacySession({ logsRoot, kind: KIND, sessionId: SID_SYMLINK_LEAF });
  assert.equal(result.ok, false, 'a symlinked events.jsonl leaf must never resolve as readable');
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET_MARKER_LEAF), 'the secret marker must never appear in the returned value');
  assert.equal(readFileSync(outsideSymlinkLeafPath, 'utf8'), beforeBytes, 'the outside file must be byte-unchanged');
});

test('AT-F6-20: containment — events.jsonl is a HARDLINK to a file outside logsRoot (the nlink!==1 leaf check) -> ok:false, marker never surfaces, outside file byte-unchanged', () => {
  const beforeBytes = readFileSync(outsideHardlinkSourcePath, 'utf8');
  const result = resolveLegacySession({ logsRoot, kind: KIND, sessionId: SID_HARDLINK });
  assert.equal(result.ok, false, 'a hardlinked events.jsonl leaf must never resolve as readable');
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET_MARKER_HARDLINK), 'the secret marker must never appear in the returned value');
  assert.equal(readFileSync(outsideHardlinkSourcePath, 'utf8'), beforeBytes, 'the outside file must be byte-unchanged');
});

test('AT-F6-21: containment — a sessionId of ".." must never escape (direct call — a real HTTP client would normalise it away before it ever reached a server)', () => {
  const result = resolveLegacySession({ logsRoot, kind: KIND, sessionId: '..' });
  assert.equal(result.ok, false);
});

test('AT-F6-22: containment — a sessionId embedding a "/" must never escape (direct call), even though it spells the exact path to a REAL, otherwise-readable log dir', () => {
  const result = resolveLegacySession({ logsRoot, kind: KIND, sessionId: `../${sessionLogDirName(KIND, SID_NORMAL)}` });
  assert.equal(result.ok, false, 'a "/"-embedding sessionId must never resolve, even naming a real log dir');
});
