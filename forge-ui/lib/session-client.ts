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
 * wrapper — it calls `bridgeFetch()` (the ONE Studio transport), catches network/
 * parse failures into that same outcome shape, and delegates. This is what
 * makes every dispatch rule (400/404/409/500/network-error/non-JSON/
 * 200-but-malformed) testable without `vi.stubGlobal('fetch', ...)`, matching
 * this repo's existing convention (hook-client.test.ts / community-client.
 * test.ts) rather than introducing the first fetch-mocking convention in this
 * file set.
 */

import { bridgeFetch } from './bridge-client';
import { parseSessionLifecycle, type SessionLifecycle } from './session-lifecycle-client';

export type { SessionLifecycle } from './session-lifecycle-client';

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

// R4-17: "contract-buildout" — the onboarding/creation session's five-stage
// presence report. Mirrors orchestrator/studio/session-transcript.ts's
// ContractStageRow/ContractBuildoutArtifact exactly (hand-mirrored, per this
// file's convention — never a cross-boundary import of the orchestrator
// type). D11: a row reports PRESENCE only ("present"/"absent"), never a
// clause verdict — this client never invents a third status value.

const CONTRACT_STAGE_STATUSES = ['present', 'absent'] as const;
export type ContractStageStatus = (typeof CONTRACT_STAGE_STATUSES)[number];

export type ContractStageRow = {
  stage: string;
  status: ContractStageStatus;
  source: string;
  detail: string[];
  /** The real byte length read off disk for the two prose-file-backed
   *  stages (`instructions`, `roadmap`); `null` for the three config/lock-
   *  JSON-backed stages (`contract`, `secrets`, `demo`). Never a string,
   *  never omitted — a malformed/missing `bytes` throws. */
  bytes: number | null;
};

export type ContractBuildoutArtifact = {
  kind: 'contract-buildout';
  label: string;
  stages: ContractStageRow[];
  sourcesScanned: string[];
};

// R4-21: "file-package" — the creation-agent authoring session's
// accumulating skill/hook draft package. Mirrors orchestrator/studio/
// session-transcript.ts's FilePackageArtifact exactly (hand-mirrored, per
// this file's convention — never a cross-boundary import of the orchestrator
// type). Shares the {path, body} file shape with BrainStructureFile but is
// declared as its own type — the two artifacts are unrelated on the wire,
// and this file's convention is one type per artifact kind, not a shared
// structural type reused across kinds.

export type FilePackageFile = { path: string; body: string };

export type FilePackageArtifact = {
  kind: 'file-package';
  label: string;
  files: FilePackageFile[];
};

// R4-19-F2: "cleanup-plan" — the kb-cleanup session's brain-maintenance
// artifact (studio/session-kinds.yaml's `id: kb-cleanup`, `agent:
// brain-maintenance`). Mirrors orchestrator/studio/session-transcript.ts's
// CleanupPlanAction/CleanupPlanArtifact exactly (hand-mirrored, per this
// file's convention — never a cross-boundary import of the orchestrator
// type). Live from birth (never reserved), unlike generation-gallery/
// contract-buildout/file-package's reserved→live histories above.
//
// Three action states, not two: `state` is DERIVED server-side, fresh on
// every read, by joining the drafted plan against a live brain-lint scan —
// there is no stored per-action status anywhere. The third state, `unknown`,
// is load-bearing and was won the hard way: a real run once reported every
// action `cleared` while nothing had been repaired, because absence of a
// matching finding was wrongly treated as proof of repair. `unknown` is the
// fail-safe default whenever coverage cannot be established (no scanned-
// domain evidence, or the target resolves outside the scanned KB dir) — a
// client that ever collapses `unknown` into `cleared` reintroduces that
// defect one layer up.

const CLEANUP_ACTION_STATES = ['open', 'cleared', 'unknown'] as const;
export type CleanupActionState = (typeof CLEANUP_ACTION_STATES)[number];

export type CleanupPlanAction = {
  kind: string;
  target: string;
  proposal: string;
  state: CleanupActionState;
};

