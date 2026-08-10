/**
 * Acceptance tests for cli/bridge-studio-authoring.ts (R4-21 phase 2, WI-2,
 * AMENDMENT ROUND 2 — `_wave5/unit-specs/R4-21-phase2.md`, D5: finalize route
 * = the operator commit act). This is a T3 amendment-round-2 REWRITE, not an
 * incremental patch: round 1's own body (commit `4a8b6257`) pinned a request
 * body that still carried hook METADATA fields (`name, description, on,
 * matcher?, permissions?`) and a client-supplied `upstream` — round 1's file
 * header called that its own explicit "design call #2", stated openly rather
 * than silently guessed. Amendment-round-2 SUPERSEDES that call: the correct
 * wire contract is narrower.
 *
 * ---------------------------------------------------------------------------
 * THE CORRECTED CONTRACT (round 2) THIS FILE PINS
 * ---------------------------------------------------------------------------
 *
 *  POST /api/studio/authoring/finalize { project, sessionId, kind, id } —
 *  NOTHING ELSE. Any other body field is DEAD DATA: the server never reads
 *  it, and the installed artifact is provably unaffected by it (RED-4-wire
 *  below).
 *
 *   (1) guarded-read the session status;
 *   (2) require phase === 'awaiting-review' -> 409 otherwise;
 *   (3) guarded-write package_id (= the request's `id`) + phase:'committing';
 *   (4) await runInteractiveTurn(descriptor, ctx) — runs copyStagingToLibrary,
 *       landing the session's staging/ tree VERBATIM at
 *       <forgeRoot>/_interactive-library/<id>/ and advancing status to
 *       'committed'. This step is GENERIC — it does not understand skill vs.
 *       hook shape at all (interactive-finalizers.ts's own "scope discipline"
 *       header: "does not validate frontmatter, enforce skill/hook-specific
 *       semantics"). A hook-specific defect (forbidden binding key, bad `on`,
 *       malformed hook.yaml) is therefore NOT caught here — the landed copy
 *       always succeeds if the staged tree itself is containment-clean; the
 *       defect surfaces one step later, at (5).
 *   (5) read the landed _interactive-library/<id>/ through the guard and
 *       install:
 *         - skill -> stageSkillPackage + installSkillPackage (DRAFT, never
 *           approved — D2 of the batch-D plan). `upstream` is SERVER-MINTED —
 *           never read from the request body — because the provenance of an
 *           authored package IS the session that authored it: `{ source:
 *           'forge-authoring', ref: sessionId }`. A client-supplied
 *           `upstream` would be unverifiable (it asserts its own origin).
 *         - hook -> hook METADATA (`name, description, on, matcher?,
 *           permissions?`) is read from the DRAFTED hook.yaml at
 *           `_interactive-library/<id>/hook.yaml` — parsed server-side —
 *           NEVER from parallel request-body fields. Rationale: the operator
 *           reviews the drafted hook.yaml in the session's file-package
 *           artifact pane (the ACTUAL thing that will ship); if the installed
 *           hook's `on`/`matcher`/`permissions` came from separate form
 *           fields instead, the reviewed artifact would not be what ships —
 *           a live divergence between declared data and installed data, the
 *           exact declared-data-fails-open shape this codebase's own
 *           standing rule guards against. The existing 2-file write contract
 *           (`hooks/<id>/hook.yaml` + `hooks/<id>/scripts/run.sh`, script
 *           always at the fixed relative path `scripts/run.sh`) and D-6's
 *           FORBIDDEN_HOOK_BINDING_KEYS / HOOK_LIFECYCLE_EVENTS checks now
 *           run against the LANDED hook.yaml's own fields, not the body's.
 *   (6) { ok:true, kind, id }.
 *
 * ---------------------------------------------------------------------------
 * T3 DESIGN CALLS THIS AMENDMENT MAKES (stated explicitly, matching this
 * repo's own "MY CALL" precedent):
 * ---------------------------------------------------------------------------
 *
 *   1. `ctx.forgeRoot` resolution — UNCHANGED from round 1's call #1: the
 *      REAL, checked-in `studio/session-kinds.yaml` is copied byte-for-byte
 *      into the fixture forgeRoot at `before()` time.
 *   2. A hook-specific validation failure at step (5) does NOT roll back
 *      step (4)'s already-successful generic copy — nothing in D5 describes
 *      a rollback, and interactive-finalizers.ts's own header disclaims any
 *      hook-shape awareness at that layer. The negative hook tests below
 *      therefore assert the ARTIFACT that step (5) alone owns
 *      (`hooks/<id>/` absent) rather than guessing whether status.json's
 *      phase gets reverted — an unspecified, implementation-owned detail.
 *   3. The session dir for these tests is seeded DIRECTLY (status.json +
 *      staging/ written by the test) — UNCHANGED from round 1's call #3.
 *   4. Server-minted upstream shape — pinned EXACTLY as the T3 brief states:
 *      `{ source: 'forge-authoring', ref: <sessionId> }`. Read back through
 *      `orchestrator/studio/skill-library.ts`'s own `extractProvenance`
 *      shape (`provenance.source` / `provenance.upstreamRef`) — the actual
 *      thing `installSkillPackage` persists (verified by reading that
 *      module's source, not guessed).
 *
 * Style: real bridge (startBridge) + fetch, mirroring
 * cli/bridge-studio-skills.test.ts / cli/bridge-studio-hooks.test.ts's
 * tmp-forge-root harness exactly (unchanged from round 1).
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
// still implements the phase-1 {kind,id,entries,upstream} contract (round 1
// already proved this RED; this amendment additionally proves the NARROWER
// {project,sessionId,kind,id}-only contract RED for a DIFFERENT reason on the
// happy paths — see the T3 report for the exact captured failure per test).
import { handleStudioAuthoringRoutes } from './bridge-studio-authoring.ts';
import { FORBIDDEN_HOOK_BINDING_KEYS, HOOK_LIFECYCLE_EVENTS } from '../orchestrator/studio/hook-library.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROJECT = 'demoproj';

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-studio-authoring-amend2-'));

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
  // Design call #1: the REAL, checked-in session-kinds.yaml — byte-for-byte,
  // not a hand-rolled duplicate of the "authoring" row.
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
 *  (+ optional staging/ files) DIRECTLY at an arbitrary location — the
 *  finalize route's own job starts at whatever phase is seeded; see file
 *  header design call #3. Returns a fresh, never-reused sessionId so tests
 *  never collide. */
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
  writeSeededSession(sessionDir, opts);
  return { sessionId, sessionDir };
}

