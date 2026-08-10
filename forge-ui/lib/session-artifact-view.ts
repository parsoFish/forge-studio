/**
 * Pure, per-renderer view-state for the session shell's artifact pane
 * (R2-10, PR2) — one module covering all six LIVE artifact kinds
 * (roadmap-draft, markdown-draft, brain-structure, generation-gallery,
 * contract-buildout, file-package), rather than one file per kind: they are
 * tightly-related renderers for the SAME pane of the SAME page, and the
 * combined module stays well under this repo's file-size discipline. No
 * DOM, no React, no network — mirrors file-package.ts's / skill-library-
 * view.ts's testability convention.
 *
 * REUSE, not fork (T2 ruling, binding on this module): `brainStructureView`'s
 * file tabs go through the SHARED `forge-ui/lib/file-package.ts`
 * (`filePackageTabs`/`selectFile`) — the same machinery `brain-structure`'s
 * file tabs use elsewhere in Studio. No bespoke tab-strip state machine is
 * written here.
 *
 * AMENDMENT (T2 Correction 2, 2026-08-05): `sessionArtifactView` takes an
 * OPTIONAL second parameter, `stage?: string` — the currently-selected stage
 * (session-shell-view.ts's `state.selectedStage`), threaded to the dispatch
 * boundary so a future stage-aware renderer (R4-17's reserved
 * `contract-buildout` row) can be a drop-in without the wire, the client, or
 * this dispatcher's signature changing again. Every LIVE kind today is
 * stage-UNAWARE by nature (a roadmap draft or an AGENTS.md draft has no
 * notion of "which stage") — `stage` reaching them is a no-op, proven by
 * AT-91. The seam itself is proven via the RESERVED/unknown-kind error
 * paths naming the requested stage when one is passed (AT-92/93) — no stub
 * renderer is invented for `contract-buildout` to prove this.
 */

import { filePackageTabs, selectFile, type FilePackageState } from './file-package';
import { dependencyDagView, type DependencyDagView } from './dependency-dag';
import type {
  BrainStructureArtifact,
  ContractBuildoutArtifact,
  ContractStageRow,
  FilePackageArtifact,
  GenerationGalleryArtifact,
  GenerationGalleryEntry,
  MarkdownDraftArtifact,
  RoadmapDraftArtifact,
  RoadmapDraftRow,
  SessionArtifactPayload,
} from './session-client';

// ---------------------------------------------------------------------------
// roadmapDraftView
// ---------------------------------------------------------------------------

export type RoadmapDraftView = {
  kind: 'roadmap-draft';
  rows: RoadmapDraftRow[];
  isEmpty: boolean;
  /** Non-null iff `rows` is empty — names what was scanned (derived from
   *  `sourcesScanned`, never a generic hardcoded string), so an empty
   *  roadmap reads "scanned N, found none", never a bare/blank pane. */
  emptyMessage: string | null;
  /** R4-15: the SHARED dependency-DAG view model (forge-ui/lib/
   *  dependency-dag.ts), built from `rows`' `dependsOn` — reuse, never a
   *  bespoke DAG-building pass written here (mirrors `brainStructureView`'s
   *  reuse of `filePackageTabs`). */
  dag: DependencyDagView<RoadmapDraftRow>;
};

export function roadmapDraftView(artifact: RoadmapDraftArtifact): RoadmapDraftView {
  const isEmpty = artifact.rows.length === 0;
  return {
    kind: 'roadmap-draft',
    rows: artifact.rows,
    isEmpty,
    emptyMessage: isEmpty ? `No roadmap rows yet — scanned ${artifact.sourcesScanned.join(', ')}` : null,
    dag: dependencyDagView(
      artifact.rows,
      (r) => r.initiativeId,
      (r) => r.dependsOn,
    ),
  };
}

// ---------------------------------------------------------------------------
// markdownDraftView
// ---------------------------------------------------------------------------

export type MarkdownDraftViewState = 'no-draft' | 'empty-draft' | 'has-content';

