/**
 * Acceptance tests for the kb-cleanup session's two new bridge routes
 * (R4-19-F2 — the `kb-cleanup` interactive session kind, ADR-043 §1/§3):
 *
 *   POST /api/studio/kbs/:id/cleanup/start
 *   POST /api/studio/kbs/:id/cleanup/apply {project, sessionId}
 *
 * Neither route exists yet — this file is RED at branch base (every
 * assertion below fails against a 404 fallthrough on the un-added routes;
 * `startBridge` itself exists today, so this is NOT a module-not-found red
 * — mirrors `cli/ui-bridge-onboarding-start.test.ts`'s own header note for
 * the identical situation).
 *
 * Mirrors `POST /api/studio/authoring/start` (`cli/ui-bridge-authoring-
 * start.test.ts`) and the KB-create hand-off (`cli/bridge-studio-kbs.ts`
 * ~:1189) for the session-anchor shape: a project-bound KB anchors its
 * cleanup session under the real project (`<projectsRoot>/<ref>/`); every
 * OTHER binding kind anchors under the dot-prefixed KB-seeding anchor
 * (`<projectsRoot>/.kb-<id>/`) so `discoverProjects` never surfaces a
 * phantom project for it.
 *
 * DESIGN CALLS this file makes explicit (task brief left them open —
 * report to the implementer, not silently resolved):
 *   - The start route's `findings` are asserted to be a real, non-fabricated
 *     array reflecting an ACTUAL on-disk lint defect (a theme file missing a
 *     required frontmatter field) — never a hardcoded shape. The EXACT
 *     scoping mechanism (`runBrainLint`+`scopeFindingsToKb` vs.
 *     `lintThemeFiles`+`listOwnThemeFiles` vs. something new) is an
 *     implementation choice this file does not dictate.
 *   - The apply route's exact request/response shape beyond `{project,
 *     sessionId}` -> `{ok:true}` and the phase transition is not over-
 *     specified; classification of its dry-bridge row is pinned separately
 *     in `cli/dry-bridge-coverage.test.ts` (deliberately without hardcoding
 *     WHICH classification — see that file's own comment).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';

import { startBridge } from './ui-bridge.ts';
import { KB_SEEDING_ANCHOR_PREFIX } from './bridge-studio-kbs.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-kb-cleanup-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });

  process.env.FORGE_DRY_BRIDGE = '1';
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  delete process.env.FORGE_DRY_BRIDGE;
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Writes a minimal, real `brain/<id>/kb.yaml` (+ themes/ + _raw/) directly
 *  on disk — mirrors `cli/bridge-studio-kb-seeding-pins.test.ts`'s own
 *  `CYCLES_KB_YAML`/`FORGE_DEV_KB_YAML` fixture idiom, never manufactured
 *  through a route. `bindingYaml` is the raw flow-style YAML for the
 *  `binding:` field, e.g. `{ kind: project, ref: demoproj }` or
 *  `{ kind: unique }`. */
function writeKb(id: string, bindingYaml: string): void {
  const dir = join(forgeRoot, 'brain', id);
  mkdirSync(join(dir, 'themes'), { recursive: true });
  mkdirSync(join(dir, '_raw'), { recursive: true });
  writeFileSync(join(dir, 'kb.yaml'), `id: ${id}\nname: Fixture KB ${id}\nbinding: ${bindingYaml}\ndesc: A fixture KB for kb-cleanup route tests.\n`, 'utf8');
}

/** Plants a theme file under `brain/<kbId>/themes/` that is missing the
 *  required `description` frontmatter field — a REAL, detectable
 *  `checkFrontmatter`-shaped defect (cli/brain-lint.ts's
 *  REQUIRED_FRONTMATTER_FIELDS), not a fabricated finding. */
function writeBrokenTheme(kbId: string, filename = 'broken.md'): string {
  const themesDir = join(forgeRoot, 'brain', kbId, 'themes');
  mkdirSync(themesDir, { recursive: true });
  const abs = join(themesDir, filename);
  writeFileSync(
    abs,
    ['---', 'title: Broken Theme', 'category: pattern', 'created_at: "2026-01-01"', 'updated_at: "2026-01-01"', '---', '# Broken Theme', '', 'Body text with no description field in frontmatter.', ''].join('\n'),
    'utf8',
  );
  return abs;
}

/** Recursively snapshot a directory as a sorted list of relative file paths
 *  — for asserting "nothing new was written" without caring about content. */
function snapshotFileList(dir: string): string[] {
  const out: string[] = [];
  function walk(current: string, rel: string): void {
    if (!existsSync(current)) return;
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = join(current, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, relPath);
      else out.push(relPath);
    }
  }
  walk(dir, '');
  return out;
}

function start(kbId: string): Promise<Response> {
  return fetch(`${url}/api/studio/kbs/${encodeURIComponent(kbId)}/cleanup/start`, { method: 'POST', headers: CSRF, body: '{}' });
}

function startWithBody(kbId: string, body: unknown): Promise<Response> {
  return fetch(`${url}/api/studio/kbs/${encodeURIComponent(kbId)}/cleanup/start`, { method: 'POST', headers: CSRF, body: JSON.stringify(body) });
}

