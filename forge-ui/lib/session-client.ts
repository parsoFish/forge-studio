/**
 * Client-side typed parser + fetch helper for the Studio session-shell read
 * route (R2-10, PR2): `GET /api/studio/sessions/:kind/:sessionId?project=<p>`
 * (cli/bridge-studio-sessions.ts) → `{ok, kind, sessionId, project, phase,
 * stages, defaultStage, turns, artifact}`. Mirrors template-client.ts's /
 * skill-client.ts's role and idiom exactly: local structural parsers, no
 * cross-boundary import of orchestrator types (the shapes here are a
 * hand-mirrored copy of orchestrator/studio/session-kinds.ts +
 * session-transcript.ts, never an import from them).
 *
 * HEADLINE RULE (per the T3 task brief — this campaign's repeat "fail-open
 * parse" defect, refused here explicitly per field): every malformed shape
 * throws naming what was wrong. A non-array `turns` is malformed and throws;
 * a genuinely empty `turns: []` is legitimately `ok: true`. Nothing is ever
 * coerced to the most permissive reading (template-client.ts's old
 * `Array.isArray(x) ? x : []`, skill-client.ts's still-live `usedBy` default,
 * `parseSkillTrust`'s old silent promotion to `'ready'`) — every one of those
 * shapes throws here instead.
 *
 * AMENDMENT (T2 Correction 1, 2026-08-05): every artifact kind carries a
 * required `label: string` field, sourced from the session-kind descriptor's
 * `artifact.label` (studio/session-kinds.yaml) — never a client-side
 * hardcoded kind→label lookup (a second copy of declared data that could
 * never represent a future kind reusing an existing artifact kind with a
 * different label). See `parseSessionArtifact`'s per-kind parsers below.
 * The route side landed with it: `deriveSessionArtifact`
 * (orchestrator/studio/session-transcript.ts) threads
 * `descriptor.artifact.label` onto all three artifact shapes, and
 * `cli/bridge-studio-sessions.ts` forwards the artifact verbatim. The
 * envelope's `title` is threaded the same way, for the same reason.
 *
 * DESIGN CHOICE (flagged for T2, mirrors the note in this module's own test
 * file): the fetch/status-code dispatch is split out of `fetchSessionShell`
 * into a separate, exported PURE function, `interpretSessionShellOutcome`,
 * that takes a plain description of what happened over the wire
 * (`{kind:'network-error'|'non-json'|'json', ...}`) and returns the typed
 * `SessionShellFetchResult`. `fetchSessionShell` is a thin, untested-here
 * wrapper — it resolves the bridge URL, calls `fetch()`, catches network/
 * parse failures into that same outcome shape, and delegates. This is what
 * makes every dispatch rule (400/404/409/500/network-error/non-JSON/
 * 200-but-malformed) testable without `vi.stubGlobal('fetch', ...)`, matching
 * this repo's existing convention (hook-client.test.ts / community-client.
 * test.ts) rather than introducing the first fetch-mocking convention in this
 * file set.
 */

import { resolveBridgeUrl } from './bridge-client';

// ---------------------------------------------------------------------------
// Generic structural-parse helpers (re-declared locally per this file set's
// convention — no shared parse-helper import across client modules; see
// skill-client.ts's header on why each client owns its own small helpers).
// ---------------------------------------------------------------------------

function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function requireString(r: Record<string, unknown>, field: string): string {
  const v = r[field];
  if (typeof v !== 'string') {
    throw new Error(`missing or invalid "${field}": expected a string, got ${JSON.stringify(v)}`);
  }
  return v;
}

function requireNumber(r: Record<string, unknown>, field: string): number {
  const v = r[field];
  if (typeof v !== 'number') {
    throw new Error(`missing or invalid "${field}": expected a number, got ${JSON.stringify(v)}`);
  }
  return v;
}

/** A required integer (e.g. a generation number) — rejects a non-number AND
 *  a non-integer number (1.5) alike, naming the field. */
function requireInteger(r: Record<string, unknown>, field: string): number {
  const v = requireNumber(r, field);
  if (!Number.isInteger(v)) {
    throw new Error(`missing or invalid "${field}": expected an integer, got ${JSON.stringify(v)}`);
  }
  return v;
}

