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
 *
 * ---------------------------------------------------------------------------
 * R4-15 (2026-08-06): roadmap-draft rows gain a fifth field, `dependsOn:
 * string[]` — cross-initiative dependency edges threaded from the manifest's
 * `depends_on_initiatives` (orchestrator side: session-transcript.test.ts's
 * AT-75/76; wire side: bridge-studio-sessions.test.ts's AT-77). AT-98..101
 * pin this file's own sink: `parseRoadmapDraftRow` currently whitelists only
 * 4 fields and silently drops a 5th one the server sends.
 * ---------------------------------------------------------------------------
 */
import { test, expect } from 'vitest';
import {
  parseSessionTurn,
  parseSessionArtifact,
  parseSessionShellPayload,
  interpretSessionShellOutcome,
} from './session-client.ts';
// R4-19-F2 AT-116..124 (below): `sessionArtifactView` is imported ONLY for
// the AT-124 end-to-end seam test — this is the ONE test in this file that
// deliberately crosses into session-artifact-view.ts, to prove the two
// modules compose (parseSessionArtifact's wire output is exactly what
// sessionArtifactView accepts) for the REAL captured kb-cleanup fixture.
// Every other test in this file stays scoped to session-client.ts alone,
// per this file's own header convention.
import { sessionArtifactView, type CleanupPlanView } from './session-artifact-view.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
// R4-15 mechanical fixture plumbing: `dependsOn` is a REQUIRED field on the
// parsed row as of this round (see AT-98..101 below) — every row literal
// used in a round-trip `toEqual` must carry it, or the parser's own
// tolerant default (`[]` for a missing wire value) would make the parsed
// result diverge from the literal fixture. No existing assertion's
// behaviour changes: `[]` is exactly what an absent wire value already
// parses to (AT-99).
const WELL_FORMED_ROADMAP_ARTIFACT = {
  kind: 'roadmap-draft',
  label: 'Roadmap draft',
  rows: [{ initiativeId: 'R9-01', project: 'gitpulse', phase: 'planned', origin: 'manifests/R9-01.md', dependsOn: [] }],
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
  // W6-B6 — REQUIRED on every wire payload (never omitted): architect
  // carries neither turnSpec nor panel, so its honest affordances value is
  // a genuine [], and this fixture's session predates the kickoff
  // model-tier seam, so modelTier is honestly null.
  affordances: [] as { id: string; kind: string; phase: string }[],
  modelTier: null as string | null,
  // W6-B8 — REQUIRED on every wire payload (never omitted): architect's
  // fixture session sits at 'awaiting-verdict', a non-terminal phase.
  terminal: false,
  // W7-FIX-A2 (W7A2-04) — REQUIRED on every wire payload: architect is a
  // legacy-runner (transcript-bearing) kind.
  transcriptSources: ['idea.md'],
  // W7-A2 — REQUIRED on every wire payload (never omitted): the bridge's
  // derived lifecycle; awaiting-verdict is an operator gate.
  lifecycle: { state: 'awaiting-operator', needsYou: true, error: null, idleMs: null, cancellable: true },
  // W7-C2 (sessions-kinds-36) — REQUIRED on every wire payload: the
  // persisted {kind, id} pointer at whatever object a committed session
  // produced; null IS the honest value for a session that produced nothing.
  finalized: null as { kind: string; id: string; exists: boolean } | null,
  // W7-C2 T1 review (P0-3) — REQUIRED, like `finalized`: null is the honest
  // "the transcript derived cleanly" value.
  transcriptError: null as string | null,
  // F6 (wave-8) — REQUIRED like "terminal": whether this session's ONLY
  // surviving record is the central log dir (no project-side session dir /
  // status.json). This fixture's session has a real project-side status,
  // so its honest value is false.
  legacy: false,
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
      // R4-15 mechanical fixture plumbing: dependsOn is now a required
      // parsed-row field (see WELL_FORMED_ROADMAP_ARTIFACT's header note).
      { initiativeId: 'R9-02', project: 'gitpulse', phase: 'planned', origin: 'manifests/R9-02.md', dependsOn: [] },
      { initiativeId: 'R9-01', project: 'gitpulse', phase: 'planned', origin: 'manifests/R9-01.md', dependsOn: [] },
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

test('AT-21: parseSessionArtifact: an unrecognised OR (still-)reserved artifact kind THROWS naming it; not a plain object THROWS', () => {
  expect(() => parseSessionArtifact({ kind: 'totally-bogus' })).toThrow(/totally-bogus/);
  expect(() => parseSessionArtifact({ kind: 'file-package' })).toThrow(/file-package/);
  expect(() => parseSessionArtifact({ kind: 'contract-buildout' })).toThrow(/contract-buildout/);
  // R4-16: "generation-gallery" is NO LONGER in this bucket — it is a real,
  // live kind now (see AT-102..109 below for its own full parse contract).
  // The bare `{kind:'generation-gallery'}` shape used to hit the generic
  // "unrecognised/reserved" branch (whose message always echoes the kind);
  // once it has a REAL per-field parser, the same bare object still throws
  // (missing "label"/"generations"/"sourcesScanned"), but for a DIFFERENT
  // reason whose message does not necessarily contain the kind string
  // anymore — asserting /generation-gallery/ here would be pinning the OLD,
  // now-incorrect contract. Removed rather than left to silently rot.
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
    affordances: [{ id: 'drafting-staged-review', kind: 'staged-review', phase: 'drafting', meta: { writes: ['draft'] } }],
    modelTier: 'sonnet',
    terminal: false,
    transcriptSources: ['idea.md'],
    lifecycle: { state: 'working', needsYou: false, error: null, idleMs: 1200, cancellable: true },
    finalized: null,
    transcriptError: null,
    legacy: false,
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
    affordances: [],
    modelTier: null,
    terminal: false,
    transcriptSources: ['idea.md'],
    lifecycle: { state: 'working', needsYou: false, error: null, idleMs: null, cancellable: true },
    finalized: null,
    transcriptError: null,
    legacy: false,
  };
  expect(parseSessionShellPayload(brainPayload)).toEqual(brainPayload);
});

// ===========================================================================
// W6-B8 — parseSessionShellPayload gains "terminal" (boolean, REQUIRED, never
// omitted or defaulted) — mirrors "affordances"' own hard-required treatment
// immediately above (AT-95..97's own precedent for a field added after the
// original AT-1..32 sequence): a non-array/missing wire field throws by name.
// ===========================================================================

test('AT-127: parseSessionShellPayload: "terminal" round-trips true/false verbatim', () => {
  expect(parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, terminal: true }).terminal).toBe(true);
  expect(parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, terminal: false }).terminal).toBe(false);
});