/**
 * DEFECT FIX (this file's own AT-1 was originally written with `fetch()`,
 * which cannot deliver a literal ".." path segment to the server at all: the
 * WHATWG URL Standard's "shorten a URL's path" step removes a double-dot
 * path segment CLIENT-SIDE, before the request ever leaves the process — so
 * `fetch('${url}/api/studio/kbs/../cleanup/start')` is actually sent as a
 * request for `/api/studio/cleanup/start` (three segments collapse to one:
 * `kbs`, then `..`, cancel each other out). That collapsed path has no `kbs`
 * segment at all, so the real
 * `/^\/api\/studio\/kbs\/([^/]+)\/cleanup\/start$/` route (cli/ui-bridge.ts)
 * can never match it — no server-side implementation could ever satisfy an
 * assertion against that shape, because the request the assertion actually
 * probes is a DIFFERENT, unrelated path. This is the exact "client-side
 * normalization masks a server-side hole" class this repo has already fixed
 * once for GET (`cli/ui-bridge-agent-history.test.ts`'s "D5 (ROUND 4, RAW
 * WIRE)" `rawGet`) and once for POST
 * (`cli/ui-bridge-demo-generations.test.ts`'s `rawPostBody`) — this is the
 * SAME fix for THIS route, copied locally (neither sibling file exports its
 * helper, and this file is scoped to leave both siblings' own assertions
 * untouched).
 *
 * The WHATWG URL spec defines a "double-dot URL path segment" as ".." OR any
 * ASCII-case-insensitive match for ".%2e", "%2e.", or "%2e%2e" — so
 * `%2e%2e` is collapsed by fetch() JUST AS thoroughly as the literal `..`;
 * probing only the literal form would leave the percent-encoded bypass shape
 * completely untested. Both variants are asserted below.
 *
 * Node's low-level `http.request({ path })` places the `path` option
 * directly onto the request line with NO normalization of any kind — no
 * WHATWG URL parsing, no dot-segment removal, no percent-decoding — so it is
 * the only client that can actually ask the real route this question. DO NOT
 * "simplify" this back to `fetch()`: doing so silently stops testing the
 * real route (fetch() cannot reach it for either probed shape), which would
 * make the test pass — or not even compile a meaningful request — for the
 * wrong reason.
 */
function rawPost(rawPath: string, bodyText = '{}'): Promise<{ status: number; text: string }> {
  return new Promise((resolvePromise, reject) => {
    const u = new URL(url);
    const req = httpRequest(
      {
        hostname: u.hostname,
        port: u.port,
        path: rawPath,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forge-csrf': '1', 'content-length': Buffer.byteLength(bodyText) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString('utf8'); });
        res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, text: data }));
      },
    );
    req.on('error', reject);
    req.end(bodyText);
  });
}

function apply(kbId: string, body: unknown): Promise<Response> {
  return fetch(`${url}/api/studio/kbs/${encodeURIComponent(kbId)}/cleanup/apply`, { method: 'POST', headers: CSRF, body: JSON.stringify(body) });
}

type CleanupStatus = {
  session_id: string;
  project: string;
  phase: string;
  kb_id: string;
  kb_binding: unknown;
  findings: unknown[];
  updated_at: string;
};

// ---------------------------------------------------------------------------
// POST /api/studio/kbs/:id/cleanup/start — validation
// ---------------------------------------------------------------------------

// Kills: a route that skips slug validation on the kb id and lets a
// traversal/control-char id reach a filesystem call. REWRITTEN over the raw
// wire (see `rawPost`'s own doc comment above) — the original fetch()-based
// version tested an unreachable path shape and could never have been
// satisfied by any implementation. Also strengthened per the task brief: the
// ARTIFACT is proven (a canary file's bytes + a plausible escape-target
// directory's absence), not just the status code, and the "%2e%2e"
// percent-encoded double-dot segment is probed alongside the literal one —
// that shape is ALSO invisible to fetch(), for the identical WHATWG-spec
// reason, and is exactly why the wire-level test exists rather than a single
// literal-".." probe.
test('AT-1 (RAW WIRE — a fetch()-delivered ".." cannot reach this route at all, see rawPost doc comment): the literal ".." kb id AND its "%2e%2e" percent-encoded equivalent both -> 400 "invalid kb id" (the route\'s FIRST check, cli/ui-bridge.ts\'s kbCleanupStartMatch handler validates SLUG_RE before any KB lookup or fs write), and NO directory or file is created anywhere outside forgeRoot\'s pre-existing state', async () => {
  // Canary #1: a file OUTSIDE any kb-cleanup-related path, at forgeRoot's
  // own top level. Content (not just presence) must be byte-identical
  // afterwards — a filename-list snapshot alone would miss an in-place
  // overwrite of a pre-existing file at a colliding path.
  const canaryPath = join(forgeRoot, 'CANARY-ROOT-OUTSIDE-KB-CLEANUP.txt');
  const canaryContent = 'SENTINEL-kb-cleanup-at1-canary-must-never-change';
  writeFileSync(canaryPath, canaryContent, 'utf8');

  // Canary #2: the concrete, plausible escape TARGET. The real route joins
  // `sessionProject` (resolved from a genuine KB lookup) under
  // `<forgeRoot>/projects/<sessionProject>/_kb-cleanup/<sid>`. An
  // implementation that instead used the RAW, request-derived kb id AS
  // `sessionProject` before ever validating or resolving it would land
  // `join(projectsRoot, '..', '_kb-cleanup', sid)` — i.e. `..` from
  // `<forgeRoot>/projects/` resolves to `<forgeRoot>` itself, so a
  // `_kb-cleanup/` directory appearing directly under forgeRoot (one level
  // above `projects/`) is that specific wrong implementation's exact,
  // detectable on-disk signature.
  const escapeTargetDir = join(forgeRoot, '_kb-cleanup');
  assert.ok(!existsSync(escapeTargetDir), 'arrange: the plausible escape-target dir must not pre-exist');

  const before = snapshotFileList(forgeRoot);

  const literal = await rawPost('/api/studio/kbs/../cleanup/start');
  assert.equal(literal.status, 400, `expected 400 for the raw, un-normalized ".." kb id delivered over the real wire, got ${literal.status}: ${literal.text}`);
  assert.match(literal.text, /invalid kb id/, `expected the SLUG_RE validation's own error message — the FIRST check in the route, before any KB lookup or fs write — got: ${literal.text}`);

  const percentEncoded = await rawPost('/api/studio/kbs/%2e%2e/cleanup/start');
  assert.equal(percentEncoded.status, 400, `expected the "%2e%2e" percent-encoded double-dot segment to be rejected IDENTICALLY to the literal ".." — both decodeURIComponent to the same string before SLUG_RE ever inspects them — got ${percentEncoded.status}: ${percentEncoded.text}`);
  assert.equal(percentEncoded.text, literal.text, 'the percent-encoded and literal traversal shapes must produce a byte-identical response body (both take the exact same decodeURIComponent -> SLUG_RE path in the real handler)');

  assert.deepEqual(snapshotFileList(forgeRoot), before, 'a rejected request must create nothing on disk anywhere under forgeRoot — the ARTIFACT, not merely the status code');
  assert.ok(!existsSync(escapeTargetDir), 'the plausible escape-target dir must still be absent after both probes — proves the traversal never reached a path join');
  assert.equal(readFileSync(canaryPath, 'utf8'), canaryContent, 'the canary file outside any kb-cleanup path must be byte-unchanged after both probes');
});