/** Writes a session's status.json + staging/ files at an EXPLICIT directory —
 *  factored out of `seedAuthoringSession` so the containment tests below can
 *  plant an identical, genuinely-valid session at a NAIVE-JOIN escape target
 *  (proving a bypassed guard would actually succeed, not merely "no error"). */
function writeSeededSession(
  sessionDir: string,
  opts: { phase: string; packageId?: string; staging?: Record<string, string> },
): void {
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    join(sessionDir, 'status.json'),
    JSON.stringify(
      { session_id: 'seed', phase: opts.phase, ...(opts.packageId ? { package_id: opts.packageId } : {}) },
      null,
      2,
    ),
  );
  for (const [relPath, body] of Object.entries(opts.staging ?? {})) {
    const abs = join(sessionDir, 'staging', relPath);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body, 'utf8');
  }
}

function readStatusPhase(sessionDir: string): string {
  return (JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as { phase: string }).phase;
}

const FINALIZE_URL = () => `${bridgeUrl}/api/studio/authoring/finalize`;

function hookYamlDraft(fields: Record<string, unknown>): string {
  return yaml.dump(fields);
}

// ===========================================================================
// D5 step 2 — the declared-stage fails-open kill-assertion: finalize at any
// phase OTHER than awaiting-review is a 409, never a silent 200.
// ===========================================================================

