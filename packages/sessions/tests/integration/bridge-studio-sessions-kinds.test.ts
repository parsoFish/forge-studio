import { type SessionShellBody, captureResponse } from './test-fixtures/studio-sessions-builders.ts';
import { F6_DERIVED_PROJECT, F6_LAST_PHASE, F6_NOT_FOUND_SESSION, F6_NO_EVENTS_SESSION, F6_RUN_LEGACY, F6_RUN_NOWHERE, F6_RUN_STATUS_BACKED, F6_SECRET_MARKER, F6_SHAPE_A_SESSION, F6_SHAPE_B_PROJECT, F6_SHAPE_B_SESSION, F6_SYMLINK_ESCAPE_SESSION, KB_CLEANUP_APPLIED_SESSION, KB_CLEANUP_RESOLVABLE_SESSION, KB_CLEANUP_UNRESOLVABLE_SESSION, MISSING_STATUS_SESSION, NO_PHASE_STATUS_SESSION, ONBOARDING_COMPLETE_SESSION, ONBOARDING_FAILED_SESSION, ONBOARDING_SESSION, REAL_ARCHITECT_SESSION, REAL_INSTRUCTIONS_SESSION } from './test-fixtures/studio-sessions-builders.ts';
import { bridgeUrl, forgeRoot } from './test-fixtures/studio-sessions-bridge.ts';
import { GITPULSE_SESSION, KB_SEEDING_MIXED_PROJECT, KB_SEEDING_MIXED_SESSION, KB_SEEDING_PROJECT, KB_SEEDING_SESSION } from './test-fixtures/studio-sessions-bridge.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { handleStudioSessionsRoutes, type SessionsRouteContext } from '../../bridge-studio-sessions.ts';
import { isPseudoProjectAnchor } from '../../session-resolution.ts';

// ---------------------------------------------------------------------------
// R4-19 WI-2 — the ".kb-" seeding-anchor carve-out. AT-1 is the RED pin that
// flips green on the fix (invalidProjectReason currently rejects ANY
// dot-leading project, full stop, so the real KB-seeding anchor is
// unreachable). AT-2..AT-7 are the containment RATCHET the fix must not
// break — every one of them is a bare SLUG_RE rejection today (nothing in
// the current code special-cases ".kb-" at all, so a leading "." is ALWAYS
// a 400 pre-fix), and MUST remain a 400 once the bounded exact-".kb-"+
// valid-slug carve-out exists, proving the carve-out never widens into a
// general "." allow. AT-8 is the companion pin: the ordinary non-dot path
// is untouched by the carve-out, both before and after.
// ---------------------------------------------------------------------------