export type CleanupPlanArtifact = {
  kind: 'cleanup-plan';
  label: string;
  /** The raw plan text, verbatim, whether or not any line parsed into an
   *  action — null only when no plan file exists at all. Never null merely
   *  because zero lines parsed: a drafted-but-unparseable plan must never
   *  collapse onto "no plan yet" — that ambiguity is exactly what this field
   *  exists to disambiguate. */
  plan: string | null;
  actions: CleanupPlanAction[];
  /** The count of `actions` whose `state` is 'open' — the SERVER's number,
   *  never recomputed client-side from `actions` (mirrors
   *  BrainStructureArtifact.themeCount: a legitimately divergent
   *  server-reported count must round-trip honestly, never be "corrected"). */
  openFindingCount: number;
};

export type SessionArtifactPayload =
  | RoadmapDraftArtifact
  | MarkdownDraftArtifact
  | BrainStructureArtifact
  | GenerationGalleryArtifact
  | ContractBuildoutArtifact
  | FilePackageArtifact
  | CleanupPlanArtifact;

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

function parseContractStageStatus(raw: unknown): ContractStageStatus {
  if (raw === 'present' || raw === 'absent') return raw;
  throw new Error(`unrecognised contract-buildout stage status ${JSON.stringify(raw)} — must be one of: ${CONTRACT_STAGE_STATUSES.join(', ')}`);
}

export function parseContractStageRow(raw: unknown, index: number): ContractStageRow {
  if (!isPlainObject(raw)) {
    throw new Error(`malformed contract-buildout stage row[${index}]: expected an object, got ${JSON.stringify(raw)}`);
  }
  const stage = requireString(raw, 'stage');
  const status = parseContractStageStatus(raw['status']);
  const source = requireString(raw, 'source');
  const detail = requireStringArray(raw['detail'], 'detail');
  const bytesRaw = raw['bytes'];
  if (bytesRaw !== null && typeof bytesRaw !== 'number') {
    throw new Error(`missing or invalid "bytes": expected a number or null, got ${JSON.stringify(bytesRaw)}`);
  }
  return { stage, status, source, detail, bytes: bytesRaw };
}

function parseFilePackageFile(raw: unknown, index: number): FilePackageFile {
  if (!isPlainObject(raw)) {
    throw new Error(`malformed file-package file[${index}]: expected an object, got ${JSON.stringify(raw)}`);
  }
  return { path: requireString(raw, 'path'), body: requireString(raw, 'body') };
}

function parseFilePackageArtifact(r: Record<string, unknown>): FilePackageArtifact {
  const label = requireString(r, 'label');
  const filesRaw = r['files'];
  if (!Array.isArray(filesRaw)) {
    throw new Error(`missing or invalid "files": expected an array, got ${JSON.stringify(filesRaw)}`);
  }
  return {
    kind: 'file-package',
    label,
    files: filesRaw.map((f, i) => parseFilePackageFile(f, i)),
  };
}

function parseContractBuildoutArtifact(r: Record<string, unknown>): ContractBuildoutArtifact {
  const label = requireString(r, 'label');
  const stagesRaw = r['stages'];
  if (!Array.isArray(stagesRaw)) {
    throw new Error(`missing or invalid "stages": expected an array, got ${JSON.stringify(stagesRaw)}`);
  }
  return {
    kind: 'contract-buildout',
    label,
    stages: stagesRaw.map((s, i) => parseContractStageRow(s, i)),
    sourcesScanned: requireStringArray(r['sourcesScanned'], 'sourcesScanned'),
  };
}

function parseCleanupActionState(raw: unknown): CleanupActionState {
  if (raw === 'open' || raw === 'cleared' || raw === 'unknown') return raw;
  // Mirrors parseContractStageStatus exactly (AT-118): an unrecognised state
  // is refused BY NAME, never silently coerced to the most permissive
  // reading — 'unknown' looks like a safe default here but is a REAL state
  // with its own semantics (coverage not established), not a catch-all for
  // parse failures.
  throw new Error(`unrecognised cleanup-plan action state ${JSON.stringify(raw)} — must be one of: ${CLEANUP_ACTION_STATES.join(', ')}`);
}

function parseCleanupPlanAction(raw: unknown, index: number): CleanupPlanAction {
  if (!isPlainObject(raw)) {
    throw new Error(`malformed cleanup-plan action[${index}]: expected an object, got ${JSON.stringify(raw)}`);
  }
  return {
    kind: requireString(raw, 'kind'),
    target: requireString(raw, 'target'),
    proposal: requireString(raw, 'proposal'),
    state: parseCleanupActionState(raw['state']),
  };
}

