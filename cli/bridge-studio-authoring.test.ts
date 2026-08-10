/**
 * Acceptance tests for cli/bridge-studio-authoring.ts (R4-21, WI-2: OOTB
 * authoring agent / skill-hook package producer, save path). DOES NOT EXIST
 * YET. This file is RED at branch base (ERR_MODULE_NOT_FOUND on the
 * `./bridge-studio-authoring.ts` import is the expected red — mirrors
 * cli/bridge-studio-hooks.test.ts's own explicit "do not stub the module
 * into existence to turn this green" precedent). Do not stub the module into
 * existence to turn this green; red is the deliverable of this round.
 *
 * Style: real bridge (startBridge) + fetch, mirroring
 * cli/bridge-studio-skills.test.ts / cli/bridge-studio-hooks.test.ts's
 * tmp-forge-root harness exactly.
 *
 * ---------------------------------------------------------------------------
 * CONTRACT DECISIONS MADE HERE (T3 — the R4-21 roadmap entry names the
 * capability, "finalize writes the package through the existing library
 * write/validation path", but not a route path or wire shape; ratify or
 * redirect per the T3 report):
 *
 *  D-1. ONE route: `POST /api/studio/authoring/finalize`. A `kind` field
 *       discriminates skill vs. hook — the two existing library write paths
 *       this route composes stay entirely unchanged and unmoved.
 *  D-2. Skill finalize (`kind:'skill'`) reuses EXACTLY the existing inline-
 *       upload contract `POST /api/studio/skills/install` already accepts
 *       (SEC-05 q80): `{ id, entries: [{path, contentBase64}], upstream:
 *       {source, ref?} }`, staged via the same server-side guarded stage
 *       (cli/skill-staging.ts) and installed via the SAME
 *       `installSkillPackage` (orchestrator/studio/skill-library.ts) —
 *       check-then-write, whole-package validation BEFORE any write (its own
 *       AT-21), so a rejected draft leaves no half-written `skills/<id>/`.
 *  D-3. Hook finalize (`kind:'hook'`) reuses EXACTLY the existing
 *       `POST /api/studio/hooks` body shape (`name, description, on,
 *       scriptBody, matcher?, permissions?`) and its D-5/D-6 write contract:
 *       always writes the script to the fixed relative path `scripts/run.sh`
 *       inside the new hook's directory, and rejects (400) any body carrying
 *       one of `hook-library.ts`'s `FORBIDDEN_HOOK_BINDING_KEYS` before any
 *       filesystem write.
 *  D-4. Response envelope: `{ ok: true, kind, id }` on success — mirrors both
 *       source routes' flat `{ ok: true, id }` shape, with `kind` added so a
 *       caller that only has the finalize response (not the request it sent)
 *       can still tell which library the id landed in.
 *  D-5. Finalize installs a skill as a DRAFT (`status: 'draft', library:
 *       false`) — it NEVER auto-approves. Palette visibility is gated behind
 *       the EXISTING, SEPARATE `POST /api/studio/skills/:id/approve` route
 *       (D2 trust-boundary ruling in the R4-21 task brief) — a skill
 *       finalized through this route is listSkillLibrary-visible immediately
 *       but `paletteVisible:false` until that separate act.
 *  D-6. Containment for BOTH kinds goes through the SAME choke points the
 *       existing routes already use — `resolveGuardedPath`/`guardedFile`
 *       (cli/studio-path-guard.ts) for the id-derived destination, and
 *       `stageSkillPackage`'s own guarded stage for skill entries — never a
 *       fresh lexical `startsWith` reimplementation specific to this route.
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
import matter from 'gray-matter';
import yaml from 'js-yaml';

import { startBridge } from './ui-bridge.ts';
// Does not exist yet — ERR_MODULE_NOT_FOUND is the expected red for this
// WHOLE file until cli/bridge-studio-authoring.ts lands (mirrors
// cli/bridge-studio-hooks.test.ts's own header note for the identical
// situation on that sibling route).
import { handleStudioAuthoringRoutes } from './bridge-studio-authoring.ts';
import { MAX_PACKAGE_FILES } from '../orchestrator/studio/skill-library.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-studio-authoring-'));

  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'hooks'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'studio', 'catalog.yaml'),
    ['sdks: []', 'models: []', 'tools: []', 'mcps: []', 'guards: []', 'community-skills: []', ''].join('\n'),
  );

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

function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

type Permissions = { env: string[]; read: string[]; network: boolean };
const DENY_ALL: Permissions = { env: [], read: [], network: false };

const FINALIZE_URL = () => `${bridgeUrl}/api/studio/authoring/finalize`;

// ---------------------------------------------------------------------------
// RED-4a — skill finalize installs as DRAFT, library-visible, NOT
// palette-visible (D5)
// ---------------------------------------------------------------------------

test('RED-4a: POST /api/studio/authoring/finalize (kind:"skill") installs a valid skill draft — lands status:draft/library:false, listSkillLibrary-visible immediately, but NOT palette-visible (finalize never auto-approves)', async () => {
  const skillMd = matter.stringify(
    '\n# Authored Skill\n\nBody.\n',
    { name: 'Authored Skill', description: 'authored via the creation-agent authoring session' },
  );
  const res = await postJson(FINALIZE_URL(), {
    kind: 'skill',
    id: 'authored-skill',
    entries: [
      { path: 'SKILL.md', contentBase64: b64(skillMd) },
      { path: 'reference.md', contentBase64: b64('Supporting reference content.\n') },
    ],
    upstream: { source: 'forge://authoring-session/authored-skill' },
  });
  // Read the body ONCE — a Response body is single-read; the earlier shape
  // (`await res.text()` inside the assert message, THEN `await res.json()`)
  // unconditionally consumed it twice regardless of status, throwing "Body
  // already read" independent of what the server returned (a test-harness
  // bug, not a spec change — verified the route itself is correct).
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { ok: boolean; id: string; kind?: string };
  assert.equal(body.ok, true);
  assert.equal(body.id, 'authored-skill');

  const installedMdPath = join(forgeRoot, 'skills', 'authored-skill', 'SKILL.md');
  assert.ok(existsSync(installedMdPath), 'skills/authored-skill/SKILL.md must exist on disk');
  assert.ok(
    existsSync(join(forgeRoot, 'skills', 'authored-skill', 'reference.md')),
    'the second package file must land too — the WHOLE package installs, not just SKILL.md',
  );
  const installedData = matter(readFileSync(installedMdPath, 'utf8')).data as Record<string, unknown>;
  assert.equal(installedData['status'], 'draft', 'finalize lands as a DRAFT — installSkillPackage stamps status: draft (D5)');
  assert.equal(installedData['library'], false, 'finalize never auto-approves — library stays false until the SEPARATE /skills/:id/approve route runs (D5)');

  const listRes = await fetch(`${bridgeUrl}/api/studio/skills`);
  const listBody = (await listRes.json()) as { skills: Array<{ id: string; trust: string; paletteVisible: boolean }> };
  const entry = listBody.skills.find((s) => s.id === 'authored-skill');
  assert.ok(entry, 'the finalized skill must be listSkillLibrary-visible immediately (the R3-01-F2 no-restart invariant)');
  assert.equal(entry!.trust, 'draft');
  assert.equal(entry!.paletteVisible, false, 'a draft is never palette-visible — approval is a separate, later, operator-gated act');
});

// ---------------------------------------------------------------------------
// RED-4b — check-then-write: a malformed draft is refused, writes NOTHING
// (mirrors skill-library.test.ts's AT-20/21/22 exactly, over HTTP)
// ---------------------------------------------------------------------------

test('RED-4b (mirrors skill-library AT-20): a draft missing SKILL.md at its root is refused with a named error and writes NOTHING', async () => {
  const res = await postJson(FINALIZE_URL(), {
    kind: 'skill',
    id: 'no-skill-md',
    entries: [{ path: 'reference.md', contentBase64: b64('no SKILL.md in this package') }],
    upstream: { source: 'forge://authoring-session/no-skill-md' },
  });
  assert.ok(res.status >= 400 && res.status < 500, `expected a 4xx, got ${res.status}`);
  const body = (await res.json()) as { error?: string };
  assert.ok(body.error && body.error.length > 0, 'the refusal must carry an actionable, named error');
  assert.equal(existsSync(join(forgeRoot, 'skills', 'no-skill-md')), false, 'no partial skills/<id>/ dir may be left behind');
});

test('RED-4b (mirrors skill-library AT-21, containment): a draft entry.path escaping the package root ("../evil") is refused and writes NOTHING outside the package, staged OR final', async () => {
  const skillMd = matter.stringify('\nBody.\n', { name: 'Evil', description: 'd' });
  const res = await postJson(FINALIZE_URL(), {
    kind: 'skill',
    id: 'evil-escape-skill',
    entries: [
      { path: 'SKILL.md', contentBase64: b64(skillMd) },
      { path: '../evil', contentBase64: b64('ATTACKER-STAGED-BYTES') },
    ],
    upstream: { source: 'forge://authoring-session/evil-escape-skill' },
  });
  assert.ok(res.status >= 400 && res.status < 500, `a traversal entry.path must be a 4xx, got ${res.status}`);
  assert.equal(existsSync(join(forgeRoot, 'skills', 'evil-escape-skill')), false, 'no partial skills/<id>/ dir may be left behind');
  assert.equal(
    existsSync(join(forgeRoot, '_skill-staging', 'evil')),
    false,
    'the escape target must never be written, at either the staging or final destination',
  );
});

test('RED-4b (mirrors skill-library AT-22, over-cap): a draft exceeding MAX_PACKAGE_FILES is refused and writes NOTHING', async () => {
  const entries: Array<{ path: string; contentBase64: string }> = [
    { path: 'SKILL.md', contentBase64: b64(matter.stringify('\nBody.\n', { name: 'Many', description: 'd' })) },
  ];
  for (let i = 0; i < MAX_PACKAGE_FILES; i++) entries.push({ path: `extra-${i}.txt`, contentBase64: b64('x') });
  const res = await postJson(FINALIZE_URL(), {
    kind: 'skill',
    id: 'too-many-files-skill',
    entries,
    upstream: { source: 'forge://authoring-session/too-many-files-skill' },
  });
  assert.ok(res.status >= 400 && res.status < 500, `expected a 4xx, got ${res.status}`);
  assert.equal(existsSync(join(forgeRoot, 'skills', 'too-many-files-skill')), false, 'no partial skills/<id>/ dir may be left behind');
});

// ---------------------------------------------------------------------------
// RED-4c — hook finalize reuses the existing 2-file shape + D-6 rejection
// ---------------------------------------------------------------------------

test('RED-4c: POST /api/studio/authoring/finalize (kind:"hook") writes the existing 2-file shape (hook.yaml + scripts/run.sh) under hooksDir — the SAME fixed script path POST /api/studio/hooks always writes (D-5 there)', async () => {
  const res = await postJson(FINALIZE_URL(), {
    kind: 'hook',
    id: 'authored-hook',
    name: 'Authored Hook',
    description: 'authored via the creation-agent authoring session',
    on: 'PreToolUse',
    scriptBody: '#!/usr/bin/env bash\necho "authored hook ran"\n',
    permissions: DENY_ALL,
  });
  // Read the body ONCE — see RED-4a's identical comment above for why.
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { ok: boolean; id: string };
  assert.equal(body.ok, true);

  const yamlBody = readFileSync(join(forgeRoot, 'studio', 'hooks', body.id, 'hook.yaml'), 'utf8');
  const doc = yaml.load(yamlBody) as Record<string, unknown>;
  assert.equal(doc['on'], 'PreToolUse');
  assert.equal(
    doc['script'],
    'scripts/run.sh',
    'finalize must reuse the SAME fixed relative script path the existing POST /api/studio/hooks route always writes — no client-supplied script path, ever',
  );
  const scriptBody = readFileSync(join(forgeRoot, 'studio', 'hooks', body.id, 'scripts', 'run.sh'), 'utf8');
  assert.equal(scriptBody, '#!/usr/bin/env bash\necho "authored hook ran"\n');
});

test('RED-4c: POST /api/studio/authoring/finalize (kind:"hook") rejects a body carrying a FORBIDDEN_HOOK_BINDING_KEYS key (e.g. "composition") exactly as POST /api/studio/hooks D-6 does — writes nothing', async () => {
  const res = await postJson(FINALIZE_URL(), {
    kind: 'hook',
    id: 'binding-attempt-finalize',
    name: 'binding-attempt-finalize',
    description: 'd',
    on: 'PreToolUse',
    scriptBody: 'x',
    composition: { hooks: [] },
  });
  assert.equal(res.status, 400);
  assert.equal(
    existsSync(join(forgeRoot, 'studio', 'hooks', 'binding-attempt-finalize')),
    false,
    'a rejected finalize must not leave a half-written hook package on disk',
  );
});

// ---------------------------------------------------------------------------
// RED-4d — containment goes through the SAME guarded choke points the
// existing routes use (D-6), never a fresh lexical startsWith. Mirrors
// cli/bridge-studio-skills.test.ts's BLOCKER symlinked-directory test
// exactly, over the NEW finalize route.
// ---------------------------------------------------------------------------

test('RED-4d (containment): a symlinked skills/<id> DIRECTORY escaping the forge root is refused via the SAME guarded choke point installSkillPackage/POST-skills-install already use — nothing is created outside the escape target', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'bridge-authoring-outside-'));
  const outsideEntriesBefore = readdirSync(outsideDir).sort();
  const linkPath = join(forgeRoot, 'skills', 'escape-authoring-skill');
  try {
    symlinkSync(outsideDir, linkPath, 'dir');
  } catch {
    // Symlinks unsupported on this filesystem/platform — skip, matching the
    // sibling BLOCKER test's own tolerance.
    rmSync(outsideDir, { recursive: true, force: true });
    return;
  }
  try {
    const skillMd = matter.stringify('\nBody.\n', { name: 'Escape', description: 'd' });
    const res = await postJson(FINALIZE_URL(), {
      kind: 'skill',
      id: 'escape-authoring-skill',
      entries: [{ path: 'SKILL.md', contentBase64: b64(skillMd) }],
      upstream: { source: 'forge://authoring-session/escape-authoring-skill' },
    });
    assert.notEqual(
      res.status,
      200,
      'a finalize that would write through a symlinked skills/<id> directory escaping the forge root must be REJECTED, never a naive lexical startsWith pass',
    );
    const outsideEntriesAfter = readdirSync(outsideDir).sort();
    assert.deepEqual(outsideEntriesAfter, outsideEntriesBefore, 'nothing may be created inside the out-of-tree directory the symlink points at');
  } finally {
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Handler contract — direct invocation (mirrors bridge-studio-skills.test.ts's
// / bridge-studio.test.ts's non-matching-URL passthrough pattern)
// ---------------------------------------------------------------------------

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
