/**
 * Acceptance tests for cli/bridge-studio-authoring.ts (R4-21 phase 2, WI-2 —
 * `_wave5/unit-specs/R4-21-phase2.md`, D5: finalize route = the operator
 * commit act). REPLACES this file's previous (R4-21 phase 1) body wholesale:
 * phase 1's finalize contract (`{kind,id,entries,upstream}` with
 * client-supplied package bytes) is the thing D5 explicitly retires — "The
 * route stops sourcing package CONTENT from the client body." A rewrite, not
 * an amendment, mirrors this repo's own precedent for a superseded route
 * contract (`cli/bridge-studio-authoring.test.ts`'s OWN prior header:
 * "Do not stub the module into existence to turn this green; red is the
 * deliverable of this round" — the same discipline applies to a superseded
 * contract as to a not-yet-existing module).
 *
 * ---------------------------------------------------------------------------
 * THE NEW CONTRACT (D5, verbatim from the unit-spec) THIS FILE PINS
 * ---------------------------------------------------------------------------
 *
 *  POST /api/studio/authoring/finalize {project, sessionId, kind, id, upstream?, ...}
 *   (1) guarded-read the session status;
 *   (2) require phase === 'awaiting-review' -> 409 otherwise;
 *   (3) guarded-write package_id (= the request's `id`) + phase:'committing';
 *   (4) await runInteractiveTurn(descriptor, ctx) — the SAME spine
 *       `forge agent run` dispatches to (the committing step performs NO SDK
 *       spawn — a fast, deterministic in-process call) — this runs
 *       copyStagingToLibrary, landing the session's staging/ tree at
 *       <forgeRoot>/_interactive-library/<id>/ and advancing status to
 *       'committed';
 *   (5) read the landed _interactive-library/<id>/ through the guard and
 *       install: skill -> stageSkillPackage + installSkillPackage (DRAFT,
 *       never approved — D2 of the batch-D plan); hook -> the existing
 *       2-file hook.yaml + scripts/run.sh write;
 *   (6) { ok:true, kind, id }.
 *
 * ---------------------------------------------------------------------------
 * T3 DESIGN CALLS (the unit-spec leaves these open; stated explicitly here,
 * mirroring this repo's own "MY CALL" precedent — e.g.
 * orchestrator/interactive-runner.test.ts's file header — rather than
 * silently guessed):
 * ---------------------------------------------------------------------------
 *
 *   1. `ctx.forgeRoot` is what the finalize route resolves BOTH
 *      `studio/session-kinds.yaml` (to find the "authoring" descriptor for
 *      step 4's `runInteractiveTurn` call) AND `_interactive-library/`
 *      against — mirroring every other bridge route's existing convention of
 *      resolving studio config relative to `ctx.forgeRoot`
 *      (`cli/agent-run.ts`'s `findSessionKindDescriptor(agentId, forgeRoot)`
 *      takes the identical explicit-root shape). This file's `before()`
 *      therefore seeds `<forgeRoot>/studio/session-kinds.yaml` with the REAL,
 *      checked-in file content (byte-for-byte, read at test time) — the
 *      real production "authoring" row, not a hand-rolled duplicate that
 *      could drift from it.
 *   2. Hook finalize's body still carries the operator-supplied hook METADATA
 *      fields (`name, description, on, matcher?, permissions?`) — the
 *      unit-spec's own body shape literally lists "hook fields" alongside
 *      `project, sessionId, kind, id, upstream?`. Only the SCRIPT BYTES move
 *      server-side (read from the landed `_interactive-library/<id>/
 *      scripts/run.sh`, mirroring `staging/scripts/run.sh`'s own convention
 *      already pinned by session-transcript.test.ts's RED-2d). RED-4c-wire
 *      below proves this half of the contract directly: a body that (still)
 *      carries a `scriptBody` field (the phase-1 field name) is IGNORED —
 *      the installed script is the LANDED bytes, never the body's.
 *   3. The session dir for these tests is seeded DIRECTLY (status.json +
 *      staging/ written by the test, not by a real `analyzing` turn) — the
 *      finalize route's OWN job starts at `awaiting-review` regardless of
 *      how the session got there; this mirrors
 *      orchestrator/interactive-runner.test.ts's own committing-phase
 *      fixture idiom exactly.
 *
 * Style: real bridge (startBridge) + fetch, mirroring
 * cli/bridge-studio-skills.test.ts / cli/bridge-studio-hooks.test.ts's
 * tmp-forge-root harness exactly (same as this file's own prior body).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import yaml from 'js-yaml';

import { startBridge } from './ui-bridge.ts';
// Does not exist in the NEW shape yet — the current cli/bridge-studio-authoring.ts
// still implements the phase-1 {kind,id,entries,upstream} contract. Every
// test below is expected RED against it (see the T3 report for the captured
// failure per test).
import { handleStudioAuthoringRoutes } from './bridge-studio-authoring.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROJECT = 'demoproj';

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-studio-authoring-'));

  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'hooks'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects', PROJECT), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'studio', 'catalog.yaml'),
    ['sdks: []', 'models: []', 'tools: []', 'mcps: []', 'guards: []', 'community-skills: []', ''].join('\n'),
  );
  // Design call #1 (file header): the REAL, checked-in session-kinds.yaml —
  // byte-for-byte, not a hand-rolled duplicate of the "authoring" row.
  const realSessionKindsYaml = readFileSync(join(REPO_ROOT, 'studio', 'session-kinds.yaml'), 'utf8');
  writeFileSync(join(forgeRoot, 'studio', 'session-kinds.yaml'), realSessionKindsYaml);

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
}

/** RAW-request variant (rule 38: a normal client normalizes ".." away before
 *  it ever leaves the process) — sends the body as a literal, already-built
 *  JSON string so a percent-encoded sequence in a string VALUE travels over
 *  the wire completely unmolested by any client-side normalization, exactly
 *  as a hand-crafted attacker request would send it. */