function parseCleanupPlanArtifact(r: Record<string, unknown>): CleanupPlanArtifact {
  const label = requireString(r, 'label');
  const actionsRaw = r['actions'];
  if (!Array.isArray(actionsRaw)) {
    // AT-117: "actions" missing or non-array THROWS — never coerced to [].
    throw new Error(`missing or invalid "actions": expected an array, got ${JSON.stringify(actionsRaw)}`);
  }
  const planRaw = r['plan'];
  if (planRaw !== null && typeof planRaw !== 'string') {
    // AT-121: mirrors markdown-draft's "body" — string or literal null (no
    // drafted plan yet) only; any other type throws.
    throw new Error(`missing or invalid "plan": expected a string or null, got ${JSON.stringify(planRaw)}`);
  }
  return {
    kind: 'cleanup-plan',
    label,
    plan: planRaw,
    actions: actionsRaw.map((a, i) => parseCleanupPlanAction(a, i)),
    // AT-120: the server's own count, threaded through VERBATIM — never
    // recomputed from `actions` here (mirrors brain-structure's themeCount).
    openFindingCount: requireNumber(r, 'openFindingCount'),
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
    case 'file-package':
      // Wrapped so EVERY internal field failure still names "file-package"
      // (mirrors contract-buildout's own wrap immediately below — AT-21
      // asserts this even for a bare `{kind:'file-package'}` object, which
      // fails on the very first required field, "label").
      try {
        return parseFilePackageArtifact(raw);
      } catch (err) {
        throw new Error(`malformed file-package artifact: ${err instanceof Error ? err.message : String(err)}`);
      }
    case 'contract-buildout':
      // Wrapped so EVERY internal field failure still names "contract-buildout"
      // (AT-21 pins this even for a bare `{kind:'contract-buildout'}` object,
      // which fails on the very first required field, "label" — a message
      // that would otherwise say nothing about which artifact kind it came
      // from, unlike every other case's kind-specific parser is trusted to
      // do implicitly because none of THEM has an AT requiring it).
      try {
        return parseContractBuildoutArtifact(raw);
      } catch (err) {
        throw new Error(`malformed contract-buildout artifact: ${err instanceof Error ? err.message : String(err)}`);
      }
    case 'cleanup-plan':
      // Deliberately UNWRAPPED, unlike file-package/contract-buildout above
      // — this file's own test header (R4-19-F2 block) rules the "wrap so
      // the thrown message names the kind" behaviour is NOT a universal
      // contract (generation-gallery is live proof: AT-21 removed that
      // requirement from it when it went live). Inventing the stricter
      // wrap here — for a kind no AT requires it for — would be scope this
      // parser doesn't need.
      return parseCleanupPlanArtifact(raw);
    default:
      throw new Error(`unrecognised session artifact kind: ${JSON.stringify(kind)}`);
  }
}

// ---------------------------------------------------------------------------
// SessionAffordancePayload — mirrors orchestrator/studio/session-kinds.ts's
// `SessionAffordance` (W6-B6, ADR-043 2026-08-15 amendment §1 "affordances
// are derived, not authored"). Re-declared client-side per this file's own
// convention (header) — never imported from the orchestrator.
// ---------------------------------------------------------------------------

const SESSION_AFFORDANCE_KINDS = ['question-form', 'verdict', 'staged-review', 'next-turn'] as const;
export type SessionAffordanceKind = (typeof SESSION_AFFORDANCE_KINDS)[number];

/** W7-C2 (sessions-kinds-17/19, bead forge-lzv) — one pending interview
 *  question as the bridge attaches it to the question-form affordance's
 *  meta at `awaiting-answers` (cli/bridge-studio-sessions.ts's
 *  `attachPendingQuestions`): the REAL question text (what the panel posts
 *  back with each answer — never a placeholder), an optional short header,
 *  and the recommended options. */
export type SessionPendingQuestion = {
  question: string;
  header?: string;
  options: { label: string; description: string }[];
};

