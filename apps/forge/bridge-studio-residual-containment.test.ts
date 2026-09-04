/**
 * ACCEPTANCE TESTS (must be RED until fixed) — bd `forge-2zz`: four
 * LEXICAL-ONLY containment defects (`resolve()`+`startsWith()`, or a charset
 * regex, with NO realpath anywhere), driven through the REAL bridge routes
 * (`startBridge`), mirroring the fixture idiom of
 * packages/knowledge/tests/integration/bridge-studio-kbs-containment.test.ts.
 *
 * Governing rule for every "leak" assertion below: the test plants a UNIQUE
 * secret marker string outside the forge root and asserts that marker does
 * NOT appear anywhere in the response body. A bare status-code check would
 * pass identically for an unrelated 500/404, so every escape here reads the
 * response body and asserts on its content (or, where the response shape
 * carries no free-text field — items 2/3 — on the STATE VALUE derived from
 * the outside content, which is the equivalent observable signal).
 *
 * The four items (see the task brief / bead forge-2zz for the full defect
 * writeups):
 *   1. GET /api/runs/:id/phases/:node/log (apps/forge/bridge-studio.ts) — no
 *      charset gate at all; a lexical resolve()+startsWith() check that
 *      never resolves symlinks, AND a route regex that approves a raw url
 *      BEFORE decodeURIComponent ever turns a %2F into a real separator.
 *   2. readBrainFixState (packages/knowledge/bridge-studio-kbs.ts) — `_logs/_brainfix-<id>`
 *      resolved with a bare `join()`, no realpath.
 *   3. readPreflightFixState (apps/forge/bridge-studio.ts) — byte-for-byte the same
 *      shape as (2) with `_preflight-fix-<id>`.
 *   4. POST /api/studio/kbs/:id/maintenance op=fix-agent
 *      (packages/knowledge/bridge-studio-kbs.ts) — a full absolute path validated only by
 *      `abs !== file` (blocks `..`-normalization) + a lexical
 *      `startsWith(brainRoot+sep)` (never realpath), forwarded to a spawned
 *      `brain fix --file` process.
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
  existsSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { connect } from 'node:net';

import { startBridge } from './ui-bridge.ts';
import { resolveGuardedPath } from '@forge/kernel';

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// ---------------------------------------------------------------------------
// Global fixture: one shared bridge over one tmp forgeRoot, with every escape
// shape planted in `before()` (mirrors bridge-studio-kbs-containment.test.ts's
// single-fixture-block idiom). Symlink targets that must survive the whole
// file live in `outsideDirs`, cleaned up in `after()`.
// ---------------------------------------------------------------------------

let forgeRoot: string;
let logsRoot: string;
let bridgeUrl: string;
let bridgeHost: string;
let bridgePort: number;
let closeBridge: () => Promise<void>;
const outsideDirs: string[] = [];
let symlinksUnavailable = false;

function newOutsideDir(prefix: string): string {
  const d = tmp(prefix);
  outsideDirs.push(d);
  return d;
}

// ---- Item 1 fixture identifiers -------------------------------------------
const P1_SYMLINK_MARKER = 'SECRET-MARKER-PHASELOG-SYMLINK-7d21f';
const P1_WIRE_MARKER = 'SECRET-MARKER-PHASELOG-WIRE-4b8ac';
let p1SymlinkOutside: string;
let p1WireOutside: string;
const P1_LEGIT_RUN_ID = '2026-08-22.cycle-abc123'; // '.' AND '-' — this route has no charset gate
const P1_LEGIT_TEXT = 'legit-phaselog-event-9c31';
// Attack-the-fix (mandate item: over-strict rejection of a legal ".."-PREFIXED
// name, distinct from the literal ".." segment isSafeSegment correctly
// rejects). '..dotdot-run' is a perfectly legal directory-entry name.
const P1_DOTDOT_PREFIX_RUN_ID = '..dotdot-run';
const P1_DOTDOT_PREFIX_TEXT = 'legit-dotdot-prefix-event-3fa1';

// ---- Item 2 fixture identifiers --------------------------------------------
let p2Outside: string;
const P2_EVIL_RUN_ID = 'evilbrainfix'; // SAFE_ID_RE-valid (alnum only)
const P2_LEGIT_RUN_ID = 'legit-brainfix-run'; // SAFE_ID_RE allows '-', not '.'

// ---- Item 3 fixture identifiers --------------------------------------------
let p3Outside: string;
const P3_EVIL_RUN_ID = 'evilpreflight';
const P3_LEGIT_RUN_ID = 'legit-preflight-run';

// ---- Item 4 fixture identifiers --------------------------------------------
let p4Outside: string;
const P4_OUTSIDE_BYTES = 'OUTSIDE ORIGINAL BYTES ITEM4 — must not change.\n';

before(async () => {
  forgeRoot = tmp('bridge-residual-containment-');
  logsRoot = join(forgeRoot, '_logs');

  for (const state of ['in-flight', 'done', 'failed', 'pending', 'ready-for-review']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(logsRoot, { recursive: true });
  mkdirSync(join(forgeRoot, 'brain'), { recursive: true });

  // ---- Item 1(a): _logs/evilphaselog -> outside dir (top-level symlink) --
  p1SymlinkOutside = newOutsideDir('p1-symlink-outside-');
  writeFileSync(
    join(p1SymlinkOutside, 'events.jsonl'),
    JSON.stringify({
      event_type: 'log',
      phase: 'leaknode',
      message: P1_SYMLINK_MARKER,
      started_at: '2026-01-01T00:00:00.000Z',
    }) + '\n',
  );
  try {
    symlinkSync(p1SymlinkOutside, join(logsRoot, 'evilphaselog'), 'dir');
  } catch {
    symlinksUnavailable = true;
  }

  // ---- Item 1(b): _logs/evilwirelink -> outside dir, reached ONLY via a --
  // decoded %2F..%2F payload (no top-level plain-id request would find it
  // under the name an attacker actually sends).
  p1WireOutside = newOutsideDir('p1-wire-outside-');
  writeFileSync(
    join(p1WireOutside, 'events.jsonl'),
    JSON.stringify({
      event_type: 'log',
      phase: 'wirenode',
      message: P1_WIRE_MARKER,
      started_at: '2026-01-01T00:00:00.000Z',
    }) + '\n',
  );
  try {
    symlinkSync(p1WireOutside, join(logsRoot, 'evilwirelink'), 'dir');
  } catch {
    symlinksUnavailable = true;
  }

  // ---- Item 1(c): legitimate run, dot+dash id, real dir -------------------
  mkdirSync(join(logsRoot, P1_LEGIT_RUN_ID), { recursive: true });
  writeFileSync(
    join(logsRoot, P1_LEGIT_RUN_ID, 'events.jsonl'),
    JSON.stringify({
      event_type: 'log',
      phase: 'legitnode',
      message: P1_LEGIT_TEXT,
      started_at: '2026-01-01T00:00:00.000Z',
    }) + '\n',
  );

  // ---- Item 1(d) attack-the-fix: a run id LEGALLY beginning with ".." -----
  mkdirSync(join(logsRoot, P1_DOTDOT_PREFIX_RUN_ID), { recursive: true });
  writeFileSync(
    join(logsRoot, P1_DOTDOT_PREFIX_RUN_ID, 'events.jsonl'),
    JSON.stringify({
      event_type: 'log',
      phase: 'dotdotnode',
      message: P1_DOTDOT_PREFIX_TEXT,
      started_at: '2026-01-01T00:00:00.000Z',
    }) + '\n',
  );

  // ---- Item 2(a): _logs/_brainfix-evilbrainfix -> outside dir -------------
  p2Outside = newOutsideDir('p2-brainfix-outside-');
  writeFileSync(
    join(p2Outside, 'events.jsonl'),
    JSON.stringify({ event_type: 'end', message: 'brain-fix.end', metadata: { cleared: true } }) + '\n',
  );
  try {
    symlinkSync(p2Outside, join(logsRoot, `_brainfix-${P2_EVIL_RUN_ID}`), 'dir');
  } catch {
    symlinksUnavailable = true;
  }

  // ---- Item 2(b): legitimate, real _brainfix-<id> dir ----------------------
  mkdirSync(join(logsRoot, `_brainfix-${P2_LEGIT_RUN_ID}`), { recursive: true });
  writeFileSync(
    join(logsRoot, `_brainfix-${P2_LEGIT_RUN_ID}`, 'events.jsonl'),
    JSON.stringify({ event_type: 'end', message: 'brain-fix.end', metadata: { cleared: true } }) + '\n',
  );

  // ---- Item 3(a): _logs/_preflight-fix-evilpreflight -> outside dir -------
  p3Outside = newOutsideDir('p3-preflight-outside-');
  writeFileSync(
    join(p3Outside, 'events.jsonl'),
    JSON.stringify({ event_type: 'end', message: 'preflight-fix.end', metadata: { cleared: true } }) + '\n',
  );
  try {
    symlinkSync(p3Outside, join(logsRoot, `_preflight-fix-${P3_EVIL_RUN_ID}`), 'dir');
  } catch {
    symlinksUnavailable = true;
  }

  // ---- Item 3(b): legitimate, real _preflight-fix-<id> dir -----------------
  mkdirSync(join(logsRoot, `_preflight-fix-${P3_LEGIT_RUN_ID}`), { recursive: true });
  writeFileSync(
    join(logsRoot, `_preflight-fix-${P3_LEGIT_RUN_ID}`, 'events.jsonl'),
    JSON.stringify({ event_type: 'end', message: 'preflight-fix.end', metadata: { cleared: true } }) + '\n',
  );

  // ---- Item 4: brain/legitkb/_raw -> outside dir (symlinked intermediate) -
  p4Outside = newOutsideDir('p4-brain-outside-');
  writeFileSync(join(p4Outside, 'secret.md'), P4_OUTSIDE_BYTES);
  mkdirSync(join(forgeRoot, 'brain', 'legitkb'), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'legitkb', 'kb.yaml'), 'id: legitkb\nname: Legit KB\nbinding: { kind: unique }\ndesc: d\n');
  try {
    symlinkSync(p4Outside, join(forgeRoot, 'brain', 'legitkb', '_raw'), 'dir');
  } catch {
    symlinksUnavailable = true;
  }

  // ---- Item 4 positive-space fixture: a legitimate, real, dot+dash file ---
  mkdirSync(join(forgeRoot, 'brain', 'legitkb2', 'themes'), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'legitkb2', 'themes', 'my-theme-v2.final.md'), '# Theme\n');
  // Attack-the-fix: a filename LEGALLY beginning with ".." is not the literal
  // ".." segment isSafeSegment correctly rejects.
  writeFileSync(join(forgeRoot, 'brain', 'legitkb2', 'themes', '..dotdot-theme.md'), '# Dotdot Theme\n');

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
  const parsed = new URL(bridgeUrl);
  bridgeHost = parsed.hostname;
  bridgePort = Number(parsed.port);
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

/**
 * Issue a raw HTTP/1.1 GET request over a hand-built TCP socket — no `fetch`,
 * no `URL`, no client-side path normalization of any kind. Required for the
 * item-1 wire-level percent-encoded test: the exploit shape depends on the
 * server's route REGEX approving a raw url whose `%2F..%2F` has not yet been
 * decoded, which a client library's own URL handling must never be allowed
 * to pre-empt.
 */