export type MarkdownDraftView = {
  kind: 'markdown-draft';
  state: MarkdownDraftViewState;
  body: string | null;
};

/** "No draft yet" (missing file), "an empty draft" (file exists, empty
 *  body), and "has content" are three pairwise-distinct states — the server
 *  already distinguishes the first two via `hasDraft`/`body`; this view must
 *  not collapse them back together. */
export function markdownDraftView(artifact: MarkdownDraftArtifact): MarkdownDraftView {
  if (!artifact.hasDraft) {
    return { kind: 'markdown-draft', state: 'no-draft', body: null };
  }
  if (artifact.body === '') {
    return { kind: 'markdown-draft', state: 'empty-draft', body: '' };
  }
  return { kind: 'markdown-draft', state: 'has-content', body: artifact.body };
}

// ---------------------------------------------------------------------------
// brainStructureView / selectBrainStructureFile — REUSE pin
// ---------------------------------------------------------------------------

export type BrainStructureView = {
  kind: 'brain-structure';
  /** Passed through VERBATIM from the artifact — never re-derived from
   *  `files.length` (a legitimately divergent count must not be
   *  "corrected"). */
  themeCount: number;
  filePackage: FilePackageState;
};

export function brainStructureView(artifact: BrainStructureArtifact): BrainStructureView {
  return {
    kind: 'brain-structure',
    themeCount: artifact.themeCount,
    filePackage: filePackageTabs(artifact.files),
  };
}

/** Delegates to the REAL, shared `selectFile` — never a bespoke
 *  reimplementation of its clamping behaviour. Returns a NEW view object
 *  (immutability); `themeCount` is unchanged. */
export function selectBrainStructureFile(view: BrainStructureView, index: number): BrainStructureView {
  return { ...view, filePackage: selectFile(view.filePackage, index) };
}

// ---------------------------------------------------------------------------
// generationGalleryView / preferredGenerationFor — R4-16
// ---------------------------------------------------------------------------

export type GenerationGalleryView = {
  kind: 'generation-gallery';
  /** Passed through verbatim, server order (ascending by number) — never
   *  re-sorted, never a fabricated entry added or dropped. */
  generations: GenerationGalleryEntry[];
  count: number;
  /** Index into `generations` of the currently-selected generation; -1 iff
   *  `isEmpty`. Defaults to the LAST entry (the newest generation), never
   *  the first — mirrors the operator's expectation of landing on the most
   *  recent output. */
  selectedIndex: number;
  isEmpty: boolean;
  /** Non-null iff `generations` is empty — names what was scanned (derived
   *  from `sourcesScanned`, never a generic hardcoded string), mirroring
   *  `roadmapDraftView`'s idiom exactly. */
  emptyMessage: string | null;
};

/**
 * R4-16 pin 2 (Finding D) — `preferredNumber` (OPTIONAL) selects the
 * generation carrying THAT number, by VALUE, never by array position: the
 * demo-builder poll refetches every 3s and rebuilds `artifact` as a brand-new
 * object graph each tick (same generations, new reference) — so a
 * poll-stable selection can only survive if it is looked up by the stable
 * `number` field, never an index into whichever array happened to arrive
 * this tick (AT-112). Absent, or naming a generation no longer present
 * (AT-111 — e.g. it existed in an earlier payload but this poll's snapshot
 * doesn't carry it), falls back to the newest generation exactly like today
 * — never throws.
 */
export function generationGalleryView(
  artifact: GenerationGalleryArtifact,
  preferredNumber?: number,
): GenerationGalleryView {
  const isEmpty = artifact.generations.length === 0;
  const preferredIndex = preferredNumber === undefined
    ? -1
    : artifact.generations.findIndex((g) => g.number === preferredNumber);
  const selectedIndex = isEmpty ? -1 : preferredIndex >= 0 ? preferredIndex : artifact.generations.length - 1;
  return {
    kind: 'generation-gallery',
    generations: artifact.generations,
    count: artifact.generations.length,
    selectedIndex,
    isEmpty,
    emptyMessage: isEmpty ? `No generations yet — scanned ${artifact.sourcesScanned.join(', ')}` : null,
  };
}

