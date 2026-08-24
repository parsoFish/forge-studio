/**
 * W7-B4 review finding 2 — RESTORED SUITE. This file is the R4-21 finalize
 * acceptance suite, recovered verbatim from `d85f462c^`. W7-B4's own
 * library-authoring tests were written OVER cli/bridge-studio-authoring.test.ts
 * rather than beside it, deleting every pin below: for one wave,
 * `git grep 'authoring/finalize' -- '*.test.ts'` matched NOTHING while the
 * live POST /api/studio/authoring/finalize route still shipped. The route was
 * never changed — all 22 tests pass unmodified against the current code, which
 * is exactly why the loss was invisible. The W7-B4 tests keep the original
 * filename; this suite gets its own, so neither can silently replace the other.
 *
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
import { listTemplateLibrary } from '../orchestrator/studio/template-library.ts';
import { SCAFFOLD_READONLY } from './bridge-studio-templates.ts';

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
  // W8-B4/WI-3 — kind:'template' finalize writes into these two single-file
  // categories (project-scaffold is a whole directory tree, never a
  // finalize target — see the WI3 tests below).
  mkdirSync(join(forgeRoot, 'studio', 'artifact-templates'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'demo-elements'), { recursive: true });
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

/** P7 — a recursive listing of `root`, EXCLUDING `_logs/` (every attempted
 *  `runInteractiveTurn` call, success or failure, legitimately writes its
 *  own operational `events.jsonl` — a benign side effect unrelated to the
 *  containment property these tests pin). Used to assert "nothing else was
 *  created" without false-failing on that expected logging noise. */
function entriesExcludingLogs(root: string): string[] {
  return (readdirSync(root, { recursive: true } as { recursive: true }) as string[])
    .filter((p) => p !== '_logs' && !p.startsWith('_logs/'))
    .sort();
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
// WI3-0 (W8-B4/WI-3) — kind ENUMERATION pin. handleStudioAuthoringRoutes's
// own gate (`kind !== 'skill' && kind !== 'hook' && kind !== 'template'`)
// must refuse anything outside that closed set — pinned here so a future
// replacement of the gate with something permissive (e.g. accepting any
// non-empty string) is caught by THIS suite. 'connection' names the ONE
// object kind forge deliberately keeps NON-authorable
// (cli/connections-no-authoring.test.ts) — this is the enforcement for the
// authoring finalize route specifically; 'flow' is a second, unrelated
// non-package object kind, proving the gate is a closed enum, not a
// one-off "not connection" special case.
// ===========================================================================

for (const badKind of ['connection', 'flow']) {
  test(`WI3-0: finalize with kind:'${badKind}' (outside the closed skill|hook|template set) -> 400 at the route boundary; the session never even reaches the committing turn`, async () => {
    const { sessionId, sessionDir } = seedAuthoringSession({
      phase: 'awaiting-review',
      staging: { 'SKILL.md': matter.stringify('\n# x\n', { name: 'x', description: 'd' }) },
    });

    const res = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: badKind, id: `should-not-install-${badKind}` });
    const text = await res.text();
    assert.equal(res.status, 400, `expected 400 for kind:'${badKind}', got ${res.status}: ${text}`);
    const body = JSON.parse(text) as { error?: string };
    assert.ok(body.error && /skill/.test(body.error) && /hook/.test(body.error) && /template/.test(body.error), `400 body must name the allowed set (skill/hook/template), got: ${JSON.stringify(body)}`);

    assert.equal(readStatusPhase(sessionDir), 'awaiting-review', `kind:'${badKind}' must be refused before the committing turn ever runs — status.json must be untouched`);
    assert.equal(existsSync(join(forgeRoot, 'skills', `should-not-install-${badKind}`)), false, `kind:'${badKind}' must install nothing under skills/`);
    assert.equal(existsSync(join(forgeRoot, 'studio', 'hooks', `should-not-install-${badKind}`)), false, `kind:'${badKind}' must install nothing under studio/hooks/`);
    assert.equal(existsSync(join(forgeRoot, 'studio', 'artifact-templates', `should-not-install-${badKind}.md`)), false, `kind:'${badKind}' must install nothing under studio/artifact-templates/`);
  });
}

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

  // library-37 fix (W8-B4/WI-3, superseding this assertion's ORIGINAL form):
  // _interactive-library/<id>/ is an internal staging->landing BRIDGE, not a
  // durable record — a `finally` in runFinalize removes it after EVERY
  // attempt, success included, so the id is never permanently unusable via a
  // leftover ghost. The real, durable signal that copyStagingToLibrary ran is
  // the INSTALLED package below (skills/authored-skill/SKILL.md), not the
  // now-cleaned-up intermediate copy.
  const landedPath = join(forgeRoot, '_interactive-library', 'authored-skill', 'SKILL.md');
  assert.equal(existsSync(landedPath), false, `library-37: the landed intermediate copy at ${landedPath} must be cleaned up after a successful finalize, not left behind`);
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

// ===========================================================================
// W8-B6 — trigger coherence on the FOURTH write path into studio/hooks/.
//
// A matcher on a tool-less lifecycle event can never be honoured by hook
// dispatch (`orchestrator/studio/hook-dispatch.ts`'s `hookMatcherMatches`
// needs a `tool_name`), so the hook would be finalized, listed, bindable —
// and silently never fire. `lintHookDefinitions`, POST /api/studio/hooks and
// PUT /api/studio/hooks/:id all refuse it; this route is the fourth, and it
// matters MORE than the other three, because these bytes were authored by a
// creation AGENT rather than typed into a form with a PreToolUse default.
// Gating three of four is the one-of-N shape this wave keeps paying for.
// ===========================================================================

