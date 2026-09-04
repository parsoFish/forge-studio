/**
 * ACCEPTANCE TESTS (R6-06 round 6, adversarial-containment-review) —
 * `GET /api/agents/:slug/history` (apps/forge/ui-bridge.ts): six LIVE, REPRODUCED
 * filesystem escapes across its three collectors. D5 in the sibling suite
 * (`ui-bridge-agent-history.test.ts`) already pins that the caller-supplied
 * `slug` is never joined into a path — that claim is TRUE and is NOT what
 * this file tests. What this file pins is the OTHER half: entry NAMES read
 * off disk during enumeration (`readdirSync` results — directory/session
 * names the ROUTE did not choose) are dereferenced with plain
 * `existsSync`/`statSync`/`readFileSync`/`readSessionStatus` — zero
 * realpath, zero `nlink` check — so a symlink or hardlink PLANTED at one of
 * those enumerated names is silently followed and served.
 *
 * THE SIX ESCAPES (task brief numbering, kept verbatim so this file's tests
 * map 1:1 onto the report):
 *   STANDALONE (`collectStandaloneRows` — parseEventsJsonl ~789, statSync ~913):
 *     1. `_logs/_agent-*` is a DIRECTORY symlink pointing outside.
 *     2. Real dir, `events.jsonl` is a FILE symlink pointing outside.
 *     3. `events.jsonl` is a HARDLINK (nlink===2) to an outside file.
 *   SESSION (`collectSessionRows` — existsSync(kindDir) ~981, readdirSync ~984,
 *   readSessionStatus ~990):
 *     4. `projects/<p>/_<kind>` is a DIRECTORY symlink — the P0. Realistic
 *        fixture: a RELATIVE symlink of exactly the `git update-index
 *        --cacheinfo 120000` shape (host-path-agnostic, plantable by an
 *        ordinary commit to any onboarded project's own repo).
 *     5. Real session dir, `status.json` is a FILE symlink pointing outside.
 *     6. `status.json` is a HARDLINK (nlink===2) to an outside file.
 *
 * ADVERSARIAL FINDING (see task report — flagged loudly, not silently
 * designed around): the task brief frames the fix as "the guards already
 * exist, they were simply never called" and names `resolveSafeSessionDir` +
 * `safeReadFileInSession` (packages/sessions/bridge-studio-sessions.ts) as the session-side
 * guard pair. Two things measured directly against THIS repo's checked-out
 * source, live, before writing anything below:
 *   (a) `resolveSafeSessionDir`'s current containment check computes
 *       `realpathSync(parentDir)` FIRST (folding `project` — the untrusted
 *       segment — into what becomes its comparison baseline) and then only
 *       checks the CANDIDATE against that already-resolved baseline. When
 *       `parentDir` itself (the `<project>/_<kind>` dir) is the symlink, the
 *       baseline IS the escaped location, so the "containment" check is
 *       tautological — proven by a standalone Node repro script (see task
 *       report) BEFORE writing this file: `resolveSafeSessionDir` returns
 *       the VICTIM's real session path as "safe" for exactly this escape
 *       shape. This is the exact "root-folding" defect
 *       `cli/studio-path-guard.ts`'s own docstring warns about, just
 *       relocated into a sibling module that does not yet use that guard's
 *       per-segment IDENTITY-walk pattern. Escape 4's test below therefore
 *       pins the OUTCOME (no cross-project duplication), not "just call
 *       resolveSafeSessionDir" — that alone will not close it as currently
 *       written.
 *   (b) `session-transcript.ts`'s own module docstring states hardlink
 *       escapes on `status.json` are an ACCEPTED, NOT-FIXED residual for
 *       `safeReadFileInSession` ("a hardlink has no separate target to
 *       resolve away from ... this is accepted, not fixed"). The R6-06 task
 *       brief lists escape 6 (a hardlinked status.json) as one of the six
 *       MUST-CLOSE escapes for the history route. Escape 6's test below
 *       holds the history route to the task brief's bar, not the older
 *       module's accepted-residual bar — closing it will require an nlink
 *       check somewhere in this call path, which `safeReadFileInSession`
 *       today does not have.
 *
 * ASSERTION STRENGTH (adversarial-containment-review skill):
 *   - The ARTIFACT, never the status code: each test plants a distinctive
 *     sentinel in the OUTSIDE file and asserts the sentinel is absent from
 *     the response body — never merely "not 200" (escapes 1/2/3/5/6). Escape
 *     4 cannot use a bare "absent" oracle (see its own test comment for why
 *     — the realistic fixture makes the victim content ALSO legitimately
 *     reachable via the victim project's own real, unavoidably-enumerated
 *     directory) and instead uses the strictly equivalent duplicate-
 *     attribution proof.
 *   - Per-element isolation: every poisoned entry sits ALONGSIDE a
 *     legitimate sibling entry for the SAME query — a collection-wide-abort
 *     "fix" (500 the whole request) fails these tests exactly as hard as the
 *     original leak, because the legitimate sibling would also vanish.
 *   - Indistinguishability: the row COUNT for the queried slug/kind, after
 *     the fix, must be identical to "the poisoned entry was never there at
 *     all" — never a distinguishable error shape.
 *   - False-rejection: a final dedicated test (after every poisoned fixture
 *     above already exists on disk) proves an ordinary, wholly unrelated
 *     legitimate standalone run and session are still found.
 *   - Fixture-plants-what-it-claims: every escape test asserts
 *     lstat/readlink/nlink evidence BEFORE issuing the request.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync,
  symlinkSync, linkSync, lstatSync, readlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

let forgeRoot: string;
let projectsRoot: string;
let logsRoot: string;
let url: string;
let close: () => Promise<void>;

// ---------------------------------------------------------------------------
// Session-kind registry — one synthetic descriptor per escape test (+ one for
// the false-rejection control) so each test's query is fully isolated: no
// cross-contamination between escapes' rows, and exact row counts are
// meaningful assertions rather than approximations.
// ---------------------------------------------------------------------------

const SESSION_KINDS_YAML = `- id: esc4kind
  agent: esc4agent
  title: Escape 4 kind
  legacyRoutes:
    - /esc4/[sessionId]
  stages: [roadmap]
  defaultStage: roadmap
  artifact:
    kind: roadmap-draft
    label: Escape 4 artifact
- id: esc5kind
  agent: esc5agent
  title: Escape 5 kind
  legacyRoutes:
    - /esc5/[sessionId]
  stages: [roadmap]
  defaultStage: roadmap
  artifact:
    kind: roadmap-draft
    label: Escape 5 artifact
- id: esc6kind
  agent: esc6agent
  title: Escape 6 kind
  legacyRoutes:
    - /esc6/[sessionId]
  stages: [roadmap]
  defaultStage: roadmap
  artifact:
    kind: roadmap-draft
    label: Escape 6 artifact
- id: ordinarykind
  agent: ordinaryagent
  title: Ordinary (false-rejection control) kind
  legacyRoutes:
    - /ordinary/[sessionId]
  stages: [roadmap]
  defaultStage: roadmap
  artifact:
    kind: roadmap-draft
    label: Ordinary artifact
`;

function seedSessionKindsYaml(): void {
  const dir = join(forgeRoot, 'studio');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'session-kinds.yaml'), SESSION_KINDS_YAML);
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** A real (never symlinked/hardlinked) `_logs/_agent-<slug>-<stamp>/events.jsonl`
 *  — mirrors `runAgent`'s real emitted shape and `standaloneRunMatchesSlug`'s
 *  identity contract (agent_slug on both start+end events). */