/**
 * R4-16 round 2 (pin 3, Finding C, MAJOR) — the pure decision behind the
 * cross-session selection-leak fix. `GenerationGallery` used to store a bare
 * `useState<number | null>`, so a generation picked while viewing session A
 * silently kept rendering after the panel swapped to session B (the caller
 * swaps `sessionId` without unmounting). This function is what lets the
 * component derive its view fresh every render, with NO artifact-identity
 * `useEffect` (that shape was the ROUND-1 defect this replaces — an effect
 * keyed on the artifact's object reference resets on every 3s poll tick even
 * when nothing the operator picked actually changed, AT-112).
 *
 * Returns `selection.number` iff `selection.sessionId === sessionId` — the
 * session currently on screen — else `undefined`, so `generationGalleryView`
 * falls back to its existing, already-pinned newest-generation default
 * (AT-101/111). `null` (nothing picked yet, in any session) also yields
 * `undefined`.
 */
export function preferredGenerationFor(
  selection: { sessionId: string; number: number } | null,
  sessionId: string,
): number | undefined {
  if (selection === null) return undefined;
  return selection.sessionId === sessionId ? selection.number : undefined;
}

// ---------------------------------------------------------------------------
// filePackageArtifactView / selectFilePackageFile — R4-21, REUSE pin (mirrors
// brainStructureView/selectBrainStructureFile's own reuse of the SHARED
// FilePackage machinery exactly — no bespoke tab-strip state machine here
// either).
// ---------------------------------------------------------------------------

export type FilePackageArtifactView = {
  kind: 'file-package';
  filePackage: FilePackageState;
};

export function filePackageArtifactView(artifact: FilePackageArtifact): FilePackageArtifactView {
  return { kind: 'file-package', filePackage: filePackageTabs(artifact.files) };
}

/** Delegates to the REAL, shared `selectFile` — never a bespoke
 *  reimplementation of its clamping behaviour. Returns a NEW view object
 *  (immutability), mirroring `selectBrainStructureFile` exactly. */
export function selectFilePackageFile(view: FilePackageArtifactView, index: number): FilePackageArtifactView {
  return { ...view, filePackage: selectFile(view.filePackage, index) };
}

// ---------------------------------------------------------------------------
// contractBuildoutView — R4-17
// ---------------------------------------------------------------------------

export type ContractBuildoutView =
  | { kind: 'contract-buildout'; mode: 'checklist'; checklist: ContractStageRow[] }
  | { kind: 'contract-buildout'; mode: 'detail'; row: ContractStageRow | null };

/**
 * Stage-aware, mirroring the mockup (`mockups/studio-endstate-v2/
 * views-session.jsx:77-158`) exactly: the `contract` stage renders the
 * CHECKLIST of all five stage rows (the "which components are present"
 * overview, `:139-157`); every other stage renders THAT stage's own row
 * detail (`:80-138`). An `activeStage` naming a stage with no matching row
 * (never happens for a real 5-stage payload) resolves `row: null` rather
 * than throwing — this module's house style of failing soft on VIEW
 * derivation, reserving throws for dispatch-boundary vocabulary errors
 * (below). D11: rows are rendered exactly as given — presence, source,
 * detail lines, byte count — never upgraded into pass/fail language.
 *
 * `artifact.stages` missing/non-array (a genuinely malformed artifact, not
 * a normal view-derivation edge case) DOES throw, naming the kind — this is
 * what lets a bare `{kind:'contract-buildout'}` reaching the dispatcher
 * (AT-92, session-artifact-view.test.ts) fail loudly instead of crashing
 * with an unhelpful native TypeError.
 */
