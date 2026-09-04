import { type SessionShellBody, captureResponse } from './test-fixtures/studio-sessions-builders.ts';
import { BADSTAGE_SESSION, DEPS_SESSION, INVALID_JSON_STATUS_SESSION, MISSING_STATUS_SESSION, MODEL_TIER_SESSION, NON_OBJECT_STATUS_SESSION, NON_STRING_PHASE_STATUS_SESSION, NO_PHASE_STATUS_SESSION, ONBOARDING_BAD_CONFIG_SESSION, ONBOARDING_SESSION, REAL_ARCHITECT_SESSION, REAL_INSTRUCTIONS_SESSION, REAL_PROJECT_BRAIN_SESSION, REASK_SESSION, SECRET_MARKER, STATUS_ESCAPE_SESSION, STATUS_SECRET_MARKER } from './test-fixtures/studio-sessions-builders.ts';
import { bridgeUrl, forgeRoot } from './test-fixtures/studio-sessions-bridge.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { handleStudioSessionsRoutes, type SessionsRouteContext } from '../../bridge-studio-sessions.ts';

// ---------------------------------------------------------------------------
// 200 happy path — the three real kinds (AT-38, 39, 40)
// ---------------------------------------------------------------------------


test('AT-38: GET /api/studio/sessions/architect/<id>?project=<p> returns the full shell payload', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${REAL_ARCHITECT_SESSION}?project=demoproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;

  assert.equal(body.ok, true);
  assert.equal(body.kind, 'architect');
  assert.equal(body.sessionId, REAL_ARCHITECT_SESSION);
  assert.equal(body.project, 'demoproj');
  assert.equal(body.phase, 'awaiting-verdict', 'phase must be the real value read from the session\'s status.json');
  assert.deepEqual(body.stages, ['roadmap']);
  assert.equal(body.defaultStage, 'roadmap');

  // The fixture is idea.md + a single answered round (no questions.json, no
  // feedback.md) — the exact, known transcript this session must derive.
  assert.equal(body.turns.length, 3, `expected idea.md + round-1 agent + round-1 operator, got: ${JSON.stringify(body.turns)}`);
  assert.deepEqual(body.turns.map((t) => t.source), ['idea.md', 'answers.json#round-1', 'answers.json#round-1']);
  assert.deepEqual(body.turns.map((t) => t.role), ['operator', 'agent', 'operator']);

  const artifact = body.artifact as { kind: string; rows: unknown[] };
  assert.equal(artifact.kind, 'roadmap-draft');
  assert.deepEqual(artifact.rows, [], 'the fixture\'s manifests/ dir is empty — the artifact must be an honest empty roadmap, not a fabricated row');

  // W6-B3 — architect carries NEITHER turnSpec NOR panel (permanently
  // bespoke, ADR-043 2026-08-15 amendment §4) — deriveSessionAffordances must
  // yield the honest empty answer, not a fabricated guess.
  assert.deepEqual(body.affordances, [], 'architect has no turnSpec/panel — affordances must be [], never fabricated');
  // W8-B3 AMENDMENT (sessions-kinds-R06/31) — this asserted `null`, which was
  // pinning the defect: architect is `strategy:fixed`, so it HAS exactly one
  // legal tier and the session provably ran on it, yet the whole chain read
  // "not recorded" / "—". This fixture's agent declares
  // `model: claude-sonnet-4-6`, so the resolved tier is `sonnet` — read live
  // off the SKILL.md, never stored on the session.
  assert.equal(body.modelTier, 'sonnet');
});