async function postRaw(url: string, rawBody: string): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: rawBody,
  });
}

let sessionCounter = 0;
/** Seeds `<forgeRoot>/projects/<project>/_authoring/<sessionId>/status.json`
 *  (+ optional staging/ files) DIRECTLY — the finalize route's own job starts
 *  at whatever phase is seeded; see file header design call #3. Returns a
 *  fresh, never-reused sessionId so tests never collide. */
function seedAuthoringSession(opts: {
  project?: string;
  phase: string;
  packageId?: string;
  staging?: Record<string, string>;
}): { sessionId: string; sessionDir: string } {
  const project = opts.project ?? PROJECT;
  sessionCounter += 1;
  const sessionId = `2026-08-11T00-00-${String(sessionCounter).padStart(2, '0')}-fx`;
  const sessionDir = join(forgeRoot, 'projects', project, '_authoring', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    join(sessionDir, 'status.json'),
    JSON.stringify(
      { session_id: sessionId, phase: opts.phase, ...(opts.packageId ? { package_id: opts.packageId } : {}) },
      null,
      2,
    ),
  );
  for (const [relPath, body] of Object.entries(opts.staging ?? {})) {
    const abs = join(sessionDir, 'staging', relPath);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body, 'utf8');
  }
  return { sessionId, sessionDir };
}

function readStatusPhase(sessionDir: string): string {
  return (JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as { phase: string }).phase;
}

const FINALIZE_URL = () => `${bridgeUrl}/api/studio/authoring/finalize`;

// ===========================================================================
// D5 step 2 — the declared-stage fails-open kill-assertion: finalize at any
// phase OTHER than awaiting-review is a 409, never a silent 200.
// ===========================================================================

test('WI2-1: finalize at phase:"analyzing" -> 409, body naming the required phase; status.json and the filesystem are untouched', async () => {
  const { sessionId, sessionDir } = seedAuthoringSession({ phase: 'analyzing' });
  // Precondition, asserted before reading any verdict.
  assert.equal(readStatusPhase(sessionDir), 'analyzing', 'arrange: seeded status must start in analyzing');

  const res = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'skill', id: 'should-not-install' });
  assert.equal(res.status, 409, `expected 409, got ${res.status}`);
  const body = (await res.json()) as { error?: string };
  assert.ok(body.error && /awaiting-review/.test(body.error), `409 body must name the required phase ("awaiting-review"), got: ${JSON.stringify(body)}`);

  // Assert the ARTIFACT, not just the status code (rule: never a silent 200,
  // and never a silent partial write either).
  assert.equal(readStatusPhase(sessionDir), 'analyzing', 'a 409 must leave status.json phase untouched — no committing/committed side effect');
  assert.equal(existsSync(join(forgeRoot, 'skills', 'should-not-install')), false, 'a refused finalize must write nothing to skills/');
});