/** A field that must be a string OR literal null — never any other type,
 *  and never omitted (an absent key is `undefined`, which fails the same
 *  check as any other wrong type). Used for generation-gallery's
 *  `feedback`/`targetElement`, which are legitimately null (no feedback yet
 *  drove generation 1) but never silently coerced from a missing key. */
function requireNullableString(r: Record<string, unknown>, field: string): string | null {
  const v = r[field];
  if (v === null) return null;
  if (typeof v !== 'string') {
    throw new Error(`missing or invalid "${field}": expected a string or null, got ${JSON.stringify(v)}`);
  }
  return v;
}

/** A required array of strings — never coerced from a non-array (the same
 *  refusal template-client.ts's `parseUsedBy` applies to `usedBy`). */
function requireStringArray(raw: unknown, field: string): string[] {
  if (!Array.isArray(raw)) {
    throw new Error(`missing or invalid "${field}": expected an array, got ${JSON.stringify(raw)}`);
  }
  return raw.map((v, i) => {
    if (typeof v !== 'string') {
      throw new Error(`malformed "${field}"[${i}]: expected a string, got ${JSON.stringify(v)}`);
    }
    return v;
  });
}

// ---------------------------------------------------------------------------
// SessionTurn — mirrors orchestrator/studio/session-transcript.ts's SessionTurn
// ---------------------------------------------------------------------------

const SESSION_TURN_ROLES = ['agent', 'operator'] as const;
export type SessionTurnRole = (typeof SESSION_TURN_ROLES)[number];

export type SessionTurn = {
  index: number;
  role: SessionTurnRole;
  /** Not enum-checked here — a turn's stage is validated against the
   *  PAYLOAD's own declared `stages` in `parseSessionShellPayload`, never a
   *  wider global vocabulary (AT-27). */
  stage: string;
  text: string;
  source: string;
};

function parseSessionTurnRole(raw: unknown): SessionTurnRole {
  if (raw === 'agent' || raw === 'operator') return raw;
  throw new Error(`unrecognised turn role ${JSON.stringify(raw)} — must be one of: ${SESSION_TURN_ROLES.join(', ')}`);
}

/** A malformed turn (wrong-typed/missing field, an unrecognised role, or not
 *  a plain object) throws — never a turn rendered with an invented/undefined
 *  field. */
export function parseSessionTurn(raw: unknown): SessionTurn {
  if (!isPlainObject(raw)) {
    throw new Error(`malformed session turn: expected an object, got ${JSON.stringify(raw)}`);
  }
  return {
    index: requireNumber(raw, 'index'),
    role: parseSessionTurnRole(raw['role']),
    stage: requireString(raw, 'stage'),
    text: requireString(raw, 'text'),
    source: requireString(raw, 'source'),
  };
}

// ---------------------------------------------------------------------------
// SessionArtifactPayload — mirrors session-transcript.ts's four LIVE
// artifact shapes (RoadmapDraftArtifact / MarkdownDraftArtifact /
// BrainStructureArtifact / GenerationGalleryArtifact — R4-16 flips
// generation-gallery from reserved to live). The two STILL-reserved kinds
// (file-package, contract-buildout) have zero shape here — a session
// carrying one is a malformed/unsupported response at THIS layer (the
// reserved-vs-unrecognised DISTINCTION is a view-layer concern, drawn in
// session-artifact-view.ts's `sessionArtifactView`, not here).
// ---------------------------------------------------------------------------

export type RoadmapDraftRow = {
  initiativeId: string;
  project: string;
  phase: string;
  origin: string;
  /** Cross-initiative dependency edges (orchestrator/manifest.ts's
   *  `depends_on_initiatives`, threaded verbatim through
   *  `deriveSessionArtifact`). Absent on the wire is TOLERATED (parses to
   *  `[]`, matching the server's own absent-key default) — but a present,
   *  malformed shape (non-array, or an array containing a non-string) is
   *  REJECTED, naming the field, via the same `requireStringArray` helper
   *  `sourcesScanned` already uses. */
  dependsOn: string[];
};

export type RoadmapDraftArtifact = {
  kind: 'roadmap-draft';
  /** The session-kind descriptor's declared artifact label — threaded
   *  verbatim from the wire, never a client-side kind→label lookup. */
  label: string;
  rows: RoadmapDraftRow[];
  sourcesScanned: string[];
};

