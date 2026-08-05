/**
 * Tests for forge-ui/lib/session-client.ts (R2-10, PR2) — DOES NOT EXIST YET.
 * Vitest cannot even collect this file until it lands (module-not-found is
 * the expected red, mirroring hook-client.test.ts / community-client.test.ts's
 * own header note).
 *
 * session-client.ts is the typed client for the ONE session-shell read route
 * (cli/bridge-studio-sessions.ts: `GET /api/studio/sessions/:kind/:sessionId
 * ?project=<p>` → `{ok, kind, sessionId, project, phase, stages, defaultStage,
 * turns, artifact}`) — mirroring template-client.ts's / skill-client.ts's role.
 *
 * Tests ONLY the pure parse + dispatch functions — no fetch, no window, no
 * jsdom (this repo's forge-ui vitest config is `environment: 'node'`, a
 * standing decision — `resolveBridgeUrl()` requires `window`; the
 * over-the-wire behaviour is already pinned by cli/bridge-studio-sessions.
 * test.ts's AT-38..48/59..74, which this file's fixtures deliberately mirror
 * verbatim so the two layers cannot silently drift apart).
 *
 * DESIGN CHOICE (flagged for T2): session-client.ts splits the fetch/status-
 * code dispatch out of `fetchSessionShell` into a separate, exported PURE
 * function, `interpretSessionShellOutcome`, that takes a plain description of
 * what happened over the wire (`{kind:'network-error'|'non-json'|'json', ...}`)
 * and returns the typed `SessionShellFetchResult`. `fetchSessionShell` itself
 * is a thin, untested-here wrapper: it calls `resolveBridgeUrl()`/`fetch()`,
 * catches network/parse failures into that same outcome shape, and delegates.
 * This is what makes every dispatch rule below — 400/404/409/500/network-
 * error/non-JSON/200-but-malformed, each a DISTINCT typed result — testable
 * without touching `window` or mocking `fetch`, matching this repo's existing
 * convention (hook-client.test.ts / community-client.test.ts) rather than
 * introducing the first `vi.stubGlobal('fetch', ...)` anywhere in this file
 * set. T2: ratify this split, or fold it back into `fetchSessionShell` if a
 * fetch-mocking convention is preferred instead.
 *
 * The headline requirement (per the T3 task brief) is parse hardening: every
 * one of this campaign's repeat "fail-open" client-parse defects —
 * `template-client.ts`'s old `Array.isArray(x) ? x : []` on `templates`,
 * `skill-client.ts`'s still-live `usedBy: Array.isArray(x) ? x : []`, and
 * `parseSkillTrust`'s old silent promotion of an unrecognised token to the
 * most permissive `'ready'` — is refused here, explicitly, per field.
 *
 * AT numbers start fresh at AT-1 for PR2 (PR1's AT-1..74 sequence, spread
 * across session-kinds.test.ts / session-transcript.test.ts / bridge-studio-
 * sessions.test.ts, is closed).
 *
 * ---------------------------------------------------------------------------
 * AMENDMENT (T2 Correction 1, 2026-08-05): every artifact kind now carries a
 * required `label: string` field, sourced from the SESSION KIND descriptor's
 * `artifact.label` (studio/session-kinds.yaml) — never a client-side
 * hardcoded kind→label lookup (that was this file's original design; T2
 * overturned it as a second copy of declared data, exactly the drift this
 * campaign keeps finding). See AT-90 below for the new required-field pin.
 *
 * VERIFIED GAP, flagged for T2/whoever implements PR1's wire-contract change:
 * as of this amendment, `cli/bridge-studio-sessions.ts` (re-read verbatim;
 * `git diff --stat HEAD -- cli/bridge-studio-sessions.ts` is empty — nothing
 * has changed there since PR1 merged) does NOT put `label` on the `artifact`
 * it sends. Its 200 response is built from `deriveSessionArtifact(...)`
 * (orchestrator/studio/session-transcript.ts) alone — that function's three
 * return types (`RoadmapDraftArtifact`/`MarkdownDraftArtifact`/
 * `BrainStructureArtifact`) carry no `label` field, and `descriptor.artifact.
 * label` (which DOES exist, parsed by `orchestrator/studio/session-kinds.ts`
 * from the YAML) is never spread into the JSON `sendJson(...)` call — only
 * `descriptor.stages`/`descriptor.defaultStage` are threaded through today.
 * This test file pins the CORRECTED contract per T2's instruction (label
 * lives on the artifact, not in a client lookup); making it real requires a
 * small companion change to the route/deriveSessionArtifact to actually
 * start sending it — a production change outside this T3 test-writer's
 * remit (test files only). Until that lands, `session-client.ts`'s real
 * implementation and the real route will disagree on this one field.
 * ---------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------
 * AMENDMENT (T2 ruling, 2026-08-05): `title` (the session-kind descriptor's
 * declared heading, studio/session-kinds.yaml) is a REQUIRED, hard-parsed
 * field on `SessionShellPayload` — same treatment as `kind`/`sessionId`/
 * `project`/`phase` (AT-30's style: missing or non-string throws, naming the
 * field). The real route always sends it. A prior implementation pass made
 * `title` OPTIONAL with a silent `typeof === 'string' ? … : undefined` parse
 * specifically because these pinned fixtures had no `title` field — T2 ruled
 * that reasoning invalid: a wire-contract decision must never be driven by a
 * test fixture's gaps, and a caller falling back to the raw `kind` slug is a
 * fabricated heading, exactly the fail-open shape this file exists to
 * refuse. All payload fixtures below now carry a real `title` (the literal
 * value from `studio/session-kinds.yaml` wherever the fixture models a real
 * kind), and AT-95..97 pin the corrected required/hard-parsed contract,
 * including this file's explicit ruling on an EMPTY-STRING title: ALLOWED —
 * mirrors every other required string field in this payload (`kind`,
 * `sessionId`, `project`, `phase` — none of which reject `''` either, per
 * `requireString`'s existing, consistent behaviour across every client
 * parser in this codebase, e.g. template-client.ts / hook-client.ts).
 * Special-casing `title` alone to reject `''` would be an asymmetric rule
 * with no precedent anywhere in this file set — presence + type is what
 * every sibling field checks, nothing more.
 * ---------------------------------------------------------------------------
 */
