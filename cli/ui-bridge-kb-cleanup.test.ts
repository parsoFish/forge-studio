/**
 * Acceptance tests for the kb-cleanup session's start route (R4-19-F2 — the
 * `kb-cleanup` interactive session kind, ADR-043 §1/§3):
 *
 *   POST /api/studio/kbs/:id/cleanup/start
 *
 * W6-B9 (reviewer finding on W6-B8): the sibling apply route this file used
 * to cover, `POST /api/studio/kbs/:id/cleanup/apply`, is DELETED —
 * kb-cleanup migrated onto the generic SessionInteractivePanel (W6-B8),
 * whose approve affordance goes through the GENERIC write route (`POST
 * /api/studio/sessions/kb-cleanup/:sid/:affordance`, cli/bridge-studio-
 * affordances.ts), which already delegates to the SAME `approveKbCleanup`
 * helper (cli/bridge-studio-kbs.ts) this bespoke route only ever wrapped —
 * once its one caller (`SessionCleanupPanel.tsx`) was deleted, the bespoke
 * route had no production caller left, and forge does not carry dual paths.
 * The AT-6..AT-15 tests that used to pin its behaviour (phase gate, DEFECT
 * A/B regressions) are deleted with it — `approveKbCleanup` itself keeps its
 * own direct coverage in `cli/bridge-studio-kbs.test.ts`, and the generic
 * route's own dispatch is covered by `cli/bridge-studio-affordances.test.ts`.
 *
 * Mirrors `POST /api/studio/authoring/start` (`cli/ui-bridge-authoring-
 * start.test.ts`) and the KB-create hand-off (`cli/bridge-studio-kbs.ts`
 * ~:1189) for the session-anchor shape: a project-bound KB anchors its
 * cleanup session under the real project (`<projectsRoot>/<ref>/`); every
 * OTHER binding kind anchors under the dot-prefixed KB-seeding anchor
 * (`<projectsRoot>/.kb-<id>/`) so `discoverProjects` never surfaces a
 * phantom project for it.
 *
 * DESIGN CALL this file makes explicit:
 *   - The start route's `findings` are asserted to be a real, non-fabricated
 *     array reflecting an ACTUAL on-disk lint defect (a theme file missing a
 *     required frontmatter field) — never a hardcoded shape. The EXACT
 *     scoping mechanism (`runBrainLint`+`scopeFindingsToKb` vs.
 *     `lintThemeFiles`+`listOwnThemeFiles` vs. something new) is an
 *     implementation choice this file does not dictate.
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
// W8-B3 (operator note ON-5) — the session's OPENING OPERATOR TURN.
//
// Measured before the fix: a kb-cleanup session dir held ONLY status.json until
// an operator verdict landed, so `deriveSessionTranscript` honestly found
// nothing and the session opened on an empty pane — even though the operator
// HAD made a request (they clicked "Cleanup plan" on a named KB's health
// panel). `prompt.md` is the file the transcript derivation actually reads.
// ---------------------------------------------------------------------------

test('W8-B3 (ON-5): the start route records the request as prompt.md — the KB, its binding, and the finding count AT KICKOFF', async () => {
  writeKb('ontime-cleanup-kb', '{ kind: unique }');
  writeBrokenTheme('ontime-cleanup-kb');

  const res = await start('ontime-cleanup-kb');
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { sessionId: string };
  const sessionDir = join(forgeRoot, 'projects', `${KB_SEEDING_ANCHOR_PREFIX}ontime-cleanup-kb`, '_kb-cleanup', body.sessionId);

  const prompt = readFileSync(join(sessionDir, 'prompt.md'), 'utf8');
  assert.match(prompt, /ontime-cleanup-kb/, 'the request must name the KB it was made against');
  assert.match(prompt, /finding/, 'the request must say how much was open when it was made');
  // "at kickoff" is load-bearing wording, not decoration: the cleanup-plan
  // artifact re-derives findings LIVE from a fresh scan at read time, so this
  // line must never be readable as current status.
  assert.match(prompt, /at kickoff/);

  // The count is the REAL live-scan count this session was started against,
  // not a hardcoded number — same status.json the live-scan test asserts.
  const status = JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as CleanupStatus;
  assert.ok(status.findings.length > 0);
  assert.match(prompt, new RegExp(`${status.findings.length} agent-tier finding`));
});
