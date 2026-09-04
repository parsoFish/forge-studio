/**
 * Acceptance tests for `resolveReadableSession` / `sessionIsReadable`
 * (wave-8 F6 — "a linked session must be readable").
 *
 * T2 module-split course-correction (2026-08-28): `packages/sessions/session-readability.ts`
 * must stay an import LEAF (node:*, `./studio-path-guard.ts`,
 * `../orchestrator/**` only — see that file's own test header). But
 * `resolveReadableSession`'s legacy arm needs to VALIDATE a log-derived
 * project string, which is `invalidProjectReason`'s job — and that function
 * lives on packages/sessions/bridge-studio-sessions.ts and itself pulls `SAFE_ID_RE` from
 * apps/forge/bridge-studio.ts and `KB_SEEDING_ANCHOR_PREFIX` from
 * packages/knowledge/bridge-studio-kbs.ts. Importing any of that into the leaf would create
 * the bridge module graph's first import cycle, so `resolveReadableSession`
 * and `sessionIsReadable` are exported from packages/sessions/bridge-studio-sessions.ts
 * instead, composing `findSessionProject` + `resolveSafeSessionDir` +
 * `safeReadFileInSession` (all already in that file) with the new leaf's
 * `resolveLegacySession` — THIS file covers that composition.
 *
 * RED at branch base for TWO independent reasons, either of which the test
 * runner may report first:
 *   - `./session-readability.ts` does not exist yet (ERR_MODULE_NOT_FOUND) —
 *     this file imports `sessionLogDirName` from it purely to build fixture
 *     paths the same way a real caller would.
 *   - `packages/sessions/bridge-studio-sessions.ts` exists today but does not yet export
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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { sessionLogDirName } from '../../session-readability.ts';
import { resolveReadableSession, sessionIsReadable, invalidProjectReason } from '../../session-resolution.ts';
import { loadSessionKinds } from '../../studio/session-kinds.ts';

/** The REAL repo root — AT-F6-RR-18 runs its ratchet against the shipped
 *  `studio/session-kinds.yaml`, never a fixture copy, so ADDING a colliding
 *  kind id fails the gate rather than a hand-kept list going stale. */
const REPO_ROOT = new URL('../../../..', import.meta.url).pathname;

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
  // Round-2 review, finding 8: asserting only `source` is what let the project
  // spoof (finding 1) ship untested. The derived VALUES are the contract.
  assert.equal(result.phase, 'analyzing', 'the last metadata.phase this fixture log records');
  assert.equal(result.project, PROJ_SHAPE_B, 'the project whose _<kind>/<sid> dir genuinely exists — CONFIRMED, not echoed');
});

