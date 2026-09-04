/**
 * ACCEPTANCE TESTS — R6-04-F2, WI-1 "materials contract enforcement + guarded
 * staging": the agent-kickoff upload seam. `POST /api/agents/:slug/run`
 * (apps/forge/ui-bridge.ts ~line 1148-1222) gains an optional body field
 * `materials?: Array<{filename, contentBase64}>`. This is the FIRST caller of
 * `agentAcceptsMaterial` (orchestrator/studio/materials.ts) — that gate has
 * existed since R2-09 with zero callers; this is its named enforcement point.
 *
 * NONE of this exists at HEAD: the route does not read `body.materials` at
 * all today, `materialKindForFilename`/the three cap constants do not exist
 * in materials.ts (see orchestrator/studio/materials.test.ts's RED proof for
 * those), and no route-level materials handling exists in apps/forge/ui-bridge.ts.
 * A materials-bearing request today is simply ignored — the field is dropped
 * on the floor and the request proceeds exactly as if `materials` were
 * absent. That is why several "must be 400" tests below are RED for the
 * simplest possible reason (today: 200, not 400) while a few "back-compat"
 * tests are already green (labeled as non-regression anchors, not proof of
 * anything new).
 *
 * Harness: FORGE_DRY_BRIDGE=1 (not FORGE_ARCHITECT_NO_SPAWN) — chosen
 * DELIBERATELY over the sibling ui-bridge-agent-run.test.ts's NO_SPAWN-only
 * harness, because NO_SPAWN-only suppression is silent (dryBridgeAgentTurnMarker
 * returns `{}` and emits nothing — cli/dry-bridge.ts L312-314), which would
 * make "no spawn was attempted" on a refusal path untestable except by
 * trusting absence — exactly what immutable-gates forbids ("assert the
 * suppression/no-spawn record rather than trusting absence"). Under
 * FORGE_DRY_BRIDGE=1, a genuine dispatch attempt is a REAL, checkable
 * artifact: the 200 response body carries `dryBridge:{skipped:['agent-turn']}`
 * and a `dry-bridge.skip` event lands in `_logs/_dry-bridge/events.jsonl`
 * (cli/dry-bridge.ts `dryBridgeAgentTurnMarker`/`DRY_BRIDGE_LOG_BUCKET`,
 * already-shipped, unrelated to this WI). Every refusal test below checks
 * this record did NOT grow — a mechanism-grounded negative, not vacuous
 * absence-trusting — and the "success" tests below independently prove the
 * mechanism actually fires when a spawn genuinely would happen, so the
 * negative has a real contrast to stand on.
 *
 * Extension→kind assumptions used throughout (documented once, here): '.png'
 * → 'images', '.mp3' → 'audio', '.pdf' → 'documents' are the only mappings
 * pinned anywhere in this WI's tests, chosen because no other classification
 * among the four MATERIAL_KINDS is plausible for any of them (see the mirror
 * comment in orchestrator/studio/materials.test.ts). 'data-files' is never
 * exercised — every extension that might map to it is genuinely ambiguous
 * (.csv/.json could as easily be 'documents'), so no test here depends on it.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';
import { DRY_BRIDGE_LOG_BUCKET } from './dry-bridge.ts';
import {
  MAX_MATERIALS_COUNT, MAX_MATERIAL_BYTES, MAX_MATERIALS_TOTAL_BYTES,
} from '@forge/agents/studio/materials.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function studioAgent(slug: string, materialsInline?: string): string {
  return `---
name: ${slug}
description: fixture agent for the materials contract test (R6-04-F2)
purpose: exercise the materials-gated dispatch route
brainAccess: advisory
interactivity: Autonomous once launched; asks no questions.
surface: unattended
composition:
  skills: []
  tools: []
  mcps: []
  guards: []
runtime:
  sdk: claude
  strategy: fixed
  model: claude-sonnet-4-6
allowed-tools: [Read]
disallowed-tools: [Bash]
${materialsInline !== undefined ? `materials: ${materialsInline}\n` : ''}---

Fixture body for ${slug}.
`;
}

let forgeRoot: string;
let logsRoot: string;
let escapeRoot: string; // OUTSIDE forgeRoot entirely — absolute-path escape targets live here
let url: string;
let close: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-materials-'));
  logsRoot = join(forgeRoot, '_logs');
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(logsRoot, { recursive: true });
  mkdirSync(join(forgeRoot, 'skills', 'agent-no-materials'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills', 'agent-images-only'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills', 'agent-multi'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills', 'agent-any-kind'), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', 'agent-no-materials', 'SKILL.md'), studioAgent('agent-no-materials'));
  writeFileSync(join(forgeRoot, 'skills', 'agent-images-only', 'SKILL.md'), studioAgent('agent-images-only', '[images]'));
  writeFileSync(join(forgeRoot, 'skills', 'agent-multi', 'SKILL.md'), studioAgent('agent-multi', '[images, audio]'));
  // ROUND 3 — declares all four MATERIAL_KINDS, so charset-focused tests
  // (widened filename class) can span images/documents/audio/data-files
  // filenames without an unrelated gate refusal muddying the RED signal —
  // the gate itself is already pinned separately (contract point 5 tests).
  writeFileSync(join(forgeRoot, 'skills', 'agent-any-kind', 'SKILL.md'), studioAgent('agent-any-kind', '[images, documents, audio, data-files]'));

  escapeRoot = mkdtempSync(join(tmpdir(), 'materials-escape-target-'));

  process.env.FORGE_DRY_BRIDGE = '1';
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
  if (escapeRoot) rmSync(escapeRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RunBody = { ok?: boolean; runId?: string; slug?: string; error?: string; dryBridge?: { skipped: string[] } };

async function postRun(slug: string, body: unknown): Promise<{ status: number; json: RunBody }> {
  const res = await fetch(`${url}/api/agents/${slug}/run`, { method: 'POST', headers: CSRF, body: JSON.stringify(body) });
  const json = (await res.json()) as RunBody;
  return { status: res.status, json };
}

/** Send a body that is already-serialized text — used for the raw-request-body
 *  containment case (percent-encoded traversal) where the point is that NO
 *  client-side helper gets a chance to normalize anything before the bytes
 *  hit the wire. Kept separate from postRun so the raw-text intent is explicit
 *  at each call site, even though JSON.stringify would produce the same bytes
 *  here — the distinction matters conceptually, not mechanically, for this
 *  particular field (a JSON string value, never a URL segment). */