test('AT-128: parseSessionShellPayload: "terminal" missing or non-boolean THROWS — never defaulted to false', () => {
  const { terminal: _drop, ...missing } = WELL_FORMED_PAYLOAD;
  expect(() => parseSessionShellPayload(missing)).toThrow(/terminal/);
  expect(() => parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, terminal: 'true' })).toThrow(/terminal/);
  expect(() => parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, terminal: null })).toThrow(/terminal/);
});

// ===========================================================================
// F6 (wave-8, "a linked session must be readable") — parseSessionShellPayload
// gains "legacy" (boolean, REQUIRED, never omitted or defaulted): true iff
// this session's ONLY surviving record is the central log dir
// (_logs/_<kind>-<sessionId>/), with no project-side status.json to read.
// Same hard-required treatment as "terminal" immediately above — a missing
// or non-boolean wire field throws by name, never silently defaulted to
// false. See docs F6 spec section 4 (forge-ui) and cli/session-readability.ts
// section 2 (the route side that sets this field).
// ===========================================================================

test('F6: parseSessionShellPayload: "legacy" missing THROWS naming the field — mirrors "terminal"\'s own hard-required treatment (AT-128)', () => {
  const { legacy: _drop, ...missing } = WELL_FORMED_PAYLOAD;
  expect(() => parseSessionShellPayload(missing)).toThrow(/legacy/);
});

test('F6: parseSessionShellPayload: "legacy" non-boolean THROWS — never coerced to a permissive default', () => {
  expect(() => parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, legacy: 'true' })).toThrow(/legacy/);
  expect(() => parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, legacy: 1 })).toThrow(/legacy/);
  expect(() => parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, legacy: null })).toThrow(/legacy/);
});

test('F6: parseSessionShellPayload: "legacy" round-trips true/false verbatim', () => {
  expect(parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, legacy: true }).legacy).toBe(true);
  expect(parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, legacy: false }).legacy).toBe(false);
});

// ===========================================================================
// W8-B3 (ON-5) — parseSessionShellPayload carries "transcriptSources" (string
// array, REQUIRED, never omitted or defaulted), REPLACING W7-FIX-A2's
// `transcript` boolean. That boolean was a per-kind STORED PROXY and was
// factually wrong for `authoring` (declares a turnSpec, yet its start route
// writes prompt.md before the spine runs). Same hard-required treatment as
// "terminal"/"affordances": an empty array is the honest "nothing written
// yet" and must stay distinguishable from a bridge that omitted the field.
// ===========================================================================

test('W8-B3: parseSessionShellPayload: "transcriptSources" round-trips verbatim, empty array included', () => {
  expect(parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, transcriptSources: ['idea.md', 'verdicts.json'] }).transcriptSources)
    .toEqual(['idea.md', 'verdicts.json']);
  expect(parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, transcriptSources: [] }).transcriptSources).toEqual([]);
});

test('W8-B3: parseSessionShellPayload: "transcriptSources" missing, non-array, or holding a non-string THROWS naming the field — never defaulted', () => {
  const { transcriptSources: _drop, ...missing } = WELL_FORMED_PAYLOAD;
  expect(() => parseSessionShellPayload(missing)).toThrow(/transcriptSources/);
  expect(() => parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, transcriptSources: 'idea.md' })).toThrow(/transcriptSources/);
  expect(() => parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, transcriptSources: null })).toThrow(/transcriptSources/);
  expect(() => parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, transcriptSources: ['idea.md', 7] })).toThrow(/transcriptSources/);
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

// ===========================================================================
// R4-15 — roadmap-draft row "dependsOn" (AT-98..AT-101). `parseRoadmapDraftRow`
// (session-client.ts:177..187) is the SECOND sink for this field: the server
// (cli/bridge-studio-sessions.test.ts's AT-77) now sends it, but this
// client-side whitelist of 4 fields still drops it silently on arrival —
// that fail-open loss is exactly what AT-98 exists to refuse. Missing is
// TOLERATED (parses to []), matching the server's own default (session-
// transcript.test.ts AT-75) — but a malformed shape (non-array, or an array
// containing a non-string) is REJECTED, naming the field, matching this
// file's `requireStringArray` fail-closed convention exactly (the same
// helper `sourcesScanned` already uses).
// ===========================================================================

test('AT-98: parseSessionArtifact: roadmap-draft row "dependsOn" round-trips verbatim — present, non-empty, declared order preserved (a whitelist that still drops the field would leave this undefined)', () => {
  const withDeps = {
    ...WELL_FORMED_ROADMAP_ARTIFACT,
    rows: [{ initiativeId: 'R9-02', project: 'gitpulse', phase: 'planned', origin: 'manifests/R9-02.md', dependsOn: ['R9-01', 'R8-03'] }],
  };
  const parsed = parseSessionArtifact(withDeps) as { rows: Array<{ dependsOn: string[] }> };
  expect(parsed.rows[0].dependsOn).toEqual(['R9-01', 'R8-03']);
});

