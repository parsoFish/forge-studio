/**
 * Pure, per-renderer view-state for the session shell's artifact pane
 * (R2-10, PR2) — one module covering all three LIVE artifact kinds
 * (roadmap-draft, markdown-draft, brain-structure), rather than three
 * separate files: they are three tightly-related renderers for the SAME
 * pane of the SAME page, and the combined module stays well under this
 * repo's file-size discipline. No DOM, no React, no network — mirrors
 * file-package.ts's / skill-library-view.ts's testability convention.
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
import type { BrainStructureArtifact, MarkdownDraftArtifact, RoadmapDraftArtifact, RoadmapDraftRow, SessionArtifactPayload } from './session-client';

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
};

export function roadmapDraftView(artifact: RoadmapDraftArtifact): RoadmapDraftView {
  const isEmpty = artifact.rows.length === 0;
  return {
    kind: 'roadmap-draft',
    rows: artifact.rows,
    isEmpty,
    emptyMessage: isEmpty ? `No roadmap rows yet — scanned ${artifact.sourcesScanned.join(', ')}` : null,
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
// sessionArtifactView — dispatcher + reserved/unknown kind guards
// ---------------------------------------------------------------------------

export type SessionArtifactView = RoadmapDraftView | MarkdownDraftView | BrainStructureView;

/** Vocabulary-reserved artifact kinds (mirrors orchestrator/studio/session-
 *  kinds.ts's SESSION_ARTIFACT_KINDS `reserved` rows) — a session carrying
 *  one of these reaches this dispatcher only if a future descriptor is
 *  wired before its renderer ships. Zero stub renderers exist for any of
 *  these; the error names the reserved kind explicitly. */
const RESERVED_ARTIFACT_KINDS = ['file-package', 'contract-buildout', 'generation-gallery'] as const;

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
    default: {
      const kind = artifact.kind;
      if ((RESERVED_ARTIFACT_KINDS as readonly string[]).includes(kind)) {
        throw new Error(`sessionArtifactView: artifact kind "${kind}" is reserved — no renderer exists for it yet${stageSuffix(stage)}`);
      }
      throw new Error(`sessionArtifactView: unrecognised artifact kind "${kind}"${stageSuffix(stage)}`);
    }
  }
}
