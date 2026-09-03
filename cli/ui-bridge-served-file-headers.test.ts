/**
 * ACCEPTANCE TESTS — WI-3 (regate row `artifact-plan-45`, bead
 * forge-6gv.3.2): every bridge route that serves an AGENT-AUTHORED file on
 * the bridge's own origin (`http://localhost:4123`) must carry three
 * hardening headers alongside its content-type — `content-security-policy`,
 * `x-content-type-options`, `content-disposition` — because today (RED on
 * this branch's base) it carries none of them: script inside such a file
 * would run AS the bridge origin and could drive every mutating route the
 * CSRF check only guards with a header a same-origin fetch can add just as
 * easily (approve-and-merge, scheduler start, plan verdicts). No live
 * exploit exists — this pins a MISSING DEFENCE, not a demonstrated breach.
 *
 * `contentTypeFor` (cli/ui-bridge.ts) has SEVEN call sites across FIVE route
 * families — re-derived by `grep -n "contentTypeFor" cli/ui-bridge.ts`
 * before writing this file, not copied from any brief unverified:
 *
 *   GET /api/artifact/<cycleId>/<filename>
 *   GET /api/architect/file/<project>/<sid>/<filename>
 *   GET /api/instructions/file/<project>/<sid>/<filename>
 *   GET /api/demo-builder/demo/<project>/<sid>                (DEMO.html)
 *   GET /api/demo-builder/fragment/<project>/<sid>/<element>
 *   GET /api/demo-builder/generation/<project>/<sid>/<n>/<filename>
 *   GET /api/demo-builder/history/<project>/<id>               (DEMO.html)
 *
 * Two kinds of assertion:
 *   1. Per-route, real-request-path pins (one `before()`-seeded fixture per
 *      route, all seven driven through a live `startBridge()` — never a
 *      helper called directly, so a route that forgets to wire the helper
 *      in shows up here, not just in the source ratchet).
 *   2. A source-level ENUMERATION RATCHET: `contentTypeFor` must have no
 *      direct caller anywhere in cli/ui-bridge.ts outside the one hardening
 *      helper (`servedFileHeaders`) — this is what catches the EIGHTH route
 *      a future change adds, which the seven fixtures above structurally
 *      cannot.
 *
 * Header-injection scope, checked per mechanism rather than assumed:
 * `isSafeSubPath`/`isSafeSegment` (cli/studio-path-guard.ts) already deny
 * every C0 control character (0x00-0x1f), so a raw CR/LF in a filename is
 * REJECTED BY THE EXISTING PATH GUARD before any header is ever built — that
 * is pinned below as a guard-refusal (400), and the guard, not this WI's new
 * sanitiser, is what's load-bearing for it. Those same guards have no
 * opinion on a bare `"`, which a POSIX filename may legally contain — THAT
 * is the shape this WI's `sanitizeHeaderFilename` genuinely defends against,
 * pinned below via a real on-disk file named with an embedded quote.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';
import type { DemoBuilderStatus } from '@forge/sessions/demo-builder-runner.ts';

process.env.FORGE_ARCHITECT_NO_SPAWN = '1';

let forgeRoot: string;
let projectsRoot: string;
let logsRoot: string;
let url: string;
let close: () => Promise<void>;

const CYCLE_ID = 'served-headers-cycle';
const ARCH_SID = '2026-08-23T00-00-00';
const INSTR_SID = '2026-08-23T00-00-01';
const DEMO_SID = 'demo-session-1';
const HIST_ID = 'hist-1';
let genSid: string; // minted by the real /start route inside before()

function repoDir(): string {
  return join(projectsRoot, 'demo');
}

function plantStatus(sessionDir: string, status: DemoBuilderStatus): void {
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({ ...status, updated_at: new Date().toISOString() }, null, 2));
}

function makeStatus(overrides: Partial<DemoBuilderStatus> & { project: string; project_repo_path: string }): DemoBuilderStatus {
  return {
    session_id: 'sid',
    phase: 'awaiting-review',
    iteration: 1,
    prompt: '',
    updated_at: new Date().toISOString(),
    ...overrides,
  } as DemoBuilderStatus;
}

async function post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-served-headers-'));
  projectsRoot = join(forgeRoot, 'projects');
  logsRoot = join(forgeRoot, '_logs');
  mkdirSync(repoDir(), { recursive: true });

  // Route 1 — GET /api/artifact/<cycleId>/<filename>
  mkdirSync(join(logsRoot, CYCLE_ID, 'artifacts'), { recursive: true });
  writeFileSync(join(logsRoot, CYCLE_ID, 'artifacts', 'PLAN.html'), '<!doctype html><body>plan</body>');
  writeFileSync(join(logsRoot, CYCLE_ID, 'artifacts', 'note.md'), '# note');
  writeFileSync(join(logsRoot, CYCLE_ID, 'artifacts', 'data.json'), '{}');
  // A POSIX-legal filename with an embedded quote — isSafeSubPath does NOT
  // reject this (only control characters), so it is the genuine probe for
  // whether `sanitizeHeaderFilename` (not the path guard) stops a quote
  // breaking out of `content-disposition: inline; filename="..."`.
  writeFileSync(join(logsRoot, CYCLE_ID, 'artifacts', 'evil".html'), '<!doctype html><body>quote</body>');

  // Route 2 — GET /api/architect/file/<project>/<sid>/<filename>
  mkdirSync(join(repoDir(), '_architect', ARCH_SID), { recursive: true });
  writeFileSync(join(repoDir(), '_architect', ARCH_SID, 'PLAN.html'), '<!doctype html><body>arch plan</body>');

  // Route 3 — GET /api/instructions/file/<project>/<sid>/<filename>
  mkdirSync(join(repoDir(), '_instructions', INSTR_SID), { recursive: true });
  writeFileSync(join(repoDir(), '_instructions', INSTR_SID, 'AGENTS.draft.md'), '# draft');

  // Routes 4+5 — GET /api/demo-builder/demo/<project>/<sid> and
  // GET /api/demo-builder/fragment/<project>/<sid>/<element>
  mkdirSync(join(repoDir(), '.forge', 'demo', 'fragments'), { recursive: true });
  writeFileSync(join(repoDir(), '.forge', 'demo', 'DEMO.html'), '<!doctype html><body>demo</body>');
  writeFileSync(join(repoDir(), '.forge', 'demo', 'fragments', 'hero.html'), '<section>hero</section>');
  plantStatus(
    join(repoDir(), '_demo', DEMO_SID),
    makeStatus({ session_id: DEMO_SID, project: 'demo', project_repo_path: repoDir() }),
  );

  // Route 7 — GET /api/demo-builder/history/<project>/<id>
  mkdirSync(join(repoDir(), '.forge', 'demo', 'history', HIST_ID), { recursive: true });
  writeFileSync(join(repoDir(), '.forge', 'demo', 'history', HIST_ID, 'DEMO.html'), '<!doctype html><body>history demo</body>');
  writeFileSync(
    join(repoDir(), '.forge', 'demo', 'history', HIST_ID, 'meta.json'),
    JSON.stringify({ locked_at: '2026-08-23T00:00:00.000Z', prompt: 'x', iterations: 1 }),
  );

  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));

  // Route 6 — GET /api/demo-builder/generation/<project>/<sid>/<n>/<filename>.
  // Minted through the real /start route (so status.json + project_repo_path
  // are exactly what a real session carries), then the generation snapshot is
  // written directly onto disk — mirrors cli/ui-bridge-demo-generations.test.ts.
  const { json } = await post('/api/demo-builder/start', { project: 'demo' });
  genSid = json.sessionId as string;
  const genDir = join(repoDir(), '_demo', genSid, 'generations', '1');
  mkdirSync(genDir, { recursive: true });
  writeFileSync(join(genDir, 'DEMO.html'), '<!doctype html><body>generation</body>');
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// (1) Per-route hardening headers, driven through the REAL request path.
// ---------------------------------------------------------------------------

const EXPECTED_CSP =
  "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";

type RouteCase = {
  name: string;
  path: () => string;
  wantContentTypeFamily: 'html' | 'plain';
  wantDispositionFilename: string;
};

const ROUTES: RouteCase[] = [
  {
    name: 'GET /api/artifact/<cycleId>/<filename> (.html)',
    path: () => `/api/artifact/${CYCLE_ID}/PLAN.html`,
    wantContentTypeFamily: 'html',
    wantDispositionFilename: 'PLAN.html',
  },
  {
    name: 'GET /api/architect/file/<project>/<sid>/<filename>',
    path: () => `/api/architect/file/demo/${encodeURIComponent(ARCH_SID)}/PLAN.html`,
    wantContentTypeFamily: 'html',
    wantDispositionFilename: 'PLAN.html',
  },
  {
    name: 'GET /api/instructions/file/<project>/<sid>/<filename> (.md)',
    path: () => `/api/instructions/file/demo/${encodeURIComponent(INSTR_SID)}/AGENTS.draft.md`,
    wantContentTypeFamily: 'plain',
    wantDispositionFilename: 'AGENTS.draft.md',
  },
  {
    name: 'GET /api/demo-builder/demo/<project>/<sid> (DEMO.html)',
    path: () => `/api/demo-builder/demo/demo/${DEMO_SID}`,
    wantContentTypeFamily: 'html',
    wantDispositionFilename: 'DEMO.html',
  },
  {
    name: 'GET /api/demo-builder/fragment/<project>/<sid>/<element>',
    path: () => `/api/demo-builder/fragment/demo/${DEMO_SID}/hero`,
    wantContentTypeFamily: 'html',
    wantDispositionFilename: 'hero.html',
  },
  {
    name: 'GET /api/demo-builder/generation/<project>/<sid>/<n>/<filename>',
    path: () => `/api/demo-builder/generation/demo/${genSid}/1/DEMO.html`,
    wantContentTypeFamily: 'html',
    wantDispositionFilename: 'DEMO.html',
  },
  {
    name: 'GET /api/demo-builder/history/<project>/<id> (DEMO.html)',
    path: () => `/api/demo-builder/history/demo/${HIST_ID}`,
    wantContentTypeFamily: 'html',
    wantDispositionFilename: 'DEMO.html',
  },
];

for (const rc of ROUTES) {
  test(`${rc.name} — 200 carries CSP + nosniff + content-disposition`, async () => {
    const res = await fetch(`${url}${rc.path()}`);
    const body = await res.text();
    assert.equal(res.status, 200, `expected 200 from ${rc.path()} — got ${res.status}: ${body}`);

    const ct = res.headers.get('content-type') ?? '';
    if (rc.wantContentTypeFamily === 'html') {
      assert.match(ct, /^text\/html/, `content-type must stay text/html for an .html artifact (iframe regression) — got "${ct}"`);
    } else {
      assert.match(ct, /^text\/plain/, `non-.html artifacts must stay text/plain — got "${ct}"`);
    }

    assert.equal(
      res.headers.get('x-content-type-options'),
      'nosniff',
      `${rc.path()} must carry x-content-type-options: nosniff`,
    );
    assert.equal(
      res.headers.get('content-security-policy'),
      EXPECTED_CSP,
      `${rc.path()} must carry the sandboxing content-security-policy`,
    );
    assert.equal(
      res.headers.get('content-disposition'),
      `inline; filename="${rc.wantDispositionFilename}"`,
      `${rc.path()} must carry an INLINE content-disposition (never attachment — that would break the sandboxed iframe render) with the expected sanitised filename`,
    );
  });
}

// ---------------------------------------------------------------------------
// (3) .html vs .md/.json content-type family (iframe regression pin) — also
// covered per-route above; this adds the same-cycle .md/.json siblings so the
// distinction is proven on TWO files served by the SAME route, not just
// inferred across different routes.
// ---------------------------------------------------------------------------

test('GET /api/artifact/ — .md and .json artifacts stay text/plain, not text/html', async () => {
  for (const filename of ['note.md', 'data.json']) {
    const res = await fetch(`${url}/api/artifact/${CYCLE_ID}/${filename}`);
    assert.equal(res.status, 200, `expected 200 for ${filename}`);
    assert.match(res.headers.get('content-type') ?? '', /^text\/plain/, `${filename} must be text/plain, not text/html`);
    // Non-HTML files get the SAME hardening headers — strictly safer, costs nothing.
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('content-security-policy'), EXPECTED_CSP);
  }
});

// ---------------------------------------------------------------------------
// (4) Header injection.
// ---------------------------------------------------------------------------

test('quote in filename cannot break the content-disposition quoted-string (sanitiser is load-bearing here — isSafeSubPath does not reject a bare ")', async () => {
  const res = await fetch(`${url}/api/artifact/${CYCLE_ID}/${encodeURIComponent('evil".html')}`);
  const body = await res.text();
  assert.equal(res.status, 200, `expected the real quote-named file to be served (proves isSafeSubPath does NOT reject it) — got ${res.status}: ${body}`);
  const disp = res.headers.get('content-disposition');
  assert.equal(disp, 'inline; filename="evil_.html"', 'the quote must be sanitised out of the header value, not passed through raw');
  assert.doesNotMatch(disp ?? '', /^inline; filename="[^"]*".+/, 'the header value must be well-formed: exactly one quoted filename, nothing trailing');
});

test('CR/LF in a filename never reaches a header — REFUSED by the existing path guard (isSafeSubPath), not by this WI\'s sanitiser', async () => {
  const malicious = 'evil\r\nX-Injected: 1.html';
  const res = await fetch(`${url}/api/artifact/${CYCLE_ID}/${encodeURIComponent(malicious)}`);
  const body = await res.text();
  assert.equal(
    res.status,
    400,
    `a filename carrying CR/LF must be refused at the isSafeSubPath gate BEFORE any header is built (control characters are already in its deny-list) — got ${res.status}: ${body}`,
  );
  assert.equal(res.headers.get('x-injected'), null, 'sanity: no header was actually injected');
});

test('quote in the demo-builder generation filename — REFUSED by GENERATION_FILENAME_RE (a strict allowlist), sanitiser is unreachable here', async () => {
  const res = await fetch(`${url}/api/demo-builder/generation/demo/${genSid}/1/${encodeURIComponent('evil".html')}`);
  assert.equal(res.status, 400, 'GENERATION_FILENAME_RE (^[A-Za-z0-9._-]+$) already excludes a bare quote — 400 before any header is built');
});

// ---------------------------------------------------------------------------
// (2) Enumeration ratchet — closes the class for the EIGHTH route.
// ---------------------------------------------------------------------------

/** Locate `function <needle>` in `src` and return the [start, end) byte range
 *  of its whole body (signature through the matching closing brace), via
 *  simple depth-counted brace matching from the first `{` after the
 *  signature. Fails loudly (not silently `undefined`) if the function or a
 *  balanced brace cannot be found — a missing helper is itself RED evidence,
 *  not a false green. */