test('AT-39: GET /api/studio/sessions/instructions/<id>?project=<p> returns the full shell payload', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/instructions/${REAL_INSTRUCTIONS_SESSION}?project=demoproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;

  assert.equal(body.ok, true);
  assert.equal(body.kind, 'instructions');
  assert.equal(body.sessionId, REAL_INSTRUCTIONS_SESSION);
  assert.equal(body.project, 'demoproj');
  assert.equal(body.phase, 'drafting', 'phase must be the real value read from the session\'s status.json');
  assert.deepEqual(body.stages, ['instructions']);
  assert.equal(body.defaultStage, 'instructions');

  // The fixture is prompt.md only (no answers.json/questions.json/feedback.md).
  assert.equal(body.turns.length, 1, `expected the single prompt.md operator turn, got: ${JSON.stringify(body.turns)}`);
  assert.equal(body.turns[0].role, 'operator');
  assert.equal(body.turns[0].source, 'prompt.md');

  const artifact = body.artifact as { kind: string; body: string | null; hasDraft: boolean };
  assert.equal(artifact.kind, 'markdown-draft');
  assert.equal(artifact.body, '# AGENTS.md\n\nDraft body.\n', 'the draft body must be byte-faithful, including the trailing newline');
  assert.equal(artifact.hasDraft, true);

  // W6-B3 — a PANEL kind (instructions has no turnSpec) at phase "drafting"
  // ({ step: agent, writes: [draft], next: awaiting-verdict }) must derive
  // BOTH a staged-review affordance (from `writes`) AND a next-turn
  // affordance (from `next`) — proves the bridge threads panel.phases
  // through deriveSessionAffordances, not just turnSpec.phases.
  assert.deepEqual(
    body.affordances,
    [
      { id: 'drafting-staged-review', kind: 'staged-review', phase: 'drafting', meta: { writes: ['draft'] } },
      { id: 'drafting-next-turn', kind: 'next-turn', phase: 'drafting', meta: { next: 'awaiting-verdict' } },
    ],
    `expected the panel-derived affordances for phase "drafting", got: ${JSON.stringify(body.affordances)}`,
  );
  // W8-B3 AMENDMENT — see AT-38 above. This fixture's instructions-creator is
  // written as `strategy:fixed` on claude-sonnet-4-6 (writeSkillAgent), so the
  // fallback resolves. The scoping — that a strategy:RANGE agent resolves
  // nothing — is pinned separately below and in packages/sessions/session-model-tier.test.ts
  // against the REAL registry.
  assert.equal(body.modelTier, 'sonnet');
});

test('W8-B3 (sessions-kinds-R06/31): the fixed-tier fallback is SCOPED — a strategy:range agent\'s untiered session still reads "not recorded", never a guessed tier', async () => {
  // Re-point the instructions-creator fixture at a real range envelope, then
  // read the SAME untiered session again. Nothing about the session changed —
  // only the agent's declared strategy — which is exactly the distinction the
  // fallback rests on: a fixed agent has one possible answer, a range agent's
  // untiered session ran on whatever the default was at the time.
  const skillPath = join(forgeRoot, 'skills', 'instructions-creator', 'SKILL.md');
  const before = readFileSync(skillPath, 'utf8');
  try {
    writeFileSync(
      skillPath,
      before
        .replace('strategy: fixed', 'strategy: range')
        .replace('model: claude-sonnet-4-6', 'range:\n    - claude-sonnet-4-6'),
      'utf8',
    );
    const res = await fetch(`${bridgeUrl}/api/studio/sessions/instructions/${REAL_INSTRUCTIONS_SESSION}?project=demoproj`);
    const body = JSON.parse(await res.text()) as SessionShellBody;
    assert.equal(res.status, 200);
    assert.equal(body.modelTier, null, 'a range agent has no single knowable tier — "not recorded" is the honest answer');
  } finally {
    writeFileSync(skillPath, before, 'utf8');
  }
});

test('W6-B6: GET /api/studio/sessions/instructions/<id>?project=<p> threads a real status.json modelTier through, never the stale null placeholder', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/instructions/${MODEL_TIER_SESSION}?project=demoproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;
  assert.equal(body.modelTier, 'opus', 'a real status.json.modelTier must reach the wire verbatim, not the B3-era null placeholder');
});