test('W8-B6: a drafted hook.yaml with a matcher on a tool-less event -> 400 naming the event and the tool-scoped set; nothing written under hooks/<id>', async () => {
  const draftedYaml = hookYamlDraft({
    name: 'Incoherent Trigger Hook',
    description: 'a matcher on SessionEnd can never be honoured by dispatch',
    on: 'SessionEnd',
    matcher: 'Bash(gh pr create)',
    script: 'scripts/run.sh',
    permissions: { env: [], read: [], network: false },
  });
  const { sessionId } = seedAuthoringSession({
    phase: 'awaiting-review',
    staging: { 'hook.yaml': draftedYaml, 'scripts/run.sh': '#!/usr/bin/env bash\necho x\n' },
  });

  const res = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'hook', id: 'incoherent-trigger-hook' });
  const text = await res.text();
  assert.equal(res.status, 400, `expected 400, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { error?: string };
  assert.ok(body.error && /SessionEnd/.test(body.error), `400 must name the offending event, got: ${JSON.stringify(body)}`);
  assert.ok(body.error!.includes('PreToolUse'), `400 must name the tool-scoped set, got: ${JSON.stringify(body)}`);

  // Assert the ARTIFACT, not the status code.
  assert.equal(
    existsSync(join(forgeRoot, 'studio', 'hooks', 'incoherent-trigger-hook')),
    false,
    'an incoherent trigger must leave NOTHING under hooks/<id>',
  );
});

test('W8-B6: the SAME matcher on a tool-scoped event finalizes normally — the rule refuses the incoherent pair, never the matcher', async () => {
  const draftedYaml = hookYamlDraft({
    name: 'Coherent Trigger Hook',
    description: 'a matcher on PreToolUse is exactly what dispatch can honour',
    on: 'PreToolUse',
    matcher: 'Bash(gh pr create)',
    script: 'scripts/run.sh',
    permissions: { env: [], read: [], network: false },
  });
  const { sessionId } = seedAuthoringSession({
    phase: 'awaiting-review',
    staging: { 'hook.yaml': draftedYaml, 'scripts/run.sh': '#!/usr/bin/env bash\necho x\n' },
  });

  const res = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'hook', id: 'coherent-trigger-hook' });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  assert.equal(
    existsSync(join(forgeRoot, 'studio', 'hooks', 'coherent-trigger-hook', 'hook.yaml')),
    true,
    'a coherent trigger must still install — this pins that the new gate is not over-broad',
  );
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
// WI3 (W8-B4/WI-3) — kind:'template'. Mirrors the hook arm's posture: template
// METADATA (here, the draft-only `category` routing field) is read from the
// LANDED, DRAFTED `template.md`, parsed server-side, never from body fields.
// A template is ONE markdown file with gray-matter frontmatter (D1,
// orchestrator/studio/template-library.ts; forge-ui/app/templates/new/page.tsx's
// own seedContent precedent) staged at the ONE canonical name `template.md`.
// ===========================================================================

function templateDraft(fields: Record<string, unknown>, body = '\nDescribe the artifact this template defines.\n'): string {
  return matter.stringify(body, fields);
}

test("WI3-1: finalize (template, category:'planning') body is EXACTLY {project,sessionId,kind,id} -> 200; studio/artifact-templates/<id>.md exists with the DRAFTED body and NO stray 'category' field; listTemplateLibrary lists it", async () => {
  const draft = templateDraft({ category: 'planning', id: 'authored-template', name: 'Authored Template', kind: 'file' });
  const { sessionId, sessionDir } = seedAuthoringSession({ phase: 'awaiting-review', staging: { 'template.md': draft } });
  assert.equal(readStatusPhase(sessionDir), 'awaiting-review', 'arrange: seeded status must start in awaiting-review');

  const res = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'template', id: 'authored-template' });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { ok: boolean; kind: string; id: string };
  assert.equal(body.ok, true);
  assert.equal(body.kind, 'template');
  assert.equal(body.id, 'authored-template');

  const installedPath = join(forgeRoot, 'studio', 'artifact-templates', 'authored-template.md');
  assert.ok(existsSync(installedPath), `studio/artifact-templates/authored-template.md must exist on disk`);
  const installed = matter(readFileSync(installedPath, 'utf8'));
  assert.equal((installed.data as Record<string, unknown>)['id'], 'authored-template');
  assert.equal((installed.data as Record<string, unknown>)['kind'], 'file', 'the real ArtifactTemplate kind field must survive verbatim');
  assert.equal((installed.data as Record<string, unknown>)['category'], undefined, "a real installed template.md must NOT carry the draft-only 'category' routing field");

  // Assert the ARTIFACT via listTemplateLibrary itself, not just the write.
  const entries = listTemplateLibrary(forgeRoot);
  const entry = entries.find((e) => e.id === 'authored-template');
  assert.ok(entry, 'the finalized template must be listTemplateLibrary-visible immediately');
  assert.equal(entry!.category, 'planning');
  assert.equal(entry!.error, undefined, 'a well-formed finalized template must list with no parse error');

  assert.equal(readStatusPhase(sessionDir), 'committed', 'status.json on disk must reflect the committing->committed advance');
});

test("WI3-2: finalize (template, category:'demo-output') installs into studio/demo-elements/<id>.md and listTemplateLibrary lists it under that category", async () => {
  const draft = templateDraft({ category: 'demo-output', id: 'authored-demo-el', name: 'Authored Demo Element', phase: 'present', description: 'captures the thing' });
  const { sessionId } = seedAuthoringSession({ phase: 'awaiting-review', staging: { 'template.md': draft } });

  const res = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'template', id: 'authored-demo-el' });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);

  assert.ok(existsSync(join(forgeRoot, 'studio', 'demo-elements', 'authored-demo-el.md')), 'studio/demo-elements/authored-demo-el.md must exist on disk');
  const entry = listTemplateLibrary(forgeRoot).find((e) => e.id === 'authored-demo-el');
  assert.ok(entry, 'the finalized demo-output template must be listTemplateLibrary-visible immediately');
  assert.equal(entry!.category, 'demo-output');
});

test("WI3-3: a drafted template.md declaring category:'project-scaffold' -> 400 (SCAFFOLD_READONLY, the SAME constant/rule POST /api/studio/templates uses); nothing installed; a REAL pre-existing scaffold tree at that id is byte-unchanged; the session recovers to awaiting-review", async () => {
  // A REAL scaffold tree at the SAME id — proves the refusal happens before
  // any write ever reaches studio/starters/, not merely that some OTHER
  // write path no-ops.
  const scaffoldReadme = join(forgeRoot, 'studio', 'starters', 'projects', 'authored-scaffold', 'README.md');
  mkdirSync(join(scaffoldReadme, '..'), { recursive: true });
  writeFileSync(scaffoldReadme, 'pre-existing scaffold — must not change\n', 'utf8');
  const scaffoldBefore = readFileSync(scaffoldReadme, 'utf8');

  const draft = templateDraft({ category: 'project-scaffold', id: 'authored-scaffold', name: 'Authored Scaffold' });
  const { sessionId, sessionDir } = seedAuthoringSession({ phase: 'awaiting-review', staging: { 'template.md': draft } });

  const res = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'template', id: 'authored-scaffold' });
  const text = await res.text();
  assert.equal(res.status, 400, `expected 400, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { error?: string };
  assert.equal(body.error, SCAFFOLD_READONLY, "the 400 body must be the SAME SCAFFOLD_READONLY constant POST /api/studio/templates returns — never a second, drifting copy of the rule");

  assert.equal(existsSync(join(forgeRoot, 'studio', 'artifact-templates', 'authored-scaffold.md')), false, 'nothing must be written to studio/artifact-templates/');
  assert.equal(existsSync(join(forgeRoot, 'studio', 'demo-elements', 'authored-scaffold.md')), false, 'nothing must be written to studio/demo-elements/');
  assert.equal(readFileSync(scaffoldReadme, 'utf8'), scaffoldBefore, 'the pre-existing scaffold tree must be BYTE-UNCHANGED — project-scaffold is refused before any write is attempted');
  assert.equal(readStatusPhase(sessionDir), 'awaiting-review', 'a refused project-scaffold finalize must leave the session recoverable');
});