export type MarkdownDraftArtifact = {
  kind: 'markdown-draft';
  label: string;
  /** null = no draft file at all; '' = an existing-but-empty draft — the two
   *  must never collapse onto the same value (AT-13/AT-14). */
  body: string | null;
  hasDraft: boolean;
};

export type BrainStructureFile = { path: string; body: string };

export type BrainStructureArtifact = {
  kind: 'brain-structure';
  label: string;
  /** Passed through VERBATIM — never re-derived from files.length (AT-20):
   *  a legitimately divergent count (some theme files failed server-side
   *  parsing) must round-trip honestly. */
  themeCount: number;
  files: BrainStructureFile[];
};

// R4-16: "generation-gallery" — the demo-builder's accumulating generation
// selector. Mirrors orchestrator/studio/session-transcript.ts's
// GenerationGalleryArtifact / GenerationGalleryEntry / GenerationGalleryItem
// exactly (hand-mirrored, per this file's convention — never a cross-boundary
// import of the orchestrator type).

const GENERATION_GALLERY_ITEM_KINDS = ['html', 'markdown', 'file'] as const;
export type GenerationGalleryItemKind = (typeof GENERATION_GALLERY_ITEM_KINDS)[number];

export type GenerationGalleryItem = {
  path: string;
  kind: GenerationGalleryItemKind;
  bytes: number;
};

export type GenerationGalleryEntry = {
  number: number;
  createdAt: string;
  feedback: string | null;
  targetElement: string | null;
  items: GenerationGalleryItem[];
};

export type GenerationGalleryArtifact = {
  kind: 'generation-gallery';
  label: string;
  generations: GenerationGalleryEntry[];
  sourcesScanned: string[];
};

export type SessionArtifactPayload = RoadmapDraftArtifact | MarkdownDraftArtifact | BrainStructureArtifact | GenerationGalleryArtifact;

function parseRoadmapDraftRow(raw: unknown, index: number): RoadmapDraftRow {
  if (!isPlainObject(raw)) {
    throw new Error(`malformed roadmap-draft row[${index}]: expected an object, got ${JSON.stringify(raw)}`);
  }
  const dependsOnRaw = raw['dependsOn'];
  return {
    initiativeId: requireString(raw, 'initiativeId'),
    project: requireString(raw, 'project'),
    phase: requireString(raw, 'phase'),
    origin: requireString(raw, 'origin'),
    // Absent ⇒ [] (tolerated, matches the server's own default); present
    // but malformed ⇒ throws naming "dependsOn" via the shared
    // requireStringArray helper (never a hand-rolled second validator).
    dependsOn: dependsOnRaw === undefined ? [] : requireStringArray(dependsOnRaw, 'dependsOn'),
  };
}

function parseRoadmapDraftArtifact(r: Record<string, unknown>): RoadmapDraftArtifact {
  const label = requireString(r, 'label');
  const rowsRaw = r['rows'];
  if (!Array.isArray(rowsRaw)) {
    throw new Error(`missing or invalid "rows": expected an array, got ${JSON.stringify(rowsRaw)}`);
  }
  return {
    kind: 'roadmap-draft',
    label,
    rows: rowsRaw.map((row, i) => parseRoadmapDraftRow(row, i)),
    sourcesScanned: requireStringArray(r['sourcesScanned'], 'sourcesScanned'),
  };
}

function parseMarkdownDraftArtifact(r: Record<string, unknown>): MarkdownDraftArtifact {
  const label = requireString(r, 'label');
  const bodyRaw = r['body'];
  if (bodyRaw !== null && typeof bodyRaw !== 'string') {
    throw new Error(`missing or invalid "body": expected a string or null, got ${JSON.stringify(bodyRaw)}`);
  }
  const hasDraftRaw = r['hasDraft'];
  if (typeof hasDraftRaw !== 'boolean') {
    throw new Error(`missing or invalid "hasDraft": expected a boolean, got ${JSON.stringify(hasDraftRaw)}`);
  }
  // Defense-in-depth against a malformed transport (AT-15): hasDraft and
  // body's nullness must agree, or this is refused rather than guessed at.
  if (hasDraftRaw && bodyRaw === null) {
    throw new Error('inconsistent markdown-draft artifact: "hasDraft" is true but "body" is null');
  }
  if (!hasDraftRaw && bodyRaw !== null) {
    throw new Error('inconsistent markdown-draft artifact: "hasDraft" is false but "body" is not null');
  }
  return { kind: 'markdown-draft', label, body: bodyRaw, hasDraft: hasDraftRaw };
}