async function rawGet(rawPathAndQuery: string): Promise<{ status: number; text: string }> {
  return new Promise((resolvePromise, reject) => {
    const socket = connect(bridgePort, bridgeHost, () => {
      socket.write(
        `GET ${rawPathAndQuery} HTTP/1.1\r\n` +
          `Host: ${bridgeHost}:${bridgePort}\r\n` +
          `Connection: close\r\n` +
          `\r\n`,
      );
    });
    let raw = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => { raw += chunk; });
    socket.on('error', reject);
    socket.on('end', () => {
      const sepIdx = raw.indexOf('\r\n\r\n');
      if (sepIdx === -1) { resolvePromise({ status: 0, text: raw }); return; }
      const statusLine = raw.slice(0, sepIdx).split('\r\n')[0];
      const body = raw.slice(sepIdx + 4);
      const match = statusLine.match(/^HTTP\/1\.\d (\d+)/);
      resolvePromise({ status: match ? Number(match[1]) : 0, text: body });
    });
  });
}

// ===========================================================================
// ITEM 1 — GET /api/runs/:id/phases/:node/log
// ===========================================================================

test('[item1a] RED: GET /api/runs/evilphaselog/phases/leaknode/log leaks outside content through a top-level symlinked run dir', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const { text } = await get('/api/runs/evilphaselog/phases/leaknode/log');
  assert.ok(
    !text.includes(P1_SYMLINK_MARKER),
    `the phase-log response must NOT contain the outside secret — got: ${text}. The lexical resolve()+startsWith() check never resolves the symlink; existsSync follows it straight through.`,
  );
});