const MALFORMED_TEMPLATE_DRAFTS: { label: string; staging: Record<string, string> }[] = [
  {
    // A non-empty staging/ (mirrors MALFORMED_HOOK_DRAFTS's own "missing
    // hook.yaml entirely" case) so copyStagingToLibrary's generic step 5
    // still lands something and reaches step 6 — an EMPTY staging/ would
    // instead fail earlier, at the SAME generic "staging dir missing"
    // refusal P5-2 already pins, never reaching this arm's own check at all.
    label: 'missing template.md entirely',
    staging: { 'README.md': 'not a template — the draft never wrote template.md\n' },
  },
  {
    label: 'unparseable YAML frontmatter',
    staging: { 'template.md': '---\ncategory: [unterminated\n  - broken\n---\nBody.\n' },
  },
  {
    label: 'a category outside the real TemplateCategory union',
    staging: { 'template.md': templateDraft({ category: 'bogus-category', id: 'x', name: 'x', kind: 'file' }) },
  },
  {
    label: 'well-formed category but content missing the required "kind" field (refused by the REAL category loader)',
    staging: { 'template.md': templateDraft({ category: 'planning', id: 'x', name: 'x' }) },
  },
];

for (const { label, staging } of MALFORMED_TEMPLATE_DRAFTS) {
  test(`WI3-4: a drafted template.md that is ${label} -> 400, nothing written under studio/artifact-templates or studio/demo-elements (fail loud, never a fabricated default)`, async () => {
    const { sessionId } = seedAuthoringSession({ phase: 'awaiting-review', staging });
    const id = `malformed-tpl-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`.slice(0, 60).replace(/-+$/, '');

    const res = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'template', id });
    const text = await res.text();
    assert.equal(res.status, 400, `expected 400 for "${label}", got ${res.status}: ${text}`);

    assert.equal(existsSync(join(forgeRoot, 'studio', 'artifact-templates', `${id}.md`)), false, `"${label}" must result in NOTHING written under studio/artifact-templates/`);
    assert.equal(existsSync(join(forgeRoot, 'studio', 'demo-elements', `${id}.md`)), false, `"${label}" must result in NOTHING written under studio/demo-elements/`);
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
// P5 (T3 pin round 5, BLOCKER — state corruption) — `runFinalize` guarded-
// writes `phase:'committing'` BEFORE running the turn, and NOTHING today
// reverts it on a downstream failure. Live-reproduced: an invalid `id` (an
// ordinary operator typo — SLUG_RE requires a leading lowercase letter, so a
// leading capital or digit bricks the session) or a session whose staging/
// dir is missing (the drafting turn crashed) both 500 and leave the session
// stuck at "committing" FOREVER — every subsequent retry, even with a VALID
// id, then 409s ("required phase is awaiting-review"). There is no route and
// no UI affordance to recover; only hand-editing status.json unbricks it.
//
// The corrected contract: on ANY failure after the phase was advanced to
// "committing", status.json must be returned to "awaiting-review" so the
// operator can retry, and a subsequent finalize with a VALID id (or, for the
// missing-staging case, once real staging/ content exists) must actually
// SUCCEED — not just report a recoverable-looking phase. P5-3 is the control:
// a session that reaches "committed" via a REAL success must stay committed
// — the revert must never fire on the success path.
// ===========================================================================

test('P5-1 (recoverability, invalid id): finalize with an operator-typo id that fails SLUG_RE downstream (leading capital, not a crafted attack string) -> 500; the session recovers to "awaiting-review" (never bricked at "committing" forever); nothing installed; a RETRY with a valid id then SUCCEEDS', async () => {
  const STAGED_CONTENT = matter.stringify('\n# P5 Skill\n', { name: 'P5 Skill', description: 'd' });
  const { sessionId, sessionDir } = seedAuthoringSession({
    phase: 'awaiting-review',
    staging: { 'SKILL.md': STAGED_CONTENT },
  });
  assert.equal(readStatusPhase(sessionDir), 'awaiting-review', 'arrange: seeded status must start in awaiting-review');

  const badRes = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'skill', id: 'TypoSkill' });
  assert.equal(badRes.status, 500, `expected 500 for a SLUG_RE-invalid id, got ${badRes.status}`);

  assert.equal(
    readStatusPhase(sessionDir),
    'awaiting-review',
    'BLOCKER: a failed finalize must leave the session RECOVERABLE at "awaiting-review", never bricked at "committing" forever',
  );
  assert.equal(existsSync(join(forgeRoot, '_interactive-library', 'TypoSkill')), false, 'nothing must be landed for the failed id');
  assert.equal(existsSync(join(forgeRoot, 'skills', 'TypoSkill')), false, 'nothing must be installed for the failed id');

  // The corrected contract: a SUBSEQUENT finalize with a VALID id must
  // SUCCEED — proving the session genuinely recovered, not merely that its
  // phase field superficially reads "awaiting-review".
  const goodRes = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'skill', id: 'typo-fixed-skill' });
  const goodText = await goodRes.text();
  assert.equal(goodRes.status, 200, `expected the retry with a valid id to succeed, got ${goodRes.status}: ${goodText}`);
  assert.ok(existsSync(join(forgeRoot, 'skills', 'typo-fixed-skill', 'SKILL.md')), 'the retry must actually install the package');
});