test('WI2-1: finalize at phase:"analyzing" -> 409, body naming the required phase; status.json and the filesystem are untouched', async () => {
  const { sessionId, sessionDir } = seedAuthoringSession({ phase: 'analyzing' });
  assert.equal(readStatusPhase(sessionDir), 'analyzing', 'arrange: seeded status must start in analyzing');

  const res = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'skill', id: 'should-not-install' });
  assert.equal(res.status, 409, `expected 409, got ${res.status}`);
  const body = (await res.json()) as { error?: string };
  assert.ok(body.error && /awaiting-review/.test(body.error), `409 body must name the required phase ("awaiting-review"), got: ${JSON.stringify(body)}`);

  assert.equal(readStatusPhase(sessionDir), 'analyzing', 'a 409 must leave status.json phase untouched — no committing/committed side effect');
  assert.equal(existsSync(join(forgeRoot, 'skills', 'should-not-install')), false, 'a refused finalize must write nothing to skills/');
});

// ===========================================================================
// D5 happy path (skill) — installs the LANDED package (from staging/ via
// copyStagingToLibrary), as a DRAFT, palette-invisible; upstream is
// SERVER-MINTED, never read from the (now-nonexistent) body field.
// ===========================================================================

test('WI2-2: finalize (skill) body is EXACTLY {project,sessionId,kind,id} -> 200; skills/<id>/SKILL.md exists with the STAGED bytes; provenance is SERVER-MINTED {source:"forge-authoring",ref:sessionId}; draft+paletteVisible:false; the SEPARATE approve route flips paletteVisible true', async () => {
  const STAGED_CONTENT = matter.stringify('\n# Authored Skill\n\nBody.\n', { name: 'Authored Skill', description: 'authored via the creation-agent authoring session' });
  const { sessionId, sessionDir } = seedAuthoringSession({
    phase: 'awaiting-review',
    staging: { 'SKILL.md': STAGED_CONTENT, 'reference.md': 'Supporting reference content.\n' },
  });
  assert.equal(readStatusPhase(sessionDir), 'awaiting-review', 'arrange: seeded status must start in awaiting-review');

  // The body is EXACTLY the 4 fields the corrected contract admits — no
  // upstream, no entries.
  const res = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'skill', id: 'authored-skill' });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { ok: boolean; kind: string; id: string };
  assert.equal(body.ok, true);
  assert.equal(body.kind, 'skill');
  assert.equal(body.id, 'authored-skill');

  const landedPath = join(forgeRoot, '_interactive-library', 'authored-skill', 'SKILL.md');
  assert.ok(existsSync(landedPath), `copyStagingToLibrary must have landed the package at ${landedPath}`);
  assert.equal(readStatusPhase(sessionDir), 'committed', 'status.json on disk must reflect the committing->committed advance');

  const installedMdPath = join(forgeRoot, 'skills', 'authored-skill', 'SKILL.md');
  assert.ok(existsSync(installedMdPath), 'skills/authored-skill/SKILL.md must exist on disk');
  assert.ok(existsSync(join(forgeRoot, 'skills', 'authored-skill', 'reference.md')), 'the second package file must land too — the WHOLE package installs');

  const installedData = matter(readFileSync(installedMdPath, 'utf8')).data as Record<string, unknown>;
  assert.equal(installedData['status'], 'draft', 'finalize lands as a DRAFT — installSkillPackage stamps status: draft');
  assert.equal(installedData['library'], false, 'finalize never auto-approves — library stays false until the SEPARATE /skills/:id/approve route runs');

  // SERVER-MINTED upstream — the wire contract carries no upstream field at
  // all; the provenance below can therefore ONLY have come from the server.
  const provenance = installedData['provenance'] as Record<string, unknown> | undefined;
  assert.ok(provenance, 'installed SKILL.md must carry a provenance block');
  assert.equal(provenance!['source'], 'forge-authoring', 'provenance.source must be the server-minted "forge-authoring" — the finalize body carries no upstream field to have supplied any other value');
  assert.equal(provenance!['upstreamRef'], sessionId, 'provenance.upstreamRef must be the SESSION that authored the package — the provenance of an authored package IS the session, not an operator-suppliable value');

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
// D5 happy path (hook) — hook METADATA comes from the DRAFTED hook.yaml, not
// the (now-nonexistent) body fields.
// ===========================================================================