async function postRunRaw(slug: string, rawBody: string): Promise<{ status: number; json: RunBody }> {
  const res = await fetch(`${url}/api/agents/${slug}/run`, { method: 'POST', headers: CSRF, body: rawBody });
  const json = (await res.json()) as RunBody;
  return { status: res.status, json };
}

function b64(content: string | Buffer): string {
  return Buffer.isBuffer(content) ? content.toString('base64') : Buffer.from(content).toString('base64');
}

function readDryBridgeSkipEvents(): Array<Record<string, unknown>> {
  const p = join(logsRoot, DRY_BRIDGE_LOG_BUCKET, 'events.jsonl');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Count of `dry-bridge.skip`/`agent-turn` events logged for THIS route. The
 *  mechanism-grounded proxy for "a dispatch attempt reached the spawn point"
 *  — see the file header. */
function runRouteSkipCount(): number {
  return readDryBridgeSkipEvents().filter((e) => {
    const meta = e['metadata'] as Record<string, unknown> | undefined;
    return e['message'] === 'dry-bridge.skip' && meta?.['action'] === 'agent-turn' && meta?.['route'] === '/api/agents/:slug/run';
  }).length;
}

function runDirNames(): Set<string> {
  if (!existsSync(logsRoot)) return new Set();
  return new Set(readdirSync(logsRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name));
}

/** Negative-space invariant (mandatory, per the WI's containment section):
 *  after a refusal, no run's `materials/` directory may hold a file. Compares
 *  a before/after directory listing rather than guessing a runId (this route
 *  never returns one on a 400) — any run dir that appeared during this one
 *  request is inspected; the dry-bridge log bucket itself is excluded (it is
 *  not a run dir and pre-exists once the first spawn-attempt test has run). */
function assertNoMaterialsArtifactsAppeared(before_: Set<string>, label: string): void {
  const after_ = runDirNames();
  for (const name of after_) {
    if (before_.has(name) || name === DRY_BRIDGE_LOG_BUCKET) continue;
    const materialsDir = join(logsRoot, name, 'materials');
    if (!existsSync(materialsDir)) continue;
    const entries = readdirSync(materialsDir);
    assert.equal(entries.length, 0, `${label}: refused request must not leave any file under ${materialsDir} — found ${JSON.stringify(entries)}`);
  }
}

/** Full negative-space + no-spawn assertion bundle for one refusal. Call
 *  AFTER receiving a 400 response. */
function assertRefusalLeftNoTrace(status: number, json: RunBody, before_: { dirs: Set<string>; skips: number }, label: string): void {
  assert.equal(status, 400, `${label}: expected 400, got ${status} (body: ${JSON.stringify(json)})`);
  assert.equal(json.dryBridge, undefined, `${label}: a refused request must never carry a dryBridge marker — that marker only appears on the branch that actually reached spawnAgentDispatch`);
  assert.equal(runRouteSkipCount(), before_.skips, `${label}: no new agent-turn dry-bridge.skip event may appear for this route — a refusal must never reach the spawn point`);
  assertNoMaterialsArtifactsAppeared(before_.dirs, label);
}

function snapshotBefore(): { dirs: Set<string>; skips: number } {
  return { dirs: runDirNames(), skips: runRouteSkipCount() };
}

function waitFor(predicate: () => boolean, timeoutMs = 2000, intervalMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() > deadline) return reject(new Error('waitFor: timed out'));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

function splitBytes(total: number, maxPerFile: number, maxCount: number): number[] {
  if (total === 0) return [];
  const parts: number[] = [];
  let remaining = total;
  while (remaining > 0) {
    if (parts.length >= maxCount) throw new Error(`splitBytes: cannot fit ${total} bytes into <= ${maxCount} files of <= ${maxPerFile} bytes each`);
    const take = Math.min(maxPerFile, remaining);
    parts.push(take);
    remaining -= take;
  }
  return parts;
}

/** R6-04-F2 ROUND 2 — exact refusal-message templates, specified by the
 *  round-2 spawner ruling (round 1 used loose regexes here; this replaces
 *  them with full-string equality so a compliant-but-differently-phrased
 *  message fails loudly, and so a message that silently drops the
 *  declared-kinds clause fails too):
 *    no kind:        materials: "<filename>" maps to no material kind; agent "<slug>" declares: <kinds|(none)>
 *    undeclared kind: materials: "<filename>" is <kind>; agent "<slug>" declares: <kinds|(none)>
 *  <kinds> is comma-separated in declaration order; literal "(none)" when
 *  the agent declares nothing at all. */
function declaredKindsClause(declared: readonly string[]): string {
  return declared.length > 0 ? declared.join(', ') : '(none)';
}
function noKindMessage(filename: string, slug: string, declared: readonly string[]): string {
  return `materials: "${filename}" maps to no material kind; agent "${slug}" declares: ${declaredKindsClause(declared)}`;
}
function undeclaredKindMessage(filename: string, kind: string, slug: string, declared: readonly string[]): string {
  return `materials: "${filename}" is ${kind}; agent "${slug}" declares: ${declaredKindsClause(declared)}`;
}

// =============================================================================
// Contract point 1 — materials absent / [] ⇒ identical to today (back-compat)
// =============================================================================

test('materials absent: dispatch proceeds exactly as before (non-regression anchor — may already be green pre-implementation)', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-no-materials', {});
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.match(json.runId ?? '', /^_agent-agent-no-materials-/);
  // Positive mechanism proof, established HERE so every refusal test below
  // has a real contrast to stand on: a genuine dispatch attempt under
  // FORGE_DRY_BRIDGE=1 leaves a real, checkable record.
  assert.deepEqual(json.dryBridge?.skipped, ['agent-turn'], 'a real dispatch attempt must carry the dry-bridge agent-turn marker');
  assert.equal(runRouteSkipCount(), before_.skips + 1, 'a real dispatch attempt must append exactly one agent-turn skip event for this route');
});