test('AT-99: parseSessionArtifact: roadmap-draft row with a MISSING "dependsOn" on the wire is TOLERATED — parses to [], never thrown (mirrors the server\'s own absent-key default; the client stays defensive rather than assuming the server always sends it)', () => {
  const { dependsOn: _drop, ...rowWithoutDeps } = WELL_FORMED_ROADMAP_ARTIFACT.rows[0];
  const missingDeps = { ...WELL_FORMED_ROADMAP_ARTIFACT, rows: [rowWithoutDeps] };
  expect(() => parseSessionArtifact(missingDeps)).not.toThrow();
  const parsed = parseSessionArtifact(missingDeps) as { rows: Array<{ dependsOn: string[] }> };
  expect(parsed.rows[0].dependsOn).toEqual([]);
});

test('AT-100: parseSessionArtifact: roadmap-draft row "dependsOn" that is a non-array (a string) THROWS naming the field — matches requireStringArray\'s fail-closed style, never silently coerced to []', () => {
  const badRow = { ...WELL_FORMED_ROADMAP_ARTIFACT, rows: [{ ...WELL_FORMED_ROADMAP_ARTIFACT.rows[0], dependsOn: 'INIT-2026-01-01-fixture-a' }] };
  expect(() => parseSessionArtifact(badRow)).toThrow(/dependsOn/);
});

test('AT-101: parseSessionArtifact: roadmap-draft row "dependsOn" containing a non-string element THROWS naming the field — matches requireStringArray\'s per-element check, never silently dropped/stringified', () => {
  const badRow = { ...WELL_FORMED_ROADMAP_ARTIFACT, rows: [{ ...WELL_FORMED_ROADMAP_ARTIFACT.rows[0], dependsOn: ['INIT-2026-01-01-fixture-a', 42] }] };
  expect(() => parseSessionArtifact(badRow)).toThrow(/dependsOn/);
});

// ===========================================================================
// R4-16 (2026-08-06) — a NEW live artifact kind, "generation-gallery"
// (orchestrator/studio/session-transcript.ts's `deriveGenerationGallery`).
// TEST-FIRST PIN: `parseSessionArtifact` does not have a case for this kind
// yet — every well-formed fixture below currently falls into the generic
// "unrecognised/reserved" default branch, which is the correct RED (this is
// exactly the same shape of pin AT-21 above used to encode before this
// round). Field-hardening ATs follow this file's established convention
// (requireString/requireNumber/requireStringArray, never a silent default).
// — AT-102..AT-109
// ===========================================================================

const WELL_FORMED_GENERATION_GALLERY_ARTIFACT = {
  kind: 'generation-gallery',
  label: 'Demo generations', // studio/session-kinds.yaml's real declared label for the "demo" kind
  generations: [
    {
      number: 1,
      createdAt: '2026-08-06T10:00:00.000Z',
      feedback: null,
      targetElement: null,
      items: [
        { path: 'DEMO.html', kind: 'html', bytes: 512 },
        { path: 'SKILL.md', kind: 'markdown', bytes: 128 },
      ],
    },
    {
      number: 2,
      createdAt: '2026-08-06T11:00:00.000Z',
      feedback: 'Make it punchier.',
      targetElement: 'cli-capture',
      items: [{ path: 'SKILL.md', kind: 'markdown', bytes: 96 }],
    },
  ],
  sourcesScanned: ['generations/* (2 generation(s) found)'],
};

test('AT-102: parseSessionArtifact: a well-formed generation-gallery artifact round-trips exactly, generations + items in server order', () => {
  const parsed = parseSessionArtifact(WELL_FORMED_GENERATION_GALLERY_ARTIFACT);
  expect(parsed).toEqual(WELL_FORMED_GENERATION_GALLERY_ARTIFACT);
});

test('AT-103: parseSessionArtifact: generation-gallery "generations" missing or non-array THROWS — never coerced to []', () => {
  // Sanity: a WELL-FORMED generation-gallery must parse cleanly — proves this
  // test is genuinely red today (the whole kind is unimplemented, so it
  // throws regardless of field validity) rather than accidentally green
  // because every generation-gallery input currently throws no matter what.
  expect(() => parseSessionArtifact(WELL_FORMED_GENERATION_GALLERY_ARTIFACT)).not.toThrow();
  const { generations: _drop, ...missing } = WELL_FORMED_GENERATION_GALLERY_ARTIFACT;
  expect(() => parseSessionArtifact(missing)).toThrow();
  expect(() => parseSessionArtifact({ ...WELL_FORMED_GENERATION_GALLERY_ARTIFACT, generations: 'nope' })).toThrow();
});

test('AT-104: parseSessionArtifact: a generation entry with a missing/non-integer "number" THROWS', () => {
  // Sanity: see AT-103's comment — proves this test is genuinely red today.
  expect(() => parseSessionArtifact(WELL_FORMED_GENERATION_GALLERY_ARTIFACT)).not.toThrow();
  const badNumber = {
    ...WELL_FORMED_GENERATION_GALLERY_ARTIFACT,
    generations: [{ ...WELL_FORMED_GENERATION_GALLERY_ARTIFACT.generations[0], number: '1' }],
  };
  expect(() => parseSessionArtifact(badNumber)).toThrow();
  const floatNumber = {
    ...WELL_FORMED_GENERATION_GALLERY_ARTIFACT,
    generations: [{ ...WELL_FORMED_GENERATION_GALLERY_ARTIFACT.generations[0], number: 1.5 }],
  };
  expect(() => parseSessionArtifact(floatNumber)).toThrow();
  const { number: _drop, ...rowWithoutNumber } = WELL_FORMED_GENERATION_GALLERY_ARTIFACT.generations[0];
  const missingNumber = { ...WELL_FORMED_GENERATION_GALLERY_ARTIFACT, generations: [rowWithoutNumber] };
  expect(() => parseSessionArtifact(missingNumber)).toThrow();
});

