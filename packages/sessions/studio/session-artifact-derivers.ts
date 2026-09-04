/**
 * Deriving a session's ARTIFACT — the per-kind payload the session shell
 * renders — and the two guarded readers every deriver stands on.
 *
 * Split out of `studio/session-transcript.ts` (M4 exit row 5). That file did two
 * jobs: read a session's turn history into a transcript, and derive its artifact.
 * The artifact half is the bigger one and depends on the transcript half for
 * nothing at all, so the parent calls in and this module never calls back.
 *
 * `safeReadFileInSession` and `listDirEntries` TRAVEL WITH THE DERIVERS rather
 * than staying behind, and that is the whole reason the seam is one-way: eleven
 * call sites in here use them. The alternative — threading both as ports through
 * every deriver, the way `deriveRoadmapDraft` already takes its reader — would
 * have been a far larger and more error-prone diff than naming the module for
 * what it holds. The parent imports them back; nothing else about the direction
 * changes.
 *
 * `safeReadFileInSession` remains the ONE realpath-guarded choke point for
 * every file read out of a session dir. A second, unguarded read path is how a
 * symlinked file inside a session dir leaks content from outside it.
 */
import { readFileSync, readdirSync, realpathSync, type Dirent } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';

import type { SessionStage } from './session-kinds.ts';
import { MAX_PACKAGE_BYTES, MAX_PACKAGE_FILES } from '@forge/library/studio/skill-package.ts';
import type { PackageFile } from '@forge/library/studio/skill-package.ts';
import type { RoadmapDraftArtifact } from './roadmap-draft.ts';