export type SessionAffordance = {
  id: string;
  kind: SessionAffordanceKind;
  phase: string;
  /** Present only when the source phase-table row carried the corresponding
   *  field (`writes` for `staged-review`, `next` for `next-turn`, `requires`
   *  for `verdict` — W6-B9) — omitted, never defaulted, mirroring the
   *  server's own omit-don't-default discipline (session-kinds.ts's
   *  `deriveSessionAffordances`). `verdicts` (W6-B6 post-merge review) is
   *  the ONE exception: the server ALWAYS attaches it to a `verdict`-kind
   *  affordance (the row's authored list, or the ADR default
   *  `['approve','reject']`) — this is the single source of "which verdict
   *  values are legal here"; the panel renders its buttons from THIS field
   *  only, never a client-side per-kind table. `requires` (W6-B9, reviewer
   *  finding on W6-B8) is the equally single source of "which extra POST
   *  body fields this verdict needs beyond `verdict` itself" — unlike the
   *  other sub-fields here, this one is NOT merely advisory display data:
   *  `SessionInteractivePanel` gates its Approve button on it (closes the
   *  class of defect where the client hardcoded a guess at a server-side
   *  requirement — the file-package "needs an id" rule used to be a
   *  client-only assumption with no wire signal tying it to
   *  `handleAuthoringVerdict`'s own `{kind,id}` check). */
  meta?: { writes?: string[]; next?: string; verdicts?: string[]; requires?: string[]; questions?: SessionPendingQuestion[] };
};

function parseSessionAffordanceKind(raw: unknown): SessionAffordanceKind {
  if (typeof raw === 'string' && (SESSION_AFFORDANCE_KINDS as readonly string[]).includes(raw)) {
    return raw as SessionAffordanceKind;
  }
  throw new Error(`unrecognised affordance kind ${JSON.stringify(raw)} — must be one of: ${SESSION_AFFORDANCE_KINDS.join(', ')}`);
}

/** A malformed affordance (wrong-typed/missing field, an unrecognised kind,
 *  or not a plain object) throws — mirrors `parseSessionTurn`'s discipline;
 *  never rendered with an invented field. `meta` is carried through
 *  verbatim when present (both sub-fields optional-tolerant — a malformed
 *  `writes`/`next` degrades that ONE sub-field to absent rather than
 *  throwing the whole affordance away, since `meta` is advisory display
 *  data, not a gate). */
function parseSessionAffordance(raw: unknown): SessionAffordance {
  if (!isPlainObject(raw)) {
    throw new Error(`malformed session affordance: expected an object, got ${JSON.stringify(raw)}`);
  }
  const id = requireString(raw, 'id');
  const kind = parseSessionAffordanceKind(raw['kind']);
  const phase = requireString(raw, 'phase');
  const metaRaw = raw['meta'];
  let meta: SessionAffordance['meta'];
  if (isPlainObject(metaRaw)) {
    const writes = Array.isArray(metaRaw['writes']) && metaRaw['writes'].every((w) => typeof w === 'string') ? (metaRaw['writes'] as string[]) : undefined;
    const next = typeof metaRaw['next'] === 'string' ? metaRaw['next'] : undefined;
    const verdicts = Array.isArray(metaRaw['verdicts']) && metaRaw['verdicts'].every((v) => typeof v === 'string') ? (metaRaw['verdicts'] as string[]) : undefined;
    const requires = Array.isArray(metaRaw['requires']) && metaRaw['requires'].every((r) => typeof r === 'string') ? (metaRaw['requires'] as string[]) : undefined;
    // W7-C2 — same tolerance discipline as the sub-fields above: a
    // malformed `questions` degrades that ONE sub-field to absent (advisory
    // display data — the panel then falls back to the free-text box), never
    // throws the whole affordance away.
    const questions = parsePendingQuestionsMeta(metaRaw['questions']);
    if (writes !== undefined || next !== undefined || verdicts !== undefined || requires !== undefined || questions !== undefined) {
      meta = {
        ...(writes !== undefined ? { writes } : {}),
        ...(next !== undefined ? { next } : {}),
        ...(verdicts !== undefined ? { verdicts } : {}),
        ...(requires !== undefined ? { requires } : {}),
        ...(questions !== undefined ? { questions } : {}),
      };
    }
  }
  return { id, kind, phase, ...(meta !== undefined ? { meta } : {}) };
}

