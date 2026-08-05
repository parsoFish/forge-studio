/**
 * ACCEPTANCE TESTS (must be RED until fixed) — bd `forge-wze` (P0): KB
 * containment defects, driven through the REAL bridge routes (`startBridge`),
 * mirroring the fixture idiom of cli/bridge-studio-write.test.ts and
 * cli/bridge-studio-flows.test.ts.
 *
 * Root cause: `orchestrator/brain-paths.ts::resolveKbBrainDir` resolves
 * `brain/<kbId>` (and its `brain/projects/<kbId>` fallback) with `resolve()`
 * + `existsSync()` — no `realpathSync`, no per-segment identity check, no
 * `nlink` check (see orchestrator/brain-paths-containment.test.ts for the
 * unit-level pins on that function directly). Downstream `kb-graph.ts` then
 * bare-`join()`s nested segments (`themes/`, `_raw/`, `_guidance/`,
 * `INDEX.md`, `profile.md`) off that unresolved dir. The bridge's own
 * lexical checks in cli/bridge-studio-kbs.ts (`resolve(base,id).startsWith(base
 * + sep)`) are on an UNRESOLVED path and can never fire for a slug-shaped id —
 * `resolve()` normalizes `..` before the comparison ever runs.
 *
 * Governing rule for every "leak" assertion below: the test plants a UNIQUE
 * secret marker string outside the forge root (or in a different real KB)
 * and asserts that marker does NOT appear anywhere in the response body. A
 * bare status-code check would pass identically for an unrelated 500, so
 * every escape here reads the response body and asserts on its content, and
 * (for writes) reads the OUTSIDE artifact's bytes/directory listing before
 * and after the request.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  linkSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// ---------------------------------------------------------------------------
// Global fixture: one shared bridge over one tmp forgeRoot, with every KB
// escape shape planted in `before()` (mirrors bridge-studio-flows.test.ts's
// single-fixture-block idiom). Symlink targets that must survive the whole
// file live in `outsideDirs`, cleaned up in `after()`.
// ---------------------------------------------------------------------------

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;
const outsideDirs: string[] = [];
let symlinksUnavailable = false;

function newOutsideDir(prefix: string): string {
  const d = tmp(prefix);
  outsideDirs.push(d);
  return d;
}

before(async () => {
  forgeRoot = tmp('bridge-kbs-containment-');

  // Minimal _queue + _logs required by startBridge / listRuns
  for (const state of ['in-flight', 'done', 'failed', 'pending', 'ready-for-review']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'brain'), { recursive: true });

  // ---- Shape (a): brain/evilkb -> outside dir (dir symlink, whole kb) -----
  const evilkbOutside = newOutsideDir('kb-evilkb-outside-');
  mkdirSync(join(evilkbOutside, 'themes'), { recursive: true });
  writeFileSync(join(evilkbOutside, 'kb.yaml'), 'id: evilkb\nname: Evil KB\nbinding: { kind: unique }\ndesc: d\n');
  writeFileSync(join(evilkbOutside, 'themes', 'leak.md'), '# Leak\n\nSECRET-MARKER-EVILKB-9f31a\n');
  try {
    symlinkSync(evilkbOutside, join(forgeRoot, 'brain', 'evilkb'), 'dir');
  } catch {
    symlinksUnavailable = true;
  }

  // ---- Shape (b): brain/testkb/ REAL, themes/ -> outside dir (nested) ----
  const testkbOutsideThemes = newOutsideDir('kb-testkb-outside-themes-');
  writeFileSync(
    join(testkbOutsideThemes, 'nested-leak.md'),
    '---\ntitle: "SECRET-MARKER-TESTKB-b27e4"\n---\n\nBody text.\n',
  );
  mkdirSync(join(forgeRoot, 'brain', 'testkb'), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'testkb', 'kb.yaml'), 'id: testkb\nname: Test KB\nbinding: { kind: unique }\ndesc: d\n');
  try {
    symlinkSync(testkbOutsideThemes, join(forgeRoot, 'brain', 'testkb', 'themes'), 'dir');
  } catch {
    symlinksUnavailable = true;
  }

  // ---- Shape (c): brain/guidkb/ REAL, _guidance/ -> outside dir (WRITE) ---
  const guidkbOutsideGuidance = newOutsideDir('kb-guidkb-outside-guidance-');
  mkdirSync(join(forgeRoot, 'brain', 'guidkb'), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'guidkb', 'kb.yaml'), 'id: guidkb\nname: Guid KB\nbinding: { kind: unique }\ndesc: d\n');
  try {
    symlinkSync(guidkbOutsideGuidance, join(forgeRoot, 'brain', 'guidkb', '_guidance'), 'dir');
  } catch {
    symlinksUnavailable = true;
  }

  // ---- Shape (d-file): brain/leafkb/ REAL, themes/planted.md -> outside file
  const leafkbOutsideFile = newOutsideDir('kb-leafkb-outside-file-');
  writeFileSync(join(leafkbOutsideFile, 'secret.md'), '# Planted\n\nSECRET-MARKER-LEAFKB-c88d2\n');
  mkdirSync(join(forgeRoot, 'brain', 'leafkb', 'themes'), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'leafkb', 'kb.yaml'), 'id: leafkb\nname: Leaf KB\nbinding: { kind: unique }\ndesc: d\n');
  try {
    symlinkSync(join(leafkbOutsideFile, 'secret.md'), join(forgeRoot, 'brain', 'leafkb', 'themes', 'planted.md'));
  } catch {
    symlinksUnavailable = true;
  }

  // ---- Shape (d-hardlink): brain/hlkb/ REAL, profile.md hardlinked to outside
  const hlkbOutside = newOutsideDir('kb-hlkb-outside-');
  writeFileSync(join(hlkbOutside, 'outside-profile.md'), 'OUTSIDE ORIGINAL BYTES — must not change.\n');
  mkdirSync(join(forgeRoot, 'brain', 'hlkb'), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'hlkb', 'kb.yaml'), 'id: hlkb\nname: HL KB\nbinding: { kind: unique }\ndesc: d\n');
  try {
    linkSync(join(hlkbOutside, 'outside-profile.md'), join(forgeRoot, 'brain', 'hlkb', 'profile.md'));
  } catch {
    // Cross-filesystem hardlink unavailable — leave profile.md absent; the
    // hardlink test below tolerates this by checking existence first.
  }

  // ---- Shape (d-dangling): brain/dangkb/ REAL, profile.md -> nonexistent ---
  const dangkbOutsideParent = newOutsideDir('kb-dangkb-outside-parent-');
  const dangkbTarget = join(dangkbOutsideParent, 'does-not-exist-yet.md');
  mkdirSync(join(forgeRoot, 'brain', 'dangkb'), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'dangkb', 'kb.yaml'), 'id: dangkb\nname: Dang KB\nbinding: { kind: unique }\ndesc: d\n');
  try {
    symlinkSync(dangkbTarget, join(forgeRoot, 'brain', 'dangkb', 'profile.md'));
  } catch {
    symlinksUnavailable = true;
  }

  // ---- Shape (d-cross-object): brain/evilalias -> brain/realkb (same root) --
  mkdirSync(join(forgeRoot, 'brain', 'realkb'), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'realkb', 'kb.yaml'), 'id: realkb\nname: Real KB\nbinding: { kind: unique }\ndesc: d\n');
  try {
    symlinkSync(join(forgeRoot, 'brain', 'realkb'), join(forgeRoot, 'brain', 'evilalias'), 'dir');
  } catch {
    symlinksUnavailable = true;
  }

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
  for (const d of outsideDirs) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function get(path: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`${bridgeUrl}${path}`);
  return { status: res.status, text: await res.text() };
}

async function post(path: string, body: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(`${bridgeUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

function skipIfNoSymlinks(t: { skip: (msg?: string) => void }): boolean {
  if (symlinksUnavailable) {
    t.skip('symlink creation unavailable in this environment');
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Shape (a): brain/evilkb -> outside dir (whole-KB dir symlink)
// ---------------------------------------------------------------------------

test('(a) RED: GET /api/studio/kbs/evilkb/nodes/leak leaks the outside secret through a dir-symlinked KB', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const { text } = await get('/api/studio/kbs/evilkb/nodes/leak');
  assert.ok(
    !text.includes('SECRET-MARKER-EVILKB-9f31a'),
    `the node-article response must NOT contain the outside secret — got: ${text}. resolveKbBrainDir resolves brain/evilkb via existsSync (which follows the symlink) and returns the UNRESOLVED path; kb-graph.ts then reads themes/leak.md straight through it.`,
  );
});

test('(a) accidental-pass (regression lock, NOT a containment pin): GET /api/studio/kbs/evilkb 404s — dirent-type filtering hides the symlinked top-level dir from loadKbDescriptors, it never reaches the vulnerable code', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  // ACCIDENT NAMED: bridge-studio-kbs.ts's loadKbDescriptors() -> subDirs()
  // calls `readdirSync(brainRoot, {withFileTypes:true}).filter(e =>
  // e.isDirectory())`. For a directory ENTRY that is itself a symlink,
  // Node's Dirent.isDirectory() reports false (it reflects the entry's own
  // d_type, DT_LNK, never the resolved target) — confirmed empirically in
  // this environment. So `evilkb` is silently excluded from the kb list, the
  // GET /:id route's `kbs.find(k => k.id === kbId)` never matches, and the
  // route 404s BEFORE ever calling getKbBackend()/buildGraph(). This is the
  // SAME accident already documented for discoverProjects() in
  // bridge-studio-write.test.ts (round 4) — it does not generalize to the
  // node-article route above (which bypasses loadKbDescriptors entirely via
  // getKbBackend -> resolveKbBrainDir, with no dirent-type check anywhere),
  // nor to any NESTED symlink (shapes b/c/d below, which live one level
  // below the dirent-filtered scan).
  const { status, text } = await get('/api/studio/kbs/evilkb');
  assert.equal(status, 404, `expected the accidental 404, got ${status}: ${text}`);
  assert.ok(!text.includes('SECRET-MARKER-EVILKB-9f31a'), 'no leak either way');
});

// ---------------------------------------------------------------------------
// Shape (b): brain/testkb/ REAL, themes/ -> outside dir (nested read)
// ---------------------------------------------------------------------------

test('(b) RED: GET /api/studio/kbs/testkb leaks an outside theme title through a nested themes/ dir symlink', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  // testkb itself is a REAL top-level dir (discovered fine by
  // loadKbDescriptors) — only the NESTED `themes/` segment is symlinked, so
  // the dirent-filter accident above does not apply here: buildKbGraph's
  // plain `readdirSync(themesDir)` (no {withFileTypes}, no isDirectory()
  // filter) transparently follows the symlink and reads the outside file.
  // The graph response never carries node BODY, so the secret is planted in
  // the theme's frontmatter TITLE (which the graph DOES carry) to prove the
  // leak lands in this endpoint's actual response.
  const { status, text } = await get('/api/studio/kbs/testkb');
  assert.equal(status, 200, `expected 200, got ${status}: ${text}`);
  assert.ok(
    !text.includes('SECRET-MARKER-TESTKB-b27e4'),
    `the kb graph response must NOT reflect an outside file's content — got: ${text}`,
  );
});

// ---------------------------------------------------------------------------
// Shape (c): brain/guidkb/ REAL, _guidance/ -> outside dir — THE HEADLINE
// WRITE REPRO. An arbitrary-file-write primitive via the guidance POST route.
// ---------------------------------------------------------------------------

test('(c) RED (headline repro): POST /api/studio/kbs/guidkb/guidance writes THROUGH the symlinked _guidance/ into the outside dir', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const guidkbOutsideGuidance = outsideDirs.find((d) => d.includes('kb-guidkb-outside-guidance-'))!;
  const before_ = readdirSync(guidkbOutsideGuidance).sort();

  const payload = 'ATTACKER-PAYLOAD-GUIDANCE-WRITE-71ac9';
  const { status } = await post('/api/studio/kbs/guidkb/guidance', { text: payload });

  const after_ = readdirSync(guidkbOutsideGuidance).sort();
  assert.deepEqual(
    after_,
    before_,
    `no new file may be created inside the outside directory the _guidance/ symlink points at — status was ${status}, before=${JSON.stringify(before_)}, after=${JSON.stringify(after_)}. Today: bridge-studio-kbs.ts's lexical path-guard (\`resolve(guidanceDir).startsWith(kbDir+sep)\`) is on the UNRESOLVED path and cannot detect that _guidance/ itself is a symlink; writeFileSync follows it straight through to the outside dir.`,
  );

  // Belt-and-suspenders: no file anywhere outside brain/ carries the payload.
  for (const f of after_) {
    const contents = readFileSync(join(guidkbOutsideGuidance, f), 'utf8');
    assert.ok(!contents.includes(payload), `no outside file may carry the attacker payload — found in ${f}`);
  }
});

// ---------------------------------------------------------------------------
// Shape (d-file): brain/leafkb/themes/planted.md -> outside secret file
// ---------------------------------------------------------------------------

test('(d-file) RED: GET /api/studio/kbs/leafkb/nodes/planted leaks the outside file BODY through a symlinked leaf file', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const { status, text } = await get('/api/studio/kbs/leafkb/nodes/planted');
  assert.equal(status, 200, `expected 200, got ${status}: ${text}`);
  assert.ok(
    !text.includes('SECRET-MARKER-LEAFKB-c88d2'),
    `the node-article response body must NOT contain the outside file's content — got: ${text}. getKbNodeArticle's filePath = join(kbDir,'themes','planted.md') is read with readFileSync, which follows the symlinked leaf transparently.`,
  );
});

// ---------------------------------------------------------------------------
// Shape (d-hardlink): brain/hlkb/profile.md hardlinked to an outside file —
// POST bootstrap only writes profile.md when ABSENT.
// ---------------------------------------------------------------------------

test('(d-hardlink) accidental-pass (regression lock, NOT a containment pin): POST bootstrap on a hardlinked profile.md leaves the outside file byte-unchanged', async (t) => {
  const hlkbOutside = outsideDirs.find((d) => d.includes('kb-hlkb-outside-'))!;
  const outsideFile = join(hlkbOutside, 'outside-profile.md');
  if (!existsSync(join(forgeRoot, 'brain', 'hlkb', 'profile.md'))) {
    t.skip('hardlink creation (linkSync) unavailable in this environment (EXDEV or unsupported)');
    return;
  }
  const originalBytes = readFileSync(outsideFile, 'utf8');

  // ACCIDENT NAMED: bootstrap's route (cli/bridge-studio-kbs.ts) only writes
  // profile.md when `!existsSync(profilePath)` — i.e. it is a create-only,
  // never-overwrite operation BY DESIGN (seed a brand-new brain with a
  // starting point). A hardlinked profile.md is, to `existsSync`, simply "a
  // file that is already there" — indistinguishable from an ordinary
  // pre-existing profile.md. The write is skipped for that reason, not
  // because any hardlink-specific guard fired. This is NOT the same safety
  // studio-path-guard.ts's `nlink !== 1` check provides (which rejects
  // hardlinks explicitly, on both create AND edit); it is a coincidence of
  // this ONE route's create-only semantics, so it is kept as a regression
  // lock, not claimed as a fix for the hardlink escape shape in general.
  const { status } = await post('/api/studio/kbs/hlkb/bootstrap', { name: 'HL KB', summary: 'x' });
  assert.equal(status, 200, `expected bootstrap to 200 (it always succeeds, just skips the write)`);

  const afterBytes = readFileSync(outsideFile, 'utf8');
  assert.equal(afterBytes, originalBytes, 'the outside file (shared inode via hardlink) must be byte-unchanged');
});

// ---------------------------------------------------------------------------
// Shape (d-dangling): brain/dangkb/profile.md -> a NON-existent outside path.
// POST bootstrap's `writeFileSync` follows the dangling symlink through
// O_CREAT and creates a brand-new file at the attacker-chosen outside path.
// ---------------------------------------------------------------------------

test('(d-dangling) RED: POST /api/studio/kbs/dangkb/bootstrap creates a file at an attacker-chosen outside path via a dangling symlink', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const dangkbOutsideParent = outsideDirs.find((d) => d.includes('kb-dangkb-outside-parent-'))!;
  const targetPath = join(dangkbOutsideParent, 'does-not-exist-yet.md');
  assert.ok(!existsSync(targetPath), 'sanity: the dangling symlink target must not exist before the request');

  const { status } = await post('/api/studio/kbs/dangkb/bootstrap', { name: 'Dang KB', summary: 'x' });
  assert.equal(status, 200, `expected bootstrap to report 200 either way`);

  assert.ok(
    !existsSync(targetPath),
    `no file may be created at the dangling symlink's outside target — but it now exists: ${existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : ''}. Today: \`existsSync(profilePath)\` returns false for a DANGLING symlink (the target is absent), so the route takes the create branch; \`writeFileSync\` opens with O_CREAT and the OS follows the symlink chain, creating a brand-new file at the attacker-chosen outside path.`,
  );
});

// ---------------------------------------------------------------------------
// Shape (d-cross-object): brain/evilalias -> brain/realkb (SAME root, real kb)
// ---------------------------------------------------------------------------

test('(d-cross-object) accidental-pass (regression lock, NOT a containment pin): POST guidance on evilalias does not write into realkb\'s _guidance/', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  // ACCIDENT NAMED: identical dirent-type-filtering accident as shape (a) —
  // `evilalias` is itself a symlinked top-level directory entry, so
  // loadKbDescriptors' subDirs() filter (`e.isDirectory()` false for a
  // symlink) excludes it; the guidance route's `kbs.find(k => k.id ===
  // 'evilalias')` never matches and it 404s before the (also-vulnerable)
  // lexical _guidance path-guard is ever reached. A plain "is the resolved
  // path under brain/" check would NOT have caught this (it genuinely is,
  // since evilalias resolves inside realkb which is inside brain/) — what
  // actually blocks it here is an unrelated directory-listing accident, not
  // any identity check.
  const realkbGuidanceDir = join(forgeRoot, 'brain', 'realkb', '_guidance');
  const before_ = existsSync(realkbGuidanceDir) ? readdirSync(realkbGuidanceDir).sort() : [];

  const { status, text } = await post('/api/studio/kbs/evilalias/guidance', { text: 'cross-object payload' });
  assert.equal(status, 404, `expected the accidental 404 (unknown kb: evilalias), got ${status}: ${text}`);

  const after_ = existsSync(realkbGuidanceDir) ? readdirSync(realkbGuidanceDir).sort() : [];
  assert.deepEqual(after_, before_, "realkb's _guidance/ must be untouched");
});

// ---------------------------------------------------------------------------
// `..`-normalization across the KB routes — a regression lock on the FIRST
// layer (SLUG_RE), not a containment pin (this layer is already closed).
// ---------------------------------------------------------------------------

test('".."-normalization: raw and percent-encoded ".." ids are rejected (400) on every KB route, nothing outside brain/ changes', async () => {
  // This is a lock on SLUG_RE (the FIRST layer), not on containment — a slug
  // that fails SLUG_RE never reaches the vulnerable resolveKbBrainDir code
  // at all. It is included so a future change to SLUG_RE cannot silently
  // reopen path-traversal-shaped ids without a failing test.
  const traversalIds = ['..%2Fevil', '..%2F..%2Fetc', encodeURIComponent('../../../../etc/passwd')];
  const brainListingBefore = readdirSync(join(forgeRoot, 'brain')).sort();

  for (const id of traversalIds) {
    const getKb = await get(`/api/studio/kbs/${id}`);
    assert.ok(getKb.status === 400 || getKb.status === 404, `GET /kbs/${id}: expected 400/404, got ${getKb.status}`);

    const getNode = await get(`/api/studio/kbs/${id}/nodes/x`);
    assert.ok(getNode.status === 400 || getNode.status === 404, `GET /kbs/${id}/nodes/x: expected 400/404, got ${getNode.status}`);

    const guidance = await post(`/api/studio/kbs/${id}/guidance`, { text: 'x' });
    assert.equal(guidance.status, 400, `POST /kbs/${id}/guidance: expected 400, got ${guidance.status}`);

    const bootstrap = await post(`/api/studio/kbs/${id}/bootstrap`, {});
    assert.ok(bootstrap.status === 400 || bootstrap.status === 404, `POST /kbs/${id}/bootstrap: expected 400/404, got ${bootstrap.status}`);

    const maintenance = await post(`/api/studio/kbs/${id}/maintenance`, { op: 'lint' });
    assert.equal(maintenance.status, 400, `POST /kbs/${id}/maintenance: expected 400, got ${maintenance.status}`);
  }

  const brainListingAfter = readdirSync(join(forgeRoot, 'brain')).sort();
  assert.deepEqual(brainListingAfter, brainListingBefore, 'brain/ top-level listing must be unchanged');
});