test('AT-40: GET /api/studio/sessions/project-brain/<id>?project=<p> returns the full shell payload, honestly one turn', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/project-brain/${REAL_PROJECT_BRAIN_SESSION}?project=demoproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;

  assert.equal(body.ok, true);
  assert.equal(body.kind, 'project-brain');
  assert.equal(body.sessionId, REAL_PROJECT_BRAIN_SESSION);
  assert.equal(body.project, 'demoproj');
  assert.equal(body.phase, 'analyzing', 'phase must be the real value read from the session\'s status.json');
  assert.deepEqual(body.stages, ['brain']);
  assert.equal(body.defaultStage, 'brain');

  // project-brain's runner has NO interview machinery (no answers.json/
  // questions.json/feedback.md ever exist for this kind) — one turn here is
  // the honest, complete transcript, not a truncation of something longer.
  assert.equal(body.turns.length, 1, `project-brain must surface honestly as one turn, no fabricated interview, got: ${JSON.stringify(body.turns)}`);
  assert.equal(body.turns[0].role, 'operator');
  assert.equal(body.turns[0].source, 'prompt.md');

  const artifact = body.artifact as { kind: string; themeCount: number; files: Array<{ path: string; body: string }> };
  assert.equal(artifact.kind, 'brain-structure');
  assert.equal(artifact.themeCount, 1);
  assert.ok(artifact.files.some((f) => f.path.includes('alpha.md')), 'the fixture\'s themes/alpha.md must appear in files');
});

// ---------------------------------------------------------------------------
// Passthrough contract — direct invocation (AT-41)
// ---------------------------------------------------------------------------

test('AT-41: handleStudioSessionsRoutes returns false for a non-matching URL (passthrough contract)', async () => {
  const mockRes = {
    writeHead: () => { throw new Error('must not write a response for a non-matching URL'); },
    end: () => { throw new Error('must not end a response for a non-matching URL'); },
  } as unknown as import('node:http').ServerResponse;
  const mockReq = {} as import('node:http').IncomingMessage;
  const ctx: SessionsRouteContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs'), ensureSessionTail: () => {} };

  const handled = await handleStudioSessionsRoutes(mockReq, mockRes, ctx, '/api/studio/nonexistent', 'GET');
  assert.equal(handled, false, 'a non-matching studio-sessions URL must return false');
});

// ---------------------------------------------------------------------------
// 404 / 400 — unknown kind, unknown session, missing project (AT-42, 43, 44)
// ---------------------------------------------------------------------------

test('AT-42: GET /api/studio/sessions/no-such-kind/<id>?project=<p> returns 404 naming the allowed kinds', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/no-such-kind/${REAL_ARCHITECT_SESSION}?project=demoproj`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.ok(body.error.includes('no-such-kind'));
  for (const kind of ['architect', 'instructions', 'project-brain']) {
    assert.ok(body.error.includes(kind), `error must name allowed kind "${kind}", got: ${body.error}`);
  }
});

test('AT-43: GET /api/studio/sessions/architect/<unknown-id>?project=<p> returns 404 naming its ACTUAL cause (strengthened — must not be a generic catch-all)', async () => {
  const unknownId = '2099-01-01T00-00-00';
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${unknownId}?project=demoproj`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string; kind?: string; sessionId?: string; project?: string };
  // Exact-match the "session dir not found" message (distinct from the
  // "session found but status.json unreadable" 404 flavour) — this proves
  // the RIGHT branch fired, not any 404-shaped fallback.
  assert.equal(body.error, 'session not found', `expected the exact "session dir not found" message, got: ${JSON.stringify(body)}`);
  assert.equal(body.kind, 'architect', 'the 404 must echo back the requested kind, proving it reached the session-lookup branch');
  assert.equal(body.sessionId, unknownId, 'the 404 must echo back the requested sessionId');
  assert.equal(body.project, 'demoproj');
});

// W7-A2 (community-06, knowledge-18, sessions-kinds-20) SUPERSEDES the
// pre-wave-7 AT-44 (which pinned a 400 "project query parameter is
// required"): `?project=` is now OPTIONAL — a deep link that omits it
// resolves the anchor project server-side (`findSessionProject`) and
// returns the SAME 200 payload, `project` filled in. The unresolvable /
// ambiguous cases are pinned in packages/sessions/bridge-studio-lifecycle.test.ts.
test('AT-44 (W7-A2): GET /api/studio/sessions/architect/<id> with NO project query param resolves the project server-side and returns 200 with it filled in', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${REAL_ARCHITECT_SESSION}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; project: string; sessionId: string };
  assert.equal(body.ok, true);
  assert.equal(body.sessionId, REAL_ARCHITECT_SESSION);
  assert.equal(typeof body.project, 'string');
  assert.ok(body.project.length > 0, 'the resolved project must be filled in');
});

// ---------------------------------------------------------------------------
// Slug validation sweep — DIRECT invocation (AT-45, 46) — see the header note
// on why real fetch() cannot exercise every variant.
// ---------------------------------------------------------------------------