/** Tolerant meta-sub-field parse for `questions` — `undefined` (not a
 *  throw) for any malformed shape, a fully-shaped array otherwise. Each
 *  entry: `question` string (required), `header` string (optional),
 *  `options` an array of {label, description} strings (a malformed options
 *  entry degrades the WHOLE questions field to absent — a question rendered
 *  with invented options is worse than the free-text fallback). */
function parsePendingQuestionsMeta(raw: unknown): SessionPendingQuestion[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const questions: SessionPendingQuestion[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry) || typeof entry['question'] !== 'string') return undefined;
    const optionsRaw = entry['options'];
    if (optionsRaw !== undefined && !Array.isArray(optionsRaw)) return undefined;
    const options: { label: string; description: string }[] = [];
    for (const o of Array.isArray(optionsRaw) ? optionsRaw : []) {
      if (!isPlainObject(o) || typeof o['label'] !== 'string' || typeof o['description'] !== 'string') return undefined;
      options.push({ label: o['label'], description: o['description'] });
    }
    questions.push({
      question: entry['question'],
      ...(typeof entry['header'] === 'string' ? { header: entry['header'] } : {}),
      options,
    });
  }
  return questions;
}

function parseSessionAffordances(raw: unknown): SessionAffordance[] {
  if (!Array.isArray(raw)) {
    throw new Error(`missing or invalid "affordances": expected an array, got ${JSON.stringify(raw)}`);
  }
  return raw.map((a) => parseSessionAffordance(a));
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
  /**
   * W6-B6 (ADR-043 2026-08-15 amendment §1) — the derived, phase-scoped
   * operator affordances (`orchestrator/studio/session-kinds.ts`'s
   * `deriveSessionAffordances`, server-computed). REQUIRED and hard-parsed
   * like every sibling field — a kind with no derivable affordances
   * (architect) still carries a genuine `[]`, never an omitted key.
   * `SessionInteractivePanel` renders EXACTLY this array and never
   * re-derives from `phase` itself (the "derived, not authored" discipline).
   */
  affordances: SessionAffordance[];
  /**
   * W6-B6 (ADR-043 2026-08-15 amendment §3) — the session's own
   * kickoff-selected model tier, read live off `status.json.modelTier`.
   * `null` for a session with no recorded tier (predates the seam, or a
   * `strategy:fixed` skill's kickoff never writes one). REQUIRED (the key
   * is always present on the wire, never omitted) — `null` IS the honest
   * value here, not an absence to model as `undefined`.
   */
  modelTier: string | null;
  /**
   * W6-B8 — mirrors the server's own `isTerminalPhase` derivation
   * (`cli/bridge-studio-sessions.ts`), threaded onto the wire so the generic
   * `SessionInteractivePanel` can gate its ActivityLog drawer without a
   * second, hand-kept terminal-phase table client-side. REQUIRED and
   * hard-parsed like every sibling field above — never omitted, never
   * defaulted to `false`.
   */
  terminal: boolean;
  /**
   * W7-FIX-A2 (W7A2-04) — whether this KIND records turns as a transcript
   * at all (bridge-derived: a `turnSpec` kind rides the generic spine, which
   * never writes transcript turns → `false`; a legacy-runner kind → `true`).
   * Keys the empty-transcript copy (`session-shell-view.ts`) so a
   * transcript-bearing kind at an operator gate is never told its work is
   * "in the artifact pane". REQUIRED and hard-parsed like `terminal`.
   */
  transcript: boolean;
  /**
   * W7-A2 — the bridge's DERIVED lifecycle (`cli/bridge-studio-lifecycle.ts`):
   * `state` (working | awaiting-operator | crashed | stalled | terminal), a
   * truthful `needsYou`, the runner's crash `error` text, `idleMs`, and
   * `cancellable`. REQUIRED and hard-parsed (`parseSessionLifecycle`) — a
   * missing lifecycle throws, never defaults to "working".
   */
  lifecycle: SessionLifecycle;
  /**
   * W7-C2 (sessions-kinds-36) — the persisted {kind, id} pointer at
   * whatever object a committed session produced (an authoring session's
   * landed skill/hook, a community-refresh commit's registry), written once
   * at finalize success and read back on every GET so the committed session
   * page keeps a PERMANENT link — never a one-shot redirect lost on reload.
   * REQUIRED like `modelTier`: `null` IS the honest value for a session
   * that produced nothing, never an omitted key.
   */
  finalized: { kind: string; id: string } | null;
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

  // W6-B6 — hard-required (never coerced to a permissive default): a
  // non-array "affordances" throws, mirroring the "turns" refusal above
  // this same function.
  const affordances = parseSessionAffordances(raw['affordances']);

  // modelTier's honest value space is `string | null` — `null` IS the real
  // answer for "no recorded tier", so this is REQUIRED (throws if the key
  // is missing or neither a string nor null), never absence-tolerant.
  const modelTierRaw = raw['modelTier'];
  if (modelTierRaw !== null && typeof modelTierRaw !== 'string') {
    throw new Error(`missing or invalid "modelTier": expected a string or null, got ${JSON.stringify(modelTierRaw)}`);
  }
  const modelTier = modelTierRaw;

  // W6-B8 — REQUIRED like "affordances"/"modelTier" above: a missing or
  // non-boolean "terminal" throws, never defaulted to false.
  const terminalRaw = raw['terminal'];
  if (typeof terminalRaw !== 'boolean') {
    throw new Error(`missing or invalid "terminal": expected a boolean, got ${JSON.stringify(terminalRaw)}`);
  }
  const terminal = terminalRaw;

  // W7-FIX-A2 (W7A2-04) — REQUIRED like "terminal": a missing or non-boolean
  // "transcript" throws, never defaulted (either default would be a lie for
  // half the kinds).
  const transcriptRaw = raw['transcript'];
  if (typeof transcriptRaw !== 'boolean') {
    throw new Error(`missing or invalid "transcript": expected a boolean, got ${JSON.stringify(transcriptRaw)}`);
  }
  const transcript = transcriptRaw;

  // W7-A2 — REQUIRED like "terminal" above; every malformed shape throws.
  const lifecycle = parseSessionLifecycle(raw['lifecycle']);

  // W7-C2 — REQUIRED like "modelTier": null is the honest empty value, a
  // missing key or any shape other than {kind: string, id: string} throws.
  if (!('finalized' in raw)) {
    throw new Error('missing "finalized" — expected {kind, id} or null, never an omitted key');
  }
  const finalizedRaw = raw['finalized'];
  let finalized: { kind: string; id: string } | null = null;
  if (finalizedRaw !== null) {
    if (!isPlainObject(finalizedRaw) || typeof finalizedRaw['kind'] !== 'string' || typeof finalizedRaw['id'] !== 'string') {
      throw new Error(`missing or invalid "finalized": expected {kind: string, id: string} or null, got ${JSON.stringify(finalizedRaw)}`);
    }
    finalized = { kind: finalizedRaw['kind'], id: finalizedRaw['id'] };
  }

  return {
    ok: true, kind, title, sessionId, project, phase, stages, defaultStage, turns, artifact,
    affordances,
    modelTier,
    terminal,
    transcript,
    lifecycle,
    finalized,
  };
}