export function contractBuildoutView(
  artifact: ContractBuildoutArtifact | { kind: string; stages?: unknown },
  activeStage?: string,
): ContractBuildoutView {
  const stagesRaw = (artifact as { stages?: unknown }).stages;
  if (!Array.isArray(stagesRaw)) {
    throw new Error(`contractBuildoutView: malformed "contract-buildout" artifact — missing or invalid "stages"${stageSuffix(activeStage)}`);
  }
  const stages = stagesRaw as ContractStageRow[];
  if (activeStage === 'contract') {
    return { kind: 'contract-buildout', mode: 'checklist', checklist: stages };
  }
  const row = stages.find((r) => r.stage === activeStage) ?? null;
  return { kind: 'contract-buildout', mode: 'detail', row };
}

// ---------------------------------------------------------------------------
// sessionArtifactView — dispatcher + reserved/unknown kind guards
// ---------------------------------------------------------------------------

export type SessionArtifactView =
  | RoadmapDraftView
  | MarkdownDraftView
  | BrainStructureView
  | GenerationGalleryView
  | ContractBuildoutView
  | FilePackageArtifactView;

/** Vocabulary-reserved artifact kinds (mirrors orchestrator/studio/session-
 *  kinds.ts's SESSION_ARTIFACT_KINDS `reserved` rows) — a session carrying
 *  one of these reaches this dispatcher only if a future descriptor is
 *  wired before its renderer ships. Zero stub renderers exist for this one;
 *  the error names the reserved kind explicitly. R4-16: shrank from 3 to 2
 *  ("generation-gallery" flipped live). R4-17: shrank again, to 1 —
 *  "contract-buildout" flipped live. R4-21: EMPTY — "file-package" (the last
 *  reserved row) now has a real renderer (filePackageArtifactView above) and
 *  is dispatched, not reserved. Kept as a (currently empty) named constant
 *  rather than deleted, so a future extension that re-opens the reserved
 *  pattern has an obvious place to add a row. */
const RESERVED_ARTIFACT_KINDS: readonly string[] = [];

/** A trailing " (requested stage: "X")" clause when `stage` was passed —
 *  proof the argument genuinely reached the dispatch boundary (AT-92/93),
 *  never a fake/unused parameter. Omitted entirely when `stage` is
 *  undefined, so every pre-Correction-2 call site's message is unchanged. */
function stageSuffix(stage: string | undefined): string {
  return stage === undefined ? '' : ` (requested stage: ${JSON.stringify(stage)})`;
}

/** Dispatches each of the 3 live artifact kinds to its matching renderer —
 *  `stage`, when passed, is a no-op for all three (they are stage-UNAWARE
 *  by nature; AT-91). A RESERVED kind throws an explicit error naming it and
 *  saying "reserved" (distinguishable from a totally unknown kind's message,
 *  which names the kind but never claims "reserved") — never a silent
 *  stub. */
export function sessionArtifactView(artifact: SessionArtifactPayload | { kind: string }, stage?: string): SessionArtifactView {
  switch (artifact.kind) {
    case 'roadmap-draft':
      return roadmapDraftView(artifact as RoadmapDraftArtifact);
    case 'markdown-draft':
      return markdownDraftView(artifact as MarkdownDraftArtifact);
    case 'brain-structure':
      return brainStructureView(artifact as BrainStructureArtifact);
    case 'generation-gallery':
      return generationGalleryView(artifact as GenerationGalleryArtifact);
    case 'contract-buildout':
      return contractBuildoutView(artifact as ContractBuildoutArtifact, stage);
    case 'file-package':
      return filePackageArtifactView(artifact as FilePackageArtifact);
    default: {
      const kind = artifact.kind;
      if ((RESERVED_ARTIFACT_KINDS as readonly string[]).includes(kind)) {
        throw new Error(`sessionArtifactView: artifact kind "${kind}" is reserved — no renderer exists for it yet${stageSuffix(stage)}`);
      }
      throw new Error(`sessionArtifactView: unrecognised artifact kind "${kind}"${stageSuffix(stage)}`);
    }
  }
}