test('materials: [] : identical to absent (non-regression anchor — may already be green pre-implementation)', async () => {
  const { status, json } = await postRun('agent-no-materials', { materials: [] });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
});

// =============================================================================
// Contract point 2 — shape errors → 400
// =============================================================================

test('materials is not an array (a string) → 400', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', { materials: 'not-an-array' });
  assertRefusalLeftNoTrace(status, json, before_, 'materials-not-array(string)');
});

test('materials is not an array (a plain object) → 400', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', { materials: { filename: 'a.png', contentBase64: b64('x') } });
  assertRefusalLeftNoTrace(status, json, before_, 'materials-not-array(object)');
});

test('materials entry is not a plain object (string/number/null/array entries) → 400', async () => {
  for (const badEntry of ['not-an-object', 42, null, []]) {
    const before_ = snapshotBefore();
    const { status, json } = await postRun('agent-images-only', { materials: [badEntry] });
    assertRefusalLeftNoTrace(status, json, before_, `materials-entry-not-object(${JSON.stringify(badEntry)})`);
  }
});

test('materials entry missing filename → 400', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', { materials: [{ contentBase64: b64('x') }] });
  assertRefusalLeftNoTrace(status, json, before_, 'missing-filename');
});

test('materials entry with non-string filename → 400', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename: 42, contentBase64: b64('x') }] });
  assertRefusalLeftNoTrace(status, json, before_, 'non-string-filename');
});

test('materials entry missing contentBase64 → 400', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename: 'a.png' }] });
  assertRefusalLeftNoTrace(status, json, before_, 'missing-contentBase64');
});

test('materials entry with non-string contentBase64 → 400', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename: 'a.png', contentBase64: 12345 }] });
  assertRefusalLeftNoTrace(status, json, before_, 'non-string-contentBase64');
});

// =============================================================================
// Contract point 3 — filename must be a single safe path segment
// =============================================================================

test('filename ".env" → 400 — INTENTIONAL, reasoned refusal, not an accident: the leading-dot ban (regex requires an alnum FIRST char) exists specifically so a dotfile-shaped name can never land as a material leaf, even though ".env" contains no traversal token at all', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename: '.env', contentBase64: b64('secret') }] });
  assertRefusalLeftNoTrace(status, json, before_, 'dotfile-env');
});

test('filename "..foo" → 400 — INTENTIONAL, reasoned refusal: same leading-dot ban. Note this is STRICTER than studio-path-guard.ts\'s own isSafeSegment, which deliberately ALLOWS "..foo" as a legitimate directory-entry name (cli/studio-path-guard.test.ts D1) — the materials filename regex is a narrower, purpose-built contract (point 3), not a re-use of isSafeSegment\'s looser rule, and this test pins that the two must not be conflated', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename: '..foo', contentBase64: b64('x') }] });
  assertRefusalLeftNoTrace(status, json, before_, 'dotdot-foo');
});

test('filename exactly "." → 400', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename: '.', contentBase64: b64('x') }] });
  assertRefusalLeftNoTrace(status, json, before_, 'dot');
});

test('filename exactly ".." → 400', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename: '..', contentBase64: b64('x') }] });
  assertRefusalLeftNoTrace(status, json, before_, 'dotdot');
});

test('filename length boundary: exactly 128 chars (regex ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$) is ACCEPTED', async () => {
  const filename = 'a'.repeat(124) + '.png'; // 124 + 4 = 128
  assert.equal(filename.length, 128);
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename, contentBase64: b64('img') }] });
  assert.equal(status, 200, `expected 200 for an exactly-128-char filename, got ${status} (${JSON.stringify(json)})`);
  await waitFor(() => existsSync(join(logsRoot, json.runId!, 'materials', filename)));
});

test('filename length boundary: 129 chars is REFUSED', async () => {
  const filename = 'a'.repeat(125) + '.png'; // 125 + 4 = 129
  assert.equal(filename.length, 129);
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename, contentBase64: b64('img') }] });
  assertRefusalLeftNoTrace(status, json, before_, 'filename-129-chars');
});