const AGENTS_DRAFT_FILENAME = 'AGENTS.draft.md';
const THEMES_DIRNAME = 'themes';
export function safeReadFileInSession(sessionDir: string, relPath: string): string | null {
  const abs = join(sessionDir, relPath);
  let realSessionDir: string;
  try {
    realSessionDir = realpathSync(sessionDir);
  } catch {
    return null; // sessionDir itself doesn't exist / unreadable
  }
  let realAbs: string;
  try {
    realAbs = realpathSync(abs);
  } catch {
    return null; // missing file, broken symlink, or unreadable path segment
  }
  if (realAbs !== realSessionDir && !realAbs.startsWith(realSessionDir + sep)) {
    return null; // escapes sessionDir via a symlink — treated as absent, never returned
  }
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

/** Lists a subdirectory's entries filtered by extension, sorted by filename.
 *  A missing directory yields []. Entry CONTENT safety (symlink escape) is
 *  enforced later, per-file, by safeReadFileInSession — that guard alone
 *  does NOT cover this function: if the subdirectory itself (`manifests/` or
 *  `themes/`) is a symlink to an outside directory, `readdirSync` follows it
 *  and returns the OUTSIDE directory's real entry names/count — observable
 *  even when every individual file read is later blocked, because a caller
 *  (deriveRoadmapDraft's `sourcesScanned`) reports the raw entry COUNT before
 *  any per-file containment check runs (AT-amendment-3, A2 / AT-68, AT-69).
 *  This function therefore realpath-contains the subdirectory itself, at the
 *  same choke-point pattern as `safeReadFileInSession`: a `manifests/` or
 *  `themes/` that resolves outside `sessionDir` is treated as absent (empty
 *  listing) rather than followed. With that guard, this function leaks
 *  neither names nor a derived count from outside `sessionDir` — only entry
 *  NAMES from within a directory proven to be contained; entry CONTENT
 *  safety remains safeReadFileInSession's job when each name is later read. */
export function listDirEntries(sessionDir: string, dirRel: string, extension: string): string[] {
  const abs = join(sessionDir, dirRel);
  let realSessionDir: string;
  try {
    realSessionDir = realpathSync(sessionDir);
  } catch {
    return []; // sessionDir itself doesn't exist / unreadable
  }
  let realAbs: string;
  try {
    realAbs = realpathSync(abs);
  } catch {
    return []; // missing subdirectory, broken symlink, or unreadable path segment
  }
  if (realAbs !== realSessionDir && !realAbs.startsWith(realSessionDir + sep)) {
    return []; // subdirectory escapes sessionDir via a symlink — treated as absent, never followed
  }
  let names: string[];
  try {
    names = readdirSync(abs);
  } catch {
    return [];
  }
  return names.filter((n) => n.endsWith(extension)).sort((a, b) => a.localeCompare(b));
}
export type MarkdownDraftArtifact = {
  readonly kind: 'markdown-draft';
  /** The session-kind descriptor's declared `artifact.label` — see
   *  RoadmapDraftArtifact.label. */
  readonly label: string;
  /** null = no draft file at all; '' = an existing-but-empty draft (AT-32). */
  readonly body: string | null;
  readonly hasDraft: boolean;
};

export type BrainStructureArtifact = {
  readonly kind: 'brain-structure';
  /** The session-kind descriptor's declared `artifact.label` — see
   *  RoadmapDraftArtifact.label. */
  readonly label: string;
  readonly themeCount: number;
  // Mutable element array — see the identical rationale on RoadmapDraftArtifact.rows.
  readonly files: PackageFile[];
};

export type GenerationGalleryItem = {
  readonly path: string;
  readonly kind: 'html' | 'markdown' | 'file';
  /** The byte length of the content actually READ from disk — never a number
   *  copied from meta.json (R4-16 AT-14: a plausible-but-wrong metadata hint
   *  must never leak through). */
  readonly bytes: number;
};

export type GenerationGalleryEntry = {
  /** Sourced from the snapshot's OWN meta.json `iteration` — never array or
   *  directory position (R4-16 AT-10). A generation whose meta.json is
   *  missing/unreadable/unparsable/missing-or-mistyped-iteration contributes
   *  NO entry, leaving a visible gap rather than a renumbered sequence. */
  readonly number: number;
  readonly createdAt: string;
  readonly feedback: string | null;
  readonly targetElement: string | null;
  // Mutable element array — same rationale as RoadmapDraftArtifact.rows: the
  // pinned AT idiom casts the derived artifact to a plain mutable-array
  // shape, and a `readonly T[]` is never assignable to a mutable `T[]` target.
  readonly items: GenerationGalleryItem[];
};

export type GenerationGalleryArtifact = {
  readonly kind: 'generation-gallery';
  /** The session-kind descriptor's declared `artifact.label` — see
   *  RoadmapDraftArtifact.label. */
  readonly label: string;
  // Mutable element array — see RoadmapDraftArtifact.rows.
  readonly generations: GenerationGalleryEntry[];
  readonly sourcesScanned: string[];
};

// ---------------------------------------------------------------------------
// contract-buildout (R4-17) — presence-only rows for the onboarding session's
// five stages. D4 (binding): this module's "may not read outside sessionDir"
// invariant is NOT relaxed for this kind — it performs ZERO filesystem work
// here, full stop. The real derivation (`deriveContractStages`) lives in
// `packages/projects/contract-stages.ts`, which reads the PROJECT tree (outside any
// sessionDir) via its own realpath-guarded containment; this module only
// threads ALREADY-DERIVED, already-guarded rows the caller (cli/bridge-studio-
// sessions.ts) supplies, and throws when they are absent — never a silently
// empty/defaulted artifact (see `deriveSessionArtifact`'s `contract-buildout`
// case below).
//
// `ContractStageRow`/`ContractBuildoutArtifact` are declared HERE, not in
// `packages/projects/contract-stages.ts`, so the ONE type has ONE canonical owner and
// `packages/projects/contract-stages.ts` imports it from here — the same direction that
// file already needs for `safeReadFileInSession` and `SESSION_STAGES`
// (`session-kinds.ts`), so this adds no new import direction and creates no
// cycle (verified: `orchestrator/` already imports plain VALUES from `cli/`
// in ~30 files today, e.g. `packages/flows/manifest.ts` -> `cli/manifest-path-
// guard.ts`, so a `cli/` -> `orchestrator/` type import here is the
// established direction, not a reversal).
// ---------------------------------------------------------------------------

/** Presence, never a verdict (D11) — `forge preflight`'s exit code is the
 *  only authoritative contract-green signal; a row says "this artifact is
 *  present/absent, here is its source", never "this clause passes". */
export type ContractStageStatus = 'present' | 'absent';

/** The five onboarding stages — SESSION_STAGES minus 'brain' (project-brain
 *  owns that stage; D2). */
export type ContractStage = Exclude<SessionStage, 'brain'>;

export type ContractStageRow = {
  readonly stage: ContractStage;
  readonly status: ContractStageStatus;
  /** Which real on-disk artifact this row's presence answer is about — named
   *  even when `status` is 'absent' (a dropped row is indistinguishable from
   *  "we never looked"; naming the source at least says "we looked here"). */
  readonly source: string;
  /** Presence facts only (D11) — never verdict language ("pass"/"fail"/
   *  "clause"/"green"/"red"/"compliant"). */
  readonly detail: string[];
  /** The real byte length read from disk for the two prose-file-backed
   *  stages (`instructions`, `roadmap`); `null` for the three config/lock-
   *  JSON-backed stages (`contract`, `secrets`, `demo`). */
  readonly bytes: number | null;
};

export type ContractBuildoutArtifact = {
  readonly kind: 'contract-buildout';
  /** The session-kind descriptor's declared `artifact.label` — see
   *  RoadmapDraftArtifact.label. */
  readonly label: string;
  /** Threaded VERBATIM from the caller — never re-derived, re-sorted, or
   *  filtered here (D4). */
  readonly stages: ContractStageRow[];
  readonly sourcesScanned: string[];
};

// ---------------------------------------------------------------------------
// file-package (R4-21) — the creation-agent authoring session's accumulating
// draft skill/hook package. Reads the session dir's own `staging/`
// subdirectory (a DEDICATED subdirectory, never the bare session root — see
// this module's shared `manifests/`/`themes/` per-kind-subdirectory
// convention, mirrored exactly here, so a creation-agent session's
// accumulating draft package can never collide with the fixed
// CANDIDATE_SOURCE_FILES transcript scan every session dir is unconditionally
// scanned against regardless of kind). Reuses the SAME realpath-guarded
// choke points (`safeReadFileInSession`/`listDirEntries`) every other
// derivation in this module already goes through — no new fs call path.
//
// R4-21 phase 2, WI-1, D2 (_wave5/unit-specs/R4-21-phase2.md): this
// subdirectory was named `package/` in R4-21 phase 1, predating ADR-043
// (docs/decisions/043-generic-interactive-surface.md §1), whose ratified
// `turnSpec` table declares `writes: [staging]`. Renamed here to match the
// ratified data rather than parameterising the finalizer. The rename is
// COMPLETE, not additive — a leftover `package/` dir is never scanned, not
// even as a fallback (RED-2f, session-transcript.test.ts).
// ---------------------------------------------------------------------------

const PACKAGE_DIRNAME = 'staging';

export type FilePackageArtifact = {
  readonly kind: 'file-package';
  /** The session-kind descriptor's declared `artifact.label` — see
   *  RoadmapDraftArtifact.label. */
  readonly label: string;
  // Mutable element array — see RoadmapDraftArtifact.rows for the identical
  // rationale (the pinned AT idiom casts to a plain mutable-array shape).
  readonly files: PackageFile[];
};

/** Same realpath-containment guard as `listDirEntries`, but returns typed
 *  `Dirent[]` (not just filtered names) so `walkPackageFiles` can tell a
 *  real subdirectory from a file/symlink/other WITHOUT a second stat call.
 *  A directory that escapes `sessionDir` via a symlink (or doesn't exist)
 *  yields `[]` — exactly `listDirEntries`'s contract, just with entry TYPE
 *  preserved. Sorted by name for deterministic output. Not a replacement
 *  for `listDirEntries` (every other derivation in this module keeps using
 *  that flat, extension-filtered scan unchanged) — this is `staging/`'s own
 *  recursive-walk primitive (R4-21 BLOCKER-1 fix, see `walkPackageFiles`). */
function listDirEntriesTyped(sessionDir: string, dirRel: string): Dirent[] {
  const abs = join(sessionDir, dirRel);
  let realSessionDir: string;
  try {
    realSessionDir = realpathSync(sessionDir);
  } catch {
    return []; // sessionDir itself doesn't exist / unreadable
  }
  let realAbs: string;
  try {
    realAbs = realpathSync(abs);
  } catch {
    return []; // missing subdirectory, broken symlink, or unreadable path segment
  }
  if (realAbs !== realSessionDir && !realAbs.startsWith(realSessionDir + sep)) {
    return []; // this directory (or a symlink to it) escapes sessionDir — treated as absent, never followed
  }
  try {
    return readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** Recursively walks `staging/` (and every REAL subdirectory beneath it),
 *  appending each file found into `out` with a path RELATIVE TO `staging/`,
 *  POSIX-separated (`PackageFile.path` convention — e.g. `scripts/run.sh`,
 *  matching `installSkillPackage`/`readSkillPackage`'s own recursive-walk
 *  path shape in skill-library.ts).
 *
 *  R4-21 BLOCKER-1 fix: the previous flat, single-level scan
 *  (`listDirEntries(sessionDir, 'package', '')` + per-name
 *  `safeReadFileInSession`) called `readFileSync` on every top-level
 *  `staging/` entry NAME unconditionally — including a DIRECTORY entry
 *  (e.g. `scripts/`, written by a hook draft alongside `hook.yaml` per
 *  skills/creation-agent/SKILL.md). `readFileSync` on a directory throws
 *  EISDIR, caught by the existing try/catch, and the entry was dropped
 *  SILENTLY — indistinguishable from a blocked symlink escape
 *  (declared-data-fails-open: a real, non-malicious nested file vanished
 *  with no signal). This walk instead uses `listDirEntriesTyped` to check
 *  each entry's TYPE before deciding what to do with it:
 *
 *    - A real directory entry (`entry.isDirectory()`) is DESCENDED, never
 *      read-as-file.
 *    - Every other entry kind — a plain file, a symlink of ANY kind
 *      (`fs.Dirent`'s type check is on the raw dirent, so a symlink is
 *      never `isDirectory()`/`isFile()` — it is its own third category),
 *      or any exotic dirent type — is attempted ONLY through
 *      `safeReadFileInSession`, this module's one realpath-guarded read
 *      choke point. A symlink escaping `sessionDir` (to a file OR a
 *      directory) resolves outside, is treated as absent by that guard,
 *      and contributes no file — it is never descended into either,
 *      preserving the module's existing "escaping entry ⇒ never surfaced"
 *      contract at every depth, not just the top level. A symlink pointing
 *      at an IN-BOUNDS directory also contributes nothing (`readFileSync`
 *      on it still throws EISDIR, caught, dropped) — a deliberately
 *      conservative choice: this walk never follows a symlink to descend
 *      into a directory, only a real one.
 *
 *  Bounded by the SAME `MAX_PACKAGE_FILES`/`MAX_PACKAGE_BYTES` caps
 *  `installSkillPackage` validates against at INSTALL time
 *  (skill-library.ts) — reused here as a soft READ-side bound, not a
 *  validation gate: once either limit is reached the walk simply stops
 *  collecting further files (never throws, never fabricates a truncation
 *  marker) rather than rendering an unbounded tree from a runaway/
 *  malicious session dir. `totalBytes` is a boxed counter (not a return
 *  value) purely so every recursive call shares the same running total. */
function walkPackageFiles(sessionDir: string, dirRelToSession: string, dirRelToPackage: string, out: PackageFile[], totalBytes: { value: number }): void {
  if (out.length >= MAX_PACKAGE_FILES || totalBytes.value >= MAX_PACKAGE_BYTES) return;
  const entries = listDirEntriesTyped(sessionDir, dirRelToSession);
  for (const entry of entries) {
    if (out.length >= MAX_PACKAGE_FILES || totalBytes.value >= MAX_PACKAGE_BYTES) return;
    const childRelToSession = join(dirRelToSession, entry.name);
    const childRelToPackage = dirRelToPackage ? `${dirRelToPackage}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      walkPackageFiles(sessionDir, childRelToSession, childRelToPackage, out, totalBytes);
      continue;
    }
    const body = safeReadFileInSession(sessionDir, childRelToSession);
    if (body === null) continue; // missing/escaped/unreadable (incl. EISDIR on a symlinked dir) — never surfaced
    const bytes = Buffer.byteLength(body, 'utf8');
    if (totalBytes.value + bytes > MAX_PACKAGE_BYTES) return; // would exceed the cap — stop walking
    totalBytes.value += bytes;
    out.push({ path: childRelToPackage, body });
  }
}

/** `staging/` — recursively walks every real file under the session dir's
 *  `staging/` subdirectory (a package may legitimately carry SKILL.md,
 *  reference.md, scripts/run.sh, ...) via `walkPackageFiles` (R4-21
 *  BLOCKER-1 fix — see that function's header for the nested-file defect
 *  this replaces and the containment/DoS-bound contract it preserves). An
 *  escaping symlinked entry (file, OR a subdirectory at any depth)
 *  contributes NO file — never surfaced — while a real, non-symlinked
 *  sibling still reads normally, at every depth (the guard discriminates,
 *  it does not just refuse to read anything). */
export function deriveFilePackage(sessionDir: string, label: string): FilePackageArtifact {
  const files: PackageFile[] = [];
  walkPackageFiles(sessionDir, PACKAGE_DIRNAME, '', files, { value: 0 });
  return { kind: 'file-package', label, files };
}

// ---------------------------------------------------------------------------
// cleanup-plan (R4-19-F2) — brain-maintenance's KB-cleanup session.
// DERIVE-DON'T-STORE (the binding contract, this repo's #1 defect class):
// the session dir's `plan/cleanup-plan.md` supplies the agent's PROPOSED
// ACTIONS only (kind/target/proposal per line, per skills/brain-maintenance/
// SKILL.md's output contract). CURRENT truth is ALWAYS the caller-supplied
// `cleanupFindings` — a live, KB-scoped brain-lint run the caller
// (packages/sessions/bridge-studio-sessions.ts, via packages/knowledge/bridge-studio-kbs.ts's
// `computeAgentCleanupFindings`) computes fresh on every call. Each action's
// `state` is DERIVED at read time by joining the two on (kind, target) —
// there is no stored per-action status field anywhere: not in the plan
// file, not in status.json, not anywhere. Mirrors contract-buildout's D4
// caller-supplied-input pattern exactly, just with a different field name
// (`cleanupFindings`, ORCHESTRATOR RULING — mirrors `contractStages`).
// ---------------------------------------------------------------------------

const CLEANUP_PLAN_DIRNAME = 'plan';
const CLEANUP_PLAN_FILENAME = 'cleanup-plan.md';

/** The caller-supplied CURRENT-truth shape — a subset of packages/knowledge/brain-lint.ts's
 *  real `Finding` (post-`classify`) this module deliberately does NOT import
 *  (mirrors `fixtureContractStages`'s own rationale: this module stays a
 *  pure, fs-only derivation with no business importing the lint engine). Any
 *  object carrying at least these two fields satisfies this structurally —
 *  the caller may (and in production does) supply richer Finding objects. */
export type CleanupFinding = { readonly kind: string; readonly file: string };

/** R4-19-F2 fail-safe fix (ORCHESTRATOR RULING) — the scanned-domain signal.
 *  Additive-optional on `deriveSessionArtifact`'s input (ADR-042
 *  disclose-not-park), threaded through to `deriveCleanupPlan`, mirroring
 *  how `contractStages` is already threaded. `forgeRoot` is the absolute
 *  root a repo-relative plan `target` resolves against; `brainDir` is the
 *  absolute directory the caller's `cleanupFindings` were ACTUALLY scanned
 *  from (packages/sessions/bridge-studio-sessions.ts resolves this via `resolveKbBrainDir`
 *  at the same call site that already computes `cleanupFindings`). Presence
 *  of this field is what makes `'cleared'` derivable at all — see
 *  `CleanupPlanAction.state`'s own doc for the full three-way contract. */
export type CleanupScan = { readonly forgeRoot: string; readonly brainDir: string };

export type CleanupPlanAction = {
  readonly kind: string;
  readonly target: string;
  readonly proposal: string;
  /** DERIVED per call, never stored (R4-19-F2 P1 fix — declared-data-fails-
   *  open: a REAL live run showed a plan where every action already looked
   *  'cleared' while both findings were provably still live, because an
   *  absolute `Finding.file` was joined against a repo-relative plan
   *  `target` with NO normalization, so nothing ever matched and "no match"
   *  was silently read as 'cleared'). Computed fresh on EVERY call, by
   *  precedence:
   *    'open'    — a live finding matches the action (kind + normalized
   *                target — see `findingMatchesAction`).
   *    'cleared' — no match, AND the caller supplied `cleanupScan`, AND the
   *                action's normalized target resolves INSIDE
   *                `cleanupScan.brainDir` — absence is then real evidence:
   *                the region was scanned and came back clean.
   *    'unknown' — no match and coverage cannot be established: `cleanupScan`
   *                was omitted, or the target resolves OUTSIDE `brainDir`.
   *                The FAIL-SAFE default — never silently 'cleared'. */
  readonly state: 'open' | 'cleared' | 'unknown';
};

export type CleanupPlanArtifact = {
  readonly kind: 'cleanup-plan';
  /** The session-kind descriptor's declared `artifact.label` — see
   *  RoadmapDraftArtifact.label. */
  readonly label: string;
  /** The raw plan text, verbatim, whether or not any line parsed into an
   *  action — null only when no plan file exists at all (or it escapes
   *  sessionDir). Never null merely because zero lines parsed (AT-4): a
   *  drafted-but-unparseable plan must never render as "no plan and no
   *  actions" — that ambiguity is indistinguishable from "the agent hasn't
   *  drafted yet" (AT-5), which this field exists to disambiguate. */
  readonly plan: string | null;
  // Mutable element array — see RoadmapDraftArtifact.rows for the identical
  // rationale (the pinned AT idiom casts to a plain mutable-array shape).
  readonly actions: CleanupPlanAction[];
  /** The count of `actions` whose derived `state` is 'open' (ORCHESTRATOR
   *  RULING) — never a separate count sourced from `cleanupFindings.length`
   *  directly (a finding with no matching plan action would inflate that). */
  readonly openFindingCount: number;
};

/** Matches skills/brain-maintenance/SKILL.md's mandated action-line format:
 *  `- [<kind>] <theme-file-path> — <one-sentence proposal>`. Adversarial-
 *  review hardening (the task brief): the SKILL.md shows the em-dash
 *  separator only inside a code fence, and LLM prose frequently contains
 *  dashes of its own — so FOUR separator variants are accepted: em dash
 *  (—, U+2014), en dash (–, U+2013), " - ", and " -- ". A theme-file-path
 *  never contains whitespace, so `(\S+)` captures exactly the target token
 *  and the separator alternation is anchored immediately after it
 *  (whitespace-bounded on both sides) — this is, by construction, the FIRST
 *  separator occurrence after the target, so a proposal sentence containing
 *  its own dash later on is captured intact by the trailing `(.*)$`, never
 *  re-split. `--` is listed before the single `-` in the alternation so a
 *  double-hyphen separator is tried whole first (defensive; regex
 *  backtracking would reach the same result either order, since the two
 *  literal sequences never share a starting position once the shared
 *  boundary is a full `\s` character). */
const ACTION_LINE_RE = /^-\s*\[([^\]]+)\]\s+(\S+)\s+(?:—|–|--|-)\s+(.*)$/;

type ParsedCleanupAction = { readonly kind: string; readonly target: string; readonly proposal: string };

/** Parses `plan/cleanup-plan.md`'s action lines only — a line that does not
 *  match ACTION_LINE_RE is silently IGNORED for `actions[]` (the raw text
 *  still surfaces verbatim in `plan`, per CleanupPlanArtifact.plan's own
 *  doc). Prose sections (an intro, grouping headers, rationale) around the
 *  mandated action lines are expected and welcome — SKILL.md explicitly
 *  allows them. */
function parseCleanupPlanActions(raw: string): ParsedCleanupAction[] {
  const actions: ParsedCleanupAction[] = [];
  for (const line of raw.split('\n')) {
    const m = ACTION_LINE_RE.exec(line.trim());
    if (!m) continue; // ignored for actions[] — the raw plan text still carries it
    actions.push({ kind: m[1], target: m[2], proposal: m[3] });
  }
  return actions;
}

// ---------------------------------------------------------------------------
// R4-19-F2 P1 fix -- path normalization + the cleared/unknown fail-safe
// split. The live defect: a caller-supplied Finding.file is ABSOLUTE by
// contract (packages/knowledge/brain-lint.ts:54), but the agent's plan writes a
// REPO-RELATIVE target (skills/brain-maintenance/SKILL.md's mandated
// shape) -- comparing the two literally never matched anything, and "no
// match" silently read as 'cleared'. These helpers normalize BOTH shapes
// before comparing, and keep the brainDir containment check a REAL
// resolved-path check (never prefix string math -- see isPathInside's own
// doc for why).
// ---------------------------------------------------------------------------

/** Strips a single leading "./" -- the only prefix form SKILL.md's real
 *  agent output (and this repo's own live-captured fixture) is known to
 *  produce. Nothing fancier is normalized here (no repeated "./", no
 *  embedded "./" mid-path) -- matching the three normalization directions
 *  the task brief names by name: repo-relative, "./"-prefixed, and
 *  already-absolute. */
function stripLeadingDotSlash(target: string): string {
  return target.startsWith('./') ? target.slice(2) : target;
}

/** Whether a caller-supplied finding is evidence FOR one parsed plan
 *  action. Matches on kind AND normalized target (the P1 fix -- see this
 *  section's header). Two join shapes cover every real Finding.file shape
 *  this repo produces (absolute) AND every plan-target shape the agent can
 *  write (repo-relative, "./"-prefixed, or already-absolute), with no
 *  forgeRoot required to establish a MATCH (only the cleared/unknown split
 *  below needs one):
 *    - exact string equality -- handles an already-absolute target against
 *      an absolute finding.file 1:1 (NORM-2), and also a hand-fixtured
 *      test finding whose .file happens to be repo-relative itself
 *      (AT-1/AT-3).
 *    - a path-separator-BOUNDED suffix match -- handles a repo-relative
 *      target naming the tail of an absolute finding.file (the
 *      real-capture shape, NORM-1/NORM-3/REGRESSION-LOCK). Bounded by sep
 *      so a target of "themes/foo.md" can never falsely match a finding
 *      whose path merely ends in "...other-themes/foo.md". */
function findingMatchesAction(finding: CleanupFinding, kind: string, target: string): boolean {
  if (finding.kind !== kind) return false;
  const normalized = stripLeadingDotSlash(target);
  return finding.file === normalized || finding.file.endsWith(sep + normalized);
}

/** Resolves a plan target to an absolute path against forgeRoot,
 *  collapsing any "." / ".." segments via `resolve` -- this is what lets
 *  the brainDir containment check (isPathInside, below) defeat a LEXICAL
 *  ".."-escape (SCAN-6 shape 1): the escape is collapsed away here, before
 *  containment is ever checked. An already-absolute target is resolved
 *  AS-IS, never re-rooted under forgeRoot -- the explicit isAbsolute
 *  branch keeps the intent legible rather than relying on `resolve`'s own
 *  "rightmost absolute argument wins" semantics (mirrors NORM-2's own
 *  regression note against a naive unconditional join). */
function resolveTargetAbsolute(target: string, forgeRoot: string): string {
  const normalized = stripLeadingDotSlash(target);
  return isAbsolute(normalized) ? resolve(normalized) : resolve(forgeRoot, normalized);
}

/** Real containment, not string math (SCAN-6 -- this repo's recurring
 *  escape shape per the adversarial-containment-review skill). A
 *  trailing-separator-aware identity/prefix check performed AFTER lexical
 *  resolution (resolveTargetAbsolute already collapsed any ".." above) --
 *  that combination is what defeats BOTH of SCAN-6's escape shapes:
 *    - a ".."-escaping target (<brainDir>/../elsewhere/x.md): resolves to
 *      a path OUTSIDE brainDir before this function ever runs, so the raw
 *      escaping string is never even compared.
 *    - a "<brainDir>-sibling/" prefix collision: a bare
 *      childAbs.startsWith(parentAbs) would wrongly match -- "...forge-dev-
 *      sibling" textually starts with "...forge-dev" -- so the parent's
 *      OWN trailing separator is required before comparing, mirroring this
 *      module's own safeReadFileInSession containment idiom exactly. */
function isPathInside(childAbs: string, parentAbs: string): boolean {
  const resolvedParent = resolve(parentAbs);
  const boundary = resolvedParent.endsWith(sep) ? resolvedParent : resolvedParent + sep;
  return childAbs === resolvedParent || childAbs.startsWith(boundary);
}

/** Derives one action's `state` -- see CleanupPlanAction.state's own doc
 *  for the full three-way contract. Precedence is load-bearing: a genuine
 *  match ALWAYS wins over the cleared/unknown derivation (SCAN-5 --
 *  checking brainDir containment before checking for a match would invert
 *  this). */
function deriveActionState(
  kind: string,
  target: string,
  cleanupFindings: readonly CleanupFinding[],
  cleanupScan: CleanupScan | undefined,
): CleanupPlanAction['state'] {
  if (cleanupFindings.some((f) => findingMatchesAction(f, kind, target))) return 'open';
  if (cleanupScan === undefined) return 'unknown'; // no scanned-domain evidence at all -- fail safe
  const absoluteTarget = resolveTargetAbsolute(target, cleanupScan.forgeRoot);
  return isPathInside(absoluteTarget, cleanupScan.brainDir) ? 'cleared' : 'unknown';
}

/** `plan/cleanup-plan.md` — read through the SAME realpath-containment
 *  choke point (`safeReadFileInSession`) every other single-file derivation
 *  in this module goes through, so a `plan/` directory that is itself a
 *  symlink escaping `sessionDir` contributes NO file (collapsed to the same
 *  "no plan file at all" outcome `safeReadFileInSession` already gives every
 *  other escaping read — AT-6). `cleanupFindings` supplies CURRENT truth;
 *  `state` is derived fresh on every call (see this section's own header). */
export function deriveCleanupPlan(
  sessionDir: string,
  label: string,
  cleanupFindings: readonly CleanupFinding[],
  cleanupScan: CleanupScan | undefined,
): CleanupPlanArtifact {
  const raw = safeReadFileInSession(sessionDir, join(CLEANUP_PLAN_DIRNAME, CLEANUP_PLAN_FILENAME));
  if (raw === null) {
    return { kind: 'cleanup-plan', label, plan: null, actions: [], openFindingCount: 0 };
  }
  const actions: CleanupPlanAction[] = parseCleanupPlanActions(raw).map((a) => ({
    ...a,
    state: deriveActionState(a.kind, a.target, cleanupFindings, cleanupScan),
  }));
  const openFindingCount = actions.filter((a) => a.state === 'open').length;
  return { kind: 'cleanup-plan', label, plan: raw, actions, openFindingCount };
}

export type SessionArtifactPayload =
  | RoadmapDraftArtifact
  | MarkdownDraftArtifact
  | BrainStructureArtifact
  | GenerationGalleryArtifact
  | ContractBuildoutArtifact
  | FilePackageArtifact
  | CleanupPlanArtifact;


export function deriveMarkdownDraft(sessionDir: string, label: string): MarkdownDraftArtifact {
  const body = safeReadFileInSession(sessionDir, AGENTS_DRAFT_FILENAME);
  return { kind: 'markdown-draft', label, body, hasDraft: body !== null };
}

export function deriveBrainStructure(sessionDir: string, label: string): BrainStructureArtifact {
  const files = listDirEntries(sessionDir, THEMES_DIRNAME, '.md');
  const packageFiles: PackageFile[] = [];
  for (const file of files) {
    const body = safeReadFileInSession(sessionDir, join(THEMES_DIRNAME, file));
    if (body === null) continue; // missing/escaped entry — never surfaced
    packageFiles.push({ path: `${THEMES_DIRNAME}/${file}`, body });
  }
  return { kind: 'brain-structure', label, themeCount: packageFiles.length, files: packageFiles };
}

const GENERATIONS_DIRNAME = 'generations';
const GENERATION_META_FILENAME = 'meta.json';

function kindForGalleryItemFilename(name: string): 'html' | 'markdown' | 'file' {
  if (name.endsWith('.html')) return 'html';
  if (name.endsWith('.md')) return 'markdown';
  return 'file';
}

type ParsedGenerationMeta = {
  readonly iteration: number;
  readonly createdAt: string;
  readonly feedback: string | null;
  readonly targetElement: string | null;
};

/** Parses one generation's meta.json — fails CLOSED (returns null) on ANY
 *  shape violation the R4-16 contract cares about: not JSON, or a missing /
 *  non-numeric "iteration". A generation whose meta.json fails this parse
 *  contributes NO row — never a fabricated one, and never a renumbered
 *  successor (R4-16 AT-11/AT-12). `createdAt`/`feedback`/`targetElement` are
 *  written by the runner under our own control (demo-builder-runner.ts) so
 *  they're read defensively (coerced to a safe default on the wrong type)
 *  rather than failing the whole generation — only `iteration` is load-bearing
 *  for numbering/ordering. */
function parseGenerationMeta(raw: string): ParsedGenerationMeta | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const rec = parsed as Record<string, unknown>;
  if (typeof rec.iteration !== 'number') return null;
  return {
    iteration: rec.iteration,
    createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : '',
    feedback: typeof rec.feedback === 'string' ? rec.feedback : null,
    targetElement: typeof rec.targetElement === 'string' ? rec.targetElement : null,
  };
}

/** `generations/<n>/` — see the module header for the shared realpath
 *  containment contract (`safeReadFileInSession`/`listDirEntries`); this
 *  derivation adds NO new fs call path, reusing both choke points exactly
 *  like `deriveRoadmapDraft`/`deriveBrainStructure` do for `manifests/`/
 *  `themes/`. `listDirEntries(sessionDir, dir, '')` lists every entry — see
 *  that function's header for why an empty extension is universally matching. */
export function deriveGenerationGallery(sessionDir: string, label: string): GenerationGalleryArtifact {
  const dirNames = listDirEntries(sessionDir, GENERATIONS_DIRNAME, '');
  const generations: GenerationGalleryEntry[] = [];

  for (const dirName of dirNames) {
    const metaRel = join(GENERATIONS_DIRNAME, dirName, GENERATION_META_FILENAME);
    const metaRaw = safeReadFileInSession(sessionDir, metaRel);
    if (metaRaw === null) continue; // missing / unreadable / escaped — never fabricated
    const meta = parseGenerationMeta(metaRaw);
    if (meta === null) continue; // not JSON / missing or mistyped iteration — a visible gap

    const entryNames = listDirEntries(sessionDir, join(GENERATIONS_DIRNAME, dirName), '');
    const items: GenerationGalleryItem[] = [];
    for (const name of entryNames) {
      if (name === GENERATION_META_FILENAME) continue; // metadata, not gallery content
      const body = safeReadFileInSession(sessionDir, join(GENERATIONS_DIRNAME, dirName, name));
      if (body === null) continue; // missing/escaped entry (e.g. a symlinked item) — never surfaced
      items.push({ path: name, kind: kindForGalleryItemFilename(name), bytes: Buffer.byteLength(body, 'utf8') });
    }
    // listDirEntries sorts with localeCompare (locale-aware — case-insensitive
    // under the default locale), but the pinned contract here is plain
    // filename (code-unit) order — re-sort explicitly rather than trust
    // listDirEntries's sort verbatim (checked, not assumed, per the task brief).
    items.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    generations.push({
      number: meta.iteration,
      createdAt: meta.createdAt,
      feedback: meta.feedback,
      targetElement: meta.targetElement,
      items,
    });
  }
  generations.sort((a, b) => a.number - b.number);

  return {
    kind: 'generation-gallery',
    label,
    generations,
    // Mirrors deriveRoadmapDraft's exact idiom: names what was scanned
    // INCLUDING the count found, so an empty gallery reads "scanned N, found
    // none" rather than a bare, unexplained empty pane.
    sourcesScanned: [`${GENERATIONS_DIRNAME}/*/${GENERATION_META_FILENAME} (${dirNames.length} file(s) found)`],
  };
}
