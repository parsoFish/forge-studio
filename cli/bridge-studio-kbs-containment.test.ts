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

test('(d-file) FIXED (amendment round): GET /api/studio/kbs/leafkb/nodes/planted no longer leaks — the symlinked leaf never enters the graph, and the 404 is indistinguishable from a genuinely unknown node', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  // kb-graph.ts now resolves every nested file (themes/<f>, _raw/<f>,
  // _guidance/<f>, INDEX.md) through guardedKbPath() -> resolveGuardedPath's
  // per-segment identity check (bd `forge-wze` fix). A symlinked
  // themes/planted.md fails that identity check, so it is silently excluded
  // from `themeFiles` at graph-build time — the node simply never exists,
  // rather than existing-but-then-being-read-through. The property that
  // matters is not just "no leak" but that an attacker cannot even
  // distinguish "a symlinked leaf was excluded" from "no such node was ever
  // planted" — so this asserts full indistinguishability against a request
  // for a node id that was never planted at all.
  const plantedId = 'planted';
  const neverExistedId = 'totally-unplanted-node-xyz';
  const planted = await get(`/api/studio/kbs/leafkb/nodes/${plantedId}`);
  const neverExisted = await get(`/api/studio/kbs/leafkb/nodes/${neverExistedId}`);

  assert.equal(planted.status, 404, `expected the symlinked leaf to read as "no such node", got ${planted.status}: ${planted.text}`);
  assert.ok(!planted.text.includes('SECRET-MARKER-LEAFKB-c88d2'), `the response must NOT contain the outside file's content — got: ${planted.text}`);
  assert.equal(planted.status, neverExisted.status, 'the symlinked-leaf 404 must carry the SAME status as a genuinely unknown node');
  // The bodies necessarily differ in the ECHOED id (both routes report
  // "unknown node: <the id you asked for>", which is universal, expected
  // behavior for ANY 404 route and not itself a side channel) — the
  // indistinguishability property is that BOTH follow the exact same
  // "unknown node: <id>" template with nothing else appended, so normalize
  // the id out of each body before comparing.
  const normalize = (text: string, id: string): string => text.split(id).join('<id>');
  assert.equal(
    normalize(planted.text, plantedId),
    normalize(neverExisted.text, neverExistedId),
    'the symlinked-leaf 404 must carry the SAME body TEMPLATE as a genuinely unknown node (modulo the echoed id) — no side-channel distinguishing "excluded for containment" from "never existed"',
  );
});

// ---------------------------------------------------------------------------
// Shape (d-hardlink): brain/hlkb/profile.md hardlinked to an outside file —
// POST bootstrap only writes profile.md when ABSENT.
// ---------------------------------------------------------------------------

test('(d-hardlink) FIXED (amendment round): POST bootstrap on a hardlinked profile.md is now rejected by containment itself, not by the create-only accident', async (t) => {
  const hlkbOutside = outsideDirs.find((d) => d.includes('kb-hlkb-outside-'))!;
  const outsideFile = join(hlkbOutside, 'outside-profile.md');
  if (!existsSync(join(forgeRoot, 'brain', 'hlkb', 'profile.md'))) {
    t.skip('hardlink creation (linkSync) unavailable in this environment (EXDEV or unsupported)');
    return;
  }
  const originalBytes = readFileSync(outsideFile, 'utf8');

  // STALE COMMENT SUPERSEDED (amendment round): the previous comment here
  // named an ACCIDENT — bootstrap's create-only `!existsSync(profilePath)`
  // semantics happened to skip the write regardless of what already occupied
  // the slot. That is no longer the operative mechanism. The bootstrap route
  // now resolves profile.md through a guarded tail-path helper
  // (cli/bridge-studio-kbs.ts's `guardKbTail`, wrapping
  // cli/studio-path-guard.ts's `resolveGuardedPath`), whose leaf check
  // rejects a hardlinked file outright (`nlink !== 1`) BEFORE the
  // exists/create branch is even reached — the request 400s. This is now a
  // genuine containment pin, not a coincidence of route semantics.
  const { status, text } = await post('/api/studio/kbs/hlkb/bootstrap', { name: 'HL KB', summary: 'x' });
  assert.equal(status, 400, `expected the hardlinked profile.md to be rejected outright (400), got ${status}: ${text}`);

  const afterBytes = readFileSync(outsideFile, 'utf8');
  assert.equal(afterBytes, originalBytes, 'the outside file (shared inode via hardlink) must be byte-unchanged');
});

// ---------------------------------------------------------------------------
// Shape (d-dangling): brain/dangkb/profile.md -> a NON-existent outside path.
// POST bootstrap's `writeFileSync` follows the dangling symlink through
// O_CREAT and creates a brand-new file at the attacker-chosen outside path.
// ---------------------------------------------------------------------------