test('P5-2 (recoverability, missing staging/): finalize on a session whose staging/ dir is missing (the drafting turn crashed before writing anything) -> 500; the session recovers to "awaiting-review"; nothing installed; after real staging content is added, a RETRY SUCCEEDS', async () => {
  const { sessionId, sessionDir } = seedAuthoringSession({ phase: 'awaiting-review' }); // no `staging` option -> staging/ genuinely does not exist
  assert.equal(existsSync(join(sessionDir, 'staging')), false, 'arrange: the fixture premise is that staging/ genuinely does not exist');
  assert.equal(readStatusPhase(sessionDir), 'awaiting-review', 'arrange: seeded status must start in awaiting-review');

  const badRes = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'skill', id: 'missing-staging-skill' });
  assert.equal(badRes.status, 500, `expected 500 for a missing staging/ dir, got ${badRes.status}`);

  assert.equal(
    readStatusPhase(sessionDir),
    'awaiting-review',
    'BLOCKER: a failed finalize must leave the session RECOVERABLE at "awaiting-review", never bricked at "committing" forever',
  );
  assert.equal(existsSync(join(forgeRoot, 'skills', 'missing-staging-skill')), false, 'nothing must be installed for the failed attempt');

  // Add REAL staging content directly (mirrors the operator re-running the
  // drafting turn), then retry finalize.
  const STAGED_CONTENT = matter.stringify('\n# Recovered Skill\n', { name: 'Recovered Skill', description: 'd' });
  mkdirSync(join(sessionDir, 'staging'), { recursive: true });
  writeFileSync(join(sessionDir, 'staging', 'SKILL.md'), STAGED_CONTENT, 'utf8');

  const goodRes = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'skill', id: 'missing-staging-skill' });
  const goodText = await goodRes.text();
  assert.equal(goodRes.status, 200, `expected the retry to succeed once staging/ exists, got ${goodRes.status}: ${goodText}`);
  assert.ok(existsSync(join(forgeRoot, 'skills', 'missing-staging-skill', 'SKILL.md')), 'the retry must actually install the package');
});