test('AT-F6-RR-04: resolveReadableSession — Shape B WITHOUT an explicit project, exactly ONE enumeration hit -> still resolves via single-hit auto-resolution', () => {
  const result = resolveReadableSession({ projectsRoot, logsRoot, kind: KIND, sessionId: SID_SHAPE_B });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('unreachable');
  assert.equal(result.source, 'legacy');
  assert.equal(result.phase, 'analyzing');
  assert.equal(result.project, PROJ_SHAPE_B, 'server-enumerated, and it is the real owner');
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

// ---------------------------------------------------------------------------
// W8-F6, T2 self-attack — `?project=` is EVIDENCE for the status arm (it names
// a directory that demonstrably exists) and a HINT ABOUT NOTHING for the legacy
// arm (that directory is gone). Echoing the hint back let
// `?project=<anything>` put a dead "Back to project" link on a page whose whole
// purpose is to stop minting links to nowhere.
// KILLS: `project: project ?? derived` — the caller's value taking precedence
// over the session's own log on the legacy arm.
// ---------------------------------------------------------------------------

test('AT-F6-RR-14: legacy arm — a bogus explicit ?project= never reaches the wire; the log-derived project wins', () => {
  const r = resolveReadableSession({
    projectsRoot, logsRoot, kind: KIND, sessionId: SID_SHAPE_A, project: 'no-such-project-anywhere',
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw new Error('unreachable');
  assert.equal(r.source, 'legacy');
  assert.equal(r.project, 'shapea-derived-project', 'the session log is the only evidence about a legacy session project');
});

test('AT-F6-RR-15: legacy arm — when the log names NO project, the callers explicit ?project= is still the fallback (honest-absent, not discarded)', () => {
  const r = resolveReadableSession({
    projectsRoot, logsRoot, kind: KIND, sessionId: SID_SHAPE_B, project: PROJ_SHAPE_B,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw new Error('unreachable');
  assert.equal(r.source, 'legacy');
  assert.equal(r.project, PROJ_SHAPE_B);
});

// ---------------------------------------------------------------------------
// Adversarial review round 2, finding 1 — the PRESENCE of `?project=` is not
// evidence that it owns the session. Only a real `<project>/_<kind>/<sid>` dir
// confirms that. Before this fix an unconfirmed caller value reached the wire,
// so `?project=<anything>` both minted a dead "back to project" link and, for a
// Shape-B session, displaced the genuine owner with an unrelated real project.
// KILLS: `project: project ?? derived` and `project: derived !== '' ? derived
// : (project ?? '')` — any precedence that lets an UNCONFIRMED caller value out.
// ---------------------------------------------------------------------------

test('AT-F6-RR-16: an unconfirmed ?project= NEVER reaches the wire — a real but unrelated project cannot displace the confirmed owner', () => {
  // PROJ_STATUS is a genuinely existing project; it just does not own SID_SHAPE_B.
  const r = resolveReadableSession({ projectsRoot, logsRoot, kind: KIND, sessionId: SID_SHAPE_B, project: PROJ_STATUS });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw new Error('unreachable');
  assert.equal(r.source, 'legacy');
  assert.notEqual(r.project, PROJ_STATUS, 'an unconfirmed caller-supplied project must never reach the wire');
  assert.equal(r.project, '', 'this fixture log names no project, so the honest answer is honest-absent');
});

test('AT-F6-RR-17: the two shapes of "cannot evidence a project" are INDISTINGUISHABLE — a nonexistent name and a real-but-unrelated one give the same answer (no project-existence oracle)', () => {
  const unrelatedReal = resolveReadableSession({ projectsRoot, logsRoot, kind: KIND, sessionId: SID_SHAPE_B, project: PROJ_STATUS });
  const nonexistent = resolveReadableSession({ projectsRoot, logsRoot, kind: KIND, sessionId: SID_SHAPE_B, project: 'no-such-project-anywhere' });
  assert.deepEqual(unrelatedReal, nonexistent);
});

// ---------------------------------------------------------------------------
// Adversarial review round 2, informational #10 — the concatenated
// `_<kind>-<sessionId>` log-dir segment is only unambiguous because no
// registered session-kind id is a prefix of another id followed by "-". That
// invariant held by luck: nothing enforced it. This is the ratchet, run against
// the REAL studio/session-kinds.yaml so ADDING a colliding kind fails here.
// KILLS: adding e.g. a `kb` kind alongside `kb-cleanup`, after which
// sessionLogDirName('kb','cleanup-X') and sessionLogDirName('kb-cleanup','X')
// address the SAME directory.
// ---------------------------------------------------------------------------

test('AT-F6-RR-18: no REGISTERED session-kind id is a prefix of another id + "-" — the invariant that makes `_<kind>-<sessionId>` unambiguous', () => {
  const ids = loadSessionKinds(REPO_ROOT).map((d) => d.id);
  // Prove the loader read the REAL registry by comparing against the file's own
  // rows, not by counting them. `ids.length >= 5` was a proxy for "this is not
  // an empty list": it kills the vacuous pass, but it also goes red the day the
  // registry legitimately shrinks below five — a guard failing because the work
  // succeeded. The yaml's `- id:` rows are the thing itself, so this is strictly
  // stronger (a loader returning four of seven ids now fails too) and carries no
  // floor on a number that is allowed to move.
  const authored = readFileSync(join(REPO_ROOT, 'studio', 'session-kinds.yaml'), 'utf8')
    .split('\n')
    .flatMap((l) => {
      const m = /^- id:\s*(\S+)\s*$/.exec(l);
      return m === null ? [] : [m[1]];
    });
  assert.ok(authored.length > 0, 'fixture precondition: studio/session-kinds.yaml must declare at least one kind');
  assert.deepEqual(ids, authored, 'the loader must return exactly the kinds studio/session-kinds.yaml declares, in order');
  const collisions: string[] = [];
  for (const a of ids) {
    for (const b of ids) {
      if (a !== b && b.startsWith(`${a}-`)) collisions.push(`"${b}" starts with "${a}-"`);
    }
  }
  assert.deepEqual(collisions, [], `a colliding pair makes two different (kind, sessionId) requests address ONE log dir: ${collisions.join('; ')}`);
});