// =============================================================================
// R6-04-F2 ROUND 3 — WIDENED filename charset (spawner amendment 1). The
// original regex (^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$, pinned in rounds 1-2)
// was too strict: it rejected the filenames operators' own machines produce
// by DEFAULT — a macOS screenshot, a browser's duplicate-download suffix, an
// ordinary "Meeting Notes.pdf" — on this feature's headline use case
// (attaching a screenshot). New charset, per the amendment: alnum-first,
// then alnum plus space, ".", "_", "-", "(", ")", "[", "]", max 128 total.
// ASCII-only is UNCHANGED and deliberate (see the non-ASCII test below) —
// this widening only ADDS space/()[] to the allowed tail; it does not touch
// the leading-character rule, the length cap, or any of the excluded
// characters ("/", "\", "%", NUL, control chars) that the traversal tests
// above and below depend on.
// =============================================================================

test('WIDENED CHARSET: the three realistic operator filenames named by the amendment are ACCEPTED and written byte-exact — kills a regex that still only recognizes the old, narrower class. Uses agent-any-kind (declares all four MATERIAL_KINDS) so a .csv (data-files) and a .pdf (documents) alongside a .png (images) never trip an UNRELATED gate refusal — this test is about the CHARSET, not the gate, which is pinned separately', async () => {
  const realisticNames = [
    'Screen Shot 2026-08-07 at 10.32.15 AM.png', // macOS default screenshot name
    'data (1).csv', // browser duplicate-download suffix
    'Meeting Notes.pdf', // ordinary operator-authored name
  ];
  for (const filename of realisticNames) {
    const marker = Buffer.from(`WIDENED-CHARSET-MARKER-${filename}`);
    const { status, json } = await postRun('agent-any-kind', { materials: [{ filename, contentBase64: b64(marker) }] });
    assert.equal(status, 200, `expected "${filename}" to be accepted under the widened charset — got ${status} (${JSON.stringify(json)})`);
    const target = join(logsRoot, json.runId!, 'materials', filename);
    await waitFor(() => existsSync(target));
    assert.deepEqual(readFileSync(target), marker, `expected "${filename}" written byte-exact`);
  }
});

test('WIDENED CHARSET: a filename combining every newly-allowed character (space, parens, brackets, underscore, dash, multiple dots) is ACCEPTED', async () => {
  const filename = 'My Photo (v2) [final]_edit-1.2.3.png';
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename, contentBase64: b64('combo') }] });
  assert.equal(status, 200, `expected the combined-charset filename to be accepted — got ${status} (${JSON.stringify(json)})`);
  await waitFor(() => existsSync(join(logsRoot, json.runId!, 'materials', filename)));
});

test('DELIBERATE LIMIT: non-ASCII filename ("résumé.pdf") is STILL refused — INTENTIONAL, not an oversight of the widening: filesystem unicode normalization differs by platform (macOS tends toward NFD, Linux does not), so the identical logical name can be two different byte sequences on disk, and resolveGuardedPath\'s identity comparison would behave differently per platform for the same input — fail-closed-and-consistent beats convenient-and-platform-dependent. Uses agent-any-kind (which DOES declare "documents", .pdf\'s kind) specifically to prove the refusal is the CHARSET check, not an unrelated gate refusal', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-any-kind', { materials: [{ filename: 'résumé.pdf', contentBase64: b64('x') }] });
  assertRefusalLeftNoTrace(status, json, before_, 'non-ascii-filename');
});

test('ATTACK THE FIX: a filename containing a literal ".." SUBSTRING via the newly-allowed brackets/parens (not a real path segment — no "/" anywhere) is ACCEPTED and written INSIDE materials/, never escaping — kills an implementation that naively bans any filename containing "..' + '" as a substring (which would be an over-broad, and separately WRONG, defense: this exact shape is not a traversal, mirroring studio-path-guard.ts\'s own established "..foo is a legitimate name" precedent)', async () => {
  const filename = 'photo [..] (backup)..png'; // contains ".." twice, and there is genuinely no "/" anywhere in this name — not a path segment boundary, just characters
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename, contentBase64: b64('safe-because-no-slash') }] });
  assert.equal(status, 200, `expected this embedded-".."-but-no-slash filename to be accepted — got ${status} (${JSON.stringify(json)})`);
  const target = join(logsRoot, json.runId!, 'materials', filename);
  await waitFor(() => existsSync(target));
  // The written file must be exactly the literal join of materials/ + filename
  // (proves it landed INSIDE the run's own materials/ directory, not escaped
  // via some naive unwrapping of the bracket/paren-enclosed ".." text) — and
  // must NOT exist one level up, which is what a bracket-unwrapping bug would
  // produce.
  assert.ok(existsSync(target), 'the file must exist at the literal join() location inside materials/');
  assert.equal(existsSync(join(logsRoot, json.runId!, 'photo [..] (backup)..png')), false, 'must not have escaped one level up out of materials/');
});

test('ATTACK THE FIX: every previously-pinned refusal shape remains refused under the widened class — "/" is still excluded', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename: 'inner/traversal.png', contentBase64: b64('x') }] });
  assertRefusalLeftNoTrace(status, json, before_, 'widened-class-still-excludes-slash');
});

test('ATTACK THE FIX: backslash is still excluded under the widened class (Windows-style separator, same honest-scope note as round 1: inert on this POSIX runtime, pinned as a character-class refusal regardless)', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename: 'inner\\traversal.png', contentBase64: b64('x') }] });
  assertRefusalLeftNoTrace(status, json, before_, 'widened-class-still-excludes-backslash');
});