test('P5-3 (control — the revert must NOT fire on SUCCESS): a committed session STAYS committed; re-finalizing after a real success still 409s, never a silent revert to awaiting-review', async () => {
  const STAGED_CONTENT = matter.stringify('\n# Stays Committed\n', { name: 'Stays Committed', description: 'd' });
  const { sessionId, sessionDir } = seedAuthoringSession({ phase: 'awaiting-review', staging: { 'SKILL.md': STAGED_CONTENT } });

  const okRes = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'skill', id: 'p5-3-committed-skill' });
  assert.equal(okRes.status, 200, `arrange: the initial finalize must succeed, got ${okRes.status}`);
  assert.equal(readStatusPhase(sessionDir), 'committed', 'arrange: a successful finalize must leave phase "committed"');

  const reRes = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'skill', id: 'p5-3-committed-skill-again' });
  const reText = await reRes.text();
  assert.equal(reRes.status, 409, `a re-finalize of an already-committed session must still 409, got ${reRes.status}: ${reText}`);
  const reBody = JSON.parse(reText) as { error?: string };
  assert.ok(reBody.error && /awaiting-review/.test(reBody.error), `409 body must still name "awaiting-review" as required, got: ${JSON.stringify(reBody)}`);

  assert.equal(
    readStatusPhase(sessionDir),
    'committed',
    'a committed session must NEVER be silently reverted to awaiting-review by a later failed re-finalize attempt',
  );
});

// ===========================================================================
// P6 (T3 pin round 5, declared-data / silent-discard) — `installSkillPackage`
// is idempotent BY DESIGN: if `skills/<id>/SKILL.md` already exists it
// returns `{alreadyInstalled:true}` and writes NOTHING. `finalizeSkillFromLanded`
// discards that return value today and unconditionally sends `200
// {ok:true}` — the operator's authored draft is silently thrown away, the
// pre-existing skill stays byte-unchanged, the session closes as
// "committed" with no retry path, and NOTHING anywhere signals a problem.
// Both sibling callers of installSkillPackage (bridge-studio-skills.ts,
// bridge-studio-community.ts) DO surface `alreadyInstalled`; this route is
// the lone swallower.
//
// The hook path's own duplicate check (`yamlGuard.exists` -> 409) is ALREADY
// correct on the status-code axis — P6-2 pins that it must ALSO (composed
// with P5) leave the session recoverable, which nothing does today.
// ===========================================================================

test('P6-1 (skill id collision must not silently succeed): finalizing with an id that already exists in skills/ -> NON-2xx (409) naming the collision; the pre-existing skills/<id>/SKILL.md is byte-unchanged; composed with P5 the session recovers to awaiting-review so a retry under a DIFFERENT id SUCCEEDS', async () => {
  const collidingId = 'pre-existing-skill';
  const PRE_EXISTING_CONTENT = matter.stringify('\n# Pre-existing, must not change\n', { name: 'Pre-existing', description: 'must not change' });
  mkdirSync(join(forgeRoot, 'skills', collidingId), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', collidingId, 'SKILL.md'), PRE_EXISTING_CONTENT, 'utf8');

  const DRAFT_CONTENT = matter.stringify('\n# Authored draft, must be discarded\n', { name: 'Authored draft', description: 'must never silently overwrite the pre-existing skill' });
  const { sessionId, sessionDir } = seedAuthoringSession({ phase: 'awaiting-review', staging: { 'SKILL.md': DRAFT_CONTENT } });

  const res = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'skill', id: collidingId });
  const text = await res.text();
  assert.notEqual(res.status, 200, `a collision with an existing skill must NEVER report success, got ${res.status}: ${text}`);
  assert.equal(res.status, 409, `expected 409 naming the collision, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { error?: string };
  assert.ok(body.error && body.error.includes(collidingId), `409 body must name the colliding id "${collidingId}", got: ${JSON.stringify(body)}`);

  const afterContent = readFileSync(join(forgeRoot, 'skills', collidingId, 'SKILL.md'), 'utf8');
  assert.equal(afterContent, PRE_EXISTING_CONTENT, 'the pre-existing skill must be BYTE-UNCHANGED — silent discard is the defect being pinned here');

  assert.equal(
    readStatusPhase(sessionDir),
    'awaiting-review',
    'composed with P5: a collision failure must also leave the session recoverable at awaiting-review',
  );

  const retryId = 'not-colliding-skill';
  const retryRes = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'skill', id: retryId });
  const retryText = await retryRes.text();
  assert.equal(retryRes.status, 200, `the retry under a DIFFERENT id must succeed, got ${retryRes.status}: ${retryText}`);
  assert.ok(existsSync(join(forgeRoot, 'skills', retryId, 'SKILL.md')), 'the retry must actually install under the new id');
});

test('P6-2 (hook id collision — the EXISTING 409 must also leave the session recoverable): finalizing with an id that already exists in studio/hooks/ -> 409 (already correct today); the pre-existing hook.yaml/run.sh are byte-unchanged; composed with P5 the session recovers to awaiting-review so a retry under a DIFFERENT id SUCCEEDS', async () => {
  const collidingId = 'pre-existing-hook';
  const PRE_EXISTING_YAML = hookYamlDraft({ name: 'Pre-existing Hook', description: 'must not change', on: 'PreToolUse', script: 'scripts/run.sh' });
  const PRE_EXISTING_SCRIPT = '#!/usr/bin/env bash\necho "pre-existing, must not change"\n';
  mkdirSync(join(forgeRoot, 'studio', 'hooks', collidingId, 'scripts'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'hooks', collidingId, 'hook.yaml'), PRE_EXISTING_YAML, 'utf8');
  writeFileSync(join(forgeRoot, 'studio', 'hooks', collidingId, 'scripts', 'run.sh'), PRE_EXISTING_SCRIPT, 'utf8');

  const draftedYaml = hookYamlDraft({ name: 'Authored draft hook', description: 'discarded on collision', on: 'PreToolUse', script: 'scripts/run.sh' });
  const { sessionId, sessionDir } = seedAuthoringSession({
    phase: 'awaiting-review',
    staging: { 'hook.yaml': draftedYaml, 'scripts/run.sh': '#!/usr/bin/env bash\necho draft\n' },
  });

  const res = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'hook', id: collidingId });
  const text = await res.text();
  assert.equal(res.status, 409, `expected the EXISTING duplicate-hook 409 to still fire, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { error?: string };
  assert.ok(body.error && body.error.includes(collidingId), `409 body must name the colliding id "${collidingId}", got: ${JSON.stringify(body)}`);

  assert.equal(readFileSync(join(forgeRoot, 'studio', 'hooks', collidingId, 'hook.yaml'), 'utf8'), PRE_EXISTING_YAML, 'the pre-existing hook.yaml must be BYTE-UNCHANGED');
  assert.equal(readFileSync(join(forgeRoot, 'studio', 'hooks', collidingId, 'scripts', 'run.sh'), 'utf8'), PRE_EXISTING_SCRIPT, 'the pre-existing script must be BYTE-UNCHANGED');

  assert.equal(
    readStatusPhase(sessionDir),
    'awaiting-review',
    'composed with P5: a hook-collision failure (already 409ing today) must ALSO leave the session recoverable at awaiting-review',
  );

  const retryId = 'not-colliding-hook';
  const retryRes = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'hook', id: retryId });
  const retryText = await retryRes.text();
  assert.equal(retryRes.status, 200, `the retry under a DIFFERENT id must succeed, got ${retryRes.status}: ${retryText}`);
  assert.ok(existsSync(join(forgeRoot, 'studio', 'hooks', retryId, 'hook.yaml')), 'the retry must actually install under the new id');
});