test('R4-19 WI-2 AT-1 (RED — reachability, flips green on the fix): GET /api/studio/sessions/project-brain/<sid>?project=.kb-<id> returns the REAL session status (200), not 400', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/project-brain/${KB_SEEDING_SESSION}?project=${KB_SEEDING_PROJECT}`);
  const text = await res.text();
  assert.equal(
    res.status,
    200,
    `a ".kb-" seeding-anchor session must be reachable via a BOUNDED exact-prefix carve-out (R4-19 WI-2) — expected 200, got ${res.status}: ${text}`,
  );
  const body = JSON.parse(text) as SessionShellBody;
  assert.equal(body.ok, true);
  assert.equal(body.kind, 'project-brain');
  assert.equal(body.sessionId, KB_SEEDING_SESSION);
  assert.equal(body.project, KB_SEEDING_PROJECT, 'the dot-anchored project id must be echoed back verbatim, not stripped/normalized');
  assert.equal(body.phase, 'briefing', 'phase must be the REAL value written by the create hand-off (guardedWriteSessionStatus), never fabricated');
});

test('W7A4-02 (RED on main): a mixed-case / digit-leading KB id\'s seeding session is reachable via ?project=.kb-<id> — the anchor gate is KB_ID_RE, the same rule the create route applied', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/project-brain/${KB_SEEDING_MIXED_SESSION}?project=${encodeURIComponent(KB_SEEDING_MIXED_PROJECT)}`);
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200 for the KB_ID_RE-valid anchor "${KB_SEEDING_MIXED_PROJECT}", got ${res.status}: ${text}`);
  const body = JSON.parse(text) as SessionShellBody;
  assert.equal(body.ok, true);
  assert.equal(body.kind, 'project-brain');
  assert.equal(body.sessionId, KB_SEEDING_MIXED_SESSION);
  assert.equal(body.project, KB_SEEDING_MIXED_PROJECT, 'the case-preserving anchor is echoed verbatim — never lowercased');
  assert.equal(body.phase, 'briefing');
});

test('W7A4-02 (RED on main): the same session resolves through the BARE deep link (no ?project=) — findSessionProject must not skip a KB_ID_RE-valid anchor dir', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/project-brain/${KB_SEEDING_MIXED_SESSION}`);
  const text = await res.text();
  assert.equal(res.status, 200, `bare deep link → expected 200, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as SessionShellBody;
  assert.equal(body.ok, true);
  assert.equal(body.project, KB_SEEDING_MIXED_PROJECT, 'the resolved anchor project is filled in verbatim');
});

test('R4-19 WI-2 AT-2 (containment guard — must stay 400 after the fix): a traversal-shaped ".kb-x/../../etc" project param is rejected, never resolving through the exact-prefix carve-out', async () => {
  const ctx: SessionsRouteContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs'), ensureSessionTail: () => {} };
  const { res, status, body } = captureResponse();
  const rawUrl = `/api/studio/sessions/project-brain/${KB_SEEDING_SESSION}?project=.kb-x/../../etc`;
  const handled = await handleStudioSessionsRoutes({} as import('node:http').IncomingMessage, res, ctx, rawUrl, 'GET');
  assert.equal(handled, true, 'must be handled (not passthrough)');
  assert.equal(status(), 400, `expected 400, got ${status()}: ${JSON.stringify(body())}`);
});

test('R4-19 WI-2 AT-3 (containment guard — must stay 400 after the fix): ".kb-" with an EMPTY slug after the prefix is rejected', async () => {
  const ctx: SessionsRouteContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs'), ensureSessionTail: () => {} };
  const { res, status, body } = captureResponse();
  const rawUrl = `/api/studio/sessions/project-brain/${KB_SEEDING_SESSION}?project=.kb-`;
  const handled = await handleStudioSessionsRoutes({} as import('node:http').IncomingMessage, res, ctx, rawUrl, 'GET');
  assert.equal(handled, true, 'must be handled (not passthrough)');
  assert.equal(status(), 400, `expected 400, got ${status()}: ${JSON.stringify(body())}`);
});

test('R4-19 WI-2 AT-4 (containment guard — must stay 400 after the fix): "../secret" (no ".kb-" prefix at all) is rejected', async () => {
  const ctx: SessionsRouteContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs'), ensureSessionTail: () => {} };
  const { res, status, body } = captureResponse();
  const rawUrl = `/api/studio/sessions/project-brain/${KB_SEEDING_SESSION}?project=../secret`;
  const handled = await handleStudioSessionsRoutes({} as import('node:http').IncomingMessage, res, ctx, rawUrl, 'GET');
  assert.equal(handled, true, 'must be handled (not passthrough)');
  assert.equal(status(), 400, `expected 400, got ${status()}: ${JSON.stringify(body())}`);
});

test('R4-19 WI-2 AT-5 (containment guard — must stay 400 after the fix): ".foo" is dot-prefixed but NOT the ".kb-" prefix — rejected, proving the carve-out is never a general "." allow', async () => {
  const ctx: SessionsRouteContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs'), ensureSessionTail: () => {} };
  const { res, status, body } = captureResponse();
  const rawUrl = `/api/studio/sessions/project-brain/${KB_SEEDING_SESSION}?project=.foo`;
  const handled = await handleStudioSessionsRoutes({} as import('node:http').IncomingMessage, res, ctx, rawUrl, 'GET');
  assert.equal(handled, true, 'must be handled (not passthrough)');
  assert.equal(status(), 400, `expected 400, got ${status()}: ${JSON.stringify(body())}`);
});

test('R4-19 WI-2 AT-6 (containment guard — must stay 400 after the fix): ".kb-<id>" whose id contains a "/" is rejected — proves the carve-out validates the POST-prefix slug, not just the literal prefix', async () => {
  const ctx: SessionsRouteContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs'), ensureSessionTail: () => {} };
  const { res, status, body } = captureResponse();
  // %2F decodes (via URLSearchParams, same as AT-46's 'a%2Fb' variant) to a
  // literal "/" embedded inside the post-prefix slug.
  const rawUrl = `/api/studio/sessions/project-brain/${KB_SEEDING_SESSION}?project=.kb-abc%2Fdef`;
  const handled = await handleStudioSessionsRoutes({} as import('node:http').IncomingMessage, res, ctx, rawUrl, 'GET');
  assert.equal(handled, true, 'must be handled (not passthrough)');
  assert.equal(status(), 400, `expected 400, got ${status()}: ${JSON.stringify(body())}`);
});

test('R4-19 WI-2 AT-7 (containment guard — must stay 400 after the fix): ".kb-<id>" whose id contains an embedded NUL byte is rejected', async () => {
  const ctx: SessionsRouteContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs'), ensureSessionTail: () => {} };
  const { res, status, body } = captureResponse();
  // %00 decodes (via URLSearchParams, same as AT-46's '%00' variant) to a
  // literal NUL byte embedded inside the post-prefix slug.
  const rawUrl = `/api/studio/sessions/project-brain/${KB_SEEDING_SESSION}?project=.kb-abc%00def`;
  const handled = await handleStudioSessionsRoutes({} as import('node:http').IncomingMessage, res, ctx, rawUrl, 'GET');
  assert.equal(handled, true, 'must be handled (not passthrough)');
  assert.equal(status(), 400, `expected 400, got ${status()}: ${JSON.stringify(body())}`);
});

test('R4-19 WI-2 AT-8 (companion — unaffected by the carve-out, both before and after): GET /api/studio/sessions/project-brain/<sid>?project=gitpulse still resolves its session unchanged', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/project-brain/${GITPULSE_SESSION}?project=gitpulse`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;
  assert.equal(body.ok, true);
  assert.equal(body.kind, 'project-brain');
  assert.equal(body.project, 'gitpulse');
  assert.equal(body.phase, 'analyzing', 'phase must be the real value read from the session\'s status.json — the non-dot path\'s behavior must be identical to AT-40');
});