function parseBrainStructureFile(raw: unknown, index: number): BrainStructureFile {
  if (!isPlainObject(raw)) {
    throw new Error(`malformed brain-structure file[${index}]: expected an object, got ${JSON.stringify(raw)}`);
  }
  return { path: requireString(raw, 'path'), body: requireString(raw, 'body') };
}

function parseBrainStructureArtifact(r: Record<string, unknown>): BrainStructureArtifact {
  const label = requireString(r, 'label');
  const filesRaw = r['files'];
  if (!Array.isArray(filesRaw)) {
    throw new Error(`missing or invalid "files": expected an array, got ${JSON.stringify(filesRaw)}`);
  }
  return {
    kind: 'brain-structure',
    label,
    themeCount: requireNumber(r, 'themeCount'),
    files: filesRaw.map((f, i) => parseBrainStructureFile(f, i)),
  };
}

function parseGenerationGalleryItemKind(raw: unknown): GenerationGalleryItemKind {
  if (raw === 'html' || raw === 'markdown' || raw === 'file') return raw;
  throw new Error(
    `unrecognised generation-gallery item kind ${JSON.stringify(raw)} — must be one of: ${GENERATION_GALLERY_ITEM_KINDS.join(', ')}`,
  );
}

function parseGenerationGalleryItem(raw: unknown, index: number): GenerationGalleryItem {
  if (!isPlainObject(raw)) {
    throw new Error(`malformed generation-gallery item[${index}]: expected an object, got ${JSON.stringify(raw)}`);
  }
  return {
    path: requireString(raw, 'path'),
    kind: parseGenerationGalleryItemKind(raw['kind']),
    bytes: requireNumber(raw, 'bytes'),
  };
}

function parseGenerationGalleryEntry(raw: unknown, index: number): GenerationGalleryEntry {
  if (!isPlainObject(raw)) {
    throw new Error(`malformed generation-gallery entry[${index}]: expected an object, got ${JSON.stringify(raw)}`);
  }
  const itemsRaw = raw['items'];
  if (!Array.isArray(itemsRaw)) {
    throw new Error(`missing or invalid "items": expected an array, got ${JSON.stringify(itemsRaw)}`);
  }
  return {
    number: requireInteger(raw, 'number'),
    createdAt: requireString(raw, 'createdAt'),
    feedback: requireNullableString(raw, 'feedback'),
    targetElement: requireNullableString(raw, 'targetElement'),
    items: itemsRaw.map((it, i) => parseGenerationGalleryItem(it, i)),
  };
}

function parseGenerationGalleryArtifact(r: Record<string, unknown>): GenerationGalleryArtifact {
  const label = requireString(r, 'label');
  const generationsRaw = r['generations'];
  if (!Array.isArray(generationsRaw)) {
    throw new Error(`missing or invalid "generations": expected an array, got ${JSON.stringify(generationsRaw)}`);
  }
  return {
    kind: 'generation-gallery',
    label,
    generations: generationsRaw.map((g, i) => parseGenerationGalleryEntry(g, i)),
    sourcesScanned: requireStringArray(r['sourcesScanned'], 'sourcesScanned'),
  };
}

/** An unrecognised OR still-reserved artifact kind throws, naming it — a
 *  reserved kind has no shape here to parse (that would fabricate a shape
 *  the server never sends for it today); distinguishing "reserved" from
 *  "genuinely unknown" is a view-layer concern (session-artifact-view.ts),
 *  not this parse layer's. */