import { test, expect } from 'vitest';
import {
  parseSessionTurn,
  parseSessionArtifact,
  parseSessionShellPayload,
  interpretSessionShellOutcome,
} from './session-client.ts';

// ---------------------------------------------------------------------------
// Fixtures — mirror the REAL on-disk-derived shapes verified in
// cli/bridge-studio-sessions.test.ts (AT-38/39/40) and orchestrator/studio/
// session-transcript.ts's exported types, not invented shapes.
// ---------------------------------------------------------------------------

const WELL_FORMED_TURN = {
  index: 0,
  role: 'agent',
  stage: 'roadmap',
  text: 'What should we build?',
  source: 'idea.md',
};

// `label` is the session kind's declared artifact label (studio/session-kinds
// .yaml's `artifact.label`) — a required field on every artifact kind as of
// T2 Correction 1 (see the header amendment). Literal values match the real
// shipped YAML: architect→roadmap-draft="Roadmap draft", instructions→
// markdown-draft="AGENTS.md draft", project-brain→brain-structure="Seeded
// structure".
const WELL_FORMED_ROADMAP_ARTIFACT = {
  kind: 'roadmap-draft',
  label: 'Roadmap draft',
  rows: [{ initiativeId: 'R9-01', project: 'gitpulse', phase: 'planned', origin: 'manifests/R9-01.md' }],
  sourcesScanned: ['manifests/*.md (1 file(s) found)'],
};

const WELL_FORMED_MARKDOWN_ARTIFACT = {
  kind: 'markdown-draft',
  label: 'AGENTS.md draft',
  body: '# AGENTS.md\n\nDraft body.\n',
  hasDraft: true,
};

const NO_DRAFT_MARKDOWN_ARTIFACT = { kind: 'markdown-draft', label: 'AGENTS.md draft', body: null, hasDraft: false };

const WELL_FORMED_BRAIN_ARTIFACT = {
  kind: 'brain-structure',
  label: 'Seeded structure',
  themeCount: 2,
  files: [
    { path: 'themes/alpha.md', body: '# Alpha' },
    { path: 'themes/beta.md', body: '# Beta' },
  ],
};

// `title` is the session kind's declared heading (studio/session-kinds.yaml's
// `title`) — required, hard-parsed as of the AT-95..99 amendment below. Real
// literal value from the shipped YAML: the 'architect' kind's title is
// "Planning session".
const WELL_FORMED_PAYLOAD = {
  ok: true,
  kind: 'architect',
  title: 'Planning session',
  sessionId: '2026-08-05T10-00-00',
  project: 'gitpulse',
  phase: 'awaiting-verdict',
  stages: ['roadmap'],
  defaultStage: 'roadmap',
  turns: [WELL_FORMED_TURN],
  artifact: WELL_FORMED_ROADMAP_ARTIFACT,
};