// ===========================================================================
// P7 (T3 pin round 5) — the suite already pins containment variants for
// `sessionId` (WI2-5) and `project` (WI2-6), but NONE for the finalize
// `id`, even though `id` is a request-derived value that becomes a
// directory name in TWO libraries (`_interactive-library/<id>/`,
// `skills/<id>/` or `studio/hooks/<id>/`). It is live-safe today only
// because guards TWO MODULES AWAY (`SLUG_RE` in
// orchestrator/interactive-runner.ts, `assertSkillSlug` in
// installSkillPackage/hookDir) happen to catch it. Pinned HERE so a
// regression in either upstream guard is caught by THIS module's own suite,
// not only by that other module's.
// ===========================================================================

const ID_TRAVERSAL_VARIANTS: { label: string; id: string; raw?: boolean }[] = [
  { label: 'relative traversal', id: '../../../../../../../../tmp/forge-authoring-p7-attack' },
  { label: 'absolute path', id: '/tmp/forge-authoring-p7-attack-abs' },
  { label: 'bare dot-dot', id: '..' },
  { label: 'RAW percent-encoded (rule 38 — never decoded by this route)', id: '%2e%2e%2f', raw: true },
];

test('P7-1-containment (id-shaped traversal, pinned in THIS route\'s own suite): a traversal/absolute/dot-dot/percent-encoded finalize `id` is refused; no file or dir created outside the library roots (e.g. /tmp/... absent), for every variant', async () => {
  const STAGED_CONTENT = matter.stringify('\n# P7 Skill\n', { name: 'P7 Skill', description: 'd' });
  const attackOutsidePath = join(tmpdir(), 'forge-authoring-p7-attack');
  const attackOutsidePathAbs = join(tmpdir(), 'forge-authoring-p7-attack-abs');
  rmSync(attackOutsidePath, { recursive: true, force: true });
  rmSync(attackOutsidePathAbs, { recursive: true, force: true });

  for (const variant of ID_TRAVERSAL_VARIANTS) {
    const { sessionId } = seedAuthoringSession({ phase: 'awaiting-review', staging: { 'SKILL.md': STAGED_CONTENT } });
    const beforeEntries = entriesExcludingLogs(forgeRoot);

    const res = variant.raw
      ? await postRaw(FINALIZE_URL(), JSON.stringify({ project: PROJECT, sessionId, kind: 'skill', id: variant.id }))
      : await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'skill', id: variant.id });
    assert.ok(res.status >= 400, `id ${JSON.stringify(variant.id)} (${variant.label}) must be refused with a 4xx/5xx, got ${res.status}`);

    // `_logs/` is excluded: attempting (and failing) the committing turn
    // legitimately writes an operational events.jsonl regardless of outcome
    // (runInteractiveTurn's own logger) — that is not the artifact this test
    // cares about; the library roots (`_interactive-library/`, `skills/`,
    // `studio/hooks/`) and everything else under forgeRoot are still
    // covered.
    const afterEntries = entriesExcludingLogs(forgeRoot);
    assert.deepEqual(afterEntries, beforeEntries, `id ${JSON.stringify(variant.id)} (${variant.label}) must create nothing (besides its own operational log) anywhere under forgeRoot`);
  }

  assert.equal(existsSync(attackOutsidePath), false, 'the relative-traversal variant must never create a file outside forgeRoot');
  assert.equal(existsSync(attackOutsidePathAbs), false, 'the absolute-path variant must never create a file outside forgeRoot');
});