export function parseSessionArtifact(raw: unknown): SessionArtifactPayload {
  if (!isPlainObject(raw)) {
    throw new Error(`malformed session artifact: expected an object, got ${JSON.stringify(raw)}`);
  }
  const kind = raw['kind'];
  switch (kind) {
    case 'roadmap-draft':
      return parseRoadmapDraftArtifact(raw);
    case 'markdown-draft':
      return parseMarkdownDraftArtifact(raw);
    case 'brain-structure':
      return parseBrainStructureArtifact(raw);
    case 'generation-gallery':
      return parseGenerationGalleryArtifact(raw);
    default:
      throw new Error(`unrecognised session artifact kind: ${JSON.stringify(kind)}`);
  }
}

// ---------------------------------------------------------------------------
// SessionShellPayload — the whole route envelope
// ---------------------------------------------------------------------------

export type SessionShellPayload = {
  ok: true;
  kind: string;
  /**
   * The session-kind descriptor's declared `title` (studio/session-kinds.
   * yaml), threaded through verbatim — mirrors `artifact.label`. REQUIRED and
   * hard-parsed like every sibling: `kind → title` has exactly one source of
   * truth, and a client-side fallback (to the raw `kind` slug, or to a local
   * kind→title map) would be a second copy of declared data that can drift.
   * An empty string is allowed, matching `requireString`'s convention across
   * every client parser in this codebase — no asymmetric special case.
   */
  title: string;
  sessionId: string;
  project: string;
  phase: string;
  stages: string[];
  defaultStage: string;
  turns: SessionTurn[];
  artifact: SessionArtifactPayload;
};

/** Every field is required and structurally checked; nothing is coerced to a
 *  permissive default. `defaultStage` and every turn's `stage`
 *  are checked against THIS payload's own `stages` (never a wider global
 *  vocabulary) — a rejection names both the offending value and the allowed
 *  set. */
export function parseSessionShellPayload(raw: unknown): SessionShellPayload {
  if (!isPlainObject(raw)) {
    throw new Error(`malformed session shell payload: expected an object, got ${JSON.stringify(raw)}`);
  }
  if (raw['ok'] !== true) {
    throw new Error(`missing or invalid "ok": expected literal true, got ${JSON.stringify(raw['ok'])}`);
  }
  const kind = requireString(raw, 'kind');
  const title = requireString(raw, 'title');
  const sessionId = requireString(raw, 'sessionId');
  const project = requireString(raw, 'project');
  const phase = requireString(raw, 'phase');
  const stages = requireStringArray(raw['stages'], 'stages');
  const defaultStage = requireString(raw, 'defaultStage');

  if (!stages.includes(defaultStage)) {
    throw new Error(
      `"defaultStage" ${JSON.stringify(defaultStage)} is not a member of this payload's own "stages" [${stages.join(', ')}]`,
    );
  }

  const turnsRaw = raw['turns'];
  if (!Array.isArray(turnsRaw)) {
    // The headline fail-open defect this module exists to refuse (AT-23):
    // never {ok:true, turns:[]} for a non-array "turns".
    throw new Error(`missing or invalid "turns": expected an array, got ${JSON.stringify(turnsRaw)}`);
  }
  const turns = turnsRaw.map((t) => parseSessionTurn(t));
  for (const turn of turns) {
    if (!stages.includes(turn.stage)) {
      throw new Error(
        `turn stage ${JSON.stringify(turn.stage)} is not a member of this payload's own "stages" [${stages.join(', ')}]`,
      );
    }
  }

  if (!('artifact' in raw)) {
    throw new Error('missing "artifact" — never fabricated as an empty artifact');
  }
  const artifact = parseSessionArtifact(raw['artifact']);

  return { ok: true, kind, title, sessionId, project, phase, stages, defaultStage, turns, artifact };
}

// ---------------------------------------------------------------------------
// interpretSessionShellOutcome — the fetch/status-code dispatch (pure)
// ---------------------------------------------------------------------------

/** Every distinct failure mode a real page must tell apart, each a DISTINCT
 *  token (AT-42) — no two real outcomes silently collapse onto the same
 *  typed result. `not-found` is the ONLY kind a view maps to a first-class
 *  "no session" state (session-shell-view.ts); every other kind is fail-
 *  closed "error", the 409 stage-conflict message reaching the operator
 *  verbatim. `no-bridge` is produced only by `fetchSessionShell` itself (no
 *  bridge URL resolved) — `interpretSessionShellOutcome` never returns it,
 *  but it is a real member of the result union every caller must handle. */