// ===========================================================================
// parseSessionTurn — AT-1..AT-7
// ===========================================================================

test('AT-1: parseSessionTurn: a well-formed turn round-trips every field verbatim', () => {
  expect(parseSessionTurn(WELL_FORMED_TURN)).toEqual(WELL_FORMED_TURN);
});

test('AT-2: parseSessionTurn: role "operator" also round-trips (both closed-set members accepted)', () => {
  const operatorTurn = { ...WELL_FORMED_TURN, role: 'operator' };
  expect(parseSessionTurn(operatorTurn).role).toBe('operator');
});

test('AT-3: parseSessionTurn: a role outside "agent"|"operator" THROWS naming the offending value and the allowed set — never coerced to the more permissive value', () => {
  expect(() => parseSessionTurn({ ...WELL_FORMED_TURN, role: 'system' })).toThrow(/system/);
  try {
    parseSessionTurn({ ...WELL_FORMED_TURN, role: 'system' });
    throw new Error('expected parseSessionTurn to throw');
  } catch (err) {
    const message = String(err);
    expect(message).toContain('system');
    expect(message).toContain('agent');
    expect(message).toContain('operator');
  }
});

test('AT-4: parseSessionTurn: a missing or non-string "text" THROWS — never a turn rendered with undefined', () => {
  const { text: _drop, ...missing } = WELL_FORMED_TURN;
  expect(() => parseSessionTurn(missing)).toThrow();
  expect(() => parseSessionTurn({ ...WELL_FORMED_TURN, text: 42 })).toThrow();
});

test('AT-5: parseSessionTurn: a missing or non-string "source" THROWS', () => {
  const { source: _drop, ...missing } = WELL_FORMED_TURN;
  expect(() => parseSessionTurn(missing)).toThrow();
  expect(() => parseSessionTurn({ ...WELL_FORMED_TURN, source: null })).toThrow();
});

test('AT-6: parseSessionTurn: a missing or non-string "stage" THROWS', () => {
  const { stage: _drop, ...missing } = WELL_FORMED_TURN;
  expect(() => parseSessionTurn(missing)).toThrow();
  expect(() => parseSessionTurn({ ...WELL_FORMED_TURN, stage: 7 })).toThrow();
});

test('AT-7: parseSessionTurn: a missing or non-number "index" THROWS; not a plain object THROWS', () => {
  const { index: _drop, ...missing } = WELL_FORMED_TURN;
  expect(() => parseSessionTurn(missing)).toThrow();
  expect(() => parseSessionTurn({ ...WELL_FORMED_TURN, index: '0' })).toThrow();
  expect(() => parseSessionTurn(null)).toThrow();
  expect(() => parseSessionTurn([])).toThrow();
  expect(() => parseSessionTurn('nope')).toThrow();
});

// ===========================================================================
// parseSessionArtifact — AT-8..AT-21
// ===========================================================================

test('AT-8: parseSessionArtifact: a well-formed roadmap-draft artifact round-trips exactly, rows in server order', () => {
  const twoRows = {
    kind: 'roadmap-draft',
    label: 'Roadmap draft',
    rows: [
      { initiativeId: 'R9-02', project: 'gitpulse', phase: 'planned', origin: 'manifests/R9-02.md' },
      { initiativeId: 'R9-01', project: 'gitpulse', phase: 'planned', origin: 'manifests/R9-01.md' },
    ],
    sourcesScanned: ['manifests/*.md (2 file(s) found)'],
  };
  const parsed = parseSessionArtifact(twoRows);
  expect(parsed).toEqual(twoRows);
  expect((parsed as typeof twoRows).rows.map((r) => r.initiativeId)).toEqual(['R9-02', 'R9-01']); // never re-sorted
});

test('AT-9: parseSessionArtifact: roadmap-draft "rows" missing or non-array THROWS — never coerced to []', () => {
  const { rows: _drop, ...missing } = WELL_FORMED_ROADMAP_ARTIFACT;
  expect(() => parseSessionArtifact(missing)).toThrow();
  expect(() => parseSessionArtifact({ ...WELL_FORMED_ROADMAP_ARTIFACT, rows: 'nope' })).toThrow();
});