function extractFunctionSpan(src: string, signatureNeedle: string): { start: number; end: number } {
  const sigIdx = src.indexOf(signatureNeedle);
  assert.ok(
    sigIdx >= 0,
    `expected to find "${signatureNeedle}" in cli/ui-bridge.ts — the hardening helper this ratchet checks against does not exist (yet). ` +
      `Add a servedFileHeaders(filename, origin) helper that returns the complete header object (content-type + the hardening headers + ` +
      `access-control-allow-origin/vary) and route every served-file 200 response through it.`,
  );
  const braceStart = src.indexOf('{', sigIdx);
  assert.ok(braceStart >= 0, `expected an opening brace after "${signatureNeedle}"`);
  let depth = 0;
  let i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  assert.ok(depth === 0 && i < src.length, `unbalanced braces while scanning the body of "${signatureNeedle}"`);
  return { start: sigIdx, end: i + 1 };
}

/** 1-based line number of byte offset `idx` in `src` (for a readable failure). */
function lineOf(src: string, idx: number): number {
  return src.slice(0, idx).split('\n').length;
}

test('enumeration ratchet: contentTypeFor has NO direct callers in cli/ui-bridge.ts outside servedFileHeaders', () => {
  const src = readFileSync(join(import.meta.dirname, 'ui-bridge.ts'), 'utf8');
  const helper = extractFunctionSpan(src, 'function servedFileHeaders(');

  // Every CALL-shaped occurrence of contentTypeFor( — i.e. not its own
  // `function contentTypeFor(` declaration — must fall inside servedFileHeaders's
  // body. A route that calls contentTypeFor directly (bypassing the hardening
  // helper) is exactly the regression this ratchet exists to catch.
  const callRe = /(?<!function )\bcontentTypeFor\(/g;
  const callSitesOutsideHelper: number[] = [];
  let callSitesInsideHelper = 0;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(src)) !== null) {
    if (m.index >= helper.start && m.index < helper.end) {
      callSitesInsideHelper++;
    } else {
      callSitesOutsideHelper.push(m.index);
    }
  }

  assert.ok(
    callSitesInsideHelper >= 1,
    'sanity check failed: servedFileHeaders itself does not appear to call contentTypeFor — the ratchet mechanism (brace-matched span detection) may be broken, not just the code under test',
  );
  assert.deepEqual(
    callSitesOutsideHelper.map((idx) => `cli/ui-bridge.ts:${lineOf(src, idx)}`),
    [],
    'contentTypeFor was called directly outside servedFileHeaders. Every route that serves a file on the bridge origin must obtain its ' +
      'content-type via servedFileHeaders(filename, origin) — never contentTypeFor(filename) directly — so the CSP / ' +
      'x-content-type-options / content-disposition hardening headers ride along automatically. Route the new call site through ' +
      'servedFileHeaders instead.',
  );
});