// ---------------------------------------------------------------------------
// interpretSessionShellOutcome — the fetch/status-code dispatch (pure)
// ---------------------------------------------------------------------------

/** Every distinct failure mode a real page must tell apart, each a DISTINCT
 *  token (AT-42) — no two real outcomes silently collapse onto the same
 *  typed result. `not-found` is the ONLY kind a view maps to a first-class
 *  "no session" state (session-shell-view.ts); every other kind is fail-
 *  closed "error", the 409 stage-conflict message reaching the operator
 *  verbatim. `no-bridge` is retained as a member of the union every caller
 *  must handle; since W7-FIX-A1 `fetchSessionShell` rides `bridgeFetch`,
 *  whose "no bridge configured" throw (SSR only — in a browser the transport
 *  always resolves a base) surfaces as `network-error`. */
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

/** W7-A2 — `project` is OPTIONAL: `null` omits the query entirely and the
 *  bridge resolves the anchor project server-side (`findSessionProject`,
 *  cli/bridge-studio-sessions.ts) — a deep link that carries no `?project=`
 *  is a working address for every kind. */
function sessionShellPath(kind: string, sessionId: string, project: string | null): string {
  const base = `/api/studio/sessions/${encodeURIComponent(kind)}/${encodeURIComponent(sessionId)}`;
  return project !== null ? `${base}?project=${encodeURIComponent(project)}` : base;
}