// ===========================================================================
// D5 happy path (skill) — installs the LANDED package (from staging/ via
// copyStagingToLibrary), as a DRAFT, palette-invisible until the SEPARATE
// approve route.
// ===========================================================================

test('WI2-2: finalize (skill) on a session at awaiting-review with staging/SKILL.md -> 200 {ok,kind:"skill",id}; skills/<id>/SKILL.md exists; listSkillLibrary shows draft+paletteVisible:false; the SEPARATE approve route flips paletteVisible true', async () => {
  const STAGED_CONTENT = matter.stringify('\n# Authored Skill\n\nBody.\n', { name: 'Authored Skill', description: 'authored via the creation-agent authoring session' });
  const { sessionId, sessionDir } = seedAuthoringSession({
    phase: 'awaiting-review',
    staging: { 'SKILL.md': STAGED_CONTENT, 'reference.md': 'Supporting reference content.\n' },
  });
  assert.equal(readStatusPhase(sessionDir), 'awaiting-review', 'arrange: seeded status must start in awaiting-review');

  const res = await postJson(FINALIZE_URL(), {
    project: PROJECT,
    sessionId,
    kind: 'skill',
    id: 'authored-skill',
    upstream: { source: 'forge://authoring-session/authored-skill' },
  });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { ok: boolean; kind: string; id: string };
  assert.equal(body.ok, true);
  assert.equal(body.kind, 'skill');
  assert.equal(body.id, 'authored-skill');

  // Step 4's artifact: the turn landed the package at _interactive-library/.
  const landedPath = join(forgeRoot, '_interactive-library', 'authored-skill', 'SKILL.md');
  assert.ok(existsSync(landedPath), `copyStagingToLibrary must have landed the package at ${landedPath}`);
  assert.equal(readStatusPhase(sessionDir), 'committed', 'status.json on disk must reflect the committing->committed advance');

  // Step 5's artifact: the SAME content installed into skills/<id>/.
  const installedMdPath = join(forgeRoot, 'skills', 'authored-skill', 'SKILL.md');
  assert.ok(existsSync(installedMdPath), 'skills/authored-skill/SKILL.md must exist on disk');
  assert.equal(readFileSync(installedMdPath, 'utf8'), STAGED_CONTENT, 'the installed bytes must be the STAGED bytes verbatim');
  assert.ok(existsSync(join(forgeRoot, 'skills', 'authored-skill', 'reference.md')), 'the second package file must land too — the WHOLE package installs');

  const installedData = matter(readFileSync(installedMdPath, 'utf8')).data as Record<string, unknown>;
  assert.equal(installedData['status'], 'draft', 'finalize lands as a DRAFT — installSkillPackage stamps status: draft');
  assert.equal(installedData['library'], false, 'finalize never auto-approves — library stays false until the SEPARATE /skills/:id/approve route runs');

  const listRes = await fetch(`${bridgeUrl}/api/studio/skills`);
  const listBody = (await listRes.json()) as { skills: Array<{ id: string; trust: string; paletteVisible: boolean }> };
  const entry = listBody.skills.find((s) => s.id === 'authored-skill');
  assert.ok(entry, 'the finalized skill must be listSkillLibrary-visible immediately');
  assert.equal(entry!.trust, 'draft');
  assert.equal(entry!.paletteVisible, false, 'a draft is never palette-visible — approval is a separate, later, operator-gated act (D6)');

  const approveRes = await fetch(`${bridgeUrl}/api/studio/skills/authored-skill/approve`, {
    method: 'POST',
    headers: { 'x-forge-csrf': '1' },
  });
  assert.equal(approveRes.status, 200, `expected the separate approve route to succeed, got ${approveRes.status}`);
  const listRes2 = await fetch(`${bridgeUrl}/api/studio/skills`);
  const listBody2 = (await listRes2.json()) as { skills: Array<{ id: string; paletteVisible: boolean }> };
  const entry2 = listBody2.skills.find((s) => s.id === 'authored-skill');
  assert.equal(entry2!.paletteVisible, true, 'the SEPARATE approve route (never finalize itself) is what flips paletteVisible to true');
});