// Shared traversal/malformed payloads that are representable as a NON-EMPTY
// single path segment (a bare '' segment can never appear in a URL that
// still matches `/api/studio/sessions/:kind/:sessionId` — a trailing slash
// with nothing after it simply fails to match the route at all, which is a
// different, already-covered passthrough/404 case, not this handler's 400).
const BAD_PATH_SEGMENT_VARIANTS: string[] = [
  '..',
  '.',
  'a%2Fb', // "a/b" as a single path segment — the raw traversal char is what's under test, not the segmentation
  '%2Fetc%2Fpasswd', // an absolute-path-shaped value
  '%00', // embedded null byte
  'a'.repeat(300), // overlong id — valid charset, invalid length
  '%2e%2e%2f', // URL-encoded traversal
  '%252e%252e%252f', // double-encoded traversal
  '%c0%af', // overlong UTF-8 encoding of '/'
];

// The project query param IS representable as an empty value (`?project=`),
// unlike a path segment — so '' is meaningful here and only here.
const BAD_QUERY_VALUE_VARIANTS: string[] = ['', ...BAD_PATH_SEGMENT_VARIANTS];

const OVERLONG_ID = 'a'.repeat(300);
const DOUBLE_ENCODED_TRAVERSAL = '%252e%252e%252f';

/** Strengthened per-variant message checks (reviewer finding: breadth alone
 *  doesn't prove the message is ACTIONABLE) — applied to the two variants
 *  T2 called out specifically. Asserts the message is a real length/charset
 *  explanation, never a leaked low-level OS error, and never empty/generic. */
function assertActionableMessage(variant: string, message: string): void {
  if (variant === OVERLONG_ID) {
    assert.ok(/exceed|too long|length/i.test(message), `300-char variant must carry an actionable LENGTH message, got: ${message}`);
    assert.ok(!/ENAMETOOLONG/i.test(message), `300-char variant must NEVER leak a raw OS error like ENAMETOOLONG, got: ${message}`);
  }
  if (variant === DOUBLE_ENCODED_TRAVERSAL) {
    // A single decode of '%252e%252e%252f' yields '%2e%2e%2f' (still
    // percent-encoded, not a real ".." traversal) — the message must name
    // THAT actual offending (once-decoded) value, not a blank/generic string.
    assert.ok(message.includes('%2e%2e%2f'), `double-encoded-traversal variant must name the once-decoded offending value "%2e%2e%2f", got: ${message}`);
  }
}

test('AT-45: sessionId slug validation rejects every traversal/malformed variant with 400, BEFORE any fs read', async () => {
  const ctx: SessionsRouteContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs'), ensureSessionTail: () => {} };
  for (const variant of BAD_PATH_SEGMENT_VARIANTS) {
    const { res, status, body } = captureResponse();
    const rawUrl = `/api/studio/sessions/architect/${variant}?project=demoproj`;
    const handled = await handleStudioSessionsRoutes({} as import('node:http').IncomingMessage, res, ctx, rawUrl, 'GET');
    assert.equal(handled, true, `variant ${JSON.stringify(variant)} must be handled (not passthrough)`);
    assert.equal(status(), 400, `variant ${JSON.stringify(variant)} must be rejected with 400, got ${status()}`);
    const errorMessage = (body() as { error?: string })?.error;
    assert.ok(typeof errorMessage === 'string', `variant ${JSON.stringify(variant)} must carry an error message`);
    assertActionableMessage(variant, errorMessage!);
  }
});

test('AT-46: project slug validation rejects every traversal/malformed variant with 400, BEFORE any fs read', async () => {
  const ctx: SessionsRouteContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs'), ensureSessionTail: () => {} };
  for (const variant of BAD_QUERY_VALUE_VARIANTS) {
    const { res, status, body } = captureResponse();
    const rawUrl = `/api/studio/sessions/architect/${REAL_ARCHITECT_SESSION}?project=${variant}`;
    const handled = await handleStudioSessionsRoutes({} as import('node:http').IncomingMessage, res, ctx, rawUrl, 'GET');
    assert.equal(handled, true, `variant ${JSON.stringify(variant)} must be handled (not passthrough)`);
    assert.equal(status(), 400, `project variant ${JSON.stringify(variant)} must be rejected with 400, got ${status()}`);
    const errorMessage = (body() as { error?: string })?.error;
    assert.ok(typeof errorMessage === 'string');
    assertActionableMessage(variant, errorMessage!);
  }
});