// ===========================================================================
// R4-19-F2 — the kb-cleanup read branch's fail-loud contract (task brief §4,
// NOT among the 16 explicitly numbered acceptance tests — flagged separately
// in this WI's report as a gap in the enumerated list, but load-bearing per
// the brief's own wording: "A session whose kb_id no longer resolves must
// fail loud, not render an empty artifact"). This is the single test in this
// file exercising that branch; the renderer-level throw-on-missing-findings
// contract is pinned exhaustively in session-transcript.test.ts's own
// R4-19-F2 block instead.
// ===========================================================================

// Kills: a bridge read branch that catches deriveContractStages/lint-lookup
// failures the wrong way and falls through to `deriveSessionArtifact({
// descriptor, sessionDir })` with no cleanupFindings — which (once
// 'cleanup-plan' ships live) throws a DIFFERENT error ("cleanupFindings
// required") that gets smoothed into a generic 500 with no mention of the
// actual root cause (the unresolvable kb_id); also kills a branch that
// swallows the kb_id-resolution failure and renders a 200 with an empty
// cleanup-plan artifact — the exact "declared-data-fails-open" shape this
// whole campaign guards against.
test('R4-19-F2: GET /api/studio/sessions/kb-cleanup/<id>?project=<p> whose stored kb_id resolves to NO real KB fails loud (a non-200 naming the cause), never a 200 with an empty/silent cleanup-plan artifact', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/kb-cleanup/${KB_CLEANUP_UNRESOLVABLE_SESSION}?project=demoproj`);
  assert.notEqual(
    res.status,
    200,
    'a session whose kb_id no longer resolves to any real KB must never be smoothed into a 200 — the fixture\'s status.json genuinely has kb_id:"no-such-kb-anywhere-on-disk" with no matching brain/ dir anywhere',
  );
  const body = (await res.json()) as { error?: string; ok?: boolean };
  assert.ok(
    typeof body.error === 'string' && body.error.length > 0,
    `the error response must name the cause, got: ${JSON.stringify(body)}`,
  );
  assert.notEqual(body.ok, true, 'the response must not claim ok:true alongside an error');
  // Tightened beyond a bare non-200: the error must actually name the
  // UNRESOLVABLE kb_id itself, not just some unrelated failure incidentally
  // reached first (e.g. "cleanup-plan" not yet being a recognised artifact
  // kind at all, today's status quo) — this is what makes this test a real
  // RED pin for the branch-specific fail-loud behaviour rather than a
  // vacuous pass from an earlier-stage failure.
  assert.match(
    body.error!,
    /no-such-kb-anywhere-on-disk/,
    `the error must name the specific unresolvable kb_id the fixture's status.json carries, not a generic/unrelated failure — got: ${body.error}`,
  );
});

// W6-B9 (reviewer finding on W6-B8): the `kbId` field these two tests used
// to pin (R4-19-F2 WI-4c) is REMOVED from the session-shell read route's 200
// wire payload — its one reader, SessionCleanupPanel.tsx, is deleted (W6-B8
// migrated kb-cleanup onto the generic session shell; the generic write
// route reads `status.kb_id` server-side, never off this wire field). The
// AT-KBID-1 affordances assertion this block also carried (kb-cleanup's
// turnSpec-derived verdict shape at "awaiting-approval") is preserved below,
// folded into the existing W6-B8 terminal:false test against the SAME
// fixture session, rather than dropped.