// ===========================================================================
// D5 happy path (hook) — install writes the existing 2-file shape; unbound.
// ===========================================================================

test('WI2-3: finalize (hook) on a session at awaiting-review with staging/scripts/run.sh -> 200; hooks/<id>/hook.yaml + hooks/<id>/scripts/run.sh exist; GET /api/studio/hooks/<id> resolves with carriedBy:[] (unbound)', async () => {
  const STAGED_SCRIPT = '#!/usr/bin/env bash\necho "authored hook ran"\n';
  const { sessionId, sessionDir } = seedAuthoringSession({
    phase: 'awaiting-review',
    staging: { 'scripts/run.sh': STAGED_SCRIPT },
  });
  assert.equal(readStatusPhase(sessionDir), 'awaiting-review', 'arrange: seeded status must start in awaiting-review');

  const res = await postJson(FINALIZE_URL(), {
    project: PROJECT,
    sessionId,
    kind: 'hook',
    id: 'authored-hook',
    name: 'Authored Hook',
    description: 'authored via the creation-agent authoring session',
    on: 'PreToolUse',
  });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { ok: boolean; kind: string; id: string };
  assert.equal(body.ok, true);
  assert.equal(body.kind, 'hook');

  const yamlBody = readFileSync(join(forgeRoot, 'studio', 'hooks', body.id, 'hook.yaml'), 'utf8');
  const doc = yaml.load(yamlBody) as Record<string, unknown>;
  assert.equal(doc['on'], 'PreToolUse');
  assert.equal(doc['script'], 'scripts/run.sh', 'finalize must reuse the SAME fixed relative script path POST /api/studio/hooks always writes');
  const scriptOnDisk = readFileSync(join(forgeRoot, 'studio', 'hooks', body.id, 'scripts', 'run.sh'), 'utf8');
  assert.equal(scriptOnDisk, STAGED_SCRIPT, 'the installed script bytes must be the LANDED (staged) bytes verbatim');

  const detailRes = await fetch(`${bridgeUrl}/api/studio/hooks/${body.id}`);
  assert.equal(detailRes.status, 200, `GET /api/studio/hooks/${body.id} must resolve`);
  const detail = (await detailRes.json()) as { id: string; carriedBy: string[] };
  assert.equal(detail.id, body.id);
  assert.deepEqual(detail.carriedBy, [], 'a freshly finalized hook must be unbound — carried-by count is 0');
});

// ===========================================================================
// Wire contract (rule 38): the installed bytes are the bytes of
// _interactive-library/<id>/…, NEVER anything in the request body. Seeds a
// DIFFERENT, poisoned body-supplied payload and proves it is ignored.
// ===========================================================================

test('WI2-4-wire (skill): a body carrying a poisoned "entries" field (the phase-1 field name) is IGNORED — the installed SKILL.md is the STAGED content, not the body\'s', async () => {
  const STAGED_CONTENT = matter.stringify('\n# Real Staged Skill\n', { name: 'Real Staged Skill', description: 'd' });
  const { sessionId } = seedAuthoringSession({ phase: 'awaiting-review', staging: { 'SKILL.md': STAGED_CONTENT } });

  const poisonedBase64 = Buffer.from(matter.stringify('\nATTACKER-SUPPLIED-BODY-CONTENT\n', { name: 'Attacker', description: 'd' }), 'utf8').toString('base64');
  const res = await postJson(FINALIZE_URL(), {
    project: PROJECT,
    sessionId,
    kind: 'skill',
    id: 'wire-contract-skill',
    // A phase-1-shaped "entries" field — the new contract defines no such
    // body field; a naive implementation that never fully deleted the old
    // request-parsing code path could still read it.
    entries: [{ path: 'SKILL.md', contentBase64: poisonedBase64 }],
    upstream: { source: 'forge://authoring-session/wire-contract-skill' },
  });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);

  const installedMdPath = join(forgeRoot, 'skills', 'wire-contract-skill', 'SKILL.md');
  assert.ok(existsSync(installedMdPath), 'the skill must still install (from the REAL staged content)');
  const installed = readFileSync(installedMdPath, 'utf8');
  assert.equal(installed, STAGED_CONTENT, 'the installed content must be the STAGED bytes');
  assert.ok(!installed.includes('ATTACKER-SUPPLIED-BODY-CONTENT'), 'the body-supplied "entries" payload must never reach disk');
});