// ---------------------------------------------------------------------------
// Real escape probe — symlink, not a lexical path (AT-47)
// ---------------------------------------------------------------------------

test('AT-47: a sessionId resolving via a symlink into ANOTHER project\'s session dir is rejected, content never leaked', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/evil-session?project=attackerproj`);
  assert.notEqual(res.status, 200, 'a symlink escaping into another project\'s session dir must never resolve as a valid session');
  const text = await res.text();
  assert.ok(!text.includes(SECRET_MARKER), 'the victim session\'s content must never be returned, whatever the rejection status');
});

// ---------------------------------------------------------------------------
// Fail-closed unknown stage surfaces through the route (AT-48)
// ---------------------------------------------------------------------------

// W7-C2 T1 review (P0-3) — AT-48's contract is now SCOPED, not softened. It
// used to assert a non-200 for the whole GET; a corrupt transcript source
// therefore took the entire session page down with it, and the operator lost
// the verdict controls they needed to get out of that state (proven with a
// truncated verdicts.json). The fail-closed properties AT-48 exists to
// protect are all still asserted below, and two more are added: the turns
// must be EMPTY (never partial, never defaulted to a fabricated stage) and
// the shell must stay usable (affordances still derived). What changed is
// only WHERE the refusal surfaces — `transcriptError`, one pane — not
// WHETHER it surfaces.
test('AT-48: an unknown-stage checkpoint surfaces as an explicit transcriptError naming the offending value + allowed set, with ZERO turns — never smoothed into defaulted stages, and never bricking the rest of the shell', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${BADSTAGE_SESSION}?project=badstageproj`);
  const text = await res.text();
  assert.equal(res.status, 200, `the shell must stay renderable, got status=${res.status} body=${text}`);
  const parsed = JSON.parse(text) as { ok?: boolean; transcriptError?: unknown; turns?: unknown[]; affordances?: unknown[] };

  const message = typeof parsed.transcriptError === 'string' ? parsed.transcriptError : '';
  assert.ok(message.length > 0, `the refusal must be surfaced, never silently empty: ${text}`);
  assert.ok(message.includes('no-such-stage'), `transcriptError must name the offending value, got: ${message}`);
  assert.ok(message.includes('roadmap'), `transcriptError must name the allowed stage set, got: ${message}`);
  assert.deepEqual(parsed.turns, [], 'a refused derivation contributes NO turns — never a partial or defaulted transcript');
  assert.ok(Array.isArray(parsed.affordances), 'the rest of the shell (affordances included) still renders — the failure is scoped to the transcript pane');
});

// ---------------------------------------------------------------------------
// AT-59 (A1, the reviewer-flagged BLOCKER) — status.json symlink escape.
// `phase` is read via `readSessionStatus` (interactive-session.ts), a plain
// existsSync/readFileSync with NO realpath check — a different, unguarded
// read path from session-transcript.ts's `safeReadFileInSession`. The
// session DIRECTORY here is genuine and real (unlike AT-47's whole-dir
// symlink) — only the single status.json FILE inside it is a symlink
// pointing outside. Reviewer repro: this currently returns 200 with the
// fabricated phase leaked straight into the response.
// ---------------------------------------------------------------------------