// ===========================================================================
// W6-B8 — `terminal` on the session-shell read route's 200 payload. Threads
// the SAME `isTerminalPhase` derivation the route already used internally to
// gate `ensureSessionTail` (this file's header, W6-B2 review fix) onto the
// wire, so the generic `SessionInteractivePanel` can gate its ActivityLog
// drawer without a second, hand-kept terminal-phase table client-side.
//
// The panel-fallback fix this pins: `isTerminalPhase` previously checked
// ONLY `descriptor.turnSpec` before falling back to
// `LEGACY_SESSION_TERMINAL_PHASES` — a descriptor carrying `panel` instead
// (onboarding, demo, instructions) fell straight to the legacy table, which
// has NO 'onboarding' entry at all (see that table, apps/forge/bridge-studio.ts),
// so onboarding was *always* reported non-terminal, at every phase including
// its own declared-terminal 'complete'/'failed' rows. The fix derives from
// `descriptor.turnSpec?.phases ?? descriptor.panel?.phases` first, exactly
// mirroring `deriveSessionAffordances`'s own precedent — the demo/
// instructions tests below prove this is a no-op for those two kinds (their
// panel-derived terminal set already matches the legacy table verbatim).
// ===========================================================================

test('W6-B8: GET /api/studio/sessions/kb-cleanup/<id> — terminal:false at a non-terminal turnSpec phase ("awaiting-approval")', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/kb-cleanup/${KB_CLEANUP_RESOLVABLE_SESSION}?project=demoproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;
  assert.equal(body.terminal, false, `phase "awaiting-approval" (step: noop) is not terminal — got terminal=${JSON.stringify(body.terminal)}`);

  // Folded in from the retired AT-KBID-1 (W6-B9): a TURNSPEC kind
  // (kb-cleanup) at phase "awaiting-approval" ({ step: noop }, no
  // writes/next — that absence IS the approval gate) must derive exactly a
  // "verdict" affordance — proves the bridge threads turnSpec.phases through
  // deriveSessionAffordances, the counterpart to the AT-39 instructions
  // (panel-kind) affordance assertion above.
  assert.deepEqual(
    body.affordances,
    [{ id: 'awaiting-approval-verdict', kind: 'verdict', phase: 'awaiting-approval', meta: { verdicts: ['approve'] } }],
    `expected the turnSpec-derived affordances for phase "awaiting-approval", got: ${JSON.stringify(body.affordances)}`,
  );
});

test('W6-B8: GET /api/studio/sessions/kb-cleanup/<id> — terminal:true at the turnSpec\'s own terminal phase ("applied")', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/kb-cleanup/${KB_CLEANUP_APPLIED_SESSION}?project=demoproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;
  assert.equal(body.phase, 'applied');
  assert.equal(body.terminal, true, `phase "applied" (step: terminal) must report terminal=true — got ${JSON.stringify(body.terminal)}`);
});

test('W6-B8 (the panel-fallback fix): GET /api/studio/sessions/onboarding/<id> — terminal:false at a non-terminal PANEL phase ("running")', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/onboarding/${ONBOARDING_SESSION}?project=onboardedproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;
  assert.equal(body.phase, 'running');
  assert.equal(body.terminal, false, `phase "running" (step: agent) is not terminal — got terminal=${JSON.stringify(body.terminal)}`);
});

test('W6-B8 (the panel-fallback fix): GET /api/studio/sessions/onboarding/<id> — terminal:true at the panel\'s own terminal phase ("complete") — REGRESSION LOCK: onboarding has no LEGACY_SESSION_TERMINAL_PHASES entry, so before the fix this always read terminal:false, even here', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/onboarding/${ONBOARDING_COMPLETE_SESSION}?project=onboardedproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;
  assert.equal(body.phase, 'complete');
  assert.equal(body.terminal, true, `phase "complete" (the panel's own step:'terminal' row) must report terminal=true — got ${JSON.stringify(body.terminal)}`);
});

test('LOW (reviewer finding on W6-B8): GET /api/studio/sessions/onboarding/<id> — terminal:true at the panel\'s OTHER terminal phase ("failed") — proves the fix reads the whole panel.phases table, not just the first terminal row it happens to find', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/onboarding/${ONBOARDING_FAILED_SESSION}?project=onboardedproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;
  assert.equal(body.phase, 'failed');
  assert.equal(body.terminal, true, `phase "failed" (the panel's OTHER step:'terminal' row) must report terminal=true — got ${JSON.stringify(body.terminal)}`);
});