test('WI2-3: finalize (hook) body is EXACTLY {project,sessionId,kind,id} -> 200; hooks/<id>/hook.yaml carries the DRAFTED name/description/on/matcher/permissions + script:"scripts/run.sh"; hooks/<id>/scripts/run.sh carries the drafted script bytes; unbound', async () => {
  const STAGED_SCRIPT = '#!/usr/bin/env bash\necho "authored hook ran"\n';
  const draftedYaml = hookYamlDraft({
    name: 'Authored Hook',
    description: 'authored via the creation-agent authoring session',
    on: 'PreToolUse',
    matcher: 'Bash',
    script: 'scripts/run.sh',
    permissions: { env: ['FORGE_ROOT'], read: ['/tmp'], network: false },
  });
  const { sessionId, sessionDir } = seedAuthoringSession({
    phase: 'awaiting-review',
    staging: { 'hook.yaml': draftedYaml, 'scripts/run.sh': STAGED_SCRIPT },
  });
  assert.equal(readStatusPhase(sessionDir), 'awaiting-review', 'arrange: seeded status must start in awaiting-review');

  // The body carries NO hook metadata at all — everything must come from the
  // drafted hook.yaml the operator actually reviewed.
  const res = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'hook', id: 'authored-hook' });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { ok: boolean; kind: string; id: string };
  assert.equal(body.ok, true);
  assert.equal(body.kind, 'hook');
  assert.equal(body.id, 'authored-hook');

  const yamlBody = readFileSync(join(forgeRoot, 'studio', 'hooks', body.id, 'hook.yaml'), 'utf8');
  const doc = yaml.load(yamlBody) as Record<string, unknown>;
  assert.equal(doc['name'], 'Authored Hook', 'installed name must be the DRAFTED value');
  assert.equal(doc['description'], 'authored via the creation-agent authoring session', 'installed description must be the DRAFTED value');
  assert.equal(doc['on'], 'PreToolUse', 'installed "on" must be the DRAFTED value');
  assert.equal(doc['matcher'], 'Bash', 'installed matcher must be the DRAFTED value');
  assert.equal(doc['script'], 'scripts/run.sh', 'finalize must reuse the SAME fixed relative script path POST /api/studio/hooks always writes');
  assert.deepEqual(doc['permissions'], { env: ['FORGE_ROOT'], read: ['/tmp'], network: false }, 'installed permissions must be the DRAFTED values');

  const scriptOnDisk = readFileSync(join(forgeRoot, 'studio', 'hooks', body.id, 'scripts', 'run.sh'), 'utf8');
  assert.equal(scriptOnDisk, STAGED_SCRIPT, 'the installed script bytes must be the LANDED (staged) bytes verbatim');

  const detailRes = await fetch(`${bridgeUrl}/api/studio/hooks/${body.id}`);
  assert.equal(detailRes.status, 200, `GET /api/studio/hooks/${body.id} must resolve`);
  const detail = (await detailRes.json()) as { id: string; carriedBy: string[] };
  assert.equal(detail.id, body.id);
  assert.deepEqual(detail.carriedBy, [], 'a freshly finalized hook must be unbound — carried-by count is 0');
});

// ===========================================================================
// D5 hook negative paths — validated against the DRAFTED hook.yaml, before
// any hooks/<id> write. All three assert the ARTIFACT (dir absence), not
// just the status code.
// ===========================================================================