test('[item1b] RED (wire-level, hand-built socket): a raw request whose path contains a literal %2F..%2F reaches evilwirelink and must not leak', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  // Decoded runId = 'x/../evilwirelink' — collapses (via the OLD code's own
  // resolve()) to 'evilwirelink', a real symlinked dir under _logs/. The raw
  // (pre-decode) request-line token is 'x%2F..%2FevilwirelinkLink' — a SINGLE
  // opaque `[^/]+` group with no literal '/', so the route regex matches; only
  // decodeURIComponent (which runs AFTER the regex has already approved the
  // match) turns %2F into a real separator.
  const { text } = await rawGet('/api/runs/x%2F..%2Fevilwirelink/phases/wirenode/log');
  assert.ok(
    !text.includes(P1_WIRE_MARKER),
    `the phase-log response (reached via a raw %2F..%2F path) must NOT contain the outside secret — got: ${text}`,
  );
});

test('[item1c] non-regression: a legitimate run id containing "." and "-" still returns its own log', async () => {
  const { status, text } = await get(`/api/runs/${P1_LEGIT_RUN_ID}/phases/legitnode/log`);
  assert.equal(status, 200, `expected 200, got ${status}: ${text}`);
  assert.ok(text.includes(P1_LEGIT_TEXT), `expected the legitimate event text in the response — got: ${text}`);
});