test('AT-59: a session dir whose status.json is a symlink pointing OUTSIDE it is rejected (404) — the escaped phase value never appears anywhere in the response', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${STATUS_ESCAPE_SESSION}?project=statusescapeproj`);
  const text = await res.text();
  assert.ok(!text.includes(STATUS_SECRET_MARKER), `the escaped status.json content must never appear in the response, got: ${text}`);
  // The intended post-fix behaviour: treated the same as "no readable
  // status.json" — a 404, not a 200 with a guessed/leaked phase.
  assert.equal(res.status, 404, `expected 404 (escaped status.json treated as unreadable), got status=${res.status} body=${text}`);
});

// ---------------------------------------------------------------------------
// AT-60 (A2 route-level) — the route's already-known `phase` must be
// threaded into deriveSessionTranscript so the phase-driven pending-turn
// contract (session-transcript.test.ts AT-57/58) reaches the wire.
// ---------------------------------------------------------------------------

test('AT-60: a session genuinely awaiting-answers, with a VERBATIM re-asked question → the pending agent turn IS present in the route response', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${REASK_SESSION}?project=reaskproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;
  assert.equal(body.phase, 'awaiting-answers');
  const pending = body.turns.find((t) => t.source === 'questions.json');
  assert.ok(pending, `expected a pending agent turn for the verbatim re-ask (phase awaiting-answers), got turns: ${JSON.stringify(body.turns)}`);
  assert.equal(pending!.role, 'agent');
  assert.equal(pending!.text, 'What is the project name?');
});

// ---------------------------------------------------------------------------
// AT-amendment-3, A3 (AT-70..74) — the 404 message buckets for every
// status.json failure shape. Confirmed by reading the current route (not
// guessed): bucket 1 = "session not found (status.json is missing,
// unreadable, or not valid JSON)" for missing/malformed-JSON/non-object;
// bucket 2 = 'session not found (status.json has no string "phase" field)'
// for a valid object with a missing or non-string phase. All five ATs below
// are GREEN ON ARRIVAL — this is coverage against regression, not a fresh
// catch; reported honestly rather than implied as a new defect.
// ---------------------------------------------------------------------------

const STATUS_MISSING_OR_MALFORMED_MESSAGE = 'session not found (status.json is missing, unreadable, or not valid JSON)';
const STATUS_NO_PHASE_MESSAGE = 'session not found (status.json has no string "phase" field)';

test('AT-70: status.json missing entirely → 404, the exact "missing/unreadable/not-JSON" bucket message', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${MISSING_STATUS_SESSION}?project=statusbucketproj`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, STATUS_MISSING_OR_MALFORMED_MESSAGE);
});

test('AT-71: status.json present but not valid JSON → 404, the exact "missing/unreadable/not-JSON" bucket message', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${INVALID_JSON_STATUS_SESSION}?project=statusbucketproj`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, STATUS_MISSING_OR_MALFORMED_MESSAGE);
});

test('AT-72: status.json is valid JSON but NOT an object (an array) → 404, the exact "missing/unreadable/not-JSON" bucket message', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${NON_OBJECT_STATUS_SESSION}?project=statusbucketproj`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, STATUS_MISSING_OR_MALFORMED_MESSAGE);
});

test('AT-73: status.json is a valid object with NO "phase" field → 404, the exact "no string phase" bucket message — must NOT claim the file was unreadable', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${NO_PHASE_STATUS_SESSION}?project=statusbucketproj`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, STATUS_NO_PHASE_MESSAGE);
  assert.ok(!body.error.toLowerCase().includes('unreadable'), `a valid, readable status.json missing "phase" must NOT be described as unreadable, got: ${body.error}`);
});

test('AT-74: status.json\'s "phase" is present but NOT a string (a number) → 404, the exact "no string phase" bucket message — must NOT claim the file was unreadable', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${NON_STRING_PHASE_STATUS_SESSION}?project=statusbucketproj`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, STATUS_NO_PHASE_MESSAGE);
  assert.ok(!body.error.toLowerCase().includes('unreadable'), `a valid, readable status.json with a non-string phase must NOT be described as unreadable, got: ${body.error}`);
});

// ---------------------------------------------------------------------------
// R4-15 (AT-77) — roadmap-draft rows carry cross-initiative dependsOn edges
// over the REAL wire. This drives the REAL route against a REAL on-disk
// session dir with REAL serializeManifest'd manifests — a unit test that
// constructs its own row object cannot observe a field dropped by the
// route's JSON serialization (standing rule from R2-09: any claim about a
// value surviving a round trip needs at least one AT on the real client
// path).
// ---------------------------------------------------------------------------