test('enumeration re-derivation: exactly 7 res.writeHead(200, ...) call sites reference the hardening helper, across the host AND the carved session routes', () => {
  // This pin is defense-in-depth for a security invariant: every file served on
  // the bridge origin must get its content-type through `servedFileHeaders`, so
  // the CSP / x-content-type-options / content-disposition hardening rides along.
  //
  // M4's session-routes carve moved one of the seven call sites out of
  // `cli/ui-bridge.ts` and into `@forge/sessions`, where the helper arrives
  // injected and so reads `ctx.servedFileHeaders(`. Decrementing this count to 6
  // would have kept the test green while the guard went BLIND to the route that
  // moved — a defense-in-depth lint has to follow the dispatch it backstops.
  // So the pin now spans both files and states the split.
  const FILES = [
    { path: join(import.meta.dirname, 'ui-bridge.ts'), rel: 'cli/ui-bridge.ts', expected: 6 },
    {
      path: join(import.meta.dirname, '..', 'packages', 'sessions', 'bridge-studio-architect.ts'),
      rel: 'packages/sessions/bridge-studio-architect.ts',
      expected: 1,
    },
  ];
  let total = 0;
  for (const f of FILES) {
    const src = readFileSync(f.path, 'utf8');
    const matches = [...src.matchAll(/res\.writeHead\(200, (?:ctx\.)?servedFileHeaders\(/g)];
    assert.equal(
      matches.length,
      f.expected,
      `${f.rel}: expected ${f.expected} call site(s) of res.writeHead(200, servedFileHeaders(...)) — found ${matches.length} at lines ` +
        `${matches.map((mm) => lineOf(src, mm.index ?? 0)).join(', ')}. If a route was added, removed or CARVED, update this pin ` +
        'deliberately — and if it was carved, add its new home to FILES rather than lowering a count, or this guard stops watching it.',
    );
    total += matches.length;
  }
  assert.equal(total, 7, `the invariant is about the seven served-file routes as a whole, wherever they live — found ${total}`);
});