test('[item1d] attack-the-fix (over-strict rejection check): a run id LEGALLY beginning with ".." (e.g. "..dotdot-run", not equal to literal "..") must still succeed', async () => {
  const { status, text } = await get(`/api/runs/${encodeURIComponent(P1_DOTDOT_PREFIX_RUN_ID)}/phases/dotdotnode/log`);
  assert.equal(status, 200, `expected 200, got ${status}: ${text}`);
  assert.ok(text.includes(P1_DOTDOT_PREFIX_TEXT), `expected the legitimate event text in the response — got: ${text}`);
});

// ===========================================================================
// ITEM 2 — readBrainFixState (_logs/_brainfix-<runId>)
// ===========================================================================

test('[item2a] RED: GET fix-agent status for a symlinked _brainfix-<id> dir must NOT report the outside file\'s terminal state', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const { status, text } = await get(`/api/studio/kbs/anykb/fix-agent/${P2_EVIL_RUN_ID}`);
  assert.equal(status, 200, `expected 200 (fail-soft), got ${status}: ${text}`);
  const json = JSON.parse(text) as { state: string; cleared: boolean };
  // This route's response shape carries no free-text field — state/cleared
  // ARE the observable signal derived from outside content, the equivalent
  // of the marker-in-body idiom used elsewhere. A guard that follows the
  // symlink reports {state:'cleared', cleared:true} straight from the
  // outside file; a guard that rejects it collapses to the SAME
  // {state:'running', cleared:false} a never-started run reports.
  assert.equal(json.state, 'running', `expected the guard to fail-soft to 'running', got state=${json.state} (text=${text})`);
  assert.equal(json.cleared, false, `expected cleared:false, got ${json.cleared} (text=${text})`);
});

test('[item2b] non-regression: a legitimate, real _brainfix-<id> dir with a hyphenated id still reports its real terminal state', async () => {
  const { status, text } = await get(`/api/studio/kbs/anykb/fix-agent/${P2_LEGIT_RUN_ID}`);
  assert.equal(status, 200, `expected 200, got ${status}: ${text}`);
  const json = JSON.parse(text) as { state: string; cleared: boolean };
  assert.equal(json.state, 'cleared', `expected the real terminal state to round-trip — got ${JSON.stringify(json)}`);
  assert.equal(json.cleared, true);
});

// ===========================================================================
// ITEM 3 — readPreflightFixState (_logs/_preflight-fix-<runId>)
// ===========================================================================

test('[item3a] RED: GET preflight fix-agent status for a symlinked _preflight-fix-<id> dir must NOT report the outside file\'s terminal state', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const { status, text } = await get(`/api/studio/projects/anyproj/preflight/fix-agent/${P3_EVIL_RUN_ID}`);
  assert.equal(status, 200, `expected 200 (fail-soft), got ${status}: ${text}`);
  const json = JSON.parse(text) as { state: string; cleared: boolean };
  assert.equal(json.state, 'running', `expected the guard to fail-soft to 'running', got state=${json.state} (text=${text})`);
  assert.equal(json.cleared, false, `expected cleared:false, got ${json.cleared} (text=${text})`);
});

test('[item3b] non-regression: a legitimate, real _preflight-fix-<id> dir with a hyphenated id still reports its real terminal state', async () => {
  const { status, text } = await get(`/api/studio/projects/anyproj/preflight/fix-agent/${P3_LEGIT_RUN_ID}`);
  assert.equal(status, 200, `expected 200, got ${status}: ${text}`);
  const json = JSON.parse(text) as { state: string; cleared: boolean };
  assert.equal(json.state, 'cleared', `expected the real terminal state to round-trip — got ${JSON.stringify(json)}`);
  assert.equal(json.cleared, true);
});

// ===========================================================================
// ITEM 4 — POST /api/studio/kbs/:id/maintenance op=fix-agent
// ===========================================================================

