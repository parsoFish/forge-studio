/**
 * Acceptance tests for `resolveReadableSession` / `sessionIsReadable`
 * (wave-8 F6 — "a linked session must be readable").
 *
 * T2 module-split course-correction (2026-08-28): `cli/session-readability.ts`
 * must stay an import LEAF (node:*, `./studio-path-guard.ts`,
 * `../orchestrator/**` only — see that file's own test header). But
 * `resolveReadableSession`'s legacy arm needs to VALIDATE a log-derived
 * project string, which is `invalidProjectReason`'s job — and that function
 * lives on cli/bridge-studio-sessions.ts and itself pulls `SAFE_ID_RE` from
 * cli/bridge-studio.ts and `KB_SEEDING_ANCHOR_PREFIX` from
 * cli/bridge-studio-kbs.ts. Importing any of that into the leaf would create
 * the bridge module graph's first import cycle, so `resolveReadableSession`
 * and `sessionIsReadable` are exported from cli/bridge-studio-sessions.ts
 * instead, composing `findSessionProject` + `resolveSafeSessionDir` +
 * `safeReadFileInSession` (all already in that file) with the new leaf's
 * `resolveLegacySession` — THIS file covers that composition.
 *
 * RED at branch base for TWO independent reasons, either of which the test
 * runner may report first:
 *   - `./session-readability.ts` does not exist yet (ERR_MODULE_NOT_FOUND) —
 *     this file imports `sessionLogDirName` from it purely to build fixture
 *     paths the same way a real caller would.
 *   - `cli/bridge-studio-sessions.ts` exists today but does not yet export
 *     `resolveReadableSession`/`sessionIsReadable` — once the leaf import
 *     above is satisfied, this becomes a SyntaxError ("does not provide an
 *     export named ...").
 *
 * Fixture layout, exactly as the F6 spec's step 2/3 describe:
 *   <root>/projects/<p>/_<kind>/<sid>/status.json
 *   <root>/_logs/_<kind>-<sid>/events.jsonl
 *
 * The legacy arm's project-validation fallback ('' on an invalid
 * metadata.project) is asserted against `invalidProjectReason`'s OWN live
 * verdicts (imported, not re-implemented), so this file's oracle cannot
 * silently drift out of step with the one place that owns that rule.
 *
 * IMPORTANT DESIGN NOTE for whoever implements `resolveReadableSession`:
 * AT-F6-RR-02/04 below pin that a ZERO-hit project enumeration (no project-
 * side `_<kind>/<sid>` dir under ANY project — the Shape-A defect this whole
 * initiative exists to fix) must NOT immediately short-circuit to
 * `{ok:false, reason:'not-found'}` the way the EXISTING `findSessionProject`
 * does for a zero-hit result. The F6 spec's own step 1 only calls out the
 * TWO-OR-MORE-hits case as an immediate `ambiguous` failure; a zero-hit
 * enumeration must leave `project` UNRESOLVED and fall through to step 3
 * (the log-dir/legacy check) — reusing `findSessionProject`'s return value
 * verbatim as "the resolved project or an immediate failure" would silently
 * break Shape A, the primary defect this initiative targets.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { sessionLogDirName } from './session-readability.ts';
import { resolveReadableSession, sessionIsReadable, invalidProjectReason } from './bridge-studio-sessions.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let root: string;
let projectsRoot: string;
let logsRoot: string;

const KIND = 'architect';

const PROJ_STATUS = 'proj-status';
const SID_STATUS = '2026-08-01T10-00-00-status';

const SID_SHAPE_A = '2026-08-01T10-00-00-shapea';

const PROJ_SHAPE_B = 'proj-shapeb';
const SID_SHAPE_B = '2026-08-01T10-00-00-shapeb';

const PROJ_STATUS_MISSING = 'proj-statusmissing';
const SID_STATUS_MISSING = '2026-08-01T10-00-00-statusmissing';

const PROJ_STATUS_NOPHASE = 'proj-statusnophase';
const SID_STATUS_NOPHASE = '2026-08-01T10-00-00-statusnophase';

const SID_NOT_FOUND = '2026-08-01T10-00-00-notfound';

const PROJ_AMBIG_A = 'proj-ambig-a';
const PROJ_AMBIG_B = 'proj-ambig-b';
const SID_AMBIGUOUS = '2026-08-01T10-00-00-ambiguous';

const SID_EMPTY_EVENTS = '2026-08-01T10-00-00-emptyevents';

const SID_BADPROJECT_TRAVERSAL = '2026-08-01T10-00-00-badprojtraversal';
const SID_BADPROJECT_SLASH = '2026-08-01T10-00-00-badprojslash';
const SID_KB_ANCHOR_PROJECT = '2026-08-01T10-00-00-kbanchorproj';

function writeEventsJsonl(dir: string, lines: Array<Record<string, unknown>>): void {
  mkdirSync(dir, { recursive: true });
  const body = lines.map((l) => JSON.stringify(l)).join('\n');
  writeFileSync(join(dir, 'events.jsonl'), body.length > 0 ? `${body}\n` : '', 'utf8');
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'session-readability-resolve-'));
  projectsRoot = join(root, 'projects');
  logsRoot = join(root, '_logs');
  mkdirSync(projectsRoot, { recursive: true });
  mkdirSync(logsRoot, { recursive: true });

  // status-backed: a real status.json with a string phase.
  const statusDir = join(projectsRoot, PROJ_STATUS, `_${KIND}`, SID_STATUS);
  mkdirSync(statusDir, { recursive: true });
  writeFileSync(join(statusDir, 'status.json'), JSON.stringify({ session_id: SID_STATUS, project: PROJ_STATUS, phase: 'awaiting-verdict' }), 'utf8');

  // Shape A: log dir only — NO project-side dir anywhere, under any project.
  writeEventsJsonl(join(logsRoot, sessionLogDirName(KIND, SID_SHAPE_A)), [
    { event_id: 'e1', metadata: { session_id: SID_SHAPE_A, phase: 'briefing' } },
    { event_id: 'e2', metadata: { session_id: SID_SHAPE_A, phase: 'awaiting-verdict', project: 'shapea-derived-project' } },
  ]);

  // Shape B: project-side dir exists (NO status.json) + a companion log dir.
  mkdirSync(join(projectsRoot, PROJ_SHAPE_B, `_${KIND}`, SID_SHAPE_B), { recursive: true });
  writeEventsJsonl(join(logsRoot, sessionLogDirName(KIND, SID_SHAPE_B)), [
    { event_id: 'e1', metadata: { session_id: SID_SHAPE_B, phase: 'analyzing' } },
  ]);

  // status-missing: a malformed status.json, and NO log dir.
  const missingDir = join(projectsRoot, PROJ_STATUS_MISSING, `_${KIND}`, SID_STATUS_MISSING);
  mkdirSync(missingDir, { recursive: true });
  writeFileSync(join(missingDir, 'status.json'), 'not valid json {{{', 'utf8');

  // status-no-phase: valid JSON object, non-string phase, and NO log dir.
  const noPhaseDir = join(projectsRoot, PROJ_STATUS_NOPHASE, `_${KIND}`, SID_STATUS_NOPHASE);
  mkdirSync(noPhaseDir, { recursive: true });
  writeFileSync(join(noPhaseDir, 'status.json'), JSON.stringify({ session_id: SID_STATUS_NOPHASE, project: PROJ_STATUS_NOPHASE, phase: 42 }), 'utf8');

  // ambiguous: the SAME _<kind>/<sid> exists under TWO different projects.
  mkdirSync(join(projectsRoot, PROJ_AMBIG_A, `_${KIND}`, SID_AMBIGUOUS), { recursive: true });
  mkdirSync(join(projectsRoot, PROJ_AMBIG_B, `_${KIND}`, SID_AMBIGUOUS), { recursive: true });

  // empty events.jsonl, no project-side dir.
  mkdirSync(join(logsRoot, sessionLogDirName(KIND, SID_EMPTY_EVENTS)), { recursive: true });
  writeFileSync(join(logsRoot, sessionLogDirName(KIND, SID_EMPTY_EVENTS), 'events.jsonl'), '', 'utf8');

  // Legacy project-validation fixtures: log dir only, no project-side dir.
  writeEventsJsonl(join(logsRoot, sessionLogDirName(KIND, SID_BADPROJECT_TRAVERSAL)), [
    { event_id: 'e1', metadata: { session_id: SID_BADPROJECT_TRAVERSAL, phase: 'briefing', project: '../../etc' } },
  ]);
  writeEventsJsonl(join(logsRoot, sessionLogDirName(KIND, SID_BADPROJECT_SLASH)), [
    { event_id: 'e1', metadata: { session_id: SID_BADPROJECT_SLASH, phase: 'briefing', project: 'a/b' } },
  ]);
  writeEventsJsonl(join(logsRoot, sessionLogDirName(KIND, SID_KB_ANCHOR_PROJECT)), [
    { event_id: 'e1', metadata: { session_id: SID_KB_ANCHOR_PROJECT, phase: 'briefing', project: '.kb-validkb' } },
  ]);
});

after(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// resolveReadableSession
// ---------------------------------------------------------------------------

test('AT-F6-RR-01: resolveReadableSession — status.json present with a string phase -> {ok:true, source:"status", phase, project}', () => {
  const result = resolveReadableSession({ projectsRoot, logsRoot, kind: KIND, sessionId: SID_STATUS, project: PROJ_STATUS });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('unreachable');
  assert.equal(result.source, 'status');
  assert.equal(result.phase, 'awaiting-verdict');
  assert.equal(result.project, PROJ_STATUS);
});

test('AT-F6-RR-02: resolveReadableSession — Shape A (log dir only, no project-side dir anywhere, NO ?project=) -> legacy-readable with derived phase/project', () => {
  const result = resolveReadableSession({ projectsRoot, logsRoot, kind: KIND, sessionId: SID_SHAPE_A });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('unreachable');
  assert.equal(result.source, 'legacy');
  assert.equal(result.phase, 'awaiting-verdict', 'last metadata.phase across the fixture events');
  assert.equal(result.project, 'shapea-derived-project', 'first VALID metadata.project across the fixture events');
});

test('AT-F6-RR-03: resolveReadableSession — Shape B (project-side dir exists, no status.json, log dir with events.jsonl), explicit project -> legacy-readable', () => {
  const result = resolveReadableSession({ projectsRoot, logsRoot, kind: KIND, sessionId: SID_SHAPE_B, project: PROJ_SHAPE_B });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('unreachable');
  assert.equal(result.source, 'legacy');
});

test('AT-F6-RR-04: resolveReadableSession — Shape B WITHOUT an explicit project, exactly ONE enumeration hit -> still resolves via single-hit auto-resolution', () => {
  const result = resolveReadableSession({ projectsRoot, logsRoot, kind: KIND, sessionId: SID_SHAPE_B });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('unreachable');
  assert.equal(result.source, 'legacy');
});

test('AT-F6-RR-05: resolveReadableSession — project-side dir with a MALFORMED status.json and NO log dir -> {ok:false, reason:"status-missing"}', () => {
  const result = resolveReadableSession({ projectsRoot, logsRoot, kind: KIND, sessionId: SID_STATUS_MISSING, project: PROJ_STATUS_MISSING });
  assert.deepEqual(result, { ok: false, reason: 'status-missing', project: PROJ_STATUS_MISSING });
});

test('AT-F6-RR-06: resolveReadableSession — valid JSON but a non-string phase, and NO log dir -> {ok:false, reason:"status-no-phase"}', () => {
  const result = resolveReadableSession({ projectsRoot, logsRoot, kind: KIND, sessionId: SID_STATUS_NOPHASE, project: PROJ_STATUS_NOPHASE });
  assert.deepEqual(result, { ok: false, reason: 'status-no-phase', project: PROJ_STATUS_NOPHASE });
});

test('AT-F6-RR-07: resolveReadableSession — nothing anywhere -> {ok:false, reason:"not-found"}', () => {
  const result = resolveReadableSession({ projectsRoot, logsRoot, kind: KIND, sessionId: SID_NOT_FOUND });
  if (result.ok) throw new Error('unreachable: expected ok:false');
  assert.equal(result.reason, 'not-found');
});

test('AT-F6-RR-08: resolveReadableSession — the SAME _<kind>/<sid> exists under TWO projects, no explicit project -> {ok:false, reason:"ambiguous"}', () => {
  const result = resolveReadableSession({ projectsRoot, logsRoot, kind: KIND, sessionId: SID_AMBIGUOUS });
  if (result.ok) throw new Error('unreachable: expected ok:false');
  assert.equal(result.reason, 'ambiguous');
});

test('AT-F6-RR-09: resolveReadableSession — an EMPTY (0-byte) events.jsonl still counts as present -> {ok:true, source:"legacy", phase:""}', () => {
  const result = resolveReadableSession({ projectsRoot, logsRoot, kind: KIND, sessionId: SID_EMPTY_EVENTS });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('unreachable');
  assert.equal(result.source, 'legacy');
  assert.equal(result.phase, '');
});

test('AT-F6-RR-10: resolveReadableSession — a legacy-derived project of "../../etc" never reaches the wire; invalidProjectReason rejects it and the field falls back to \'\'', () => {
  assert.notEqual(invalidProjectReason('../../etc'), null, 'sanity: ../../etc must be invalid per invalidProjectReason');
  const result = resolveReadableSession({ projectsRoot, logsRoot, kind: KIND, sessionId: SID_BADPROJECT_TRAVERSAL });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('unreachable');
  assert.equal(result.source, 'legacy');
  assert.equal(result.project, '', 'a traversal-shaped log-derived project must never reach the wire — it falls back to the honest empty string');
});

test('AT-F6-RR-11: resolveReadableSession — a legacy-derived project of "a/b" never reaches the wire; falls back to \'\'', () => {
  assert.notEqual(invalidProjectReason('a/b'), null, 'sanity: a/b must be invalid per invalidProjectReason');
  const result = resolveReadableSession({ projectsRoot, logsRoot, kind: KIND, sessionId: SID_BADPROJECT_SLASH });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('unreachable');
  assert.equal(result.project, '');
});

test('AT-F6-RR-12: resolveReadableSession — a legacy-derived project of ".kb-<id>" (the seeding-anchor carve-out) IS accepted verbatim — the fallback is not a blanket reject-anything-with-a-dot rule', () => {
  assert.equal(invalidProjectReason('.kb-validkb'), null, 'sanity: .kb-validkb is the accepted dot-anchor carve-out');
  const result = resolveReadableSession({ projectsRoot, logsRoot, kind: KIND, sessionId: SID_KB_ANCHOR_PROJECT });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('unreachable');
  assert.equal(result.project, '.kb-validkb');
});

test('AT-F6-RR-13: sessionIsReadable agrees with resolveReadableSession(...).ok for every fixture scenario', () => {
  const scenarios: Array<{ label: string; args: Parameters<typeof resolveReadableSession>[0] }> = [
    { label: 'status-backed', args: { projectsRoot, logsRoot, kind: KIND, sessionId: SID_STATUS, project: PROJ_STATUS } },
    { label: 'shape-a', args: { projectsRoot, logsRoot, kind: KIND, sessionId: SID_SHAPE_A } },
    { label: 'shape-b (explicit project)', args: { projectsRoot, logsRoot, kind: KIND, sessionId: SID_SHAPE_B, project: PROJ_SHAPE_B } },
    { label: 'shape-b (auto-resolved)', args: { projectsRoot, logsRoot, kind: KIND, sessionId: SID_SHAPE_B } },
    { label: 'status-missing', args: { projectsRoot, logsRoot, kind: KIND, sessionId: SID_STATUS_MISSING, project: PROJ_STATUS_MISSING } },
    { label: 'status-no-phase', args: { projectsRoot, logsRoot, kind: KIND, sessionId: SID_STATUS_NOPHASE, project: PROJ_STATUS_NOPHASE } },
    { label: 'not-found', args: { projectsRoot, logsRoot, kind: KIND, sessionId: SID_NOT_FOUND } },
    { label: 'ambiguous', args: { projectsRoot, logsRoot, kind: KIND, sessionId: SID_AMBIGUOUS } },
    { label: 'empty-events', args: { projectsRoot, logsRoot, kind: KIND, sessionId: SID_EMPTY_EVENTS } },
  ];
  for (const { label, args } of scenarios) {
    const resolved = resolveReadableSession(args);
    assert.equal(sessionIsReadable(args), resolved.ok, `sessionIsReadable must agree with resolveReadableSession(...).ok for scenario "${label}"`);
  }
});