test('WI2-3b: a drafted hook.yaml declaring a FORBIDDEN_HOOK_BINDING_KEYS key -> 400 naming the offending key; nothing written under hooks/<id>', async () => {
  // Precondition: prove the fixture premise (the forbidden-key list is real
  // and non-empty) before relying on it.
  assert.ok(FORBIDDEN_HOOK_BINDING_KEYS.includes('agent'), 'arrange: "agent" must be a real forbidden binding key');

  const draftedYaml = hookYamlDraft({
    name: 'Binding Hook',
    description: 'declares a forbidden binding key',
    on: 'PreToolUse',
    script: 'scripts/run.sh',
    agent: 'some-agent-slug', // FORBIDDEN — a definition must never name its own binding
  });
  const { sessionId } = seedAuthoringSession({
    phase: 'awaiting-review',
    staging: { 'hook.yaml': draftedYaml, 'scripts/run.sh': '#!/usr/bin/env bash\necho x\n' },
  });

  const res = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'hook', id: 'binding-hook' });
  const text = await res.text();
  assert.equal(res.status, 400, `expected 400, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { error?: string };
  assert.ok(body.error && /agent/.test(body.error), `400 body must name the offending key "agent", got: ${JSON.stringify(body)}`);

  assert.equal(existsSync(join(forgeRoot, 'studio', 'hooks', 'binding-hook')), false, 'a forbidden-binding-key hook.yaml must result in NOTHING written under hooks/<id>');
});

test('WI2-3c: a drafted hook.yaml whose "on" is outside HOOK_LIFECYCLE_EVENTS -> 400 naming the value and the allowed set; nothing written under hooks/<id>', async () => {
  const draftedYaml = hookYamlDraft({
    name: 'Bad Event Hook',
    description: 'declares an unknown lifecycle event',
    on: 'BogusLifecycleEvent',
    script: 'scripts/run.sh',
  });
  const { sessionId } = seedAuthoringSession({
    phase: 'awaiting-review',
    staging: { 'hook.yaml': draftedYaml, 'scripts/run.sh': '#!/usr/bin/env bash\necho x\n' },
  });

  const res = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'hook', id: 'bad-event-hook' });
  const text = await res.text();
  assert.equal(res.status, 400, `expected 400, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { error?: string };
  assert.ok(body.error && /BogusLifecycleEvent/.test(body.error), `400 body must name the offending value, got: ${JSON.stringify(body)}`);
  for (const ev of HOOK_LIFECYCLE_EVENTS) {
    assert.ok(body.error!.includes(ev), `400 body must name the allowed set (missing "${ev}"), got: ${JSON.stringify(body)}`);
  }

  assert.equal(existsSync(join(forgeRoot, 'studio', 'hooks', 'bad-event-hook')), false, 'an invalid "on" hook.yaml must result in NOTHING written under hooks/<id>');
});

const MALFORMED_HOOK_DRAFTS: { label: string; staging: Record<string, string> }[] = [
  {
    label: 'missing hook.yaml entirely',
    staging: { 'scripts/run.sh': '#!/usr/bin/env bash\necho x\n' },
  },
  {
    label: 'unparseable YAML',
    staging: { 'hook.yaml': 'name: [unterminated\n  - broken\n', 'scripts/run.sh': '#!/usr/bin/env bash\necho x\n' },
  },
  {
    label: 'a YAML scalar, not a mapping',
    staging: { 'hook.yaml': 'just-a-bare-scalar-string\n', 'scripts/run.sh': '#!/usr/bin/env bash\necho x\n' },
  },
];