// Kills: a route that 200s (or 500s) instead of a clean 404 for a
// well-formed but non-existent kb id.
test('AT-2: unknown (but well-formed) kb id -> 404', async () => {
  const res = await start('no-such-kb-at-all');
  assert.equal(res.status, 404, `expected 404, got ${res.status}: ${await res.text()}`);
});

// ---------------------------------------------------------------------------
// POST /api/studio/kbs/:id/cleanup/start — happy path, project-bound anchor
// ---------------------------------------------------------------------------

// Kills: a route that anchors the session anywhere other than the KB's OWN
// bound project (e.g. hardcoding `.kb-<id>` regardless of binding kind, or
// dropping kb_id/kb_binding/findings from status.json — the declared-data-
// fails-open shape this campaign keeps finding).
test('AT-3: a project-bound KB\'s start route resolves the session anchor to the REAL bound project (mirrors the KB-create hand-off, cli/bridge-studio-kbs.ts ~:1189) — 200, server-generated sessionId, status.json at <project>/_kb-cleanup/<sid>/ with phase:drafting + kb_id + kb_binding + findings array, dry-bridge marker present', async () => {
  writeKb('proj-bound-cleanup-kb', '{ kind: project, ref: demoproj }');
  mkdirSync(join(forgeRoot, 'projects', 'demoproj'), { recursive: true });

  const res = await start('proj-bound-cleanup-kb');
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { ok: boolean; sessionId: string; dryBridge?: { skipped: string[] } };
  assert.equal(body.ok, true);
  assert.ok(typeof body.sessionId === 'string' && body.sessionId.length > 0, 'sessionId must be server-generated and present');
  assert.ok(body.dryBridge, `expected a dryBridge marker on the response under FORGE_DRY_BRIDGE=1 (mirrors authoring/start), got: ${text}`);

  const sessionDir = join(forgeRoot, 'projects', 'demoproj', '_kb-cleanup', body.sessionId);
  assert.ok(existsSync(join(sessionDir, 'status.json')), `expected a real status.json at ${sessionDir}`);
  const status = JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as CleanupStatus;
  assert.equal(status.session_id, body.sessionId);
  assert.equal(status.project, 'demoproj', 'a project-bound KB\'s sessionProject must be the REAL project ref, not a dot-anchor');
  assert.equal(status.phase, 'drafting', 'the seeded phase must be "drafting" — the kb-cleanup turnSpec\'s first row');
  assert.equal(status.kb_id, 'proj-bound-cleanup-kb');
  assert.deepEqual(status.kb_binding, { kind: 'project', ref: 'demoproj' }, 'kb_binding must be the KB\'s own descriptor-derived binding, not a re-derived guess');
  assert.ok(Array.isArray(status.findings), 'findings must be a real array (possibly empty for a clean KB), never absent');
  assert.ok(typeof status.updated_at === 'string' && status.updated_at.length > 0);
});

// ---------------------------------------------------------------------------
// POST /api/studio/kbs/:id/cleanup/start — happy path, non-project anchor
// ---------------------------------------------------------------------------

// Kills: a route that anchors EVERY kb-cleanup session under a real project
// regardless of binding kind — a non-project-bound KB (flow/unique/band)
// would then create a phantom `projects/<kbId>/` directory `discoverProjects`
// surfaces as a fake project (the exact MAJOR-2 defect the KB-create
// hand-off's own R1-06 WI-2 fix pinned — this route must mirror that fix,
// not re-introduce it).
test('AT-4: a NON-project-bound KB\'s start route anchors the session under the dot-prefixed KB-seeding anchor (.kb-<id>), never under projects/<kbId>/ directly', async () => {
  writeKb('unique-cleanup-kb', '{ kind: unique }');

  const res = await start('unique-cleanup-kb');
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { sessionId: string };

  const expectedAnchor = `${KB_SEEDING_ANCHOR_PREFIX}unique-cleanup-kb`;
  const sessionDir = join(forgeRoot, 'projects', expectedAnchor, '_kb-cleanup', body.sessionId);
  assert.ok(existsSync(join(sessionDir, 'status.json')), `expected the session anchored under the dot-prefixed anchor at ${sessionDir}`);
  const status = JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as CleanupStatus;
  assert.equal(status.project, expectedAnchor, 'the echoed project must be the dot-anchored value, verbatim');

  assert.ok(
    !existsSync(join(forgeRoot, 'projects', 'unique-cleanup-kb')),
    'a phantom projects/<kbId>/ (without the dot-prefix) must never be created — this is the exact phantom-project defect the KB-create hand-off\'s own MAJOR-2 fix guards against',
  );
});

// ---------------------------------------------------------------------------
// ADR-043 §3 amendment (wave-6 kickoff model-tier seam) — brain-maintenance
// (the kb-cleanup session's agent) is now strategy:range [sonnet, opus].
// ---------------------------------------------------------------------------

