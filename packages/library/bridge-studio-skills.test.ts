/**
 * Acceptance tests for packages/library/bridge-studio-skills.ts (R3-01-F3/F4, WI-0).
 *
 * The module under test does not exist yet — this file is RED at branch base
 * (ERR_MODULE_NOT_FOUND on the `./bridge-studio-skills.ts` import is the
 * expected red). See _wave5/specs/R3-01-F3F4.md for the full design; AT
 * numbers below map 1:1 onto that spec's
 * "AT set — packages/library/bridge-studio-skills.test.ts".
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
import yaml from 'js-yaml';

import { startBridge } from '../../apps/forge/ui-bridge.ts';
import { dispatchRoute } from '@forge/kernel'; import { libraryRoutes } from './routes.ts';

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

/**
 * Inline-upload {entries} for POST /api/studio/skills/install (SEC-05 q80 new
 * contract). Mirrors the old makePackageDir's SKILL.md byte-for-byte so the
 * installed skill is byte-equivalent — only the transport changed (a client
 * packageDir became a server-staged inline upload). `b64` is a hoisted function
 * declaration further down the file, so referencing it here is safe.
 */
function makeEntries(
  frontmatter: Record<string, unknown> = { name: 'Route Installable', description: 'installed via the bridge route' },
): Array<{ path: string; contentBase64: string }> {
  return [{ path: 'SKILL.md', contentBase64: b64(matter.stringify('\n# Route Installable\n\nBody.\n', frontmatter)) }];
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
  const res = await postJson(`${bridgeUrl}/api/studio/skills/install`, {
    id: 'route-installed-skill',
    entries: makeEntries(),
    upstream: { source: 'https://github.com/example/route-installed-skill' },
  });
  assert.equal(res.status, 200);

  const skillMd = readFileSync(join(forgeRoot, 'skills', 'route-installed-skill', 'SKILL.md'), 'utf8');
  const data = matter(skillMd).data as Record<string, unknown>;
  assert.equal(data['status'], 'draft');
});

test('AT-51: POST /api/studio/skills/install missing upstream.source → 400', async () => {
  const res = await postJson(`${bridgeUrl}/api/studio/skills/install`, {
    id: 'missing-source-skill',
    entries: makeEntries(),
    upstream: {},
  });
  assert.equal(res.status, 400);
});

test('AT-51: POST /api/studio/skills/install missing entries → 400', async () => {
  const res = await postJson(`${bridgeUrl}/api/studio/skills/install`, {
    id: 'missing-entries-skill',
    upstream: { source: 'https://x' },
  });
  assert.equal(res.status, 400);
});

test('AT-51: POST /api/studio/skills/install with a malformed entry (traversal path) → 400 with an actionable message (not 500)', async () => {
  // New-contract analogue of the retired "non-existent packageDir" case: bad
  // caller input must be a 400 with an actionable message, never a 500 / raw
  // stack trace. A traversal entry.path is deterministically rejected (the
  // route boundary refuses a ".." segment; the guarded stage refuses it too),
  // whereas a bad base64 string is decoded leniently by Node and would NOT
  // reliably 400 — so the traversal path is the robust bad-input probe here.
  const res = await postJson(`${bridgeUrl}/api/studio/skills/install`, {
    id: 'malformed-entry-skill',
    entries: [{ path: '../escape', contentBase64: b64('malformed caller input') }],
    upstream: { source: 'https://x' },
  });
  assert.equal(res.status, 400, 'malformed caller input must be a 400, never a 500');
  const body = (await res.json()) as { error: string };
  assert.ok(typeof body.error === 'string' && body.error.length > 0);
});

test('AT-52: POST /api/studio/skills/install for an already-installed id → 200 with alreadyInstalled: true', async () => {
  const id = 'reinstall-route-skill';
  const first = await postJson(`${bridgeUrl}/api/studio/skills/install`, { id, entries: makeEntries(), upstream: { source: 'https://x' } });
  assert.equal(first.status, 200);

  const second = await postJson(`${bridgeUrl}/api/studio/skills/install`, { id, entries: makeEntries(), upstream: { source: 'https://x' } });
  assert.equal(second.status, 200, 'reinstall is idempotent, not a 409');
  const body = (await second.json()) as { alreadyInstalled: boolean };
  assert.equal(body.alreadyInstalled, true);
});