test('P7-2-recoverability (composed with P5): the SAME id-shaped traversal variants must ALSO leave the session recoverable at awaiting-review, not bricked at committing', async () => {
  const STAGED_CONTENT = matter.stringify('\n# P7 Skill\n', { name: 'P7 Skill', description: 'd' });

  for (const variant of ID_TRAVERSAL_VARIANTS) {
    const { sessionId, sessionDir } = seedAuthoringSession({ phase: 'awaiting-review', staging: { 'SKILL.md': STAGED_CONTENT } });

    const res = variant.raw
      ? await postRaw(FINALIZE_URL(), JSON.stringify({ project: PROJECT, sessionId, kind: 'skill', id: variant.id }))
      : await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'skill', id: variant.id });
    assert.ok(res.status >= 400, `id ${JSON.stringify(variant.id)} (${variant.label}) must be refused with a 4xx/5xx, got ${res.status}`);

    assert.equal(
      readStatusPhase(sessionDir),
      'awaiting-review',
      `composed with P5: a refused id-traversal attempt (${variant.label}) must also leave the session recoverable at awaiting-review`,
    );
  }
});

test('P7-3-empty: an empty (or whitespace-only) finalize id is refused at the route boundary — 400, session never even reaches the committing turn', async () => {
  const { sessionId, sessionDir } = seedAuthoringSession({
    phase: 'awaiting-review',
    staging: { 'SKILL.md': matter.stringify('\n# x\n', { name: 'x', description: 'd' }) },
  });
  const res = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'skill', id: '   ' });
  assert.equal(res.status, 400, `expected 400 for a whitespace-only id, got ${res.status}`);
  assert.equal(readStatusPhase(sessionDir), 'awaiting-review', 'an id-less request must never even attempt the committing turn');
});

// ===========================================================================
// P8 (T3 pin round 6, adversarial-review correction D) — SUPERSEDED
// 2026-08-23 by the library-37 fix (W8-B4/WI-3). P8's ORIGINAL "corrected
// contract" (a same-id retry against a landed-but-abandoned
// `_interactive-library/<id>/` 409s naming the id) is ITSELF the bug
// library-37 reports: `_interactive-library/<id>/` (step 5's copy target)
// was never cleaned up on any outcome, so it became a hidden, gitignored,
// no-Studio-surface id LEDGER — once ANY attempt reached step 5 under a
// given id, that id was permanently unusable, even after the session that
// used it correctly reverted, and even where nothing in either REAL library
// ever held that id. Root cause (the operator-facing framing): the landed
// staging package was being used as the collision check, and that check ran
// BEFORE any real-library lookup.
//
// THE RE-CORRECTED CONTRACT (library-37): `_interactive-library/<id>/` is
// removed in a `finally` after every finalize attempt — success OR failure
// (`cli/bridge-studio-authoring.ts`'s file header, "LANDED-PACKAGE CLEANUP").
// This does NOT delete the collision check — it stops the check firing on a
// GHOST: each kind-specific install step (`finalizeSkillFromLanded` /
// `finalizeHookFromLanded` / `finalizeTemplateFromLanded`) still 409s on a
// REAL collision (an existing `skills/<id>/`, `studio/hooks/<id>/`, or
// template-library entry — P6-1/P6-2 above, and WI3-5-c below, pin this
// unchanged). P8-1 below is REWRITTEN (not merely tweaked) to assert the
// OPPOSITE of what it asserted before: a same-id retry after a
// landed-then-failed-later attempt now SUCCEEDS, because the ghost is gone
// and nothing real ever held the id.
// ===========================================================================