/** Fetch a session's shell payload from the bridge. Resolves the bridge URL,
 *  performs the fetch, and folds every network/parse failure into
 *  `SessionShellFetchOutcome` before delegating to the pure
 *  `interpretSessionShellOutcome` — see module header for why the split
 *  exists. Untested in session-client.test.ts by design (that file's own
 *  header); the over-the-wire behaviour is pinned by cli/bridge-studio-
 *  sessions.test.ts. */
export async function fetchSessionShell(kind: string, sessionId: string, project: string | null): Promise<SessionShellFetchResult> {
  let res: Response;
  try {
    res = await bridgeFetch(sessionShellPath(kind, sessionId, project));
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

// ---------------------------------------------------------------------------
// postSessionAffordance — the W6-B6 write half, `POST /api/studio/sessions/
// :kind/:sessionId/:affordance` (`cli/bridge-studio-affordances.ts`, W6-B4).
// Sibling of `fetchSessionShell` above — same module, same bridge-URL
// resolution, but its own small POST helper (this file owns no import of
// `bridgePost`/`studioPost`, per this file's "each client owns its own small
// helpers" convention, header).
// ---------------------------------------------------------------------------

export type PostSessionAffordanceResult =
  | { ok: true; data: Record<string, unknown> }
  | {
      ok: false;
      error: string;
      /** Present only for a 501 `UnhandledAffordanceBody` (a structurally
       *  valid, currently-available affordance this route has no write
       *  handler for) — lets a caller distinguish "not yet wired" from any
       *  other failure without string-matching `error`. Absent for every
       *  other failure shape (network error, 400/404/409/422/500). */
      unhandledKind?: SessionAffordanceKind;
    };

function sessionAffordancePath(kind: string, sessionId: string, affordanceId: string): string {
  return `/api/studio/sessions/${encodeURIComponent(kind)}/${encodeURIComponent(sessionId)}/${encodeURIComponent(affordanceId)}`;
}

/**
 * POST an operator act against one currently-available affordance. `body`
 * is the per-affordance-kind wire shape (`{answers: [...]}` for a
 * question-form submit, `{verdict: 'approve'|'reject', ...}` for a verdict) —
 * this function does not shape it, only carries it through verbatim (the
 * SAME "delegate, never reimplement" discipline the route itself documents).
 *
 * Every failure surfaces the server's own `error` string VERBATIM — a 409
 * wrong-phase refusal (naming the offending affordance id + the currently
 * available set), a 422 (e.g. kb-cleanup/authoring's reject-unsupported
 * refusal), and a 501 `UnhandledAffordanceBody` alike. Never swallowed,
 * never replaced by a generic "failed" string.
 */
export async function postSessionAffordance(
  kind: string,
  sessionId: string,
  affordanceId: string,
  body: Record<string, unknown>,
): Promise<PostSessionAffordanceResult> {
  let res: Response;
  try {
    res = await bridgeFetch(sessionAffordancePath(kind, sessionId, affordanceId), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, error: String(err) };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch (err) {
    return { ok: false, error: `non-JSON affordance response (HTTP ${res.status}): ${String(err)}` };
  }
  if (!isPlainObject(data)) {
    return { ok: false, error: `malformed affordance response (HTTP ${res.status}): expected an object, got ${JSON.stringify(data)}` };
  }

  if (!res.ok || data['ok'] === false) {
    const error = typeof data['error'] === 'string' ? data['error'] : `HTTP ${res.status}`;
    let unhandledKind: SessionAffordanceKind | undefined;
    if (typeof data['kind'] === 'string' && (SESSION_AFFORDANCE_KINDS as readonly string[]).includes(data['kind'])) {
      unhandledKind = data['kind'] as SessionAffordanceKind;
    }
    return { ok: false, error, ...(unhandledKind !== undefined ? { unhandledKind } : {}) };
  }

  return { ok: true, data };
}