test('ATTACK THE FIX: percent sign is still excluded under the widened class', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename: '..%2Fx.png', contentBase64: b64('x') }] });
  assertRefusalLeftNoTrace(status, json, before_, 'widened-class-still-excludes-percent');
});

// ---- containment: relative traversal (plant + assert unchanged) -----------

test('CONTAINMENT: relative traversal filename ("../../<target>", playing the role of "../../etc/passwd" against a sandboxed sentinel rather than a real system file) is refused, and the sentinel it would have overwritten is byte-unchanged', async () => {
  // The materials write path is fixed by contract point 9 as exactly
  // <logsRoot>/<runId>/materials/<filename> — always TWO directory levels
  // below logsRoot, regardless of the (unpredictable, server-generated)
  // runId's actual VALUE. So "../../sentinel.txt" naively joined from
  // materials/ lands at logsRoot/sentinel.txt — a location this test DOES
  // know and can plant ahead of time, without needing to guess runId.
  const sentinelPath = join(logsRoot, 'sentinel-relative-traversal.txt');
  writeFileSync(sentinelPath, 'ORIGINAL-SENTINEL-DO-NOT-OVERWRITE');
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', {
    materials: [{ filename: '../../sentinel-relative-traversal.txt', contentBase64: b64('EVIL-OVERWRITE') }],
  });
  assertRefusalLeftNoTrace(status, json, before_, 'relative-traversal');
  assert.equal(readFileSync(sentinelPath, 'utf8'), 'ORIGINAL-SENTINEL-DO-NOT-OVERWRITE', 'the sentinel outside the run dir must be byte-unchanged after a refused traversal attempt');
});

// ---- containment: absolute path filename (plant + assert unchanged) -------

test('CONTAINMENT: absolute path filename ("/tmp/<planted>") is refused, and the planted file it would have overwritten is byte-unchanged', async () => {
  const sentinelPath = join(escapeRoot, 'planted-absolute.txt');
  writeFileSync(sentinelPath, 'ORIGINAL-ABSOLUTE-SENTINEL');
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', {
    materials: [{ filename: sentinelPath, contentBase64: b64('EVIL-OVERWRITE') }],
  });
  assertRefusalLeftNoTrace(status, json, before_, 'absolute-path');
  assert.equal(readFileSync(sentinelPath, 'utf8'), 'ORIGINAL-ABSOLUTE-SENTINEL', 'the absolute-path sentinel must be byte-unchanged after a refused write attempt');
});

// ---- containment: Windows-style separator ----------------------------------

test('CONTAINMENT: Windows-style separator ("..\\\\x") is refused by the filename charset — HONEST SCOPE: on this POSIX runtime "\\\\" is an inert filename character, not a path separator, so this pins the CHARACTER-CLASS refusal (defense for any downstream/Windows-hosted consumer of the same filename), not a demonstrated live traversal on THIS OS', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename: '..\\x', contentBase64: b64('x') }] });
  assertRefusalLeftNoTrace(status, json, before_, 'windows-separator');
});

// ---- containment: percent-encoded traversal on a RAW request body ---------

test('CONTAINMENT: percent-encoded traversal ("..%2Fx") delivered on a RAW request body is refused by the filename charset — the "%" character alone is enough; the mechanism this kills is an implementer decodeURIComponent()-ing the filename before validating it (this field is a JSON string VALUE, never a URL segment, so nothing anywhere in this pipeline should ever decode it)', async () => {
  const before_ = snapshotBefore();
  const rawBody = JSON.stringify({ materials: [{ filename: '..%2Fx', contentBase64: b64('x') }] });
  const { status, json } = await postRunRaw('agent-images-only', rawBody);
  assertRefusalLeftNoTrace(status, json, before_, 'percent-encoded');
});

// ---- containment: NUL byte in filename -------------------------------------

test('CONTAINMENT: NUL byte in filename is refused with 400 (fail-closed), not a 500 from an uncaught Node fs "path contains NUL" throw', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename: 'evil\u0000.png', contentBase64: b64('x') }] });
  assert.equal(status, 400, `expected fail-closed 400 for a NUL-byte filename, got ${status} (${JSON.stringify(json)}) — a 500 here means the NUL reached an fs call uncaught instead of being refused by validation first`);
  assertRefusalLeftNoTrace(status, json, before_, 'nul-byte');
});

// ---- containment: literal "materials" as a filename ------------------------

test('CONTAINMENT: the literal filename "materials" is refused — but via the mundane "no extension" rule (point 4), NOT a path-containment mechanism: "materials" fully matches the charset regex (9 lowercase alnum chars), so its refusal must come from having no recognized extension, which this test\'s companion (D-group, below) independently pins', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename: 'materials', contentBase64: b64('x') }] });
  assertRefusalLeftNoTrace(status, json, before_, 'literal-materials-filename');
  assert.equal(json.error, noKindMessage('materials', 'agent-images-only', ['images']), 'confirms refusal is via the no-recognized-extension rule, not a containment message');
});

// =============================================================================
// Contract point 4 — kind derived SERVER-SIDE; a client-supplied kind is
// NEVER trusted
// =============================================================================

test('unknown extension → 400', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename: 'payload.xyz123', contentBase64: b64('x') }] });
  assertRefusalLeftNoTrace(status, json, before_, 'unknown-extension');
  assert.equal(json.error, noKindMessage('payload.xyz123', 'agent-images-only', ['images']));
});

test('absent extension → 400', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename: 'README', contentBase64: b64('x') }] });
  assertRefusalLeftNoTrace(status, json, before_, 'absent-extension');
  assert.equal(json.error, noKindMessage('README', 'agent-images-only', ['images']));
});