for (const { label, staging } of MALFORMED_HOOK_DRAFTS) {
  test(`WI2-3d: a drafted hook.yaml that is ${label} -> 400, nothing written under hooks/<id> (fail loud, never a fabricated default)`, async () => {
    const { sessionId } = seedAuthoringSession({ phase: 'awaiting-review', staging });
    const id = `malformed-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;

    const res = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'hook', id });
    const text = await res.text();
    assert.equal(res.status, 400, `expected 400 for "${label}", got ${res.status}: ${text}`);

    assert.equal(existsSync(join(forgeRoot, 'studio', 'hooks', id)), false, `"${label}" must result in NOTHING written under hooks/<id>`);
  });
}

// ===========================================================================
// Wire contract (rule 38): the installed artifact is the LANDED package,
// NEVER anything the request body carries. Poisons EVERY field the corrected
// contract removed (entries, upstream, name, description, on, matcher,
// scriptBody, permissions) with contradicting values and proves each is
// ignored.
// ===========================================================================

test('WI2-4-wire (skill): a body carrying poisoned entries/upstream (removed fields) is IGNORED — the installed SKILL.md + provenance are the STAGED/server-minted values, not the body\'s', async () => {
  const STAGED_CONTENT = matter.stringify('\n# Real Staged Skill\n', { name: 'Real Staged Skill', description: 'd' });
  const { sessionId } = seedAuthoringSession({ phase: 'awaiting-review', staging: { 'SKILL.md': STAGED_CONTENT } });

  const poisonedBase64 = Buffer.from(matter.stringify('\nATTACKER-SUPPLIED-BODY-CONTENT\n', { name: 'Attacker', description: 'd' }), 'utf8').toString('base64');
  const res = await postJson(FINALIZE_URL(), {
    project: PROJECT,
    sessionId,
    kind: 'skill',
    id: 'wire-contract-skill',
    entries: [{ path: 'SKILL.md', contentBase64: poisonedBase64 }],
    upstream: { source: 'ATTACKER-CLAIMED-SOURCE', ref: 'attacker-ref' },
    name: 'ATTACKER', description: 'ATTACKER', on: 'PreToolUse', matcher: 'ATTACKER', scriptBody: 'ATTACKER',
  });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);

  const installedMdPath = join(forgeRoot, 'skills', 'wire-contract-skill', 'SKILL.md');
  assert.ok(existsSync(installedMdPath), 'the skill must still install (from the REAL staged content)');
  const installed = matter(readFileSync(installedMdPath, 'utf8'));
  assert.ok(!readFileSync(installedMdPath, 'utf8').includes('ATTACKER-SUPPLIED-BODY-CONTENT'), 'the body-supplied "entries" payload must never reach disk');
  assert.equal((installed.data as Record<string, unknown>)['provenance'] && ((installed.data as Record<string, unknown>)['provenance'] as Record<string, unknown>)['source'], 'forge-authoring', 'the body-supplied poisoned "upstream" must never override the server-minted provenance.source');
});

test('WI2-4-wire (hook): a body carrying poisoned name/description/on/matcher/scriptBody/permissions/upstream (removed fields) is IGNORED — the installed hook.yaml + script are the DRAFTED values, not the body\'s', async () => {
  const STAGED_SCRIPT = '#!/usr/bin/env bash\necho "REAL staged script"\n';
  const draftedYaml = hookYamlDraft({
    name: 'Real Drafted Hook',
    description: 'the real drafted description',
    on: 'PreToolUse',
    script: 'scripts/run.sh',
  });
  const { sessionId } = seedAuthoringSession({
    phase: 'awaiting-review',
    staging: { 'hook.yaml': draftedYaml, 'scripts/run.sh': STAGED_SCRIPT },
  });

  const res = await postJson(FINALIZE_URL(), {
    project: PROJECT,
    sessionId,
    kind: 'hook',
    id: 'wire-contract-hook',
    name: 'ATTACKER', description: 'ATTACKER', on: 'PostToolUse', matcher: 'ATTACKER',
    scriptBody: '#!/usr/bin/env bash\necho ATTACKER\n',
    permissions: { env: ['ATTACKER'], read: ['/'], network: true },
    upstream: { source: 'ATTACKER-CLAIMED-SOURCE' },
  });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { id: string };

  const yamlBody = readFileSync(join(forgeRoot, 'studio', 'hooks', body.id, 'hook.yaml'), 'utf8');
  const doc = yaml.load(yamlBody) as Record<string, unknown>;
  assert.equal(doc['name'], 'Real Drafted Hook', 'installed name must be the DRAFTED value, never the body\'s');
  assert.equal(doc['on'], 'PreToolUse', 'installed "on" must be the DRAFTED value, never the body\'s');
  assert.equal(doc['matcher'], undefined, 'installed matcher must be the DRAFTED value (absent), never the body\'s poisoned value');

  const scriptOnDisk = readFileSync(join(forgeRoot, 'studio', 'hooks', body.id, 'scripts', 'run.sh'), 'utf8');
  assert.equal(scriptOnDisk, STAGED_SCRIPT, 'the installed script must be the LANDED bytes');
  assert.ok(!scriptOnDisk.includes('ATTACKER'), 'the body-supplied "scriptBody" must never reach disk');
});

// ===========================================================================
// Containment — traversal-shaped sessionId. Two variants are backed by a
// REAL, genuinely-installable session planted at the exact location a NAIVE
// (unguarded) `join(_authoring, sessionId, ...)` would resolve to — proving
// this is a genuine RED-if-unfixed pin (rule: a test that would pass with an
// unguarded implementation swapped in is not an acceptance test), not merely
// "returns some 4xx". Two further variants (an absolute-path-shaped segment,
// and a RAW-request percent-encoded segment) are pure segment-shape
// rejections — inherently caught before any join is attempted — asserted by
// artifact absence alone.
// ===========================================================================

test('WI2-5-containment: traversal-shaped sessionId is refused — nothing is written outside the session root, even where a naive unguarded join would land on a REAL valid session', async () => {
  const validSkillMd = matter.stringify('\n# escaped\n', { name: 'escaped', description: 'd' });

  // Variant 1: sessionId "../evil-sibling" — a naive join(authoringRoot,
  // '../evil-sibling', 'status.json') cancels the _authoring segment and
  // lands at <projectRoot>/evil-sibling/status.json. Plant a REAL, valid,
  // awaiting-review session there.
  const projectRoot = join(forgeRoot, 'projects', PROJECT);
  const evilSiblingDir = join(projectRoot, 'evil-sibling');
  writeSeededSession(evilSiblingDir, { phase: 'awaiting-review', staging: { 'SKILL.md': validSkillMd } });
  assert.equal(readStatusPhase(evilSiblingDir), 'awaiting-review', 'arrange: the naive-join-1 target must be a genuinely valid session');

  // Variant 2: sessionId ".." alone — a naive join(authoringRoot, '..',
  // 'status.json') cancels the _authoring segment and lands directly at
  // <projectRoot>/status.json. Plant a REAL, valid, awaiting-review session
  // directly in projectRoot (alongside its existing _authoring/ subdir).
  writeSeededSession(projectRoot, { phase: 'awaiting-review', staging: { 'SKILL.md': validSkillMd } });
  assert.equal(readStatusPhase(projectRoot), 'awaiting-review', 'arrange: the naive-join-2 target must be a genuinely valid session');

  const beforeEntries = readdirSync(forgeRoot, { recursive: true } as { recursive: true }).sort();

  const genuineVariants = ['../evil-sibling', '..'];
  for (const poisoned of genuineVariants) {
    const id = `traversal-genuine-${genuineVariants.indexOf(poisoned)}`;
    const res = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId: poisoned, kind: 'skill', id });
    assert.ok(res.status >= 400 && res.status < 500, `sessionId ${JSON.stringify(poisoned)} must be refused with a 4xx, got ${res.status}`);
    assert.equal(existsSync(join(forgeRoot, 'skills', id)), false, `a traversal-shaped sessionId must never result in an installed skill at skills/${id}`);
  }

  // Variant 3: an absolute-path-shaped segment — caught by segment-shape
  // validation (contains "/"), never even attempts a join.
  const absId = 'traversal-absolute';
  const absRes = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId: '/etc/passwd-shaped-absolute-path', kind: 'skill', id: absId });
  assert.ok(absRes.status >= 400 && absRes.status < 500, `an absolute-shaped sessionId must be refused with a 4xx, got ${absRes.status}`);
  assert.equal(existsSync(join(forgeRoot, 'skills', absId)), false, 'an absolute-shaped sessionId must never result in an installed skill');

  // Variant 4: RAW-request percent-encoded sessionId (rule 38) — the literal
  // text "%2e%2e%2f" as a JSON string VALUE, never percent-decoded by a JSON
  // body. Catches an implementation that (incorrectly) decodes a
  // request-derived string before validating it as a path segment.
  const encId = 'traversal-encoded';
  const rawBody = JSON.stringify({ project: PROJECT, sessionId: '%2e%2e%2f', kind: 'skill', id: encId });
  const rawRes = await postRaw(FINALIZE_URL(), rawBody);
  assert.ok(rawRes.status >= 400 && rawRes.status < 500, `the RAW percent-encoded sessionId must be refused with a 4xx, got ${rawRes.status}`);
  assert.equal(existsSync(join(forgeRoot, 'skills', encId)), false, 'a RAW percent-encoded traversal sessionId must never result in an installed skill');

  // Assert the ARTIFACT: nothing new appeared anywhere under forgeRoot beyond
  // this test's own two legitimate plants (both already reflected in
  // beforeEntries, captured after planting them) — proving all 4 attempts
  // were fully refused, not partially processed.
  const afterEntries = readdirSync(forgeRoot, { recursive: true } as { recursive: true }).sort();
  assert.deepEqual(afterEntries, beforeEntries, 'no traversal attempt may create any new file or directory anywhere under forgeRoot');
  // And the two genuinely-valid plants must be byte-unchanged (never mutated
  // into "committed" by a bypassed guard).
  assert.equal(readStatusPhase(evilSiblingDir), 'awaiting-review', 'the naive-join-1 target must be untouched — a bypassed guard would have advanced it to "committed"');
  assert.equal(readStatusPhase(projectRoot), 'awaiting-review', 'the naive-join-2 target must be untouched — a bypassed guard would have advanced it to "committed"');
});

// ===========================================================================
// Containment — a project that resolves outside the projects root is
// refused, even when a REAL, genuinely-installable session sits at the exact
// location the symlink points at (proving genuine RED-if-unfixed).
// ===========================================================================

test('WI2-6-containment: a "project" whose dir is a symlink escaping the projects root is refused — nothing is written through it, even though a REAL valid session sits at the escape target', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'bridge-authoring-finalize-project-outside-'));
  const escapeProject = 'escape-finalize-project';
  const linkPath = join(forgeRoot, 'projects', escapeProject);
  try {
    symlinkSync(outsideDir, linkPath, 'dir');
  } catch {
    rmSync(outsideDir, { recursive: true, force: true });
    return; // symlinks unsupported on this filesystem/platform — skip
  }
  try {
    const validSkillMd = matter.stringify('\n# x\n', { name: 'x', description: 'd' });
    const sessionId = '2026-08-11T00-00-99-fx';
    const sessionDir = join(outsideDir, '_authoring', sessionId);
    writeSeededSession(sessionDir, { phase: 'awaiting-review', staging: { 'SKILL.md': validSkillMd } });
    assert.equal(readStatusPhase(sessionDir), 'awaiting-review', 'arrange: the escape target must hold a genuinely valid session');

    const outsideEntriesBefore = readdirSync(outsideDir, { recursive: true } as { recursive: true }).sort();

    const res = await postJson(FINALIZE_URL(), {
      project: escapeProject,
      sessionId,
      kind: 'skill',
      id: 'escape-project-skill',
    });
    assert.ok(res.status >= 400, `a project resolving outside the projects root must be refused, got ${res.status}`);

    const outsideEntriesAfter = readdirSync(outsideDir, { recursive: true } as { recursive: true }).sort();
    assert.deepEqual(outsideEntriesAfter, outsideEntriesBefore, 'nothing may be created or mutated inside the out-of-tree directory the symlinked project points at');
    assert.equal(readStatusPhase(sessionDir), 'awaiting-review', 'the escape-target session must be untouched — a bypassed guard would have advanced it to "committed"');
    assert.equal(existsSync(join(forgeRoot, 'skills', 'escape-project-skill')), false, 'nothing may be installed to skills/ from a request whose project escapes the projects root');
  } finally {
    rmSync(linkPath, { force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

// ===========================================================================
// Handler contract — direct invocation (unchanged passthrough contract).
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