test('AT-105: parseSessionArtifact: a generation entry with a missing/non-array "items" THROWS — never coerced to []', () => {
  // Sanity: see AT-103's comment — proves this test is genuinely red today.
  expect(() => parseSessionArtifact(WELL_FORMED_GENERATION_GALLERY_ARTIFACT)).not.toThrow();
  const { items: _drop, ...rowWithoutItems } = WELL_FORMED_GENERATION_GALLERY_ARTIFACT.generations[0];
  const missing = { ...WELL_FORMED_GENERATION_GALLERY_ARTIFACT, generations: [rowWithoutItems] };
  expect(() => parseSessionArtifact(missing)).toThrow();
  const wrongType = { ...WELL_FORMED_GENERATION_GALLERY_ARTIFACT, generations: [{ ...WELL_FORMED_GENERATION_GALLERY_ARTIFACT.generations[0], items: 'nope' }] };
  expect(() => parseSessionArtifact(wrongType)).toThrow();
});

test('AT-106: parseSessionArtifact: an item with a missing/non-string "path", an unrecognised "kind", or a missing/non-number "bytes" THROWS', () => {
  const badPath = { ...WELL_FORMED_GENERATION_GALLERY_ARTIFACT, generations: [{ ...WELL_FORMED_GENERATION_GALLERY_ARTIFACT.generations[0], items: [{ kind: 'html', bytes: 1 }] }] };
  expect(() => parseSessionArtifact(badPath)).toThrow();
  const badKind = { ...WELL_FORMED_GENERATION_GALLERY_ARTIFACT, generations: [{ ...WELL_FORMED_GENERATION_GALLERY_ARTIFACT.generations[0], items: [{ path: 'x.html', kind: 'video', bytes: 1 }] }] };
  expect(() => parseSessionArtifact(badKind)).toThrow(/video/);
  const badBytes = { ...WELL_FORMED_GENERATION_GALLERY_ARTIFACT, generations: [{ ...WELL_FORMED_GENERATION_GALLERY_ARTIFACT.generations[0], items: [{ path: 'x.html', kind: 'html', bytes: '1' }] }] };
  expect(() => parseSessionArtifact(badBytes)).toThrow();
});

test('AT-107: parseSessionArtifact: a generation\'s "feedback"/"targetElement" accept null OR a string, but THROW on any other type — never silently coerced', () => {
  const nullBoth = { ...WELL_FORMED_GENERATION_GALLERY_ARTIFACT.generations[0], feedback: null, targetElement: null };
  expect(() => parseSessionArtifact({ ...WELL_FORMED_GENERATION_GALLERY_ARTIFACT, generations: [nullBoth] })).not.toThrow();
  const stringBoth = { ...WELL_FORMED_GENERATION_GALLERY_ARTIFACT.generations[0], feedback: 'fb', targetElement: 'el' };
  expect(() => parseSessionArtifact({ ...WELL_FORMED_GENERATION_GALLERY_ARTIFACT, generations: [stringBoth] })).not.toThrow();
  const badFeedback = { ...WELL_FORMED_GENERATION_GALLERY_ARTIFACT.generations[0], feedback: 7 };
  expect(() => parseSessionArtifact({ ...WELL_FORMED_GENERATION_GALLERY_ARTIFACT, generations: [badFeedback] })).toThrow();
  const badTargetElement = { ...WELL_FORMED_GENERATION_GALLERY_ARTIFACT.generations[0], targetElement: [] };
  expect(() => parseSessionArtifact({ ...WELL_FORMED_GENERATION_GALLERY_ARTIFACT, generations: [badTargetElement] })).toThrow();
});

test('AT-108: parseSessionArtifact: generation-gallery "sourcesScanned" or "label" missing or non-well-typed THROWS — same treatment as every other live kind (AT-90\'s label contract, AT-10\'s sourcesScanned contract)', () => {
  // Sanity: see AT-103's comment — proves this test is genuinely red today.
  expect(() => parseSessionArtifact(WELL_FORMED_GENERATION_GALLERY_ARTIFACT)).not.toThrow();
  const { sourcesScanned: _drop1, ...missingSources } = WELL_FORMED_GENERATION_GALLERY_ARTIFACT;
  expect(() => parseSessionArtifact(missingSources)).toThrow();
  expect(() => parseSessionArtifact({ ...WELL_FORMED_GENERATION_GALLERY_ARTIFACT, sourcesScanned: 'nope' })).toThrow();

  const { label: _drop2, ...missingLabel } = WELL_FORMED_GENERATION_GALLERY_ARTIFACT;
  expect(() => parseSessionArtifact(missingLabel)).toThrow();
  expect(() => parseSessionArtifact({ ...WELL_FORMED_GENERATION_GALLERY_ARTIFACT, label: 7 })).toThrow();
});

test('AT-109: parseSessionArtifact: an EMPTY generation-gallery ("generations": []) is legitimately ok — distinct from a malformed/missing "generations"', () => {
  const empty = { kind: 'generation-gallery', label: 'Demo generations', generations: [], sourcesScanned: ['generations/* (0 generation(s) found)'] };
  const parsed = parseSessionArtifact(empty) as { generations: unknown[] };
  expect(parsed.generations).toEqual([]);
});

// ===========================================================================
// R4-17 — contract-buildout artifact parsing. TEST-FIRST PIN: `kind:
// 'contract-buildout'` is not yet a recognised case in the real, unmodified
// `parseSessionArtifact` — every test below currently throws
// "unrecognised session artifact kind" (the `default` branch), mirroring the
// generation-gallery block's own AT-103-style sanity comment pattern at ITS
// branch base. Mirrors `cli/contract-stages.ts`'s server-side
// `ContractStageRow` shape exactly (structurally identical, per the R4-17
// contract) — never a client-side re-derivation of status/detail/bytes.
// ===========================================================================

const WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT = {
  kind: 'contract-buildout',
  label: 'Contract build-out',
  stages: [
    { stage: 'contract', status: 'present', source: '.forge/project.json', detail: ['npm test'], bytes: null },
    { stage: 'instructions', status: 'present', source: 'AGENTS.md', detail: [], bytes: 512 },
    { stage: 'secrets', status: 'absent', source: '.forge/project.json', detail: [], bytes: null },
    { stage: 'demo', status: 'absent', source: '.forge/project.json + .forge/demo/demo.lock.json', detail: [], bytes: null },
    { stage: 'roadmap', status: 'present', source: 'roadmap.md', detail: [], bytes: 2046 },
  ],
  sourcesScanned: ['.forge/project.json', 'AGENTS.md', 'roadmap.md'],
};

test('R4-17 AT-110: parseSessionArtifact: a well-formed contract-buildout artifact round-trips exactly, five stage rows in server order', () => {
  const parsed = parseSessionArtifact(WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT);
  expect(parsed).toEqual(WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT);
});

test('R4-17 AT-111: parseSessionArtifact: contract-buildout "stages" missing or non-array THROWS — never coerced to []', () => {
  // Sanity: a WELL-FORMED payload must parse cleanly — proves this test is
  // genuinely red today for the right reason (the whole kind is
  // unrecognised, so every input throws regardless of field validity),
  // mirroring AT-103's own sanity-check pattern.
  expect(() => parseSessionArtifact(WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT)).not.toThrow();
  const { stages: _drop, ...missing } = WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT;
  expect(() => parseSessionArtifact(missing)).toThrow();
  expect(() => parseSessionArtifact({ ...WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT, stages: 'nope' })).toThrow();
});

test('R4-17 AT-112: parseSessionArtifact: a stage row with an unrecognised "status" (not "present"/"absent") THROWS naming it — never silently coerced to the most permissive reading', () => {
  const badStatus = {
    ...WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT,
    stages: [{ ...WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT.stages[0], status: 'unknown-status-value' }],
  };
  expect(() => parseSessionArtifact(badStatus)).toThrow(/unknown-status-value/);
});

test('R4-17 AT-113: parseSessionArtifact: a stage row with a missing/non-string "stage" or "source", or a non-array "detail", THROWS', () => {
  const badStage = { ...WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT, stages: [{ ...WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT.stages[0], stage: 7 }] };
  expect(() => parseSessionArtifact(badStage)).toThrow();
  const badSource = { ...WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT, stages: [{ ...WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT.stages[0], source: null }] };
  expect(() => parseSessionArtifact(badSource)).toThrow();
  const badDetail = { ...WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT, stages: [{ ...WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT.stages[0], detail: 'not-an-array' }] };
  expect(() => parseSessionArtifact(badDetail)).toThrow();
});

test('R4-17 AT-114: parseSessionArtifact: a stage row\'s "bytes" accepts a number OR literal null, but THROWS on any other type (e.g. a string, or omitted entirely) — never silently coerced', () => {
  const nullBytes = { ...WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT, stages: [{ ...WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT.stages[0], bytes: null }] };
  expect(() => parseSessionArtifact(nullBytes)).not.toThrow();
  const numberBytes = { ...WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT, stages: [{ ...WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT.stages[0], bytes: 128 }] };
  expect(() => parseSessionArtifact(numberBytes)).not.toThrow();
  const stringBytes = { ...WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT, stages: [{ ...WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT.stages[0], bytes: '128' }] };
  expect(() => parseSessionArtifact(stringBytes)).toThrow();
  const { bytes: _drop, ...rowWithoutBytes } = WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT.stages[0];
  const missingBytes = { ...WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT, stages: [rowWithoutBytes] };
  expect(() => parseSessionArtifact(missingBytes)).toThrow();
});

test('R4-17 AT-115: parseSessionArtifact: contract-buildout "sourcesScanned" or "label" missing or non-well-typed THROWS — same treatment as every other live kind', () => {
  const { sourcesScanned: _drop1, ...missingSources } = WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT;
  expect(() => parseSessionArtifact(missingSources)).toThrow();
  const { label: _drop2, ...missingLabel } = WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT;
  expect(() => parseSessionArtifact(missingLabel)).toThrow();
  expect(() => parseSessionArtifact({ ...WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT, label: 7 })).toThrow();
});

// ===========================================================================
// R4-19-F2 — "cleanup-plan" (the kb-cleanup session's brain-maintenance
// artifact, orchestrator/studio/session-transcript.ts's CleanupPlanArtifact/
// CleanupPlanAction) — AT-116..124.
//
// THE DEFECT this block exists to kill: `parseSessionArtifact`'s switch has
// NO `case 'cleanup-plan':` today — every payload of this kind falls through
// to the `default` branch and throws `unrecognised session artifact kind:
// "cleanup-plan"`, even though the session-kind descriptor declares it
// `status: 'live'` (studio/session-kinds.yaml) and the VIEW layer
// (session-artifact-view.ts's cleanupPlanView, fully covered by session-
// artifact-view.test.ts's AT-123..133) is already built and green. The whole
// kind is backend-complete and view-complete yet unreachable in the product
// — exactly the shape brain/cycles/themes/new-session-kind-needs-ui-wiring.md
// documents (R4-21's prior instance) — because this ONE parse case was never
// added. AT-116 is the direct kill of that failure.
//
// DEFENSIVENESS CONTRACT (AT-117..122): mirrors 'contract-buildout' (AT-110.
// .115) for the array-of-per-row-objects-with-an-enum-field shape — the
// closest structural analog to `actions: CleanupPlanAction[]` (each row
// carrying its own closed-set `state`, exactly like ContractStageRow's
// `status`). `openFindingCount` mirrors 'brain-structure''s `themeCount`
// (AT-20) — a server-reported count threaded through VERBATIM, never
// re-derived client-side from the array it accompanies. `plan` mirrors
// 'markdown-draft''s `body` (AT-13/AT-16) — a nullable string field, `null`
// being a LEGITIMATE "no draft/plan yet" value, not an error.
//
// This block deliberately does NOT require the file-package/contract-
// buildout "wrap so a bare {kind:'cleanup-plan'} names the kind in its error
// message" behaviour AT-21 pins for those two kinds — 'generation-gallery'
// (AT-102..109) is live proof that behaviour is NOT a universal contract
// (AT-21's own comment explains it was REMOVED from that test, not added to,
// when generation-gallery flipped live): requiring it here would invent a
// stricter contract than the majority of this file's own live kinds already
// have. See the T3 report for this explicit ruling.
// ===========================================================================