test('W6-B8: GET /api/studio/sessions/instructions/<id> — terminal:false at "drafting" (a panel-derived kind whose legacy-table set already agreed — proves the fix is a no-op here)', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/instructions/${REAL_INSTRUCTIONS_SESSION}?project=demoproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;
  assert.equal(body.phase, 'drafting');
  assert.equal(body.terminal, false);
});

// ===========================================================================
// W6-B9 reviewer fix — isPseudoProjectAnchor: the general leading-"." check
// backing the generic session-shell page's "back to project" link decision
// (apps/studio/lib/session-shell-view.ts mirrors this exact predicate — kept
// honest by that file's own parity test).
// ===========================================================================

test('isPseudoProjectAnchor: a real project slug is NOT a pseudo-anchor', () => {
  assert.equal(isPseudoProjectAnchor('mdtoc'), false);
  assert.equal(isPseudoProjectAnchor('my-real-project'), false);
});

test('isPseudoProjectAnchor: the KB-seeding anchor shape (".kb-<id>") IS a pseudo-anchor', () => {
  assert.equal(isPseudoProjectAnchor('.kb-forge-dev'), true);
});

test('isPseudoProjectAnchor: the community-refresh anchor (".community-registry") IS a pseudo-anchor, even though its constant is not yet merged onto this branch — the check is general (leading "."), not an enumerated allow-list', () => {
  assert.equal(isPseudoProjectAnchor('.community-registry'), true);
});

test('isPseudoProjectAnchor: ANY leading-"." value is a pseudo-anchor, including one this file has never heard of — matches discoverProjects\' own categorical dot-dir filter', () => {
  assert.equal(isPseudoProjectAnchor('.some-future-anchor'), true);
});

// ===========================================================================
// W7-C2 (sessions-kinds-17/19, bead forge-lzv) — the shell route attaches the
// PENDING interview questions (questions.json, parsed structurally) onto the
// question-form affordance's meta at phase 'awaiting-answers', so the panel
// can render one control per question and post the REAL question text back —
// never the literal placeholder "Operator response" into the durable record.
// Plus (sessions-kinds-36): the payload carries `finalized` — the persisted
// {kind, id} pointer at whatever object a committed session produced — as a
// REQUIRED field whose honest empty value is null.
// ===========================================================================

test('C2-SHELL-1: awaiting-answers + questions.json -> the question-form affordance carries meta.questions (text + options)', async () => {
  const sessionId = '2026-08-21T09-00-00-c2q1';
  const dir = join(forgeRoot, 'projects', 'demoproj', '_instructions', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ session_id: sessionId, project: 'demoproj', phase: 'awaiting-answers', round: 1 }), 'utf8');
  writeFileSync(join(dir, 'questions.json'), JSON.stringify([
    { question: 'What language and build toolchain does this project use?', header: 'Toolchain', options: [{ label: 'Node + npm', description: 'package.json driven' }] },
    { question: 'What is the single quality-gate command?', header: 'Gate', options: [] },
  ]), 'utf8');

  const res = await fetch(`${bridgeUrl}/api/studio/sessions/instructions/${sessionId}?project=demoproj`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    affordances: Array<{ kind: string; phase: string; meta?: { questions?: Array<{ question: string; options: Array<{ label: string; description: string }> }> } }>;
  };
  const qf = body.affordances.find((a) => a.kind === 'question-form');
  assert.ok(qf, 'awaiting-answers must derive a question-form affordance');
  assert.ok(qf!.meta?.questions, 'the pending questions must ride the affordance meta');
  assert.equal(qf!.meta!.questions!.length, 2);
  assert.equal(qf!.meta!.questions![0].question, 'What language and build toolchain does this project use?');
  assert.deepEqual(qf!.meta!.questions![0].options, [{ label: 'Node + npm', description: 'package.json driven' }]);
  assert.deepEqual(qf!.meta!.questions![1].options, []);
});

test('C2-SHELL-2: a stale questions.json OUTSIDE awaiting-answers attaches nothing (mirrors the transcript pending rule)', async () => {
  const sessionId = '2026-08-21T09-00-00-c2q2';
  const dir = join(forgeRoot, 'projects', 'demoproj', '_instructions', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ session_id: sessionId, project: 'demoproj', phase: 'awaiting-verdict', round: 2 }), 'utf8');
  writeFileSync(join(dir, 'AGENTS.draft.md'), '# AGENTS.md\n', 'utf8');
  writeFileSync(join(dir, 'questions.json'), JSON.stringify([{ question: 'Stale leftover?' }]), 'utf8');

  const res = await fetch(`${bridgeUrl}/api/studio/sessions/instructions/${sessionId}?project=demoproj`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { affordances: Array<{ kind: string; meta?: Record<string, unknown> }> };
  const verdict = body.affordances.find((a) => a.kind === 'verdict');
  assert.ok(verdict, 'awaiting-verdict derives a verdict affordance');
  for (const a of body.affordances) {
    assert.equal(a.meta && 'questions' in a.meta, false, `no affordance may carry stale questions (got ${JSON.stringify(a)})`);
  }
});

