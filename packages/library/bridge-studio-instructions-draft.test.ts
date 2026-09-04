/**
 * Tests for POST /api/studio/agents/:slug/instructions-draft (R2-09 D8/D9).
 *
 * A deterministic, non-LLM composition of an instructions draft from the
 * CURRENT (possibly unsaved) builder state carried in the request body.
 * NEVER writes to disk (D9). Spins up a real bridge against a tmp forge-root
 * fixture, mirroring cli/bridge-studio-write.test.ts's harness.
 *
 * Covers:
 *   - happy path: {ok, draft, derivation}
 *   - writes nothing (bytes + dir listing unchanged)
 *   - draft reflects the REQUEST body's unsaved composition, not on-disk
 *   - unknown slug → 4xx, no write anywhere
 *   - path traversal: encoded ../.., a long ../ chain, and a real FILE symlink escape
 *   - CSRF/origin guard parity with the sibling write routes
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from '../../apps/forge/ui-bridge.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeAgentSkillMd(): string {
  return [
    '---',
    'name: Draft Agent',
    'description: An agent for instructions-draft route tests.',
    'phase: developer',
    'surface: unattended',
    'purpose: Exercise the instructions-draft route.',
    'brainAccess: advisory',
    'interactivity: none',
    'composition:',
    '  skills:',
    '    - tdd-workflow',
    '  tools: []',
    '  mcps: []',
    '  guards:',
    '    - event-log',
    'runtime:',
    '  sdk: claude-code',
    '  strategy: fixed',
    '  model: claude-sonnet-4-5',
    'allowed-tools:',
    '  - Read',
    'disallowed-tools: []',
    'budgets: {}',
    '---',
    '',
    '# Draft Agent',
    '',
    'Process body text.',
  ].join('\n');
}

function draftBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    purpose: 'Exercise the instructions-draft route.',
    composition: { skills: ['tdd-workflow'], tools: [], mcps: [], guards: ['event-log'], hooks: [] },
    interactivity: 'none',
    brainAccess: 'advisory',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Global fixtures
// ---------------------------------------------------------------------------

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-studio-instructions-draft-'));

  mkdirSync(join(forgeRoot, 'skills', 'draft-agent'), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', 'draft-agent', 'SKILL.md'), makeAgentSkillMd());
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  mkdirSync(join(forgeRoot, '_queue', 'done'), { recursive: true });
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

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

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test('POST /api/studio/agents/draft-agent/instructions-draft returns {ok:true, draft, derivation}', async () => {
  const res = await postJson(`${bridgeUrl}/api/studio/agents/draft-agent/instructions-draft`, draftBody());
  // Read the body ONCE — `res.text()`/`res.json()` each consume the stream;
  // calling both (e.g. one as an assertion's message arg, the other for the
  // payload) throws "Body is unusable" on the second call.
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as { ok: boolean; draft: string; derivation: unknown };
  assert.equal(body.ok, true);
  assert.ok(typeof body.draft === 'string' && body.draft.trim().length > 0, 'draft must be non-empty');
  assert.ok(
    body.draft.includes('Exercise the instructions-draft route.'),
    'draft must reflect the purpose sent in the request body, not a placeholder',
  );
  assert.ok(body.derivation !== undefined && body.derivation !== null, 'derivation must be present');
});

// ---------------------------------------------------------------------------
// Writes nothing (D9)
// ---------------------------------------------------------------------------

test('writes nothing to disk: SKILL.md bytes and the skill dir listing are unchanged after the call', async () => {
  const skillMdPath = join(forgeRoot, 'skills', 'draft-agent', 'SKILL.md');
  const bytesBefore = readFileSync(skillMdPath, 'utf8');
  const dirBefore = readdirSync(join(forgeRoot, 'skills', 'draft-agent')).sort();

  const res = await postJson(
    `${bridgeUrl}/api/studio/agents/draft-agent/instructions-draft`,
    draftBody({ purpose: 'A different, UNSAVED purpose sent only in the request body.' }),
  );
  const statusText = await res.text();
  assert.equal(res.status, 200, statusText);

  const bytesAfter = readFileSync(skillMdPath, 'utf8');
  assert.equal(bytesAfter, bytesBefore, 'SKILL.md must be byte-unchanged — the draft route never writes (D9)');
  const dirAfter = readdirSync(join(forgeRoot, 'skills', 'draft-agent')).sort();
  assert.deepEqual(dirAfter, dirBefore, 'no new file may appear in the skill dir');
});

// ---------------------------------------------------------------------------
// Reflects unsaved request-body state, not on-disk state
// ---------------------------------------------------------------------------

test('the draft reflects the REQUEST body composition (unsaved), not the on-disk one', async () => {
  const res = await postJson(
    `${bridgeUrl}/api/studio/agents/draft-agent/instructions-draft`,
    draftBody({
      composition: { skills: ['tdd-workflow', 'brain-query'], tools: [], mcps: [], guards: ['event-log'], hooks: [] },
    }),
  );
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as { draft: string };
  assert.ok(
    body.draft.includes('brain-query'),
    'an extra, unsaved skill sent in the request body must appear in the draft — the route must never re-read the on-disk composition',
  );
  assert.ok(
    body.draft.includes('tdd-workflow'),
    'the skill already on disk that is ALSO present in the request body must still appear — the draft reflects the FULL unsaved composition, not just its delta from disk',
  );
});

// ---------------------------------------------------------------------------
// Unknown slug
// ---------------------------------------------------------------------------

test('unknown slug → 4xx, no directory scaffolded', async () => {
  const res = await postJson(`${bridgeUrl}/api/studio/agents/no-such-agent/instructions-draft`, draftBody());
  assert.ok(res.status >= 400 && res.status < 500, `expected 4xx for an unknown slug, got ${res.status}`);
  assert.ok(!existsSync(join(forgeRoot, 'skills', 'no-such-agent')), 'no directory may be scaffolded for a draft request');
});

// ---------------------------------------------------------------------------
// Path traversal — real escape attempts, not lexical probes
// ---------------------------------------------------------------------------

test('encoded traversal slug "..%2F..%2Fetc%2Fpasswd" → 4xx, no leak', async () => {
  const res = await postJson(`${bridgeUrl}/api/studio/agents/..%2F..%2Fetc%2Fpasswd/instructions-draft`, draftBody());
  assert.ok(res.status >= 400 && res.status < 500, `expected 4xx, got ${res.status}`);
});

test('a ~30-deep repeated "../" slug chain does not escape the forge root', async () => {
  const evilSlug = '..%2F'.repeat(30) + 'etc%2Fpasswd';
  const res = await postJson(`${bridgeUrl}/api/studio/agents/${evilSlug}/instructions-draft`, draftBody());
  assert.ok(res.status >= 400 && res.status < 500, `expected 4xx, got ${res.status}`);
  const text = await res.text();
  assert.ok(!/root:.*:0:0:/.test(text), 'response must never carry real /etc/passwd content');
});

test('a SYMLINKED SKILL.md FILE escaping the forge root does not leak its content through the draft', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'instructions-draft-outside-'));
  const marker = 'OUTSIDE-SECRET-MARKER-DO-NOT-LEAK-7f3a9c';
  const outsideFile = join(outsideDir, 'secret.md');
  writeFileSync(outsideFile, `---\nname: leaked\npurpose: ${marker}\n---\n\n${marker}\n`, 'utf8');

  mkdirSync(join(forgeRoot, 'skills', 'escape-agent'), { recursive: true });
  const linkPath = join(forgeRoot, 'skills', 'escape-agent', 'SKILL.md');
  try {
    // The escape session DIRECTORY (skills/escape-agent/) is real — only the
    // FILE is a symlink. A prior finding in this campaign covered a real-dir
    // + symlinked-file escape distinctly from a symlinked-dir escape; this
    // case exercises that exact shape.
    symlinkSync(outsideFile, linkPath);
  } catch {
    // Symlink creation can be unavailable in some sandboxes — skip rather
    // than false-failing the suite for an environment limitation.
    rmSync(outsideDir, { recursive: true, force: true });
    return;
  }

  try {
    const res = await postJson(`${bridgeUrl}/api/studio/agents/escape-agent/instructions-draft`, draftBody());
    const text = await res.text();
    assert.ok(!text.includes(marker), 'the outside file content must never appear in the response');
    const outsideAfter = readFileSync(outsideFile, 'utf8');
    assert.ok(outsideAfter.includes(marker), 'the outside file must be left unmodified — the route never writes');
  } finally {
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// CSRF / origin guard parity with the sibling write routes
// ---------------------------------------------------------------------------

test('POST .../instructions-draft without x-forge-csrf header → 403, same guard as the sibling PUT routes', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/agents/draft-agent/instructions-draft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(draftBody()),
  });
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error: string };
  assert.ok(body.error.toLowerCase().includes('csrf'), `expected a CSRF error, got: ${body.error}`);
});

test('POST .../instructions-draft with x-forge-csrf header reaches the route and succeeds', async () => {
  const res = await postJson(`${bridgeUrl}/api/studio/agents/draft-agent/instructions-draft`, draftBody());
  const text = await res.text();
  assert.equal(res.status, 200, text);
});