test('AT-10: parseSessionArtifact: roadmap-draft "sourcesScanned" missing or non-array THROWS — an empty roadmap must never be indistinguishable from "unknown"', () => {
  const { sourcesScanned: _drop, ...missing } = WELL_FORMED_ROADMAP_ARTIFACT;
  expect(() => parseSessionArtifact(missing)).toThrow();
  expect(() => parseSessionArtifact({ ...WELL_FORMED_ROADMAP_ARTIFACT, sourcesScanned: 'nope' })).toThrow();
});

test('AT-11: parseSessionArtifact: a roadmap-draft row with a missing/non-string field THROWS', () => {
  const badRow = { ...WELL_FORMED_ROADMAP_ARTIFACT, rows: [{ initiativeId: 'R9-01', project: 'gitpulse', phase: 'planned' /* origin missing */ }] };
  expect(() => parseSessionArtifact(badRow)).toThrow();
  const wrongType = { ...WELL_FORMED_ROADMAP_ARTIFACT, rows: [{ ...WELL_FORMED_ROADMAP_ARTIFACT.rows[0], phase: 7 }] };
  expect(() => parseSessionArtifact(wrongType)).toThrow();
});

test('AT-12: parseSessionArtifact: a well-formed markdown-draft (hasDraft:true, real body) round-trips exactly', () => {
  expect(parseSessionArtifact(WELL_FORMED_MARKDOWN_ARTIFACT)).toEqual(WELL_FORMED_MARKDOWN_ARTIFACT);
});

test('AT-13: parseSessionArtifact: "no draft yet" (body:null, hasDraft:false) round-trips honestly — never coerced to an empty string', () => {
  const parsed = parseSessionArtifact(NO_DRAFT_MARKDOWN_ARTIFACT);
  expect(parsed).toEqual(NO_DRAFT_MARKDOWN_ARTIFACT);
  expect((parsed as { body: string | null }).body).toBeNull();
});

test('AT-14: parseSessionArtifact: "an empty draft" (body:"", hasDraft:true) round-trips distinctly from "no draft yet" — never collapsed to the same state', () => {
  const emptyDraft = { kind: 'markdown-draft', label: 'AGENTS.md draft', body: '', hasDraft: true };
  const parsed = parseSessionArtifact(emptyDraft);
  expect(parsed).toEqual(emptyDraft);
  expect((parsed as { body: string | null }).body).toBe('');
  expect(parsed).not.toEqual(NO_DRAFT_MARKDOWN_ARTIFACT);
});

test('AT-15: parseSessionArtifact: markdown-draft with hasDraft inconsistent with body\'s nullness THROWS — defense-in-depth against a malformed transport', () => {
  // label present + well-formed on both, so the ONLY thing under test is the
  // hasDraft/body inconsistency — never incidentally also failing on a
  // missing label (that is AT-90's job).
  expect(() => parseSessionArtifact({ kind: 'markdown-draft', label: 'AGENTS.md draft', body: null, hasDraft: true })).toThrow();
  expect(() => parseSessionArtifact({ kind: 'markdown-draft', label: 'AGENTS.md draft', body: 'content', hasDraft: false })).toThrow();
});

test('AT-16: parseSessionArtifact: markdown-draft "hasDraft" missing or non-boolean THROWS', () => {
  const { hasDraft: _drop, ...missing } = WELL_FORMED_MARKDOWN_ARTIFACT;
  expect(() => parseSessionArtifact(missing)).toThrow();
  expect(() => parseSessionArtifact({ ...WELL_FORMED_MARKDOWN_ARTIFACT, hasDraft: 'true' })).toThrow();
});

test('AT-17: parseSessionArtifact: a well-formed brain-structure artifact round-trips exactly', () => {
  expect(parseSessionArtifact(WELL_FORMED_BRAIN_ARTIFACT)).toEqual(WELL_FORMED_BRAIN_ARTIFACT);
});

test('AT-18: parseSessionArtifact: brain-structure "files" missing or non-array THROWS — never coerced to []', () => {
  const { files: _drop, ...missing } = WELL_FORMED_BRAIN_ARTIFACT;
  expect(() => parseSessionArtifact(missing)).toThrow();
  expect(() => parseSessionArtifact({ ...WELL_FORMED_BRAIN_ARTIFACT, files: 'nope' })).toThrow();
});

