/**
 * The ROADMAP-DRAFT artifact — the architect session's manifest table, and the
 * one session artifact whose derivation needs a manifest parsed.
 *
 * Extracted from `session-transcript.ts` under M4 ruling 83, which accepted
 * that file's ceiling being re-keyed for 3b's injected-port seam ON THE
 * CONDITION that row 5's split brought it back down. `../design.md` carries the
 * argument: why the seam falls here, why the three types are re-exported from
 * `session-transcript.ts` rather than repointed across ten files, and why this
 * module takes its readers as a port instead of importing them.
 */import { join } from 'node:path';

import type { InitiativeManifest } from '@forge/contracts/manifest-types.ts';

/** The session dir under which the architect writes its promoted manifests. */
const MANIFESTS_DIRNAME = 'manifests';

/**
 * The two containment-checked readers this derivation needs, passed IN because
 * importing them would close a cycle (`session-transcript.ts` owns them and
 * imports `deriveRoadmapDraft`). The caller passes its own, so the realpath
 * containment is the transcript layer's, never re-implemented here.
 */
export type SessionDirReaders = {
  listDirEntries: (sessionDir: string, dirRel: string, extension: string) => string[];
  safeReadFileInSession: (sessionDir: string, relPath: string) => string | null;
};

/** Injected `parseManifest` (flows is rank 5, this package rank 4). The SHAPE
 *  is imported directly — it lives in contracts now (ruling 81). */
export type ParseManifestPort = (content: string) => InitiativeManifest;

export type RoadmapDraftRow = {
  readonly initiativeId: string;
  readonly project: string;
  readonly phase: string;
  readonly origin: string;
  // Mutable element array (not `readonly string[]`) — same rationale as
  // RoadmapDraftArtifact.rows below: the pinned AT idiom casts the derived
  // artifact to a plain `{ rows: Array<{ ...; dependsOn: string[] }> }`
  // shape, and a `readonly string[]` is never assignable to a mutable
  // `string[]` target.
  //
  // Sourced verbatim from the manifest's `depends_on_initiatives`
  // (packages/flows/manifest.ts:73, already parsed by `parseManifest`) —
  // absent on the manifest ⇒ `[]`, never undefined and never dropped from
  // the row. This field is DERIVED, never fabricated: it is exactly what
  // the manifest declares, in declared order, with no filtering,
  // de-duplication, or re-sorting at this layer.
  //
  // Resolving an edge against this session's OWN draft row set (which
  // dependency ids are "real" vs. dangling) is deliberately NOT this
  // layer's job — it is the VIEW layer's (apps/studio/lib/dependency-dag.ts's
  // `dependencyDagView`). An edge pointing at an initiative outside the
  // draft set (e.g. one that already merged before this architect session
  // started) is real information the operator needs to see, not noise to
  // be silently dropped here.
  readonly dependsOn: string[];
};

export type RoadmapDraftArtifact = {
  readonly kind: 'roadmap-draft';
  /** The session-kind descriptor's declared `artifact.label`
   *  (studio/session-kinds.yaml), threaded through verbatim — never
   *  re-derived or defaulted here. See `deriveSessionArtifact`. */
  readonly label: string;
  // Mutable element arrays (not `readonly T[]`) — deliberately, so a direct
  // `as { rows: Array<...>; sourcesScanned: string[] }` cast (the pinned AT
  // idiom in session-transcript.test.ts) type-checks: a `readonly T[]` is
  // never assignable to a mutable `T[]` target, which is a real TS
  // constraint, not a laxness. The exported *properties* stay non-reassignable
  // (no `readonly` array TYPE, but callers still get a fresh object per call —
  // immutability is preserved by never mutating an already-returned array).
  readonly rows: RoadmapDraftRow[];
  readonly sourcesScanned: string[];
};

export function deriveRoadmapDraft(
  sessionDir: string,
  label: string,
  parseManifest: ParseManifestPort,
  io: SessionDirReaders,
): RoadmapDraftArtifact {
  const files = io.listDirEntries(sessionDir, MANIFESTS_DIRNAME, '.md');
  const rows: RoadmapDraftRow[] = [];
  for (const file of files) {
    const body = io.safeReadFileInSession(sessionDir, join(MANIFESTS_DIRNAME, file));
    if (body === null) continue; // missing/escaped entry — never surfaced
    let manifest;
    try {
      manifest = parseManifest(body);
    } catch {
      continue; // an unparsable manifest contributes no row; never fabricated
    }
    rows.push({
      initiativeId: manifest.initiative_id,
      project: manifest.project,
      phase: manifest.phase,
      origin: manifest.origin,
      // Verbatim, never filtered/sorted/de-duplicated here — see the field's
      // doc comment on RoadmapDraftRow.
      dependsOn: manifest.depends_on_initiatives ?? [],
    });
  }
  return {
    kind: 'roadmap-draft',
    label,
    rows,
    sourcesScanned: [`${MANIFESTS_DIRNAME}/*.md (${files.length} file(s) found)`],
  };
}