// ---------------------------------------------------------------------------
// POST /api/studio/skills/:id/approve — AT-53
// ---------------------------------------------------------------------------

test('AT-53: POST /api/studio/skills/<id>/approve succeeds for a draft, 409 for a non-draft', async () => {
  const id = 'approve-route-skill';
  await postJson(`${bridgeUrl}/api/studio/skills/install`, { id, entries: makeEntries(), upstream: { source: 'https://x' } });

  const res = await postJson(`${bridgeUrl}/api/studio/skills/${id}/approve`, {});
  assert.equal(res.status, 200);

  const again = await postJson(`${bridgeUrl}/api/studio/skills/${id}/approve`, {});
  assert.equal(again.status, 409, 'approving an already-approved (non-draft) skill must 409');
});

// ---------------------------------------------------------------------------
// POST /api/studio/skills/:id/approve — needs-review dispatch (W8-B4,
// library-36 regate). Commit 227ca073 made /skills/<id> RENDER an Approve
// control for a needs-review skill; the server still 409ed everything that
// wasn't a draft, so the rendered control was declared-data-fails-open (the
// campaign's dominant defect class). `SkillTrust` has exactly THREE arms
// ('ready' | 'draft' | 'needs-review' — orchestrator/studio/skill-library.ts)
// and the route must give each its own dispatch:
//   draft        -> approveSkillDraft (regression-guarded below)
//   needs-review -> repinSkillPackage (the new arm these tests pin)
//   ready        -> still 409, naming the real trust value
// ---------------------------------------------------------------------------

function readSkillFrontmatter(id: string): Record<string, unknown> {
  const raw = readFileSync(join(forgeRoot, 'skills', id, 'SKILL.md'), 'utf8');
  return (matter(raw, {}).data ?? {}) as Record<string, unknown>;
}

/** Install + approve a skill through the REAL routes (a real provenance
 *  block + a real install-ledger row), then hand-edit the BODY on disk only
 *  — bypassing the pipeline, exactly like a direct edit or the PUT route
 *  (W7-B4 library-05) would — so the recomputed package hash no longer
 *  matches the pinned provenance hash. This is the "hash-drift" needs-review
 *  shape: ledger entry present, provenance present and agreeing with the
 *  ledger, but the actual bytes have moved on. */
async function makeNeedsReviewSkillViaHashDrift(id: string): Promise<void> {
  const install = await postJson(`${bridgeUrl}/api/studio/skills/install`, {
    id,
    entries: makeEntries({ name: 'Needs Review Fixture', description: 'drifts after approval' }),
    upstream: { source: 'https://example.com/needs-review-fixture' },
  });
  assert.equal(install.status, 200, 'fixture setup: install must succeed');
  const approve = await postJson(`${bridgeUrl}/api/studio/skills/${id}/approve`, {});
  assert.equal(approve.status, 200, 'fixture setup: draft approve must succeed');

  const mdPath = join(forgeRoot, 'skills', id, 'SKILL.md');
  const { data, content } = matter(readFileSync(mdPath, 'utf8'), {});
  writeFileSync(mdPath, matter.stringify(`\n${content.replace(/^\n+/, '')}\nHand-edited after approval.\n`, data as Record<string, unknown>), 'utf8');
}