test('WI2-4-wire (hook): a body carrying a poisoned "scriptBody" field (the phase-1 field name) is IGNORED — the installed script is the LANDED (staged) bytes, not the body\'s', async () => {
  const STAGED_SCRIPT = '#!/usr/bin/env bash\necho "REAL staged script"\n';
  const { sessionId } = seedAuthoringSession({ phase: 'awaiting-review', staging: { 'scripts/run.sh': STAGED_SCRIPT } });

  const res = await postJson(FINALIZE_URL(), {
    project: PROJECT,
    sessionId,
    kind: 'hook',
    id: 'wire-contract-hook',
    name: 'wire-contract-hook',
    description: 'd',
    on: 'PreToolUse',
    // The phase-1 field name — the new contract sources script bytes
    // server-side; this must be ignored entirely.
    scriptBody: '#!/usr/bin/env bash\necho ATTACKER\n',
  });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { id: string };

  const scriptOnDisk = readFileSync(join(forgeRoot, 'studio', 'hooks', body.id, 'scripts', 'run.sh'), 'utf8');
  assert.equal(scriptOnDisk, STAGED_SCRIPT, 'the installed script must be the LANDED bytes');
  assert.ok(!scriptOnDisk.includes('ATTACKER'), 'the body-supplied "scriptBody" must never reach disk');
});

// ===========================================================================
// Containment — traversal-shaped sessionId (4 variants incl. a RAW-request
// percent-encoded one) is refused with NO filesystem write anywhere outside
// the session root. Assert the ARTIFACT (outside file byte-unchanged /
// absent), not just the status code.
// ===========================================================================

test('WI2-5-containment: traversal-shaped sessionId ("../../etc", "..", an absolute path, and a RAW-request percent-encoded "%2e%2e%2f") are all refused — nothing is written outside the session root', async () => {
  // A canary planted where a naive join(_authoring, sessionId, 'status.json')
  // traversal could plausibly land — one level above the _authoring parent,
  // inside the project dir.
  const canaryPath = join(forgeRoot, 'projects', PROJECT, 'CANARY.md');
  const CANARY_CONTENT = 'canary — must survive byte-unchanged\n';
  writeFileSync(canaryPath, CANARY_CONTENT, 'utf8');
  // Precondition, asserted before reading any verdict.
  assert.equal(readFileSync(canaryPath, 'utf8'), CANARY_CONTENT, 'arrange: canary must exist before any traversal attempt');

  const beforeEntries = readdirSync(forgeRoot, { recursive: true } as { recursive: true }).sort();

  // Every request below ALSO carries a fully valid, installable skill package
  // (entries + upstream) — deliberately, so a request that ignores sessionId
  // containment entirely would actually SUCCEED (200, a real install) rather
  // than coincidentally 400 on an unrelated "entries is required" check. This
  // is what makes the assertion below a genuine RED-now pin rather than a
  // pass-for-the-wrong-reason (rule: a test that would pass with the pre-fix
  // code swapped back in is not an acceptance test).
  const validSkillMd = matter.stringify('\n# x\n', { name: 'x', description: 'd' });
  const validPackageBody = (id: string) => ({
    entries: [{ path: 'SKILL.md', contentBase64: Buffer.from(validSkillMd, 'utf8').toString('base64') }],
    upstream: { source: `forge://authoring-session/${id}` },
  });

  const jsonVariants = ['../../etc', '..', '/etc/passwd-shaped-absolute-path'];
  for (const poisoned of jsonVariants) {
    const id = `traversal-${jsonVariants.indexOf(poisoned)}`;
    const res = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId: poisoned, kind: 'skill', id, ...validPackageBody(id) });
    assert.ok(res.status >= 400 && res.status < 500, `sessionId ${JSON.stringify(poisoned)} must be refused with a 4xx, got ${res.status}`);
    assert.equal(existsSync(join(forgeRoot, 'skills', id)), false, `a traversal-shaped sessionId must never result in an installed skill at skills/${id}`);
  }

  // RAW-request variant (rule 38): the literal text %2e%2e%2f as a JSON
  // string VALUE — never percent-decoded by a JSON body (no URL routing
  // layer touches it), so this specifically catches an implementation that
  // (incorrectly) decodes a request-derived string before validating it as a
  // path segment.
  const encodedId = 'traversal-encoded';
  const rawBody = JSON.stringify({ project: PROJECT, sessionId: '%2e%2e%2f', kind: 'skill', id: encodedId, ...validPackageBody(encodedId) });
  const rawRes = await postRaw(FINALIZE_URL(), rawBody);
  assert.ok(rawRes.status >= 400 && rawRes.status < 500, `the RAW percent-encoded sessionId must be refused with a 4xx, got ${rawRes.status}`);
  assert.equal(existsSync(join(forgeRoot, 'skills', encodedId)), false, 'a RAW percent-encoded traversal sessionId must never result in an installed skill');

  // Assert the ARTIFACT: the canary is byte-unchanged, and no new file
  // anywhere under forgeRoot was created by any of the 4 attempts.
  assert.equal(readFileSync(canaryPath, 'utf8'), CANARY_CONTENT, 'the canary must be byte-unchanged after every traversal attempt');
  const afterEntries = readdirSync(forgeRoot, { recursive: true } as { recursive: true }).sort();
  assert.deepEqual(afterEntries, beforeEntries, 'no traversal attempt may create any new file or directory anywhere under forgeRoot');
});