test('DELIBERATE EXCLUSION end-to-end: ".svg" is refused via the same route a real upload would use, even for an agent that declares "images" — SVG is deliberately excluded from the images allowlist (active-content risk); this is the route-level companion to the dedicated unit pin in materials.test.ts', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename: 'icon.svg', contentBase64: b64('<svg/>') }] });
  assertRefusalLeftNoTrace(status, json, before_, 'svg-deliberately-excluded');
  assert.equal(json.error, noKindMessage('icon.svg', 'agent-images-only', ['images']), '.svg must never derive "images", even though the agent declares images and would otherwise accept it');
});

test('a client-supplied "kind" field is IGNORED — {filename:"evil.exe", kind:"documents", ...} is still refused, because ".exe" derives no kind server-side regardless of what the client claims', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', {
    materials: [{ filename: 'evil.exe', kind: 'documents', contentBase64: b64('x') }],
  });
  assertRefusalLeftNoTrace(status, json, before_, 'client-kind-ignored-unknown-ext');
  assert.equal(json.error, noKindMessage('evil.exe', 'agent-images-only', ['images']), 'the message must reflect the SERVER-derived outcome (no kind), never echo the client-supplied "documents"');
});

test('a client-supplied "kind" cannot be used to BYPASS the gate: agent-multi declares [images, audio] only; filename "notes.pdf" server-derives "documents" (not accepted) — a client lying kind:"images" must NOT flip this to acceptance', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-multi', {
    materials: [{ filename: 'notes.pdf', kind: 'images', contentBase64: b64('x') }],
  });
  assertRefusalLeftNoTrace(status, json, before_, 'client-kind-cannot-bypass-gate');
  assert.equal(json.error, undeclaredKindMessage('notes.pdf', 'documents', 'agent-multi', ['images', 'audio']), 'the message must name the SERVER-derived kind ("documents"), never the client-supplied "images"');
});

test('a client-supplied "kind" cannot be used to WRONGLY REFUSE a legitimate upload: agent-multi declares [images, audio]; filename "song.mp3" server-derives "audio" (accepted) — a client lying kind:"images" must NOT cause a false refusal (the flip side of the previous test: proves the server truly IGNORES the field rather than merely distrusting it in one direction)', async () => {
  const { status, json } = await postRun('agent-multi', {
    materials: [{ filename: 'song.mp3', kind: 'images', contentBase64: b64('audio-bytes') }],
  });
  assert.equal(status, 200, `expected acceptance driven by the SERVER-derived kind ("audio", declared), got ${status} (${JSON.stringify(json)})`);
  await waitFor(() => existsSync(join(logsRoot, json.runId!, 'materials', 'song.mp3')));
});

// =============================================================================
// Contract point 5 — the gate; refusal message NAMES the agent's declared
// kinds (headline AC)
// =============================================================================

test('an agent with NO materials declaration refuses EVERY kind, and the message says so explicitly (not just a bare 400)', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-no-materials', {
    materials: [{ filename: 'picture.png', contentBase64: b64('img') }],
  });
  assertRefusalLeftNoTrace(status, json, before_, 'no-materials-declared');
  assert.equal(json.error, undeclaredKindMessage('picture.png', 'images', 'agent-no-materials', []), 'must use the literal "(none)" clause for an agent with no materials declaration');
});

test('headline AC: an out-of-contract upload is refused with the declared kinds NAMED — agent-multi declares [images, audio]; a "documents"-kind upload (.pdf) is refused with BOTH declared kinds present, in declaration order, in the message', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-multi', {
    materials: [{ filename: 'notes.pdf', contentBase64: b64('doc') }],
  });
  assertRefusalLeftNoTrace(status, json, before_, 'out-of-contract-names-declared-kinds');
  assert.equal(json.error, undeclaredKindMessage('notes.pdf', 'documents', 'agent-multi', ['images', 'audio']));
});

test('a declared kind IS accepted: agent-images-only declares [images]; an images-kind upload (.png) passes the gate', async () => {
  const { status, json } = await postRun('agent-images-only', {
    materials: [{ filename: 'accepted.png', contentBase64: b64('img-ok') }],
  });
  assert.equal(status, 200, `expected the gate to accept a declared kind — got ${status} (${JSON.stringify(json)})`);
});

// =============================================================================
// Contract point 6 — caps (boundary-pinned via the imported constants, never
// a hardcoded magic number)
// =============================================================================

test(`MAX_MATERIALS_COUNT boundary: exactly ${MAX_MATERIALS_COUNT} materials is ACCEPTED`, async () => {
  const materials = Array.from({ length: MAX_MATERIALS_COUNT }, (_, i) => ({ filename: `count-ok-${i}.png`, contentBase64: b64('x') }));
  const { status, json } = await postRun('agent-images-only', { materials });
  assert.equal(status, 200, `expected acceptance at exactly MAX_MATERIALS_COUNT (${MAX_MATERIALS_COUNT}) — got ${status} (${JSON.stringify(json)})`);
});

test(`MAX_MATERIALS_COUNT boundary: ${MAX_MATERIALS_COUNT + 1} materials is REFUSED`, async () => {
  const materials = Array.from({ length: MAX_MATERIALS_COUNT + 1 }, (_, i) => ({ filename: `count-over-${i}.png`, contentBase64: b64('x') }));
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', { materials });
  assertRefusalLeftNoTrace(status, json, before_, 'max-materials-count-plus-1');
});