test('(d-dangling) FIXED (amendment round): POST /api/studio/kbs/dangkb/bootstrap no longer creates a file at the dangling symlink\'s outside target', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const dangkbOutsideParent = outsideDirs.find((d) => d.includes('kb-dangkb-outside-parent-'))!;
  const targetPath = join(dangkbOutsideParent, 'does-not-exist-yet.md');
  assert.ok(!existsSync(targetPath), 'sanity: the dangling symlink target must not exist before the request');

  // The bootstrap route now resolves profile.md through guardKbTail() ->
  // resolveGuardedPath, whose existence probe is lstat-based: a dangling
  // symlink counts as "there" and is routed into the realpath check (which
  // throws, since the target is absent) rather than mistaken for a free
  // creation slot — the guard rejects with 400 before writeFileSync ever runs.
  const { status, text } = await post('/api/studio/kbs/dangkb/bootstrap', { name: 'Dang KB', summary: 'x' });
  assert.equal(status, 400, `expected the dangling symlink to be rejected outright (400), got ${status}: ${text}`);

  assert.ok(
    !existsSync(targetPath),
    `no file may be created at the dangling symlink's outside target — but it now exists: ${existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : ''}`,
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

// ---------------------------------------------------------------------------
// ROUND 3 (2026-08-06, guard-attack round, Finding 1, MAJOR, live content
// disclosure): GET /api/studio/kbs (the LIST route) leaks through a
// symlinked/hardlinked kb.yaml LEAF.
//
// cli/bridge-studio-kbs.ts:87-116 — `loadKbDescriptors()`/`pushFrom()` does
// `existsSync(kbYamlPath)` + `loadKbDescriptor(kbYamlPath)` with NO guard at
// all. This function was never touched by the `resolveKbBrainDir` fix (which
// only covers the single-kb GET/:id, DELETE, guidance, and bootstrap routes,
// via `resolveGuardedPath`) — the LIST route walks brain/ independently and
// reads straight through a symlinked/hardlinked kb.yaml.
//
// Each test below plants its OWN `forgeRoot/brain/<id>/` directory — a
// genuinely real directory, NOT itself a symlink, so the dirent-type-filter
// accident that hides a whole-dir symlink from this same list route (see
// shape (a) above) does NOT apply here — with a kb.yaml LEAF that is a
// symlink/hardlink to an outside file. Self-contained (own tmp dirs, cleaned
// up in a `finally`) — no dependency on the shared before()/after() fixture
// above, so these are safe to run in isolation with `--test-name-pattern`.
// ---------------------------------------------------------------------------

test('(e) RED [Finding 1]: GET /api/studio/kbs leaks a secret through a SYMLINKED kb.yaml LEAF under brain/<id>', async (t) => {
  const outside = tmp('kb-list-leafyaml-outside-');
  const kbDir = join(forgeRoot, 'brain', 'leafyamlkb');
  try {
    writeFileSync(
      join(outside, 'kb.yaml'),
      'id: leafyamlkb\nname: "SECRET-MARKER-LEAFYAMLKB-d41e9"\nbinding: { kind: unique }\ndesc: "SECRET-DESC-LEAFYAMLKB-7a2f0"\n',
    );
    mkdirSync(kbDir, { recursive: true });
    try {
      symlinkSync(join(outside, 'kb.yaml'), join(kbDir, 'kb.yaml'));
    } catch {
      t.skip('symlink creation unavailable in this environment');
      return;
    }

    const { status, text } = await get('/api/studio/kbs');
    assert.equal(status, 200, `expected 200, got ${status}: ${text}`);
    assert.ok(
      !text.includes('SECRET-MARKER-LEAFYAMLKB-d41e9'),
      `the kb LIST response must NOT contain the outside kb.yaml's "name" field — got: ${text}. brain/leafyamlkb/ is a genuinely real directory; only the kb.yaml LEAF is symlinked, and loadKbDescriptors()'s pushFrom() reads straight through it with no guard.`,
    );
    assert.ok(
      !text.includes('SECRET-DESC-LEAFYAMLKB-7a2f0'),
      `the kb LIST response must NOT contain the outside kb.yaml's "desc" field — got: ${text}`,
    );
  } finally {
    rmSync(kbDir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('(f) RED [Finding 1]: GET /api/studio/kbs leaks a secret through a HARDLINKED kb.yaml LEAF under brain/<id>', async (t) => {
  const outside = tmp('kb-list-hlyaml-outside-');
  const kbDir = join(forgeRoot, 'brain', 'hlyamlkb');
  try {
    writeFileSync(
      join(outside, 'outside-kb.yaml'),
      'id: hlyamlkb\nname: "SECRET-MARKER-HLYAMLKB-3c9d1"\nbinding: { kind: unique }\ndesc: "SECRET-DESC-HLYAMLKB-06b4e"\n',
    );
    mkdirSync(kbDir, { recursive: true });
    try {
      linkSync(join(outside, 'outside-kb.yaml'), join(kbDir, 'kb.yaml'));
    } catch {
      t.skip('hardlink creation (linkSync) unavailable in this environment (EXDEV or unsupported)');
      return;
    }

    const { status, text } = await get('/api/studio/kbs');
    assert.equal(status, 200, `expected 200, got ${status}: ${text}`);
    assert.ok(
      !text.includes('SECRET-MARKER-HLYAMLKB-3c9d1'),
      `the kb LIST response must NOT leak through a hardlinked kb.yaml — got: ${text}. realpathSync is structurally blind to hardlinks (nothing to resolve); loadKbDescriptors() has no realpath/nlink check at all here.`,
    );
    assert.ok(
      !text.includes('SECRET-DESC-HLYAMLKB-06b4e'),
      `the kb LIST response must NOT leak the outside "desc" via the hardlink — got: ${text}`,
    );
  } finally {
    rmSync(kbDir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('(g) RED [Finding 1]: GET /api/studio/kbs leaks a secret through a symlinked kb.yaml LEAF under the brain/projects/<id> FALLBACK root', async (t) => {
  const outside = tmp('kb-list-leafproj-outside-');
  const kbDir = join(forgeRoot, 'brain', 'projects', 'leafprojkb');
  try {
    writeFileSync(
      join(outside, 'kb.yaml'),
      'id: leafprojkb\nname: "SECRET-MARKER-LEAFPROJKB-9e21b"\nbinding: { kind: unique }\ndesc: "SECRET-DESC-LEAFPROJKB-4f7a3"\n',
    );
    mkdirSync(kbDir, { recursive: true });
    try {
      symlinkSync(join(outside, 'kb.yaml'), join(kbDir, 'kb.yaml'));
    } catch {
      t.skip('symlink creation unavailable in this environment');
      return;
    }

    const { status, text } = await get('/api/studio/kbs');
    assert.equal(status, 200, `expected 200, got ${status}: ${text}`);
    assert.ok(
      !text.includes('SECRET-MARKER-LEAFPROJKB-9e21b'),
      `the kb LIST response must NOT leak through brain/projects/<id>/kb.yaml — the SECOND containment root (ADR 035 per-project brains) — got: ${text}. A fix that only guards the brain/<id> loop and forgets the brain/projects/<id> loop leaves this hole open.`,
    );
    assert.ok(
      !text.includes('SECRET-DESC-LEAFPROJKB-4f7a3'),
      `the kb LIST response must NOT leak the outside "desc" via brain/projects/<id> — got: ${text}`,
    );
  } finally {
    rmSync(kbDir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('(h) non-regression [Finding 1]: a legitimate, fully-real KB still appears in GET /api/studio/kbs with correct layer counts', async () => {
  const kbDir = join(forgeRoot, 'brain', 'goodkb');
  try {
    mkdirSync(join(kbDir, 'themes'), { recursive: true });
    mkdirSync(join(kbDir, '_raw'), { recursive: true });
    writeFileSync(join(kbDir, 'kb.yaml'), 'id: goodkb\nname: Good KB\nbinding: { kind: unique }\ndesc: a genuinely real kb\n');
    writeFileSync(join(kbDir, 'INDEX.md'), '# Good KB Index\n');
    writeFileSync(join(kbDir, 'themes', 'theme-one.md'), '# Theme One\n');
    writeFileSync(join(kbDir, 'themes', 'theme-two.md'), '# Theme Two\n');
    writeFileSync(join(kbDir, '_raw', 'raw-one.md'), '# Raw One\n');

    const { status, text } = await get('/api/studio/kbs');
    assert.equal(status, 200, `expected 200, got ${status}: ${text}`);
    const body = JSON.parse(text) as { kbs: Array<{ id: string; name: string; counts: { index: number; themes: number; raw: number } }> };
    const goodkb = body.kbs.find((k) => k.id === 'goodkb');
    assert.ok(goodkb, `expected "goodkb" to appear in the kb list — got ids: ${body.kbs.map((k) => k.id).join(', ')}`);
    assert.equal(goodkb!.name, 'Good KB', "the real kb's name must round-trip correctly");
    assert.deepEqual(
      goodkb!.counts,
      { index: 1, themes: 2, raw: 1 },
      `the fix must not break layer counts for a genuinely real KB — got ${JSON.stringify(goodkb!.counts)}`,
    );
  } finally {
    rmSync(kbDir, { recursive: true, force: true });
  }
});