test('C2-SHELL-3: `finalized` is ALWAYS on the wire — null when the session produced nothing, the persisted {kind,id} verbatim when it did', async () => {
  const bare = await fetch(`${bridgeUrl}/api/studio/sessions/instructions/${REAL_INSTRUCTIONS_SESSION}?project=demoproj`);
  assert.equal(bare.status, 200);
  const bareBody = (await bare.json()) as Record<string, unknown>;
  assert.ok('finalized' in bareBody, 'the key must always be present');
  assert.equal(bareBody.finalized, null);

  const sessionId = '2026-08-21T09-00-00-c2fin';
  const dir = join(forgeRoot, 'projects', 'demoproj', '_instructions', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify({
    session_id: sessionId, project: 'demoproj', phase: 'committed',
    finalized: { kind: 'skill', id: 'c2-authored-skill' },
  }), 'utf8');
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/instructions/${sessionId}?project=demoproj`);
  assert.equal(res.status, 200);
  // W7-C2 T1 review (P0-4) — the pointer's identity rides through verbatim,
  // and `exists` is DERIVED at read time. This fixture points at a skill that
  // was never installed in this temp forge root, so the honest answer is
  // `exists: false` — which is exactly what stops `FinalizedLink` emitting a
  // dead `/skills/<id>`.
  const body = (await res.json()) as { finalized: { kind: string; id: string; exists: boolean } | null };
  assert.deepEqual(body.finalized, { kind: 'skill', id: 'c2-authored-skill', exists: false });
});

test('C2-FIX-P04-1: `finalized.exists` is DERIVED from the object on disk — true once the skill is really installed, false again when it is removed', async () => {
  const sessionId = '2026-08-21T09-00-00-c2finex';
  const dir = join(forgeRoot, 'projects', 'demoproj', '_instructions', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify({
    session_id: sessionId, project: 'demoproj', phase: 'committed',
    finalized: { kind: 'skill', id: 'c2-live-skill' },
  }), 'utf8');
  const skillDir = join(forgeRoot, 'skills', 'c2-live-skill');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: C2 Live\ndescription: fixture\n---\n', 'utf8');
  const live = await fetch(`${bridgeUrl}/api/studio/sessions/instructions/${sessionId}?project=demoproj`);
  assert.deepEqual(((await live.json()) as { finalized: unknown }).finalized, { kind: 'skill', id: 'c2-live-skill', exists: true });

  rmSync(skillDir, { recursive: true, force: true });
  const gone = await fetch(`${bridgeUrl}/api/studio/sessions/instructions/${sessionId}?project=demoproj`);
  assert.deepEqual(
    ((await gone.json()) as { finalized: unknown }).finalized,
    { kind: 'skill', id: 'c2-live-skill', exists: false },
    'a deleted/renamed object must be reported as gone — the stored pointer alone is never treated as proof it is still there',
  );
});

test('C2-FIX-P03-1: a corrupt verdicts.json scopes its fail-closed refusal to the TRANSCRIPT — the shell still renders WITH its verdict affordance', async () => {
  const sessionId = '2026-08-21T09-00-00-c2vbad';
  const dir = join(forgeRoot, 'projects', 'demoproj', '_instructions', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ session_id: sessionId, project: 'demoproj', phase: 'awaiting-verdict', round: 2 }), 'utf8');
  writeFileSync(join(dir, 'AGENTS.draft.md'), '# AGENTS.md\n', 'utf8');
  // A partial write from a killed bridge — valid-JSON-prefix, unparseable file.
  writeFileSync(join(dir, 'verdicts.json'), '[{"at":"2026-08-21T10:00:00.000Z","verdict":"revise"},{"at":"2026', 'utf8');

  const res = await fetch(`${bridgeUrl}/api/studio/sessions/instructions/${sessionId}?project=demoproj`);
  assert.equal(res.status, 200, 'the operator must still be able to open the session that produced the corruption');
  const body = (await res.json()) as { ok: boolean; turns: unknown[]; transcriptError: string | null; affordances: Array<{ kind: string }> };
  assert.equal(body.ok, true);
  assert.deepEqual(body.turns, [], 'nothing malformed is silently dropped — the transcript is EMPTY, never partial');
  assert.match(String(body.transcriptError), /verdicts\.json/, 'the reason is surfaced verbatim, naming the file');
  assert.ok(body.affordances.some((a) => a.kind === 'verdict'), 'the verdict controls must still be derivable — bricking them is what trapped the operator');
});

test('C2-FIX-A4-1: a MALFORMED option entry degrades the WHOLE questions field to absent (fail closed) — never a question shown with fewer options than the agent asked for', async () => {
  const sessionId = '2026-08-21T09-00-00-c2badopt';
  const dir = join(forgeRoot, 'projects', 'demoproj', '_instructions', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ session_id: sessionId, project: 'demoproj', phase: 'awaiting-answers', round: 1 }), 'utf8');
  writeFileSync(join(dir, 'questions.json'), JSON.stringify([
    { question: 'Which gate?', options: [{ label: 'npm test', description: 'the suite' }, { label: 'npm run lint' }] },
  ]), 'utf8');

  const res = await fetch(`${bridgeUrl}/api/studio/sessions/instructions/${sessionId}?project=demoproj`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { affordances: Array<{ kind: string; meta?: { questions?: unknown } }> };
  const qf = body.affordances.find((a) => a.kind === 'question-form');
  assert.ok(qf, 'the question-form affordance still derives');
  assert.equal(qf!.meta?.questions, undefined, 'a malformed option must not silently shrink the option list — the whole field degrades to absent');
});

test('C2-FIX-A3-1: each pending question carries a server-derived positional `id` — the answer-correlation handle', async () => {
  const sessionId = '2026-08-21T09-00-00-c2qid';
  const dir = join(forgeRoot, 'projects', 'demoproj', '_instructions', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ session_id: sessionId, project: 'demoproj', phase: 'awaiting-answers', round: 1 }), 'utf8');
  writeFileSync(join(dir, 'questions.json'), JSON.stringify([
    { question: 'Same text?', options: [] },
    { question: 'Same text?', options: [] },
  ]), 'utf8');

  const res = await fetch(`${bridgeUrl}/api/studio/sessions/instructions/${sessionId}?project=demoproj`);
  const body = (await res.json()) as { affordances: Array<{ kind: string; meta?: { questions?: Array<{ id: string; question: string }> } }> };
  const qs = body.affordances.find((a) => a.kind === 'question-form')!.meta!.questions!;
  assert.deepEqual(qs.map((q) => q.id), ['q1', 'q2'], 'two identically-worded questions are still distinguishable — text alone never was');
});

test('C2-SHELL-4: a malformed status.finalized (wrong shape) collapses to null — never echoed raw', async () => {
  const sessionId = '2026-08-21T09-00-00-c2finbad';
  const dir = join(forgeRoot, 'projects', 'demoproj', '_instructions', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify({
    session_id: sessionId, project: 'demoproj', phase: 'committed', finalized: 'c2-authored-skill',
  }), 'utf8');
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/instructions/${sessionId}?project=demoproj`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { finalized: unknown };
  assert.equal(body.finalized, null);
});