const WELL_FORMED_CLEANUP_PLAN_ARTIFACT = {
  kind: 'cleanup-plan',
  label: 'Cleanup plan', // studio/session-kinds.yaml's kb-cleanup artifact.label, verbatim
  plan: '# Cleanup Plan\n\nOne finding.\n',
  actions: [
    { kind: 'length.soft-cap', target: 'brain/forge-dev/themes/alpha.md', proposal: 'Condense the theme toward the soft cap.', state: 'open' },
  ],
  openFindingCount: 1,
};

test('R4-19-F2 AT-116: parseSessionArtifact: a well-formed cleanup-plan artifact round-trips exactly, actions in server order — kills the current "unrecognised session artifact kind: cleanup-plan" failure that makes the whole kb-cleanup feature unreachable client-side, no matter how correct the server + view layers are', () => {
  expect(() => parseSessionArtifact(WELL_FORMED_CLEANUP_PLAN_ARTIFACT)).not.toThrow();
  expect(parseSessionArtifact(WELL_FORMED_CLEANUP_PLAN_ARTIFACT)).toEqual(WELL_FORMED_CLEANUP_PLAN_ARTIFACT);
});

test('R4-19-F2 AT-117: parseSessionArtifact: cleanup-plan "actions" missing or non-array THROWS — never coerced to [] — mirrors AT-111\'s contract-buildout "stages" contract, the closest structural analog', () => {
  // Sanity (mirrors AT-111's own precedent): a WELL-FORMED payload must
  // parse cleanly — proves this test is genuinely red today for the right
  // reason. Without this, the malformed-input assertions below would pass
  // VACUOUSLY: today EVERY cleanup-plan input throws "unrecognised session
  // artifact kind" regardless of "actions"' shape, since the case doesn't
  // exist yet — that is not proof this parser validates "actions" at all.
  expect(() => parseSessionArtifact(WELL_FORMED_CLEANUP_PLAN_ARTIFACT)).not.toThrow();
  const { actions: _drop, ...missing } = WELL_FORMED_CLEANUP_PLAN_ARTIFACT;
  expect(() => parseSessionArtifact(missing)).toThrow();
  expect(() => parseSessionArtifact({ ...WELL_FORMED_CLEANUP_PLAN_ARTIFACT, actions: 'nope' })).toThrow();
});

test('R4-19-F2 AT-118: parseSessionArtifact: a cleanup-plan action with an unrecognised "state" (not "open"|"cleared"|"unknown") THROWS naming it — mirrors AT-112\'s contract-buildout "status" enum contract exactly, never silently coerced to the most permissive reading', () => {
  const badState = {
    ...WELL_FORMED_CLEANUP_PLAN_ARTIFACT,
    actions: [{ ...WELL_FORMED_CLEANUP_PLAN_ARTIFACT.actions[0], state: 'resolved' }],
  };
  expect(() => parseSessionArtifact(badState)).toThrow(/resolved/);
});

test('R4-19-F2 AT-119: parseSessionArtifact: a cleanup-plan action with a missing/non-string "kind", "target", or "proposal" THROWS — mirrors AT-113\'s contract-buildout per-field row contract', () => {
  // Sanity (mirrors AT-111/AT-117's own precedent): proves this test is
  // genuinely red today for the right reason, not vacuously passing because
  // EVERY cleanup-plan input already throws for the unrelated "unrecognised
  // kind" reason.
  expect(() => parseSessionArtifact(WELL_FORMED_CLEANUP_PLAN_ARTIFACT)).not.toThrow();
  const badKind = { ...WELL_FORMED_CLEANUP_PLAN_ARTIFACT, actions: [{ ...WELL_FORMED_CLEANUP_PLAN_ARTIFACT.actions[0], kind: 7 }] };
  expect(() => parseSessionArtifact(badKind)).toThrow();
  const badTarget = { ...WELL_FORMED_CLEANUP_PLAN_ARTIFACT, actions: [{ ...WELL_FORMED_CLEANUP_PLAN_ARTIFACT.actions[0], target: null }] };
  expect(() => parseSessionArtifact(badTarget)).toThrow();
  const badProposal = { ...WELL_FORMED_CLEANUP_PLAN_ARTIFACT, actions: [{ ...WELL_FORMED_CLEANUP_PLAN_ARTIFACT.actions[0], proposal: undefined }] };
  expect(() => parseSessionArtifact(badProposal)).toThrow();
});

test('R4-19-F2 AT-120: parseSessionArtifact: cleanup-plan "openFindingCount" missing or non-number THROWS, and is NEVER re-derived from the actions\' own "open" states by this parser — mirrors AT-20\'s brain-structure themeCount precedent exactly', () => {
  const { openFindingCount: _drop, ...missing } = WELL_FORMED_CLEANUP_PLAN_ARTIFACT;
  expect(() => parseSessionArtifact(missing)).toThrow();
  expect(() => parseSessionArtifact({ ...WELL_FORMED_CLEANUP_PLAN_ARTIFACT, openFindingCount: '1' })).toThrow();
  // A count that legitimately diverges from actions.filter(a => a.state ===
  // 'open').length (zero actual open rows here) must round-trip verbatim,
  // never be silently "corrected" to the client-recomputed number.
  const divergent = {
    ...WELL_FORMED_CLEANUP_PLAN_ARTIFACT,
    actions: [{ ...WELL_FORMED_CLEANUP_PLAN_ARTIFACT.actions[0], state: 'cleared' }],
    openFindingCount: 9,
  };
  expect((parseSessionArtifact(divergent) as { openFindingCount: number }).openFindingCount).toBe(9);
});

