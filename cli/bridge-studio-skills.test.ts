/**
 * Acceptance tests for cli/bridge-studio-skills.ts (R3-01-F3/F4, WI-0).
 *
 * The module under test does not exist yet — this file is RED at branch base
 * (ERR_MODULE_NOT_FOUND on the `./bridge-studio-skills.ts` import is the
 * expected red). See _wave5/specs/R3-01-F3F4.md for the full design; AT
 * numbers below map 1:1 onto that spec's
 * "AT set — cli/bridge-studio-skills.test.ts".
 *
 * Style: real bridge (startBridge) + fetch, mirroring bridge-studio-kbs.test.ts
 * and bridge-studio-write.test.ts — plus one direct handler-invocation test
 * (mirroring bridge-studio.test.ts's non-studio-URL passthrough check) for the
 * "returns true when handled" contract.
 *
 * AT-55 ports the existing POST /api/studio/skills coverage from
 * bridge-studio-write.test.ts (deleted there in the same commit) so coverage
 * does not drop when the route moves into this module in WI-2.
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

import { startBridge } from './ui-bridge.ts';
import { handleStudioSkillsRoutes } from './bridge-studio-skills.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-studio-skills-'));

  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'studio', 'catalog.yaml'),
    ['sdks: []', 'models: []', 'tools: []', 'mcps: []', 'guards: []', 'community-skills: []', ''].join('\n'),
  );

  // A plain, ready, hand-authored skill — surfaces in GET /api/studio/skills.
  mkdirSync(join(forgeRoot, 'skills', 'existing-skill'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'skills', 'existing-skill', 'SKILL.md'),
    matter.stringify('\n# Existing Skill\n\nBody.\n', { name: 'Existing Skill', description: 'a plain composable skill' }),
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

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1', ...headers },
    body: JSON.stringify(body),
  });
}

/** Materialise a real, already-mateiralised skill package directory on disk (D2). */
function makePackageDir(
  frontmatter: Record<string, unknown> = { name: 'Route Installable', description: 'installed via the bridge route' },
): string {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-skill-pkg-'));
  writeFileSync(join(dir, 'SKILL.md'), matter.stringify('\n# Route Installable\n\nBody.\n', frontmatter));
  return dir;
}

// ---------------------------------------------------------------------------
// GET /api/studio/skills — AT-47
// ---------------------------------------------------------------------------

test('AT-47: GET /api/studio/skills returns { skills: [...] } with the library shape', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/skills`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    skills: Array<{
      id: string; name: string; description?: string; source: string; installed: boolean;
      trust: string; paletteVisible: boolean; usedBy: string[]; provenance: unknown; category?: string;
    }>;
  };
  assert.ok(Array.isArray(body.skills));

  const existing = body.skills.find((s) => s.id === 'existing-skill');
  assert.ok(existing, 'the local plain skill must appear');
  assert.equal(existing!.source, 'local');
  assert.equal(existing!.installed, true);
  assert.equal(existing!.trust, 'ready');
  assert.equal(existing!.paletteVisible, true);
  assert.ok(Array.isArray(existing!.usedBy));
  assert.equal(existing!.provenance, null, 'a hand-authored skill has no provenance');
});

// ---------------------------------------------------------------------------
// GET /api/studio/skills/:id — AT-48, AT-49, AT-50
// ---------------------------------------------------------------------------

test('AT-48: GET /api/studio/skills/<id> returns detail with files package and scan for a draft', async () => {
  mkdirSync(join(forgeRoot, 'skills', 'draft-detail'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'skills', 'draft-detail', 'SKILL.md'),
    matter.stringify('\n# Draft Detail\n\nBody.\n', {
      name: 'Draft Detail',
      description: 'a draft awaiting approval',
      status: 'draft',
      quarantined: { runtime: { sdk: 'claude', strategy: 'fixed' } },
    }),
  );

  try {
    const res = await fetch(`${bridgeUrl}/api/studio/skills/draft-detail`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      files: Array<{ path: string; body: string }>;
      scan: { quarantinedKeys: string[]; fileCount: number; totalBytes: number; body: string; executableFiles: string[] };
    };
    assert.ok(Array.isArray(body.files));
    assert.ok(body.files.some((f) => f.path === 'SKILL.md'));
    assert.ok(body.scan, 'a draft detail must carry a scan report');
    assert.ok(Array.isArray(body.scan.quarantinedKeys));
    assert.equal(typeof body.scan.fileCount, 'number');
  } finally {
    rmSync(join(forgeRoot, 'skills', 'draft-detail'), { recursive: true, force: true });
  }
});

test('AT-49: GET /api/studio/skills/<unknown> returns 404 with an error message', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/skills/no-such-skill-anywhere`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.ok(typeof body.error === 'string' && body.error.length > 0);
});