// ---------------------------------------------------------------------------
// F6 (wave-8) — "a linked session must be readable": GET /api/studio/sessions/
// :kind/:sessionId must not 404 for a session whose state survives ONLY as
// the central _logs/_<kind>-<sessionId>/ dir (Shape A: no project-side dir at
// all; Shape B: a project-side dir exists but carries no status.json). See
// the F6 spec (scratchpad/F6-spec.md) for the full contract these pin.
//
// NOTE on RED: AT-F6-R1/R2/R6/R8 are genuine defect-repros — they FAIL on
// the current tree (the route 404s Shape A/B today, and never emits a
// `legacy` field). AT-F6-R3/R4/R5/R7 are negative-space / regression-guard
// assertions describing behaviour that is ALREADY correct pre-fix (the
// current route never reaches the code paths they would catch a regression
// in) — they are expected to already PASS today and must keep passing after
// the fix; see this task's final report for the measured pass/fail split.
// ---------------------------------------------------------------------------

test('AT-F6-R1: Shape A over the wire (no ?project=) — GET /api/studio/sessions/architect/<id> is 200, legacy:true, phase = LAST metadata.phase, project = metadata.project, terminal:true, empty affordances/turns/transcriptSources, transcriptError:null, finalized:null, lifecycle.state="terminal"', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${F6_SHAPE_A_SESSION}`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as Record<string, unknown>;

  assert.equal(body.ok, true);
  assert.equal(body.legacy, true, 'a Shape-A session must be flagged legacy on the wire');
  assert.equal(body.phase, F6_LAST_PHASE, 'phase must be the LAST metadata.phase recorded in the log');
  assert.equal(body.project, F6_DERIVED_PROJECT, 'project must be the metadata.project recorded in the log');
  assert.equal(body.terminal, true, 'a legacy session is structurally terminal — no session dir for a runner to advance or an affordance to write into');
  assert.deepEqual(body.affordances, []);
  assert.deepEqual(body.turns, []);
  assert.deepEqual(body.transcriptSources, []);
  assert.equal(body.transcriptError, null);
  assert.equal(body.finalized, null);
  assert.equal((body.lifecycle as { state: string }).state, 'terminal');
});

test('AT-F6-R2: Shape B over the wire — a project-side dir with NO status.json, plus a companion log dir with events.jsonl -> 200, legacy:true', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${F6_SHAPE_B_SESSION}?project=${F6_SHAPE_B_PROJECT}`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as Record<string, unknown>;
  assert.equal(body.ok, true);
  assert.equal(body.legacy, true);
});