test('R4-19-F2 AT-121: parseSessionArtifact: cleanup-plan "plan" accepts a string OR literal null (no drafted plan yet) but THROWS on any other type — mirrors markdown-draft\'s "body" contract (AT-13/AT-16) applied to this kind\'s own nullable plan field', () => {
  const noPlanYet = { kind: 'cleanup-plan', label: 'Cleanup plan', plan: null, actions: [], openFindingCount: 0 };
  expect(() => parseSessionArtifact(noPlanYet)).not.toThrow();
  expect((parseSessionArtifact(noPlanYet) as { plan: string | null }).plan).toBeNull();
  expect(() => parseSessionArtifact({ ...WELL_FORMED_CLEANUP_PLAN_ARTIFACT, plan: 7 })).toThrow();
  expect(() => parseSessionArtifact({ ...WELL_FORMED_CLEANUP_PLAN_ARTIFACT, plan: [] })).toThrow();
});

test('R4-19-F2 AT-122: parseSessionArtifact: cleanup-plan "label" missing or non-string THROWS — same treatment pinned for every other live kind (AT-90\'s contract)', () => {
  const { label: _drop, ...missing } = WELL_FORMED_CLEANUP_PLAN_ARTIFACT;
  expect(() => parseSessionArtifact(missing)).toThrow();
  expect(() => parseSessionArtifact({ ...WELL_FORMED_CLEANUP_PLAN_ARTIFACT, label: 7 })).toThrow();
  expect(parseSessionArtifact(WELL_FORMED_CLEANUP_PLAN_ARTIFACT).label).toBe('Cleanup plan');
});

// ---------------------------------------------------------------------------
// AT-123/124 — round-trip against the REAL captured fixture
// (scripts/journeys/fixtures/r4-19-f2-live-capture/), read from disk, never
// inlined. `plan` is the raw markdown, byte-for-byte, read via readFileSync.
// The two actions' kind/target/proposal are hand-copied from that same
// file's two `- [<kind>] <target> — <proposal>` lines — mirrors session-
// artifact-view.test.ts's own REAL_CLEANUP_PLAN_ARTIFACT precedent exactly
// (this test file has no business importing session-transcript.ts's
// server-side action-line parser; see that file's header note for the full
// rationale). AT-123 is a drift guard: if status.json's findings ever stop
// matching what AT-124 hand-copies below, AT-123 fails first, with a message
// naming the fixture mismatch — instead of AT-124 failing confusingly on a
// state:'open' assertion for the wrong reason.
// ---------------------------------------------------------------------------

const REAL_CAPTURE_DIR = resolve(__dirname, '../../scripts/journeys/fixtures/r4-19-f2-live-capture');
const REAL_CLEANUP_PLAN_MD = readFileSync(resolve(REAL_CAPTURE_DIR, 'cleanup-plan.md'), 'utf8');
const REAL_STATUS_JSON = JSON.parse(readFileSync(resolve(REAL_CAPTURE_DIR, 'status.json'), 'utf8')) as {
  findings: Array<{ kind: string; file: string }>;
};

const REAL_CLEANUP_PLAN_WIRE_PAYLOAD = {
  kind: 'cleanup-plan',
  label: 'Cleanup plan',
  plan: REAL_CLEANUP_PLAN_MD,
  actions: [
    {
      kind: 'length.soft-cap',
      target: 'brain/forge-dev/themes/brain-read-policy.md',
      proposal:
        'Condense the theme from 65 to ≤60 body lines by merging the two near-duplicate source bullets and folding the R1-01 / R1-06 blockquote callouts into a compact inline history note.',
      state: 'open',
    },
    {
      kind: 'edge.dangling',
      target: 'brain/forge-dev/themes/exploration-vs-implementation-initiatives.md',
      proposal:
        'Drop the `related_themes` entry `forge-current-architecture-as-built` because no matching theme file exists anywhere under `brain/**/themes/` and no plausible surviving slug was found.',
      state: 'open',
    },
  ],
  openFindingCount: 2,
};

test('R4-19-F2 AT-123: sanity/drift guard — the real status.json fixture still carries both findings AT-124\'s wire payload assumes (not itself the seam proof)', () => {
  expect(REAL_STATUS_JSON.findings).toHaveLength(2);
  expect(REAL_STATUS_JSON.findings[0].kind).toBe('length.soft-cap');
  expect(REAL_STATUS_JSON.findings[0].file.endsWith('brain/forge-dev/themes/brain-read-policy.md')).toBe(true);
  expect(REAL_STATUS_JSON.findings[1].kind).toBe('edge.dangling');
  expect(REAL_STATUS_JSON.findings[1].file.endsWith('brain/forge-dev/themes/exploration-vs-implementation-initiatives.md')).toBe(true);
});