export type SessionShellErrorKind =
  | 'bad-request'
  | 'not-found'
  | 'stage-conflict'
  | 'server-error'
  | 'network-error'
  | 'non-json-response'
  | 'malformed-response'
  | 'no-bridge';

export type SessionShellFetchResult =
  | { ok: true; payload: SessionShellPayload }
  | { ok: false; errorKind: SessionShellErrorKind; error: string };

/** A plain description of what happened over the wire — deliberately no
 *  `fetch`/`Response`/`window` in this shape, so `interpretSessionShellOutcome`
 *  stays pure and testable without a fetch-mocking convention (see module
 *  header). */
export type SessionShellFetchOutcome =
  | { kind: 'network-error'; message: string }
  | { kind: 'non-json'; status: number; message: string }
  | { kind: 'json'; status: number; body: unknown };

const STATUS_ERROR_KIND: Record<number, SessionShellErrorKind> = {
  400: 'bad-request',
  404: 'not-found',
  409: 'stage-conflict',
  500: 'server-error',
};

/** Every real non-2xx status this route sends (bridge-studio-sessions.ts:
 *  400/404/409/500) maps to its own token; anything else falls back to
 *  'server-error' rather than an unhandled/undefined errorKind. */
function errorKindForStatus(status: number): SessionShellErrorKind {
  return STATUS_ERROR_KIND[status] ?? 'server-error';
}

/** The server's `error` string reaches the operator VERBATIM — the whole
 *  point of the fail-closed 409 contract (naming the offending stage value
 *  and the allowed set). A body with no "error" string falls back to a
 *  generic HTTP-status message, never throws. */
function extractErrorMessage(body: unknown, status: number): string {
  if (isPlainObject(body) && typeof body['error'] === 'string') return body['error'];
  return `HTTP ${status}`;
}

/**
 * Pure dispatch: never throws out of itself (a 200-but-malformed body is
 * caught and folded into `{ok:false, errorKind:'malformed-response'}`, never
 * left to escape as an uncaught exception).
 */
export function interpretSessionShellOutcome(outcome: SessionShellFetchOutcome): SessionShellFetchResult {
  if (outcome.kind === 'network-error') {
    return { ok: false, errorKind: 'network-error', error: outcome.message };
  }
  if (outcome.kind === 'non-json') {
    return { ok: false, errorKind: 'non-json-response', error: outcome.message };
  }
  const { status, body } = outcome;
  if (status === 200) {
    try {
      return { ok: true, payload: parseSessionShellPayload(body) };
    } catch (err) {
      return { ok: false, errorKind: 'malformed-response', error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { ok: false, errorKind: errorKindForStatus(status), error: extractErrorMessage(body, status) };
}

// ---------------------------------------------------------------------------
// fetchSessionShell — thin, untested-here wrapper (see module header)
// ---------------------------------------------------------------------------

function sessionShellPath(kind: string, sessionId: string, project: string): string {
  return `/api/studio/sessions/${encodeURIComponent(kind)}/${encodeURIComponent(sessionId)}?project=${encodeURIComponent(project)}`;
}

/** Fetch a session's shell payload from the bridge. Resolves the bridge URL,
 *  performs the fetch, and folds every network/parse failure into
 *  `SessionShellFetchOutcome` before delegating to the pure
 *  `interpretSessionShellOutcome` — see module header for why the split
 *  exists. Untested in session-client.test.ts by design (that file's own
 *  header); the over-the-wire behaviour is pinned by cli/bridge-studio-
 *  sessions.test.ts. */
export async function fetchSessionShell(kind: string, sessionId: string, project: string): Promise<SessionShellFetchResult> {
  const base = await resolveBridgeUrl();
  if (!base) return { ok: false, errorKind: 'no-bridge', error: 'no bridge configured' };

  let res: Response;
  try {
    res = await fetch(`${base}${sessionShellPath(kind, sessionId, project)}`);
  } catch (err) {
    return interpretSessionShellOutcome({ kind: 'network-error', message: String(err) });
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    return interpretSessionShellOutcome({ kind: 'non-json', status: res.status, message: String(err) });
  }

  return interpretSessionShellOutcome({ kind: 'json', status: res.status, body });
}