function seedRealStandaloneRun(dirName: string, slug: string, costUsd: number): string {
  const dir = join(logsRoot, dirName);
  mkdirSync(dir, { recursive: true });
  const events = [
    { event_id: 'EV_0', cycle_id: dirName, initiative_id: dirName, phase: 'orchestrator', skill: slug, event_type: 'start', started_at: '2026-01-01T00:00:00.000Z', input_refs: [], output_refs: [], metadata: { agent_phase: 'standalone', agent_slug: slug } },
    { event_id: 'EV_1', cycle_id: dirName, initiative_id: dirName, phase: 'orchestrator', skill: slug, event_type: 'end', started_at: '2026-01-01T00:01:00.000Z', input_refs: [], output_refs: [], cost_usd: costUsd, metadata: { agent_phase: 'standalone', agent_slug: slug } },
  ];
  writeFileSync(join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return dir;
}

/** The same events.jsonl SHAPE, written to an arbitrary standalone location
 *  (used for the "outside" file/dir an escape fixture points at). */
function writeEventsJsonlAt(path: string, slug: string, costUsd: number): void {
  const events = [
    { event_id: 'EV_0', cycle_id: 'outside', initiative_id: 'outside', phase: 'orchestrator', skill: slug, event_type: 'start', started_at: '2026-01-01T00:00:00.000Z', input_refs: [], output_refs: [], metadata: { agent_phase: 'standalone', agent_slug: slug } },
    { event_id: 'EV_1', cycle_id: 'outside', initiative_id: 'outside', phase: 'orchestrator', skill: slug, event_type: 'end', started_at: '2026-01-01T00:01:00.000Z', input_refs: [], output_refs: [], cost_usd: costUsd, metadata: { agent_phase: 'standalone', agent_slug: slug } },
  ];
  writeFileSync(path, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

function writeStatusJsonAt(path: string, sessionId: string, project: string, phase: string): void {
  writeFileSync(path, JSON.stringify({ session_id: sessionId, project, phase, updated_at: '2026-01-01T00:10:00.000Z' }, null, 2));
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

async function getJson(path: string): Promise<{ status: number; text: string; body: unknown }> {
  const res = await fetch(`${url}${path}`);
  const text = await res.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: res.status, text, body };
}

type Row = { id: string; linkKind: string; href: string; status: string; costUsd: number | null };

// ---------------------------------------------------------------------------
// Setup — every escape fixture is planted ONCE in `before()`, and every
// escape's poisoned entry lives ALONGSIDE a legitimate sibling for the
// per-element-isolation pin (rule 2). The false-rejection control fixture
// (`ordinarykind`/`ordinary-standalone-1`) is seeded here too, so its own
// test proves the guard doesn't over-reject in the presence of every
// adversarial fixture above, not in a clean, unpoisoned forgeRoot.
// ---------------------------------------------------------------------------

const ESC1_SENTINEL_COST = 9137733.01;
const ESC2_SENTINEL_COST = 8244669.02;
const ESC3_SENTINEL_COST = 7355991.03;
const ESC4_SENTINEL_PHASE = 'SENTINEL-P0-ESC4-VICTIM-7f2c9a';
const ESC5_SENTINEL_PHASE = 'SENTINEL-ESC5-STATUS-ab12cd34';
const ESC6_SENTINEL_PHASE = 'SENTINEL-ESC6-STATUS-ef56gh78';

let esc1OutsideDir: string;
let esc1PoisonDirName: string;
let esc1LegitDirName: string;

let esc2OutsideFile: string;
let esc2PoisonDirName: string;
let esc2LegitDirName: string;

let esc3OutsideFile: string;
let esc3PoisonDirName: string;
let esc3LegitDirName: string;

let esc4VictimStatusPath: string;
let esc4VictimSessionId: string;
let esc4LegitSessionId: string;
let esc4MaliciousKindPath: string;

let esc5OutsideStatusPath: string;
let esc5PoisonSessionId: string;
let esc5LegitSessionId: string;
let esc5PoisonStatusPath: string;

let esc6OutsideStatusPath: string;
let esc6PoisonSessionId: string;
let esc6LegitSessionId: string;
let esc6PoisonStatusPath: string;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-agent-history-containment-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'merged', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  logsRoot = join(forgeRoot, '_logs');
  projectsRoot = join(forgeRoot, 'projects');
  mkdirSync(logsRoot, { recursive: true });
  mkdirSync(projectsRoot, { recursive: true });
  seedSessionKindsYaml();

  // --- Escape 1: _logs/_agent-esc1-* is a DIRECTORY symlink -----------------
  esc1OutsideDir = join(forgeRoot, '_outside-standalone-1');
  mkdirSync(esc1OutsideDir, { recursive: true });
  writeEventsJsonlAt(join(esc1OutsideDir, 'events.jsonl'), 'esc1', ESC1_SENTINEL_COST);
  esc1PoisonDirName = '_agent-esc1-2026-01-01T00-00-00-000-poison';
  symlinkSync(esc1OutsideDir, join(logsRoot, esc1PoisonDirName), 'dir');
  esc1LegitDirName = '_agent-esc1-2026-01-01T00-05-00-000-legit';
  seedRealStandaloneRun(esc1LegitDirName, 'esc1', 3.21);

  // --- Escape 2: real dir, events.jsonl is a FILE symlink -------------------
  const esc2OutsideDir = join(forgeRoot, '_outside-standalone-2');
  mkdirSync(esc2OutsideDir, { recursive: true });
  esc2OutsideFile = join(esc2OutsideDir, 'events.jsonl');
  writeEventsJsonlAt(esc2OutsideFile, 'esc2', ESC2_SENTINEL_COST);
  esc2PoisonDirName = '_agent-esc2-2026-01-01T00-00-00-000-poison';
  mkdirSync(join(logsRoot, esc2PoisonDirName), { recursive: true }); // REAL directory
  symlinkSync(esc2OutsideFile, join(logsRoot, esc2PoisonDirName, 'events.jsonl'), 'file');
  esc2LegitDirName = '_agent-esc2-2026-01-01T00-05-00-000-legit';
  seedRealStandaloneRun(esc2LegitDirName, 'esc2', 4.32);

  // --- Escape 3: events.jsonl is a HARDLINK (nlink===2) ----------------------
  const esc3OutsideDir = join(forgeRoot, '_outside-standalone-3');
  mkdirSync(esc3OutsideDir, { recursive: true });
  esc3OutsideFile = join(esc3OutsideDir, 'events.jsonl');
  writeEventsJsonlAt(esc3OutsideFile, 'esc3', ESC3_SENTINEL_COST);
  esc3PoisonDirName = '_agent-esc3-2026-01-01T00-00-00-000-poison';
  mkdirSync(join(logsRoot, esc3PoisonDirName), { recursive: true }); // REAL directory
  linkSync(esc3OutsideFile, join(logsRoot, esc3PoisonDirName, 'events.jsonl')); // HARDLINK
  esc3LegitDirName = '_agent-esc3-2026-01-01T00-05-00-000-legit';
  seedRealStandaloneRun(esc3LegitDirName, 'esc3', 5.43);

  // --- Escape 4 (P0): projects/<p>/_esc4kind is a DIRECTORY symlink ----------
  // Realistic, host-path-agnostic RELATIVE symlink — exactly the shape
  // `git update-index --cacheinfo 120000` produces, plantable by an ordinary
  // commit to the malicious project's own repo with zero knowledge of the
  // operator's disk layout (only forge's own fixed internal shape:
  // projects/<name>/_<kind>).
  const victimProjectDir = join(projectsRoot, 'victim-project-esc4');
  esc4VictimSessionId = '2026-05-01T00-00-00-victim';
  const victimSessionDir = join(victimProjectDir, '_esc4kind', esc4VictimSessionId);
  mkdirSync(victimSessionDir, { recursive: true });
  esc4VictimStatusPath = join(victimSessionDir, 'status.json');
  writeStatusJsonAt(esc4VictimStatusPath, esc4VictimSessionId, 'victim-project-esc4', ESC4_SENTINEL_PHASE);

  const maliciousProjectDir = join(projectsRoot, 'malicious-project-esc4');
  mkdirSync(maliciousProjectDir, { recursive: true });
  esc4MaliciousKindPath = join(maliciousProjectDir, '_esc4kind');
  symlinkSync('../victim-project-esc4/_esc4kind', esc4MaliciousKindPath, 'dir');

  // A THIRD, wholly unrelated legitimate project — never touched by the
  // malicious symlink at all — for the per-element-isolation pin.
  const legitProjectDir = join(projectsRoot, 'legit-project-esc4');
  esc4LegitSessionId = '2026-05-02T00-00-00-legit';
  const legitSessionDir = join(legitProjectDir, '_esc4kind', esc4LegitSessionId);
  mkdirSync(legitSessionDir, { recursive: true });
  writeStatusJsonAt(join(legitSessionDir, 'status.json'), esc4LegitSessionId, 'legit-project-esc4', 'awaiting-verdict');

  // --- Escape 5: real session dir, status.json is a FILE symlink ------------
  const esc5OutsideDir = join(forgeRoot, '_outside-session-5');
  mkdirSync(esc5OutsideDir, { recursive: true });
  esc5OutsideStatusPath = join(esc5OutsideDir, 'fake-status.json');
  esc5PoisonSessionId = 'esc5-poison-session';
  writeStatusJsonAt(esc5OutsideStatusPath, esc5PoisonSessionId, 'esc5project', ESC5_SENTINEL_PHASE);
  const esc5PoisonSessionDir = join(projectsRoot, 'esc5project', '_esc5kind', esc5PoisonSessionId);
  mkdirSync(esc5PoisonSessionDir, { recursive: true }); // REAL session dir
  esc5PoisonStatusPath = join(esc5PoisonSessionDir, 'status.json');
  symlinkSync(esc5OutsideStatusPath, esc5PoisonStatusPath, 'file');
  esc5LegitSessionId = 'esc5-legit-session';
  const esc5LegitSessionDir = join(projectsRoot, 'esc5project', '_esc5kind', esc5LegitSessionId);
  mkdirSync(esc5LegitSessionDir, { recursive: true });
  writeStatusJsonAt(join(esc5LegitSessionDir, 'status.json'), esc5LegitSessionId, 'esc5project', 'awaiting-verdict');

  // --- Escape 6: status.json is a HARDLINK (nlink===2) -----------------------
  const esc6OutsideDir = join(forgeRoot, '_outside-session-6');
  mkdirSync(esc6OutsideDir, { recursive: true });
  esc6OutsideStatusPath = join(esc6OutsideDir, 'fake-status.json');
  esc6PoisonSessionId = 'esc6-poison-session';
  writeStatusJsonAt(esc6OutsideStatusPath, esc6PoisonSessionId, 'esc6project', ESC6_SENTINEL_PHASE);
  const esc6PoisonSessionDir = join(projectsRoot, 'esc6project', '_esc6kind', esc6PoisonSessionId);
  mkdirSync(esc6PoisonSessionDir, { recursive: true }); // REAL session dir
  esc6PoisonStatusPath = join(esc6PoisonSessionDir, 'status.json');
  linkSync(esc6OutsideStatusPath, esc6PoisonStatusPath); // HARDLINK
  esc6LegitSessionId = 'esc6-legit-session';
  const esc6LegitSessionDir = join(projectsRoot, 'esc6project', '_esc6kind', esc6LegitSessionId);
  mkdirSync(esc6LegitSessionDir, { recursive: true });
  writeStatusJsonAt(join(esc6LegitSessionDir, 'status.json'), esc6LegitSessionId, 'esc6project', 'awaiting-verdict');

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Escape 1: standalone run dir is a DIRECTORY symlink
// ---------------------------------------------------------------------------

test('ESCAPE 1 (standalone dir symlink): a poisoned _agent-esc1-* directory symlink is suppressed; the legit esc1 run is still returned; the outside events.jsonl is never leaked or mutated', async () => {
  // Fixture-plants-what-it-claims (rule 5).
  const lst = lstatSync(join(logsRoot, esc1PoisonDirName));
  assert.ok(lst.isSymbolicLink(), 'fixture bug: esc1 poison entry must itself be a symlink');
  const outsideBefore = readFileSync(join(esc1OutsideDir, 'events.jsonl'));

  const { status, text, body } = await getJson('/api/agents/esc1/history');
  assert.equal(status, 200);
  const rows = (body as { rows: Row[] }).rows;

  // KILLS: plain `statSync(runDir).isDirectory()` (follows symlinks blindly)
  // + `readFileSync` with no realpath/identity check — the current
  // `collectStandaloneRows` implementation, which serves the outside dir's
  // events.jsonl as if it were the poisoned entry's own.
  assert.ok(!text.includes(String(ESC1_SENTINEL_COST)), `outside events.jsonl's sentinel cost must never appear — got: ${text}`);
  assert.equal(rows.length, 1, `expected exactly the one legit esc1 row (poisoned entry suppressed), got ${JSON.stringify(rows)}`);
  assert.equal(rows[0].id, esc1LegitDirName);
  assert.equal(rows[0].costUsd, 3.21);
  assert.ok(!rows.some((r) => r.id === esc1PoisonDirName), 'the poisoned directory-symlink entry must never produce its own row');

  const outsideAfter = readFileSync(join(esc1OutsideDir, 'events.jsonl'));
  assert.ok(outsideBefore.equals(outsideAfter), 'the outside events.jsonl must be byte-unchanged by a GET request');
});

// ---------------------------------------------------------------------------
// Escape 2: real run dir, events.jsonl is a FILE symlink
// ---------------------------------------------------------------------------

test('ESCAPE 2 (standalone events.jsonl file symlink): a poisoned events.jsonl symlink inside a REAL run dir is suppressed; the legit esc2 run is still returned; the outside file is never leaked or mutated', async () => {
  const lst = lstatSync(join(logsRoot, esc2PoisonDirName, 'events.jsonl'));
  assert.ok(lst.isSymbolicLink(), 'fixture bug: esc2 poison events.jsonl must itself be a symlink');
  assert.equal(readlinkSync(join(logsRoot, esc2PoisonDirName, 'events.jsonl')), esc2OutsideFile);
  const outsideBefore = readFileSync(esc2OutsideFile);

  const { status, text, body } = await getJson('/api/agents/esc2/history');
  assert.equal(status, 200);
  const rows = (body as { rows: Row[] }).rows;

  // KILLS: `parseEventsJsonl`'s plain `existsSync`/`readFileSync` on
  // `join(runDir, 'events.jsonl')` — the run DIRECTORY is genuinely real
  // (unlike escape 1), so a guard that only checks the directory misses this
  // entirely; only a check on the LEAF file itself catches it.
  assert.ok(!text.includes(String(ESC2_SENTINEL_COST)), `outside events.jsonl's sentinel cost must never appear — got: ${text}`);
  assert.equal(rows.length, 1, `expected exactly the one legit esc2 row (poisoned entry suppressed), got ${JSON.stringify(rows)}`);
  assert.equal(rows[0].id, esc2LegitDirName);
  assert.equal(rows[0].costUsd, 4.32);
  assert.ok(!rows.some((r) => r.id === esc2PoisonDirName), 'the poisoned file-symlink entry must never produce its own row');

  const outsideAfter = readFileSync(esc2OutsideFile);
  assert.ok(outsideBefore.equals(outsideAfter), 'the outside events.jsonl must be byte-unchanged by a GET request');
});

// ---------------------------------------------------------------------------
// Escape 3: events.jsonl is a HARDLINK (nlink===2)
// ---------------------------------------------------------------------------

test('ESCAPE 3 (standalone events.jsonl hardlink): a hardlinked events.jsonl (nlink===2) inside a REAL run dir is suppressed; the legit esc3 run is still returned; the outside file is never leaked or mutated', async () => {
  const leafPath = join(logsRoot, esc3PoisonDirName, 'events.jsonl');
  const lst = lstatSync(leafPath);
  assert.ok(!lst.isSymbolicLink(), 'a hardlink is NOT a symlink — this is the point: realpath alone cannot see it');
  assert.equal(lst.nlink, 2, `fixture bug: hardlinked events.jsonl must have nlink===2, got ${lst.nlink}`);
  const outsideBefore = readFileSync(esc3OutsideFile);

  const { status, text, body } = await getJson('/api/agents/esc3/history');
  assert.equal(status, 200);
  const rows = (body as { rows: Row[] }).rows;

  // KILLS: any fix that stops at realpath containment WITHOUT an `nlink`
  // check on the leaf — realpathSync is structurally blind to hardlinks (no
  // separate target to resolve away from), so a realpath-only "fix" still
  // reads straight through the shared inode.
  assert.ok(!text.includes(String(ESC3_SENTINEL_COST)), `outside events.jsonl's sentinel cost must never appear — got: ${text}`);
  assert.equal(rows.length, 1, `expected exactly the one legit esc3 row (poisoned entry suppressed), got ${JSON.stringify(rows)}`);
  assert.equal(rows[0].id, esc3LegitDirName);
  assert.equal(rows[0].costUsd, 5.43);
  assert.ok(!rows.some((r) => r.id === esc3PoisonDirName), 'the hardlinked entry must never produce its own row');

  const outsideAfter = readFileSync(esc3OutsideFile);
  assert.ok(outsideBefore.equals(outsideAfter), 'the outside events.jsonl must be byte-unchanged by a GET request');
});

// ---------------------------------------------------------------------------
// Escape 4 (P0): projects/<p>/_esc4kind is a DIRECTORY symlink
// ---------------------------------------------------------------------------

test('ESCAPE 4 P0 (session kind-dir symlink, realistic relative shape): the malicious project\'s symlinked _esc4kind never contributes its OWN row for the victim session — attribution stays exactly 1, never 2 — while a wholly unrelated legit project\'s session is unaffected', async () => {
  // Fixture-plants-what-it-claims (rule 5): a genuine, RELATIVE directory
  // symlink (never an absolute host path) — the git-plantable shape.
  const lst = lstatSync(esc4MaliciousKindPath);
  assert.ok(lst.isSymbolicLink(), 'fixture bug: malicious-project-esc4/_esc4kind must itself be a symlink');
  assert.equal(readlinkSync(esc4MaliciousKindPath), '../victim-project-esc4/_esc4kind', 'the symlink target must be RELATIVE and host-path-agnostic — the realistic git-committable shape');
  const victimStatusBefore = readFileSync(esc4VictimStatusPath);

  const { status, text, body } = await getJson('/api/agents/esc4agent/history');
  assert.equal(status, 200);
  const rows = (body as { rows: Row[] }).rows;

  // NOTE on oracle choice (why not a bare "sentinel absent" check): this
  // escape's realistic fixture requires `victim-project-esc4` to be a REAL,
  // independently-onboarded sibling project under the SAME `projects/` root
  // the symlink's relative target resolves into — `collectSessionRows`'s own
  // enumeration loop visits `victim-project-esc4` DIRECTLY and produces its
  // OWN legitimate row for this session regardless of the attack. The
  // sentinel phase is therefore LEGITIMATELY present in the response via
  // that real, unrelated path; "never appears" does not apply here. The
  // strictly equivalent, airtight proof is ATTRIBUTION COUNT: the exact same
  // session id must appear from victim-project-esc4's own real directory
  // exactly ONCE — never a second time contributed by malicious-project-esc4's
  // symlinked alias, and the sentinel substring must appear exactly as many
  // times as there are legitimate contributors (one), never two.
  //
  // KILLS: `resolveSafeSessionDir`'s CURRENT containment check specifically —
  // measured live before writing this test (see the file header's
  // "ADVERSARIAL FINDING" section) — which realpaths `<project>/_<kind>`
  // FIRST and only checks containment against that already-resolved
  // baseline, so when `_<kind>` itself is the symlink the baseline IS the
  // escaped location and the check is tautological. Also kills the raw
  // `existsSync`/`readdirSync`/`readSessionStatus` path this route calls
  // today, which has no containment check on the kind dir at all.
  const victimRows = rows.filter((r) => r.id === esc4VictimSessionId);
  assert.equal(victimRows.length, 1, `the victim session must be attributed exactly ONCE (its own real project), never twice (once more via the malicious symlink alias) — got ${JSON.stringify(rows)}`);
  const sentinelOccurrences = countOccurrences(text, ESC4_SENTINEL_PHASE);
  assert.equal(sentinelOccurrences, 1, `the sentinel phase must appear exactly once (the one legitimate contributor), got ${sentinelOccurrences} in: ${text}`);

  // Per-element isolation (rule 2): a THIRD project, never touched by the
  // malicious symlink at all, must still be found — proves this isn't a
  // collection-wide abort.
  assert.ok(rows.some((r) => r.id === esc4LegitSessionId && r.status === 'awaiting-verdict'), `expected the wholly unrelated legit-project-esc4 session to still be returned, got ${JSON.stringify(rows)}`);

  const victimStatusAfter = readFileSync(esc4VictimStatusPath);
  assert.ok(victimStatusBefore.equals(victimStatusAfter), 'the victim status.json must be byte-unchanged by a GET request');
});

// ---------------------------------------------------------------------------
// Escape 5: real session dir, status.json is a FILE symlink
// ---------------------------------------------------------------------------

test('ESCAPE 5 (session status.json file symlink): a poisoned status.json symlink inside a REAL session dir is suppressed; the legit sibling session in the SAME project is still returned; the outside file is never leaked or mutated', async () => {
  const lst = lstatSync(esc5PoisonStatusPath);
  assert.ok(lst.isSymbolicLink(), 'fixture bug: esc5 poison status.json must itself be a symlink');
  assert.equal(readlinkSync(esc5PoisonStatusPath), esc5OutsideStatusPath);
  const outsideBefore = readFileSync(esc5OutsideStatusPath);

  const { status, text, body } = await getJson('/api/agents/esc5agent/history');
  assert.equal(status, 200);
  const rows = (body as { rows: Row[] }).rows;

  // KILLS: `readSessionStatus` (orchestrator/interactive-session.ts) — a
  // plain existsSync/readFileSync with no realpath containment, the exact
  // function `bridge-studio-sessions.ts`'s own docstring calls out this
  // route for using ("never readSessionStatus") — this collector currently
  // calls it directly.
  assert.ok(!text.includes(ESC5_SENTINEL_PHASE), `outside status.json's sentinel phase must never appear — got: ${text}`);
  assert.equal(rows.length, 1, `expected exactly the one legit esc5 sibling session (poisoned entry suppressed), got ${JSON.stringify(rows)}`);
  assert.equal(rows[0].id, esc5LegitSessionId);
  assert.equal(rows[0].status, 'awaiting-verdict');
  assert.ok(!rows.some((r) => r.id === esc5PoisonSessionId), 'the poisoned session (file-symlinked status.json) must never produce its own row');

  const outsideAfter = readFileSync(esc5OutsideStatusPath);
  assert.ok(outsideBefore.equals(outsideAfter), 'the outside status.json must be byte-unchanged by a GET request');
});

// ---------------------------------------------------------------------------
// Escape 6: status.json is a HARDLINK (nlink===2)
// ---------------------------------------------------------------------------

test('ESCAPE 6 (session status.json hardlink): a hardlinked status.json (nlink===2) inside a REAL session dir is suppressed; the legit sibling session in the SAME project is still returned; the outside file is never leaked or mutated', async () => {
  const lst = lstatSync(esc6PoisonStatusPath);
  assert.ok(!lst.isSymbolicLink(), 'a hardlink is NOT a symlink — this is the point: realpath alone cannot see it');
  assert.equal(lst.nlink, 2, `fixture bug: hardlinked status.json must have nlink===2, got ${lst.nlink}`);
  const outsideBefore = readFileSync(esc6OutsideStatusPath);

  const { status, text, body } = await getJson('/api/agents/esc6agent/history');
  assert.equal(status, 200);
  const rows = (body as { rows: Row[] }).rows;

  // KILLS: any fix that only wires `resolveSafeSessionDir` +
  // `safeReadFileInSession` verbatim as they exist TODAY, with no additional
  // nlink check — `session-transcript.ts`'s own module docstring explicitly
  // documents the hardlink case as an ACCEPTED, not-fixed residual for
  // `safeReadFileInSession`. This test holds the history route to R6-06's
  // own bar (all six escapes closed), not that older module's accepted-risk
  // bar for a different route.
  assert.ok(!text.includes(ESC6_SENTINEL_PHASE), `outside status.json's sentinel phase must never appear — got: ${text}`);
  assert.equal(rows.length, 1, `expected exactly the one legit esc6 sibling session (poisoned entry suppressed), got ${JSON.stringify(rows)}`);
  assert.equal(rows[0].id, esc6LegitSessionId);
  assert.equal(rows[0].status, 'awaiting-verdict');
  assert.ok(!rows.some((r) => r.id === esc6PoisonSessionId), 'the hardlinked session entry must never produce its own row');

  const outsideAfter = readFileSync(esc6OutsideStatusPath);
  assert.ok(outsideBefore.equals(outsideAfter), 'the outside status.json must be byte-unchanged by a GET request');
});

// ---------------------------------------------------------------------------
// False-rejection pin (rule 4) — run LAST, after every poisoned fixture
// above already exists on disk in this SAME forgeRoot, proving the guard(s)
// that close the six escapes do not over-reject ordinary, wholly unrelated
// legitimate structures elsewhere in the same tree.
// ---------------------------------------------------------------------------

test('FALSE-REJECTION: an ordinary standalone run and an ordinary session (plain names, no symlinks/hardlinks anywhere) are still found, even after every escape fixture above exists in the same forgeRoot', async () => {
  const ordinaryDirName = seedRealStandaloneRun('_agent-ordinary-standalone-2026-07-01T00-00-00-000-plain', 'ordinary-standalone-agent', 0.99).split('/').pop()!;

  const ordinaryProjectDir = join(projectsRoot, 'ordinary-project-1');
  const ordinarySessionId = '2026-07-01T00-00-00-ordinary';
  const ordinarySessionDir = join(ordinaryProjectDir, '_ordinarykind', ordinarySessionId);
  mkdirSync(ordinarySessionDir, { recursive: true });
  writeStatusJsonAt(join(ordinarySessionDir, 'status.json'), ordinarySessionId, 'ordinary-project-1', 'awaiting-verdict');

  const standaloneResult = await getJson('/api/agents/ordinary-standalone-agent/history');
  assert.equal(standaloneResult.status, 200);
  const standaloneRows = (standaloneResult.body as { rows: Row[] }).rows;
  assert.equal(standaloneRows.length, 1, `an over-strict guard must not reject an ordinary standalone run, got ${JSON.stringify(standaloneRows)}`);
  assert.equal(standaloneRows[0].id, ordinaryDirName);
  assert.equal(standaloneRows[0].costUsd, 0.99);

  const sessionResult = await getJson('/api/agents/ordinaryagent/history');
  assert.equal(sessionResult.status, 200);
  const sessionRows = (sessionResult.body as { rows: Row[] }).rows;
  assert.equal(sessionRows.length, 1, `an over-strict guard must not reject an ordinary session, got ${JSON.stringify(sessionRows)}`);
  assert.equal(sessionRows[0].id, ordinarySessionId);
  assert.equal(sessionRows[0].status, 'awaiting-verdict');
});