test('R4-19-F2 AT-124 (real-capture END-TO-END seam — the ONE test proving server -> parser -> view composition): the REAL r4-19-f2-live-capture fixture, wire-shaped exactly as the bridge sends it, survives parseSessionArtifact then renders through sessionArtifactView with both real actions. session-artifact-view.test.ts\'s own AT-133 calls cleanupPlanView directly on an already-typed, HAND-BUILT CleanupPlanArtifact — it never goes through parseSessionArtifact, so it stays green even while this parser still throws "unrecognised session artifact kind: cleanup-plan" for the exact same real data. This test is the missing link; a fix on only one side of the break would leave this one red.', () => {
  const parsed = parseSessionArtifact(REAL_CLEANUP_PLAN_WIRE_PAYLOAD);
  expect(parsed).toEqual(REAL_CLEANUP_PLAN_WIRE_PAYLOAD);

  const view = sessionArtifactView(parsed) as CleanupPlanView;
  expect(view.kind).toBe('cleanup-plan');
  expect(view.state).toBe('has-actions');
  expect(view.actions).toHaveLength(2);
  expect(view.actions.map((a) => a.kind)).toEqual(['length.soft-cap', 'edge.dangling']);
  expect(view.actions.every((a) => a.state === 'open')).toBe(true);
  expect(view.openFindingCount).toBe(2);
  expect(view.settled).toBe(false); // both actions still open, nothing cleared yet
  expect(view.plan).toBe(REAL_CLEANUP_PLAN_MD);
});

// W6-B9 (reviewer finding on W6-B8): `kbId` (R4-19-F2 WI-4c) is REMOVED from
// `SessionShellPayload` entirely — its one reader, SessionCleanupPanel.tsx,
// is deleted (W6-B8 migrated kb-cleanup onto the generic session shell; the
// generic write route reads `status.kb_id` server-side, never off this wire
// field). AT-125/AT-126, which used to pin its present/absent round-trip,
// are deleted with it.

// ===========================================================================
// W7-C2 — `finalized` (sessions-kinds-36) + affordance meta.questions
// (sessions-kinds-17/19, bead forge-lzv)
// ===========================================================================

test('C2-CL-1: parseSessionShellPayload — a MISSING "finalized" key throws (required; null is the honest empty value, absence is not)', () => {
  const { finalized: _drop, ...missing } = WELL_FORMED_PAYLOAD;
  expect(() => parseSessionShellPayload(missing)).toThrow(/finalized/);
});

test('C2-CL-2: parseSessionShellPayload — finalized {kind, id, exists} round-trips verbatim; a wrong-shaped value throws', () => {
  // W7-C2 T1 review (P0-4) — `exists` (the server-derived liveness of the
  // pointed-at object) is REQUIRED on the same terms as kind/id: a payload
  // without it throws rather than letting the panel emit a link it has no
  // evidence for.
  const payload = parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, finalized: { kind: 'skill', id: 'pr-diff-summary', exists: true } });
  expect(payload.finalized).toEqual({ kind: 'skill', id: 'pr-diff-summary', exists: true });
  expect(parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, finalized: { kind: 'skill', id: 'gone', exists: false } }).finalized)
    .toEqual({ kind: 'skill', id: 'gone', exists: false });
  expect(parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, finalized: null }).finalized).toBeNull();
  expect(() => parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, finalized: 'pr-diff-summary' })).toThrow(/finalized/);
  expect(() => parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, finalized: { kind: 'skill' } })).toThrow(/finalized/);
  expect(() => parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, finalized: { kind: 'skill', id: 'pr-diff-summary' } })).toThrow(/finalized/);
});

test('C2-CL-3: parseSessionAffordance — meta.questions rides through when well-formed (question text + options), and a malformed questions shape degrades that ONE sub-field to absent (meta is advisory display data)', () => {
  const raw = {
    id: 'awaiting-answers-question-form',
    kind: 'question-form',
    phase: 'awaiting-answers',
    meta: {
      questions: [
        { id: 'q1', question: 'Which toolchain?', header: 'Toolchain', options: [{ label: 'Node + npm', description: 'package.json driven' }] },
        { id: 'q2', question: 'Quality gate command?', options: [] },
      ],
    },
  };
  const parsed = parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, affordances: [raw] });
  const meta = parsed.affordances[0].meta;
  expect(meta?.questions).toHaveLength(2);
  expect(meta?.questions?.[0].id).toBe('q1');
  expect(meta?.questions?.[0].question).toBe('Which toolchain?');
  expect(meta?.questions?.[0].options).toEqual([{ label: 'Node + npm', description: 'package.json driven' }]);
  expect(meta?.questions?.[1].options).toEqual([]);

  const malformed = { ...raw, meta: { questions: [{ notAQuestion: true }] } };
  const parsedMalformed = parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, affordances: [malformed] });
  expect(parsedMalformed.affordances[0].meta?.questions).toBeUndefined();
});

// W7-C2 T1 review (A3, finding sessions-kinds-19) — the correlation id is
// REQUIRED on every pending question. Without it the panel could only post
// the question TEXT back, which mis-binds the moment a round repeats or
// rewords a question; an entry missing it degrades the whole field (the
// panel then falls back to the free-text box) rather than silently posting
// answers that bind by text.
test('C2-FIX-A3-2: parseSessionAffordance — a pending question with NO id degrades the whole questions field to absent', () => {
  const raw = {
    id: 'awaiting-answers-question-form',
    kind: 'question-form',
    phase: 'awaiting-answers',
    meta: { questions: [{ id: 'q1', question: 'Has an id', options: [] }, { question: 'Has none', options: [] }] },
  };
  const parsed = parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, affordances: [raw] });
  expect(parsed.affordances[0].meta?.questions).toBeUndefined();
});

// W7-C2 T1 review (P0-3) — the scoped transcript error.
test('C2-FIX-P03-2: parseSessionShellPayload — "transcriptError" is REQUIRED (string or null); a missing key throws, a string rides through verbatim', () => {
  const { transcriptError: _drop, ...missing } = WELL_FORMED_PAYLOAD;
  expect(() => parseSessionShellPayload(missing)).toThrow(/transcriptError/);
  expect(parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, transcriptError: null }).transcriptError).toBeNull();
  expect(parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, turns: [], transcriptError: 'verdicts.json is not valid JSON — x' }).transcriptError)
    .toBe('verdicts.json is not valid JSON — x');
  expect(() => parseSessionShellPayload({ ...WELL_FORMED_PAYLOAD, transcriptError: 42 })).toThrow(/transcriptError/);
});