test('AT-16: a valid modelTier ("opus", within the widened range) is persisted into status.json', async () => {
  writeKb('modeltier-cleanup-kb', '{ kind: project, ref: demoproj }');
  mkdirSync(join(forgeRoot, 'projects', 'demoproj'), { recursive: true });

  const res = await startWithBody('modeltier-cleanup-kb', { modelTier: 'opus' });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { sessionId: string };

  const sessionDir = join(forgeRoot, 'projects', 'demoproj', '_kb-cleanup', body.sessionId);
  const status = JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as CleanupStatus & { modelTier?: string };
  assert.equal(status.modelTier, 'opus');
});

test('AT-17: an out-of-envelope modelTier ("haiku") 400s naming the value and the allowed set, no session dir created', async () => {
  writeKb('modeltier-reject-kb', '{ kind: project, ref: demoproj }');
  mkdirSync(join(forgeRoot, 'projects', 'demoproj'), { recursive: true });
  const kbCleanupDir = join(forgeRoot, 'projects', 'demoproj', '_kb-cleanup');
  const before = existsSync(kbCleanupDir) ? readdirSync(kbCleanupDir).sort() : [];

  const res = await startWithBody('modeltier-reject-kb', { modelTier: 'haiku' });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /requested model tier "haiku".*allowed tier\(s\): sonnet, opus/);
  const after = existsSync(kbCleanupDir) ? readdirSync(kbCleanupDir).sort() : [];
  assert.deepEqual(after, before, 'a rejected modelTier must not create a new session dir');
});

// ---------------------------------------------------------------------------
// POST /api/studio/kbs/:id/cleanup/start — findings come from a LIVE scan
// ---------------------------------------------------------------------------

// Kills: a route that writes `findings: []` unconditionally (a fabricated/
// hardcoded empty result) instead of actually running a live, KB-scoped
// brain-lint pass — proven by planting a REAL, detectable defect (a theme
// file missing a required frontmatter field) and requiring it to show up.
test('AT-5: findings reflect a REAL on-disk lint defect for this KB — not a fabricated/hardcoded empty array', async () => {
  writeKb('defect-cleanup-kb', '{ kind: unique }');
  writeBrokenTheme('defect-cleanup-kb');

  const res = await start('defect-cleanup-kb');
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { sessionId: string };

  const sessionDir = join(forgeRoot, 'projects', `${KB_SEEDING_ANCHOR_PREFIX}defect-cleanup-kb`, '_kb-cleanup', body.sessionId);
  const status = JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as CleanupStatus;

  assert.ok(status.findings.length > 0, `expected at least one real finding for the planted defect, got: ${JSON.stringify(status.findings)}`);
  const serialized = JSON.stringify(status.findings);
  assert.match(serialized, /broken\.md/, `expected a finding naming the broken theme file, got: ${serialized}`);
  assert.match(serialized, /frontmatter|description/i, `expected a finding describing the missing-frontmatter-field defect, got: ${serialized}`);
});

// ---------------------------------------------------------------------------
// POST /api/studio/kbs/:id/cleanup/apply
// ---------------------------------------------------------------------------

/** Plants a kb-cleanup session's status.json DIRECTLY on disk (never through
 *  the start route) at the exact shape the start route is expected to
 *  produce — keeps the apply-route tests below independent of whether the
 *  start route itself is implemented correctly yet. */
function plantCleanupSession(sessionProject: string, sessionId: string, phase: string, kbId: string): string {
  const sessionDir = join(forgeRoot, 'projects', sessionProject, '_kb-cleanup', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const status: CleanupStatus = {
    session_id: sessionId,
    project: sessionProject,
    phase,
    kb_id: kbId,
    kb_binding: { kind: 'unique' },
    findings: [],
    updated_at: new Date().toISOString(),
  };
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify(status, null, 2), 'utf8');
  return sessionDir;
}