test(`MAX_MATERIAL_BYTES boundary: a single file of exactly ${MAX_MATERIAL_BYTES} decoded bytes is ACCEPTED`, async () => {
  const buf = Buffer.alloc(MAX_MATERIAL_BYTES, 0x61);
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename: 'at-cap.png', contentBase64: b64(buf) }] });
  assert.equal(status, 200, `expected acceptance at exactly MAX_MATERIAL_BYTES (${MAX_MATERIAL_BYTES}) — got ${status} (${JSON.stringify(json)}). If this is a 500 rather than 400/200, the bridge's own outer MAX_BODY_BYTES guard may have fired first — see the drift test in materials.test.ts.`);
  if (status === 200) {
    await waitFor(() => existsSync(join(logsRoot, json.runId!, 'materials', 'at-cap.png')));
    const written = readFileSync(join(logsRoot, json.runId!, 'materials', 'at-cap.png'));
    assert.equal(written.length, MAX_MATERIAL_BYTES, 'the written file must be byte-exact, not silently truncated at the cap');
  }
});

test(`MAX_MATERIAL_BYTES boundary: a single file of ${MAX_MATERIAL_BYTES + 1} decoded bytes is REFUSED`, async () => {
  const buf = Buffer.alloc(MAX_MATERIAL_BYTES + 1, 0x61);
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename: 'over-cap.png', contentBase64: b64(buf) }] });
  assertRefusalLeftNoTrace(status, json, before_, 'max-material-bytes-plus-1');
});

test(`MAX_MATERIALS_TOTAL_BYTES boundary: a set of files summing to exactly ${MAX_MATERIALS_TOTAL_BYTES} decoded bytes is ACCEPTED`, async () => {
  const sizes = splitBytes(MAX_MATERIALS_TOTAL_BYTES, MAX_MATERIAL_BYTES, MAX_MATERIALS_COUNT);
  const materials = sizes.map((n, i) => ({ filename: `total-ok-${i}.png`, contentBase64: b64(Buffer.alloc(n, 0x61)) }));
  const { status, json } = await postRun('agent-images-only', { materials });
  assert.equal(status, 200, `expected acceptance at exactly MAX_MATERIALS_TOTAL_BYTES (${MAX_MATERIALS_TOTAL_BYTES}) split across ${sizes.length} file(s) — got ${status} (${JSON.stringify(json)}). If this is a 500, the bridge's own outer MAX_BODY_BYTES guard may have fired first.`);
});

test(`MAX_MATERIALS_TOTAL_BYTES boundary: a set of files summing to ${MAX_MATERIALS_TOTAL_BYTES + 1} decoded bytes is REFUSED`, async () => {
  const sizes = splitBytes(MAX_MATERIALS_TOTAL_BYTES + 1, MAX_MATERIAL_BYTES, MAX_MATERIALS_COUNT);
  const materials = sizes.map((n, i) => ({ filename: `total-over-${i}.png`, contentBase64: b64(Buffer.alloc(n, 0x61)) }));
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', { materials });
  assertRefusalLeftNoTrace(status, json, before_, 'max-materials-total-bytes-plus-1');
});

// =============================================================================
// Contract point 7 — contentBase64 must be strict base64 (round-trips)
// =============================================================================

test('garbage base64 (contains characters outside the base64 alphabet) → 400', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename: 'garbage.png', contentBase64: 'not-@@@-valid-base64!!!' }] });
  assertRefusalLeftNoTrace(status, json, before_, 'garbage-base64-chars');
});

test('base64 with a stray invalid character mid-string must NOT be silently accepted via Node\'s lenient decoder — decode-then-re-encode must round-trip to the exact input, or refuse: kills an implementation that only checks "does Buffer.from throw" (Node\'s base64 decoder does not throw on stray characters — it silently drops them)', async () => {
  const valid = Buffer.from('hello world').toString('base64'); // "aGVsbG8gd29ybGQ="
  const withStrayChar = valid.slice(0, 8) + '@' + valid.slice(8); // inject one illegal char mid-string
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename: 'stray-char.png', contentBase64: withStrayChar }] });
  assertRefusalLeftNoTrace(status, json, before_, 'stray-char-in-base64');
});

test('a very short/truncated base64-shaped string → 400', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename: 'short.png', contentBase64: 'A' }] });
  assertRefusalLeftNoTrace(status, json, before_, 'short-base64');
});

test('valid, properly round-tripping base64 → accepted', async () => {
  const buf = Buffer.from('genuinely valid content, round-trips cleanly');
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename: 'valid.png', contentBase64: b64(buf) }] });
  assert.equal(status, 200, `expected acceptance for valid base64 — got ${status} (${JSON.stringify(json)})`);
  await waitFor(() => existsSync(join(logsRoot, json.runId!, 'materials', 'valid.png')));
  assert.deepEqual(readFileSync(join(logsRoot, json.runId!, 'materials', 'valid.png')), buf);
});

// =============================================================================
// Contract point 8 — duplicate filename within one request → 400
// =============================================================================

test('duplicate filename within one request → 400, and NEITHER file is written (validation must precede any write, or the second write silently clobbers the first)', async () => {
  const before_ = snapshotBefore();
  const { status, json } = await postRun('agent-images-only', {
    materials: [
      { filename: 'dup.png', contentBase64: b64('first') },
      { filename: 'dup.png', contentBase64: b64('second') },
    ],
  });
  assertRefusalLeftNoTrace(status, json, before_, 'duplicate-filename');
});