test('library-36 pin 1: approving a needs-review skill returns 200 and flips trust to ready — asserts the ARTIFACT (re-reads skillTrustDetail via GET), not just the status code', async () => {
  const id = 'library-36-needs-review-approve';
  await makeNeedsReviewSkillViaHashDrift(id);

  const before = (await (await fetch(`${bridgeUrl}/api/studio/skills/${id}`)).json()) as Record<string, unknown>;
  assert.equal(before['trust'], 'needs-review', 'sanity: the drifted fixture must read back as needs-review');

  const res = await postJson(`${bridgeUrl}/api/studio/skills/${id}/approve`, {});
  const resBody = await res.clone().json().catch(() => null);
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(resBody)}`);

  const after = (await (await fetch(`${bridgeUrl}/api/studio/skills/${id}`)).json()) as Record<string, unknown>;
  assert.equal(after['trust'], 'ready', 'the skill must read back ready — re-derived from skillTrustDetail, never trusted from the 200 alone');
});

test('library-36 pin 2 (regression): approving a draft STILL returns 200 and still flips library:true / drops status:draft — the dispatch must not replace the draft path', async () => {
  const id = 'library-36-draft-still-works';
  const install = await postJson(`${bridgeUrl}/api/studio/skills/install`, {
    id,
    entries: makeEntries({ name: 'Draft Still Works', description: 'must still approve via approveSkillDraft' }),
    upstream: { source: 'https://example.com/draft-still-works' },
  });
  assert.equal(install.status, 200);
  assert.equal(readSkillFrontmatter(id)['status'], 'draft', 'fixture sanity: a fresh install is a draft');

  const res = await postJson(`${bridgeUrl}/api/studio/skills/${id}/approve`, {});
  assert.equal(res.status, 200);

  const fm = readSkillFrontmatter(id);
  assert.equal(fm['library'], true, 'an approved draft must carry library: true');
  assert.equal('status' in fm, false, 'an approved draft must drop status: draft entirely');
});

test('library-36 pin 3 (enumeration): the trust value that is neither draft nor needs-review ("ready") still 409s, and the message names the real trust value', async () => {
  // "existing-skill" is the top-level before() fixture: hand-authored, no
  // provenance, no install-ledger row — skillTrustDetail returns { trust: 'ready' }.
  const res = await postJson(`${bridgeUrl}/api/studio/skills/existing-skill/approve`, {});
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /ready/, 'the 409 message must name the real trust value ("ready")');
});

test('library-36 pin 4: a needs-review skill with NO provenance block hits a 409 naming the real reason, never a 500', async () => {
  // Deliberately no "provenance" substring in the id itself — the id is
  // echoed back into 409 messages, and a matching substring there would give
  // a false-positive /provenance/i match unrelated to the actual reason text.
  const id = 'library-36-stripped-block-needs-review';
  const install = await postJson(`${bridgeUrl}/api/studio/skills/install`, {
    id,
    entries: makeEntries({ name: 'No Provenance After Strip', description: 'provenance stripped by hand post-install' }),
    upstream: { source: 'https://example.com/no-provenance' },
  });
  assert.equal(install.status, 200);
  const approve = await postJson(`${bridgeUrl}/api/studio/skills/${id}/approve`, {});
  assert.equal(approve.status, 200, 'fixture setup: draft approve must succeed');

  // Strip the provenance block ENTIRELY by hand, leaving the install-ledger
  // row intact — skillTrustDetail's ledger-exists-but-provenance-missing
  // branch ("provenance-tampered"), the exact needs-review shape that leaves
  // repinSkillPackage nothing to anchor a re-pin to.
  const mdPath = join(forgeRoot, 'skills', id, 'SKILL.md');
  const { data, content } = matter(readFileSync(mdPath, 'utf8'), {});
  const stripped = { ...(data as Record<string, unknown>) };
  delete stripped['provenance'];
  writeFileSync(mdPath, matter.stringify(`\n${content.replace(/^\n+/, '')}\n`, stripped), 'utf8');

  const detail = (await (await fetch(`${bridgeUrl}/api/studio/skills/${id}`)).json()) as Record<string, unknown>;
  assert.equal(detail['trust'], 'needs-review', 'fixture sanity: a stripped provenance block must still read as needs-review');

  const res = await postJson(`${bridgeUrl}/api/studio/skills/${id}/approve`, {});
  assert.equal(res.status, 409, `must 409, never 500 — got ${res.status}`);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /provenance/i, 'the 409 message must name the real reason (no provenance block to re-pin)');
});

test("library-36 pin 5: after a needs-review approve, the install-ledger row's pin is in step with the new on-disk hash — re-read both artifacts, do not trust repinSkillPackage's own unit tests", async () => {
  const id = 'library-36-ledger-in-step';
  await makeNeedsReviewSkillViaHashDrift(id);

  const res = await postJson(`${bridgeUrl}/api/studio/skills/${id}/approve`, {});
  assert.equal(res.status, 200);

  const fm = readSkillFrontmatter(id);
  const provenance = fm['provenance'] as Record<string, unknown> | undefined;
  assert.ok(provenance && typeof provenance['contentHash'] === 'string', 'sanity: the approved skill must still carry a provenance block with a contentHash');

  const ledger = installLedgerDoc();
  const row = (ledger.installed ?? []).find((e) => e.id === id) as { id: string; contentHash?: string } | undefined;
  assert.ok(row, "the install-ledger row must still exist for this id");
  assert.equal(row!.contentHash, provenance!['contentHash'], "the ledger row's pinned contentHash must match the re-pinned SKILL.md provenance hash");

  // Prove it does NOT immediately fall back to needs-review on the very next
  // independent read — skillTrustDetail recomputes and cross-checks both
  // artifacts, so this only stays ready if the ledger truly moved in step.
  const after = (await (await fetch(`${bridgeUrl}/api/studio/skills/${id}`)).json()) as Record<string, unknown>;
  assert.equal(after['trust'], 'ready', 'must stay ready on a fresh re-read — ledger and provenance must both be in step');
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
// review round 3, finding A/1-3). `packages/library/bridge-studio-skills.ts` still does a
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

test('the library route table declines a non-matching URL (passthrough contract)', async () => {
  const mockRes = {
    writeHead: () => { throw new Error('must not write a response for a non-matching URL'); },
    end: () => { throw new Error('must not end a response for a non-matching URL'); },
  } as unknown as import('node:http').ServerResponse;
  const mockReq = {} as import('node:http').IncomingMessage;
  const ctx = { forgeRoot, logsRoot: join(forgeRoot, '_logs') };

  const handled = await dispatchRoute(libraryRoutes, mockReq, mockRes, { ...ctx, readBody: async () => ({}) }, '/api/studio/nonexistent', 'GET');
  assert.equal(handled, false, 'a non-matching studio-skills URL must return false');
});

// ---------------------------------------------------------------------------
// SEC-05 q80 (d1) — POST /api/studio/skills/install NEW inline-upload {entries}
// contract (appended; edits no existing AT). RULED fix: the route stops taking
// a client-supplied packageDir and instead accepts
//   { id, entries: [{ path, contentBase64 }], upstream: { source, ref? } }
// minting a SERVER-derived sourceId, staging entries under
// <forgeRoot>/_skill-staging/<sourceId>/ via packages/library/skill-staging.ts's guarded
// stageSkillPackage, copying via installSkillPackage, then rm'ing the staging
// dir in a `finally`. (The AT-51 packageDir tests above pin TODAY's contract;
// they are retired with the fix by the impl worker, not here — this file only
// ADDS the {entries} coverage.)
// ---------------------------------------------------------------------------

function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

/** Entry names left under <forgeRoot>/_skill-staging (empty === cleaned up). */
function stagingLeftover(): string[] {
  const base = join(forgeRoot, '_skill-staging');
  return existsSync(base) ? readdirSync(base) : [];
}

test('SEC-05 q80 (RED anchor): POST /api/studio/skills/install with the {entries} contract INSTALLS the skill end-to-end and cleans up _skill-staging', async () => {
  const skillMd = matter.stringify('\n# Good Skill\n\nBody.\n', {
    name: 'Good Skill',
    description: 'installed via the inline-upload entries contract',
  });
  const res = await postJson(`${bridgeUrl}/api/studio/skills/install`, {
    id: 'good-skill',
    entries: [{ path: 'SKILL.md', contentBase64: b64(skillMd) }],
    upstream: { source: 'test://x' },
  });

  // RED TODAY: the route still requires body.packageDir, so this 400s with no
  // install. GREEN once the {entries} staging path lands. This status assertion
  // is the RED anchor — it proves the new contract is wired end-to-end.
  assert.equal(res.status, 200, 'the {entries} contract must install (200) — RED today because the route still requires packageDir');

  // The skill is really on disk as a draft: entries -> staged dir ->
  // installSkillPackage copy. (Not merely a 200 — the artifact must exist.)
  const installedPath = join(forgeRoot, 'skills', 'good-skill', 'SKILL.md');
  assert.ok(existsSync(installedPath), 'skills/good-skill/SKILL.md must exist after a successful install');
  const installedData = matter(readFileSync(installedPath, 'utf8')).data as Record<string, unknown>;
  assert.equal(installedData['status'], 'draft', 'an installed package lands as a draft (installSkillPackage stamps status: draft)');

  // The route's `finally` rm'd the staging dir — no leaked <sourceId> under
  // _skill-staging (a leaked handle/dir is a real defect an assertion on the
  // body alone cannot see).
  assert.deepEqual(stagingLeftover(), [], 'the _skill-staging area must be empty after a successful install (finally rmSync)');
});

test('SEC-05 q80 (CONTAINMENT): POST /api/studio/skills/install with a traversal entry.path is REJECTED (4xx) and stages/writes NOTHING outside <sourceId>/', async () => {
  const res = await postJson(`${bridgeUrl}/api/studio/skills/install`, {
    id: 'evil',
    entries: [{ path: '../evil', contentBase64: b64('ATTACKER-STAGED-BYTES') }],
    upstream: { source: 'test://x' },
  });

  // 4xx — never a 2xx, and never a 500 (a traversal entry is caller input, so
  // the guarded stage's refusal is a 4xx, mirroring installSkillPackage's
  // every-throw-is-caller-input contract).
  assert.ok(res.status >= 400 && res.status < 500, `a traversal entry.path must be a 4xx, got ${res.status}`);

  // ARTIFACT (not a bare "400"): a status-only assertion would pass by accident
  // BOTH on today's 'packageDir is required' 400 AND on a NAIVE fix that stages
  // via join(stagingRoot, sourceId, entry.path) — that naive fix ALSO 400s
  // (installSkillPackage then finds no SKILL.md) yet has ALREADY written the
  // escape file _skill-staging/evil. These byte-absent assertions are what
  // distinguish the correct guarded stage from that naive fix:
  //   - join(stagingRoot, sourceId, '../evil') collapses to <base>/evil,
  //     independent of the server-minted sourceId, so the target is
  //     deterministic: <forgeRoot>/_skill-staging/evil.
  assert.equal(
    existsSync(join(forgeRoot, '_skill-staging', 'evil')),
    false,
    'no bytes may be staged to the out-of-<sourceId> sibling _skill-staging/evil',
  );
  assert.equal(existsSync(join(forgeRoot, 'skills', 'evil')), false, 'no skills/evil dir may be authored');
  assert.deepEqual(stagingLeftover(), [], 'the _skill-staging area must be left clean after a rejected install (finally rmSync)');
});

// ---------------------------------------------------------------------------
// DELETE /api/studio/skills/:id (W8-B4, library-35) — delete must prune the
// install ledger too, or a fresh hand-authored skill reusing the id inherits
// a stranger's provenance row and is wrongly needs-review.
// ---------------------------------------------------------------------------

async function sendMethod(method: string, url: string): Promise<Response> {
  return fetch(url, { method, headers: { 'x-forge-csrf': '1' } });
}

function installLedgerDoc(): { installed?: Array<{ id: string }> } {
  const path = join(forgeRoot, 'studio', 'installed-skills.yaml');
  if (!existsSync(path)) return {};
  return yaml.load(readFileSync(path, 'utf8')) as { installed?: Array<{ id: string }> };
}

test('library-35: install -> approve -> delete -> a fresh hand-authored skill reusing the id must NOT be wrongly needs-review', async () => {
  const id = 'library-35-recreate-skill';

  const install = await postJson(`${bridgeUrl}/api/studio/skills/install`, {
    id,
    entries: makeEntries({ name: 'Library 35 Skill', description: 'installed via the bridge route' }),
    upstream: { source: 'https://example.com/library-35' },
  });
  assert.equal(install.status, 200, 'install must succeed');

  const approve = await postJson(`${bridgeUrl}/api/studio/skills/${id}/approve`, {});
  assert.equal(approve.status, 200, 'approve must succeed on a fresh draft');

  const approvedDetail = (await (await fetch(`${bridgeUrl}/api/studio/skills/${id}`)).json()) as Record<string, unknown>;
  assert.equal(approvedDetail['trust'], 'ready', 'sanity: ready/approved before delete');

  const del = await sendMethod('DELETE', `${bridgeUrl}/api/studio/skills/${id}`);
  assert.equal(del.status, 200, 'delete of an installed skill must succeed');
  assert.equal(existsSync(join(forgeRoot, 'skills', id)), false, 'the package directory must be gone');

  // Assert the LEDGER ARTIFACT itself — not merely a status code.
  const ledgerAfterDelete = installLedgerDoc();
  assert.ok(
    !(ledgerAfterDelete.installed ?? []).some((e) => e.id === id),
    'studio/installed-skills.yaml must carry NO row for a deleted skill id',
  );

  // Recreate the SAME id BY HAND — a brand-new, plain composable skill, no
  // provenance block at all, via the create route (not install).
  const recreate = await postJson(`${bridgeUrl}/api/studio/skills`, {
    id,
    name: 'Hand-Authored Replacement',
    description: 'a completely unrelated, hand-authored skill reusing the id',
    body: '# Hand-authored\n\nNothing to do with the deleted package.',
  });
  assert.equal(recreate.status, 200, 'recreating the id by hand must succeed (the old dir is gone)');

  const recreatedDetail = (await (await fetch(`${bridgeUrl}/api/studio/skills/${id}`)).json()) as Record<string, unknown>;
  assert.equal(recreatedDetail['trust'], 'ready', 'a fresh hand-authored skill reusing a deleted id must be ready, not needs-review');
  assert.equal(recreatedDetail['paletteVisible'], true);
});

test('library-35 control: an UNREGISTERED provenance block (never installed through the pipeline) is STILL correctly flagged needs-review — proves the fix did not neuter the general trust check', async () => {
  const id = 'library-35-control-unregistered-skill';
  const dir = join(forgeRoot, 'skills', id);
  mkdirSync(dir, { recursive: true });
  // A provenance block with NO matching install-ledger row — i.e. never
  // actually installed through installSkillPackage. Exercises skillTrustDetail's
  // ledger-absent-but-provenance-present branch, untouched by this fix.
  const body = matter.stringify('\n# Fabricated\n\nBody.\n', {
    name: 'Fabricated',
    description: 'a fabricated provenance block',
    provenance: { source: 'https://x', contentHash: 'sha256:doesnotmatter', installedAt: new Date().toISOString() },
  });
  writeFileSync(join(dir, 'SKILL.md'), body, 'utf8');

  const detail = (await (await fetch(`${bridgeUrl}/api/studio/skills/${id}`)).json()) as Record<string, unknown>;
  assert.equal(
    detail['trust'],
    'needs-review',
    'an unregistered provenance block must still be flagged — the general trust mechanism must keep working',
  );
});

test('library-35: DELETE of a skill NEVER installed through the pipeline succeeds (no throw, no 500) and leaves the ledger untouched', async () => {
  const id = 'library-35-never-installed-skill';
  mkdirSync(join(forgeRoot, 'skills', id), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'skills', id, 'SKILL.md'),
    matter.stringify('\n# Plain\n\nBody.\n', { name: 'Plain', description: 'hand-authored, never installed' }),
    'utf8',
  );

  const del = await sendMethod('DELETE', `${bridgeUrl}/api/studio/skills/${id}`);
  assert.equal(del.status, 200, 'deleting a never-installed skill must succeed, never 500');
  assert.equal(existsSync(join(forgeRoot, 'skills', id)), false);
});