// Kills: an apply route that applies the plan regardless of the session's
// current phase — the whole point of the approval gate (item #11 in the
// turn-spine suite) is worthless if the APPLY route itself doesn't also
// enforce it.
test('AT-6: apply refuses with 409 when the session\'s phase is NOT exactly awaiting-approval (e.g. still "drafting")', async () => {
  writeKb('apply-wrongphase-kb', '{ kind: unique }');
  const sessionId = 'apply-wrongphase-001';
  const sessionProject = `${KB_SEEDING_ANCHOR_PREFIX}apply-wrongphase-kb`;
  const sessionDir = plantCleanupSession(sessionProject, sessionId, 'drafting', 'apply-wrongphase-kb');
  // Precondition, asserted before reading any verdict.
  assert.equal(JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')).phase, 'drafting', 'arrange: seeded status must start in drafting');

  const res = await apply('apply-wrongphase-kb', { project: sessionProject, sessionId });
  assert.equal(res.status, 409, `expected 409 for a session not at awaiting-approval, got ${res.status}: ${await res.text()}`);
  assert.equal(
    JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')).phase,
    'drafting',
    'a refused apply must leave status.json byte-identical in its load-bearing field — phase must NOT have moved',
  );
});

// Kills: an apply route with no real "session not found" handling (e.g. a
// 500 crash, or worse, a 200 that silently no-ops).
test('AT-7: apply against an unknown sessionId -> 404 (or another explicit non-2xx/non-409), never a silent 200', async () => {
  writeKb('apply-unknown-kb', '{ kind: unique }');
  const sessionProject = `${KB_SEEDING_ANCHOR_PREFIX}apply-unknown-kb`;
  const res = await apply('apply-unknown-kb', { project: sessionProject, sessionId: 'no-such-session-at-all' });
  assert.notEqual(res.status, 200, 'applying against a session that was never started must never silently 200');
});

// Kills: an apply route that never actually flips the phase to "applied" on
// success (e.g. it drains the deterministic fixes but forgets the terminal
// status write), leaving the session stuck at awaiting-approval forever.
test('AT-8: apply from awaiting-approval succeeds and writes phase:applied to status.json on disk', async () => {
  writeKb('apply-success-kb', '{ kind: unique }');
  const sessionId = 'apply-success-001';
  const sessionProject = `${KB_SEEDING_ANCHOR_PREFIX}apply-success-kb`;
  const sessionDir = plantCleanupSession(sessionProject, sessionId, 'awaiting-approval', 'apply-success-kb');
  // Precondition, asserted before reading any verdict.
  assert.equal(JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')).phase, 'awaiting-approval', 'arrange: seeded status must start in awaiting-approval');

  const res = await apply('apply-success-kb', { project: sessionProject, sessionId });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  assert.equal(
    JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')).phase,
    'applied',
    'status.json on disk must reflect phase:applied after a successful apply — the ONLY route allowed to write this phase',
  );
});

// ---------------------------------------------------------------------------
// POST /api/studio/kbs/:id/cleanup/apply — DEFECT A: the apply route calls
// `runBrainConsolidateNow` DIRECTLY (cli/ui-bridge.ts ~:4324) instead of via
// `enqueueConsolidate` (cli/bridge-studio-kbs.ts), the per-kbId serialization
// queue every OTHER caller of that function goes through (the pre-existing
// `POST /api/studio/kbs/:id/maintenance` op=consolidate route,
// cli/bridge-studio-kbs.ts:1587). Nothing dedups two dispatches against the
// SAME kbId, so an apply can race an overlapping apply, or the existing
// Consolidate button, against the same on-disk category-index file.
// ---------------------------------------------------------------------------

function maintenanceConsolidate(kbId: string): Promise<Response> {
  return fetch(`${url}/api/studio/kbs/${encodeURIComponent(kbId)}/maintenance`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify({ op: 'consolidate' }),
  });
}

/**
 * DEFECT A proof note — read before touching AT-9/AT-10 (report this
 * honestly, do not weaken):
 *
 * `runBrainConsolidateNow`'s own body (cli/bridge-studio-kbs.ts:488-556) has
 * NO internal `await` on the code path this whole suite runs under
 * (FORGE_DRY_BRIDGE=1 forces `noSpawn`, skipping the ONE `await
 * runBrainFixTurn(...)` in the function — the real SDK turn no test in this
 * campaign may invoke). That means, in THIS CI-safe environment, a single
 * call to `runBrainConsolidateNow` runs its entire critical section
 * synchronously to completion before yielding — so two concurrent calls to
 * it literally CANNOT be observed interleaving at the statement level
 * regardless of whether the queue is used: Node's single-threaded event loop
 * already guarantees no two synchronous blocks overlap. A test that fires
 * two overlapping calls and checks "did the writes interleave" would pass
 * trivially either way, which is exactly the decorative shape this file's
 * own tests are written to reject — so that shape is NOT what AT-9/AT-10
 * assert.
 *
 * The queue DOES introduce one real, controllable async boundary outside
 * `runBrainConsolidateNow` itself: `enqueueConsolidate`'s `deferToNextTick()`
 * (`CONSOLIDATE_DISPATCH_DEFER_MS` = 50ms, cli/bridge-studio-kbs.ts, private —
 * not re-declared here) always elapses before a queued run's `run()`
 * executes, including for the FIRST run enqueued against an empty queue.
 * That defer is the seam these two tests actually observe:
 *
 *   AT-9  (cross-route, BEHAVIOURAL, existence-based — the PRIMARY proof): a
 *         `maintenance` op=consolidate dispatch (which DOES go through
 *         `enqueueConsolidate`) is fired first. If `apply` shares the same
 *         queue, apply's own run cannot even START until the maintenance
 *         run's queued 50ms defer AND its run have both finished — so by the
 *         time apply's response returns (apply's own route AWAITS its run
 *         inline before responding — see AT-8), the maintenance run's
 *         terminal event must already exist on disk. The CURRENT bug (a
 *         direct `runBrainConsolidateNow` call, bypassing the queue) lets
 *         apply's own zero-defer run race ahead and complete before the
 *         still-deferred maintenance run has even started — an observable,
 *         non-flaky (existence, not a timing threshold) difference.
 *   AT-10 (same-route, TIMING-based fallback, explicitly labelled as such):
 *         two applies against the SAME kbId, fired concurrently. If BOTH
 *         correctly route through the shared per-kbId queue, the queue's own
 *         50ms defer means EVERY apply against a busy kbId takes >= ~50ms
 *         end to end (never near-zero), and the SECOND one queued must wait
 *         for the FIRST's full defer+run before its own defer even starts —
 *         driving its total latency to roughly double. This is the fallback
 *         the task brief allows when a real interleave cannot be forced:
 *         per the note above, two same-shaped concurrent calls have no
 *         non-timing signal available in this CI-safe mode. Generous
 *         margins (well inside the 50ms/100ms floors) are used specifically
 *         to avoid CI flakiness while staying far above the near-zero
 *         latency the current, unqueued implementation actually produces.
 */

// Kills: an apply route that calls `runBrainConsolidateNow` directly instead
// of `enqueueConsolidate` — proves the CROSS-ROUTE half of the hazard (an
// apply racing the existing Consolidate button against the same kbId).
test('AT-9 (DEFECT A, cross-route serialization, BEHAVIOURAL): a maintenance op=consolidate dispatched FIRST against a kbId must have its run complete before a LATER apply against the SAME kbId is allowed to complete its own — kills an apply route that calls runBrainConsolidateNow directly and races ahead of an already-queued dispatch', async () => {
  const kbId = 'serialize-cross-kb';
  writeKb(kbId, '{ kind: unique }');
  const sessionId = 'serialize-cross-001';
  const sessionProject = `${KB_SEEDING_ANCHOR_PREFIX}${kbId}`;
  plantCleanupSession(sessionProject, sessionId, 'awaiting-approval', kbId);

  const maintRes = await maintenanceConsolidate(kbId);
  const maintText = await maintRes.text();
  assert.equal(maintRes.status, 200, `arrange: maintenance op=consolidate dispatch must 200, got ${maintRes.status}: ${maintText}`);
  const maintBody = JSON.parse(maintText) as { runId: string };

  // Real (not artificial-for-timing) gap: only large enough that the two
  // runIds (`${kbId}-consolidate-${Date.now().toString(36)}`, millisecond
  // resolution) cannot collide on the same millisecond — a collision would
  // make both routes append to the SAME events.jsonl file, destroying the
  // two-distinct-runId signal this test reads. NOT load-bearing for the
  // ordering assertion itself, which rests on the 50ms queue defer (~10x
  // this gap).
  await new Promise((r) => setTimeout(r, 5));

  const applyRes = await apply(kbId, { project: sessionProject, sessionId });
  const applyText = await applyRes.text();
  assert.equal(applyRes.status, 200, `arrange: apply must 200, got ${applyRes.status}: ${applyText}`);
  const applyBody = JSON.parse(applyText) as { runId: string };
  assert.notEqual(applyBody.runId, maintBody.runId, 'arrange: the two dispatches must land distinct runIds (see the gap comment above)');

  const maintTerminal = join(forgeRoot, '_logs', `_brainfix-${maintBody.runId}`, 'events.jsonl');
  const applyTerminal = join(forgeRoot, '_logs', `_brainfix-${applyBody.runId}`, 'events.jsonl');
  assert.ok(existsSync(applyTerminal), 'sanity: apply\'s own route AWAITS its consolidate run inline before responding (cli/ui-bridge.ts\'s apply handler, see AT-8), so its own terminal event must already exist the moment this response is received');
  assert.ok(
    existsSync(maintTerminal),
    'DEFECT A: apply\'s response arrived before the EARLIER-dispatched maintenance consolidate run\'s terminal event was written to disk. The maintenance run only reaches its critical section after enqueueConsolidate\'s own 50ms deferToNextTick (cli/bridge-studio-kbs.ts) — for apply\'s run to have already finished by now, it must have called runBrainConsolidateNow DIRECTLY (cli/ui-bridge.ts ~:4324), bypassing the shared per-kbId queue and racing ahead of the already-queued maintenance dispatch instead of serializing behind it',
  );
});

// Kills: an apply route with no queue at all for two overlapping applies
// against the SAME kbId. TIMING-based fallback — see the DEFECT A proof note
// above for why a non-timing signal is not available here.
test('AT-10 (DEFECT A, same-route serialization, TIMING-based fallback — see the proof note above): two applies against the SAME kbId, fired concurrently, must both incur the shared queue\'s dispatch defer and must NOT both complete at near-zero latency — kills an apply route that calls runBrainConsolidateNow directly with no queue at all', async () => {
  const kbId = 'serialize-two-apply-kb';
  writeKb(kbId, '{ kind: unique }');
  const sessionProject = `${KB_SEEDING_ANCHOR_PREFIX}${kbId}`;
  const sessionA = 'serialize-two-apply-A';
  const sessionB = 'serialize-two-apply-B';
  plantCleanupSession(sessionProject, sessionA, 'awaiting-approval', kbId);
  plantCleanupSession(sessionProject, sessionB, 'awaiting-approval', kbId);

  async function timedApply(sessionId: string): Promise<{ status: number; elapsedMs: number; text: string }> {
    const t0 = Date.now();
    const res = await apply(kbId, { project: sessionProject, sessionId });
    const text = await res.text();
    return { status: res.status, elapsedMs: Date.now() - t0, text };
  }

  const [a, b] = await Promise.all([timedApply(sessionA), timedApply(sessionB)]);
  assert.equal(a.status, 200, `arrange: apply A must 200, got ${a.status}: ${a.text}`);
  assert.equal(b.status, 200, `arrange: apply B must 200, got ${b.status}: ${b.text}`);

  const faster = Math.min(a.elapsedMs, b.elapsedMs);
  const slower = Math.max(a.elapsedMs, b.elapsedMs);

  // Margins: enqueueConsolidate's own deferToNextTick is 50ms
  // (CONSOLIDATE_DISPATCH_DEFER_MS, cli/bridge-studio-kbs.ts — private, not
  // re-declared here). A properly-queued apply cannot finish faster than one
  // full defer; a SECOND apply queued behind the first cannot finish faster
  // than two. Thresholds are set well inside those floors (30ms / 70ms) to
  // absorb setTimeout/scheduling jitter without weakening the signal: the
  // CURRENT buggy code (direct, unqueued calls) finishes BOTH applies in low
  // single-digit milliseconds, nowhere close to either floor.
  assert.ok(faster >= 30, `DEFECT A: the FASTER of the two concurrent applies against the same kbId completed in ${faster}ms — too fast to have gone through the shared queue's dispatch defer at all, proving at least one apply call bypasses enqueueConsolidate entirely`);
  assert.ok(slower >= 70, `DEFECT A: the SLOWER of the two concurrent applies against the same kbId completed in ${slower}ms — too fast to have been queued BEHIND the faster one's own full defer+run, proving the two applies are not chained through the same per-kbId queue (or reflect a "defer without real chaining" partial fix)`);
});

// ---------------------------------------------------------------------------
// POST /api/studio/kbs/:id/cleanup/apply — DEFECT B: the apply route's ":id"
// URL segment is parsed (`kbCleanupApplyMatch[1]`) and never referenced
// anywhere in the handler (cli/ui-bridge.ts ~:4287) — live-verified: ANY
// value there, including a totally bogus non-existent kb id, currently 200s
// and drains the session's real kb_id. Separately, `body.project` and
// `body.sessionId` are checked only for `typeof === 'string' && length > 0`
// — no charset check, no length cap, unlike the stated convention in
// cli/bridge-studio-sessions.ts ("BOTH are validated (length cap + charset)
// BEFORE any fs call"). Containment still holds via resolveGuardedPath in
// both cases (defense-in-depth, not a live escape) — these tests pin the
// EARLY, EXPLICIT rejection this file's own conventions call for, not an
// escape.
// ---------------------------------------------------------------------------

// Kills: an apply route that never validates its own ":id" URL segment at
// all (the CURRENT shape). Mirrors AT-1's raw-wire technique (see rawPost's
// own doc comment) for the traversal-shaped probe — fetch() cannot deliver a
// literal ".." segment to the real route at all. Status code pinned to 400
// "invalid kb id" specifically: this file's OWN sibling route on the
// identical URL prefix (`/api/studio/kbs/:id/cleanup/start`, ~40 lines above
// in this same file) checks `!SLUG_RE.test(kbId)` -> 400 "invalid kb id" as
// its FIRST check, before any KB lookup — the natural, directly-precedented
// shape for this route's own (currently missing) equivalent check. An empty
// ":id" cannot be constructed as a distinct probe: the route's own regex
// requires at least one non-slash character in that position (`([^/]+)`), so
// `//cleanup/apply` never matches this handler at all (falls through to a
// generic 404 elsewhere) — reported here, not invented as a fake positive.
test('AT-11 (DEFECT B, RAW WIRE): a traversal-shaped ":id" (literal ".." and its "%2e%2e" percent-encoded equivalent) -> 400 "invalid kb id" before any filesystem call — nothing created on disk, canary byte-unchanged, the real session untouched', async () => {
  writeKb('apply-badid-kb', '{ kind: unique }');
  const sessionId = 'apply-badid-001';
  const sessionProject = `${KB_SEEDING_ANCHOR_PREFIX}apply-badid-kb`;
  plantCleanupSession(sessionProject, sessionId, 'awaiting-approval', 'apply-badid-kb');

  const canaryPath = join(forgeRoot, 'CANARY-ROOT-OUTSIDE-KB-CLEANUP-APPLY.txt');
  const canaryContent = 'SENTINEL-kb-cleanup-apply-at11-canary-must-never-change';
  writeFileSync(canaryPath, canaryContent, 'utf8');
  const before = snapshotFileList(forgeRoot);

  const body = JSON.stringify({ project: sessionProject, sessionId });
  const literal = await rawPost('/api/studio/kbs/../cleanup/apply', body);
  assert.equal(literal.status, 400, `expected 400 "invalid kb id" for the raw ".." kb id, got ${literal.status}: ${literal.text}`);
  assert.match(literal.text, /invalid kb id/, `expected the SLUG_RE validation's own error message, mirroring the sibling /cleanup/start route — got: ${literal.text}`);

  const percentEncoded = await rawPost('/api/studio/kbs/%2e%2e/cleanup/apply', body);
  assert.equal(percentEncoded.status, 400, `expected 400 for the "%2e%2e" percent-encoded equivalent, got ${percentEncoded.status}: ${percentEncoded.text}`);
  assert.equal(percentEncoded.text, literal.text, 'the percent-encoded and literal traversal shapes must produce a byte-identical response body');

  assert.deepEqual(snapshotFileList(forgeRoot), before, 'a rejected apply must create nothing on disk — the ARTIFACT, not merely the status code');
  assert.equal(readFileSync(canaryPath, 'utf8'), canaryContent, 'the canary file must be byte-unchanged after both probes');
  assert.equal(
    JSON.parse(readFileSync(join(forgeRoot, 'projects', sessionProject, '_kb-cleanup', sessionId, 'status.json'), 'utf8')).phase,
    'awaiting-approval',
    'the real session must remain untouched at awaiting-approval after both rejected traversal probes',
  );
});

// Kills: a fixed ":id" check that validates charset (SLUG_RE) but never caps
// length — a value 50x any known id-length convention in this codebase
// (MAX_SKILL_ID_LENGTH = 100, orchestrator/skill-path.ts) so this probe is
// robust to whatever specific cap (if any) the fix picks. Status code is
// deliberately NOT pinned to one exact value (400 vs 404) — see the report:
// this could legitimately be caught either by an explicit length cap (400,
// mirroring AT-11) or by the mismatch check in AT-13 below (404), since a
// 5000-char value can never equal any real (short) kb_id either way. What
// must NEVER happen is a silent 200.
test('AT-12 (DEFECT B): an absurdly over-long ":id" (5000 chars) is rejected 4xx, never a 200 — the real session is left untouched', async () => {
  writeKb('apply-overlong-kb', '{ kind: unique }');
  const sessionId = 'apply-overlong-001';
  const sessionProject = `${KB_SEEDING_ANCHOR_PREFIX}apply-overlong-kb`;
  plantCleanupSession(sessionProject, sessionId, 'awaiting-approval', 'apply-overlong-kb');

  const overlong = 'a'.repeat(5000);
  const res = await apply(overlong, { project: sessionProject, sessionId });
  const text = await res.text();
  assert.ok(res.status >= 400 && res.status < 500, `expected a 4xx for a 5000-char ":id", got ${res.status}: ${text}`);
  assert.equal(
    JSON.parse(readFileSync(join(forgeRoot, 'projects', sessionProject, '_kb-cleanup', sessionId, 'status.json'), 'utf8')).phase,
    'awaiting-approval',
    'the real session must remain untouched after the over-long ":id" is rejected',
  );
});

// Kills: the LIVE-VERIFIED defect itself — "POST .../kbs/totally-bogus-not-
// a-real-kb/cleanup/apply with a valid body returns 200 and drains the
// session's real kb_id" — generalized to a WELL-FORMED, REAL, but WRONG kb
// id (not just a nonsense string), the sharper attack shape: a caller who
// knows a legitimate {project, sessionId} pair can vary ONLY the URL's :id
// across every other real kb id in the system and always get a silent 200.
//
// Status code chosen: 404. This file's OWN vocabulary already treats "the
// requested kb-scoped resource does not resolve" as 404 twice — the sibling
// /cleanup/start route's "unknown kb: <id>" (AT-2) and this very route's own
// "session not found" (AT-7). A mismatched :id is exactly that shape: no
// (kbId, project, sessionId) triple naming this pairing exists. 409 is
// reserved in this file for a VALID, correctly-identified session in the
// WRONG STATE (AT-6, phase !== awaiting-approval) — a different failure mode
// (right resource, wrong state) than "wrong resource entirely".
//
// REGRESSION LOCK, kept explicit: this is also the strongest available
// black-box proof that the drain still uses the session's OWN recorded
// kb_id, never the URL's :id. A fix that doesn't validate at all (silently
// 200s and drains kb_id, today's actual behaviour) is killed by the
// status-code assertion below. A fix that validates the mismatch case
// correctly (this test) but then, in the MATCHING case, swaps the drain's
// source from `status.kb_id` to the (now validated-equal) `:id` value is
// UNOBSERVABLE black-box — the two values are identical by construction the
// moment validation requires them to match. That residual is reported, not
// invented, in the task write-up rather than pinned by a test that cannot
// actually distinguish it.
test('AT-13 (DEFECT B): a well-formed ":id" naming a REAL but DIFFERENT kb than the session\'s own kb_id -> 404, never a silent 200 that drains either kb — the mismatch itself must be refused', async () => {
  writeKb('apply-mismatch-owner-kb', '{ kind: unique }');
  writeKb('apply-mismatch-decoy-kb', '{ kind: unique }');
  const sessionId = 'apply-mismatch-001';
  const sessionProject = `${KB_SEEDING_ANCHOR_PREFIX}apply-mismatch-owner-kb`;
  plantCleanupSession(sessionProject, sessionId, 'awaiting-approval', 'apply-mismatch-owner-kb');

  const before = snapshotFileList(forgeRoot);

  // The URL names the DECOY kb; the body's {project, sessionId} names the
  // REAL session, which belongs to the OWNER kb, not the decoy.
  const res = await apply('apply-mismatch-decoy-kb', { project: sessionProject, sessionId });
  const text = await res.text();
  assert.equal(res.status, 404, `expected 404 for a well-formed but mismatched ":id" (see the status-code rationale above), got ${res.status}: ${text}`);

  assert.equal(
    JSON.parse(readFileSync(join(forgeRoot, 'projects', sessionProject, '_kb-cleanup', sessionId, 'status.json'), 'utf8')).phase,
    'awaiting-approval',
    'a refused mismatched apply must leave the real session untouched — phase must NOT have moved to applied',
  );
  assert.deepEqual(snapshotFileList(forgeRoot), before, 'a refused mismatched apply must create nothing on disk (no _brainfix-* run log for either kb) — the ARTIFACT, not merely the status code');
});

// Kills: an apply route whose `project` validation is only `typeof ===
// 'string' && length > 0` (the CURRENT shape) — no charset check, no length
// cap, unlike cli/bridge-studio-sessions.ts's stated convention. Status code
// pinned to 400 specifically, mirroring that convention (invalidProjectReason
// -> `sendJson(res, 400, ...)`); TODAY, none of these three values name any
// real on-disk session, so the CURRENT code's only check
// (`guardedReadSessionStatus` returning null) reports 404 "session not
// found" for all three — a genuinely different (and less actionable) code
// than the 400 this test requires, so this is a real red, not a vacuous 4xx
// check.
test('AT-14 (DEFECT B): "project" is charset- and length-validated (400) before any filesystem call — a traversal-shaped, non-slug, and 5000-char project all -> 400, nothing created on disk', async () => {
  writeKb('apply-badproject-kb', '{ kind: unique }');
  const canaryPath = join(forgeRoot, 'CANARY-APPLY-PROJECT-VALIDATION.txt');
  const canaryContent = 'SENTINEL-apply-project-validation-canary';
  writeFileSync(canaryPath, canaryContent, 'utf8');

  for (const badProject of ['../../../etc', 'Has Spaces AND Caps', 'a'.repeat(5000)]) {
    const before = snapshotFileList(forgeRoot);
    const res = await apply('apply-badproject-kb', { project: badProject, sessionId: 'whatever-001' });
    const text = await res.text();
    assert.equal(res.status, 400, `expected 400 for project=${JSON.stringify(badProject.slice(0, 30))}…, got ${res.status}: ${text}`);
    assert.deepEqual(snapshotFileList(forgeRoot), before, `a rejected project value must create nothing on disk (project=${JSON.stringify(badProject.slice(0, 30))}…)`);
  }
  assert.equal(readFileSync(canaryPath, 'utf8'), canaryContent, 'canary must be byte-unchanged after every malformed-project probe');
});

// Kills: an apply route whose `sessionId` validation is only `typeof ===
// 'string' && length > 0` — same rationale as AT-14, for the sibling field.
test('AT-15 (DEFECT B): "sessionId" is charset- and length-validated (400) before any filesystem call — a traversal-shaped, non-slug, and 5000-char sessionId all -> 400, nothing created on disk', async () => {
  writeKb('apply-badsession-kb', '{ kind: unique }');
  const canaryPath = join(forgeRoot, 'CANARY-APPLY-SESSIONID-VALIDATION.txt');
  const canaryContent = 'SENTINEL-apply-sessionid-validation-canary';
  writeFileSync(canaryPath, canaryContent, 'utf8');

  for (const badSessionId of ['../../../etc', 'has spaces', 'a'.repeat(5000)]) {
    const before = snapshotFileList(forgeRoot);
    const res = await apply('apply-badsession-kb', { project: `${KB_SEEDING_ANCHOR_PREFIX}apply-badsession-kb`, sessionId: badSessionId });
    const text = await res.text();
    assert.equal(res.status, 400, `expected 400 for sessionId=${JSON.stringify(badSessionId.slice(0, 30))}…, got ${res.status}: ${text}`);
    assert.deepEqual(snapshotFileList(forgeRoot), before, `a rejected sessionId value must create nothing on disk (sessionId=${JSON.stringify(badSessionId.slice(0, 30))}…)`);
  }
  assert.equal(readFileSync(canaryPath, 'utf8'), canaryContent, 'canary must be byte-unchanged after every malformed-sessionId probe');
});