test('[item4a] RED (headline repro): op=fix-agent through a symlinked brain/legitkb/_raw must NOT write/dispatch against the outside file', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outsideFile = join(p4Outside, 'secret.md');
  const before_ = readFileSync(outsideFile, 'utf8');
  const logsBefore = existsSync(logsRoot) ? readdirSync(logsRoot) : [];

  const targetFile = join(forgeRoot, 'brain', 'legitkb', '_raw', 'secret.md');
  const { status, text } = await post('/api/studio/kbs/legitkb/maintenance', {
    op: 'fix-agent', file: targetFile, check: 'x', kind: 'y',
  });

  // Artifact assertion, not a bare status code: the outside file's bytes
  // must be byte-for-byte unchanged.
  const after_ = readFileSync(outsideFile, 'utf8');
  assert.equal(after_, before_, `the outside file's bytes must be unchanged — status was ${status}, body=${text}`);

  // No dispatch happened: spawnBrainFix's FIRST action is mkdirSync on its
  // own `_logs/_brainfix-<runId>` log dir, so an unchanged _logs listing
  // (modulo the fixture dirs already seeded in before()) proves no `brain
  // fix` process was ever spawned against this target.
  const logsAfter = existsSync(logsRoot) ? readdirSync(logsRoot) : [];
  const newBrainfixDirs = logsAfter.filter((d) => d.startsWith('_brainfix-legitkb-') && !logsBefore.includes(d));
  assert.deepEqual(newBrainfixDirs, [], `no _brainfix-legitkb-* run dir may appear — a symlinked _raw/ was accepted and dispatched. logsAfter=${JSON.stringify(logsAfter)}`);

  assert.equal(status, 400, `expected the guard to reject with 400, got ${status}: ${text}`);
});

test('[item4b] non-regression (direct unit check of the fixed route\'s own transformation): a legitimate, real, dot+dash file under brain/ is accepted and identity-resolves correctly', () => {
  // NOT driven through the live HTTP route deliberately: a successful
  // op=fix-agent dispatch spawns a REAL detached `forge brain fix` agent
  // process (the Claude Agent SDK), with real cost/time — something no other
  // test in cli/bridge-studio-kbs.test.ts does either (every existing
  // fix-agent test there is either a 400 rejection or gated behind
  // FORGE_DRY_BRIDGE=1, which short-circuits BEFORE this guard is ever
  // reached, so it cannot exercise the guard's ACCEPT path either). This
  // test instead replicates, byte-for-byte, the SAME transformation the
  // fixed route performs (see packages/knowledge/bridge-studio-kbs.ts's op=fix-agent
  // branch: `relative(brainRoot, abs)` then `resolveGuardedPath(brainRoot,
  // rel.split(sep))`) against a real fixture file, proving the fix does not
  // over-reject a legitimate path.
  const brainRoot = resolve(forgeRoot, 'brain');
  const abs = resolve(join(brainRoot, 'legitkb2', 'themes', 'my-theme-v2.final.md'));
  const rel = relative(brainRoot, abs);
  const result = resolveGuardedPath(brainRoot, rel.split(sep));
  assert.equal(result.ok, true, `expected the guard to accept a legitimate dot+dash filename — got ${JSON.stringify(result)}`);
  if (result.ok) {
    assert.equal(result.exists, true, 'the fixture file genuinely exists and must resolve as exists:true');
    assert.equal(result.realPath, abs, 'the resolved realPath must match the real absolute path (no symlinks involved)');
  }
});

test('[item4c] non-regression (route-level): op=fix-agent still rejects an outside absolute path with the SAME 400 as before (unrelated to this fix, pinned so the diff cannot regress it)', async () => {
  const { status } = await post('/api/studio/kbs/legitkb/maintenance', {
    op: 'fix-agent', file: '/etc/passwd', check: 'x', kind: 'y',
  });
  assert.equal(status, 400);
});

test('[item4d] attack-the-fix (over-strict rejection check): a filename LEGALLY beginning with ".." (e.g. "..dotdot-theme.md") is accepted by the guard\'s own transformation', () => {
  const brainRoot = resolve(forgeRoot, 'brain');
  const abs = resolve(join(brainRoot, 'legitkb2', 'themes', '..dotdot-theme.md'));
  const rel = relative(brainRoot, abs);
  const result = resolveGuardedPath(brainRoot, rel.split(sep));
  assert.equal(result.ok, true, `expected the guard to accept a legal ".."-prefixed filename — got ${JSON.stringify(result)}`);
  if (result.ok) {
    assert.equal(result.exists, true);
    assert.equal(result.realPath, abs);
  }
});