test('AT-50: GET /api/studio/skills/<traversal> (URL-encoded variants) returns 400, no read outside skills/', async () => {
  // A literal unencoded ../../ in the URL is normalised away by the fetch/WHATWG
  // URL parser before the request is even sent, so the only meaningful traversal
  // probes here are ones that survive client-side normalisation: the traversal
  // segments encoded so they arrive at the server as literal text to decode.
  const variants = ['..%2F..%2Fetc%2Fpasswd', '%2e%2e%2F%2e%2e%2Fetc%2Fpasswd'];
  for (const variant of variants) {
    const res = await fetch(`${bridgeUrl}/api/studio/skills/${variant}`);
    assert.equal(res.status, 400, `variant ${variant} must be rejected with 400`);
    const body = (await res.json()) as { error: string };
    assert.ok(typeof body.error === 'string');
  }
});

// ---------------------------------------------------------------------------
// POST /api/studio/skills/install — AT-51, AT-52
// ---------------------------------------------------------------------------

test('AT-51: POST /api/studio/skills/install writes a draft on disk with a valid body', async () => {
  const packageDir = makePackageDir();
  const res = await postJson(`${bridgeUrl}/api/studio/skills/install`, {
    id: 'route-installed-skill',
    packageDir,
    upstream: { source: 'https://github.com/example/route-installed-skill' },
  });
  assert.equal(res.status, 200);

  const skillMd = readFileSync(join(forgeRoot, 'skills', 'route-installed-skill', 'SKILL.md'), 'utf8');
  const data = matter(skillMd).data as Record<string, unknown>;
  assert.equal(data['status'], 'draft');
});

test('AT-51: POST /api/studio/skills/install missing upstream.source → 400', async () => {
  const packageDir = makePackageDir();
  const res = await postJson(`${bridgeUrl}/api/studio/skills/install`, {
    id: 'missing-source-skill',
    packageDir,
    upstream: {},
  });
  assert.equal(res.status, 400);
});

test('AT-51: POST /api/studio/skills/install missing packageDir → 400', async () => {
  const res = await postJson(`${bridgeUrl}/api/studio/skills/install`, {
    id: 'missing-package-dir-skill',
    upstream: { source: 'https://x' },
  });
  assert.equal(res.status, 400);
});

test('AT-51: POST /api/studio/skills/install with a non-existent packageDir → 400 with an actionable message (not 500)', async () => {
  const res = await postJson(`${bridgeUrl}/api/studio/skills/install`, {
    id: 'nonexistent-package-dir-skill',
    packageDir: join(tmpdir(), 'this-package-dir-does-not-exist-at-all'),
    upstream: { source: 'https://x' },
  });
  assert.equal(res.status, 400, 'a missing packageDir must be a 400, never a 500');
  const body = (await res.json()) as { error: string };
  assert.ok(typeof body.error === 'string' && body.error.length > 0);
});

test('AT-52: POST /api/studio/skills/install for an already-installed id → 200 with alreadyInstalled: true', async () => {
  const id = 'reinstall-route-skill';
  const packageDir = makePackageDir();
  const first = await postJson(`${bridgeUrl}/api/studio/skills/install`, { id, packageDir, upstream: { source: 'https://x' } });
  assert.equal(first.status, 200);

  const second = await postJson(`${bridgeUrl}/api/studio/skills/install`, { id, packageDir: makePackageDir(), upstream: { source: 'https://x' } });
  assert.equal(second.status, 200, 'reinstall is idempotent, not a 409');
  const body = (await second.json()) as { alreadyInstalled: boolean };
  assert.equal(body.alreadyInstalled, true);
});