test('AT-19: parseSessionArtifact: a brain-structure file with a missing/non-string path or body THROWS', () => {
  expect(() => parseSessionArtifact({ ...WELL_FORMED_BRAIN_ARTIFACT, files: [{ path: 'themes/alpha.md' }] })).toThrow();
  expect(() => parseSessionArtifact({ ...WELL_FORMED_BRAIN_ARTIFACT, files: [{ path: 7, body: 'x' }] })).toThrow();
});

test('AT-20: parseSessionArtifact: brain-structure "themeCount" missing or non-number THROWS, and is NEVER re-derived from files.length by this parser', () => {
  const { themeCount: _drop, ...missing } = WELL_FORMED_BRAIN_ARTIFACT;
  expect(() => parseSessionArtifact(missing)).toThrow();
  expect(() => parseSessionArtifact({ ...WELL_FORMED_BRAIN_ARTIFACT, themeCount: '2' })).toThrow();
  // A themeCount that legitimately diverges from files.length (some theme files
  // failed to parse server-side) must round-trip verbatim, not be silently
  // "corrected" to files.length.
  const divergent = { ...WELL_FORMED_BRAIN_ARTIFACT, themeCount: 5 };
  expect((parseSessionArtifact(divergent) as { themeCount: number }).themeCount).toBe(5);
});

test('AT-21: parseSessionArtifact: an unrecognised OR reserved artifact kind THROWS naming it; not a plain object THROWS', () => {
  expect(() => parseSessionArtifact({ kind: 'totally-bogus' })).toThrow(/totally-bogus/);
  expect(() => parseSessionArtifact({ kind: 'file-package' })).toThrow(/file-package/);
  expect(() => parseSessionArtifact({ kind: 'contract-buildout' })).toThrow(/contract-buildout/);
  expect(() => parseSessionArtifact({ kind: 'generation-gallery' })).toThrow(/generation-gallery/);
  expect(() => parseSessionArtifact(null)).toThrow();
  expect(() => parseSessionArtifact([])).toThrow();
});

// ===========================================================================
// parseSessionShellPayload — AT-22..AT-32
// ===========================================================================

test('AT-22: parseSessionShellPayload: a well-formed payload round-trips exactly', () => {
  expect(parseSessionShellPayload(WELL_FORMED_PAYLOAD)).toEqual(WELL_FORMED_PAYLOAD);
});

test('AT-23: parseSessionShellPayload: "turns" present but NOT an array THROWS — never {ok:true, turns:[]} (the headline fail-open defect this module exists to refuse)', () => {
  expect(() => parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, turns: 'not-an-array' })).toThrow();
  expect(() => parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, turns: null })).toThrow();
  const { turns: _drop, ...missingTurns } = WELL_FORMED_PAYLOAD;
  expect(() => parseSessionShellPayload(missingTurns)).toThrow();
});

test('AT-24: parseSessionShellPayload: a GENUINELY empty "turns": [] is legitimately ok:true — distinct from AT-23\'s malformed-turns rejection', () => {
  const emptyTurns = { ...WELL_FORMED_PAYLOAD, turns: [] };
  const parsed = parseSessionShellPayload(emptyTurns);
  expect(parsed.turns).toEqual([]);
});

test('AT-25: parseSessionShellPayload: a missing "artifact" THROWS — never a fabricated empty artifact', () => {
  const { artifact: _drop, ...missing } = WELL_FORMED_PAYLOAD;
  expect(() => parseSessionShellPayload(missing)).toThrow();
});

test('AT-26: parseSessionShellPayload: "defaultStage" not a member of "stages" THROWS naming the offending value and the allowed set', () => {
  const bad = { ...WELL_FORMED_PAYLOAD, defaultStage: 'brain' };
  try {
    parseSessionShellPayload(bad);
    throw new Error('expected parseSessionShellPayload to throw');
  } catch (err) {
    const message = String(err);
    expect(message).toContain('brain');
    expect(message).toContain('roadmap');
  }
});

test('AT-27: parseSessionShellPayload: a turn whose "stage" is outside THIS payload\'s own "stages" THROWS naming the offending value and the allowed set — even when that stage is a real, globally-known token', () => {
  // 'instructions' is a real member of the global SESSION_STAGES vocabulary,
  // but this payload only declares stages:['roadmap'] — membership must be
  // checked against the PAYLOAD's own stages, never the wider global set.
  const badTurnStage = {
    ...WELL_FORMED_PAYLOAD,
    turns: [{ ...WELL_FORMED_TURN, stage: 'instructions' }],
  };
  try {
    parseSessionShellPayload(badTurnStage);
    throw new Error('expected parseSessionShellPayload to throw');
  } catch (err) {
    const message = String(err);
    expect(message).toContain('instructions');
    expect(message).toContain('roadmap');
  }
});