// ===========================================================================
// Containment — a project that resolves outside the projects root is
// refused (mirrors cli/ui-bridge-onboarding-start.test.ts's AT-9 idiom).
// ===========================================================================

test('WI2-6-containment: a "project" whose dir is a symlink escaping the projects root is refused — nothing is written through it', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'bridge-authoring-finalize-project-outside-'));
  const outsideEntriesBefore = readdirSync(outsideDir).sort();
  const escapeProject = 'escape-finalize-project';
  const linkPath = join(forgeRoot, 'projects', escapeProject);
  try {
    symlinkSync(outsideDir, linkPath, 'dir');
  } catch {
    rmSync(outsideDir, { recursive: true, force: true });
    return; // symlinks unsupported on this filesystem/platform — skip
  }
  try {
    // Carries a fully valid, installable skill package (see WI2-5's identical
    // rationale) so a request that ignores project containment entirely would
    // actually SUCCEED rather than coincidentally 400 on an unrelated check.
    const validSkillMd = matter.stringify('\n# x\n', { name: 'x', description: 'd' });
    const res = await postJson(FINALIZE_URL(), {
      project: escapeProject,
      sessionId: '2026-08-11T00-00-99-fx',
      kind: 'skill',
      id: 'escape-project-skill',
      entries: [{ path: 'SKILL.md', contentBase64: Buffer.from(validSkillMd, 'utf8').toString('base64') }],
      upstream: { source: 'forge://authoring-session/escape-project-skill' },
    });
    assert.ok(res.status >= 400, `a project resolving outside the projects root must be refused, got ${res.status}`);
    const outsideEntriesAfter = readdirSync(outsideDir).sort();
    assert.deepEqual(outsideEntriesAfter, outsideEntriesBefore, 'nothing may be created inside the out-of-tree directory the symlinked project points at');
    assert.equal(existsSync(join(forgeRoot, 'skills', 'escape-project-skill')), false, 'nothing may be installed to skills/ from a request whose project escapes the projects root');
  } finally {
    rmSync(linkPath, { force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

// ===========================================================================
// Handler contract — direct invocation (unchanged passthrough contract,
// mirrors bridge-studio-skills.test.ts's / bridge-studio.test.ts's idiom).
// ===========================================================================

test('handleStudioAuthoringRoutes returns false for a non-matching URL (passthrough contract)', async () => {
  const mockRes = {
    writeHead: () => { throw new Error('must not write a response for a non-matching URL'); },
    end: () => { throw new Error('must not end a response for a non-matching URL'); },
  } as unknown as import('node:http').ServerResponse;
  const mockReq = {} as import('node:http').IncomingMessage;
  const ctx = { forgeRoot, logsRoot: join(forgeRoot, '_logs') };

  const handled = await handleStudioAuthoringRoutes(mockReq, mockRes, ctx, '/api/studio/nonexistent', 'GET');
  assert.equal(handled, false, 'a non-matching studio-authoring URL must return false');
});