// ---------------------------------------------------------------------------
// POST /api/studio/skills/:id/approve — AT-53
// ---------------------------------------------------------------------------

test('AT-53: POST /api/studio/skills/<id>/approve succeeds for a draft, 409 for a non-draft', async () => {
  const id = 'approve-route-skill';
  const packageDir = makePackageDir();
  await postJson(`${bridgeUrl}/api/studio/skills/install`, { id, packageDir, upstream: { source: 'https://x' } });

  const res = await postJson(`${bridgeUrl}/api/studio/skills/${id}/approve`, {});
  assert.equal(res.status, 200);

  const again = await postJson(`${bridgeUrl}/api/studio/skills/${id}/approve`, {});
  assert.equal(again.status, 409, 'approving an already-approved (non-draft) skill must 409');
});

// ---------------------------------------------------------------------------
// Sanitized errors on 500 — AT-54
// ---------------------------------------------------------------------------

test('AT-54: an unexpected internal error returns a sanitized message, no absolute host path leaked', async () => {
  // Force a real fs error (EISDIR) without mocking node:fs: SKILL.md is a
  // directory, not a file, so any implementation reading it throws with the
  // absolute path embedded in the raw error message.
  const bustedDir = join(forgeRoot, 'skills', 'busted-skill', 'SKILL.md');
  mkdirSync(bustedDir, { recursive: true });
  try {
    const res = await fetch(`${bridgeUrl}/api/studio/skills/busted-skill`);
    assert.equal(res.status, 500);
    const body = (await res.json()) as { error: string };
    assert.ok(typeof body.error === 'string');
    assert.ok(!body.error.includes(forgeRoot), 'the sanitized error must not leak the absolute host path');
  } finally {
    rmSync(join(forgeRoot, 'skills', 'busted-skill'), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// POST /api/studio/skills — AT-55 (moved verbatim from bridge-studio-write.test.ts;
// coverage must not drop when the route relocates into this module in WI-2)
// ---------------------------------------------------------------------------

test('AT-55: POST /api/studio/skills writes library: true (palette-visible + lint-valid)', async () => {
  const res = await postJson(`${bridgeUrl}/api/studio/skills`, {
    name: 'r3 f2 authored skill',
    description: 'a plain composable skill authored in-test',
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; id: string };
  assert.equal(body.ok, true);
  const skillMd = readFileSync(join(forgeRoot, 'skills', body.id, 'SKILL.md'), 'utf8');
  assert.ok(/^library: true$/m.test(skillMd), 'authored skill carries an explicit library: true');
  assert.ok(!/^runtime:/m.test(skillMd), 'authored skill is a plain skill (no runtime block)');
});

// ---------------------------------------------------------------------------
// POST /api/studio/skills — BLOCKER, symlink escape (2026-08-05 adversarial-
// review round 3, finding A/1-3). `cli/bridge-studio-skills.ts` still does a
// LEXICAL `skillDirPath.startsWith(skillsDir(forgeRoot) + sep)` check on the
// UNRESOLVED, join()-constructed path — it was never migrated to the shared
// `resolveGuardedSkillMdPath` realpath choke point
// (cli/skill-md-path-guard.ts) that the PUT and instructions-draft routes
// now use. A slug whose `skills/<id>` directory is a SYMLINK to a location
// outside the forge root passes the lexical check trivially (the
// CONSTRUCTED path is always lexically under skills/, regardless of what it
// actually resolves to on disk), so the route writes a brand-new SKILL.md
// straight through the symlink to the outside location — reproduced live,
// 200 OK. This is the sixth instance of this bug family in the campaign.
// ---------------------------------------------------------------------------

test('BLOCKER: POST /api/studio/skills rejects a symlinked skills/<id> DIRECTORY escaping the forge root — nothing is created outside', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'bridge-skills-outside-'));
  const outsideEntriesBefore = readdirSync(outsideDir).sort();

  const linkPath = join(forgeRoot, 'skills', 'escapeskill');
  try {
    symlinkSync(outsideDir, linkPath, 'dir');
  } catch {
    rmSync(outsideDir, { recursive: true, force: true });
    return;
  }

  try {
    const res = await postJson(`${bridgeUrl}/api/studio/skills`, {
      id: 'escapeskill',
      name: 'Escape Skill',
      description: 'attacker-controlled skill authored through a symlinked directory',
      body: 'ATTACKER BODY CONTENT',
    });
    assert.notEqual(
      res.status,
      200,
      'a POST that would author a SKILL.md through a symlinked skills/<id> directory escaping the forge root must be REJECTED (verified live: today it returns 200 and writes outside the repo)',
    );
    const outsideEntriesAfter = readdirSync(outsideDir).sort();
    assert.deepEqual(
      outsideEntriesAfter,
      outsideEntriesBefore,
      'nothing may be created inside the out-of-tree directory the symlink points at',
    );
  } finally {
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('POST /api/studio/skills rejects a symlinked skills/<id> DIRECTORY whose target already has a file at the escape destination — that file stays byte-unchanged', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'bridge-skills-outside-existing-'));
  const outsideFile = join(outsideDir, 'SKILL.md');
  const outsideOriginal = 'name: Pre-existing Outside File\n---\n\nOriginal content that must never change.\n';
  writeFileSync(outsideFile, outsideOriginal, 'utf8');

  const linkPath = join(forgeRoot, 'skills', 'escapeskill-existing');
  try {
    symlinkSync(outsideDir, linkPath, 'dir');
  } catch {
    rmSync(outsideDir, { recursive: true, force: true });
    return;
  }

  try {
    const res = await postJson(`${bridgeUrl}/api/studio/skills`, {
      id: 'escapeskill-existing',
      name: 'Escape Skill Existing',
      description: 'attacker-controlled overwrite attempt through a symlinked directory',
      body: 'ATTACKER OVERWRITE CONTENT',
    });
    assert.notEqual(res.status, 200, 'a POST targeting an escape destination that already has a file must be REJECTED, not silently deduped to a write-avoiding 409 that still leaves containment unverified');
    const outsideAfter = readFileSync(outsideFile, 'utf8');
    assert.equal(outsideAfter, outsideOriginal, 'the pre-existing out-of-tree file must be byte-unchanged');
  } finally {
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('POST /api/studio/skills: a legitimate new skill still authors successfully (the containment fix must not break creation)', async () => {
  const res = await postJson(`${bridgeUrl}/api/studio/skills`, {
    id: 'legit-new-skill',
    name: 'Legit New Skill',
    description: 'an ordinary skill authored with no traversal shape at all',
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; id: string };
  assert.equal(body.ok, true);
  assert.equal(body.id, 'legit-new-skill');
  assert.ok(existsSync(join(forgeRoot, 'skills', 'legit-new-skill', 'SKILL.md')), 'the new skill must be written inside the real forge root');
});

// ---------------------------------------------------------------------------
// Handler contract — direct invocation (mirrors bridge-studio.test.ts's
// handler-invocation pattern): non-matching URL returns false (passthrough).
// ---------------------------------------------------------------------------

test('handleStudioSkillsRoutes returns false for a non-matching URL (passthrough contract)', async () => {
  const mockRes = {
    writeHead: () => { throw new Error('must not write a response for a non-matching URL'); },
    end: () => { throw new Error('must not end a response for a non-matching URL'); },
  } as unknown as import('node:http').ServerResponse;
  const mockReq = {} as import('node:http').IncomingMessage;
  const ctx = { forgeRoot, logsRoot: join(forgeRoot, '_logs') };

  const handled = await handleStudioSkillsRoutes(mockReq, mockRes, ctx, '/api/studio/nonexistent', 'GET');
  assert.equal(handled, false, 'a non-matching studio-skills URL must return false');
});