test('AT-28: parseSessionShellPayload: "stages" missing or non-array THROWS', () => {
  const { stages: _drop, ...missing } = WELL_FORMED_PAYLOAD;
  expect(() => parseSessionShellPayload(missing)).toThrow();
  expect(() => parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, stages: 'roadmap' })).toThrow();
});

test('AT-29: parseSessionShellPayload: a missing or non-true "ok" THROWS — the discriminator is not optional', () => {
  const { ok: _drop, ...missing } = WELL_FORMED_PAYLOAD;
  expect(() => parseSessionShellPayload(missing)).toThrow();
  expect(() => parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, ok: false })).toThrow();
});

test('AT-30: parseSessionShellPayload: "kind"/"sessionId"/"project"/"phase" each missing or non-string THROWS', () => {
  for (const field of ['kind', 'sessionId', 'project', 'phase'] as const) {
    const { [field]: _drop, ...missing } = WELL_FORMED_PAYLOAD;
    expect(() => parseSessionShellPayload(missing), `missing "${field}" must throw`).toThrow();
    expect(() => parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, [field]: 7 }), `non-string "${field}" must throw`).toThrow();
  }
});

test('AT-31: parseSessionShellPayload: not a plain object (array, null, string, number) THROWS', () => {
  expect(() => parseSessionShellPayload(null)).toThrow();
  expect(() => parseSessionShellPayload([])).toThrow();
  expect(() => parseSessionShellPayload('nope')).toThrow();
  expect(() => parseSessionShellPayload(42)).toThrow();
});

test('AT-32: parseSessionShellPayload: the instructions (markdown-draft) and project-brain (brain-structure) fixtures from the real route contract also round-trip', () => {
  const instructionsPayload = {
    ok: true,
    kind: 'instructions',
    title: 'Instructions session', // real literal, studio/session-kinds.yaml
    sessionId: '2026-08-05T11-00-00',
    project: 'gitpulse',
    phase: 'drafting',
    stages: ['instructions'],
    defaultStage: 'instructions',
    turns: [{ index: 0, role: 'operator', stage: 'instructions', text: 'Write AGENTS.md', source: 'prompt.md' }],
    artifact: WELL_FORMED_MARKDOWN_ARTIFACT,
  };
  expect(parseSessionShellPayload(instructionsPayload)).toEqual(instructionsPayload);

  const brainPayload = {
    ok: true,
    kind: 'project-brain',
    title: 'Brain creation session', // real literal, studio/session-kinds.yaml
    sessionId: '2026-08-05T12-00-00',
    project: 'gitpulse',
    phase: 'analyzing',
    stages: ['brain'],
    defaultStage: 'brain',
    turns: [{ index: 0, role: 'operator', stage: 'brain', text: 'Seed the brain', source: 'prompt.md' }],
    artifact: WELL_FORMED_BRAIN_ARTIFACT,
  };
  expect(parseSessionShellPayload(brainPayload)).toEqual(brainPayload);
});

// ===========================================================================
// interpretSessionShellOutcome — AT-33..AT-42
//
// Body shapes below mirror cli/bridge-studio-sessions.ts's REAL sendJson(...)
// calls verbatim (see that module's lines ~197-309 and bridge-studio-sessions.
// test.ts AT-42/43/44/48) — never invented shapes.
// ===========================================================================

test('AT-33: interpretSessionShellOutcome: a well-formed 200 JSON body yields {ok:true, payload:...} matching parseSessionShellPayload', () => {
  const result = interpretSessionShellOutcome({ kind: 'json', status: 200, body: WELL_FORMED_PAYLOAD });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.payload).toEqual(parseSessionShellPayload(WELL_FORMED_PAYLOAD));
  }
});

test('AT-34: interpretSessionShellOutcome: a 200 status with a MALFORMED body (fails parseSessionShellPayload) yields a typed ok:false result — never throws out of the interpreter itself', () => {
  const { artifact: _drop, ...malformed } = WELL_FORMED_PAYLOAD;
  let result;
  expect(() => {
    result = interpretSessionShellOutcome({ kind: 'json', status: 200, body: malformed });
  }).not.toThrow();
  expect(result!.ok).toBe(false);
  if (!result!.ok) {
    expect(result!.errorKind).toBe('malformed-response');
  }
});