test('AT-F6-R3: the two EXISTING status.json 404 buckets are unchanged, byte-identical, when there is no log dir', async () => {
  const missing = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${MISSING_STATUS_SESSION}?project=statusbucketproj`);
  const missingBody = (await missing.json()) as { error: string };
  assert.equal(missing.status, 404);
  assert.equal(missingBody.error, 'session not found (status.json is missing, unreadable, or not valid JSON)');

  const noPhase = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${NO_PHASE_STATUS_SESSION}?project=statusbucketproj`);
  const noPhaseBody = (await noPhase.json()) as { error: string };
  assert.equal(noPhase.status, 404);
  assert.equal(noPhaseBody.error, 'session not found (status.json has no string "phase" field)');
});

test('AT-F6-R4: a session that exists NOWHERE (no project dir, no log dir) is still 404 "session not found"', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${F6_NOT_FOUND_SESSION}`);
  const body = (await res.json()) as { error: string };
  assert.equal(res.status, 404);
  assert.equal(body.error, 'session not found');
});

test('AT-F6-R5: a log dir that exists but has NO events.jsonl (only stderr.log) is still 404 — a dir with neither status.json nor events.jsonl stays 404', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${F6_NO_EVENTS_SESSION}`);
  const body = (await res.json()) as { error: string };
  assert.equal(res.status, 404, JSON.stringify(body));
});

test('AT-F6-R6: a normal, status.json-backed session still returns legacy:false and its phase/affordances/terminal are UNCHANGED from AT-38', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${REAL_ARCHITECT_SESSION}?project=demoproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as Record<string, unknown>;
  assert.equal(body.legacy, false);
  assert.equal(body.phase, 'awaiting-verdict');
  assert.deepEqual(body.affordances, []);
  assert.equal(body.terminal, false);
});

test('AT-F6-R7: (escape, over the REAL wire) a legacy log dir whose events.jsonl is a symlink to a file outside _logs -> 404, marker never appears in the raw response text', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${F6_SYMLINK_ESCAPE_SESSION}`);
  const text = await res.text();
  assert.equal(res.status, 404, text);
  assert.doesNotMatch(text, new RegExp(F6_SECRET_MARKER), 'the escaped marker must never appear anywhere in the raw response');
});

test('AT-F6-R8: the run pointer — GET /api/runs/<id> drops architectSessionId when the session resolves nowhere, and carries it when the session resolves (status-backed OR legacy)', async () => {
  const nowhere = await fetch(`${bridgeUrl}/api/runs/${F6_RUN_NOWHERE}`);
  const nowhereText = await nowhere.text();
  assert.equal(nowhere.status, 200, nowhereText);
  const nowhereBody = JSON.parse(nowhereText) as { run: { architectSessionId?: string } };
  assert.equal(nowhereBody.run.architectSessionId, undefined, 'an unreadable architect_session_id must NOT be carried onto the wire');

  const statusBacked = await fetch(`${bridgeUrl}/api/runs/${F6_RUN_STATUS_BACKED}`);
  const statusBackedBody = (await statusBacked.json()) as { run: { architectSessionId?: string } };
  assert.equal(statusBacked.status, 200);
  assert.equal(statusBackedBody.run.architectSessionId, REAL_ARCHITECT_SESSION, 'a status-backed, resolvable session MUST carry architectSessionId');

  const legacy = await fetch(`${bridgeUrl}/api/runs/${F6_RUN_LEGACY}`);
  const legacyBody = (await legacy.json()) as { run: { architectSessionId?: string } };
  assert.equal(legacy.status, 200);
  assert.equal(legacyBody.run.architectSessionId, F6_SHAPE_A_SESSION, 'a LEGACY-resolvable session (Shape A) MUST also carry architectSessionId');
});