test('AT-77: GET /api/studio/sessions/architect/<id>?project=<p> carries "dependsOn" on each roadmap-draft row, verbatim, over the REAL route + REAL serialized manifests', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${DEPS_SESSION}?project=depsproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;

  const artifact = body.artifact as { kind: string; rows: Array<{ initiativeId: string; dependsOn: unknown }> };
  assert.equal(artifact.kind, 'roadmap-draft');
  const rowA = artifact.rows.find((r) => r.initiativeId === 'INIT-2026-01-01-fixture-a');
  const rowB = artifact.rows.find((r) => r.initiativeId === 'INIT-2026-01-02-fixture-b');
  assert.ok(rowA, `expected row A in the wire response, got: ${JSON.stringify(artifact.rows)}`);
  assert.ok(rowB, `expected row B in the wire response, got: ${JSON.stringify(artifact.rows)}`);
  assert.deepEqual(rowA!.dependsOn, [], 'row A declares no deps — must serialize as [] over the wire, never dropped/undefined');
  assert.deepEqual(
    rowB!.dependsOn,
    ['INIT-2026-01-01-fixture-a', 'INIT-2025-06-01-already-merged'],
    'row B\'s dependsOn must survive the REAL route\'s JSON serialization verbatim, including the entry pointing outside this session\'s own manifest set',
  );
});

// ---------------------------------------------------------------------------
// R4-17 — the "onboarding" session kind threads deriveContractStages
// (packages/projects/contract-stages.ts) into the contract-buildout artifact. This is the
// REAL wire (route → deriveContractStages → deriveSessionArtifact), not a
// unit-level fixture — the standing R2-09 rule that a value's survival
// through the route's own serialization needs at least one real-client-path
// AT.
// ---------------------------------------------------------------------------

test('R4-17 AT-1: GET /api/studio/sessions/onboarding/<id>?project=<p> derives contract-buildout via the REAL deriveContractStages over a REAL onboarded project fixture — 200, honestly one turn, five stage rows in order', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/onboarding/${ONBOARDING_SESSION}?project=onboardedproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;

  assert.equal(body.ok, true);
  assert.equal(body.kind, 'onboarding');
  assert.equal(body.phase, 'running', 'phase must be the real value read from status.json');
  assert.deepEqual(body.stages, ['contract', 'instructions', 'secrets', 'demo', 'roadmap']);
  assert.equal(body.defaultStage, 'contract');

  // D8 — no fabricated interview: the onboarding-agent asks no questions,
  // so the honest transcript is exactly the one prompt.md operator turn.
  assert.equal(body.turns.length, 1, `onboarding must surface honestly as one turn, no fabricated interview questions, got: ${JSON.stringify(body.turns)}`);
  assert.equal(body.turns[0].role, 'operator');
  assert.equal(body.turns[0].source, 'prompt.md');

  const artifact = body.artifact as { kind: string; label: string; stages: Array<{ stage: string; status: string }> };
  assert.equal(artifact.kind, 'contract-buildout');
  assert.equal(artifact.label, 'Contract build-out');
  assert.deepEqual(
    artifact.stages.map((s) => s.stage),
    ['contract', 'instructions', 'secrets', 'demo', 'roadmap'],
    'the derived rows must reach the wire in the declared D2 order, all five, never a dropped row',
  );
  // The fixture's REAL on-disk shape: testProcess.local.cmd + roadmap.md
  // exist; AGENTS.md/CLAUDE.md and the acceptance/demo blocks do not.
  const byStage = (s: string): { status: string } => artifact.stages.find((r) => r.stage === s)!;
  assert.equal(byStage('contract').status, 'present');
  assert.equal(byStage('instructions').status, 'absent');
  assert.equal(byStage('secrets').status, 'absent');
  assert.equal(byStage('demo').status, 'absent');
  assert.equal(byStage('roadmap').status, 'present');
});

test('R4-17 AT-2: a malformed .forge/project.json → deriveContractStages\'s {ok:false} surfaces as a NON-200 error naming the cause, never a 200 with an empty/silent artifact', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/onboarding/${ONBOARDING_BAD_CONFIG_SESSION}?project=malformedcontractproj`);
  assert.notEqual(res.status, 200, 'a malformed project.json must never be smoothed into a 200 — this is the "declared data fails open" shape this campaign keeps finding');
  const body = (await res.json()) as { error?: string; ok?: boolean };
  assert.ok(
    typeof body.error === 'string' && body.error.length > 0,
    `the error response must name the cause, got: ${JSON.stringify(body)}`,
  );
  assert.notEqual(body.ok, true, 'the response must not claim ok:true alongside an error');
});