test('AT-35: interpretSessionShellOutcome: a 400 body ({error}) yields {ok:false, errorKind:"bad-request"}, preserving the server\'s message VERBATIM', () => {
  const body = { error: 'invalid sessionId "../../etc" — must match /^[A-Za-z0-9_-]+$/ (alphanumeric, "_", "-"; no "/", ".", "..", whitespace, or null bytes)' };
  const result = interpretSessionShellOutcome({ kind: 'json', status: 400, body });
  expect(result).toEqual({ ok: false, errorKind: 'bad-request', error: body.error });
});

test('AT-36: interpretSessionShellOutcome: a 404 body ({error}) yields {ok:false, errorKind:"not-found"}, preserving the server\'s message VERBATIM — two distinct real message shapes both round-trip', () => {
  const unknownKindBody = { error: 'unknown session kind "bogus" — must be one of: architect, instructions, project-brain' };
  const r1 = interpretSessionShellOutcome({ kind: 'json', status: 404, body: unknownKindBody });
  expect(r1).toEqual({ ok: false, errorKind: 'not-found', error: unknownKindBody.error });

  const sessionNotFoundBody = { error: 'session not found', kind: 'architect', sessionId: 'nope', project: 'demoproj' };
  const r2 = interpretSessionShellOutcome({ kind: 'json', status: 404, body: sessionNotFoundBody });
  expect(r2).toEqual({ ok: false, errorKind: 'not-found', error: sessionNotFoundBody.error });
});

test('AT-37: interpretSessionShellOutcome: a 409 body ({ok:false, error}) yields {ok:false, errorKind:"stage-conflict"}, preserving the offending-value-and-allowed-set message VERBATIM — this must reach the operator, never be replaced by a generic "failed to load"', () => {
  const body = {
    ok: false,
    error: 'stage "brain" is not a member of this session kind\'s declared stages [roadmap]',
  };
  const result = interpretSessionShellOutcome({ kind: 'json', status: 409, body });
  expect(result).toEqual({ ok: false, errorKind: 'stage-conflict', error: body.error });
  if (!result.ok) {
    expect(result.error).toContain('brain');
    expect(result.error).toContain('roadmap');
  }
});

test('AT-38: interpretSessionShellOutcome: a 500 body ({error}) yields {ok:false, errorKind:"server-error"}, preserving the message VERBATIM', () => {
  const body = { error: 'internal error' };
  const result = interpretSessionShellOutcome({ kind: 'json', status: 500, body });
  expect(result).toEqual({ ok: false, errorKind: 'server-error', error: body.error });
});

test('AT-39: interpretSessionShellOutcome: a non-200 body with NO "error" string field falls back to a generic HTTP-status message, never throws', () => {
  expect(() => interpretSessionShellOutcome({ kind: 'json', status: 404, body: {} })).not.toThrow();
  const result = interpretSessionShellOutcome({ kind: 'json', status: 404, body: {} });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.length).toBeGreaterThan(0);
    expect(result.error).toContain('404');
  }
});

test('AT-40: interpretSessionShellOutcome: a network-error outcome yields {ok:false, errorKind:"network-error"} — distinct from a non-JSON body', () => {
  const result = interpretSessionShellOutcome({ kind: 'network-error', message: 'fetch failed: ECONNREFUSED' });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errorKind).toBe('network-error');
    expect(result.error).toContain('ECONNREFUSED');
  }
});

test('AT-41: interpretSessionShellOutcome: a non-JSON-body outcome yields {ok:false, errorKind:"non-json-response"} — distinct from network-error and from a 200-but-malformed body', () => {
  const result = interpretSessionShellOutcome({ kind: 'non-json', status: 200, message: 'Unexpected token < in JSON at position 0' });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errorKind).toBe('non-json-response');
    expect(result.error).toContain('Unexpected token');
  }
});