test('P8-1 (RE-CORRECTED, library-37): a same-id retry after an attempt that landed-then-failed-later now SUCCEEDS — the ghost _interactive-library/<id>/ no longer blocks it; attempt 1\'s never-installed hook stays absent', async () => {
  const collidingId = 'collision-surface-hook';
  const landedYamlPath = join(forgeRoot, '_interactive-library', collidingId, 'hook.yaml');

  // ---- Attempt 1: a hook draft that lands cleanly at step 5 (the generic
  // copy has no hook-shape awareness) then is refused at step 6 (a forbidden
  // binding key) — the SAME shape WI2-3b pins, reused here to build a REAL
  // landed-then-reverted precondition instead of hand-planting one. ----
  assert.ok(FORBIDDEN_HOOK_BINDING_KEYS.includes('agent'), 'arrange: "agent" must be a real forbidden binding key');
  const forbiddenDraftYaml = hookYamlDraft({
    name: 'Collision Surface Hook (attempt 1)',
    description: 'declares a forbidden binding key -- lands at step 5, refused at step 6',
    on: 'PreToolUse',
    script: 'scripts/run.sh',
    agent: 'some-agent-slug', // FORBIDDEN
  });
  const attempt1 = seedAuthoringSession({
    phase: 'awaiting-review',
    staging: { 'hook.yaml': forbiddenDraftYaml, 'scripts/run.sh': '#!/usr/bin/env bash\necho "attempt 1 -- lands then is refused"\n' },
  });

  const res1 = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId: attempt1.sessionId, kind: 'hook', id: collidingId });
  const text1 = await res1.text();
  assert.equal(res1.status, 400, `arrange: attempt 1 must be refused at step 6 (forbidden binding key), got ${res1.status}: ${text1}`);
  assert.equal(readStatusPhase(attempt1.sessionDir), 'awaiting-review', 'arrange: attempt 1 must correctly revert its own session');
  assert.equal(existsSync(join(forgeRoot, 'studio', 'hooks', collidingId)), false, 'arrange: the refused attempt must install nothing under studio/hooks/');

  // library-37: the landed copy must NOT survive attempt 1's finally cleanup.
  assert.equal(existsSync(landedYamlPath), false, `library-37: _interactive-library/${collidingId}/ must be gone after attempt 1's finally cleanup, win or lose`);

  // ---- Attempt 2: a DIFFERENT session, a VALID draft, the SAME id. Under
  // the OLD (buggy) contract this 409'd against the ghost forever; the
  // RE-CORRECTED contract is that it now succeeds — nothing real ever held
  // this id. ----
  const validDraftYaml = hookYamlDraft({
    name: 'Collision Surface Hook (attempt 2)',
    description: 'a valid draft -- must now succeed since the id was never really taken',
    on: 'PreToolUse',
    script: 'scripts/run.sh',
  });
  const attempt2 = seedAuthoringSession({
    phase: 'awaiting-review',
    staging: { 'hook.yaml': validDraftYaml, 'scripts/run.sh': '#!/usr/bin/env bash\necho "attempt 2"\n' },
  });

  const res2 = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId: attempt2.sessionId, kind: 'hook', id: collidingId });
  const text2 = await res2.text();
  assert.equal(res2.status, 200, `library-37: a same-id retry against a CLEANED-UP ghost must now SUCCEED (the id was never really taken), got ${res2.status}: ${text2}`);

  assert.ok(existsSync(join(forgeRoot, 'studio', 'hooks', collidingId, 'hook.yaml')), 'attempt 2 must actually install under studio/hooks/ this time');
  const installedDoc = yaml.load(readFileSync(join(forgeRoot, 'studio', 'hooks', collidingId, 'hook.yaml'), 'utf8')) as Record<string, unknown>;
  assert.equal(installedDoc['description'], 'a valid draft -- must now succeed since the id was never really taken', 'the installed hook must be attempt 2\'s draft');
  assert.equal(readStatusPhase(attempt2.sessionDir), 'committed', 'attempt 2 must reach committed on this genuine success');
  assert.equal(existsSync(landedYamlPath), false, "library-37 pin (a): the landed copy must ALSO be gone after attempt 2's OWN successful finalize — it is a bridge dir, never a durable record");
});

test('WI3-5-b (library-37, failure frees the id): a hook draft with a FORBIDDEN_HOOK_BINDING_KEYS key lands then fails -> _interactive-library/<id>/ is gone immediately after (not just after a later retry)', async () => {
  const id = 'library-37-failure-frees-id';
  assert.ok(FORBIDDEN_HOOK_BINDING_KEYS.includes('agent'), 'arrange: "agent" must be a real forbidden binding key');
  const { sessionId } = seedAuthoringSession({
    phase: 'awaiting-review',
    staging: {
      'hook.yaml': hookYamlDraft({ name: 'X', description: 'd', on: 'PreToolUse', script: 'scripts/run.sh', agent: 'forbidden' }),
      'scripts/run.sh': '#!/usr/bin/env bash\necho x\n',
    },
  });

  const res = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'hook', id });
  assert.equal(res.status, 400, `arrange: must be refused at step 6, got ${res.status}`);
  assert.equal(existsSync(join(forgeRoot, '_interactive-library', id)), false, 'library-37 pin (b): a FAILED finalize must also leave _interactive-library/<id>/ gone, immediately');
});

test('WI3-5-c (library-37 does not weaken the real collision check): a same-id finalize against an id genuinely held by an existing REAL library entry still 409s, naming that entry — composed with cleanup, _interactive-library/<id>/ is gone afterward too', async () => {
  const collidingId = 'real-library-holder-hook';
  const PRE_EXISTING_YAML = hookYamlDraft({ name: 'Real Holder', description: 'genuinely installed, not a ghost', on: 'PreToolUse', script: 'scripts/run.sh' });
  mkdirSync(join(forgeRoot, 'studio', 'hooks', collidingId, 'scripts'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'hooks', collidingId, 'hook.yaml'), PRE_EXISTING_YAML, 'utf8');
  writeFileSync(join(forgeRoot, 'studio', 'hooks', collidingId, 'scripts', 'run.sh'), '#!/usr/bin/env bash\necho real\n', 'utf8');

  const { sessionId, sessionDir } = seedAuthoringSession({
    phase: 'awaiting-review',
    staging: { 'hook.yaml': hookYamlDraft({ name: 'Draft', description: 'discarded', on: 'PreToolUse', script: 'scripts/run.sh' }), 'scripts/run.sh': '#!/usr/bin/env bash\necho draft\n' },
  });

  const res = await postJson(FINALIZE_URL(), { project: PROJECT, sessionId, kind: 'hook', id: collidingId });
  const text = await res.text();
  assert.equal(res.status, 409, `a REAL library collision must still 409, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { error?: string };
  assert.ok(body.error && body.error.includes(collidingId), `409 body must name the colliding id "${collidingId}", got: ${JSON.stringify(body)}`);

  assert.equal(readFileSync(join(forgeRoot, 'studio', 'hooks', collidingId, 'hook.yaml'), 'utf8'), PRE_EXISTING_YAML, 'the REAL pre-existing hook.yaml must be BYTE-UNCHANGED');
  assert.equal(readStatusPhase(sessionDir), 'awaiting-review', 'a real-collision failure must also leave the session recoverable');
  assert.equal(existsSync(join(forgeRoot, '_interactive-library', collidingId)), false, 'composed with library-37 cleanup: the landed copy this failed attempt made must ALSO be gone afterward');
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