// =============================================================================
// Contract point 9 — success artifact: byte-exact file(s) + a "start" event
// recording REFERENCES (path + kind), never the bytes
// =============================================================================

test('SUCCESS: a single material is written byte-exact under <logsRoot>/<runId>/materials/<filename>, and the run dispatches', async () => {
  const marker = 'MATERIAL-CONTENT-MARKER-PNG-0001-UNIQUE-STRING';
  const buf = Buffer.from(marker);
  const { status, json } = await postRun('agent-images-only', { materials: [{ filename: 'evidence.png', contentBase64: b64(buf) }] });
  assert.equal(status, 200, `expected acceptance — got ${status} (${JSON.stringify(json)})`);
  assert.ok(json.runId, 'expected a runId in the success response');
  const runId = json.runId!;
  const target = join(logsRoot, runId, 'materials', 'evidence.png');
  await waitFor(() => existsSync(target));
  assert.deepEqual(readFileSync(target), buf, 'the written material must be byte-exact');

  const eventsPath = join(logsRoot, runId, 'events.jsonl');
  await waitFor(() => existsSync(eventsPath));
  const rawEvents = readFileSync(eventsPath, 'utf8');

  // The reference must be recorded: relative path + derived kind, somewhere
  // in this run's own events.jsonl.
  assert.match(rawEvents, /materials[\\/]evidence\.png/, 'expected a reference to the material\'s relative path ("materials/evidence.png") in the run\'s events.jsonl');
  assert.match(rawEvents, /images/, 'expected the derived kind ("images") referenced in the run\'s events.jsonl');

  // The bytes themselves must NEVER appear in the event log — this is a
  // forge-wide rule (event log = refs, never contents).
  assert.doesNotMatch(rawEvents, new RegExp(marker), 'the event log must NEVER contain the material\'s raw content — only a reference to it');
});

test('SUCCESS: multiple materials in one request are each written byte-exact and each referenced (never the bytes) in events.jsonl', async () => {
  const markerA = 'MATERIAL-MULTI-MARKER-AAAA-UNIQUE';
  const markerB = 'MATERIAL-MULTI-MARKER-BBBB-UNIQUE';
  const bufA = Buffer.from(markerA);
  const bufB = Buffer.from(markerB);
  const { status, json } = await postRun('agent-multi', {
    materials: [
      { filename: 'first.png', contentBase64: b64(bufA) },
      { filename: 'second.mp3', contentBase64: b64(bufB) },
    ],
  });
  assert.equal(status, 200, `expected acceptance — got ${status} (${JSON.stringify(json)})`);
  const runId = json.runId!;

  const targetA = join(logsRoot, runId, 'materials', 'first.png');
  const targetB = join(logsRoot, runId, 'materials', 'second.mp3');
  await waitFor(() => existsSync(targetA) && existsSync(targetB));
  assert.deepEqual(readFileSync(targetA), bufA);
  assert.deepEqual(readFileSync(targetB), bufB);

  const eventsPath = join(logsRoot, runId, 'events.jsonl');
  const rawEvents = readFileSync(eventsPath, 'utf8');
  assert.match(rawEvents, /materials[\\/]first\.png/);
  assert.match(rawEvents, /materials[\\/]second\.mp3/);
  assert.match(rawEvents, /images/);
  assert.match(rawEvents, /audio/);
  assert.doesNotMatch(rawEvents, new RegExp(markerA), 'event log must never contain material A\'s raw content');
  assert.doesNotMatch(rawEvents, new RegExp(markerB), 'event log must never contain material B\'s raw content');
});

// =============================================================================
// Containment ATs — shapes NOT reachable through this route, documented
// honestly rather than faked
// =============================================================================

/**
 * NOT PINNED HERE (see the final report for the full reasoning): a
 * pre-existing directory symlink at `<runDir>/materials`, a pre-existing
 * file symlink at `<runDir>/materials/notes.md`, and a pre-existing hardlink
 * at `<runDir>/materials/notes.md` — the three escape shapes from the
 * catalogue that require planting filesystem state INSIDE the run's own
 * directory BEFORE the request that creates it.
 *
 * This route's `runId` (`_agent-<slug>-<ISO-timestamp>-<4-char-random>`,
 * apps/forge/ui-bridge.ts `newRunStamp`) is always minted SERVER-SIDE, fresh, per
 * request — never accepted from the caller, and never reused across
 * requests (there is no "add materials to an existing run" call). A
 * black-box HTTP caller therefore cannot know the run directory's name
 * before the very request that both mints it AND writes into it, so there
 * is no way to plant a symlink/hardlink at that exact future path in
 * advance. Any test that tried to fake this by monkey-patching
 * `Math.random`/`Date` to force a predictable runId would be attacking the
 * TEST's own determinism, not the feature — and could not avoid the
 * strictly-worse alternative failure mode of the first calibration request
 * creating a REAL directory at the predicted path, leaving no room for a
 * SECOND request's symlink to be planted there at all.
 *
 * Precondition that WOULD make this reachable: a route that accepts (or
 * reuses) a caller-supplied run/session identifier for the materials
 * target. This one does not — see the module docstring's own root-folding
 * contract in cli/studio-path-guard.ts, which is exactly the guard the
 * materials write is expected to route through for the ONE genuinely
 * attacker-controlled segment on this route (the filename) once real
 * containment is implemented; that guard's OWN symlink/hardlink handling is
 * unit-tested directly in cli/studio-path-guard.test.ts against synthetic
 * roots it fully controls, which is the honest place to pin the mechanism
 * itself.
 */