test('AT-42: interpretSessionShellOutcome: every distinct failure mode maps to a DISTINCT errorKind token — no two real outcomes silently collapse onto the same typed result', () => {
  const outcomes: Array<Parameters<typeof interpretSessionShellOutcome>[0]> = [
    { kind: 'network-error', message: 'x' },
    { kind: 'non-json', status: 200, message: 'x' },
    { kind: 'json', status: 200, body: { ...WELL_FORMED_PAYLOAD, artifact: undefined } }, // malformed-response
    { kind: 'json', status: 400, body: { error: 'x' } },
    { kind: 'json', status: 404, body: { error: 'x' } },
    { kind: 'json', status: 409, body: { ok: false, error: 'x' } },
    { kind: 'json', status: 500, body: { error: 'x' } },
  ];
  const errorKinds = outcomes.map((o) => {
    const r = interpretSessionShellOutcome(o);
    expect(r.ok, `outcome ${JSON.stringify(o)} must not be ok:true`).toBe(false);
    return !r.ok ? r.errorKind : null;
  });
  expect(new Set(errorKinds).size).toBe(errorKinds.length);
});

// ===========================================================================
// AT-amendment (T2 Correction 1, 2026-08-05) — artifact.label is a required
// wire field, sourced from the session-kind descriptor, never a client-side
// closed lookup. — AT-90
// ===========================================================================

test('AT-90: parseSessionArtifact: "label" missing or non-string THROWS on every one of the 3 live kinds — never coerced to the artifact kind string, never silently omitted', () => {
  const { label: _drop1, ...roadmapMissing } = WELL_FORMED_ROADMAP_ARTIFACT;
  expect(() => parseSessionArtifact(roadmapMissing)).toThrow();
  expect(() => parseSessionArtifact({ ...WELL_FORMED_ROADMAP_ARTIFACT, label: 7 })).toThrow();

  const { label: _drop2, ...markdownMissing } = WELL_FORMED_MARKDOWN_ARTIFACT;
  expect(() => parseSessionArtifact(markdownMissing)).toThrow();
  expect(() => parseSessionArtifact({ ...WELL_FORMED_MARKDOWN_ARTIFACT, label: null })).toThrow();

  const { label: _drop3, ...brainMissing } = WELL_FORMED_BRAIN_ARTIFACT;
  expect(() => parseSessionArtifact(brainMissing)).toThrow();
  expect(() => parseSessionArtifact({ ...WELL_FORMED_BRAIN_ARTIFACT, label: [] })).toThrow();

  // A well-formed label round-trips verbatim (not just "any truthy string" —
  // the ACTUAL declared value, never re-derived from `kind`).
  expect(parseSessionArtifact(WELL_FORMED_ROADMAP_ARTIFACT).label).toBe('Roadmap draft');
});

// ===========================================================================
// AT-amendment (T2 ruling, 2026-08-05) — "title" is REQUIRED and hard-parsed,
// exactly like kind/sessionId/project/phase — never optional-with-a-fallback.
// — AT-95..AT-97
// ===========================================================================

test('AT-95: parseSessionShellPayload: a missing "title" THROWS, naming the field — never silently optional, never a caller-side fallback to the raw kind slug', () => {
  const { title: _drop, ...missing } = WELL_FORMED_PAYLOAD;
  try {
    parseSessionShellPayload(missing);
    throw new Error('expected parseSessionShellPayload to throw');
  } catch (err) {
    expect(String(err)).toContain('title');
  }
});

test('AT-96: parseSessionShellPayload: a non-string "title" (number, null, array, object) THROWS — same treatment as every sibling required string field, never coerced', () => {
  for (const badTitle of [7, null, ['Planning session'], { text: 'Planning session' }]) {
    expect(
      () => parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, title: badTitle }),
      `title=${JSON.stringify(badTitle)} must throw`,
    ).toThrow();
  }
});

test('AT-97: parseSessionShellPayload: an EMPTY-STRING "title" is legitimately ACCEPTED — the explicit ruling (T2, 2026-08-05): title gets the SAME treatment as every other required string field in this payload (kind/sessionId/project/phase), none of which reject "" either; special-casing title alone would be an asymmetric rule with no precedent in this file', () => {
  const emptyTitle = { ...WELL_FORMED_PAYLOAD, title: '' };
  expect(() => parseSessionShellPayload(emptyTitle)).not.toThrow();
  const parsed = parseSessionShellPayload(emptyTitle);
  expect(parsed.title).toBe('');
  // Distinct from AT-95's missing-title rejection: an explicit "" is a
  // different, legitimate case from an absent key.
  expect(() => parseSessionShellPayload(WELL_FORMED_PAYLOAD)).not.toThrow();
});
